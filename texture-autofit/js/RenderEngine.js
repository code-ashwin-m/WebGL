export class RenderEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl');
    if (!this.gl) throw new Error('WebGL not supported');

    this.programComposite = null;
    this.programMaskHandle = null;
    this.programMaskOutline = null;

    // Buffers
    this._imageVBO = null;
    this._imageIBO = null;
    this._screenVBO = null;
    this._screenIBO = null;

    // Textures
    this.imageTexture = null;
    this.image = null;
    this.imgWidth = 1;
    this.imgHeight = 1;

    // Camera
    this.camX = 0;
    this.camY = 0;
    this.zoom = 1;

    // Masks
    this.masks = [];
    this.nextMaskId = 1;

    // Constants
    this.HANDLE_RADIUS_PX = 8;
    
    // Cache for uniforms and attributes to avoid repeated lookups
    this._uniformCache = new Map();
    this._attribCache = new Map();
  }

  setCamera(camX, camY, zoom) {
    this.camX = camX;
    this.camY = camY;
    this.zoom = zoom;
  }

  setImage(img) {
    this.image = img;
    this.imgWidth = img.width;
    this.imgHeight = img.height;
    
    this._createImageTexture(img);
    this._createImageBuffers();
    this._createScreenBuffer();
    
    this.buildCompositeProgram();
    this.buildMaskProgram();
  }

  // Program management with caching
  _getUniformLocation(program, id, name) {
    const key = `${id}_${name}`;
    if (!this._uniformCache.has(key)) {
      this._uniformCache.set(key, this.gl.getUniformLocation(program, name));
    }
    return this._uniformCache.get(key);
  }

  _getAttribLocation(program, id, name) {
    const key = `${id}_${name}`;
    if (!this._attribCache.has(key)) {
      this._attribCache.set(key, this.gl.getAttribLocation(program, name));
    }
    return this._attribCache.get(key);
  }

  buildCompositeProgram() {
    const vert = RenderEngine._vsSource();
    const frag = RenderEngine._fsSource();

    if (this.programComposite) this._deleteProgram(this.programComposite);
    this.programComposite = this._createProgram(vert, frag);

    const gl = this.gl;
    this.aCompositePos = this._getAttribLocation(this.programComposite, "programComposite", 'aPos');
    this.aCompositeTex = this._getAttribLocation(this.programComposite, "programComposite", 'aTex');
    this.uCompositeProj = this._getUniformLocation(this.programComposite, "programComposite", 'uProj');
  }

  buildMaskProgram() {
    const vert = RenderEngine._vsMaskSource();
    const fragHandle = RenderEngine._fsMaskHandleSource();
    const fragOutline = RenderEngine._fsMaskOutlineSource();

    if (this.programMaskHandle) this._deleteProgram(this.programMaskHandle);
    if (this.programMaskOutline) this._deleteProgram(this.programMaskOutline);
    
    this.programMaskHandle = this._createProgram(vert, fragHandle);
    this.programMaskOutline = this._createProgram(vert, fragOutline);

    console.log('Created mask programs');
    console.log('Handle program:', this.programMaskHandle);
    console.log('Outline program:', this.programMaskOutline);
    
    // Cache handle program uniforms
    this.uMaskHandleProj = this._getUniformLocation(this.programMaskHandle, "programMaskHandle", 'uProj');
    this.uMaskHandleBounds = this._getUniformLocation(this.programMaskHandle, "programMaskHandle", 'uMaskBounds');
    this.uMaskHandleCenter = this._getUniformLocation(this.programMaskHandle, "programMaskHandle", 'uCenter');
    this.uMaskHandleRadius = this._getUniformLocation(this.programMaskHandle, "programMaskHandle", 'uRadius');
    this.uMaskHandleFeather = this._getUniformLocation(this.programMaskHandle, "programMaskHandle", 'uFeather');
    this.uMaskHandleShadowSize = this._getUniformLocation(this.programMaskHandle, "programMaskHandle", 'uShadowSize');
    this.uMaskHandleShadowAlpha = this._getUniformLocation(this.programMaskHandle, "programMaskHandle", 'uShadowAlpha');
    this.uMaskHandleInnerRadius = this._getUniformLocation(this.programMaskHandle, "programMaskHandle", 'uInnerRadius');
    this.uMaskHandleInnerVisible = this._getUniformLocation(this.programMaskHandle, "programMaskHandle", 'uInnerVisible');

    // Cache outline program uniforms
    this.uMaskOutlineProj = this._getUniformLocation(this.programMaskOutline, "programMaskOutline", 'uProj');
    this.uMaskOutlineBounds = this._getUniformLocation(this.programMaskOutline, "programMaskOutline", 'uMaskBounds');
    this.uMaskOutlineCenter = this._getUniformLocation(this.programMaskOutline, "programMaskOutline", 'uCenter');
    this.uMaskOutlineRx = this._getUniformLocation(this.programMaskOutline, "programMaskOutline", 'uRx');
    this.uMaskOutlineRy = this._getUniformLocation(this.programMaskOutline, "programMaskOutline", 'uRy');
    this.uMaskOutlineRotation = this._getUniformLocation(this.programMaskOutline, "programMaskOutline", 'uRotation');
    this.uMaskOutlineThickness = this._getUniformLocation(this.programMaskOutline, "programMaskOutline", 'uThickness');
    this.uMaskOutlineFeather = this._getUniformLocation(this.programMaskOutline, "programMaskOutline", 'uFeather');
  }

  draw() {
    if (!this.imageTexture) return;
        
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    
    // Clear with transparent black
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    this._drawCompositeToScreen();
    this._renderMaskOutline();
    this._renderMaskHandles();
  }

  setMasks(masks) {
    this.masks = masks;
  }

  getHandlePositions(mask) {
    const c = Math.cos(mask.rotation || 0);
    const s = Math.sin(mask.rotation || 0);
    const rot = (x, y) => ({ 
      x: mask.center.x + (x * c - y * s), 
      y: mask.center.y + (x * s + y * c) 
    });
    const pixel = 1.0 / this.zoom;
    
    return {
      center: rot(0, 0),
      right: rot(mask.rx, 0),
      left: rot(-mask.rx, 0),
      top: rot(0, mask.ry),
      bottom: rot(0, -mask.ry),
      rotate: rot(0, -(mask.ry + 40 * pixel))
    };
  }

  // Optimized shaders
  static _vsSource() {
    return `#version 100
attribute vec2 aPos;
attribute vec2 aTex;
varying vec2 vTex;
uniform mat4 uProj;
void main() {
  gl_Position = uProj * vec4(aPos, 0.0, 1.0);
  vTex = aTex;
}`;
  }

  static _fsSource() {
    return `#version 100
precision mediump float;
varying vec2 vTex;
uniform sampler2D uImage;
void main() {
  gl_FragColor = texture2D(uImage, vTex);
}`;
  }

  static _vsMaskSource() {
    return `#version 100
attribute vec2 aPos;
uniform mat4 uProj;
uniform vec4 uMaskBounds;
varying vec2 vWorldPos;
void main() {
  float worldX = mix(uMaskBounds.x, uMaskBounds.y, aPos.x);
  float worldY = mix(uMaskBounds.z, uMaskBounds.w, aPos.y);
  vWorldPos = vec2(worldX, worldY);
  gl_Position = uProj * vec4(vWorldPos, 0.0, 1.0);
}`;
  }

  static _fsMaskHandleSource() {
    return `#version 100
precision mediump float;
varying vec2 vWorldPos;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uFeather;
uniform float uShadowSize;
uniform float uShadowAlpha;
uniform float uInnerRadius;
uniform int uInnerVisible;

void main() {
  float d = distance(vWorldPos, uCenter);
  float outerSdf = d - uRadius;
  float innerSdf = d - uInnerRadius;
  
  // Outer circle (white)
  float outerAlpha = 1.0 - smoothstep(0.0, uFeather, outerSdf);
  
  // Inner circle (blue) - only for center handle
  float innerAlpha = 0.0;
  if (uInnerVisible == 1) {
    innerAlpha = 1.0 - smoothstep(0.0, uFeather, innerSdf);
  }
  
  // Soft shadow
  float shadow = (1.0 - smoothstep(0.0, uShadowSize, outerSdf)) * 
                 step(0.0, outerSdf) * uShadowAlpha;
  
  // Layer composition
  vec3 color = mix(vec3(0.2), vec3(1.0), outerAlpha);
  if (uInnerVisible == 1) {
    color = mix(color, vec3(0.2, 0.49, 0.92), innerAlpha);
  }
  
  float alpha = max(max(shadow, outerAlpha), innerAlpha);
  gl_FragColor = vec4(color * alpha, alpha);
}`;
  }

  static _fsMaskOutlineSource() {
    return `#version 100
precision mediump float;
varying vec2 vWorldPos;
uniform vec2 uCenter;
uniform float uRx;
uniform float uRy;
uniform float uRotation;
uniform float uThickness;
uniform float uFeather;

float ellipseDistance(vec2 p, vec2 center, float rx, float ry, float rot) {
  vec2 d = p - center;
  float c = cos(rot);
  float s = sin(rot);
  vec2 r = vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
  return length(vec2(r.x / rx, r.y / ry)) - 1.0;
}

void main() {
  // Calculate normalized distance
  float normDist = ellipseDistance(vWorldPos, uCenter, uRx, uRy, uRotation);
  
  // Convert to pixel distance using gradient
  float c = cos(uRotation);
  float s = sin(uRotation);
  vec2 d = vWorldPos - uCenter;
  vec2 r = vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
  vec2 grad = vec2(r.x / (uRx * uRx), r.y / (uRy * uRy));
  float gradLen = length(grad);
  float pixelDist = normDist / gradLen;
  
  // Create outline with anti-aliasing
  float halfWidth = uThickness * 0.5;
  float alpha = 1.0 - smoothstep(halfWidth - uFeather, halfWidth + uFeather, abs(pixelDist));
  
  // White outline color with premultiplied alpha
  gl_FragColor = vec4(alpha);
}`;
  }

  _createImageTexture(img) {
    const gl = this.gl;
    
    if (this.imageTexture) {
      gl.deleteTexture(this.imageTexture);
    }
    
    this.imageTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    
    // Use gl.texImage2D with the correct parameters
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    
    // Use NEAREST filtering for crisp images (or LINEAR for smooth)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  _createImageBuffers() {
    const gl = this.gl;
    const w = this.imgWidth;
    const h = this.imgHeight;
    
    // Clean up old buffers
    if (this._imageVBO) gl.deleteBuffer(this._imageVBO);
    if (this._imageIBO) gl.deleteBuffer(this._imageIBO);
    
    // Create vertices: [x, y, u, v]
    const verts = new Float32Array([
      0, 0, 0, 1,     // bottom-left
      w, 0, 1, 1,     // bottom-right
      w, h, 1, 0,     // top-right
      0, h, 0, 0      // top-left
    ]);
    
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    
    this._imageVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._imageVBO);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    
    this._imageIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._imageIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  _createScreenBuffer() {
    const gl = this.gl;
    
    if (this._screenVBO) gl.deleteBuffer(this._screenVBO);
    if (this._screenIBO) gl.deleteBuffer(this._screenIBO);
    
    // Full screen quad in normalized coordinates
    const verts = new Float32Array([
      -1, -1,  // bottom-left
       1, -1,  // bottom-right
       1,  1,  // top-right
      -1,  1   // top-left
    ]);
    
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    
    this._screenVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._screenVBO);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    
    this._screenIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._screenIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  _drawCompositeToScreen() {
    const gl = this.gl;
    
    // Calculate projection matrix
    const w = this.canvas.width / this.zoom;
    const h = this.canvas.height / this.zoom;
    const left = this.camX;
    const right = this.camX + w;
    const bottom = this.camY;
    const top = this.camY + h;
    const proj = ortho(left, right, bottom, top, -1, 1);
    
    gl.useProgram(this.programComposite);
    gl.uniformMatrix4fv(this.uCompositeProj, false, proj);
    
    // Bind texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    
    // Set up vertex attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, this._imageVBO);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._imageIBO);
    
    gl.enableVertexAttribArray(this.aCompositePos);
    gl.enableVertexAttribArray(this.aCompositeTex);
    
    gl.vertexAttribPointer(this.aCompositePos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(this.aCompositeTex, 2, gl.FLOAT, false, 16, 8);
    
    // Draw
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    
    // Cleanup
    gl.disableVertexAttribArray(this.aCompositePos);
    gl.disableVertexAttribArray(this.aCompositeTex);
  }

  _renderMaskOutline() {
    if (this.masks.length === 0) return;
    
    const gl = this.gl;
    
    // Calculate projection matrix
    const w = this.canvas.width / this.zoom;
    const h = this.canvas.height / this.zoom;
    const left = this.camX;
    const right = this.camX + w;
    const bottom = this.camY;
    const top = this.camY + h;
    const proj = ortho(left, right, bottom, top, -1, 1);
    
    gl.useProgram(this.programMaskOutline);
    
    // Enable blending for transparent outlines
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Set common uniforms
    gl.uniformMatrix4fv(this.uMaskOutlineProj, false, proj);
    gl.uniform4f(this.uMaskOutlineBounds, left, right, bottom, top);
    
    // Bind screen quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this._screenVBO);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._screenIBO);
    gl.enableVertexAttribArray(this._getAttribLocation(this.programMaskOutline, "programMaskOutline", 'aPos'));
    gl.vertexAttribPointer(this._getAttribLocation(this.programMaskOutline, "programMaskOutline", 'aPos'), 2, gl.FLOAT, false, 0, 0);
    
    // Set per-mask uniforms
    const thickness = 2.0 / this.zoom;
    const feather = 0.5 / this.zoom;
    
    for (const mask of this.masks) {
      gl.uniform2f(this.uMaskOutlineCenter, mask.center.x, mask.center.y);
      gl.uniform1f(this.uMaskOutlineRx, mask.rx);
      gl.uniform1f(this.uMaskOutlineRy, mask.ry);
      gl.uniform1f(this.uMaskOutlineRotation, mask.rotation || 0);
      gl.uniform1f(this.uMaskOutlineThickness, thickness);
      gl.uniform1f(this.uMaskOutlineFeather, feather);
      
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
    
    // Cleanup
    gl.disableVertexAttribArray(this._getAttribLocation(this.programMaskOutline, "programMaskOutline", 'aPos'));
    gl.disable(gl.BLEND);
  }

  _renderMaskHandles() {
    if (this.masks.length === 0) return;
    
    const gl = this.gl;
    
    // Calculate projection matrix
    const w = this.canvas.width / this.zoom;
    const h = this.canvas.height / this.zoom;
    const left = this.camX;
    const right = this.camX + w;
    const bottom = this.camY;
    const top = this.camY + h;
    const proj = ortho(left, right, bottom, top, -1, 1);
    
    gl.useProgram(this.programMaskHandle);
    
    // Enable blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Set common uniforms
    gl.uniformMatrix4fv(this.uMaskHandleProj, false, proj);
    gl.uniform4f(this.uMaskHandleBounds, left, right, bottom, top);
    
    // Bind screen quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this._screenVBO);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._screenIBO);
    gl.enableVertexAttribArray(this._getAttribLocation(this.programMaskHandle, "programMaskHandle", 'aPos'));
    gl.vertexAttribPointer(this._getAttribLocation(this.programMaskHandle, "programMaskHandle", 'aPos'), 2, gl.FLOAT, false, 0, 0);
    
    // Calculate handle properties
    const radiusWorld = this.HANDLE_RADIUS_PX / this.zoom;
    const innerRadiusWorld = (this.HANDLE_RADIUS_PX - 2.0) / this.zoom;
    const featherWorld = 1.0 / this.zoom;
    const shadowSize = 4.0 / this.zoom;
    
    // Set common handle uniforms
    gl.uniform1f(this.uMaskHandleRadius, radiusWorld);
    gl.uniform1f(this.uMaskHandleFeather, featherWorld);
    gl.uniform1f(this.uMaskHandleShadowSize, shadowSize);
    gl.uniform1f(this.uMaskHandleShadowAlpha, 0.9);
    gl.uniform1f(this.uMaskHandleInnerRadius, innerRadiusWorld);
    
    // Draw handles for each mask
    for (const mask of this.masks) {
      const handles = this.getHandlePositions(mask);
      const handleList = [
        { pos: handles.center, innerVisible: true },
        { pos: handles.right, innerVisible: false },
        { pos: handles.left, innerVisible: false },
        { pos: handles.top, innerVisible: false },
        { pos: handles.bottom, innerVisible: false },
        { pos: handles.rotate, innerVisible: false }
      ];
      
      for (const handle of handleList) {
        gl.uniform2f(this.uMaskHandleCenter, handle.pos.x, handle.pos.y);
        gl.uniform1i(this.uMaskHandleInnerVisible, handle.innerVisible ? 1 : 0);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      }
    }
    
    // Cleanup
    gl.disableVertexAttribArray(this._getAttribLocation(this.programMaskHandle, "programMaskHandle", 'aPos'));
    gl.disable(gl.BLEND);
  }

  _deleteProgram(prog) {
    if (!prog) return;
    
    const gl = this.gl;
    
    // Clear cache entries for this program
    for (const [key] of this._uniformCache) {
      if (key.startsWith(`${prog}_`)) {
        this._uniformCache.delete(key);
      }
    }
    
    for (const [key] of this._attribCache) {
      if (key.startsWith(`${prog}_`)) {
        this._attribCache.delete(key);
      }
    }
    
    gl.deleteProgram(prog);
  }

  _createProgram(vsSrc, fsSrc) {
    const gl = this.gl;
    
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link failed:', gl.getProgramInfoLog(prog));
      throw new Error('Program link failed');
    }
    
    // Clean up shaders after linking
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    
    return prog;
  }
}

// Helper functions
function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    console.error('Shader compile error:', error);
    console.error('Shader source:', source);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${error}`);
  }
  
  return shader;
}

function ortho(left, right, bottom, top, near, far) {
  return new Float32Array([
    2 / (right - left), 0, 0, 0,
    0, 2 / (top - bottom), 0, 0,
    0, 0, -2 / (far - near), 0,
    -(right + left) / (right - left),
    -(top + bottom) / (top - bottom),
    -(far + near) / (far - near),
    1
  ]);
}