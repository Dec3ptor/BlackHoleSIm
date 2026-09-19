/**
 * Heads-up readouts. Everything here is computed from the same state the
 * renderer uses, converted into SI units for the chosen mass.
 */
import {
  M_SUN, schwarzschildRadius, gravitationalRadius, timeUnit,
  hawkingTemperature, evaporationTime, eddingtonLuminosity, tidalAcceleration,
  orbitalPeriod, localOrbitalSpeed, staticTimeDilation,
  formatLength, formatTime, formatMass, L_SUN,
} from '../core/units.js';
import { B_CRITICAL, R_ISCO } from '../core/geodesics.js';
import { physicalDiscTemperature, particleInfo } from '../sim/simulation.js';
import { blackbodyCss } from '../core/blackbody.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export function createHud(root, state) {
  root.innerHTML = '';
  const groups = {};

  function group(title) {
    const box = el('div', 'hud-group');
    box.append(el('h3', null, title));
    const dl = el('dl');
    box.append(dl);
    root.append(box);
    groups[title] = dl;
    return dl;
  }

  const rows = new Map();
  function line(dl, key, label) {
    const dt = el('dt', null, label);
    const dd = el('dd', null, '—');
    dl.append(dt, dd);
    rows.set(key, dd);
  }

  const gHole = group('Black hole');
  line(gHole, 'mass', 'Mass');
  line(gHole, 'rs', 'Schwarzschild radius');
  line(gHole, 'shadow', 'Shadow diameter');
  line(gHole, 'isco', 'ISCO');
  line(gHole, 'iscoP', 'ISCO period');
  line(gHole, 'hawking', 'Hawking temperature');
  line(gHole, 'evap', 'Evaporation time');

  const gObs = group('Observer');
  line(gObs, 'dist', 'Distance');
  line(gObs, 'dilation', 'Clock rate dτ/dt');
  line(gObs, 'angsize', 'Shadow angular size');
  line(gObs, 'tidal', 'Tidal stretch on a person');

  const gDisc = group('Accretion disc');
  line(gDisc, 'mdot', 'Accretion rate');
  line(gDisc, 'lum', 'Luminosity');
  line(gDisc, 'peakT', 'Peak temperature');
  line(gDisc, 'peakBand', 'Peaks in');
  line(gDisc, 'vIsco', 'Speed at inner edge');

  const gSim = group('Simulation');
  line(gSim, 'simtime', 'Elapsed (hole time)');
  line(gSim, 'fps', 'Performance');
  line(gSim, 'res', 'Resolution');

  const gPart = group('Test particles');
  const partList = el('div', 'particle-list');
  gPart.parentElement.append(partList);

  const setv = (k, v) => { const n = rows.get(k); if (n) n.textContent = v; };

  function band(T) {
    const peakNm = (2.897771955e-3 / T) * 1e9;
    if (peakNm < 10) return `X-rays (${peakNm.toFixed(2)} nm)`;
    if (peakNm < 400) return `ultraviolet (${peakNm.toFixed(0)} nm)`;
    if (peakNm < 700) return `visible (${peakNm.toFixed(0)} nm)`;
    if (peakNm < 1e6) return `infrared (${(peakNm / 1000).toFixed(1)} µm)`;
    return `radio (${(peakNm / 1e6).toFixed(1)} mm)`;
  }

  /** Values that only change when a control moves. */
  function refresh() {
    const M = state.massSolar * M_SUN;
    const rg = gravitationalRadius(M);

    setv('mass', formatMass(M));
    setv('rs', formatLength(schwarzschildRadius(M)));
    setv('shadow', `${(2 * B_CRITICAL).toFixed(2)} r_g = ${formatLength(2 * B_CRITICAL * rg)}`);
    setv('isco', `6 r_g = ${formatLength(R_ISCO * rg)}`);
    setv('iscoP', formatTime(orbitalPeriod(M, R_ISCO)));
    setv('hawking', `${hawkingTemperature(M).toExponential(2)} K`);
    setv('evap', formatTime(evaporationTime(M)));

    const mdotKg = (eddingtonLuminosity(M) / (0.1 * 299792458 ** 2)) * state.mdotEdd;
    setv('mdot', `${state.mdotEdd.toExponential(1)} Ṁ_Edd = ${(mdotKg / (M_SUN / 3.15576e7)).toExponential(2)} M☉/yr`);
    setv('lum', `${(eddingtonLuminosity(M) * state.mdotEdd / L_SUN).toExponential(2)} L☉`);

    const T = physicalDiscTemperature(state);
    const dd = rows.get('peakT');
    if (dd) {
      dd.textContent = `${T.toExponential(2)} K`;
      dd.style.borderBottom = `2px solid ${blackbodyCss(Math.max(T, 800))}`;
    }
    setv('peakBand', band(Math.max(T, 1)));
    setv('vIsco', `${localOrbitalSpeed(Math.max(state.disc.inner, 3.01)).toFixed(3)} c`);
  }

  /** Values that change every frame. */
  function update(st, camera, frameMs) {
    const M = st.massSolar * M_SUN;
    const rg = gravitationalRadius(M);
    const r0 = camera.position.length();

    setv('dist', `${r0.toFixed(1)} r_g = ${formatLength(r0 * rg)}`);
    setv('dilation', `${staticTimeDilation(r0).toFixed(4)} ×`);

    // Apparent angular radius of the shadow from radius r0:
    //   sin(alpha) = b_crit sqrt(1 - 2M/r0) / r0
    const sinA = Math.min(1, (B_CRITICAL * Math.sqrt(Math.max(0, 1 - 2 / r0))) / r0);
    const deg = (2 * Math.asin(sinA) * 180) / Math.PI;
    setv('angsize', deg > 1 ? `${deg.toFixed(1)}°` : `${(deg * 60).toFixed(1)}′`);

    const g = tidalAcceleration(M, r0);
    setv('tidal', g > 0.01 ? `${(g / 9.81).toExponential(2)} g` : 'negligible');

    const secs = st.simTime * timeUnit(M);
    setv('simtime', `${st.simTime.toFixed(0)} r_g/c = ${formatTime(secs)}`);
    setv('fps', `${(1000 / Math.max(frameMs, 0.1)).toFixed(0)} fps · ${frameMs.toFixed(1)} ms`);
    setv('res', `${(st.quality.renderScale * 100).toFixed(0)}% · ${st.quality.steps} steps/ray`);

    // Per-particle table
    if (partList.childElementCount !== st.particles.length) {
      partList.innerHTML = '';
      for (const p of st.particles) {
        const rowEl = el('div', 'particle-row');
        rowEl.append(el('span', 'swatch'));
        rowEl.lastChild.style.background = p.colour;
        rowEl.append(el('span', 'pname', p.label || `r_p = ${p.rp.toFixed(1)}`));
        rowEl.append(el('span', 'pinfo', ''));
        partList.append(rowEl);
      }
    }
    st.particles.forEach((p, i) => {
      const rowEl = partList.children[i];
      if (!rowEl) return;
      const info = rowEl.querySelector('.pinfo');
      if (!p.alive) {
        info.textContent = 'crossed the horizon';
        rowEl.dataset.dead = '1';
        return;
      }
      const d = particleInfo(p);
      info.textContent = `r = ${d.r.toFixed(2)} r_g · E = ${d.E.toFixed(4)} · L = ${d.L.toFixed(3)} · dτ/dt = ${d.clockRate.toFixed(3)}`;
    });
  }

  return { refresh, update };
}
