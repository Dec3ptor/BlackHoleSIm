/**
 * Fragment shader that renders a Schwarzschild black hole by integrating null
 * geodesics backwards from the camera, one per pixel.
 *
 * The integrator is the GPU twin of `tracePhoton` in src/core/geodesics.js,
 * which the test suite pins against the closed-form deflection angle, the
 * critical impact parameter and the photon sphere. Read that file first - the
 * comments there explain the maths, this one explains the pixels.
 */

export const MAX_BODIES = 4;

export const vertexShader = /* glsl */ `
void main() {
  // A full-screen quad; the fragment shader works entirely from gl_FragCoord.
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const fragmentShader = /* glsl */ `
precision highp float;

out vec4 outColor;

#define PI 3.141592653589793
#define MAX_STEPS 900
#define MAX_BODIES ${MAX_BODIES}

uniform vec2  uResolution;
uniform vec3  uCamPos;        // observer position, in gravitational radii
uniform vec3  uRight;
uniform vec3  uUp;
uniform vec3  uForward;
uniform float uTanHalfFov;
uniform float uSimTime;       // in r_g / c
uniform int   uSteps;
uniform float uStepScale;
uniform float uGR;            // 1 = curved spacetime, 0 = flat (comparison)
uniform float uEscapeRadius;

uniform float uDiscEnabled;
uniform float uDiscInner;
uniform float uDiscOuter;
uniform float uDiscOpacity;
uniform float uDiscTemp;      // peak effective temperature, kelvin
uniform float uDiscSpin;      // +1 prograde, -1 retrograde
uniform float uDiscTurbulence;
uniform float uDiscBrightness;
uniform float uDoppler;       // 0..1, blends the beaming term out
uniform float uRedshift;      // 0..1, blends the gravitational shift out

uniform float uStarBrightness;
uniform float uNebula;

uniform int   uBodyCount;
uniform vec4  uBodyPos[MAX_BODIES];   // xyz position in r_g, w radius
uniform vec4  uBodyCol[MAX_BODIES];   // rgb tint, a temperature in kelvin

uniform sampler2D uBlackbody;
uniform vec2  uBBRange;       // log(Tmin), log(Tmax) of the lookup table
uniform float uGain;

/* ---------------------------------------------------------------- *
 *  Utility
 * ---------------------------------------------------------------- */

vec3 blackbody(float T) {
  float t = (log(max(T, 1.0)) - uBBRange.x) / (uBBRange.y - uBBRange.x);
  return texture(uBlackbody, vec2(clamp(t, 0.002, 0.998), 0.5)).rgb;
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p, int octaves) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    v += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

/* ---------------------------------------------------------------- *
 *  Background sky
 * ---------------------------------------------------------------- */

vec3 starLayer(vec3 dir, float scale, float cut, float size, float bright) {
  // Stars live in a 3D lattice, but a ray only ever samples the unit sphere,
  // so each star is measured by the angle between the view direction and the
  // star's own direction. Sampling the 3x3x3 neighbourhood rather than just
  // the containing cell is what keeps a star round instead of clipping it
  // into a square at its cell wall.
  vec3 base = floor(dir * scale);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 27; i++) {
    vec3 id = base + vec3(float(i % 3), float((i / 3) % 3), float(i / 9)) - 1.0;
    if (hash13(id + 0.5) > cut) continue;
    vec3 h = hash33(id + 19.7);
    vec3 sdir = normalize(id + 0.5 + (h - 0.5) * 0.9);
    float d = length(dir - sdir) * scale;
    // Everything a star contributes has to fit well inside the neighbourhood
    // we sample, or it gets clipped at the lattice wall and turns into a
    // square. The glow around the bright ones is left to the bloom pass.
    if (d > size * 1.8) continue;
    float core = smoothstep(size, 0.0, d);
    core *= core;
    // Rough main-sequence mix: mostly cool dwarfs, a few hot blue giants.
    float T = mix(2700.0, 24000.0, pow(h.x, 3.0));
    // A long-tailed magnitude distribution gives a handful of standouts.
    // Capped: a sub-pixel source far above the bloom threshold gets smeared
    // into a visible block by the bloom pyramid.
    float mag = 0.3 + 3.2 * pow(h.y, 5.0);
    sum += blackbody(T) * core * mag;
  }
  return sum * bright;
}

