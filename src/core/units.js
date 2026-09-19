/**
 * Physical constants, unit conversions and black-hole scaling relations.
 *
 * The renderer and the geodesic integrators work in *geometrised units*
 * (G = c = 1) with lengths expressed in gravitational radii
 *
 *     r_g = GM / c^2 ,
 *
 * so that the horizon sits at r = 2, the photon sphere at r = 3 and the
 * innermost stable circular orbit at r = 6 regardless of the mass. Every
 * quantity the HUD shows in SI units is obtained by scaling those numbers
 * with the functions below.
 */

export const C = 299792458;                 // m / s
export const G = 6.6743e-11;                // m^3 kg^-1 s^-2
export const HBAR = 1.054571817e-34;        // J s
export const H_PLANCK = 6.62607015e-34;     // J s
export const K_B = 1.380649e-23;            // J / K
export const SIGMA_SB = 5.670374419e-8;     // W m^-2 K^-4
export const SIGMA_T = 6.6524587321e-29;    // m^2 (Thomson cross-section)
export const M_PROTON = 1.67262192369e-27;  // kg
export const M_SUN = 1.98847e30;            // kg
export const L_SUN = 3.828e26;              // W
export const AU = 1.495978707e11;           // m
export const PARSEC = 3.0856775814913673e16;// m
export const LIGHT_YEAR = 9.4607304725808e15;
export const YEAR = 3.15576e7;              // s (Julian)

/** Gravitational radius r_g = GM/c^2 in metres. */
export const gravitationalRadius = (massKg) => (G * massKg) / (C * C);

/** Schwarzschild radius r_s = 2GM/c^2 in metres. */
export const schwarzschildRadius = (massKg) => 2 * gravitationalRadius(massKg);

/** Light-crossing time of one gravitational radius, in seconds. */
export const timeUnit = (massKg) => gravitationalRadius(massKg) / C;

/** Hawking temperature in kelvin. */
export const hawkingTemperature = (massKg) =>
  (HBAR * C * C * C) / (8 * Math.PI * G * massKg * K_B);

/** Evaporation lifetime (photons + 3 neutrino flavours ignored) in seconds. */
export const evaporationTime = (massKg) =>
  (5120 * Math.PI * G * G * massKg * massKg * massKg) / (HBAR * C ** 4);

/** Eddington luminosity in watts (pure hydrogen, electron scattering). */
export const eddingtonLuminosity = (massKg) =>
  (4 * Math.PI * G * massKg * M_PROTON * C) / SIGMA_T;

/** Eddington accretion rate in kg/s for a radiative efficiency `eta`. */
export const eddingtonAccretionRate = (massKg, eta = 0.1) =>
  eddingtonLuminosity(massKg) / (eta * C * C);

/**
 * Tidal (differential) acceleration across a body of length L at radius r,
 * measured in m/s^2. r is in gravitational radii.
 */
export const tidalAcceleration = (massKg, rInRg, lengthM = 1.8) => {
  const r = rInRg * gravitationalRadius(massKg);
  return (2 * G * massKg * lengthM) / (r * r * r);
};

/**
 * Peak effective temperature of a Shakura-Sunyaev / Novikov-Thorne thin disc.
 *
 *   T(r) = [ 3 G M Mdot (1 - sqrt(r_in/r)) / (8 pi sigma r^3) ]^(1/4)
 *
 * `rInRg` and the returned profile radius are in gravitational radii.
 */
export function discTemperature(massKg, mdotKgPerS, rInRg, rInRgQuery) {
  const rg = gravitationalRadius(massKg);
  const r = rInRgQuery * rg;
  const rin = rInRg * rg;
  if (r <= rin) return 0;
  const f = 1 - Math.sqrt(rin / r);
  return Math.pow((3 * G * massKg * mdotKgPerS * f) / (8 * Math.PI * SIGMA_SB * r * r * r), 0.25);
}

/** Radius (in r_g) where the thin-disc temperature profile peaks. */
export const discPeakRadius = (rInRg) => (49 / 36) * rInRg;

/** Peak temperature of the disc in kelvin. */
export const discPeakTemperature = (massKg, mdotKgPerS, rInRg) =>
  discTemperature(massKg, mdotKgPerS, rInRg, discPeakRadius(rInRg));

/**
 * Keplerian coordinate angular velocity d(phi)/dt for a circular orbit,
 * in units of 1/r_g (geometrised). Multiply by c/r_g for rad/s.
 */
export const keplerOmega = (rInRg) => 1 / Math.pow(rInRg, 1.5);

/** Orbital period of a circular orbit at r (in r_g), in seconds. */
export const orbitalPeriod = (massKg, rInRg) =>
  2 * Math.PI * Math.pow(rInRg, 1.5) * timeUnit(massKg);

/**
 * Orbital speed measured by a *local static observer*, as a fraction of c:
 *   v = sqrt(M/r) / sqrt(1 - 2M/r)
 */
export const localOrbitalSpeed = (rInRg) =>
  Math.sqrt(1 / rInRg) / Math.sqrt(1 - 2 / rInRg);

/** Gravitational time dilation dtau/dt for a static observer at r (in r_g). */
export const staticTimeDilation = (rInRg) => Math.sqrt(Math.max(0, 1 - 2 / rInRg));

/**
 * dtau/dt for an observer on a circular geodesic orbit at r (in r_g):
 *   dtau/dt = sqrt(1 - 3M/r)
 */
export const orbitingTimeDilation = (rInRg) => Math.sqrt(Math.max(0, 1 - 3 / rInRg));

/** Escape velocity as a fraction of c for a static observer at r (in r_g). */
export const escapeVelocity = (rInRg) => Math.sqrt(2 / rInRg);

/** Format a length in metres using a sensible astronomical unit. */
export function formatLength(metres) {
  const a = Math.abs(metres);
  if (a >= 0.5 * LIGHT_YEAR) return `${(metres / LIGHT_YEAR).toPrecision(3)} ly`;
  if (a >= 0.02 * AU) return `${(metres / AU).toPrecision(3)} AU`;
  if (a >= 1e6) return `${(metres / 1000).toPrecision(3)} km`;
  if (a >= 1) return `${metres.toPrecision(3)} m`;
  return `${metres.toExponential(2)} m`;
}

/** Format a duration in seconds using a sensible unit. */
export function formatTime(seconds) {
  const a = Math.abs(seconds);
  if (a >= 1e3 * YEAR) return `${(seconds / YEAR).toExponential(2)} yr`;
  if (a >= YEAR) return `${(seconds / YEAR).toPrecision(3)} yr`;
  if (a >= 86400) return `${(seconds / 86400).toPrecision(3)} d`;
  if (a >= 3600) return `${(seconds / 3600).toPrecision(3)} h`;
  if (a >= 60) return `${(seconds / 60).toPrecision(3)} min`;
  if (a >= 1e-3) return `${seconds.toPrecision(3)} s`;
  return `${seconds.toExponential(2)} s`;
}

/** Format a mass in solar masses. */
export function formatMass(massKg) {
  const ms = massKg / M_SUN;
  if (ms >= 1e4) return `${ms.toExponential(3)} M☉`;
  return `${ms.toPrecision(4)} M☉`;
}
