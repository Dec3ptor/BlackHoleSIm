/**
 * Pins the geodesic integrators against closed-form general relativity.
 * Run with:  node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  B_CRITICAL, R_ISCO, R_PHOTON_SPHERE,
  tracePhoton, lightDeflection, lightDeflectionWeakField,
  impactParameter, circularL, circularE, circularOmega,
  radialAccel, effectivePotential, orbitFromApsides,
  precessionPerOrbit, precessionWeakField, redshiftFactor, flammDepth,
} from '../src/core/geodesics.js';
import {
  M_SUN, G, C, YEAR, gravitationalRadius, schwarzschildRadius,
  localOrbitalSpeed, orbitingTimeDilation, orbitalPeriod,
} from '../src/core/units.js';

const close = (a, b, rel, msg) =>
  assert.ok(Math.abs(a - b) <= rel * Math.abs(b),
    `${msg}: got ${a}, expected ${b} (rel tol ${rel})`);

test('critical impact parameter is 3*sqrt(3) M', () => {
  close(B_CRITICAL, 5.196152422706632, 1e-12, 'b_crit');
});

test('photons just outside b_crit escape, just inside are captured', () => {
  // A ray aimed from r0 with sin(psi) chosen to give the wanted b.
  const r0 = 5000;
  const bOf = (b) => Math.asin((b * Math.sqrt(1 - 2 / r0)) / r0);
  const inward = (psi) => Math.PI - psi; // pointing towards the hole

  const escaped = tracePhoton(r0, inward(bOf(B_CRITICAL * 1.01)));
  const captured = tracePhoton(r0, inward(bOf(B_CRITICAL * 0.99)));
  assert.equal(escaped.outcome, 'escaped');
  assert.equal(captured.outcome, 'captured');
});

test('a grazing photon turns around just outside the photon sphere', () => {
  const r0 = 5000;
  const b = B_CRITICAL * 1.0005;
  const psi = Math.PI - Math.asin((b * Math.sqrt(1 - 2 / r0)) / r0);
  const res = tracePhoton(r0, psi);
  assert.equal(res.outcome, 'escaped');
  close(res.rMin, R_PHOTON_SPHERE, 0.02, 'turning point near photon sphere');
});

test('weak-field deflection matches 4M/b + 15 pi M^2 / 4b^2', () => {
  for (const b of [200, 1000, 5000]) {
    close(lightDeflection(b), lightDeflectionWeakField(b), 2e-3, `deflection at b=${b}`);
  }
});

test('deflection diverges as b approaches b_crit', () => {
  const a1 = lightDeflection(B_CRITICAL * 1.2);
  const a2 = lightDeflection(B_CRITICAL * 1.001);
  assert.ok(a2 > a1 && a2 > 2 * Math.PI, `expected strong winding, got ${a2}`);
  assert.equal(lightDeflection(B_CRITICAL * 0.999), Infinity);
});

test('light grazing the Sun is deflected by 1.75 arcsec', () => {
  const R_SUN = 6.957e8;
  const b = R_SUN / gravitationalRadius(M_SUN);
  const arcsec = (lightDeflection(b) * 180 * 3600) / Math.PI;
  close(arcsec, 1.7512, 2e-3, 'solar light deflection');
});

test('backwards-traced photon reproduces the analytic deflection', () => {
  // Started far enough out that the bend accumulated beyond r0 is negligible.
  const r0 = 1e7;
  const b = 40;
  const psi = Math.PI - Math.asin((b * Math.sqrt(1 - 2 / r0)) / r0);
  const res = tracePhoton(r0, psi, { escapeRadius: 1e9 });
  close(res.b, b, 1e-6, 'impact parameter bookkeeping');
  close(res.deflection, lightDeflection(b), 1e-3, 'deflection from ray trace');
});

test('the outgoing direction converges by r = 150, which is what the GPU uses', () => {
  // The shader stops integrating at a finite radius and jumps to the
  // asymptote. This pins how much that shortcut costs in star position.
  const r0 = 30;
  for (const b of [7, 12, 25]) {
    const psi = Math.PI - Math.asin((b * Math.sqrt(1 - 2 / r0)) / r0);
    const exact = tracePhoton(r0, psi, { escapeRadius: 1e7 }).phiInf;
    const cheap = tracePhoton(r0, psi, { escapeRadius: 150 }).phiInf;
    assert.ok(Math.abs(exact - cheap) < 2e-5,
      `escape-radius error at b=${b} is ${Math.abs(exact - cheap)} rad`);
  }
});

test('impact parameter includes the static-observer redshift factor', () => {
  // A tangential ray (psi = pi/2) at r = 4 has b = 4/sqrt(1/2) = 5.657 > b_crit.
  close(impactParameter(4, 1), 4 / Math.sqrt(0.5), 1e-12, 'b at r=4');
  assert.ok(impactParameter(3, 1) - B_CRITICAL < 1e-9,
    'a tangential ray at the photon sphere has exactly b_crit');
});

test('circular-orbit constants match the textbook ISCO values', () => {
  close(circularL(R_ISCO), 2 * Math.sqrt(3), 1e-12, 'L_isco');
  close(circularE(R_ISCO), Math.sqrt(8 / 9), 1e-12, 'E_isco');
  close(circularOmega(R_ISCO), 1 / Math.pow(6, 1.5), 1e-12, 'Omega_isco');
});

test('circular orbits are force-free and no circular orbit exists at r<3', () => {
  for (const r of [6, 10, 100]) {
    const L = circularL(r);
    assert.ok(Math.abs(radialAccel(r, L)) < 1e-14, `not force free at r=${r}`);
  }
  assert.ok(Number.isNaN(circularL(2.9)), 'no circular orbit inside the photon sphere');
});

test('the ISCO is exactly where circular orbits stop being stable', () => {
  // d^2V/dr^2 changes sign at r = 6.
  const curvature = (r) => {
    const L = circularL(r);
    const d = 1e-4;
    return (effectivePotential(r + d, L) - 2 * effectivePotential(r, L)
      + effectivePotential(r - d, L)) / (d * d);
  };
  assert.ok(curvature(6.5) > 0, 'orbits outside the ISCO are stable');
  assert.ok(curvature(5.5) < 0, 'orbits inside the ISCO are unstable');
  assert.ok(Math.abs(curvature(R_ISCO)) < 1e-5, 'marginal stability at r=6');
});

test('orbitFromApsides reproduces the requested turning points', () => {
  const rp = 12, ra = 40;
  const { L } = orbitFromApsides(rp, ra);
  close(effectivePotential(rp, L), effectivePotential(ra, L), 1e-12, 'equal potential at apsides');
});

test('numerical precession matches 6 pi M / a(1-e^2) in the weak field', () => {
  const rp = 300, ra = 360;
  const numeric = precessionPerOrbit(rp, ra);
  close(numeric, precessionWeakField(rp, ra), 2e-2, 'precession');
});

test("Mercury's perihelion advances by 43 arcsec per century", () => {
  const rg = gravitationalRadius(M_SUN);
  const a = 5.790905e10 / rg;
  const e = 0.205630;
  const rp = a * (1 - e), ra = a * (1 + e);
  const perOrbit = precessionWeakField(rp, ra);
  const period = 87.9691 * 86400;
  const perCentury = (perOrbit * (100 * YEAR)) / period;
  close((perCentury * 180 * 3600) / Math.PI, 42.98, 3e-3, 'Mercury precession');
});

test('the approaching side of the disc is blueshifted and the receding side is not', () => {
  const rObs = 1e6;
  // ny < 0 with prograde spin is the approaching limb (see redshiftFactor docs).
  const approaching = redshiftFactor(12, 12, -1, rObs, +1);
  const receding = redshiftFactor(12, 12, +1, rObs, +1);
  assert.ok(approaching > 1, `approaching limb should be blueshifted, got ${approaching}`);
  assert.ok(receding < 1, `receding limb should be redshifted, got ${receding}`);
  // Flipping the disc's rotation swaps the two.
  close(redshiftFactor(12, 12, -1, rObs, -1), receding, 1e-12, 'retrograde symmetry');
});

test('a face-on disc shows pure gravitational redshift', () => {
  // b*ny = 0 means the ray carries no angular momentum about the disc axis.
  close(redshiftFactor(20, 0, 0, Infinity), Math.sqrt(1 - 3 / 20), 1e-12, 'face-on g');
  assert.ok(redshiftFactor(20, 0, 0, Infinity) < 1, 'light from the disc climbs out redshifted');
});

test('local orbital speed at the ISCO is exactly c/2', () => {
  close(localOrbitalSpeed(R_ISCO), 0.5, 1e-12, 'v_isco');
  close(orbitingTimeDilation(R_ISCO), Math.sqrt(0.5), 1e-12, 'dtau/dt at the ISCO');
});

test("Flamm's paraboloid meets the horizon vertically and flattens far away", () => {
  const rs = 2;
  assert.ok(flammDepth(rs + 1e-12, rs) < 1e-5, 'zero depth at the horizon');
  // dz/dr = sqrt(rs/(r-rs)) -> infinite at the horizon, -> 0 far away.
  const slope = (r) => (flammDepth(r + 1e-6, rs) - flammDepth(r, rs)) / 1e-6;
  assert.ok(slope(rs + 1e-4) > 100, 'vertical at the horizon');
  assert.ok(slope(1e6) < 1e-2, 'asymptotically flat');
  close(flammDepth(10, 2), 2 * Math.sqrt(2 * 8), 1e-12, 'closed form');
});

test('Sgr A* scaling relations agree with the observed numbers', () => {
  const M = 4.297e6 * M_SUN;
  close(schwarzschildRadius(M), 1.269e10, 2e-3, 'r_s of Sgr A*');
  // The shadow diameter is 2*sqrt(27) r_g ~ 10.4 r_g.
  close(2 * B_CRITICAL, 10.392, 1e-3, 'shadow diameter in r_g');
  // ISCO period ~ 30 minutes, matching the observed infrared flare timescale.
  const P = orbitalPeriod(M, R_ISCO);
  assert.ok(P > 25 * 60 && P < 40 * 60, `ISCO period ${P / 60} min`);
});

/* ------------------------------------------------------------------ *
 *  Black-body colour
 * ------------------------------------------------------------------ */