vec3 skyColour(vec3 dir) {
  vec3 col = vec3(0.0);
  col += starLayer(dir, 130.0, 0.0042, 0.50, 1.0);
  col += starLayer(dir, 320.0, 0.0010, 0.40, 0.75);
  col += starLayer(dir, 720.0, 0.00018, 0.32, 0.5);
  col *= uStarBrightness;

  if (uNebula > 0.0) {
    // A galactic plane tilted well off the disc so the two never line up.
    vec3 gal = normalize(vec3(0.34, 0.86, -0.38));
    float lat = dot(dir, gal);
    float band = exp(-lat * lat * 34.0);
    float clouds = fbm(dir * 2.6 + 11.3, 5);
    float dust = fbm(dir * 7.4 - 4.7, 4);
    vec3 glow = mix(vec3(0.16, 0.26, 0.58), vec3(0.58, 0.40, 0.26), clouds);
    float amount = band * pow(clouds, 3.0) * smoothstep(0.62, 0.30, dust);
    col += glow * amount * 0.09 * uNebula;
    // Unresolved stars piled up along the plane.
    col += vec3(0.30, 0.31, 0.38) * band * pow(clouds, 1.5) * 0.010 * uNebula;
  }
  return col;
}

/* ---------------------------------------------------------------- *
 *  Accretion disc
 * ---------------------------------------------------------------- */

// Shakura-Sunyaev / Novikov-Thorne thin-disc profile, normalised so that the
// peak equals uDiscTemp:  T(r) ~ [ (1 - sqrt(r_in/r)) / r^3 ]^(1/4)
float discTemperature(float r) {
  if (r <= uDiscInner) return 0.0;
  float f = 1.0 - sqrt(uDiscInner / r);
  float rp = 1.36111111 * uDiscInner;          // peak sits at (49/36) r_in
  float fp = 1.0 - sqrt(uDiscInner / rp);
  return uDiscTemp * pow((f * rp * rp * rp) / (fp * r * r * r), 0.25);
}

/**
 * Cubic Hermite interpolation of u(phi) inside one integration step, used to
 * land exactly on the equatorial plane instead of stepping over it.
 */
float hermite(float u0, float d0, float u1, float d1, float h, float t) {
  float s = t / h;
  float s2 = s * s;
  float s3 = s2 * s;
  return (2.0 * s3 - 3.0 * s2 + 1.0) * u0
       + (s3 - 2.0 * s2 + s) * h * d0
       + (-2.0 * s3 + 3.0 * s2) * u1
       + (s3 - s2) * h * d1;
}

/* ---------------------------------------------------------------- *
 *  Null geodesic integration
 * ---------------------------------------------------------------- */

// d^2u/dphi^2 = -u + 3 M u^2  (the 3Mu^2 term is all of the lensing)
float accel(float u) { return -u + 3.0 * uGR * u * u; }

void rk4(float u, float du, float h, out float uo, out float duo) {
  float k1u = du,                 k1d = accel(u);
  float k2u = du + 0.5 * h * k1d, k2d = accel(u + 0.5 * h * k1u);
  float k3u = du + 0.5 * h * k2d, k3d = accel(u + 0.5 * h * k2u);
  float k4u = du + h * k3d,       k4d = accel(u + h * k3u);
  uo  = u  + (h / 6.0) * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
  duo = du + (h / 6.0) * (k1d + 2.0 * k2d + 2.0 * k3d + k4d);
}

struct Ray {
  vec3 e1;      // radial basis vector of the orbital plane
  vec3 e2;      // tangential basis vector, along the direction of travel
  float ny;     // y component of the plane normal
  float b;      // impact parameter L/E
  float rObs;   // observer radius
};

