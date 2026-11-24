/**
 * Groups knot colors into a small set of distinct yarn colors. Pure functions
 * over a flat Float32Array of OKLab triples.
 */
import { oklabToHex, type Oklab } from './color';

export { hexToOklab } from './color';

export interface Palette {
  id: number;
  oklab: Oklab;
  hex: string;
  knotCount: number;
}

export interface ClusterSettings {
  targetColorCount: number;
  /** Smallest allowed OKLab distance between two palette colors. */
  minColorDifference: number;
}

export interface ClusterResult {
  indices: Uint16Array;
  /** Sorted by knot count, largest first; `indices` point into this array. */
  palette: Palette[];
}

export const MAX_FIT_SAMPLES = 200_000;
const MAX_ITERATIONS = 24;
const CONVERGED_SQ = 1e-7;
/** Samples closer than this to a centroid count as already represented. */
const SAME_COLOR_SQ = 1e-8;

/** Small seeded generator, so the same design always gives the same map. */
export function createRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One random knot from each of `max` equal strata; everything when it fits. */
export function subsample(lab: Float32Array, max: number, random: () => number): Float32Array {
  const n = lab.length / 3;
  if (n <= max) return lab;
  const out = new Float32Array(max * 3);
  const stride = n / max;
  for (let i = 0; i < max; i++) {
    const pick = Math.min(n - 1, Math.floor((i + random()) * stride)) * 3;
    out[i * 3] = lab[pick]!;
    out[i * 3 + 1] = lab[pick + 1]!;
    out[i * 3 + 2] = lab[pick + 2]!;
  }
  return out;
}

function distanceSq(lab: Float32Array, i: number, centroids: Float32Array, c: number): number {
  const dl = lab[i]! - centroids[c]!;
  const da = lab[i + 1]! - centroids[c + 1]!;
  const db = lab[i + 2]! - centroids[c + 2]!;
  return dl * dl + da * da + db * db;
}

/** k-means++ seeding. May return fewer than `k` when there are fewer colors. */
export function seedCentroids(samples: Float32Array, k: number, random: () => number): Float32Array {
  const n = samples.length / 3;
  const centroids = new Float32Array(k * 3);
  const nearest = new Float32Array(n).fill(Infinity);
  let pick = Math.floor(random() * n);
  let count = 0;
  while (count < k) {
    centroids.set(samples.subarray(pick * 3, pick * 3 + 3), count * 3);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = distanceSq(samples, i * 3, centroids, count * 3);
      if (d < nearest[i]!) nearest[i] = d < SAME_COLOR_SQ ? 0 : d;
      total += nearest[i]!;
    }
    count++;
    if (total === 0) break;
    let target = random() * total;
    pick = -1;
    for (let i = 0; i < n; i++) {
      const d = nearest[i]!;
      if (d === 0) continue;
      pick = i;
      target -= d;
      if (target <= 0) break;
    }
  }
  return centroids.slice(0, count * 3);
}

/** Index of the nearest centroid for every color, written into `out`. */
export function assignNearest(
  lab: Float32Array,
  centroids: Float32Array,
  out: Uint16Array,
  onProgress?: (fraction: number) => void,
): void {
  const n = out.length;
  const k = centroids.length / 3;
  for (let i = 0; i < n; i++) {
    const p = i * 3;
    const l = lab[p]!;
    const a = lab[p + 1]!;
    const b = lab[p + 2]!;
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const q = c * 3;
      const dl = l - centroids[q]!;
      const da = a - centroids[q + 1]!;
      const db = b - centroids[q + 2]!;
      const d = dl * dl + da * da + db * db;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    out[i] = best;
    if (onProgress && (i & 0x3ffff) === 0) onProgress(i / n);
  }
}

/** Mean color and size of each cluster. Empty clusters keep their centroid. */
function clusterMeans(
  lab: Float32Array,
  assignment: Uint16Array,
  centroids: Float32Array,
): { means: Float32Array; counts: Float64Array } {
  const k = centroids.length / 3;
  const sums = new Float64Array(k * 3);
  const counts = new Float64Array(k);
  for (let i = 0; i < assignment.length; i++) {
    const c = assignment[i]!;
    const p = i * 3;
    const q = c * 3;
    sums[q]! += lab[p]!;
    sums[q + 1]! += lab[p + 1]!;
    sums[q + 2]! += lab[p + 2]!;
    counts[c]!++;
  }
  const means = centroids.slice();
  for (let c = 0; c < k; c++) {
    const size = counts[c]!;
    if (size === 0) continue;
    for (let j = 0; j < 3; j++) means[c * 3 + j] = sums[c * 3 + j]! / size;
  }
  return { means, counts };
}

