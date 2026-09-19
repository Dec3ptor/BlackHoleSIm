# Schwarzschild

A real-time black hole simulator that runs in the browser. Every pixel is a photon
traced backwards through curved spacetime by integrating the exact null geodesic
equation of the Schwarzschild metric on the GPU — no lensing approximations, no
faked bending.

**▶ [Open the simulator](https://dec3ptor.github.io/BlackHoleSIm/)**

> **First-time setup:** the link above goes live once GitHub Pages is switched on for
> this repository — **Settings → Pages → Build and deployment → Source → GitHub
> Actions**. That is a one-off click that only a repository admin can make; the workflow
> token is not allowed to do it. After that every push to the default branch deploys
> automatically. Until then you can still run it locally (see below).

![The lensed view](assets/screenshot-lensed.png)

---

## What it actually computes

The renderer solves the Binet equation for light in Schwarzschild spacetime,

```
d²u/dφ² = −u + 3Mu²          where u = 1/r
```

with a fourth-order Runge–Kutta step per sample, once per pixel, every frame. Drop the
`3Mu²` term and you get exact straight lines — which is what the **Curved spacetime**
toggle does, so you can see precisely what general relativity adds and nothing else
changes.

That single equation, integrated honestly, produces:

- **The shadow**, with an angular radius set by the critical impact parameter
  `b = 3√3 M ≈ 5.196 M`. Nothing else goes into it.
- **The photon ring** at the shadow's edge, where light winds around the hole before
  escaping, and the higher-order images of the disc packed just inside it.
- **Einstein rings** — background stars smeared into concentric arcs, with the star
  directly behind the hole appearing as a complete ring.
- **The folded disc**: the far side of the accretion disc lifted up over the top of the
  hole and wrapped underneath it, because the light from it bends around.

### The accretion disc

A Shakura–Sunyaev / Novikov–Thorne thin disc with the standard effective temperature
profile

```
T(r) ∝ [ (1 − √(r_in/r)) / r³ ]^(1/4)
```

peaking at `r = (49/36) r_in`, and coloured by integrating **Planck's law against the
CIE 1931 colour-matching functions** — not by a colour ramp. The same code prints the
physical peak temperature and the band it falls in, so Cygnus X-1's disc correctly comes
out at a few million kelvin in soft X-rays.

Light from the disc carries the full frequency shift

```
g = √(1 − 3M/r) / [ √(1 − 2M/r_obs) · (1 + Ω b n_y) ]
```

computed from the emitter's four-velocity on its circular geodesic, with the observed
intensity following as `g⁴`. That is why one limb of the disc is fiercely bright and blue
while the other is dim and red — and why flipping the disc's rotation mirrors the image
exactly.

### Orbits

Test particles move on real timelike geodesics,

```
d²r/dτ² = −M/r² + L²/r³ − 3ML²/r⁴
```

integrated in proper time and stepped so that every particle shares one coordinate-time
clock. They precess, they have an innermost stable circular orbit at exactly 6 `r_g`, and
inside it they spiral in and are lost. Built-in scenarios cover perihelion precession, the
ISCO and the plunge, a relativistic zoom-whirl orbit with no Newtonian analogue, and an
inclined S-star cluster.

### The spacetime view

Flamm's paraboloid, `z = 2√(r_s(r − r_s))` — the genuine isometric embedding of the
equatorial slice, not a rubber-sheet cartoon. It meets the horizon vertically and flattens
off as `√r`. A fan of null geodesics can be overlaid, straddling the critical impact
parameter so you can watch capture begin. The surface really is that shallow; the depth
slider exaggerates it for legibility and 1.00× is the truth.

## What is deliberately not simulated

- **The hole does not rotate.** This is Schwarzschild, not Kerr: no frame dragging, no
  ergosphere, no spin parameter.
- **The camera is a static observer**, so there is no aberration from its own motion.
- The disc is geometrically thin and optically parameterised; there is no radiative
  transfer, no self-heating and no magnetohydrodynamics.
- Rays that spiral many times at the photon sphere are cut off at the step limit and
  treated as captured, which is where the overwhelming majority of them end up.

## Verification

The physics is not taken on trust. `tests/physics.test.mjs` pins the integrators against
closed-form general relativity:

| Test | Reference |
| --- | --- |
| Light deflection, weak field | `4M/b + 15πM²/4b²` |
| Light grazing the Sun | 1.7512 arcsec |
| Capture threshold | `b = 3√3 M`, diverging deflection |
| Turning point of a grazing photon | the photon sphere at `r = 3M` |
| ISCO constants | `L = 2√3`, `E = √(8/9)`, `v = c/2` |
| Marginal stability | `d²V/dr²` changes sign at exactly `r = 6M` |
| Perihelion precession | `6πM / a(1 − e²)`, and Mercury's 43″/century |
| Doppler asymmetry | approaching limb blueshifted, mirrored under spin flip |
| Flamm embedding | vertical at the horizon, asymptotically flat |
| Black-body colour | CIE Illuminant A and the Planckian locus to <0.004 in xy |

```bash
npm test          # node --test tests/
```

The GPU integrator in `src/render/lensingShader.js` is a line-for-line transcription of
the tested CPU integrator in `src/core/geodesics.js`, including the escape-radius choice,
which has its own regression test.

## Running it locally

No build step and no dependencies to install — three.js is vendored in `vendor/`, so the
page works offline and nothing is fetched from a CDN.

```bash
git clone https://github.com/Dec3ptor/BlackHoleSIm.git
cd BlackHoleSIm
npm start          # or: python3 -m http.server 8080
```

Then open <http://localhost:8080>. It needs a browser with WebGL 2.

### Deploying your own copy

`.github/workflows/pages.yml` runs the test suite on every branch and publishes the
default branch to GitHub Pages — whatever that branch is called, so renaming it is safe.
Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once, then
re-run the latest workflow; every later push deploys on its own.

## Controls

| Key | Action |
| --- | --- |
| drag / scroll | orbit and zoom |
| `V` | switch between the relativistic and spacetime views |
| `G` | toggle curved spacetime |
| `D` | toggle the accretion disc |
| `space` | pause |
| `H` | hide the interface |
| `P` | save a PNG |
| `F` | fullscreen |

Performance scales by resolution, not by physics: the renderer drops the render scale to
hold frame rate and never reduces the integration accuracy behind your back. Both are
exposed under **Quality**.

## Layout

```
index.html                       page shell, import map, about panel
src/core/units.js                constants and black-hole scaling relations
src/core/geodesics.js            null and timelike geodesic integrators
src/core/blackbody.js            Planck → CIE → linear sRGB
src/render/lensingShader.js      the GPU geodesic tracer
src/render/blackHoleView.js      uniforms and the black-body lookup texture
src/render/spacetimeView.js      Flamm's paraboloid, orbits, light rays
src/sim/simulation.js            state, presets, scenarios, particle dynamics
src/ui/                          control panel and readouts
tests/physics.test.mjs           the table above
vendor/three/                    three.js r169, MIT
```

## Licence

MIT — see [LICENSE](LICENSE). Bundles three.js, also MIT.
