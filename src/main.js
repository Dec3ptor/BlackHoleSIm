/**
 * Application entry point: wires the two views, the post-processing chain,
 * the cameras and the UI together and runs the frame loop.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { createBlackHoleView } from './render/blackHoleView.js';
import { createSpacetimeView } from './render/spacetimeView.js';
import { createState, advance, applyPreset, applyScenario, PRESETS } from './sim/simulation.js';
import { buildPanel } from './ui/panel.js';
import { createHud } from './ui/hud.js';

const container = document.getElementById('viewport');
const state = createState();

/* ------------------------------------------------------------------ *
 *  Renderer
 * ------------------------------------------------------------------ */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  renderer = null;
}
if (!renderer || !renderer.capabilities.isWebGL2) {
  document.getElementById('nowebgl').hidden = false;
  document.getElementById('loading').hidden = true;
  throw new Error('WebGL2 is required');
}
renderer.setSize(container.clientWidth, container.clientHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

/* ------------------------------------------------------------------ *
 *  Cameras - one per view, each with its own orbit controls
 * ------------------------------------------------------------------ */

const aspect = () => container.clientWidth / Math.max(1, container.clientHeight);

const lensedCamera = new THREE.PerspectiveCamera(state.camera.fovDeg, aspect(), 0.1, 4000);
const spacetimeCamera = new THREE.PerspectiveCamera(48, aspect(), 0.5, 6000);
spacetimeCamera.position.set(0, 17, 40);

function placeLensedCamera() {
  const { distance, inclinationDeg, azimuthDeg } = state.camera;
  // Inclination is the angle between the viewing direction and the disc
  // axis: 0 looks straight down on the disc, 90 is exactly edge-on.
  const theta = THREE.MathUtils.degToRad(inclinationDeg);
  const phi = THREE.MathUtils.degToRad(azimuthDeg);
  lensedCamera.position.set(
    distance * Math.sin(theta) * Math.sin(phi),
    distance * Math.cos(theta),
    distance * Math.sin(theta) * Math.cos(phi));
  lensedCamera.lookAt(0, 0, 0);
}
placeLensedCamera();

const lensedControls = new OrbitControls(lensedCamera, renderer.domElement);
lensedControls.enableDamping = true;
lensedControls.dampingFactor = 0.08;
lensedControls.minDistance = 4;
lensedControls.maxDistance = 400;
lensedControls.rotateSpeed = 0.6;
lensedControls.zoomSpeed = 0.8;

const spacetimeControls = new OrbitControls(spacetimeCamera, renderer.domElement);
spacetimeControls.enableDamping = true;
spacetimeControls.dampingFactor = 0.08;
spacetimeControls.minDistance = 8;
spacetimeControls.maxDistance = 900;
spacetimeControls.maxPolarAngle = Math.PI * 0.98;
spacetimeControls.target.set(0, -15, 0);

/* ------------------------------------------------------------------ *
 *  Views and post-processing
 * ------------------------------------------------------------------ */

const lensed = createBlackHoleView();
const spacetime = createSpacetimeView();

const renderPass = new RenderPass(lensed.scene, lensed.camera);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(container.clientWidth, container.clientHeight), 0.75, 0.6, 0.85);
const outputPass = new OutputPass();

const composer = new EffectComposer(renderer);
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(outputPass);

const drawingSize = new THREE.Vector2();