/** k-means++ with Lloyd iterations. */
export function kMeans(
  samples: Float32Array,
  k: number,
  random: () => number,
  onProgress?: (fraction: number) => void,
): Float32Array {
  let centroids = seedCentroids(samples, k, random);
  const assignment = new Uint16Array(samples.length / 3);
  for (let it = 0; it < MAX_ITERATIONS; it++) {
    onProgress?.(it / MAX_ITERATIONS);
    assignNearest(samples, centroids, assignment);
    const { means } = clusterMeans(samples, assignment, centroids);
    let moved = 0;
    for (let c = 0; c < means.length; c += 3) {
      moved = Math.max(moved, distanceSq(means, c, centroids, c));
    }
    centroids = means;
    if (moved < CONVERGED_SQ) break;
  }
  return centroids;
}

/**
 * Repeatedly merges the two closest centroids, weighted by knot count, until
 * every remaining pair is at least `minDifference` apart. Empty centroids are
 * dropped.
 */
export function mergeCentroids(
  centroids: Float32Array,
  counts: ArrayLike<number>,
  minDifference: number,
): Float32Array {
  const items: { lab: Oklab; count: number }[] = [];
  for (let c = 0; c < centroids.length / 3; c++) {
    if (counts[c]! > 0) {
      items.push({
        lab: [centroids[c * 3]!, centroids[c * 3 + 1]!, centroids[c * 3 + 2]!],
        count: counts[c]!,
      });
    }
  }
  for (;;) {
    let best = minDifference;
    let pair: [number, number] | null = null;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const d = oklabDistance(items[i]!.lab, items[j]!.lab);
        if (d < best) {
          best = d;
          pair = [i, j];
        }
      }
    }
    if (!pair) break;
    const a = items[pair[0]]!;
    const b = items[pair[1]]!;
    const count = a.count + b.count;
    const mix = (j: 0 | 1 | 2) => (a.lab[j] * a.count + b.lab[j] * b.count) / count;
    items[pair[0]] = { lab: [mix(0), mix(1), mix(2)], count };
    items.splice(pair[1], 1);
  }
  return Float32Array.from(items.flatMap((i) => i.lab));
}

export function oklabDistance(a: Oklab, b: Oklab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Full pass: fit, merge near-duplicates, assign every knot. */
export function clusterKnots(
  lab: Float32Array,
  settings: ClusterSettings,
  onProgress?: (fraction: number) => void,
): ClusterResult {
  const random = createRandom(1);
  const samples = subsample(lab, MAX_FIT_SAMPLES, random);
  const fitted = kMeans(samples, settings.targetColorCount, random, (f) => onProgress?.(f * 0.6));

  const indices = new Uint16Array(lab.length / 3);
  assignNearest(lab, fitted, indices, (f) => onProgress?.(0.6 + f * 0.2));
  const { means, counts } = clusterMeans(lab, indices, fitted);

  const merged = mergeCentroids(means, counts, settings.minColorDifference);
  assignNearest(lab, merged, indices, (f) => onProgress?.(0.8 + f * 0.2));
  return buildPalette(indices, merged);
}

/** Sorts clusters by size, drops empty ones and renumbers `indices` to match. */
function buildPalette(indices: Uint16Array, centroids: Float32Array): ClusterResult {
  const k = centroids.length / 3;
  const counts = new Uint32Array(k);
  for (let i = 0; i < indices.length; i++) counts[indices[i]!]!++;
  const order = Array.from({ length: k }, (_, c) => c)
    .filter((c) => counts[c]! > 0)
    .sort((a, b) => counts[b]! - counts[a]!);

  const rank = new Uint16Array(k);
  const palette = order.map((c, i): Palette => {
    rank[c] = i;
    const oklab: Oklab = [centroids[c * 3]!, centroids[c * 3 + 1]!, centroids[c * 3 + 2]!];
    return { id: i + 1, oklab, hex: oklabToHex(oklab), knotCount: counts[c]! };
  });
  for (let i = 0; i < indices.length; i++) indices[i] = rank[indices[i]!]!;
  return { indices, palette };
}
