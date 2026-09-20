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

uniform float uJet;            // jet brightness; 0 switches it off entirely
uniform float uJetInner;       // launch height above the hole, in r_g
uniform float uJetLength;      // how far the jet is drawn, in r_g
uniform float uJetBase;        // jet radius at z = 10 r_g
uniform float uJetShape;       // collimation exponent: R ~ z^uJetShape
uniform float uJetGammaSpine;  // terminal bulk Lorentz factor on the axis
uniform float uJetGammaSheath; // terminal bulk Lorentz factor at the edge
uniform float uJetAccel;       // height over which the flow reaches it
uniform float uJetBeamExp;     // 2 + spectral index, for a continuous jet
uniform float uJetFalloff;     // emissivity decline along the jet
uniform float uJetHelix;       // twist of the magnetic filaments
uniform float uJetTemp;
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

uniform sampler3D uNoise;
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

// Value noise, read out of a prebaked 3D texture. Hardware linear filtering
// does the interpolation, so one texture fetch replaces eight hashes and a
// trilinear blend. One unit of q is one texel, matching the analytic version
// this replaces; the field wraps every 64 units.
float vnoise(vec3 q) {
  return texture(uNoise, q * (1.0 / 64.0)).r;
}

float fbm(vec3 p, int octaves) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    v += a * vnoise(p);
    // Offset as well as scale, so successive octaves sample uncorrelated
    // parts of the field rather than the same pattern magnified.
    p = p * 2.03 + 19.7;
    a *= 0.5;
  }
  return v;
}

/* ---------------------------------------------------------------- *
 *  Background sky
 * ---------------------------------------------------------------- */

vec3 starLayer(vec3 dir, float scale, float cut, float size, float bright, float foot) {
  // foot is the angular radius of sky this pixel covers, in cell units.
  // Where the lens compresses the sky - hard against the shadow, where the
  // higher-order images pile up - one pixel spans far more sky than a star
  // subtends. A point source there must be spread over the pixel, not drawn
  // at full surface brightness wherever a sample happens to land on it.
  // Widening the star to the footprint and dimming by the area ratio is the
  // same bookkeeping a mip level does, and it is what turns the speckle at
  // the shadow's edge into the faint smooth glow the magnification implies.
  float eff = max(size, foot);
  float dim = (size * size) / (eff * eff);
  vec3 p = dir * scale;
  vec3 base = floor(p - 0.5);
  vec3 sum = vec3(0.0);
  // Only the eight cells nearest the sample. A star's reach is held below half
  // a cell by the offset and size below, so no other cell can contribute -
  // which is why this replaces a 3x3x3 sweep at a third of the cost for an
  // identical picture. Halving the lattice scale alongside the size keeps the
  // stars the same angular size they were.
  for (int i = 0; i < 8; i++) {
    vec3 id = base + vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1));
    if (hash13(id + 0.5) > cut) continue;
    vec3 h = hash33(id + 19.7);
    // Measure the distance to the star's *direction*, not to a point in the
    // 3D lattice: the sample only ever lives on the unit sphere, so a straight
    // 3D distance turns every star into a clipped square of its cell.
    vec3 sdir = normalize(id + 0.5 + (h - 0.5) * 0.24);
    float d = length(dir - sdir) * scale;
    if (d > eff) continue;
    float core = smoothstep(eff, 0.0, d);
    core *= core * dim;
    // Rough main-sequence mix: mostly cool dwarfs, a few hot blue giants.
    float T = mix(2700.0, 24000.0, h.x * h.x * h.x);
    // A long-tailed magnitude distribution gives a handful of standouts,
    // capped so a sub-pixel source does not blow up in the bloom pyramid.
    float h2 = h.y * h.y;
    float mag = 0.3 + 3.2 * h2 * h2 * h.y;
    sum += blackbody(T) * core * mag;
  }
  return sum * bright;
}

