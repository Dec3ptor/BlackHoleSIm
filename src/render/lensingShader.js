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
uniform float uCamDist;       // observer radius, for the gravitational shift

uniform float uDiscEnabled;
uniform float uDiscInner;
uniform float uDiscOuter;
uniform float uDiscOpacity;
uniform float uDiscHeight;     // scale height as a fraction of r (flared disc)
uniform float uDiscFilament;   // how sharply the noise breaks into filaments
uniform float uDiscDust;       // cool dust: absorbs without emitting
uniform float uEmission;       // 0 = thermal black body, 1 = optically thin synchrotron
uniform float uEmisIndex;      // radial emissivity power law, j ~ (r_in/r)^index
uniform float uBeamExp;        // Doppler boost exponent; 3 for specific intensity
uniform float uDiscTemp;      // peak effective temperature, kelvin
uniform float uDiscProfile;   // 1 = physical r^-3/4 law, 0 = isothermal
uniform float uDiscSpin;      // +1 prograde, -1 retrograde
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
  float ratio = pow((f * rp * rp * rp) / (fp * r * r * r), 0.25);
  // uDiscProfile flattens the law towards isothermal. Interstellar's disc was
  // modelled as very nearly isothermal, which is why it glows evenly out to
  // the rim instead of collapsing to a bright ring like a real thin disc.
  return uDiscTemp * pow(max(ratio, 1e-4), uDiscProfile);
}

/**
 * The medium at a point in the disc, as two densities:
 *   .x  hot gas, which both emits and absorbs
 *   .y  cool dust, which only absorbs
 *
 * Splitting them is what produces dark lanes. If emission and opacity came
 * from one field, dense gas would always be bright and nothing could ever be
 * silhouetted against it.
 *
 * The disc is a flared slab of scale height H = uDiscHeight * r with a
 * Gaussian vertical profile, and its structure is fractal noise sampled in
 * the *co-rotating* frame, azimuth minus Omega(r) t. Differential rotation
 * therefore winds it into trailing spirals on its own, with the inner disc
 * lapping the outer disc exactly as fast as Kepler says it should.
 *
 * The noise is deliberately anisotropic - fine radially, coarse azimuthally -
 * which is what makes long thin strands rather than blobs.
 */
vec2 discMedium(vec3 p, float r) {
  float H = max(uDiscHeight, 0.015) * r;
  float z = p.y / H;
  float vert = exp(-z * z * 1.6);
  if (vert < 0.003) return vec2(0.0);

  float radial = smoothstep(uDiscInner * 0.90, uDiscInner * 1.30, r)
               * (1.0 - smoothstep(uDiscOuter * 0.55, uDiscOuter, r));
  if (radial < 0.002) return vec2(0.0);

  float omega = uDiscSpin * pow(r, -1.5);
  float lag = atan(p.z, p.x) - omega * uSimTime;
  vec2 c = vec2(cos(lag), sin(lag));
  float lr = log(r);

  // Keep the radial-to-azimuthal frequency ratio moderate: push it too far
  // and the strands close into concentric rings that alias into moire.
  float n = fbm(vec3(c * 2.6, lr * 8.0), 4) * 0.72
          + fbm(vec3(c * 6.4, lr * 21.0) + 31.7, 3) * 0.44;
  // A wide density contrast is what makes a grazing line of sight worth
  // looking at: it punches through the gaps and piles up in the strands,
  // instead of averaging everything into a smooth wash.
  float fil = smoothstep(0.26, 0.74, n);
  float gas = mix(1.0, 0.03 + 1.9 * fil * fil, uDiscFilament);

  // Cool dust rides higher above the midplane than the hot gas.
  float dn = fbm(vec3(c * 3.2, lr * 10.5) - 12.3, 3) * 0.78
           + fbm(vec3(c * 8.0, lr * 26.0) + 5.1, 2) * 0.32;
  float dust = uDiscDust * smoothstep(0.40, 0.80, dn) * exp(-z * z * 0.6) * 2.4;

  return vec2(gas * vert, dust) * radial;
}

