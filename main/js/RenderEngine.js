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

        // masks (array of mask objects) provided by UI
        this.masks = [];

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
        this.programMaskVis = null;    // for overlay handles/rings
        this.programMaskGen = null;    // for mask generation into FBO
        this.programComposite = null;  // assembled pipeline shader

        // pipeline definition: array of module names (order matters)
        this.pipelineModules = ['maskBlend','exposure']; // default order

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

    setImage(imgElement) {
        this.image = imgElement;
        this.imgWidth = imgElement.width;
        this.imgHeight = imgElement.height;
        this._createImageTexture(imgElement);
        this._createImageBuffers();
        this._createMaskFbo(); // recreate mask FBO size
        // rebuild composite (uses uImgW/uImgH)
        this.buildComposite();
    }

    setMasks(masksArray) {
        this.masks = masksArray;
    }

    setPipelineModules(modulesArray) {
        this.pipelineModules = modulesArray.slice();
        this.buildComposite();
    }

    // build composite shader from ImageProcess modules
    buildComposite() {
        // ShaderPipeline helper will return fragment shader source assembled
        const frag = ShaderPipeline.buildFragment(this.pipelineModules);
        // Vertex shader is vsMask (maps unit quad to world using uMaskBounds)
        const vert = RenderEngine._vsMaskSource();
        // (re)compile composite program
        if (this.programComposite) this._deleteProgram(this.programComposite);
        this.programComposite = this._createProgram(vert, frag);

        // look up composite uniforms/attributes
        const gl = this.gl;
        this.aCompositePos = gl.getAttribLocation(this.programComposite, 'a_Pos');
        this.uCompositeProj = gl.getUniformLocation(this.programComposite, 'u_proj');
        this.uCompositeBounds = gl.getUniformLocation(this.programComposite, 'uMaskBounds');
        this.uCompositeImage = gl.getUniformLocation(this.programComposite, 'uImage');
        this.uCompositeMask = gl.getUniformLocation(this.programComposite, 'uMask');
        // modules may require named uniforms - pipeline includes them and code will fetch by name inside drawComposite
    }

    // Draw frame (public)
    draw() {
        if (!this.imageTexture) return; // wait until image loaded
        this._draw();
    }

    // -------------------------
    // Internal helpers
    // -------------------------
    static _vsMaskSource(){
        return `
attribute vec2 a_Pos;
uniform mat4 u_proj;
uniform vec4 uMaskBounds;
varying vec2 v_worldPos;
void main() {
  float worldX = uMaskBounds.x + a_Pos.x * (uMaskBounds.y - uMaskBounds.x);
  float worldY = uMaskBounds.z + a_Pos.y * (uMaskBounds.w - uMaskBounds.z);
  v_worldPos = vec2(worldX, worldY);
  gl_Position = u_proj * vec4(v_worldPos, 0.0, 1.0);
}
`;
    }

    _buildStaticShaders() {
        // fsMaskSource used for overlays (kept similar to your original overlay shader)
        const vs = RenderEngine._vsMaskSource();
        const fsMask = RenderEngine._fsMaskSource();
        this.programMaskVis = this._createProgram(vs, fsMask);

        // mask generation (writes mask alpha to red channel) - simple version
        const fsMaskGen = RenderEngine._fsMaskGenSource();
        this.programMaskGen = this._createProgram(vs, fsMaskGen);

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

    _createImageBuffers() {
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

    _createImageTexture(image) {
        const gl = this.gl;
        if (this.imageTexture) gl.deleteTexture(this.imageTexture);
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
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

    // render mask shapes into maskTexture (red channel stores mask alpha)
    _renderMasksToTexture() {
        const gl = this.gl;
        if (!this.maskFbo) return;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFbo);
        gl.viewport(0,0,this.canvas.width,this.canvas.height);
        gl.clearColor(0,0,0,0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // projection mapping
        const w = this.canvas.width / this.zoom;
        const h = this.canvas.height / this.zoom;
        const left = this.camX, right = this.camX + w, bottom = this.camY, top = this.camY + h;
        const proj = ortho(left,right,bottom,top,-1,1);

        gl.useProgram(this.programMaskGen);
        // uniforms
        const uProj = gl.getUniformLocation(this.programMaskGen, 'u_proj');
        const uBounds = gl.getUniformLocation(this.programMaskGen, 'uMaskBounds');
        const uCenter = gl.getUniformLocation(this.programMaskGen, 'uCenter');
        const uRx = gl.getUniformLocation(this.programMaskGen, 'uRx');
        const uRy = gl.getUniformLocation(this.programMaskGen, 'uRy');
        const uRot = gl.getUniformLocation(this.programMaskGen, 'uRotation');
        const uFeatherPx = gl.getUniformLocation(this.programMaskGen, 'uFeatherPx');
        const uPixelSize = gl.getUniformLocation(this.programMaskGen, 'uPixelSize');

        gl.uniformMatrix4fv(uProj, false, proj);
        gl.uniform4f(uBounds, left, right, bottom, top);

        // prepare unit quad
        gl.bindBuffer(gl.ARRAY_BUFFER, this._screenVBO);
        const aPos = gl.getAttribLocation(this.programMaskGen, 'a_Pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._screenIBO);

        // additive blending in case multiple masks overlap
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        for (let m of this.masks) {
            // Only generate mask if it has exposure/other local effect or is selected (you can adjust)
            // here we render for all masks to support stacking; change logic if desired
            gl.uniform2f(uCenter, m.center.x, m.center.y);
            gl.uniform1f(uRx, m.rx);
            gl.uniform1f(uRy, m.ry);
            gl.uniform1f(uRot, m.rotation || 0.0);
            gl.uniform1f(uFeatherPx, m.feather || 30.0);
            gl.uniform1f(uPixelSize, 1.0 / this.zoom);

            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        }

        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _drawCompositeToScreen() {
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

        // bind image -> unit 0
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
        const locImage = gl.getUniformLocation(this.programComposite,'uImage');
        if (locImage) gl.uniform1i(locImage, 0);

        // bind mask -> unit 1
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
        const locMask = gl.getUniformLocation(this.programComposite,'uMask');
        if (locMask) gl.uniform1i(locMask, 1);

        // provide image dims if shader uses it
        const locImgW = gl.getUniformLocation(this.programComposite,'uImgW');
        const locImgH = gl.getUniformLocation(this.programComposite,'uImgH');
        if (locImgW) gl.uniform1f(locImgW, this.imgWidth);
        if (locImgH) gl.uniform1f(locImgH, this.imgHeight);

        // map unit quad to world
        gl.bindBuffer(gl.ARRAY_BUFFER, this._screenVBO);
        const aPos = gl.getAttribLocation(this.programComposite,'a_Pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._screenIBO);

        // draw
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

        // cleanup textures
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
        //gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
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
        const uBounds = gl.getUniformLocation(this.programMaskVis,'uMaskBounds');
        const uCenter = gl.getUniformLocation(this.programMaskVis,'uCenter');
        const uRx = gl.getUniformLocation(this.programMaskVis,'uRx');
        const uRy = gl.getUniformLocation(this.programMaskVis,'uRy');
        const uRot = gl.getUniformLocation(this.programMaskVis,'uRotation');
        const uThicknessPx = gl.getUniformLocation(this.programMaskVis,'uThicknessPx');
        const uFeatherPx = gl.getUniformLocation(this.programMaskVis,'uFeatherPx');
        const uOutlinePx = gl.getUniformLocation(this.programMaskVis,'uOutlinePx');
        const uPixelSize = gl.getUniformLocation(this.programMaskVis,'uPixelSize');

        gl.uniformMatrix4fv(uProj, false, proj);
        gl.uniform4f(uBounds, left, right, bottom, top);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._screenVBO);
        const aPos = gl.getAttribLocation(this.programMaskVis,'a_Pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._screenIBO);

        for (let m of this.masks) {
            const handles = this._getEllipseHandlePositions(m);
            const centerHandle = handles.center;
          
            gl.uniform2f(uCenter, centerHandle.x, centerHandle.y);
            const rad = (10 * 0.5) / this.zoom;
            const thick = (10 * 0.6) / this.zoom;
            gl.uniform1f(uRx, rad); gl.uniform1f(uRy, rad);
            gl.uniform1f(uThicknessPx, thick);
            gl.uniform1f(uFeatherPx, 0.7);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
          
            // draw handles if selected+outline - small circles (reuse same shader)
            if (m.selected && m.outline) {
                gl.uniform2f(uCenter, m.center.x, m.center.y);
                gl.uniform1f(uRx, m.rx);
                gl.uniform1f(uRy, m.ry);
                gl.uniform1f(uRot, m.rotation || 0.0);
                gl.uniform1f(uThicknessPx, 1.0 / this.zoom);
                gl.uniform1f(uFeatherPx, 0.2);
                gl.uniform1f(uOutlinePx, 1.0);
                gl.uniform1f(uPixelSize, 1.0 / this.zoom);

                gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
            
                // renderHandleCircle
                for (let h of [handles.right, handles.left, handles.top, handles.bottom, handles.rotate]) {
                    gl.uniform2f(uCenter, h.x, h.y);
                    const rad = (10 * 0.5) / this.zoom;
                    const thick = (10 * 0.6) / this.zoom;
                    gl.uniform1f(uRx, rad); gl.uniform1f(uRy, rad);
                    gl.uniform1f(uThicknessPx, thick);
                    gl.uniform1f(uFeatherPx, 0.7);
                    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
                }
            }
        }
    }

    _getEllipseHandlePositions(mask) {
        const c = Math.cos(mask.rotation || 0);
        const s = Math.sin(mask.rotation || 0);
        const rot = (x,y) => ({ x: mask.center.x + (x*c - y*s), y: mask.center.y + (x*s + y*c) });
        const pixel = 1.0 / this.zoom;
        return {
            center: rot(0,0),
            right: rot(mask.rx,0),
            left: rot(-mask.rx,0),
            top: rot(0,mask.ry),
            bottom: rot(0,-mask.ry),
            rotate: rot(0, -(mask.ry + 40 * pixel))
        };
    }

    _draw() {
        const gl = this.gl;
        // ensure canvas sized
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
        gl.viewport(0,0,this.canvas.width,this.canvas.height);

        // 1) render masks into maskTexture
        this._renderMasksToTexture();

        // 2) composite image + mask -> screen via compiled pipeline
        this._drawCompositeToScreen();

        // 3) overlay handles (on top)
        this._drawOverlayHandles();
    }

    // -------------------------
    // Static shader sources (small and kept similar to your originals)
    // -------------------------
    static _fsMaskSource(){
        return `
precision mediump float;
uniform vec2 uCenter;
uniform float uRx;
uniform float uRy;
uniform float uRotation;
uniform float uThicknessPx;
uniform float uFeatherPx;
uniform float uOutlinePx;
uniform float uPixelSize;
varying vec2 v_worldPos;

float ellipseDist(vec2 p, vec2 center, float rx, float ry, float rotation) {
    vec2 d = p - center;
    float c = cos(rotation);
    float s = sin(rotation);
    vec2 r = vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
    return length(vec2(r.x / rx, r.y / ry));
}

void main() {
    float d = ellipseDist(v_worldPos, uCenter, uRx, uRy, uRotation);
    float normThickness = uThicknessPx / min(uRx, uRy);
    float normFeather = uFeatherPx / min(uRx, uRy);
    float inner = 1.0 - normThickness;
    float outer = 1.0 + normThickness;
    float whiteRing = smoothstep(inner - normFeather, inner + normFeather, d) * (1.0 - smoothstep(outer - normFeather, outer + normFeather, d));
    float outlineInner = outer;
    float outlineOuter = outer + (uOutlinePx * uPixelSize) / min(uRx, uRy);
    float blackRing = smoothstep(outlineInner - normFeather, outlineInner + normFeather, d) * (1.0 - smoothstep(outlineOuter - normFeather, outlineOuter + normFeather, d));
    float finalAlpha = max(whiteRing, blackRing);
    if (finalAlpha < 0.01) discard;
    vec3 color = (blackRing > whiteRing) ? vec3(0.0) : vec3(1.0);
    gl_FragColor = vec4(color, finalAlpha);
}
`;
    }

    static _fsMaskGenSource(){
        // writes mask alpha to red channel
        return `
precision highp float;
uniform vec2 uCenter;
uniform float uRx;
uniform float uRy;
uniform float uRotation;
uniform float uFeatherPx;
uniform float uPixelSize;
varying vec2 v_worldPos;

float ellipseDist(vec2 p, vec2 center, float rx, float ry, float rotation) {
    vec2 d = p - center;
    float c = cos(rotation);
    float s = sin(rotation);
    vec2 r = vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
    return length(vec2(r.x / rx, r.y / ry));
}

void main() {
    float d = ellipseDist(v_worldPos, uCenter, uRx, uRy, uRotation);
    float normFeather = (uFeatherPx * uPixelSize) / min(uRx, uRy);
    float inner = 1.0 - normFeather;
    float mask;
    if (d < inner) mask = 1.0;
    else if (d > 1.0) mask = 0.0;
    else mask = smoothstep(1.0, inner, d);
    gl_FragColor = vec4(mask,0.0,0.0,1.0);
}
`;
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