/** Accumulate one disc crossing into the running colour. */
void shadeDisc(Ray ry, float uc, float duc, float phic,
               inout vec3 accum, inout float trans) {
  float r = 1.0 / max(uc, 1e-6);
  if (r < uDiscInner || r > uDiscOuter) return;

  float cp = cos(phic), sp = sin(phic);
  vec3 er = cp * ry.e1 + sp * ry.e2;
  vec3 et = -sp * ry.e1 + cp * ry.e2;
  vec3 pos = r * er;

  // Direction of travel there: dP/dphi = (dr/dphi) er + r et, dr/dphi = -du/u^2
  vec3 dir = normalize((-duc / (uc * uc)) * er + r * et);
  float mu = max(abs(dir.y), 0.025);           // cosine to the disc normal
  float alpha = 1.0 - exp(-uDiscOpacity / mu); // slab of optical depth tau/mu

  // Frequency shift: gravitational + transverse part, then the beaming term.
  float gGrav = sqrt(max(0.0, 1.0 - 3.0 / r)) / sqrt(max(1e-4, 1.0 - 2.0 / ry.rObs));
  float omega = uDiscSpin * pow(r, -1.5);
  float gDopp = 1.0 / max(1e-3, 1.0 + omega * ry.b * ry.ny);
  float g = mix(1.0, gGrav, uRedshift) * mix(1.0, gDopp, uDoppler);

  float Tem = discTemperature(r);
  float Tobs = Tem * g;

  // Density fluctuations, sheared by the differential rotation of the disc.
  float az = atan(pos.z, pos.x);
  float lag = az - omega * uSimTime;
  vec3 q = vec3(cos(lag), sin(lag), log(r) * 2.4);
  float turb = fbm(q * 3.4, 4) * 0.7 + fbm(q * 11.0 + 7.0, 3) * 0.45;
  // Higher-order images squeeze the whole disc into a thin arc, so their
  // detail is far below one pixel. Fading the turbulence towards its mean as
  // the photon winds further is a cheap stand-in for filtering it, and stops
  // the secondary image breaking up into dashes.
  float order = smoothstep(1.2, 3.4, phic);
  float emis = mix(1.0, 0.35 + 1.55 * turb, uDiscTurbulence * (1.0 - order));

  // Soft outer edge; the inner edge is already zeroed by the T profile.
  emis *= 1.0 - smoothstep(uDiscOuter * 0.80, uDiscOuter, r);

  // I_obs = g^4 I_emit, and for a black body I ~ T^4, so writing the
  // brightness as (T_obs / T_peak)^4 carries the beaming automatically.
  float rel = Tobs / max(uDiscTemp, 1.0);
  float intensity = rel * rel * rel * rel * emis * uDiscBrightness;

  vec3 radiance = blackbody(Tobs) * intensity;
  accum += trans * radiance * alpha;
  trans *= 1.0 - alpha;
}

/** Orbiting companions, lensed along with everything else. */
void shadeBodies(Ray ry, float uc, float phic,
                 inout vec3 accum, inout float trans) {
  float r = 1.0 / max(uc, 1e-6);
  vec3 pos = r * (cos(phic) * ry.e1 + sin(phic) * ry.e2);
  for (int k = 0; k < MAX_BODIES; k++) {
    if (k >= uBodyCount) break;
    vec3 bp = uBodyPos[k].xyz;
    float rad = uBodyPos[k].w;
    float d = length(pos - bp);
    if (d < rad * 2.5) {
      // Soft-edged sphere; the width of the step sets how much of the body
      // this sample is responsible for.
      float cov = smoothstep(rad * 1.6, rad * 0.35, d);
      float a = clamp(cov * 2.2, 0.0, 1.0);
      vec3 col = blackbody(uBodyCol[k].a) * uBodyCol[k].rgb;
      accum += trans * col * a;
      trans *= 1.0 - a;
    }
  }
}

