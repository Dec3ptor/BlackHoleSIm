/**
 * The spacetime view: Flamm's paraboloid, the exact isometric embedding of
 * the equatorial slice of Schwarzschild spacetime,
 *
 *     z(r) = 2 sqrt( r_s (r - r_s) ) ,
 *
 * with test particles moving along it on real timelike geodesics and, on
 * request, a fan of null geodesics showing capture and deflection.
 *
 * This is the figure every textbook draws as "the rubber sheet", except that
 * it is the real surface rather than a plausible-looking dent: its intrinsic
 * geometry is genuinely that of the slice, so the funnel meets the horizon
 * vertically and flattens off as 1/sqrt(r) rather than exponentially.
 */
import * as THREE from 'three';
import { flammDepth, R_ISCO, R_PHOTON_SPHERE, R_HORIZON, tracePhoton } from '../core/geodesics.js';
import { particlePosition } from '../sim/simulation.js';

const RS = 2;
const R_MAX = 120;

/**
 * Height of the embedding surface, shifted so the flat rim sits at y = 0 and
 * the throat hangs below it. flammDepth grows outwards from zero at the
 * horizon, so the funnel is the *negative* of it measured from the rim.
 */
const depth = (r) => flammDepth(Math.min(Math.max(r, RS), R_MAX), RS) - flammDepth(R_MAX, RS);

