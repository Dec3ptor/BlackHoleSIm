/**
 * Shared simulation state: the black hole, its disc, the camera and a set of
 * test particles moving on exact Schwarzschild geodesics.
 *
 * All internal lengths are gravitational radii and all internal times are
 * r_g/c, so the geometry is mass-independent; the mass only enters when the
 * HUD converts to SI, and when the disc temperature is derived from a real
 * accretion rate.
 */
import {
  M_SUN, eddingtonAccretionRate, discPeakTemperature, timeUnit,
} from '../core/units.js';
import {
  R_ISCO, circularL, orbitFromApsides, particleStep,
  specificEnergy, effectivePotential,
} from '../core/geodesics.js';

export const PRESETS = {
  'm87-eht': {
    label: 'M87* — the EHT image',
    massSolar: 6.5e9,
    distanceMpc: 16.8,
    mdotEdd: 1e-5,
    blurb: 'The first black hole ever photographed, reconstructed the way the Event '
      + 'Horizon Telescope saw it in 2019: a 42 µas ring, ten times brighter than the '
      + 'depression inside it, and markedly brighter along the south. That asymmetry is '
      + 'real Doppler beaming of plasma orbiting at a large fraction of c, seen almost '
      + 'down the jet axis at 17°. Optically thin synchrotron at 230 GHz, false-coloured '
      + 'and blurred to the array\u2019s 20 µas beam.',
    disc: {
      inner: 3.6, outer: 12, height: 0.20, filament: 0.35, dust: 0,
      opacity: 1, brightness: 3.0, profile: 1, peakTempVisual: 5000,
      emission: 'synchrotron', emisIndex: 3.2, beamExp: 3.0, spin: -1,
    },
    optics: { doppler: 1, redshift: 1, stars: 0, nebula: 0, bloom: 0, exposure: 1.0 },
    // Rolled so the beamed side sits due south, matching the published
    // orientation: north up, east left, bright side at PA ~180 degrees.
    camera: { distance: 220, inclinationDeg: 17, azimuthDeg: 0, fovDeg: 11, rollDeg: -83 },
    toneMapping: 'none',
    beamUas: 20,
  },
  'sgr-a': {
    label: 'Sagittarius A*',
    massSolar: 4.297e6,
    distanceMpc: 0.008277,
    mdotEdd: 1e-7,
    blurb: 'The 4.3-million-solar-mass hole at the centre of the Milky Way. Its '
      + 'accretion flow is extraordinarily faint, so the disc here is scaled up to be visible.',
    disc: { inner: 6, outer: 22, opacity: 2.4, height: 0.055, filament: 0.85, dust: 0.4, brightness: 2.0, profile: 0.8, peakTempVisual: 5600 },
    camera: { distance: 46, inclinationDeg: 72, fovDeg: 55 },
  },
  'm87': {
    label: 'M87* — optical impression',
    massSolar: 6.5e9,
    distanceMpc: 16.8,
    mdotEdd: 1e-5,
    blurb: 'The galaxy whose jet has been tracked by VLBI for decades. Seen 17° off '
      + 'the jet axis, as M87 really is: the approaching jet is beamed towards us and '
      + 'the counter-jet is all but extinguished by the same factor working the other '
      + 'way. The jet is limb-brightened because its spine outruns its sheath.',
    disc: { inner: 6, outer: 18, opacity: 2.8, height: 0.07, filament: 0.8, dust: 0.35, brightness: 2.2, profile: 1.0, peakTempVisual: 6200 },
    jet: { enabled: true, power: 1.6 },
    // Shown side-on so the jet's structure and the beaming asymmetry are
    // visible. M87 is really viewed 17° off the jet axis - set the
    // inclination there and you are looking straight down the barrel, which
    // is exactly why its jet appears so bright and so foreshortened.
    camera: { distance: 155, inclinationDeg: 72, fovDeg: 46 },
  },
  'cygnus-x1': {
    label: 'Cygnus X-1',
    massSolar: 21.2,
    distanceMpc: 0.00222,
    mdotEdd: 0.02,
    blurb: 'A stellar-mass hole pulling gas from a blue supergiant companion. Its '
      + 'disc really does peak in soft X-rays at a few million kelvin.',
    disc: { inner: 6, outer: 26, opacity: 3.0, height: 0.04, filament: 0.9, dust: 0.5, brightness: 2.4, profile: 1.0, peakTempVisual: 7400 },
    camera: { distance: 52, inclinationDeg: 62, fovDeg: 50 },
  },
  'gargantua-real': {
    label: 'Gargantua + Doppler beaming',
    massSolar: 1e8,
    distanceMpc: 0,
    mdotEdd: 1e-4,
    blurb: 'The same disc as the film preset, but with the beaming and frequency shift '
      + 'the film left out. One limb is now several times brighter and bluer than the '
      + 'other, which is what a camera would really record - and exactly why Nolan had '
      + 'it removed.',
    disc: {
      inner: 6, outer: 34, opacity: 3.2, height: 0.028, filament: 0.90,
      dust: 0.70, brightness: 2.6, profile: 0.35, peakTempVisual: 3400,
      emission: 'thermal', emisIndex: 2.0, beamExp: 3.0, spin: 1,
    },
    optics: { doppler: 1, redshift: 1, stars: 0.5, nebula: 0.22, bloom: 0.55, exposure: 1 },
    camera: { distance: 62, inclinationDeg: 87, fovDeg: 46 },
    toneMapping: 'aces',
  },
  gargantua: {
    label: 'Gargantua (film)',
    massSolar: 1e8,
    mdotEdd: 1e-4,
    blurb: 'The Interstellar look: a wide, cool, nearly edge-on disc whose far side '
      + 'arches over the top and folds under the bottom. Doppler beaming is turned '
      + 'off here because the film deliberately left it out - with it on, one limb '
      + 'goes blindingly bright and the famous symmetry disappears.',
    disc: {
      inner: 6, outer: 34, opacity: 3.2, height: 0.028, filament: 0.90,
      dust: 0.70, brightness: 2.6, profile: 0.35, peakTempVisual: 3400,
      emission: 'thermal', emisIndex: 2.0, beamExp: 3.0, spin: 1,
    },
    toneMapping: 'aces',
    optics: { doppler: 0, redshift: 1, stars: 0.5, nebula: 0.22, bloom: 0.55, exposure: 1 },
    camera: { distance: 62, inclinationDeg: 87, fovDeg: 46 },
  },
};