vec3 trace(vec3 ro, vec3 rd) {
  vec3 accum = vec3(0.0);
  float trans = 1.0;

  float r0 = length(ro);
  vec3 e1 = ro / r0;
  vec3 cr = cross(e1, rd);
  float sinPsi = length(cr);
  float cosPsi = dot(e1, rd);

  if (sinPsi < 1e-6) {
    // Exactly radial: no bending and no plane to cross.
    return cosPsi < 0.0 ? vec3(0.0) : skyColour(rd);
  }

  Ray ry;
  vec3 N = cr / sinPsi;
  ry.e1 = e1;
  ry.e2 = normalize(cross(N, e1));
  ry.ny = N.y;
  ry.rObs = r0;

  // sqrt(1 - 2M/r) converts between the static observer's orthonormal frame
  // and Schwarzschild coordinates. Forgetting it is the classic way to get a
  // lensing render subtly but visibly wrong.
  float f0 = sqrt(max(1.0 - 2.0 / r0, 1e-4));
  ry.b = r0 * sinPsi / f0;

  float u = 1.0 / r0;
  float du = -cosPsi * f0 / (r0 * sinPsi);
  float phi = 0.0;
  float uEsc = 1.0 / uEscapeRadius;

  // The photon's plane meets the equatorial plane where
  // e1.y cos(phi) + e2.y sin(phi) = 0, so the crossings are known up front.
  float ay = ry.e1.y;
  float by = ry.e2.y;
  bool coplanar = (ay * ay + by * by) < 1e-12;
  float phiCross = 1e9;
  if (!coplanar) {
    phiCross = atan(-ay, by);
    phiCross += ceil((2e-3 - phiCross) / PI) * PI;
  }

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;

    // Coarse steps where spacetime is nearly flat, fine steps near the hole.
    float h = uStepScale * 0.028 * (1.0 + 3.4 * exp(-70.0 * u));
    if (du < 0.0) h = min(h, (0.45 * u) / -du);   // never overshoot u = 0

    float u1, du1;
    rk4(u, du, h, u1, du1);
    float phi1 = phi + h;

    if (uDiscEnabled > 0.5 && phiCross <= phi1 && phiCross > phi) {
      float t = phiCross - phi;
      float uc = hermite(u, du, u1, du1, h, t);
      float duc = mix(du, du1, t / h);
      shadeDisc(ry, uc, duc, phiCross, accum, trans);
      phiCross += PI;
    }
    if (uBodyCount > 0) {
      shadeBodies(ry, 0.5 * (u + u1), phi + 0.5 * h, accum, trans);
    }

    u = u1;
    du = du1;
    phi = phi1;

    if (u >= 0.5) {
      // Through the horizon. Nothing behind it, by construction.
      return accum;
    }
    if (u <= uEsc && du < 0.0) {
      // u = A sin(phiInf - phi) far out, so the asymptote is exact:
      float phiInf = phi + atan(u, -du);
      vec3 out3 = cos(phiInf) * ry.e1 + sin(phiInf) * ry.e2;
      // Starlight is blueshifted on the way down to the observer.
      float blue = 1.0 / sqrt(max(1e-4, 1.0 - 2.0 / r0));
      return accum + trans * skyColour(normalize(out3)) * mix(1.0, blue * blue, uRedshift);
    }
    if (trans < 0.004) return accum;
  }
  // Ran out of steps: these are rays spiralling at the photon sphere, which
  // overwhelmingly end up inside the horizon.
  return accum;
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  float aspect = uResolution.x / uResolution.y;
  vec3 rd = normalize(
      uRight * (ndc.x * aspect * uTanHalfFov)
    + uUp * (ndc.y * uTanHalfFov)
    + uForward);

  // Linear HDR radiance; bloom and tone mapping happen in the post chain.
  outColor = vec4(trace(uCamPos, rd) * uGain, 1.0);
}
`;
