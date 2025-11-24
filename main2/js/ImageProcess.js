// ImageProcess.js
// Contains modular shader snippets and a small pipeline builder.

export const ShaderPipeline = {
  // Registry of modules. Each module has:
  // - header: GLSL function definitions (helper funcs + apply function)
  // - apply: code snippet that applies the module to vec3 color using mask value
  // Modules should use standard names: "apply<ModuleName>(vec3 c, ...) -> vec3"

  modules: {
      
  },
  
  // Build final fragment shader string from requested module names (ordered)
  buildFragment(moduleNames = []) {
    let header = `
precision mediump float;
varying vec2 v_Tex;
varying vec2 v_worldPos;
uniform sampler2D uImage;
uniform float uImgW;
uniform float uImgH;
`;
    
    let main = `
void main() {
    vec2 uv = vec2(v_worldPos.x / uImgW, 1.0 - (v_worldPos.y / uImgH));
    uv = clamp(uv, vec2(0.0), vec2(1.0));
    gl_FragColor = texture2D(uImage, uv);
}
`;
    return header + '\n' + main;
  }
}