export const DEFAULTS = {
  preset: 'gargantua',
  massSolar: 1e8,
  distanceMpc: 0,
  beamUas: 0,
  mdotEdd: 1e-4,

  gr: true,
  paused: false,
  // The disc starts already wound up; it has been orbiting a long time.
  simTime: 300,
  timeScale: 12,          // r_g/c per wall-clock second

  disc: {
    enabled: true,
    inner: R_ISCO,
    outer: 30,
    opacity: 3.2,
    height: 0.028,
    filament: 0.90,
    dust: 0.70,
    emission: 'thermal',
    emisIndex: 2.0,
    beamExp: 3.0,
    brightness: 2.6,
    profile: 0.35,
    spin: 1,
    peakTempVisual: 3400, // kelvin used for rendering in "normalised" mode
    trueTemperature: false,
  },

  // Relativistic jet. Defaults follow the VLBI measurements of M87: parabolic
  // collimation R ~ z^0.58, bulk flow accelerating as Gamma ~ z^0.42, and a
  // spine that outruns the sheath, which is what limb-brightens it.
  jet: {
    enabled: false,
    power: 1.6,
    inner: 3,
    length: 160,
    base: 6,
    shape: 0.58,
    gammaSpine: 10,
    gammaSheath: 2.6,
    accel: 300,
    beamExp: 2.7,
    falloff: 1.9,
    helix: 2.2,
    temperature: 13000,
  },

  optics: {
    doppler: 0,
    redshift: 1,
    stars: 0.5,
    nebula: 0.22,
    bloom: 0.55,
    exposure: 1.0,
  },

  quality: {
    steps: 300,
    stepScale: 1,
    renderScale: 0.85,
    maxPixelRatio: 1.5,
    adaptive: true,
  },

  camera: {
    distance: 62,
    inclinationDeg: 87,
    azimuthDeg: 0,
    fovDeg: 46,
    rollDeg: 0,
  },

  toneMapping: 'aces',
  radioGamma: 1.0,
  view: 'lensed',
  embedScale: 1.6,
  showMarkers: true,
  showRays: false,
  showParticles: true,
  showTrails: true,
};

/** Deep-ish clone good enough for the plain-object state above. */
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------------ *
 *  Test particles on exact timelike geodesics
 * ------------------------------------------------------------------ */

let nextId = 1;

/**
 * Create a test particle.
 *
 * @param {object} opt
 * @param {number} opt.rp        periapsis in r_g
 * @param {number} [opt.ra]      apoapsis in r_g (defaults to a circular orbit)
 * @param {number} [opt.inclinationDeg]
 * @param {number} [opt.nodeDeg] longitude of the ascending node
 * @param {number} [opt.phase]   starting true anomaly, radians
 */