vec3 skyColour(vec3 dir, float footRad) {
  vec3 col = vec3(0.0);
  if (uStarBrightness > 0.0) {
    // The densities are 1.64x the naive area scaling: the 3x3x3 sweep this
    // replaces spanned three radial shells of the lattice and drew stars from
    // all of them, so eight cells over two shells needs the extra to land on
    // the same star count. Measured against the old render, not guessed.
    col += starLayer(dir, 65.0, 0.0275, 0.25, 1.0, footRad * 65.0);
    col += starLayer(dir, 160.0, 0.0066, 0.20, 0.75, footRad * 160.0);
    col += starLayer(dir, 360.0, 0.00118, 0.16, 0.5, footRad * 360.0);
    col *= uStarBrightness;
  }

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

  // r^-1.5 without a pow(): two cheap ops instead of an exp2/log2 pair.
  float invr = 1.0 / r;
  float omega = uDiscSpin * invr * sqrt(invr);
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

  // Cool dust rides higher above the midplane than the hot gas. Several
  // presets set it to zero, and then none of this needs evaluating at all.
  float dust = 0.0;
  if (uDiscDust > 0.0) {
    float dn = fbm(vec3(c * 3.2, lr * 10.5) - 12.3, 3) * 0.78
             + fbm(vec3(c * 8.0, lr * 26.0) + 5.1, 2) * 0.32;
    dust = uDiscDust * smoothstep(0.40, 0.80, dn) * exp(-z * z * 0.6) * 2.4;
  }

  return vec2(gas * vert, dust) * radial;
}

/**
 * A relativistic jet, of the kind M87 launches.
 *
 * Shape, speed and brightness all follow the VLBI measurements rather than
 * being drawn by eye:
 *
 *  - The jet is collimated *parabolically*, R ~ z^0.58, which is what VLBI
 *    finds from the jet base out to the Bondi radius before it goes conical.
 *    That gives the very wide base - tens of degrees - narrowing with height.
 *  - The flow accelerates as Gamma ~ z^0.42, the magnetohydrodynamic result
 *    that goes with a z ~ R^1.7 boundary.
 *  - The spine runs faster than the sheath. This is what makes the jet
 *    *limb-brightened*, and it is worth being precise about why: the Doppler
 *    factor peaks at a viewing angle of about 1/Gamma, so a fast spine seen
 *    from 17 degrees has already beamed its light past the observer, while
 *    the slower sheath is still pointed at them. The edges therefore come out
 *    brighter than the middle, which is exactly what is observed - and it
 *    falls out of the velocity profile rather than being painted on.
 *  - The approaching and receding jets differ by delta^(2+alpha), which is
 *    why the counter-jet all but vanishes.
 *
 * Emission is optically thin synchrotron, so the jet adds light without
 * blocking any: the disc and the sky behind it still show through.
 *
 * toObs must point from the emitting parcel towards the observer. Rays are
 * traced backwards, so that is the opposite of the marching direction - get
 * the sign wrong and the beaming inverts, lighting up the counter-jet and
 * extinguishing the one pointed at you.
 */
