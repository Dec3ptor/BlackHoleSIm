/**
 * Exact Schwarzschild geodesic integrators.
 *
 * Everything here uses geometrised units with the mass set to one, so
 * lengths are gravitational radii r_g = GM/c^2:
 *
 *   event horizon   r = 2
 *   photon sphere   r = 3
 *   ISCO            r = 6
 *
 * Because the Schwarzschild geometry is spherically symmetric every geodesic
 * stays in the plane spanned by the initial position and velocity, so the
 * integrators below work in that plane and the caller maps the result back
 * into 3D with an orthonormal basis (e1, e2).
 *
 * The photon routine here is a line-for-line twin of the GLSL integrator in
 * `src/render/lensingShader.js`; the tests in `tests/physics.test.mjs` pin it
 * against the closed-form results of general relativity.
 */

export const R_HORIZON = 2;
export const R_PHOTON_SPHERE = 3;
export const R_ISCO = 6;

/** Critical impact parameter for photon capture, b_c = 3*sqrt(3) M. */
export const B_CRITICAL = 3 * Math.sqrt(3);

/* ------------------------------------------------------------------ *
 *  Null geodesics
 * ------------------------------------------------------------------ */

/**
 * Binet equation for a photon in Schwarzschild spacetime, written for the
 * inverse radius u = 1/r as a function of the orbital angle phi:
 *
 *     d^2u/dphi^2 = -u + 3 M u^2
 *
 * With `gr = 0` the 3Mu^2 term disappears and the solution is an exact
 * straight line, which is what the renderer's "Newtonian" comparison uses.
 */
export const photonAccel = (u, gr = 1) => -u + 3 * gr * u * u;

/** One classical Runge-Kutta 4 step of the Binet equation. */
export function photonStep(u, du, h, gr = 1) {
  const k1u = du;
  const k1d = photonAccel(u, gr);
  const k2u = du + 0.5 * h * k1d;
  const k2d = photonAccel(u + 0.5 * h * k1u, gr);
  const k3u = du + 0.5 * h * k2d;
  const k3d = photonAccel(u + 0.5 * h * k2u, gr);
  const k4u = du + h * k3d;
  const k4d = photonAccel(u + h * k3u, gr);
  return [
    u + (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u),
    du + (h / 6) * (k1d + 2 * k2d + 2 * k3d + k4d),
  ];
}

/**
 * Impact parameter b = L/E of a photon that a *static* observer at radius
 * `r` sends out at an angle `psi` from the outward radial direction.
 *
 *     b = r sin(psi) / sqrt(1 - 2M/r)
 */
export const impactParameter = (r, sinPsi) => (r * sinPsi) / Math.sqrt(1 - 2 / r);

/**
 * Initial du/dphi for that same photon. The factor sqrt(1 - 2M/r) is the
 * radial stretch between the static observer's orthonormal frame and the
 * Schwarzschild coordinate basis - leaving it out is the single most common
 * way to get a lensing renderer subtly wrong.
 */
export const initialDuDphi = (r, cosPsi, sinPsi) =>
  (-cosPsi * Math.sqrt(1 - 2 / r)) / (r * sinPsi);

/**
 * Trace a photon backwards from a static observer.
 *
 * @param {number} r0      emission radius in r_g
 * @param {number} psi     angle between the ray and the outward radial
 *                         direction, in radians (0 < psi < pi)
 * @param {object} [opt]
 * @returns {{outcome:'captured'|'escaped'|'maxed', phi:number, phiInf:number,
 *            deflection:number, b:number, rMin:number, samples:Array}}
 */
export function tracePhoton(r0, psi, opt = {}) {
  const {
    gr = 1,
    maxSteps = 20000,
    baseStep = 0.004,
    escapeRadius = Math.max(1e4, 4 * r0),
    collect = false,
  } = opt;

  const sinPsi = Math.sin(psi);
  const cosPsi = Math.cos(psi);
  const b = impactParameter(r0, sinPsi);

  let u = 1 / r0;
  let du = initialDuDphi(r0, cosPsi, sinPsi);
  let phi = 0;
  let rMin = r0;
  const samples = collect ? [{ phi: 0, r: r0 }] : null;
  const uEscape = 1 / escapeRadius;

  for (let i = 0; i < maxSteps; i++) {
    // Larger steps where spacetime is nearly flat, fine steps near the hole.
    const h = baseStep * (1 + 40 * Math.exp(-60 * u));
    const [un, dun] = photonStep(u, du, h, gr);
    u = un;
    du = dun;
    phi += h;
    if (u > 0) rMin = Math.min(rMin, 1 / u);
    if (collect && i % 8 === 0) samples.push({ phi, r: 1 / u });

    if (u >= 0.5) {
      return { outcome: 'captured', phi, phiInf: phi, deflection: NaN, b, rMin, samples };
    }
    if (u <= uEscape && du < 0) {
      // Far from the hole the solution is u = A sin(phiInf - phi), so
      // tan(phiInf - phi) = u / (-du). Using atan rather than the small-angle
      // form makes the asymptote exact for a straight line and lets the
      // integration stop at a modest radius - which is what keeps the GPU
      // version cheap without smearing the star field.
      const phiInf = phi + Math.atan2(u, -du);
      return {
        outcome: 'escaped',
        phi,
        phiInf,
        // An unbent ray launched at psi from the outward radial sweeps
        // exactly psi before reaching infinity, so the excess is the bend.
        deflection: phiInf - psi,
        b,
        rMin,
        samples,
      };
    }
  }
  return { outcome: 'maxed', phi, phiInf: phi, deflection: NaN, b, rMin, samples };
}

