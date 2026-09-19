/**
 * Physically based black-body colour.
 *
 * Planck's law is integrated against the CIE 1931 colour-matching functions
 * (Wyman, Sloan & Shirley's multi-lobe Gaussian fits, JCGT 2013) to get XYZ,
 * which is then converted to linear sRGB. The result is normalised to unit
 * luminance so that brightness can be applied separately as the
 * Stefan-Boltzmann T^4 - that keeps the renderer's Doppler boost honest,
 * because shifting a black body to T' = g*T and scaling its intensity by
 * g^4 are then the same operation.
 */
import { H_PLANCK, C, K_B } from './units.js';

/** Spectral radiance of a black body, W / (m^2 sr m). */
export function planck(lambdaMetres, T) {
  const l5 = lambdaMetres ** 5;
  const e = (H_PLANCK * C) / (lambdaMetres * K_B * T);
  // exp can overflow for cold bodies at short wavelengths; that limit is 0.
  if (e > 700) return 0;
  return (2 * H_PLANCK * C * C) / (l5 * (Math.exp(e) - 1));
}

/** Wien displacement law: peak wavelength in metres. */
export const wienPeak = (T) => 2.897771955e-3 / T;

/** Piecewise Gaussian used by the colour-matching fits. */
const pg = (x, mu, s1, s2) => {
  const t = (x - mu) * (x < mu ? 1 / s1 : 1 / s2);
  return Math.exp(-0.5 * t * t);
};

/** CIE 1931 2-degree observer, analytic fit. `l` is in nanometres. */
export const cieX = (l) =>
  1.056 * pg(l, 599.8, 37.9, 31.0) + 0.362 * pg(l, 442.0, 16.0, 26.7)
  - 0.065 * pg(l, 501.1, 20.4, 26.2);
export const cieY = (l) =>
  0.821 * pg(l, 568.8, 46.9, 40.5) + 0.286 * pg(l, 530.9, 16.3, 31.1);
export const cieZ = (l) =>
  1.217 * pg(l, 437.0, 11.8, 36.0) + 0.681 * pg(l, 459.0, 26.0, 13.8);

/** Chromaticity + relative luminance of a black body, as CIE XYZ (Y = 1). */
export function blackbodyXYZ(T) {
  let X = 0, Y = 0, Z = 0;
  const lo = 360, hi = 830, step = 2;
  for (let l = lo; l <= hi; l += step) {
    const s = planck(l * 1e-9, T) * step;
    X += s * cieX(l);
    Y += s * cieY(l);
    Z += s * cieZ(l);
  }
  if (Y <= 0) return [0, 0, 0];
  return [X / Y, 1, Z / Y];
}

/** CIE XYZ -> linear sRGB (Rec.709 primaries, D65 white). */
export function xyzToLinearSrgb([X, Y, Z]) {
  return [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
}

/**
 * Linear sRGB of a black body at temperature T, normalised to unit
 * luminance. Colours outside the sRGB gamut (every black body is, a little)
 * are pulled back by desaturating towards white rather than clipping, which
 * keeps the hue instead of turning deep reds into flat red.
 */
export function blackbodyRGB(T) {
  const rgb = xyzToLinearSrgb(blackbodyXYZ(Math.max(T, 1)));
  const min = Math.min(rgb[0], rgb[1], rgb[2]);
  if (min < 0) for (let i = 0; i < 3; i++) rgb[i] -= min;
  // Renormalise so the Rec.709 luminance is exactly 1.
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  if (lum > 0) for (let i = 0; i < 3; i++) rgb[i] /= lum;
  return rgb;
}

/** sRGB hex string for UI swatches (tone-mapped to max component = 1). */
export function blackbodyCss(T) {
  const rgb = blackbodyRGB(T);
  const m = Math.max(rgb[0], rgb[1], rgb[2], 1e-6);
  const enc = (v) => {
    const c = Math.min(1, Math.max(0, v / m));
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, '0');
  };
  return `#${enc(rgb[0])}${enc(rgb[1])}${enc(rgb[2])}`;
}

/**
 * Build the lookup table the fragment shader samples. Temperature is indexed
 * logarithmically so that the cool end, where colour changes fastest, gets
 * the resolution it needs.
 */
export function buildBlackbodyLut(size = 512, tMin = 500, tMax = 120000) {
  const data = new Float32Array(size * 4);
  const logMin = Math.log(tMin);
  const logMax = Math.log(tMax);
  for (let i = 0; i < size; i++) {
    const T = Math.exp(logMin + ((logMax - logMin) * (i + 0.5)) / size);
    const [r, g, b] = blackbodyRGB(T);
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 1;
  }
  return { data, size, logMin, logMax, tMin, tMax };
}