vec3 jetSample(vec3 p, vec3 toObs) {
  float z = abs(p.y);
  if (z < uJetInner || z > uJetLength) return vec3(0.0);

  float rho = length(p.xz);
  float R = uJetBase * pow(z / 10.0, uJetShape);
  float x = rho / max(R, 1e-3);
  if (x > 1.2) return vec3(0.0);

  // Bulk flow: accelerating with height, faster on the axis than at the edge.
  float acc = min(1.0, pow(z / max(uJetAccel, 1.0), 0.42));
  float gTerm = mix(uJetGammaSheath, uJetGammaSpine, clamp(1.0 - x * x, 0.0, 1.0));
  float gam = max(1.0 + (gTerm - 1.0) * acc, 1.0001);
  float beta = sqrt(max(0.0, 1.0 - 1.0 / (gam * gam)));

  // Streamline direction. For R ~ z^k a parcel drifts outwards as it rises at
  // d(rho)/dz = k rho / z, so the flow is not quite parallel to the axis.
  vec3 rhat = rho > 1e-4 ? vec3(p.x, 0.0, p.z) / rho : vec3(1.0, 0.0, 0.0);
  vec3 vhat = normalize(vec3(0.0, sign(p.y), 0.0)
                      + rhat * (uJetShape * rho / max(z, 1e-3)));

  // dir is the photon's direction of travel, i.e. towards the observer.
  float delta = 1.0 / max(gam * (1.0 - beta * dot(vhat, toObs)), 1e-3);

  // A hollow, sheath-weighted emission shell, fading along the jet and broken
  // into knots by a helical field.
  // Hollow: the emission lives in a sheath, which is what a line of sight
  // through a tube limb-brightens into two rails.
  float shell = exp(-pow((x - 0.80) / 0.20, 2.0)) + 0.12;
  // Clamped at the launch height: without it the power law spikes hard enough
  // near z = 0 to swamp the rest of the jet.
  float fall = pow(10.0 / max(z, uJetInner), uJetFalloff);
  float helix = atan(p.z, p.x) - uJetHelix * log(max(z, 1.0)) - uSimTime * 0.02 * sign(p.y);
  float knots = fbm(vec3(cos(helix), sin(helix), z * 0.085) * 2.4, 4) * 1.1
              + fbm(vec3(cos(helix), sin(helix), z * 0.30) * 5.0 + 9.1, 3) * 0.5;
  knots = 0.25 + 1.5 * smoothstep(0.25, 0.85, knots);

  float gg = sqrt(max(0.0, 1.0 - 2.0 / max(length(p), 2.05)));
  // 0.012 puts an approaching jet at roughly unit radiance once integrated
  // along a typical line of sight, so uJet reads as a plain brightness dial.
  float radiance = 0.012 * uJet * shell * fall * knots
                 * pow(delta, uJetBeamExp) * mix(1.0, gg, uRedshift);
  return blackbody(uJetTemp) * radiance;
}