/**
 * Total light deflection for a ray that comes in from infinity with impact
 * parameter `b` and goes back out to infinity. Integrated from the turning
 * point outwards and doubled, which is numerically far kinder than starting
 * at r = infinity.
 */
export function lightDeflection(b) {
  if (b <= B_CRITICAL) return Infinity;
  // Turning point: 1/b^2 = u^2 (1 - 2u). Newton-solve for the root below 1/3.
  let uT = 1 / b;
  for (let i = 0; i < 100; i++) {
    const f = uT * uT * (1 - 2 * uT) - 1 / (b * b);
    const df = 2 * uT - 6 * uT * uT;
    const next = uT - f / df;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - uT) < 1e-16) { uT = next; break; }
    uT = next;
  }

  // Integrate outwards from the turning point, where du/dphi vanishes.
  let u = uT;
  let du = 0;
  let phi = 0;
  const uEscape = 1e-4 / b;
  for (let i = 0; i < 2000000; i++) {
    let h = 2e-4 * (1 + 40 * Math.exp(-60 * u));
    // Never step more than a fraction of the way down to u = 0, so the
    // integration converges onto the asymptote instead of jumping past it.
    if (du < 0) h = Math.min(h, (0.25 * u) / -du);
    [u, du] = photonStep(u, du, h, 1);
    phi += h;
    if (u >= 0.5) return Infinity;
    if (u <= uEscape && du < 0) {
      phi += Math.atan2(u, -du); // exact asymptote for the straight-line tail
      // Half the trajectory; a straight line would sweep exactly pi/2.
      return 2 * phi - Math.PI;
    }
  }
  return NaN;
}

/** Weak-field expansion of the deflection angle, alpha ~ 4M/b + 15 pi M^2 / (4 b^2). */
export const lightDeflectionWeakField = (b) =>
  4 / b + (15 * Math.PI) / (4 * b * b);

/* ------------------------------------------------------------------ *
 *  Timelike geodesics (massive test particles)
 * ------------------------------------------------------------------ */

/**
 * Radial acceleration of a massive test particle with conserved specific
 * angular momentum L, parametrised by proper time:
 *
 *     d^2r/dtau^2 = -M/r^2 + L^2/r^3 - 3 M L^2 / r^4
 *
 * The last term is the general-relativistic correction; drop it and you get
 * Newton, which is exactly what the "GR off" toggle does. It is also the
 * term responsible for perihelion precession and for the existence of the
 * ISCO.
 */
export function radialAccel(r, L, gr = 1) {
  const r2 = r * r;
  return -1 / r2 + (L * L) / (r2 * r) - (3 * gr * L * L) / (r2 * r2);
}

/** Conserved specific energy E = -u_t of a particle with state (r, rdot, L). */
export function specificEnergy(r, rdot, L) {
  return Math.sqrt(Math.max(1e-12, rdot * rdot + (1 - 2 / r) * (1 + (L * L) / (r * r))));
}

/** Effective potential V(r)^2 = (1 - 2M/r)(1 + L^2/r^2). */
export const effectivePotential = (r, L) => (1 - 2 / r) * (1 + (L * L) / (r * r));

/** Specific angular momentum of a circular orbit at radius r (needs r > 3). */
export function circularL(r) {
  if (r <= 3) return NaN;
  return Math.sqrt((r * r) / (r - 3));
}

/** Specific energy of a circular orbit at radius r. */
export function circularE(r) {
  if (r <= 3) return NaN;
  return (1 - 2 / r) / Math.sqrt(1 - 3 / r);
}

/**
 * dphi/dtau for a circular orbit at r: L/r^2. Coordinate angular velocity
 * dphi/dt is sqrt(M/r^3).
 */
