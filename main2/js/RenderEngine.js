// RenderEngine.js
// Responsible for WebGL setup, FBOs, mask rendering, dynamic pipeline shader building.

import { ShaderPipeline } from './ImageProcess.js';

export class RenderEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl');
    if (!this.gl) throw new Error('WebGL not supported');
    
    // Camera state (kept same names)
    this.camX = 0; this.camY = 0;
    this.zoom = 1;

    // image state
    this.imgWidth = 1; this.imgHeight = 1;
    this.imageTexture = null;
    this.image = null;
    
    // mask FBO
    this.maskFbo = null;
    this.maskTexture = null;
    
    // screen quad buffers
    this._screenVBO = null;
    this._screenIBO = null;
    this._imageVBO = null;
    this._imageIBO = null;
    
    // compiled programs
    this.programImage = null;      // placeholder if needed
    this.programComposite = null;  // assembled pipeline shader
    this.programMaskVis = null;    // for overlay handles/rings
    
    // pipeline definition: array of module names (order matters)
    this.pipelineModules = []; // default order
   
    // build initial shaders for non-assembled parts
    this._buildStaticShaders();
    
    // prepare buffers
    this._createScreenBuffers();
  }
  
  // -------------------------
  // Public API
  // -------------------------
  setCamera(camX, camY, zoom) {
    this.camX = camX; this.camY = camY; this.zoom = zoom;
  }

  setImage(img) {
    this.image = img;
    this.imgWidth = img.width;
    this.imgHeight = img.height;
    this._createImageTexture(img);
    this._createImageBuffers();
    // rebuild composite
    this.buildComposite();
  }
  
  // build composite shader from ImageProcess modules
  buildComposite() {
    // ShaderPipeline helper will return fragment shader source assembled
    const frag = ShaderPipeline.buildFragment(this.pipelineModules);
    
    // Vertex shader is vsMask (maps unit quad to world using uMaskBounds)
    const vert = RenderEngine._vsSource();
        
    // (re)compile composite program
    if (this.programComposite) this._deleteProgram(this.programComposite);
    this.programComposite = this._createProgram(vert, frag);

    // look up composite uniforms/attributes
    const gl = this.gl;
    this.aCompositePos = gl.getAttribLocation(this.programComposite, 'a_Pos');
    this.uCompositeProj = gl.getUniformLocation(this.programComposite, 'u_proj');
    // modules may require named uniforms - pipeline includes them and code will fetch by name
  }

  draw() {
    if (!this.imageTexture) return; // wait until image loaded
    this._draw();
  }
 
  // -------------------------
  // Internal helpers
  // -------------------------
  static _vsSource(){
    return `
attribute vec2 a_Pos;
uniform mat4 u_proj;
uniform vec4 uMaskBounds; // x=left, y=right, z=bottom, w=top
varying vec2 v_worldPos;
varying vec2 v_Tex;

void main() {
    // Map normalized [0..1] a_Pos into world-space using uMaskBounds
    float worldX = uMaskBounds.x + a_Pos.x * (uMaskBounds.y - uMaskBounds.x);
    float worldY = uMaskBounds.z + a_Pos.y * (uMaskBounds.w - uMaskBounds.z);
    v_worldPos = vec2(worldX, worldY);
    
    gl_Position = u_proj * vec4(a_Pos, 0.0, 1.0);
    //v_Tex = a_Tex;
}
`;
  }
  
  static _fsMaskSource(){
     return `
precision mediump float;
varying vec2 vTex;
uniform sampler2D uTex;
void main() {
    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); 
}
`;
  }
  
  _createScreenBuffers() {
    const gl = this.gl;
    // unit quad (0..1)
    const verts = new Float32Array([0,0, 1,0, 1,1, 0,1]);
    const idx = new Uint16Array([0,1,2, 0,2,3]);

    this._screenVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._screenVBO);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this._screenIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._screenIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    // unbind
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  _createImageBuffers(){
    // builds vertex/index buffers for image quad in world units
    const gl = this.gl;
    if (this._imageVBO) gl.deleteBuffer(this._imageVBO);
    if (this._imageIBO) gl.deleteBuffer(this._imageIBO);

    const verts = new Float32Array([
      0, this.imgHeight, 0, 0,
      this.imgWidth, this.imgHeight, 1, 0,
      this.imgWidth, 0, 1, 1,
      0, 0, 0, 1
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
  
  _createMaskFbo() {
    const gl = this.gl;
    if (this.maskTexture) gl.deleteTexture(this.maskTexture);
    if (this.maskFbo) gl.deleteFramebuffer(this.maskFbo);

    this.maskTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.maskFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.maskTexture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.warn('Mask FBO incomplete', status);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  
  _draw() {
    const gl = this.gl;
    
    // ensure canvas sized
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    gl.viewport(0,0,this.canvas.width,this.canvas.height);

    // 2) composite image + mask -> screen via compiled pipeline
    this._drawCompositeToScreen();
    
    // 3) overlay handles (on top)
    //this._drawOverlayHandles();
  }
  
  _drawCompositeToScreen(){
    const gl = this.gl;
    
    // projection mapping
    const w = this.canvas.width / this.zoom;
    const h = this.canvas.height / this.zoom;
    const left = this.camX, right = this.camX + w, bottom = this.camY, top = this.camY + h;
    const proj = ortho(left,right,bottom,top,-1,1);

    gl.useProgram(this.programComposite);
    
    // uniforms common names
    const uProj = this.uCompositeProj || gl.getUniformLocation(this.programComposite,'u_proj');
    const uBounds = this.uCompositeBounds || gl.getUniformLocation(this.programComposite,'uMaskBounds');

    gl.uniformMatrix4fv(uProj, false, proj);
    gl.uniform4f(uBounds, left, right, bottom, top);

    gl.clearColor(0, 1, 0, 0.5);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // bind image -> unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    const locImage = gl.getUniformLocation(this.programComposite,'uImage');
    if (locImage) gl.uniform1i(locImage, 0);
    
    // provide image dims if shader uses it
    const locImgW = gl.getUniformLocation(this.programComposite,'uImgW');
    const locImgH = gl.getUniformLocation(this.programComposite,'uImgH');
    if (locImgW) gl.uniform1f(locImgW, this.imgWidth);
    if (locImgH) gl.uniform1f(locImgH, this.imgHeight);

        
    
    // map unit quad to world
    gl.bindBuffer(gl.ARRAY_BUFFER, this._imageVBO);
    const aPos = gl.getAttribLocation(this.programComposite,'a_Pos');
    const aTex = gl.getAttribLocation(this.programComposite,"a_Tex");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 16, 8);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._imageIBO);

    // draw
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    // cleanup textures
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
  }
  
  _drawOverlayHandles() {
    const gl = this.gl;
    // render mask rings and handles like before using programMaskVis
    const w = this.canvas.width / this.zoom;
    const h = this.canvas.height / this.zoom;
    const left = this.camX, right = this.camX + w, bottom = this.camY, top = this.camY + h;
    const proj = ortho(left,right,bottom,top,-1,1);

    gl.useProgram(this.programMaskVis);

    // uniforms
    const uProj = gl.getUniformLocation(this.programMaskVis,'u_proj');
    
    gl.uniformMatrix4fv(uProj, false, proj);
    
    // NEW: provide bounds so the unit quad maps to the current world view
    //gl.uniform4f(uMaskBounds, left, right, bottom, top);
  
    
    gl.clearColor(1.0, 0, 0, 0.5);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this._screenVBO);
    const aPos = gl.getAttribLocation(this.programMaskVis,'a_Pos');
    //const aTex = gl.getAttribLocation(this.programMaskVis,"a_Tex");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    //gl.enableVertexAttribArray(aTex);
    //gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 16, 8);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._screenIBO);

    // draw
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  _buildStaticShaders() {
    // fsMaskSource used for overlays (kept similar to your original overlay shader)
    const vs = RenderEngine._vsSource();
    const fsMask = RenderEngine._fsMaskSource();
    this.programMaskVis = this._createProgram(vs, fsMask);
    
    // composite will be built dynamically via buildComposite()
    this.buildComposite();
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

// -------------------------
// ortho helper (same as your original)
// -------------------------
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

