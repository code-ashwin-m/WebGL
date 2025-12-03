export class RenderEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl');
    if (!this.gl) throw new Error('WebGL not supported');

    this.programComposite = null;

    this._imageVBO = null;
    this._imageIBO = null;

    this.imgWidth = 1; this.imgHeight = 1;
    this.imageTexture = null;
    this.image = null;

    this.camX = 0; this.camY = 0;
    this.zoom = 1;

    this.masks = [];
    this.nextMaskId = 1;

    this.HANDLE_RADIUS_PX = 8;

    this._maskFBO = null;
    this._maskTexture = null;
    this.programMaskHandle = null;
    this.programMaskOutline = null;
  }

  setCamera(camX, camY, zoom) {
    this.camX = camX; this.camY = camY; this.zoom = zoom;
  }

  setImage(img) {
    this.image = img;
    this.imgWidth = img.width;
    this.imgHeight = img.height;
    this._createImageTexture(img);
    this._createImageBuffers();
    this._createScreenBuffer();
    // this._createMaskFbo();
    this.buildCompositeProgram();
    this.buildMaskProgram();
  }

  buildCompositeProgram() {
    const vert = RenderEngine._vsSource();
    const frag = RenderEngine._fsSource();

    if (this.programComposite) this._deleteProgram(this.programComposite);
    this.programComposite = this._createProgram(vert, frag);

    const gl = this.gl;
    this.aCompositePos = gl.getAttribLocation(this.programComposite, 'aPos');
    this.aCompositeTex = gl.getAttribLocation(this.programComposite, 'aTex');
    this.uCompositeProj = gl.getUniformLocation(this.programComposite, 'uProj');
  }

  buildMaskProgram() {
    const vert = RenderEngine._vsMaskHandleSource();
    const frag = RenderEngine._fsMaskHandleSource();

    if (this.programMaskHandle) this._deleteProgram(this.programMaskHandle);
    this.programMaskHandle = this._createProgram(vert, frag);

    const gl = this.gl;
    this.aMaskHandlePos = gl.getAttribLocation(this.programMaskHandle, 'aPos');
    this.uMaskHandleProj = gl.getUniformLocation(this.programMaskHandle, 'uProj');
    this.uMaskHandleBounds = gl.getUniformLocation(this.programMaskHandle, 'uMaskBounds');
    this.uMaskHandleCenter = gl.getUniformLocation(this.programMaskHandle, 'uCenter');
    this.uMaskHandleRadius = gl.getUniformLocation(this.programMaskHandle, 'uRadius');
    this.uMaskHandleFeather = gl.getUniformLocation(this.programMaskHandle, 'uFeather');
    this.uMaskHandleShadowSize = gl.getUniformLocation(this.programMaskHandle, 'uShadowSize');
    this.uMaskHandleShadowAlpha = gl.getUniformLocation(this.programMaskHandle, 'uShadowAlpha');
    this.uMaskHandleInnerRadius = gl.getUniformLocation(this.programMaskHandle, 'uInnerRadius'); 
    this.uMaskHandleInnerVisible = gl.getUniformLocation(this.programMaskHandle, 'uInnerVisible');

    const fragOutline = RenderEngine._fsMaskOutlineSource();

    if (this.programMaskOutline) this._deleteProgram(this.programMaskOutline);
    this.programMaskOutline = this._createProgram(vert, fragOutline);

    this.aMaskOutlinePos = gl.getAttribLocation(this.programMaskOutline, 'aPos');
    this.uMaskOutlineProj = gl.getUniformLocation(this.programMaskOutline, 'uProj');
    this.uMaskOutlineBounds = gl.getUniformLocation(this.programMaskOutline, 'uMaskBounds');
    this.uMaskOutlineCenter = gl.getUniformLocation(this.programMaskOutline, 'uCenter');
    this.uMaskOutlineRx = gl.getUniformLocation(this.programMaskOutline, 'uRx');
    this.uMaskOutlineRy = gl.getUniformLocation(this.programMaskOutline, 'uRy');
    this.uMaskOutlineRotation = gl.getUniformLocation(this.programMaskOutline, 'uRotation');
    this.uMaskOutlineThickness = gl.getUniformLocation(this.programMaskOutline, 'uThickness');
    
  }

  draw() {
    if (!this.imageTexture) return;
    this._draw();
  }

  setMasks(masks) {
    this.masks = masks;
  }

  getHandlePositions(mask) {
    const c = Math.cos(mask.rotation || 0);
    const s = Math.sin(mask.rotation || 0);
    const rot = (x, y) => ({ x: mask.center.x + (x * c - y * s), y: mask.center.y + (x * s + y * c) });
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

  static _vsSource() {
    return `
attribute vec2 aPos; 
attribute vec2 aTex;
varying vec2 vTex;
uniform mat4 uProj;
void main(){
  gl_Position=uProj*vec4(aPos,0.0,1.0);
  vTex=aTex;
}
`;
  }

  static _fsSource() {
    return `
precision mediump float;
varying vec2 vTex;
uniform sampler2D uImage;
void main(){
  gl_FragColor=texture2D(uImage, vTex);
}
`;
  }

  static _vsMaskHandleSource() {
    return `
attribute vec2 aPos;
uniform mat4 uProj;
uniform vec4 uMaskBounds;
varying vec2 vWorldPos;
void main() {
    float worldX = uMaskBounds.x + aPos.x * (uMaskBounds.y - uMaskBounds.x);
    float worldY = uMaskBounds.z + aPos.y * (uMaskBounds.w - uMaskBounds.z);
    vWorldPos = vec2(worldX, worldY);
    gl_Position = uProj * vec4(vWorldPos, 0.0, 1.0);
}
`;
  }

  static _fsMaskHandleSource() {
    return `
precision mediump float;
varying vec2 vWorldPos;
uniform vec2  uCenter;      // pixel coords (world space = pixels)
uniform float uRadius;      // pixels (world units)
uniform float uFeather;     // feather in pixels (world units)
uniform float uShadowSize;  // shadow width in pixels -> divided by zoom in JS
uniform float uShadowAlpha; // max darkness of shadow (0-1)
uniform float uInnerRadius; // inner circle radius
uniform int uInnerVisible;  // inner circle visibility
void main() {
    float d = distance(vWorldPos, uCenter);

    // -----------------------
    //  Outer circle (white)
    // -----------------------
    float outerSdf = d - uRadius;
    float outerAlpha = 1.0 - smoothstep(0.0, uFeather, outerSdf);
    vec3 outerColor = vec3(1.0);

    // -----------------------
    //  Inner circle (blue)
    // -----------------------
    float innerSdf = d - uInnerRadius;
    float innerAlpha = 0.0;
    if(uInnerVisible == 1){
      innerAlpha = 1.0 - smoothstep(0.0, uFeather, innerSdf);
    }
    
    // -----------------------
    //  Soft shadow outside
    // -----------------------
    float shadow = 1.0 - smoothstep(0.0, uShadowSize, outerSdf);
    shadow *= (outerSdf > 0.0) ? uShadowAlpha : 0.0;

    // -----------------------
    //  Layer composition:
    //  shadow → outer circle → inner circle
    // -----------------------
    vec3 shadowColor = vec3(0.2);
    vec3 color = mix(shadowColor, outerColor, outerAlpha);

    if(uInnerVisible == 1){
      vec3 innerColor = vec3(0.2, 0.49, 0.92);
      color = mix(color, innerColor, innerAlpha);
    }

    float alpha = max(max(shadow, outerAlpha), innerAlpha);

    gl_FragColor = vec4(color, alpha);
}
`;
  }

  static _fsMaskOutlineSource() {
    return `
precision mediump float;
varying vec2 vWorldPos;
uniform vec2 uCenter;     // pixel coords
uniform float uRx;        // ellipse radius X (world)
uniform float uRy;        // ellipse radius Y (world)
uniform float uRotation;  // radians
uniform float uThickness;  // thickness

// Returns normalized distance (0 at edge, >0 outside, <0 inside)
float ellipseDistance(vec2 p, vec2 center, float rx, float ry, float rotation) {
    // translate
    vec2 d = p - center;
    
    // rotate
    float c = cos(rotation);
    float s = sin(rotation);
    vec2 r = vec2(
        d.x * c + d.y * s,
        -d.x * s + d.y * c
    );
    
    // ellipse equation: (x/rx)^2 + (y/ry)^2 = 1
    // distance: sqrt((x/rx)^2 + (y/ry)^2) - 1
    return length(vec2(r.x / rx, r.y / ry)) - 1.0;
}

void main() {
    // Calculate the signed distance to ellipse (normalized)
    float dist = ellipseDistance(vWorldPos, uCenter, uRx, uRy, uRotation);
    
    // Convert normalized distance to pixels
    float c = cos(uRotation);
    float s = sin(uRotation);
    
    // Calculate gradient to get proper distance scaling
    vec2 d = vWorldPos - uCenter;
    vec2 r = vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
    
    // Gradient of the ellipse function gives scaling factor
    vec2 grad = vec2(r.x / (uRx * uRx), r.y / (uRy * uRy));
    float gradLen = length(grad);
    
    // Convert normalized distance to pixel distance
    float pixelDist = dist / gradLen;
    
    // Outline thickness in pixels
    float outlineWidth = 2.0;
    
    // FIXED: Draw only the outline
    // We want to draw when we're close to the edge (pixelDist near 0)
    // We'll draw a band that extends uThickness/2 on each side of the edge
    float halfWidth = uThickness / 2.0;
    
    // Create a smooth outline by checking if we're within the outline width
    // Use abs(pixelDist) to get distance from edge regardless of direction
    // float alpha = smoothstep(halfWidth + 0.5, halfWidth - 0.5, abs(pixelDist));
    
    // Alternative: More precise outline with anti-aliasing
    float alpha = 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, abs(pixelDist));
    
    // Ensure we don't draw the interior
    if (abs(pixelDist) > halfWidth) {
        alpha = 0.0;
    }
    
    // Blue color for outline
    vec3 outlineColor = vec3(1.0, 1.0, 1.0);
    
    // Use premultiplied alpha to avoid light fringe
    gl_FragColor = vec4(outlineColor * alpha, alpha);
}
`;
  }

  _createImageTexture(img) {
    const gl = this.gl;
    if (this.imageTexture) gl.deleteTexture(this.imageTexture);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.imageTexture = tex;
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  _createImageBuffers() {
    const gl = this.gl;

    if (this._imageVBO) gl.deleteBuffer(this._imageVBO);
    if (this._imageIBO) gl.deleteBuffer(this._imageIBO);

    const verts = new Float32Array([
      0.0, this.imgHeight, 0, 0, //left-bottom
      this.imgWidth, this.imgHeight, 1, 0, //left-top
      this.imgWidth, 0.0, 1, 1, //right-bottom
      0.0, 0.0, 0, 1  //right-top
    ]);

    const idx = new Uint16Array([3, 2, 0, 0, 1, 2]);

    this._imageVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._imageVBO);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this._imageIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._imageIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  _createScreenBuffer() {
    const gl = this.gl;

    const screenVertices = new Float32Array([
      // X, Y  (normalized)
      0.0, 0.0,  // bottom-left
      1.0, 0.0,  // bottom-right
      1.0, 1.0,  // top-right
      0.0, 1.0   // top-left
    ]);

    const screenIndices = new Uint16Array([
      0, 1, 2,
      0, 2, 3
    ]);

    // ---- VBO ----
    if (this._screenVBO) gl.deleteBuffer(this._screenVBO);
    this._screenVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._screenVBO);
    gl.bufferData(gl.ARRAY_BUFFER, screenVertices, gl.STATIC_DRAW);

    // ---- EBO (Index Buffer) ----
    if (this._screenIBO) gl.deleteBuffer(this._screenIBO);
    this._screenIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._screenIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, screenIndices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  // _createMaskFbo() {
  //   const gl = this.gl;
  //   if (this._maskTexture) { gl.deleteTexture(this._maskTexture); this._maskTexture = null; }
  //   if (this._maskFBO) { gl.deleteFramebuffer(this._maskFBO); this._maskFBO = null; }

  //   this._maskTexture = gl.createTexture();
  //   gl.bindTexture(gl.TEXTURE_2D, this._maskTexture);
  //   // RGBA8 because webgl1 doesn't expose R8; sample red channel anyway
  //   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  //   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  //   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  //   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  //   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  //   this._maskFBO = gl.createFramebuffer();
  //   gl.bindFramebuffer(gl.FRAMEBUFFER, this._maskFBO);
  //   gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._maskTexture, 0);

  //   const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  //   if (status !== gl.FRAMEBUFFER_COMPLETE) {
  //     console.warn("Mask FBO incomplete:", status);
  //   }
  //   gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // }

  _draw() {
    const gl = this.gl;

    // ensure canvas sized
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // const dpr = window.devicePixelRatio || 1;
    // const cssW = this.canvas.clientWidth;
    // const cssH = this.canvas.clientHeight;
    // if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
    //   this.canvas.width = Math.round(cssW * dpr);
    //   this.canvas.height = Math.round(cssH * dpr);
    // }
    // gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this._drawCompositeToScreen();
    this._renderMaskOutline();
    this._renderMaskHandles();
  }

  _drawCompositeToScreen() {
    const gl = this.gl;

    const w = this.canvas.width / this.zoom;
    const h = this.canvas.height / this.zoom;
    const left = this.camX, right = this.camX + w, bottom = this.camY, top = this.camY + h;
    const proj = ortho(left, right, bottom, top, -1, 1);

    gl.useProgram(this.programComposite);

    gl.uniformMatrix4fv(this.uCompositeProj, false, proj);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    const locImage = gl.getUniformLocation(this.programComposite, 'uImage');
    if (locImage) gl.uniform1i(locImage, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._imageVBO);
    gl.enableVertexAttribArray(this.aCompositePos);
    gl.vertexAttribPointer(this.aCompositePos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.aCompositeTex);
    gl.vertexAttribPointer(this.aCompositeTex, 2, gl.FLOAT, false, 16, 8);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._imageIBO);

    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  _renderMaskOutline() {
    const gl = this.gl;

    const w = this.canvas.width / this.zoom;
    const h = this.canvas.height / this.zoom;
    const left = this.camX, right = this.camX + w, bottom = this.camY, top = this.camY + h;
    const proj = ortho(left, right, bottom, top, -1, 1);

    gl.useProgram(this.programMaskOutline);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.uniformMatrix4fv(this.uMaskOutlineProj, false, proj);
    gl.uniform4f(this.uMaskOutlineBounds, left, right, bottom, top);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._screenVBO);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._screenIBO);
    
    gl.enableVertexAttribArray(this.aMaskOutlinePos);
    gl.vertexAttribPointer(this.aMaskOutlinePos, 2, gl.FLOAT, false, 0, 0);

    const thickness = 3.0 / this.zoom;
    for (let m of this.masks) {
      gl.uniform2f(this.uMaskOutlineCenter, m.center.x, m.center.y);
      gl.uniform1f(this.uMaskOutlineRx, m.rx);
      gl.uniform1f(this.uMaskOutlineRy, m.ry);
      gl.uniform1f(this.uMaskOutlineRotation, m.rotation);
      gl.uniform1f(this.uMaskOutlineThickness, thickness);

      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
    gl.disableVertexAttribArray(this.aMaskOutlinePos);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    gl.disable(gl.BLEND);
  }

  _renderMaskHandles() {
    const gl = this.gl;

    const w = this.canvas.width / this.zoom;
    const h = this.canvas.height / this.zoom;
    const left = this.camX, right = this.camX + w, bottom = this.camY, top = this.camY + h;
    const proj = ortho(left, right, bottom, top, -1, 1);

    gl.useProgram(this.programMaskHandle);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.uniformMatrix4fv(this.uMaskHandleProj, false, proj);
    gl.uniform4f(this.uMaskHandleBounds, left, right, bottom, top);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._screenVBO);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._screenIBO);

    gl.enableVertexAttribArray(this.aMaskHandlePos);
    gl.vertexAttribPointer(this.aMaskHandlePos, 2, gl.FLOAT, false, 0, 0);

    // screenPixelRadius we want (e.g., 5 px). If you store rx as world units, adapt accordingly.
    // To keep radius constant on-screen: convert desired screen px -> world units by dividing by zoom.
    // change as needed or store per-mask
    const radiusWorld = this.HANDLE_RADIUS_PX / this.zoom;
    const innerRadiusWorld = (this.HANDLE_RADIUS_PX - 2.0) / this.zoom;
    const shadowPx = 4;      // 8px soft shadow
    const shadowAlpha = 0.9;   // 35% dark

    // feather in screen pixels (m.feather is screen px). convert to world units:
    const featherWorld = 1.09 / this.zoom;

    // draw each mask: set center/radius/feather per-mask
    for (let m of this.masks) {
      const handles = this.getHandlePositions(m);
      const centerHandle = handles.center;

      if (this.uMaskHandleCenter) gl.uniform2f(this.uMaskHandleCenter, centerHandle.x, centerHandle.y);
      if (this.uMaskHandleRadius) gl.uniform1f(this.uMaskHandleRadius, radiusWorld);
      if (this.uMaskHandleFeather) gl.uniform1f(this.uMaskHandleFeather, featherWorld);
      if (this.uMaskHandleShadowAlpha) gl.uniform1f(this.uMaskHandleShadowAlpha, shadowAlpha);
      if (this.uMaskHandleShadowSize) gl.uniform1f(this.uMaskHandleShadowSize, shadowPx / this.zoom);
      if (this.uMaskHandleInnerRadius) gl.uniform1f(this.uMaskHandleInnerRadius, innerRadiusWorld);
      if (this.uMaskHandleInnerVisible) gl.uniform1i(this.uMaskHandleInnerVisible, 1);

      // draw full-screen quad; fragment shader will only draw circle region
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

      // Draw other handles
      for (let h of [handles.right, handles.left, handles.top, handles.bottom, handles.rotate]) {
        gl.uniform2f(this.uMaskHandleCenter, h.x, h.y);
        gl.uniform1i(this.uMaskHandleInnerVisible, 0);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      }
    }

    gl.disableVertexAttribArray(this.aMaskHandlePos);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    gl.disable(gl.BLEND);
  }

  // delete program utility
  _deleteProgram(prog) {
    const gl = this.gl;
    try { gl.deleteProgram(prog); } catch (e) { }
  }

  // compile + link
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
    return prog;
  }
}

// -------------------------
// small helper: compile shader
// -------------------------
function compileShader(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    alert(gl.getShaderInfoLog(sh));
    console.error('Shader compile error', gl.getShaderInfoLog(sh), source);
    throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
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