export const circularOmega = (r) => 1 / Math.pow(r, 1.5);

/**
 * L and initial radial velocity for an orbit with apoapsis `ra` and
 * periapsis `rp` (both in r_g). Uses the exact Schwarzschild turning-point
 * condition E^2 = V(ra)^2 = V(rp)^2.
 */
export function orbitFromApsides(rp, ra) {
  if (ra <= rp) return { L: circularL(rp), E: circularE(rp) };
  // (1-2/rp)(1+L^2/rp^2) = (1-2/ra)(1+L^2/ra^2)  ->  solve for L^2
  const a = (1 - 2 / rp) / (rp * rp);
  const b = (1 - 2 / ra) / (ra * ra);
  const L2 = ((1 - 2 / ra) - (1 - 2 / rp)) / (a - b);
  const L = Math.sqrt(Math.max(0, L2));
  return { L, E: Math.sqrt(effectivePotential(rp, L)) };
}

/**
 * One RK4 step of the timelike radial equation. State is [r, rdot, phi, t]
 * with tau as the independent variable.
 */
export function particleStep(state, L, h, gr = 1) {
  const deriv = (s) => {
    const r = Math.max(s[0], 1e-6);
    return [
      s[1],
      radialAccel(r, L, gr),
      L / (r * r),
      // dt/dtau = E / (1 - 2M/r); E is conserved so we recompute it cheaply.
      specificEnergy(r, s[1], L) / Math.max(1 - 2 / r, 1e-6),
    ];
  };
  const add = (s, d, f) => [s[0] + d[0] * f, s[1] + d[1] * f, s[2] + d[2] * f, s[3] + d[3] * f];
  const k1 = deriv(state);
  const k2 = deriv(add(state, k1, h / 2));
  const k3 = deriv(add(state, k2, h / 2));
  const k4 = deriv(add(state, k3, h));
  return [
    state[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    state[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    state[2] + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
    state[3] + (h / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]),
  ];
}

/**
 * Periapsis advance per radial oscillation for an orbit between rp and ra.
 * Returns the extra angle beyond 2*pi, in radians.
 */
export function precessionPerOrbit(rp, ra, opt = {}) {
  const { steps = 400000 } = opt;
  const { L } = orbitFromApsides(rp, ra);
  let state = [rp, 0, 0, 0];
  const h = (0.02 * Math.pow(ra, 1.5)) / 200;
  let rising = true;
  let turns = 0;
  let phiStart = 0;
  for (let i = 0; i < steps; i++) {
    const next = particleStep(state, L, h, 1);
    const wasRising = rising;
    rising = next[0] > state[0];
    if (wasRising && !rising) {
      // apoapsis
    } else if (!wasRising && rising && i > 10) {
      // periapsis: one full radial period
      turns++;
      if (turns === 1) return next[2] - phiStart - 2 * Math.PI;
    }
    state = next;
  }
  return NaN;
}

/** Closed-form weak-field precession: 6 pi M / (a (1 - e^2)). */
export function precessionWeakField(rp, ra) {
  const a = (rp + ra) / 2;
  const e = (ra - rp) / (ra + rp);
  return (6 * Math.PI) / (a * (1 - e * e));
}

/* ------------------------------------------------------------------ *
 *  Observed frequency shift of disc material
 * ------------------------------------------------------------------ */

/**
 * Combined gravitational + Doppler shift g = nu_observed / nu_emitted for
 * material on a circular geodesic orbit at radius `r`, seen by a static
 * observer at `rObs`:
 *
 *     g = sqrt(1 - 3M/r) / [ sqrt(1 - 2M/rObs) (1 + Omega b n_y) ]
 *
 * `b` is the impact parameter of the backwards-traced ray and `ny` is the
 * y-component of its orbital-plane normal, so `b*ny` is the ray's angular
 * momentum about the disc axis. `spin` is +1 for prograde rotation.
 */
export function redshiftFactor(r, b, ny, rObs, spin = 1) {
  const omega = (spin * 1) / Math.pow(r, 1.5);
  const denom = 1 + omega * b * ny;
  const num = Math.sqrt(Math.max(0, 1 - 3 / r));
  const obs = Number.isFinite(rObs) ? Math.sqrt(Math.max(1e-6, 1 - 2 / rObs)) : 1;
  return num / (obs * (Math.abs(denom) < 1e-6 ? 1e-6 : denom));
}

/** Flamm's paraboloid: exact isometric embedding of the equatorial slice. */
export function flammDepth(r, rs = 2) {
  if (r <= rs) return 2 * rs;
  return 2 * Math.sqrt(rs * (r - rs));
}