export function createSpacetimeView() {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);

  /* ---- the funnel ------------------------------------------------- */
  const RINGS = 96;
  const SPOKES = 72;

  // Radii bunched towards the horizon, where the curvature actually lives.
  const radii = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    radii.push(RS + (R_MAX - RS) * Math.pow(t, 3.4));
  }

  const gridPos = [];
  const gridCol = [];
  const cNear = new THREE.Color('#9ff3ff');
  const cFar = new THREE.Color('#2f4a9c');
  // Most of the interesting curvature lives inside ~30 r_g, so the colour
  // ramp is keyed to that rather than to the full extent of the sheet.
  const tint = (r) => cFar.clone().lerp(cNear, Math.pow(Math.max(0, 1 - (r - RS) / 34), 1.5));

  for (const r of radii) {
    const c = tint(r);
    for (let s = 0; s < SPOKES; s++) {
      const a0 = (s / SPOKES) * Math.PI * 2;
      const a1 = ((s + 1) / SPOKES) * Math.PI * 2;
      gridPos.push(r * Math.cos(a0), depth(r), r * Math.sin(a0),
                   r * Math.cos(a1), depth(r), r * Math.sin(a1));
      gridCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }
  for (let s = 0; s < SPOKES; s++) {
    const a = (s / SPOKES) * Math.PI * 2;
    for (let i = 0; i < radii.length - 1; i++) {
      const r0 = radii[i], r1 = radii[i + 1];
      const c = tint(r0);
      gridPos.push(r0 * Math.cos(a), depth(r0), r0 * Math.sin(a),
                   r1 * Math.cos(a), depth(r1), r1 * Math.sin(a));
      gridCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }

  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPos, 3));
  gridGeo.setAttribute('color', new THREE.Float32BufferAttribute(gridCol, 3));
  const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  root.add(grid);

  // A faint filled surface under the wireframe, so the funnel reads as a
  // sheet rather than as a cloud of lines.
  {
    const segs = 128;
    const pos = [];
    const col = [];
    const idx = [];
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i];
      const c = tint(r).multiplyScalar(0.075);
      for (let s2 = 0; s2 <= segs; s2++) {
        const a = (s2 / segs) * Math.PI * 2;
        pos.push(r * Math.cos(a), depth(r), r * Math.sin(a));
        col.push(c.r, c.g, c.b);
      }
    }
    const stride = segs + 1;
    for (let i = 0; i < radii.length - 1; i++) {
      for (let s2 = 0; s2 < segs; s2++) {
        const a = i * stride + s2;
        idx.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    root.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      transparent: true, opacity: 0.9, depthWrite: true,
      // The wireframe sits on exactly these vertices, so without a depth
      // bias the two z-fight and the grid blinks out at some camera angles.
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,
    })));
  }

  /* ---- marker rings ------------------------------------------------ */
  function marker(r, colour, opacity) {
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      pts.push(new THREE.Vector3(r * Math.cos(a), depth(r), r * Math.sin(a)));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(g, new THREE.LineBasicMaterial({
      color: colour, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
  }
  const markers = new THREE.Group();
  markers.add(marker(R_HORIZON + 1e-3, '#ff3b30', 1.0));
  markers.add(marker(R_PHOTON_SPHERE, '#ffd60a', 0.85));
  markers.add(marker(R_ISCO, '#30d158', 0.85));
  root.add(markers);

  // The horizon itself: a black cap that swallows anything behind it.
  const cap = new THREE.Mesh(
    new THREE.CircleGeometry(R_HORIZON, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000 }));
  cap.position.y = depth(R_HORIZON);
  root.add(cap);

  // A soft glow standing in for the throat disappearing below the horizon.
  const throat = new THREE.Mesh(
    new THREE.SphereGeometry(R_HORIZON * 1.02, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000 }));
  throat.position.y = depth(R_HORIZON);
  root.add(throat);

  /* ---- particles and trails ---------------------------------------- */
  const particleGroup = new THREE.Group();
  const trailGroup = new THREE.Group();
  root.add(trailGroup, particleGroup);
  const meshes = new Map();
  const trails = new Map();

  const sphereGeo = new THREE.SphereGeometry(1, 20, 14);

  function syncParticles(state) {
    const seen = new Set();
    for (const p of state.particles) {
      seen.add(p.id);
      let m = meshes.get(p.id);
      if (!m) {
        m = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: p.colour }));
        // A faint halo so small bodies stay visible against the grid.
        const halo = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({
          color: p.colour, transparent: true, opacity: 0.18,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        halo.scale.setScalar(3.2);
        m.add(halo);
        particleGroup.add(m);
        meshes.set(p.id, m);

        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.maxTrail * 3), 3));
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({
          color: p.colour, transparent: true, opacity: 0.6,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        line.frustumCulled = false;
        trailGroup.add(line);
        trails.set(p.id, line);
      }
      const [x, y, z] = particlePosition(p);
      const r = p.state[0];
      m.visible = p.alive && state.showParticles;
      m.position.set(x, y + depth(r), z);
      m.scale.setScalar(Math.max(0.35, p.radius * 2.2));

      const line = trails.get(p.id);
      line.visible = state.showTrails && p.trail.length > 5;
      if (line.visible) {
        const arr = line.geometry.attributes.position.array;
        const n = Math.min(p.trail.length / 3, p.maxTrail) | 0;
        for (let i = 0; i < n; i++) {
          const j = p.trail.length - n * 3 + i * 3;
          const tx = p.trail[j], ty = p.trail[j + 1], tz = p.trail[j + 2];
          arr[i * 3] = tx;
          arr[i * 3 + 1] = ty + depth(Math.hypot(tx, ty, tz));
          arr[i * 3 + 2] = tz;
        }
        line.geometry.setDrawRange(0, n);
        line.geometry.attributes.position.needsUpdate = true;
        line.geometry.computeBoundingSphere();
      }
    }
    for (const [id, m] of meshes) {
      if (!seen.has(id)) {
        particleGroup.remove(m);
        meshes.delete(id);
        const l = trails.get(id);
        if (l) { trailGroup.remove(l); trails.delete(id); }
      }
    }
  }

  /* ---- light rays --------------------------------------------------- */
  const rayGroup = new THREE.Group();
  root.add(rayGroup);
  let raysBuilt = false;

  function buildRays() {
    if (raysBuilt) return;
    raysBuilt = true;
    const r0 = 34;
    // A fan of photons fired inwards with a spread of impact parameters,
    // straddling the critical value b = 3*sqrt(3) where capture begins.
    for (const b of [1.5, 3.4, 4.6, 5.19, 5.35, 6.0, 7.2, 9, 12, 16, 22]) {
      const sinPsi = Math.min(1, (b * Math.sqrt(1 - 2 / r0)) / r0);
      const psi = Math.PI - Math.asin(sinPsi);
      const res = tracePhoton(r0, psi, { collect: true, escapeRadius: 46, baseStep: 0.01 });
      const pts = [];
      for (const s of res.samples) {
        if (!Number.isFinite(s.r) || s.r < RS || s.r > 46) continue;
        pts.push(new THREE.Vector3(
          s.r * Math.cos(s.phi), depth(s.r) + 0.05, s.r * Math.sin(s.phi)));
      }
      if (pts.length < 2) continue;
      const captured = res.outcome === 'captured';
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      rayGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({
        color: captured ? '#ff6b5a' : '#9ad9ff',
        transparent: true, opacity: captured ? 0.85 : 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })));
    }
  }

  /* ---- backdrop ------------------------------------------------------ */
  const starGeo = new THREE.BufferGeometry();
  {
    const n = 2600;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Uniform on the sphere, pushed well outside the funnel.
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = 600 + Math.random() * 300;
      pos[i * 3] = R * s * Math.cos(a);
      pos[i * 3 + 1] = R * u;
      pos[i * 3 + 2] = R * s * Math.sin(a);
      const w = 0.55 + Math.random() * 0.45;
      col[i * 3] = w * (0.8 + Math.random() * 0.2);
      col[i * 3 + 1] = w * (0.85 + Math.random() * 0.15);
      col[i * 3 + 2] = w;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 2.2, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.8, depthWrite: false,
  })));

  function sync(state) {
    syncParticles(state);
    // Flamm's paraboloid is genuinely shallow - a funnel 120 r_g across is
    // only ~30 r_g deep. Scaling y exaggerates it for legibility; 1.0 is the
    // true isometric embedding.
    root.scale.y = state.embedScale ?? 1;
    markers.visible = state.showMarkers !== false;
    rayGroup.visible = !!state.showRays;
    if (state.showRays) buildRays();
    grid.material.opacity = state.gr ? 0.9 : 0.3;
  }

  return { scene, sync, depth };
}
