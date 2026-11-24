/**
 * Reads the structure of a rug picture: where its border bands begin and end,
 * and how long the repeating part of a band is. Pure functions over RGBA.
 */
import { linearToOklab, SRGB_TO_LINEAR, type Oklab } from '../domain/color';

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function labAt({ data }: Pixels, i: number, out: Float32Array, o: number): void {
  const p = i * 4;
  linearToOklab(
    SRGB_TO_LINEAR[data[p]!]!,
    SRGB_TO_LINEAR[data[p + 1]!]!,
    SRGB_TO_LINEAR[data[p + 2]!]!,
    out,
    o,
  );
}

/** Mean color of the one-pixel ring at distance `d` from the edge. */
function ringColor(px: Pixels, d: number): Oklab {
  const { width, height } = px;
  const sum: Oklab = [0, 0, 0];
  const lab = new Float32Array(3);
  let n = 0;
  const add = (x: number, y: number) => {
    labAt(px, y * width + x, lab, 0);
    sum[0] += lab[0]!;
    sum[1] += lab[1]!;
    sum[2] += lab[2]!;
    n++;
  };
  for (let x = d; x < width - d; x++) {
    add(x, d);
    add(x, height - 1 - d);
  }
  for (let y = d + 1; y < height - 1 - d; y++) {
    add(d, y);
    add(width - 1 - d, y);
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

const distance = (a: Oklab, b: Oklab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Change in ring color that counts as a new band. */
const BAND_STEP = 0.05;
const MAX_BANDS = 8;

/**
 * Distances from the edge, in pixels, where one border band ends and the next
 * begins. The last one is where the field starts.
 */
export function findBands(px: Pixels): number[] {
  const deepest = Math.floor(Math.min(px.width, px.height) * 0.4);
  if (deepest < 8) return [];
  const rings = Array.from({ length: deepest }, (_, d) => ringColor(px, d));
  const reach = Math.max(2, Math.round(Math.min(px.width, px.height) / 150));
  const mean = (from: number, to: number): Oklab => {
    const m: Oklab = [0, 0, 0];
    for (let d = from; d < to; d++) for (let j = 0; j < 3; j++) m[j]! += rings[d]![j]! / (to - from);
    return m;
  };
  const step = rings.map((_, d) =>
    d < reach || d > deepest - reach ? 0 : distance(mean(d - reach, d), mean(d, d + reach)),
  );

  // Strongest first, keeping them apart, then back in order.
  const spacing = reach * 2;
  const picked: number[] = [];
  const order = step.map((_, d) => d).sort((a, b) => step[b]! - step[a]!);
  for (const d of order) {
    if (step[d]! < BAND_STEP || picked.length >= MAX_BANDS) break;
    if (picked.every((other) => Math.abs(other - d) >= spacing)) picked.push(d);
  }
  return picked.sort((a, b) => a - b);
}

/** Is this patch one flat color, give or take noise? Returns the color if so. */
export function flatColor(px: Pixels, tolerance = 0.06): Oklab | null {
  const n = px.width * px.height;
  const lab = new Float32Array(n * 3);
  const mean: Oklab = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    labAt(px, i, lab, i * 3);
    for (let j = 0; j < 3; j++) mean[j]! += lab[i * 3 + j]! / n;
  }
  let spread = 0;
  for (let i = 0; i < n; i++) {
    spread += distance(mean, [lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!]) ** 2 / n;
  }
  return Math.sqrt(spread) <= tolerance ? mean : null;
}

/** How alike a strip must be to its shifted self to count as repeating. */
const REPEAT_LIKENESS = 0.45;

/**
 * Length of the repeating part of a horizontal strip, in pixels; null when the
 * strip does not clearly repeat.
 */
export function findRepeat(px: Pixels, minLength: number): number | null {
  const { width, height } = px;
  const longest = Math.floor(width / 2);
  const shortest = Math.max(4, Math.round(minLength));
  if (longest <= shortest) return null;
  const light = new Float32Array(width * height);
  const lab = new Float32Array(3);
  let mean = 0;
  for (let i = 0; i < light.length; i++) {
    labAt(px, i, lab, 0);
    light[i] = lab[0]!;
    mean += lab[0]! / light.length;
  }
  const likeness = (shift: number): number => {
    let both = 0;
    let left = 0;
    let right = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x + shift < width; x++) {
        const a = light[y * width + x]! - mean;
        const b = light[y * width + x + shift]! - mean;
        both += a * b;
        left += a * a;
        right += b * b;
      }
    }
    return left > 0 && right > 0 ? both / Math.sqrt(left * right) : 0;
  };
  const scores: number[] = [];
  for (let s = shortest; s <= longest; s++) scores.push(likeness(s));
  const top = Math.max(...scores);
  if (top < REPEAT_LIKENESS) return null;
  // The shortest shift that is a peak and nearly as good as the best.
  for (let i = 0; i < scores.length; i++) {
    const v = scores[i]!;
    const peak = v >= (scores[i - 1] ?? -1) && v >= (scores[i + 1] ?? -1);
    if (peak && i > 0 && v >= top * 0.85) return i + shortest;
  }
  return null;
}
