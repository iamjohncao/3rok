// The particle globe's dots. A fixed, evenly spread set of points on the sphere (a Fibonacci
// lattice), the same on every load. Each has its own fold delay, so the sphere unrolls as a wave
// out from one longitude with a little scatter, and no two dots leave together.

export const PARTICLE_COUNT = 40_000;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** A deterministic hash of an integer into [0, 1). */
export function hashUnit(i: number): number {
  let x = Math.imul(i + 1, 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489917) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export type Particles = {
  count: number;
  /** Radians, in [-pi, pi). */
  lon: Float32Array;
  /** Radians, in [-pi/2, pi/2]. */
  lat: Float32Array;
  /** In [0, 1). The fold wave starts at the longitude the delays were measured from. */
  delay: Float32Array;
};

const wrapPi = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

export function fibonacciParticles(count = PARTICLE_COUNT, waveLon = 0): Particles {
  const lon = new Float32Array(count);
  const lat = new Float32Array(count);
  const delay = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    lat[i] = Math.asin(1 - (2 * (i + 0.5)) / count);
    lon[i] = wrapPi(i * GOLDEN_ANGLE);
    const away = Math.abs(wrapPi(lon[i] - waveLon)) / Math.PI;
    delay[i] = Math.min(0.999, 0.6 * away + 0.39 * hashUnit(i));
  }
  return { count, lon, lat, delay };
}

/** Natural Earth II paints the ocean blue and the land green, tan, grey or white. */
export function isLandPixel(r: number, g: number, b: number): boolean {
  return !(b - r > 30 && b - g > 6);
}

/** 1 where the image under each longitude and latitude is land, else 0. `pixels` is RGBA, top row north. */
export function landMask(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  lon: Float32Array,
  lat: Float32Array,
): Uint8Array {
  const out = new Uint8Array(lon.length);
  for (let i = 0; i < lon.length; i++) {
    const x = Math.min(width - 1, Math.max(0, Math.floor(((lon[i] + Math.PI) / (2 * Math.PI)) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(((Math.PI / 2 - lat[i]) / Math.PI) * height)));
    const k = (y * width + x) * 4;
    out[i] = isLandPixel(pixels[k], pixels[k + 1], pixels[k + 2]) ? 1 : 0;
  }
  return out;
}