import {
  planck, wienPeak, blackbodyXYZ, blackbodyRGB, buildBlackbodyLut,
} from '../src/core/blackbody.js';

const chromaticity = (T) => {
  const [X, Y, Z] = blackbodyXYZ(T);
  const s = X + Y + Z;
  return [X / s, Y / s];
};

test("Wien's displacement law puts the Sun's peak at 500 nm", () => {
  close(wienPeak(5772) * 1e9, 502.0, 2e-3, 'solar peak wavelength');
  // Planck's law must actually peak there too.
  const peak = wienPeak(5772);
  assert.ok(planck(peak, 5772) > planck(peak * 0.8, 5772));
  assert.ok(planck(peak, 5772) > planck(peak * 1.25, 5772));
});

test('black-body chromaticities sit on the Planckian locus', () => {
  // CIE Illuminant A is by definition a Planckian radiator at 2856 K.
  const [x, y] = chromaticity(2856);
  assert.ok(Math.hypot(x - 0.44757, y - 0.40745) < 0.004,
    `Illuminant A: got (${x.toFixed(4)}, ${y.toFixed(4)})`);
  for (const [T, x0, y0] of [[5000, 0.3451, 0.3516], [6504, 0.3135, 0.3237], [10000, 0.2807, 0.2884]]) {
    const [cx, cy] = chromaticity(T);
    assert.ok(Math.hypot(cx - x0, cy - y0) < 0.004, `locus at ${T} K`);
  }
});

test('hotter black bodies are bluer and colder ones redder', () => {
  const cold = blackbodyRGB(2000);
  const hot = blackbodyRGB(20000);
  assert.ok(cold[0] > cold[2], 'a 2000 K body is red-dominant');
  assert.ok(hot[2] > hot[0], 'a 20000 K body is blue-dominant');
  // Normalised to unit Rec.709 luminance, by construction.
  for (const rgb of [cold, hot, blackbodyRGB(6000)]) {
    close(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], 1, 1e-9, 'unit luminance');
  }
});

test('the shader lookup table is finite, positive and monotone in hue', () => {
  const lut = buildBlackbodyLut(64, 500, 120000);
  assert.equal(lut.data.length, 64 * 4);
  for (let i = 0; i < 64; i++) {
    for (let c = 0; c < 3; c++) {
      const v = lut.data[i * 4 + c];
      assert.ok(Number.isFinite(v) && v >= 0, `LUT entry ${i} channel ${c} is ${v}`);
    }
  }
  const blueOverRed = (i) => lut.data[i * 4 + 2] / Math.max(lut.data[i * 4], 1e-6);
  assert.ok(blueOverRed(63) > blueOverRed(0), 'blue/red rises with temperature');
});
