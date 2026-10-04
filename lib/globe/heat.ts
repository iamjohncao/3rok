// The placement-score layer, as colours. A score runs from 0 to 1 and is drawn white, yellow, red
// in that order: white where the model's dose rate is highest, red where it is a thousand times
// lower or less. The colours are the design system's thermal tokens, read from the page. A score
// is a score. It is not a probability, and nothing here calls it one.

export type Rgb = [number, number, number];

/** White, yellow, red: the design system's --thermal-3, --thermal-4 and --thermal-5. */
export type Ramp = { low: Rgb; mid: Rgb; high: Rgb };

/** A token's text, `#rrggbb` or `#rgb`, as 0 to 255 channels. Null when it is neither. */
export function parseHexColor(text: string): Rgb | null {
  const value = text.trim();
  if (!value.startsWith("#")) return null;
  const digits = value.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(digits)) return null;
  if (digits.length === 3) return [0, 1, 2].map((i) => parseInt(digits[i] + digits[i], 16)) as Rgb;
  if (digits.length === 6) return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
  return null;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The colour for a score: low at 0, mid at 0.5, high at 1, straight lines between. */
export function rampColor(score: number, ramp: Ramp): Rgb {
  const s = Math.min(1, Math.max(0, score));
  const [from, to, t] = s < 0.5 ? [ramp.low, ramp.mid, s / 0.5] : [ramp.mid, ramp.high, (s - 0.5) / 0.5];
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
}

/** Scores on a regular longitude and latitude grid. Row 0 is latitude -90, column 0 is longitude -180. */
export type HeatField = {
  lonStepDeg: number;
  latStepDeg: number;
  lonCount: number;
  latCount: number;
  scores: Float32Array;
};

/** The score at a longitude and latitude, radians, by bilinear interpolation. Longitude wraps. */
export function sampleScore(field: HeatField, lon: number, lat: number): number {
  const lonDeg = (lon * 180) / Math.PI;
  const latDeg = (lat * 180) / Math.PI;
  let fx = (lonDeg + 180) / field.lonStepDeg;
  const wrapCount = field.lonCount - 1; // the last column repeats the first
  fx = ((fx % wrapCount) + wrapCount) % wrapCount;
  const fy = Math.min(field.latCount - 1, Math.max(0, (latDeg + 90) / field.latStepDeg));
  const x0 = Math.floor(fx);
  const y0 = Math.min(field.latCount - 2, Math.floor(fy));
  const x1 = x0 + 1;
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => field.scores[y * field.lonCount + x];
  return lerp(lerp(at(x0, y0), at(x1, y0), tx), lerp(at(x0, y0 + 1), at(x1, y0 + 1), tx), ty);
}

/** How strongly the layer tints the Earth: lighter where the score is 1, stronger where the dose rate is high. */
export const HEAT_ALPHA_AT_1 = 0.5;
export const HEAT_ALPHA_AT_0 = 0.72;

const heatAlpha = (score: number) => HEAT_ALPHA_AT_1 + (HEAT_ALPHA_AT_0 - HEAT_ALPHA_AT_1) * (1 - Math.min(1, Math.max(0, score)));

/** An RGBA8 texture, 360 by 180, row 0 at latitude -90, for the realistic globe's surface. */
export function heatTexture(field: HeatField, ramp: Ramp, width = 360, height = 180): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const lat = (((y + 0.5) / height) * Math.PI) - Math.PI / 2;
    for (let x = 0; x < width; x++) {
      const lon = (((x + 0.5) / width) * 2 * Math.PI) - Math.PI;
      const score = sampleScore(field, lon, lat);
      const [r, g, b] = rampColor(score, ramp);
      const k = (y * width + x) * 4;
      out[k] = Math.round(r);
      out[k + 1] = Math.round(g);
      out[k + 2] = Math.round(b);
      out[k + 3] = Math.round(255 * heatAlpha(score));
    }
  }
  return out;
}

/** One RGBA colour per particle, from the score at that particle's own position. */
export function particleColors(field: HeatField, lon: Float32Array, lat: Float32Array, ramp: Ramp): Uint8Array {
  const out = new Uint8Array(lon.length * 4);
  for (let i = 0; i < lon.length; i++) {
    const [r, g, b] = rampColor(sampleScore(field, lon[i], lat[i]), ramp);
    out[i * 4] = Math.round(r);
    out[i * 4 + 1] = Math.round(g);
    out[i * 4 + 2] = Math.round(b);
    out[i * 4 + 3] = 255;
  }
  return out;
}