export function makeParticle(opt) {
  const {
    rp, ra = rp, inclinationDeg = 0, nodeDeg = 0, phase = 0, rdot = 0,
    kind = 'marker', colour = '#9fd0ff', temperature = 9000, radius = 0.28, label = '',
  } = opt;

  const { L } = ra > rp ? orbitFromApsides(rp, ra) : { L: circularL(rp) };
  const inc = (inclinationDeg * Math.PI) / 180;
  const node = (nodeDeg * Math.PI) / 180;

  // Prograde equatorial basis, then tilted by the inclination and the node.
  const rot = (v) => {
    // rotate about x by inc, then about y by node
    const [x, y, z] = v;
    const y1 = y * Math.cos(inc) - z * Math.sin(inc);
    const z1 = y * Math.sin(inc) + z * Math.cos(inc);
    return [
      x * Math.cos(node) + z1 * Math.sin(node),
      y1,
      -x * Math.sin(node) + z1 * Math.cos(node),
    ];
  };

  return {
    id: nextId++,
    L,
    e1: rot([1, 0, 0]),
    e2: rot([0, 0, -1]),
    // [r, dr/dtau, phi, t]
    state: [rp, rdot, phase, 0],
    kind,
    colour,
    // Planets carry no emission temperature: the renderer lights them with
    // the disc instead, which is what puts the terminator facing the hole.
    temperature: kind === 'planet' ? 0 : temperature,
    radius,
    label,
    alive: true,
    trail: [],
    maxTrail: 900,
    rp,
    ra,
  };
}

/** World-space position of a particle, in gravitational radii. */
export function particlePosition(p) {
  const [r, , phi] = p.state;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return [
    r * (c * p.e1[0] + s * p.e2[0]),
    r * (c * p.e1[1] + s * p.e2[1]),
    r * (c * p.e1[2] + s * p.e2[2]),
  ];
}

/**
 * Advance one particle by `dt` of *coordinate* time, so that every particle
 * and the disc pattern share a single clock. Proper time runs slower deep in
 * the well, which is exactly what dt/dtau = E/(1-2M/r) encodes.
 */
export function advanceParticle(p, dt, gr = true) {
  if (!p.alive) return;
  let remaining = dt;
  let guard = 0;
  while (remaining > 1e-9 && guard++ < 64) {
    const [r, rdot] = p.state;
    if (r <= 2.02) { p.alive = false; return; }
    const E = specificEnergy(r, rdot, p.L);
    const dtdtau = E / Math.max(1 - 2 / r, 1e-4);
    // Keep the angular step small so the trail stays smooth near periapsis.
    const dtauMax = Math.min(0.04 * r * r / Math.max(p.L, 1e-3), 0.05 * r);
    const dtau = Math.min(remaining / dtdtau, dtauMax);
    p.state = particleStep(p.state, p.L, dtau, gr ? 1 : 0);
    remaining -= dtau * dtdtau;
    if (p.state[0] <= 2.02) { p.alive = false; return; }
  }
}

/** Diagnostics for the HUD. */
export function particleInfo(p) {
  const [r, rdot] = p.state;
  const E = specificEnergy(r, rdot, p.L);
  return {
    r,
    E,
    L: p.L,
    // dtau/dt for this particle, the honest "clock rate" at its location.
    clockRate: Math.max(0, (1 - 2 / r) / Math.max(E, 1e-6)),
    bound: E < 1,
    vEff: Math.sqrt(Math.max(0, effectivePotential(r, p.L))),
  };
}

/* ------------------------------------------------------------------ *
 *  Scenarios
 * ------------------------------------------------------------------ */