/** Observed/emitted frequency ratio for gas on a circular geodesic at r. */
float shiftFactor(float rIn, float b, float ny) {
  // No circular geodesic exists inside the ISCO; real flows plunge from there
  // carrying roughly the ISCO's energy and angular momentum, so freezing the
  // orbit at r = 6 is the standard stand-in rather than letting g go complex.
  float r = max(rIn, 6.0);
  float gGrav = sqrt(max(0.0, 1.0 - 3.0 / r)) / sqrt(max(1e-4, 1.0 - 2.0 / uCamDist));
  float invr = 1.0 / r;
  float omega = uDiscSpin * invr * sqrt(invr);
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

vec3 trace(vec3 ro, vec3 rd, float jitter, out vec3 skyDir, out float skyWeight) {
  vec3 accum = vec3(0.0);
  float trans = 1.0;
  float radio = 0.0;   // optically thin intensity, for the synchrotron mode
  // Default to the undeflected ray: neighbouring pixels that never escape
  // still need something continuous here for the derivative to be usable.
  skyDir = rd;
  skyWeight = 0.0;

  float r0 = length(ro);
  vec3 e1 = ro / r0;
  vec3 cr = cross(e1, rd);
  float sinPsi = length(cr);
  float cosPsi = dot(e1, rd);

  if (sinPsi < 1e-6) {
    // Exactly radial: no bending and no plane to cross.
    if (uEmission > 0.5) return vec3(0.0);
    if (cosPsi >= 0.0) skyWeight = 1.0;
    return vec3(0.0);
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
    float drdphi = -du / (u * u);

    // Coarse steps where spacetime is nearly flat, fine steps near the hole.
    // The shaping term used exp(-70u); a rational with the same shape costs a
    // divide instead of a transcendental, and this is a step heuristic rather
    // than physics, so only its magnitude matters.
    float h = uStepScale * 0.030 * (1.0 + 3.4 / (1.0 + 70.0 * u + 2450.0 * u * u));
    if (du < 0.0) h = min(h, (0.45 * u) / -du);

    bool inReach = uDiscEnabled > 0.5 && r > rLo && r < rHi;
    if (uDiscEnabled > 0.5 && !inReach) {
      // Approaching the disc from outside its radial range: do not step past
      // the edge, or a distant camera jumps straight into the middle of it.
      if (r > rHi && drdphi < 0.0) h = min(h, (r - rHi) / -drdphi);
      else if (r < rLo && drdphi > 0.0) h = min(h, (rLo - r) / drdphi);
    }

    // Everything below needs the ray's actual position. Most pixels are sky:
    // their rays never come near the disc and carry no bodies, so they skip
    // two transcendentals and a square root on every single step.
    bool needPos = inReach || uBodyCount > 0 || uJet > 0.0;
    vec3 pos = vec3(0.0);
    vec3 er = vec3(0.0);
    vec3 et = vec3(0.0);
    float dsdphi = r;
    float H = max(uDiscHeight, 0.015) * r;
    if (needPos) {
      float cp = cos(phi);
      float sp = sin(phi);
      er = cp * e1 + sp * e2;
      et = -sp * e1 + cp * e2;
      pos = r * er;

      float fr = max(1.0 - 2.0 / r, 1e-3);
      // Proper length and vertical drift per radian of orbital angle.
      dsdphi = sqrt(drdphi * drdphi / fr + r * r);
      float dydphi = abs(drdphi * er.y + r * et.y);

      if (uJet > 0.0) {
        // Keep steps short enough to resolve the jet's width.
        float zj = abs(pos.y);
        if (zj < uJetLength * 1.15) {
          float Rj = uJetBase * pow(max(zj, 1.0) / 10.0, uJetShape);
          if (length(pos.xz) < Rj * 1.6) h = min(h, (0.22 * Rj + 0.02 * r) / dsdphi);
        }
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
    }
    h = max(h, 2e-4);

    float u1, du1;
    rk4(u, du, h, u1, du1);
    float phi1 = phi + h;
    vec3 pos1 = pos;
    if (needPos) {
      float r1 = 1.0 / max(u1, 1e-6);
      pos1 = r1 * (cos(phi1) * e1 + sin(phi1) * e2);
    }

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

    if (uJet > 0.0 && needPos) {
      // Optically thin: the jet adds light along the ray without absorbing
      // any, so whatever lies behind it still shows through.
      vec3 seg = pos1 - pos;
      float segLen = length(seg);
      if (segLen > 1e-6) {
        vec3 travel = seg / segLen;
        vec3 jm = mix(pos, pos1, jitter);
        // travel runs away from the camera; the photon goes the other way.
        vec3 je = jetSample(jm, -travel);
        if (uEmission > 0.5) radio += dot(je, vec3(0.3333)) * segLen;
        else accum += trans * je * segLen;
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
      skyDir = normalize(out3);
      skyWeight = trans * mix(1.0, blue * blue, uRedshift);
      return accum;
    }
    if (uEmission < 0.5 && trans < 0.010) return accum;
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

  vec3 skyDir;
  float skyWeight;
  vec3 col = trace(uCamPos, rd, jitter, skyDir, skyWeight);

  if (uEmission > 0.5) {
    // Raw scalar intensity. The beam convolution and the false-colour map are
    // separate passes, so that the blur happens before the colouring.
    outColor = vec4(col, 1.0);
    return;
  }

  if (skyWeight > 0.0) {
    // How much sky this pixel covers, measured here in main rather than deep
    // inside the loop, because screen-space derivatives are only meaningful
    // in uniform control flow. Clamped because the map folds at the shadow
    // edge and neighbouring pixels can land arbitrarily far apart.
    float foot = 0.5 * (length(dFdx(skyDir)) + length(dFdy(skyDir)));
    col += skyWeight * skyColour(skyDir, min(foot, 0.08));
  }
  outColor = vec4(col * uGain, 1.0);
}
`;