/** Observed/emitted frequency ratio for gas on a circular geodesic at r. */
float shiftFactor(float rIn, float b, float ny) {
  // No circular geodesic exists inside the ISCO; real flows plunge from there
  // carrying roughly the ISCO's energy and angular momentum, so freezing the
  // orbit at r = 6 is the standard stand-in rather than letting g go complex.
  float r = max(rIn, 6.0);
  float gGrav = sqrt(max(0.0, 1.0 - 3.0 / r)) / sqrt(max(1e-4, 1.0 - 2.0 / uCamDist));
  float omega = uDiscSpin * pow(r, -1.5);
  float gDopp = 1.0 / max(1e-3, 1.0 + omega * b * ny);
  return mix(1.0, gGrav, uRedshift) * mix(1.0, gDopp, uDoppler);
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

/**
 * Orbiting worlds, lensed along with everything else.
 *
 * Each integration step is a short chord, so an ordinary segment-sphere test
 * catches the hit even though the ray as a whole is curved. Lighting treats
 * the accretion disc as the only source, which puts the terminator exactly
 * where it belongs: the lit crescent always faces the black hole.
 *
 * uBodyCol.a carries an emission temperature. Above 1 K the body is a star
 * and glows on its own; at zero it is a planet, and .rgb is its albedo.
 */
bool hitBodies(vec3 a, vec3 bq, inout vec3 accum, inout float trans) {
  bool hit = false;
  for (int k = 0; k < MAX_BODIES; k++) {
    if (k >= uBodyCount) break;
    vec3 centre = uBodyPos[k].xyz;
    float rad = uBodyPos[k].w;
    vec3 ab = bq - a;
    float len2 = max(dot(ab, ab), 1e-12);
    float t = clamp(dot(centre - a, ab) / len2, 0.0, 1.0);
    float d = length(a + t * ab - centre);
    if (d >= rad) continue;

    // Step back along the chord to where it enters the sphere.
    float back = sqrt(max(rad * rad - d * d, 0.0)) / sqrt(len2);
    vec3 surf = a + max(t - back, 0.0) * ab;
    vec3 n = normalize(surf - centre);

    vec3 lit;
    if (uBodyCol[k].a > 1.0) {
      lit = blackbody(uBodyCol[k].a) * uBodyCol[k].rgb;
    } else {
      // A planet this close to a black hole is tidally locked, so its surface
      // frame is built from the direction to the hole and the disc normal.
      vec3 toHole = normalize(-centre);
      vec3 fy = normalize(vec3(0.0, 1.0, 0.0) - toHole * toHole.y);
      vec3 fx = cross(fy, toHole);
      vec3 ln = vec3(dot(n, fx), dot(n, fy), dot(n, toHole));

      float seed = float(k) * 17.3;
      float land = fbm(ln * 2.3 + seed, 4);
      float cloud = fbm(ln * 4.7 - seed, 3);
      vec3 albedo = mix(uBodyCol[k].rgb * 0.40, uBodyCol[k].rgb, smoothstep(0.36, 0.64, land));
      albedo = mix(albedo, vec3(0.92), smoothstep(0.54, 0.80, cloud) * 0.55);

      // The disc is the lamp: warm, centred on the hole, and falling off as
      // 1/r^2, which leaves an outer world a near-silhouette with only a thin
      // crescent turned towards the light.
      float dist = max(length(centre), 1.0);
      vec3 lamp = blackbody(uDiscTemp) * uDiscBrightness * min(0.6, 260.0 / (dist * dist));
      float lambert = max(dot(n, toHole), 0.0);
      lit = albedo * lamp * (0.02 + 0.98 * pow(lambert, 0.75));

      // Rim light where the disc grazes the limb.
      float rim = pow(1.0 - max(dot(n, -normalize(ab)), 0.0), 3.5);
      lit += lamp * rim * lambert * 0.7;
    }

    accum += trans * lit;
    trans = 0.0;
    hit = true;
  }
  return hit;
}

vec3 trace(vec3 ro, vec3 rd, float jitter) {
  vec3 accum = vec3(0.0);
  float trans = 1.0;
  float radio = 0.0;   // optically thin intensity, for the synchrotron mode

  float r0 = length(ro);
  vec3 e1 = ro / r0;
  vec3 cr = cross(e1, rd);
  float sinPsi = length(cr);
  float cosPsi = dot(e1, rd);

  if (sinPsi < 1e-6) {
    // Exactly radial: no bending and no plane to cross.
    if (uEmission > 0.5) return vec3(0.0);
    return cosPsi < 0.0 ? vec3(0.0) : skyColour(rd);
  }

  vec3 N = cr / sinPsi;
  vec3 e2 = normalize(cross(N, e1));
  float ny = N.y;

  // sqrt(1 - 2M/r) converts between the static observer's orthonormal frame
  // and Schwarzschild coordinates. Forgetting it is the classic way to get a
  // lensing render subtly but visibly wrong.
  float f0 = sqrt(max(1.0 - 2.0 / r0, 1e-4));
  float b = r0 * sinPsi / f0;

  float u = 1.0 / r0;
  float du = -cosPsi * f0 / (r0 * sinPsi);
  float phi = 0.0;
  float uEsc = 1.0 / uEscapeRadius;

  float rLo = uDiscInner * 0.85;
  float rHi = uDiscOuter * 1.05;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;

    float r = 1.0 / u;
    float cp = cos(phi);
    float sp = sin(phi);
    vec3 er = cp * e1 + sp * e2;
    vec3 et = -sp * e1 + cp * e2;
    vec3 pos = r * er;

    float drdphi = -du / (u * u);
    float fr = max(1.0 - 2.0 / r, 1e-3);
    // Proper length and vertical drift per radian of orbital angle.
    float dsdphi = sqrt(drdphi * drdphi / fr + r * r);
    float dydphi = abs(drdphi * er.y + r * et.y);

    // Coarse steps where spacetime is nearly flat, fine steps near the hole.
    float h = uStepScale * 0.030 * (1.0 + 3.4 * exp(-70.0 * u));
    if (du < 0.0) h = min(h, (0.45 * u) / -du);

    bool inReach = uDiscEnabled > 0.5 && r > rLo && r < rHi;
    float H = max(uDiscHeight, 0.015) * r;
    if (uDiscEnabled > 0.5 && !inReach) {
      // Approaching the disc from outside its radial range: do not step past
      // the edge, or a distant camera jumps straight into the middle of it.
      if (r > rHi && drdphi < 0.0) h = min(h, (r - rHi) / -drdphi);
      else if (r < rLo && drdphi > 0.0) h = min(h, (rLo - r) / drdphi);
    }
    if (inReach) {
      // Outside the slab, step no further than the distance to it; inside,
      // crawl, so the vertical profile is sampled rather than jumped over.
      float gap = abs(pos.y) - 1.3 * H;
      if (gap > 0.0) {
        h = min(h, gap / max(dydphi, 1e-4));
      } else {
        h = min(h, (0.5 * H) / max(dydphi, 1e-4));
        h = min(h, (0.6 * H + 0.03 * r) / dsdphi);
      }
    }
    h = max(h, 2e-4);

    float u1, du1;
    rk4(u, du, h, u1, du1);
    float phi1 = phi + h;
    float r1 = 1.0 / max(u1, 1e-6);
    vec3 pos1 = r1 * (cos(phi1) * e1 + sin(phi1) * e2);

    if (inReach) {
      // One midpoint sample of the emitting, absorbing slab. Emission and
      // opacity both come from the same density, so thin wisps glow and let
      // the far side through while dense strands block it - which is what
      // keeps both lensed arcs of the disc visible at once.
      vec3 pm = mix(pos, pos1, jitter);
      if (abs(pm.y) < 2.8 * H) {
        float rm = length(pm);
        vec2 med = discMedium(pm, rm);
        float ext = med.x + med.y;
        if (ext > 1e-4) {
          float g = shiftFactor(rm, b, ny);
          if (uEmission > 0.5) {
            // Optically thin synchrotron, as at 230 GHz around M87*: nothing
            // absorbs, emission just piles up along the ray. The whole ring
            // asymmetry is the g^3 Doppler boost of plasma orbiting at a
            // large fraction of c.
            float j = med.x * pow(uDiscInner / max(rm, 1e-3), uEmisIndex);
            radio += j * pow(g, uBeamExp) * dsdphi * h * uDiscBrightness;
          } else {
            float alpha = 1.0 - exp(-(uDiscOpacity / max(2.0 * H, 1e-3)) * ext * dsdphi * h);
            float Tobs = discTemperature(rm) * g;
            float rel = Tobs / max(uDiscTemp, 1.0);
            // Thermal source function: I ~ T^4, with the g^4 beaming riding
            // along for free because the shift was folded into T_obs. Only the
            // gas fraction of the opacity emits; the dust just blocks.
            vec3 src = blackbody(Tobs) * (rel * rel * rel * rel)
                     * uDiscBrightness * (med.x / ext);
            accum += trans * src * alpha;
            trans *= 1.0 - alpha;
          }
        }
      }
    }

    if (uEmission < 0.5 && uBodyCount > 0 && hitBodies(pos, pos1, accum, trans)) return accum;

    u = u1;
    du = du1;
    phi = phi1;

    if (u >= 0.5) {
      // Through the horizon. Nothing behind it, by construction - but light
      // emitted in front of it still counts, which is why the observed
      // "shadow" is only about ten times fainter than the ring, not black.
      return uEmission > 0.5 ? vec3(radio * uGain) : accum;
    }
    if (u <= uEsc && du < 0.0) {
      // u = A sin(phiInf - phi) far out, so the asymptote is exact:
      float phiInf = phi + atan(u, -du);
      vec3 out3 = cos(phiInf) * e1 + sin(phiInf) * e2;
      // Starlight is blueshifted on the way down to the observer.
      float blue = 1.0 / sqrt(max(1e-4, 1.0 - 2.0 / r0));
      if (uEmission > 0.5) return vec3(radio * uGain);
      return accum + trans * skyColour(normalize(out3)) * mix(1.0, blue * blue, uRedshift);
    }
    if (uEmission < 0.5 && trans < 0.003) return accum;
  }
  // Ran out of steps: these are rays spiralling at the photon sphere, which
  // overwhelmingly end up inside the horizon.
  return uEmission > 0.5 ? vec3(radio * uGain) : accum;
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  float aspect = uResolution.x / uResolution.y;
  vec3 rd = normalize(
      uRight * (ndc.x * aspect * uTanHalfFov)
    + uUp * (ndc.y * uTanHalfFov)
    + uForward);

  // Linear HDR radiance; bloom and tone mapping happen in the post chain.
  // Dither where inside each step the medium is sampled, so the march reads
  // as grain rather than as concentric bands.
  float jitter = 0.18 + 0.64 * hash13(vec3(gl_FragCoord.xy, 1.0));

  if (uEmission > 0.5) {
    // Raw scalar intensity. The beam convolution and the false-colour map are
    // separate passes, so that the blur happens before the colouring.
    outColor = vec4(trace(uCamPos, rd, jitter), 1.0);
    return;
  }
  outColor = vec4(trace(uCamPos, rd, jitter) * uGain, 1.0);
}
`;
