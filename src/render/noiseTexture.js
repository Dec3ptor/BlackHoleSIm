/**
 * A tileable 3D noise texture for the disc.
 *
 * The disc's structure used to come from value noise evaluated in the shader:
 * eight hash calls and a trilinear blend per octave, twelve octaves per sample,
 * tens of samples per ray. Profiling put that at nearly 40% of the frame.
 *
 * The same field comes out of a texture fetch instead. White noise read back
 * with hardware linear filtering *is* value noise - the filtering does the
 * interpolation the shader was doing by hand - so the character of the result
 * is unchanged while the cost collapses to one texture unit per octave.
 *
 * 64^3 single-channel is 256 KB and wraps every 64 noise units, far more than
 * the disc spans at the base octave, so no tiling is visible.
 */
import * as THREE from 'three';

export const NOISE_SIZE = 64;

/** Deterministic so the disc looks the same on every machine and reload. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNoiseTexture(size = NOISE_SIZE, seed = 1337) {
  const rand = mulberry32(seed);
  const n = size * size * size;
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = (rand() * 256) | 0;

  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  // Linear filtering is the whole point: it is what turns the random bytes
  // into smooth value noise. Repeat wrapping makes the field tileable.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
