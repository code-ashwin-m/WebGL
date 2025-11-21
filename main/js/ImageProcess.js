// ImageProcess.js
// Contains modular shader snippets and a small pipeline builder.

export const ShaderPipeline = {
    // Registry of modules. Each module has:
    // - header: GLSL function definitions (helper funcs + apply function)
    // - apply: code snippet that applies the module to vec3 color using mask value
    // Modules should use standard names: "apply<ModuleName>(vec3 c, ...) -> vec3"

    modules: {
        // maskBlend: provides mask sampling and helper
        maskBlend: {
            header: `
vec3 applyMaskBlend(vec3 c, float mask) {
    // mask left as identity (this module doesn't change color)
    return c;
}
`,
            // apply code inserted into main: no-op but mask variable available
            apply: `// maskBlend is a no-op placeholder. mask available as 'mask' variable\n`
        },

        // exposure: multiplies brightness by 2^stops using mask
        exposure: {
            header: `
uniform float uExposure; // exposure in stops
vec3 applyExposure(vec3 c, float mask) {
    float f = pow(2.0, uExposure * mask);
    return c * f;
}
`,
            apply: `c = applyExposure(c, mask);\n`
        },

        // contrast: simple contrast around 0.5
        contrast: {
            header: `
uniform float uContrast; // scale e.g. 1.0 is neutral, >1 increases contrast
vec3 applyContrast(vec3 c, float mask) {
    vec3 mid = vec3(0.5);
    vec3 adj = (c - mid) * uContrast + mid;
    return mix(c, adj, mask);
}
`,
            apply: `c = applyContrast(c, mask);\n`
        },

        // brightness: add constant
        brightness: {
            header: `
uniform float uBrightness; // -1..1
vec3 applyBrightness(vec3 c, float mask) {
    vec3 adj = c + vec3(uBrightness);
    return mix(c, adj, mask);
}
`,
            apply: `c = applyBrightness(c, mask);\n`
        }
    },

    // Build final fragment shader string from requested module names (ordered)
    buildFragment(moduleNames = ['maskBlend','exposure']) {
        // vertex shader provides v_worldPos and we map to uv using image dims inside shader
        // compose header
        let header = `
precision highp float;
varying vec2 v_worldPos;
uniform sampler2D uImage;
uniform sampler2D uMask;
uniform float uImgW;
uniform float uImgH;
`;

        const used = new Set();
        for (let name of moduleNames) {
            const mod = ShaderPipeline.modules[name];
            if (!mod) {
                console.warn('Unknown module', name);
                continue;
            }
            if (!used.has(name)) {
                header += mod.header + '\n';
                used.add(name);
            }
        }

        // main body: sample image and mask
        // mask value is sampled from uMask (red channel)
        let main = `
void main() {
    vec2 uv = vec2(v_worldPos.x / uImgW, 1.0 - (v_worldPos.y / uImgH));
    //uv = clamp(uv, vec2(0.0), vec2(1.0));
    //vec3 c = texture2D(uImage, uv).rgb;
    //float mask = texture2D(uMask, uv).r;
`;

        // append apply snippets in order
        for (let name of moduleNames) {
            const mod = ShaderPipeline.modules[name];
            if (!mod) continue;
            //main += mod.apply;
        }

        main += `
    //gl_FragColor = vec4(c, 1.0);
    gl_FragColor = texture2D(uImage, uv);
}
`;
        return header + '\n' + main;
    }
};