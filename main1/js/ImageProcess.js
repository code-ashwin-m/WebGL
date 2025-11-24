export const ShaderPipeline = {
  modules: {
    exposure: {
      header: `
uniform float uExposure;
vec3 expSoftKnee(vec3 x) {
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
    vec3 lin = srgbToLinear(srgb);
    float f = exp2(uExposure);
    lin *= f;
    lin = expSoftKnee(lin);
    vec3 outRGB = linearToSrgb(lin);
    return outRGB;
}`,
      apply: `c = applyExposure(c);`
    },
    contrast: {
      header: `
uniform float uContrast;
vec3 applyContrast(vec3 srgb){
  vec3 c = srgbToLinear(srgb);
  float oldY = luminance(c);
  float newY = applyLCurve(oldY, uContrast);
  vec3 outColor = preserveColor(c, oldY, newY);
  outColor = clamp(outColor, 0.0, 1.0);
  outColor = linearToSrgb(outColor);
  return outColor;
}
      `,
      apply: `c = applyContrast(c);`,
    }
  },
  
  buildFragment() {
    let header = `
precision highp float;
varying vec2 vTex;
uniform sampler2D uImage;
vec3 srgbToLinear(vec3 c) {
    return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
    return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
}
float luminance(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
float applyLCurve(float y, float amount) {
    // Amount = [-1, +1], convert to curve strength
    float k = amount * 1.25;       // Lightroom-like sensitivity

    // Sigmoid pivot around mid-tone 0.5
    float x = y - 0.5;

    // Smooth S-curve (Lightroom style behaviour)
    float s = x * (1.0 + k * (1.0 - abs(x) * 2.0));

    return clamp(s + 0.5, 0.0, 1.0);
}
vec3 preserveColor(vec3 lin, float oldY, float newY) {
    float scale = (oldY > 0.0) ? newY / oldY : 0.0;
    return lin * scale;
}
`;
    
    for (const key in ShaderPipeline.modules) {
      header += ShaderPipeline.modules[key].header + '\n';
    }

    let main = `void main() {
vec3 c = texture2D(uImage, vTex).rgb;
`;
    
    for (const key in ShaderPipeline.modules) {
      main += ShaderPipeline.modules[key].apply + '\n';
    }
    
    main += `gl_FragColor = vec4(c, 1.0);
}`;
    
    return header + '\n' + main;
  }
}