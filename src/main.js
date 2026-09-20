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
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BeamBlurShader, RadioColourShader } from './render/radioPasses.js';

import { createBlackHoleView } from './render/blackHoleView.js';
import { createSpacetimeView } from './render/spacetimeView.js';
import { createState, advance, applyPreset, applyScenario, PRESETS } from './sim/simulation.js';
import { microarcsecPerRg, M_SUN } from './core/units.js';
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
const TONE_MAPS = {
  none: THREE.NoToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  reinhard: THREE.ReinhardToneMapping,
};
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

// Radio view only: convolve the intensity down to the array's beam, then
// apply the false-colour map. Both sit idle for the optical views.
const beamH = new ShaderPass(BeamBlurShader);
const beamV = new ShaderPass(BeamBlurShader);
const radioColour = new ShaderPass(RadioColourShader);
beamH.material.uniforms.uTexel.value = new THREE.Vector2();
beamV.material.uniforms.uTexel.value = new THREE.Vector2();
beamH.enabled = beamV.enabled = radioColour.enabled = false;

const composer = new EffectComposer(renderer);
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(beamH);
composer.addPass(beamV);
composer.addPass(radioColour);
composer.addPass(outputPass);

const drawingSize = new THREE.Vector2();

function resize() {
  const w = container.clientWidth;
  const h = Math.max(1, container.clientHeight);
  // A Retina display reports devicePixelRatio 2, which means four times the
  // pixels and four times the ray tracing. Capping it is the single biggest
  // lever on a laptop, and this render - smooth gradients under bloom - hides
  // the softening far better than text or geometry would.
  const cap = Math.min(window.devicePixelRatio || 1, state.quality.maxPixelRatio);
  const pr = cap * state.quality.renderScale;
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
    onStateChange('tone');
    panel.refresh();
  }
  if (what === 'scenario') applyScenario(state, state.scenario);
  if (what === 'camera') {
    lensedCamera.fov = state.camera.fovDeg;
    lensedCamera.updateProjectionMatrix();
    placeLensedCamera();
  }
  if (what === 'quality') resize();
  // The tone map is applied per frame by updateRadioPasses, which also has to
  // override it for the false-colour view; nothing to do here.
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

/**
 * Size the interferometer beam in screen pixels and switch the radio chain on.
 *
 * The beam is quoted in microarcseconds, so it has to travel through the real
 * angular scale of the hole - mass and distance give microarcseconds per
 * gravitational radius, and the camera's distance and field of view turn that
 * into pixels.
 */
function updateRadioPasses() {
  const radio = state.disc.emission === 'synchrotron';
  beamH.enabled = beamV.enabled = radio;
  radioColour.enabled = radio;
  // A false-colour map is a display transform, so it must not be tone mapped.
  const want = radio
    ? THREE.NoToneMapping
    : (TONE_MAPS[state.toneMapping] ?? THREE.ACESFilmicToneMapping);
  if (renderer.toneMapping !== want) renderer.toneMapping = want;
  if (!radio) return;

  const uasPerRg = microarcsecPerRg(state.massSolar * M_SUN, state.distanceMpc);
  let sigma = 0;
  if (uasPerRg > 0 && state.beamUas > 0) {
    const pxPerRad = drawingSize.y / (2 * Math.tan((lensedCamera.fov * Math.PI) / 360));
    const pxPerRg = pxPerRad / Math.max(lensedCamera.position.length(), 1);
    const fwhmPx = (state.beamUas / uasPerRg) * pxPerRg;
    sigma = fwhmPx / 2.3548;   // FWHM -> standard deviation
  }
  beamH.material.uniforms.uSigma.value = sigma;
  beamV.material.uniforms.uSigma.value = sigma;
  beamH.material.uniforms.uTexel.value.set(1 / Math.max(drawingSize.x, 1), 0);
  beamV.material.uniforms.uTexel.value.set(0, 1 / Math.max(drawingSize.y, 1));
  radioColour.material.uniforms.uGamma.value = state.radioGamma ?? 1;
}

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
    updateRadioPasses();
  } else {
    beamH.enabled = beamV.enabled = radioColour.enabled = false;
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
    if (smoothedFrame > 26 && q.renderScale > 0.35) {
      // Step down in proportion to how far over budget we are, so a badly
      // struggling machine reaches a usable frame rate in one or two goes
      // rather than crawling there over several seconds.
      const over = Math.min(smoothedFrame / 26, 4);
      q.renderScale = Math.max(0.35, q.renderScale - 0.05 * over);
    } else if (smoothedFrame < 15 && q.renderScale < 1) {
      q.renderScale = Math.min(1, q.renderScale + 0.05);
    }
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

// Which commit is actually being served - the answer to "did my deploy land?"
const buildId = document.querySelector('meta[name="build"]')?.content || 'dev';
const buildEl = document.getElementById('build-id');
if (buildEl) buildEl.textContent = buildId;
console.info(`Schwarzschild build ${buildId}`);

// Handy for poking at the simulation from the console.
window.sim = {
  state, lensed, spacetime, renderer, lensedCamera, spacetimeCamera, setView,
  passes: { bloomPass, beamH, beamV, radioColour },
};
