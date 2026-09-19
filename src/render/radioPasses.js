/**
 * Post-processing for the radio-interferometry view.
 *
 * A very long baseline array does not resolve detail finer than its beam, so
 * a faithful reconstruction of what the Event Horizon Telescope published has
 * to be convolved down to that beam. The blur is applied to the *intensity*,
 * before the false-colour map, which is the order the real pipeline uses -
 * blurring the coloured image instead would mix hues that never existed.
 */

/** Separable Gaussian. Wide beams are covered by striding the taps. */
export const BeamBlurShader = {
  name: 'BeamBlurShader',
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: null },   // (1/width, 0) or (0, 1/height)
    uSigma: { value: 0 },      // in pixels
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uSigma;
    varying vec2 vUv;

    void main() {
      if (uSigma < 0.35) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      // 41 taps spaced a sixth of a sigma apart reach +-3.3 sigma however
      // wide the beam is, which a fixed one-pixel spacing could not. Coarser
      // striding than this leaves visible banding where the gradient is steep.
      float step = max(1.0, uSigma / 6.0);
      float inv = -0.5 / (uSigma * uSigma);
      vec4 sum = vec4(0.0);
      float total = 0.0;
      for (int i = -20; i <= 20; i++) {
        float d = float(i) * step;
        float w = exp(d * d * inv);
        sum += texture2D(tDiffuse, vUv + uTexel * d) * w;
        total += w;
      }
      gl_FragColor = sum / total;
    }
  `,
};

/**
 * Maps scalar intensity through the colour ramp radio images are shown with
 * (matplotlib's afmhot, close to the EHT's own presentation), then undoes the
 * sRGB encode so the output pass can put it back: a false-colour map is a
 * display transform, not a spectrum, and must not be tone-mapped.
 */
export const RadioColourShader = {
  name: 'RadioColourShader',
  uniforms: {
    tDiffuse: { value: null },
    uGamma: { value: 1.0 },
  },
  vertexShader: BeamBlurShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uGamma;
    varying vec2 vUv;

    void main() {
      float x = clamp(pow(max(texture2D(tDiffuse, vUv).r, 0.0), uGamma), 0.0, 1.0);
      vec3 srgb = vec3(
        clamp(2.0 * x, 0.0, 1.0),
        clamp((x - 0.25) * 2.0, 0.0, 1.0),
        clamp((x - 0.5) * 2.0, 0.0, 1.0));
      gl_FragColor = vec4(pow(srgb, vec3(2.2)), 1.0);
    }
  `,
};