export const SCENARIOS = {
  'precession': {
    label: 'Perihelion precession',
    blurb: 'An eccentric orbit whose periapsis walks forward every revolution - the '
      + 'same effect that shifts Mercury by 43 arcseconds a century, enormously amplified here.',
    build: () => [
      makeParticle({ rp: 14, ra: 46, colour: '#ffd27f', temperature: 6200, label: 'eccentric' }),
    ],
  },
  'isco-plunge': {
    label: 'ISCO and plunge',
    blurb: 'Three circular orbits: one safely outside the innermost stable circular '
      + 'orbit, one right on it, one just inside - where no stable orbit exists and the plunge begins.',
    build: () => [
      makeParticle({ rp: 9, colour: '#8fe3ff', temperature: 11000, label: 'r = 9' }),
      makeParticle({ rp: 6, phase: 2.1, colour: '#b9ffb0', temperature: 7200, label: 'ISCO' }),
      // Circular orbits inside the ISCO are an unstable equilibrium: exactly
      // balanced, but the tiniest inward nudge and there is no way back.
      makeParticle({ rp: 5.6, phase: 4.2, rdot: -1e-3, colour: '#ff9a8f', temperature: 4200, label: 'r = 5.6' }),
    ],
  },
  'zoom-whirl': {
    label: 'Zoom-whirl orbit',
    blurb: 'A relativistic orbit that falls in, whirls several times just outside the '
      + 'photon sphere, then zooms back out. It has no Newtonian analogue at all.',
    build: () => [
      makeParticle({ rp: 4.10, ra: 120, colour: '#d8b4ff', temperature: 8000, label: 'zoom-whirl' }),
    ],
  },
  's-stars': {
    label: 'S-star cluster',
    blurb: 'A handful of inclined eccentric orbits, in the spirit of the S-stars that '
      + 'circle Sagittarius A* and won the 2020 Nobel Prize.',
    build: () => [
      makeParticle({ rp: 18, ra: 60, inclinationDeg: 24, nodeDeg: 10, colour: '#bcd6ff', temperature: 15000 }),
      makeParticle({ rp: 26, ra: 44, inclinationDeg: -38, nodeDeg: 120, phase: 1.4, colour: '#ffe2b0', temperature: 5400 }),
      makeParticle({ rp: 12, ra: 90, inclinationDeg: 62, nodeDeg: 230, phase: 3.0, colour: '#ffc0c8', temperature: 3800 }),
      makeParticle({ rp: 34, inclinationDeg: 8, nodeDeg: 300, phase: 0.6, colour: '#c9fff0', temperature: 21000 }),
    ],
  },
  planets: {
    label: 'Planets',
    blurb: 'Worlds on real geodesic orbits, lit only by the accretion disc and lensed '
      + 'along with everything else - so each one can appear twice when it passes '
      + 'behind the hole. Being this close, they are tidally locked, and the one '
      + 'nearest the hole runs its clock far slower than the outer one.',
    build: () => [
      makeParticle({
        rp: 34, kind: 'planet', radius: 0.85, colour: '#8ea4bd',
        inclinationDeg: 34, nodeDeg: 20, phase: 1.15, label: 'inner world',
      }),
      makeParticle({
        rp: 52, ra: 68, kind: 'planet', radius: 1.45, colour: '#b9a488',
        inclinationDeg: 13, nodeDeg: 210, phase: 3.9, label: 'outer world',
      }),
    ],
  },
  'none': { label: 'No test particles', blurb: '', build: () => [] },
};

/* ------------------------------------------------------------------ *
 *  State container
 * ------------------------------------------------------------------ */

export function createState() {
  const s = clone(DEFAULTS);
  s.scenario = 'isco-plunge';
  s.particles = SCENARIOS[s.scenario].build();
  return s;
}

/** Peak disc temperature in kelvin from the real accretion physics. */
export function physicalDiscTemperature(state) {
  const M = state.massSolar * M_SUN;
  const mdot = eddingtonAccretionRate(M) * state.mdotEdd;
  return discPeakTemperature(M, mdot, state.disc.inner);
}

/** Temperature the renderer should actually use for the disc peak. */
export function renderDiscTemperature(state) {
  return state.disc.trueTemperature
    ? Math.max(700, physicalDiscTemperature(state))
    : state.disc.peakTempVisual;
}

/** Seconds of real black-hole time per second of simulation, for the HUD. */
export function secondsPerSimUnit(state) {
  return timeUnit(state.massSolar * M_SUN);
}

export function applyPreset(state, key) {
  const p = PRESETS[key];
  if (!p) return state;
  state.preset = key;
  state.massSolar = p.massSolar;
  state.mdotEdd = p.mdotEdd;
  state.distanceMpc = p.distanceMpc ?? 0;
  state.beamUas = p.beamUas ?? 0;
  state.toneMapping = p.toneMapping ?? 'aces';
  Object.assign(state.disc, p.disc);
  Object.assign(state.camera, p.camera);
  if (p.optics) Object.assign(state.optics, p.optics);
  state.jet.enabled = false;
  if (p.jet) Object.assign(state.jet, p.jet);
  return state;
}

export function applyScenario(state, key) {
  const s = SCENARIOS[key] || SCENARIOS.none;
  state.scenario = key;
  state.particles = s.build();
  return state;
}

export function advance(state, wallDt) {
  if (state.paused) return;
  const dt = Math.min(wallDt, 0.1) * state.timeScale;
  state.simTime += dt;
  for (const p of state.particles) {
    advanceParticle(p, dt, state.gr);
    if (p.alive) {
      const pos = particlePosition(p);
      const t = p.trail;
      const last = t.length >= 3 ? [t[t.length - 3], t[t.length - 2], t[t.length - 1]] : null;
      // Space trail points by a fixed fraction of the current radius so wide
      // orbits keep a full revolution of history without wasting vertices.
      const minStep = Math.max(0.05, 0.012 * p.state[0]) ** 2;
      if (!last || (pos[0] - last[0]) ** 2 + (pos[1] - last[1]) ** 2 + (pos[2] - last[2]) ** 2 > minStep) {
        t.push(pos[0], pos[1], pos[2]);
        if (t.length > p.maxTrail * 3) t.splice(0, t.length - p.maxTrail * 3);
      }
    }
  }
}