function resize() {
  const w = container.clientWidth;
  const h = Math.max(1, container.clientHeight);
  const pr = Math.min(window.devicePixelRatio || 1, 2) * state.quality.renderScale;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  lensedCamera.aspect = w / h;
  lensedCamera.updateProjectionMatrix();
  spacetimeCamera.aspect = w / h;
  spacetimeCamera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ *
 *  UI
 * ------------------------------------------------------------------ */

const hud = createHud(document.getElementById('hud'), state);

function onStateChange(what) {
  if (what === 'preset') {
    applyPreset(state, state.preset);
    lensedCamera.fov = state.camera.fovDeg;
    lensedCamera.updateProjectionMatrix();
    placeLensedCamera();
    panel.refresh();
  }
  if (what === 'scenario') applyScenario(state, state.scenario);
  if (what === 'camera') {
    lensedCamera.fov = state.camera.fovDeg;
    lensedCamera.updateProjectionMatrix();
    placeLensedCamera();
  }
  if (what === 'quality') resize();
  if (what === 'view') setView(state.view);
  hud.refresh();
}

const panel = buildPanel(document.getElementById('panel'), state, onStateChange);

function setView(view) {
  state.view = view;
  const isLensed = view === 'lensed';
  renderPass.scene = isLensed ? lensed.scene : spacetime.scene;
  renderPass.camera = isLensed ? lensed.camera : spacetimeCamera;
  lensedControls.enabled = isLensed;
  spacetimeControls.enabled = !isLensed;
  document.body.dataset.view = view;
  panel.refresh();
}

/* ------------------------------------------------------------------ *
 *  Keyboard
 * ------------------------------------------------------------------ */

const shortcuts = {
  Space: () => { state.paused = !state.paused; panel.refresh(); },
  KeyG: () => { state.gr = !state.gr; panel.refresh(); },
  KeyV: () => setView(state.view === 'lensed' ? 'spacetime' : 'lensed'),
  KeyD: () => { state.disc.enabled = !state.disc.enabled; panel.refresh(); },
  KeyH: () => document.body.classList.toggle('chrome-hidden'),
  KeyP: () => capture(),
  KeyF: () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  },
};

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const fn = shortcuts[e.code];
  if (fn) { e.preventDefault(); fn(); }
});

let pendingCapture = false;
function capture() { pendingCapture = true; }

function doCapture() {
  pendingCapture = false;
  renderer.domElement.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `blackhole-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

/* ------------------------------------------------------------------ *
 *  Frame loop
 * ------------------------------------------------------------------ */

let last = performance.now();
let ready = false;
let smoothedFrame = 16;
let sinceAdapt = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.25);
  last = now;
  const frameMs = dt * 1000;
  smoothedFrame += (frameMs - smoothedFrame) * 0.08;

  advance(state, dt);

  if (state.view === 'lensed') {
    lensedControls.update();
    renderer.getDrawingBufferSize(drawingSize);
    lensed.sync(state, lensedCamera, drawingSize);
    bloomPass.strength = state.optics.bloom;
    bloomPass.radius = 0.28;
    bloomPass.threshold = 1.15;
  } else {
    spacetimeControls.update();
    spacetime.sync(state);
    bloomPass.strength = state.optics.bloom * 0.9;
    bloomPass.radius = 0.55;
    bloomPass.threshold = 0.25;
  }

  composer.render();
  if (!ready) {
    ready = true;
    document.getElementById('loading').hidden = true;
  }
  if (pendingCapture) doCapture();

  // Adaptive resolution: trade pixels for frame rate, never the physics.
  sinceAdapt += dt;
  if (state.quality.adaptive && sinceAdapt > 0.75) {
    sinceAdapt = 0;
    const q = state.quality;
    const before = q.renderScale;
    if (smoothedFrame > 26 && q.renderScale > 0.4) q.renderScale = Math.max(0.4, q.renderScale - 0.08);
    else if (smoothedFrame < 15 && q.renderScale < 1) q.renderScale = Math.min(1, q.renderScale + 0.05);
    if (Math.abs(q.renderScale - before) > 1e-3) { resize(); panel.refresh(); }
  }

  hud.update(state, state.view === 'lensed' ? lensedCamera : spacetimeCamera, smoothedFrame);
}

applyPreset(state, state.preset);
placeLensedCamera();
setView(state.view);
resize();
panel.refresh();
hud.refresh();
requestAnimationFrame(frame);

// Handy for poking at the simulation from the console.
window.sim = { state, lensed, spacetime, renderer, lensedCamera, spacetimeCamera, setView };
