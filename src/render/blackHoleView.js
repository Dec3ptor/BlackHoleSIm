/**
 * The relativistic view: a full-screen pass that ray-traces null geodesics
 * through Schwarzschild spacetime, followed by bloom and ACES tone mapping.
 */
import * as THREE from 'three';
import { vertexShader, fragmentShader, MAX_BODIES } from './lensingShader.js';
import { buildBlackbodyLut } from '../core/blackbody.js';
import { createNoiseTexture } from './noiseTexture.js';
import { particlePosition, renderDiscTemperature } from '../sim/simulation.js';

export function createBlackHoleView() {
  const lut = buildBlackbodyLut(1024, 500, 150000);
  const lutTex = new THREE.DataTexture(
    lut.data, lut.size, 1, THREE.RGBAFormat, THREE.FloatType);
  // Nearest filtering keeps this working without OES_texture_float_linear;
  // with 1024 log-spaced entries neighbouring colours are indistinguishable.
  lutTex.minFilter = THREE.NearestFilter;
  lutTex.magFilter = THREE.NearestFilter;
  lutTex.wrapS = THREE.ClampToEdgeWrapping;
  lutTex.needsUpdate = true;

  const uniforms = {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCamPos: { value: new THREE.Vector3(0, 0, 40) },
    uRight: { value: new THREE.Vector3(1, 0, 0) },
    uUp: { value: new THREE.Vector3(0, 1, 0) },
    uForward: { value: new THREE.Vector3(0, 0, -1) },
    uTanHalfFov: { value: Math.tan((55 * Math.PI) / 360) },
    uSimTime: { value: 0 },
    uSteps: { value: 260 },
    uStepScale: { value: 1 },
    uGR: { value: 1 },
    uEscapeRadius: { value: 150 },
    uCamDist: { value: 60 },

    uDiscEnabled: { value: 1 },
    uDiscInner: { value: 6 },
    uDiscOuter: { value: 40 },
    uDiscOpacity: { value: 2.4 },
    uDiscHeight: { value: 0.055 },
    uDiscFilament: { value: 0.85 },
    uDiscDust: { value: 0.45 },
    uEmission: { value: 0 },
    uEmisIndex: { value: 2.0 },
    uBeamExp: { value: 3.0 },
    uDiscTemp: { value: 5000 },
    uDiscProfile: { value: 0.35 },
    uDiscSpin: { value: 1 },
    uDiscBrightness: { value: 1 },
    uDoppler: { value: 1 },
    uRedshift: { value: 1 },

    uStarBrightness: { value: 1 },
    uNebula: { value: 1 },

    uBodyCount: { value: 0 },
    uBodyPos: { value: Array.from({ length: MAX_BODIES }, () => new THREE.Vector4()) },
    uBodyCol: { value: Array.from({ length: MAX_BODIES }, () => new THREE.Vector4(1, 1, 1, 6000)) },

    uNoise: { value: createNoiseTexture() },
    uBlackbody: { value: lutTex },
    uBBRange: { value: new THREE.Vector2(lut.logMin, lut.logMax) },
    uGain: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const tmpColour = new THREE.Color();

  /** Push the current simulation state into the shader uniforms. */
  function sync(state, viewCamera, drawingSize) {
    uniforms.uResolution.value.copy(drawingSize);
    uniforms.uCamPos.value.copy(viewCamera.position);

    viewCamera.updateMatrixWorld();
    const e = viewCamera.matrixWorld.elements;
    uniforms.uRight.value.set(e[0], e[1], e[2]);
    uniforms.uUp.value.set(e[4], e[5], e[6]);
    uniforms.uForward.value.set(-e[8], -e[9], -e[10]);
    // Roll about the view axis. Orbit controls own the camera's orientation,
    // so the roll is applied to the basis here instead of to the object -
    // it is what lets a render be turned to a published image's position
    // angle without disturbing the controls.
    const roll = (state.camera.rollDeg || 0) * (Math.PI / 180);
    if (roll !== 0) {
      uniforms.uRight.value.applyAxisAngle(uniforms.uForward.value, roll);
      uniforms.uUp.value.applyAxisAngle(uniforms.uForward.value, roll);
    }
    uniforms.uTanHalfFov.value = Math.tan((viewCamera.fov * Math.PI) / 360);

    uniforms.uSimTime.value = state.simTime;
    uniforms.uSteps.value = state.quality.steps;
    uniforms.uStepScale.value = state.quality.stepScale;
    uniforms.uGR.value = state.gr ? 1 : 0;

    const r0 = viewCamera.position.length();
    uniforms.uEscapeRadius.value = Math.max(150, 3 * r0, 1.8 * state.disc.outer);
    uniforms.uCamDist.value = r0;

    const d = state.disc;
    uniforms.uDiscEnabled.value = d.enabled ? 1 : 0;
    uniforms.uDiscInner.value = d.inner;
    uniforms.uDiscOuter.value = d.outer;
    uniforms.uDiscOpacity.value = d.opacity;
    uniforms.uDiscHeight.value = d.height;
    uniforms.uDiscFilament.value = d.filament;
    uniforms.uDiscDust.value = d.dust;
    uniforms.uEmission.value = d.emission === 'synchrotron' ? 1 : 0;
    uniforms.uEmisIndex.value = d.emisIndex;
    uniforms.uBeamExp.value = d.beamExp;
    uniforms.uDiscTemp.value = renderDiscTemperature(state);
    uniforms.uDiscProfile.value = d.profile;
    uniforms.uDiscSpin.value = d.spin;
    uniforms.uDiscBrightness.value = d.brightness;

    const o = state.optics;
    uniforms.uDoppler.value = o.doppler;
    uniforms.uRedshift.value = o.redshift;
    uniforms.uStarBrightness.value = o.stars;
    uniforms.uNebula.value = o.nebula;
    uniforms.uGain.value = o.exposure;

    // Orbiting bodies, lensed along with the rest of the scene.
    let n = 0;
    if (state.showParticles) {
      for (const p of state.particles) {
        if (n >= MAX_BODIES || !p.alive) continue;
        const [x, y, z] = particlePosition(p);
        uniforms.uBodyPos.value[n].set(x, y, z, p.radius);
        tmpColour.set(p.colour);
        // The alpha channel doubles as the emission temperature; zero marks a
        // planet, which the shader lights from the disc instead.
        uniforms.uBodyCol.value[n].set(tmpColour.r, tmpColour.g, tmpColour.b, p.temperature);
        n++;
      }
    }
    uniforms.uBodyCount.value = n;
  }

  return { scene, camera, material, uniforms, sync };
}
