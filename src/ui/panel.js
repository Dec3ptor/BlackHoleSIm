/**
 * The control panel. Controls are declared as data and bound to paths in the
 * simulation state, so adding a knob is one line rather than three.
 */
import { PRESETS, SCENARIOS } from '../sim/simulation.js';

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const set = (obj, path, v) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = v;
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export function buildPanel(root, state, onChange) {
  const refreshers = [];
  root.innerHTML = '';

  function section(title, open = true) {
    const details = el('details', 'section');
    details.open = open;
    const summary = el('summary');
    summary.append(el('span', 'section-title', title));
    details.append(summary);
    const body = el('div', 'section-body');
    details.append(body);
    root.append(details);
    return body;
  }

  function row(parent, label, control, hint) {
    const wrap = el('div', 'control');
    const head = el('div', 'control-head');
    head.append(el('label', null, label));
    const value = el('span', 'control-value');
    head.append(value);
    wrap.append(head, control);
    if (hint) wrap.append(el('p', 'hint', hint));
    parent.append(wrap);
    return value;
  }

  /** A slider. `log` maps the track logarithmically, for masses and rates. */
  function slider(parent, { label, path, min, max, step = 0.01, log = false, format, hint, change }) {
    const input = el('input');
    input.type = 'range';
    input.min = log ? Math.log10(min) : min;
    input.max = log ? Math.log10(max) : max;
    input.step = log ? 0.001 : step;
    const value = row(parent, label, input, hint);
    const fmt = format || ((v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)));
    const sync = () => {
      const v = get(state, path);
      input.value = log ? Math.log10(Math.max(v, min)) : v;
      value.textContent = fmt(v);
    };
    input.addEventListener('input', () => {
      const raw = parseFloat(input.value);
      set(state, path, log ? 10 ** raw : raw);
      value.textContent = fmt(get(state, path));
      onChange(change);
    });
    refreshers.push(sync);
    sync();
  }

  function toggle(parent, { label, path, hint, change }) {
    const btn = el('button', 'toggle');
    const value = row(parent, label, btn, hint);
    value.remove();
    const sync = () => {
      const on = !!get(state, path);
      btn.textContent = on ? 'On' : 'Off';
      btn.dataset.on = on ? '1' : '0';
    };
    btn.addEventListener('click', () => {
      set(state, path, !get(state, path));
      sync();
      onChange(change);
    });
    refreshers.push(sync);
    sync();
  }

  function choice(parent, { label, path, options, hint, change }) {
    const group = el('div', 'segmented');
    const buttons = options.map(([val, text]) => {
      const b = el('button', null, text);
      b.addEventListener('click', () => {
        set(state, path, val);
        onChange(change);
        sync();
      });
      group.append(b);
      return [val, b];
    });
    const value = row(parent, label, group, hint);
    value.remove();
    const sync = () => {
      const cur = get(state, path);
      for (const [val, b] of buttons) b.dataset.on = val === cur ? '1' : '0';
    };
    refreshers.push(sync);
    sync();
  }

  function dropdown(parent, { label, path, options, hint, change }) {
    const sel = el('select');
    for (const [val, text] of options) {
      const o = el('option', null, text);
      o.value = val;
      sel.append(o);
    }
    const value = row(parent, label, sel, hint);
    value.remove();
    const sync = () => { sel.value = get(state, path); };
    sel.addEventListener('change', () => {
      set(state, path, sel.value);
      onChange(change);
    });
    refreshers.push(sync);
    sync();
  }

  /* ---------------- sections ---------------- */

  const scene = section('Scene');
  dropdown(scene, {
    label: 'Black hole',
    path: 'preset',
    change: 'preset',
    options: Object.entries(PRESETS).map(([k, v]) => [k, v.label]),
  });
  const blurb = el('p', 'blurb');
  scene.append(blurb);
  refreshers.push(() => { blurb.textContent = PRESETS[state.preset]?.blurb || ''; });

  choice(scene, {
    label: 'View',
    path: 'view',
    change: 'view',
    options: [['lensed', 'Relativistic'], ['spacetime', 'Spacetime']],
  });
  slider(scene, {
    label: 'Mass', path: 'massSolar', min: 1, max: 1e10, log: true, change: 'mass',
    format: (v) => (v >= 1e4 ? `${v.toExponential(2)} M☉` : `${v.toFixed(1)} M☉`),
    hint: 'The geometry is identical at every mass - only the scale bar changes.',
  });
  slider(scene, {
    label: 'Accretion rate', path: 'mdotEdd', min: 1e-8, max: 1, log: true, change: 'mass',
    format: (v) => `${v.toExponential(1)} Ṁ_Edd`,
    hint: 'Sets the physical disc temperature through the thin-disc profile.',
  });

  const disc = section('Accretion disc');
  toggle(disc, { label: 'Disc', path: 'disc.enabled' });
  slider(disc, {
    label: 'Inner radius', path: 'disc.inner', min: 2.2, max: 30, step: 0.1,
    format: (v) => `${v.toFixed(1)} r_g`,
    hint: 'The ISCO at 6 r_g is where a real thin disc ends.',
  });
  slider(disc, {
    label: 'Outer radius', path: 'disc.outer', min: 8, max: 90, step: 0.5,
    format: (v) => `${v.toFixed(0)} r_g`,
  });
  slider(disc, {
    label: 'Optical depth', path: 'disc.opacity', min: 0.05, max: 6,
    hint: 'Vertical optical depth through the densest gas. Lower lets the far '
      + 'side of the disc show through the near side.',
  });
  slider(disc, {
    label: 'Scale height', path: 'disc.height', min: 0.015, max: 0.22, step: 0.005,
    format: (v) => `H/r = ${v.toFixed(3)}`,
  });
  slider(disc, {
    label: 'Filaments', path: 'disc.filament', min: 0, max: 1,
    hint: 'How sharply the gas breaks into strands. Differential rotation '
      + 'winds them up on its own as time runs.',
  });
  slider(disc, {
    label: 'Dust lanes', path: 'disc.dust', min: 0, max: 1.5,
    hint: 'Cool dust that absorbs without emitting, drawing dark lanes across '
      + 'the hot gas behind it.',
  });
  slider(disc, { label: 'Brightness', path: 'disc.brightness', min: 0, max: 6 });
  slider(disc, {
    label: 'Temperature law', path: 'disc.profile', min: 0, max: 1.4,
    format: (v) => (v > 0.95 && v < 1.05 ? 'physical' : `${v.toFixed(2)} × r^-3/4`),
    hint: '1.00 is the real thin-disc r^-3/4 law. Lower flattens it towards '
      + 'isothermal, which is what Interstellar used to keep the disc glowing '
      + 'evenly all the way out.',
  });
  choice(disc, {
    label: 'Rotation', path: 'disc.spin',
    options: [[1, 'Prograde'], [-1, 'Retrograde']],
  });
  toggle(disc, {
    label: 'True temperature', path: 'disc.trueTemperature',
    hint: 'Render the physically derived temperature instead of a fixed, always-visible one.',
  });
  slider(disc, {
    label: 'Display temperature', path: 'disc.peakTempVisual', min: 1200, max: 40000, step: 50,
    format: (v) => `${(v / 1000).toFixed(1)} kK`,
  });

  const radio = section('Radio view', false);
  choice(radio, {
    label: 'Emission', path: 'disc.emission',
    options: [['thermal', 'Thermal'], ['synchrotron', 'Synchrotron']],
    hint: 'Thermal is an optically thick black-body disc. Synchrotron is the '
      + 'optically thin hot flow the Event Horizon Telescope sees at 230 GHz, '
      + 'shown in false colour and blurred to the array beam.',
  });
  slider(radio, {
    label: 'Beam (FWHM)', path: 'beamUas', min: 0, max: 60, step: 0.5,
    format: (v) => (v > 0 ? `${v.toFixed(0)} µas` : 'off'),
    hint: 'The EHT resolved M87* with a ~20 µas beam, about half the ring diameter.',
  });
  slider(radio, {
    label: 'Emissivity law', path: 'disc.emisIndex', min: 0, max: 5, step: 0.1,
    format: (v) => `j ∝ r^-${v.toFixed(1)}`,
  });
  slider(radio, {
    label: 'Beaming exponent', path: 'disc.beamExp', min: 0, max: 5, step: 0.1,
    format: (v) => `g^${v.toFixed(1)}`,
    hint: '3 is specific intensity at a fixed observed frequency; it is the '
      + 'whole reason one side of the ring is brighter.',
  });
  slider(radio, {
    label: 'Display gamma', path: 'radioGamma', min: 0.3, max: 2.5, step: 0.05,
    format: (v) => v.toFixed(2),
  });

  const rel = section('Relativity');
  toggle(rel, {
    label: 'Curved spacetime', path: 'gr',
    hint: 'Off removes the 3Mu² term from the geodesic equation: light travels in '
      + 'straight lines and orbits stop precessing. Everything else is unchanged.',
  });
  slider(rel, {
    label: 'Doppler beaming', path: 'optics.doppler', min: 0, max: 1,
    hint: 'The approaching side of the disc is brighter and bluer by g⁴.',
  });
  slider(rel, {
    label: 'Gravitational shift', path: 'optics.redshift', min: 0, max: 1,
    hint: 'Light loses energy climbing out of the well.',
  });

  const cam = section('Camera');
  slider(cam, {
    label: 'Distance', path: 'camera.distance', min: 5, max: 200, step: 0.5, change: 'camera',
    format: (v) => `${v.toFixed(0)} r_g`,
  });
  slider(cam, {
    label: 'Inclination', path: 'camera.inclinationDeg', min: 0, max: 90, step: 0.5, change: 'camera',
    format: (v) => `${v.toFixed(0)}°`,
    hint: '0° looks down on the disc, 90° is edge-on.',
  });
  slider(cam, {
    label: 'Roll', path: 'camera.rollDeg', min: -180, max: 180, step: 1,
    format: (v) => `${v.toFixed(0)}°`,
    hint: 'Turns the image about the line of sight, for matching a published '
      + 'orientation such as the EHT\u2019s north-up, east-left convention.',
  });
  slider(cam, {
    label: 'Field of view', path: 'camera.fovDeg', min: 12, max: 100, step: 0.5, change: 'camera',
    format: (v) => `${v.toFixed(0)}°`,
  });

  const sky = section('Image', false);
  dropdown(sky, {
    label: 'Tone mapping', path: 'toneMapping', change: 'tone',
    options: [['aces', 'ACES filmic'], ['agx', 'AgX'], ['neutral', 'Neutral'], ['reinhard', 'Reinhard']],
    hint: 'ACES keeps a white-hot core; Neutral holds more saturation in the highlights.',
  });
  slider(sky, { label: 'Exposure', path: 'optics.exposure', min: 0.05, max: 4 });
  slider(sky, { label: 'Bloom', path: 'optics.bloom', min: 0, max: 2.5 });
  slider(sky, { label: 'Starlight', path: 'optics.stars', min: 0, max: 3 });
  slider(sky, { label: 'Nebulae', path: 'optics.nebula', min: 0, max: 2 });

  const sim = section('Test particles', false);
  dropdown(sim, {
    label: 'Scenario', path: 'scenario', change: 'scenario',
    options: Object.entries(SCENARIOS).map(([k, v]) => [k, v.label]),
  });
  const sblurb = el('p', 'blurb');
  sim.append(sblurb);
  refreshers.push(() => { sblurb.textContent = SCENARIOS[state.scenario]?.blurb || ''; });
  toggle(sim, { label: 'Show particles', path: 'showParticles' });
  toggle(sim, { label: 'Show trails', path: 'showTrails' });
  toggle(sim, { label: 'Light rays', path: 'showRays', hint: 'Spacetime view: a fan of photons straddling the capture threshold.' });
  toggle(sim, { label: 'Marker rings', path: 'showMarkers', hint: 'Horizon, photon sphere and ISCO.' });
  slider(sim, {
    label: 'Depth exaggeration', path: 'embedScale', min: 1, max: 4, step: 0.05,
    format: (v) => `${v.toFixed(2)} ×`,
    hint: 'Flamm\u2019s paraboloid really is this shallow. 1.00× is the true embedding.',
  });
  toggle(sim, { label: 'Paused', path: 'paused' });
  slider(sim, {
    label: 'Time rate', path: 'timeScale', min: 0.2, max: 200, log: true,
    format: (v) => `${v.toFixed(1)} r_g/c per s`,
  });

  const quality = section('Quality', false);
  slider(quality, {
    label: 'Integration steps', path: 'quality.steps', min: 60, max: 900, step: 10, change: 'quality',
    format: (v) => v.toFixed(0),
    hint: 'Steps along each photon geodesic. Higher is more accurate near the shadow.',
  });
  slider(quality, {
    label: 'Render scale', path: 'quality.renderScale', min: 0.35, max: 1, step: 0.05, change: 'quality',
    format: (v) => `${(v * 100).toFixed(0)}%`,
  });
  slider(quality, {
    label: 'Max pixel ratio', path: 'quality.maxPixelRatio', min: 0.75, max: 3, step: 0.05, change: 'quality',
    format: (v) => `${v.toFixed(2)} ×`,
    hint: 'A Retina screen reports 2, which is four times the pixels to trace. '
      + 'Lowering this is the cheapest way to gain frame rate; raise it for a '
      + 'crisper still.',
  });
  toggle(quality, { label: 'Adaptive resolution', path: 'quality.adaptive' });

  return { refresh: () => refreshers.forEach((f) => f()) };
}
