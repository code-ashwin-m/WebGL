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
uniform sampler2D uImage;
`;
    
    let main = `
void main() {
    gl_FragColor = texture2D(uImage, v_Tex);
}
`;
    return header + '\n' + main;
  }
}