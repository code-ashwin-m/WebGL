import { ShaderPipeline } from './ImageProcess.js';

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
    
    this.effectGlobal = {
      exposure: 0.0,
      contrast: 0.0
    }
  }
  
  updateEffect(key, value){
    //TODO Check if mask selected
    this.effectGlobal[key] = value;
    //alert(this.effectGlobal[key]);
    this._draw();
  }

  setCamera(camX, camY, zoom) {
    const dpr = 1; //window.devicePixelRatio || 1;
    this.camX = camX*dpr; this.camY = camY*dpr; this.zoom = zoom;
  }
  
  setImage(img) {
    this.image = img;
    this.imgWidth = img.width;
    this.imgHeight = img.height;
    this._createImageTexture(img);
    this._createImageBuffers();
    this.buildComposite();
  }

  buildComposite() {
    const frag = ShaderPipeline.buildFragment();
    console.log(frag);
    
    const vert = RenderEngine._vsSource();
    //const frag = RenderEngine._fsSource();
    
    if (this.programComposite) this._deleteProgram(this.programComposite);
    this.programComposite = this._createProgram(vert, frag);
    
    const gl = this.gl;
    this.aCompositePos = gl.getAttribLocation(this.programComposite, 'aPos');
    this.aCompositeTex = gl.getAttribLocation(this.programComposite, 'aTex');
    this.uCompositeProj = gl.getUniformLocation(this.programComposite, 'uProj');
    
    this.uExposure = gl.getUniformLocation(this.programComposite, 'uExposure');
    this.uContrast = gl.getUniformLocation(this.programComposite, 'uContrast');
  }

  draw(){
    if (!this.imageTexture) return;
    this._draw();
  }
  
  async export(){
    if (!this.imageTexture) return;
    return this._export();
  }

  static _vsSource(){
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

  static _fsSource(){
    return `
precision highp float;
varying vec2 vTex;
uniform sampler2D uImage;
uniform float uExposure; // EV

// sRGB ↔ linear helpers
vec3 srgbToLinear(vec3 c) {
    return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
    return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
}

// Pixlr-like highlight rolloff
vec3 softKnee(vec3 x) {
    // knee starts at 0.85 — similar to Pixlr/Adobe JPEG pipeline
    const float kneeStart = 0.85;
    const float kneeEnd   = 1.25;

    vec3 y = x;

    for (int i=0;i<3;i++){
        float v = x[i];

        if (v > kneeStart) {
            float t = (v - kneeStart) / (kneeEnd - kneeStart);
            t = clamp(t, 0.0, 1.0);

            // smooth compression
            float c = mix(v, kneeStart + (1.0 - exp(-(v - kneeStart))), t);

            y[i] = c;
        }
    }
    return clamp(y, 0.0, 1.0);
}

vec3 applyExposure(vec3 srgb){
    // 1. convert to linear
    vec3 lin = srgbToLinear(srgb);
    // 2. exposure in linear space
    float f = exp2(uExposure);
    lin *= f;
    // 3. soft highlight compression
    lin = softKnee(lin);
    // 4. convert back to sRGB
    vec3 outRGB = linearToSrgb(lin);
    return outRGB;
}

void main() {
    vec3 srgb = texture2D(uImage, vTex).rgb;
    vec3 outRGB = applyExposure(srgb);
    gl_FragColor = vec4(outRGB, 1.0);
}
`;
  }

  _createImageTexture(img){
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
      0.0,           this.imgHeight, 0, 0, //left-bottom
      this.imgWidth, this.imgHeight, 1, 0, //left-top
      this.imgWidth, 0.0,            1, 1, //right-bottom
      0.0,           0.0,            0, 1  //right-top
    ]);
    
    const idx = new Uint16Array([3,2,0, 0,1,2]);
    
    this._imageVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._imageVBO);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this._imageIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._imageIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  _draw(){
    const gl = this.gl;
    
    const dpr = 1; //window.devicePixelRatio || 1;
    
    // ensure canvas sized
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    
    this._drawCompositeToScreen();
  }

  _drawCompositeToScreen(){
    const gl = this.gl;
    
    const w = this.canvas.width / this.zoom;
    const h = this.canvas.height / this.zoom;
    const left = this.camX, right = this.camX + w, bottom = this.camY, top = this.camY + h;
    const proj = ortho(left,right,bottom,top,-1,1);

    gl.useProgram(this.programComposite);
    
    gl.uniform1f(this.uExposure, this.effectGlobal.exposure);
    gl.uniform1f(this.uContrast, this.effectGlobal.contrast);
    
    gl.uniformMatrix4fv(this.uCompositeProj, false, proj);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    const locImage = gl.getUniformLocation(this.programComposite,'uImage');
    if (locImage) gl.uniform1i(locImage, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this._imageVBO);
    gl.enableVertexAttribArray(this.aCompositePos);                                         // 17
    gl.vertexAttribPointer(this.aCompositePos, 2, gl.FLOAT, false, 16, 0);                   // 18
    gl.enableVertexAttribArray(this.aCompositeTex);
    gl.vertexAttribPointer(this.aCompositeTex, 2, gl.FLOAT, false, 16, 8);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._imageIBO);
    
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    
    gl.activeTexture(gl.TEXTURE0); 
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  
  // delete program utility
  _deleteProgram(prog) {
    const gl = this.gl;
    try { gl.deleteProgram(prog); } catch(e) {}
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
  
  _export() {
    const gl = this.gl;

    const exportWidth = this.imgWidth;
    const exportHeight = this.imgHeight;

    // 1. Create texture for render target
    const exportTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, exportTex);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        exportWidth,
        exportHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
    // 2. Create framebuffer
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        exportTex,
        0
    );

    // 3. Setup viewport for export resolution
    gl.viewport(0, 0, exportWidth, exportHeight);

    // 4. Use your program
    gl.useProgram(this.programComposite);

    // 5. Upload effects
    gl.uniform1f(this.uExposure, this.effectGlobal.exposure);
    gl.uniform1f(this.uContrast, this.effectGlobal.contrast);

    // 6. Projection to map 0..width and 0..height
    const proj = ortho(0, exportWidth, 0, exportHeight, -1, 1);
    gl.uniformMatrix4fv(this.uCompositeProj, false, proj);

    // 7. Bind original texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    gl.uniform1i(gl.getUniformLocation(this.programComposite, "uImage"), 0);

    // 8. Bind VBO + IBO
    gl.bindBuffer(gl.ARRAY_BUFFER, this._imageVBO);
    gl.enableVertexAttribArray(this.aCompositePos);
    gl.vertexAttribPointer(this.aCompositePos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.aCompositeTex);
    gl.vertexAttribPointer(this.aCompositeTex, 2, gl.FLOAT, false, 16, 8);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._imageIBO);

    // 9. Draw onto FBO
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    // 10. Read pixels
    const pixels = new Uint8Array(exportWidth * exportHeight * 4);
    gl.readPixels(
        0, 0,
        exportWidth, exportHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels
    );

    // Cleanup FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(exportTex);

    // 11. Convert to PNG using 2D canvas
    const canvas = document.createElement("canvas");
    canvas.width = exportWidth;
    canvas.height = exportHeight;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(exportWidth, exportHeight);

    // Flip Y since WebGL buffer is upside down
    for (let y = 0; y < exportHeight; y++) {
        const srcStart = y * exportWidth * 4;
        const destStart = (exportHeight - y - 1) * exportWidth * 4;
        imgData.data.set(pixels.subarray(srcStart, srcStart + exportWidth * 4), destStart);
    }

    ctx.putImageData(imgData, 0, 0);

    return new Promise(resolve => {
        canvas.toBlob(blob => resolve(blob), "image/png");
    });
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
    2/(right-left), 0, 0, 0,
    0, 2/(top-bottom), 0, 0,
    0, 0, -2/(far-near), 0,
    -(right+left)/(right-left),
    -(top+bottom)/(top-bottom),
    -(far+near)/(far-near),
    1
  ]);
}



