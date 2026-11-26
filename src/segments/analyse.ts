/**
 * Reads the parts of a rug picture, the way a rug is described: border bands
 * from the outside in (edge band, guards, main border with its corners), then
 * the field with its ground, corner spandrels and their pockets, the central
 * medallion and its pendants, and the small motifs scattered on the ground.
 * For each it finds the background color and how it repeats. Pure, over RGBA.
 */
import { createRandom, kMeans, assignNearest } from '../domain/clustering';
import { linearToOklab, oklabToHex, SRGB_TO_LINEAR, type Oklab } from '../domain/color';
import { LIGHT_WEIGHT, nearColors, smoothLab, yarnDistance } from './cutout';
import {
  and,
  boundsOf,
  close,
  countOf,
  crop,
  dilate,
  emptyMask,
  fillHoles,
  flood,
  majority,
  maskFrom,
  minus,
  not,
  open,
  or,
  parts,
  partMask,
  quarterVote,
  resize,
  type Mask,
  type Rect,
} from './mask';
import type { Pixels } from './pixels';

// ---------------------------------------------------------------- pixels

export function cropPixels(px: Pixels, r: Rect): Pixels {
  const x0 = Math.max(0, Math.round(r.x));
  const y0 = Math.max(0, Math.round(r.y));
  const width = Math.max(1, Math.min(px.width - x0, Math.round(r.width)));
  const height = Math.max(1, Math.min(px.height - y0, Math.round(r.height)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * px.width + x0) * 4;
    data.set(px.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { data, width, height };
}

/** Rows become columns: a strip down the side reads like one across the top. */
export function transposePixels(px: Pixels): Pixels {
  const { width, height } = px;
  const data = new Uint8ClampedArray(px.data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = (x * height + y) * 4;
      data[d] = px.data[s]!;
      data[d + 1] = px.data[s + 1]!;
      data[d + 2] = px.data[s + 2]!;
      data[d + 3] = px.data[s + 3]!;
    }
  }
  return { data, width: height, height: width };
}

/** Box-averaged copy no longer than `maxSide`; returns the scale used. */
export function shrinkPixels(px: Pixels, maxSide: number): { pixels: Pixels; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(px.width, px.height));
  if (scale === 1) return { pixels: px, scale };
  const width = Math.max(1, Math.round(px.width * scale));
  const height = Math.max(1, Math.round(px.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor((y * px.height) / height);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * px.height) / height));
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor((x * px.width) / width);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * px.width) / width));
      const sum = [0, 0, 0, 0];
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const p = (sy * px.width + sx) * 4;
          for (let j = 0; j < 4; j++) sum[j]! += px.data[p + j]!;
        }
      }
      const n = (sy1 - sy0) * (sx1 - sx0);
      const d = (y * width + x) * 4;
      for (let j = 0; j < 4; j++) data[d + j] = sum[j]! / n;
    }
  }
  return { pixels: { data, width, height }, scale: width / px.width };
}

// ---------------------------------------------------------------- colors

interface Clusters {
  centroids: Oklab[];
  /** Share of pixels in each cluster. */
  shares: number[];
  labels: Uint16Array;
}

function cluster(lab: Float32Array, k: number, seed: number): Clusters {
  const n = lab.length / 3;
  const random = createRandom(seed);
  const step = Math.max(1, Math.floor(n / 40_000));
  const samples = new Float32Array(Math.ceil(n / step) * 3);
  let s = 0;
  for (let i = 0; i < n; i += step, s++) samples.set(lab.subarray(i * 3, i * 3 + 3), s * 3);
  const flat = kMeans(samples.subarray(0, s * 3), k, random);
  const labels = new Uint16Array(n);
  assignNearest(lab, flat, labels);
  const count = flat.length / 3;
  const shares = new Array<number>(count).fill(0);
  for (let i = 0; i < n; i++) shares[labels[i]!]! += 1 / n;
  const centroids = Array.from({ length: count }, (_, c): Oklab => [flat[c * 3]!, flat[c * 3 + 1]!, flat[c * 3 + 2]!]);
  return { centroids, shares, labels };
}

const dist = (a: Oklab, b: Oklab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const yarn = (a: Oklab, b: Oklab) => yarnDistance(a[0], a[1], a[2], b[0], b[1], b[2]);

/** Clusters close enough to `c` to count as the same yarn, abrash included. */
const sameAs = (clusters: Clusters, c: number, within = 0.045): Set<number> =>
  new Set(clusters.centroids.flatMap((o, i) => (yarn(o, clusters.centroids[c]!) <= within ? [i] : [])));

/**
 * The most common color of a patch; with `opaqueOnly`, of its visible pixels.
 * Clustered finely and unblurred, then near-identical clusters (light and
 * shade of one yarn) are taken together, so motifs do not muddy the ground.
 */
export function dominantColor(px: Pixels, opaqueOnly = false): Oklab {
  const all = smoothLab(px, 0);
  let lab = all;
  if (opaqueOnly) {
    const keep: number[] = [];
    for (let i = 0; i < px.width * px.height; i++) if (px.data[i * 4 + 3]! > 0) keep.push(i);
    if (keep.length > 0) {
      lab = new Float32Array(keep.length * 3);
      keep.forEach((i, n) => lab.set(all.subarray(i * 3, i * 3 + 3), n * 3));
    }
  }
  const c = cluster(lab, 8, 11);
  let best: Oklab = c.centroids[0]!;
  let bestShare = -1;
  for (let i = 0; i < c.centroids.length; i++) {
    const group = [...sameAs(c, i)];
    const share = group.reduce((n, j) => n + c.shares[j]!, 0);
    if (share <= bestShare) continue;
    bestShare = share;
    const mean: Oklab = [0, 0, 0];
    for (const j of group) for (let k = 0; k < 3; k++) mean[k]! += (c.centroids[j]![k]! * c.shares[j]!) / share;
    best = mean;
  }
  return best;
}

/** Mirror likeness of the lightness in an OKLab picture. */
function labMirrorLikeness(lab: Float32Array, width: number, height: number, axis: 'x' | 'y'): number {
  let mean = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) mean += lab[i * 3]! / n;
  let both = 0;
  let a2 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = lab[(y * width + x) * 3]! - mean;
      const j = axis === 'x' ? y * width + width - 1 - x : (height - 1 - y) * width + x;
      const b = lab[j * 3]! - mean;
      both += a * b;
      a2 += a * a;
    }
  }
  return a2 > 0 ? both / a2 : 0;
}

/**
 * Best mirror likeness of a strip about a vertical axis near its middle, after
 * blurring; and where that axis is, as an offset from the middle.
 */
export function stripMirror(px: Pixels): { likeness: number; offset: number } {
  const { width, height } = px;
  const lab = smoothLab(px, Math.max(1, Math.round(height / 12)));
  const n = width * height;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += lab[i * 3]! / n;
  const reach = Math.round(width * 0.03);
  let best = { likeness: -1, offset: 0 };
  for (let o = -reach; o <= reach; o++) {
    // Mirror about (width - 1) / 2 + o / 2: x pairs with width - 1 + o - x.
    let both = 0;
    let aa = 0;
    let bb = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const m = width - 1 + o - x;
        if (m < 0 || m >= width) continue;
        const a = lab[(y * width + x) * 3]! - mean;
        const b = lab[(y * width + m) * 3]! - mean;
        both += a * b;
        aa += a * a;
        bb += b * b;
      }
    }
    const likeness = aa > 0 && bb > 0 ? both / Math.sqrt(aa * bb) : 0;
    if (likeness > best.likeness) best = { likeness, offset: o / 2 };
  }
  return best;
}

/** Mirror likeness that counts as a mirrored design in a hand-knotted rug. */
const MIRRORED = 0.3;

// ---------------------------------------------------------------- bands

export type BandKind = 'plain' | 'guard' | 'main';

/**
 * A band edge, as a depth from each side of the picture. The sides are kept
 * apart because a photo rarely shows the same margin all round, and a
 * hand-knotted rug is rarely exactly square.
 */
export interface BandEdge {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type Side = (typeof SIDES)[number];

export const edgeAt = (depth: number): BandEdge => ({ top: depth, right: depth, bottom: depth, left: depth });
/** Average depth of an edge. */
export const depthOf = (e: BandEdge) => (e.top + e.right + e.bottom + e.left) / 4;

/** How one run of a band (along the ends, or down the sides) is built. */
export interface RunInfo {
  /** Between the corner squares, in picture pixels. */
  length: number;
  /** Length of one piece: the repeating unit, or one slot of a mirrored run. */
  unit: number | null;
  /**
   * Mirrored about its middle. The run is then a middle piece with a
   * sequence of `slots` different pieces either side, the far side mirrored,
   * as in a main border where each motif differs from its neighbour.
   */
  symmetric: boolean;
  /** Length of the middle piece of a mirrored run; 0 for none. */
  center: number;
  /** Where the mirror line is, from the middle of the strip as read (pixels). */
  axis: number;
  /** Different pieces in each half of a mirrored run; 1 for a plain repeat. */
  slots: number;
  /** Pieces in the run, or in each half when mirrored. */
  count: number;
  /** How alike the run is to its mirror image, and to itself one unit on. */
  likeness: number;
  repeatLikeness: number;
}

export interface BandInfo {
  outer: BandEdge;
  inner: BandEdge;
  kind: BandKind;
  /** Outside or inside the main border. */
  position: 'outer' | 'inner';
  ground: Oklab;
  /** Along the top and bottom, and down the sides. */
  endRun: RunInfo | null;
  sideRun: RunInfo | null;
}

/** Color at each depth from one side, over the middle of its length. */
function sideProfile(px: Pixels, side: Side, deepest: number): Float32Array {
  const { width, height } = px;
  const lab = new Float32Array(3);
  const out = new Float32Array(deepest * 3);
  const across = side === 'top' || side === 'bottom';
  const along = across ? width : height;
  const lo = Math.floor(along * 0.2);
  const hi = Math.ceil(along * 0.8);
  for (let d = 0; d < deepest; d++) {
    let l = 0;
    let a = 0;
    let b = 0;
    for (let t = lo; t < hi; t++) {
      const i =
        side === 'top'
          ? d * width + t
          : side === 'bottom'
            ? (height - 1 - d) * width + t
            : side === 'left'
              ? t * width + d
              : t * width + width - 1 - d;
      const p = i * 4;
      linearToOklab(SRGB_TO_LINEAR[px.data[p]!]!, SRGB_TO_LINEAR[px.data[p + 1]!]!, SRGB_TO_LINEAR[px.data[p + 2]!]!, lab, 0);
      l += lab[0]!;
      a += lab[1]!;
      b += lab[2]!;
    }
    const n = hi - lo;
    out[d * 3] = l / n;
    out[d * 3 + 1] = a / n;
    out[d * 3 + 2] = b / n;
  }
  return out;
}

/** Linear map from a depth on the top side to the same place on another side. */
interface DepthMap {
  scale: number;
  shift: number;
}

const sample = (profile: Float32Array, at: number, j: number): number => {
  const n = profile.length / 3;
  const i = Math.max(0, Math.min(n - 1.001, at));
  const f = Math.floor(i);
  const t = i - f;
  return profile[f * 3 + j]! * (1 - t) + profile[(f + 1) * 3 + j]! * t;
};

/**
 * Scale and shift that best line `profile` up with `reference`, so that
 * profile[scale·d + shift] ≈ reference[d]. The scale allows for perspective:
 * the side nearer the camera looks wider.
 */
function bestMap(profile: Float32Array, reference: Float32Array, most: number): DepthMap {
  const n = reference.length / 3;
  let best: DepthMap = { scale: 1, shift: 0 };
  let bestCost = Infinity;
  for (let scale = 0.75; scale <= 1.34; scale += 0.01) {
    for (let shift = -most; shift <= most; shift++) {
      let cost = 0;
      let count = 0;
      for (let d = 0; d < n; d++) {
        const at = scale * d + shift;
        if (at < 0 || at > n - 1) continue;
        for (let j = 0; j < 3; j++) cost += (sample(profile, at, j) - reference[d * 3 + j]!) ** 2;
        count++;
      }
      if (count < n * 0.7) continue;
      cost /= count;
      if (cost < bestCost) {
        bestCost = cost;
        best = { scale, shift };
      }
    }
  }
  return best;
}

/** How much darker than either side a dividing line is. */
const LINE_DARKER = 0.03;
/** A dividing line is at most this wide, in pixels at analysis size. */
const LINE_WIDEST = 6;

/**
 * Bands are usually divided by a thin dark line. An edge found as a color
 * change lands on one side of it or the other, depending on which side
 * changes more; for the edge to sit on the line the eye sees, it is moved to
 * the middle of a dark line within `near` of it, when there is one.
 */
function onLine(profile: Float32Array, at: number, near: number): number | null {
  const n = profile.length / 3;
  const L = (d: number) => profile[Math.max(0, Math.min(n - 1, d)) * 3]!;
  let best: number | null = null;
  let bestDepth = LINE_DARKER;
  for (let d = Math.max(1, at - near); d <= Math.min(n - 2, at + near); d++) {
    if (L(d) > L(d - 1) || L(d) > L(d + 1)) continue;
    // Lighter on both sides within a line's width.
    let left = 0;
    let right = 0;
    for (let w = 1; w <= LINE_WIDEST; w++) {
      left = Math.max(left, L(d - w) - L(d));
      right = Math.max(right, L(d + w) - L(d));
    }
    const depth = Math.min(left, right);
    if (depth > bestDepth) {
      bestDepth = depth;
      best = d;
    }
  }
  if (best === null) return null;
  // Middle of the dark run, for a line a few pixels wide.
  const floor = L(best) + bestDepth * 0.35;
  let lo = best;
  let hi = best;
  while (lo > 0 && best - lo < LINE_WIDEST && L(lo - 1) <= floor) lo--;
  while (hi < n - 1 && hi - best < LINE_WIDEST && L(hi + 1) <= floor) hi++;
  return Math.round((lo + hi) / 2);
}

/** Change that counts as a new band. */
const EDGE_STEP = 0.03;
const MAX_EDGES = 9;

/**
 * Band edges, outermost first. Each side is profiled on its own and lined up
 * with the top, so a wider margin on one side does not blur the others; the
 * edges are then found on their average.
 */
export function findBandEdges(px: Pixels): BandEdge[] {
  const short = Math.min(px.width, px.height);
  const most = Math.max(2, Math.round(short * 0.03));
  const deepest = Math.floor(short * 0.3);
  if (deepest < 16) return [];
  // Other sides are profiled deeper, so a wider-looking side still fits.
  const profiles = SIDES.map((side, i) => sideProfile(px, side, i === 0 ? deepest : Math.min(Math.floor(short * 0.45), Math.round(deepest * 1.4))));
  const maps = profiles.map((p, i) => (i === 0 ? { scale: 1, shift: 0 } : bestMap(p, profiles[0]!, most)));
  const mean: Oklab[] = Array.from({ length: deepest }, (_, d) => {
    const m: Oklab = [0, 0, 0];
    profiles.forEach((p, s) => {
      for (let j = 0; j < 3; j++) m[j]! += sample(p, maps[s]!.scale * d + maps[s]!.shift, j) / 4;
    });
    return m;
  });
  const reach = Math.max(2, Math.round(short / 450));
  const avg = (from: number, to: number): Oklab => {
    const m: Oklab = [0, 0, 0];
    for (let d = from; d < to; d++) for (let j = 0; j < 3; j++) m[j]! += mean[d]![j]! / (to - from);
    return m;
  };
  const strength = mean.map((_, d) =>
    d < reach || d > deepest - reach ? 0 : dist(avg(d - reach, d), avg(d, d + reach)),
  );
  const peaks = strength.flatMap((v, d) =>
    v >= EDGE_STEP && v >= (strength[d - 1] ?? 0) && v > (strength[d + 1] ?? 0) ? [d] : [],
  );
  // Thin dark lines between bands give two steps close together; keep one.
  const spacing = Math.max(reach * 2, Math.round(short * 0.009));
  const picked: number[] = [];
  for (const d of peaks.sort((a, b) => strength[b]! - strength[a]!)) {
    if (picked.length >= MAX_EDGES) break;
    if (picked.every((o) => Math.abs(o - d) >= spacing)) picked.push(d);
  }
  // Mapped to each side, then settled on that side's own sharpest change
  // nearby: the mapping is only a straight-line fit.
  const own = profiles.map((p) => {
    const n = p.length / 3;
    const m = (from: number, to: number): Oklab => {
      const o: Oklab = [0, 0, 0];
      for (let d = from; d < to; d++) for (let j = 0; j < 3; j++) o[j]! += p[d * 3 + j]! / (to - from);
      return o;
    };
    return Array.from({ length: n }, (_, d) => (d < reach || d > n - reach ? 0 : dist(m(d - reach, d), m(d, d + reach))));
  });
  const settle = (s: number, d: number) => {
    const guess = Math.round(maps[s]!.scale * d + maps[s]!.shift);
    const near = Math.max(2, Math.floor(spacing / 2));
    let best = guess;
    for (let e = guess - near; e <= guess + near; e++) if ((own[s]![e] ?? 0) > (own[s]![best] ?? 0)) best = e;
    return onLine(profiles[s]!, best, near) ?? best;
  };
  const edges = picked
    .sort((a, b) => a - b)
    .map((d) => ({ top: settle(0, d), right: settle(1, d), bottom: settle(2, d), left: settle(3, d) }));
  // Settling must not swap two edges round.
  return edges.filter((e, i) => i === 0 || SIDES.every((side) => e[side] > edges[i - 1]![side]));
}

/**
 * A picture usually shows a little floor or a light margin round the rug. A
 * first band thinner than this share of the short side is taken for that.
 */
const MARGIN_SHARE = 0.007;

/**
 * Floor or a light backdrop showing round the rug, per side: a neutral color
 * at the very edge that changes sharply into the colored rug.
 */
export function findMargin(px: Pixels): BandEdge {
  const short = Math.min(px.width, px.height);
  const deepest = Math.max(6, Math.round(short * 0.025));
  const out = edgeAt(0);
  for (const side of SIDES) {
    const p = sideProfile(px, side, deepest);
    const chroma = (d: number) => Math.hypot(p[d * 3 + 1]!, p[d * 3 + 2]!);
    const inner = Math.round(deepest * 0.8);
    // The rug's own edge color, a little way in.
    if (chroma(0) > 0.045 || chroma(inner) < chroma(0) + 0.02) continue;
    for (let d = 1; d < inner; d++) {
      if (chroma(d) >= (chroma(0) + chroma(inner)) / 2) {
        out[side] = d;
        break;
      }
    }
  }
  return out;
}

/** Strips are studied at most this thick, to keep the repeat search quick. */
const STRIP_SIDE = 36;

/**
 * Length of the repeating unit of a strip, using color as well as lightness,
 * and accepting the weaker match of hand-knotted work whose motifs are never
 * drawn quite the same twice. Returns the unit and how alike the strip is to
 * itself shifted by it.
 */
export function findPeriod(px: Pixels, shortest: number, longest: number): { unit: number; likeness: number } | null {
  const { width, height } = px;
  const lab = smoothLab(px, 1);
  const n = width * height;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) mean[j]! += lab[i * 3 + j]! / n;
  const weight = [LIGHT_WEIGHT, 1, 1];
  const v = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) v[i * 3 + j] = (lab[i * 3 + j]! - mean[j]!) * weight[j]!;
  const lo = Math.max(3, Math.round(shortest));
  const hi = Math.min(Math.floor(width / 2), Math.round(longest));
  if (hi <= lo + 2) return null;
  const scores: number[] = [];
  for (let s = lo; s <= hi; s++) {
    let both = 0;
    let aa = 0;
    let bb = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x + s < width; x++) {
        const p = (y * width + x) * 3;
        const q = p + s * 3;
        for (let j = 0; j < 3; j++) {
          both += v[p + j]! * v[q + j]!;
          aa += v[p + j]! ** 2;
          bb += v[q + j]! ** 2;
        }
      }
    }
    scores.push(aa > 0 && bb > 0 ? both / Math.sqrt(aa * bb) : 0);
  }
  const sorted = scores.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const top = sorted.at(-1)!;
  // A clear peak above the background, not just a slowly falling curve.
  if (top < PERIOD_LIKENESS || top - median < 0.1) return null;
  for (let i = 1; i < scores.length - 1; i++) {
    const s = scores[i]!;
    if (s >= scores[i - 1]! && s >= scores[i + 1]! && s >= top * 0.85) return { unit: i + lo, likeness: s };
  }
  return null;
}

const PERIOD_LIKENESS = 0.22;
/** How strongly slots are drawn towards being square, against the evidence of gaps. */
const SQUARE_PULL = 0.08;



/**
 * Slots each side of the middle of a mirrored border. Slots are about as long
 * as the band is thick; of the counts near that, the one whose slot edges fall
 * most on the border's ground, between its motifs, wins.
 */
function slotsPerHalf(strip: Pixels, thick: number, axis: number): number {
  const { width, height } = strip;
  const ground = dominantColor(strip);
  const lab = smoothLab(strip, 1);
  // Share of each column that is ground.
  const share = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = 0; y < height; y++) {
      const p = (y * width + x) * 3;
      if (yarnDistance(lab[p]!, lab[p + 1]!, lab[p + 2]!, ground[0], ground[1], ground[2]) < 0.06) n++;
    }
    share[x] = n / height;
  }
  const guess = (width / thick - 1) / 2;
  const mid = width / 2 + axis;
  let best = Math.max(1, Math.round(guess));
  let bestScore = -Infinity;
  for (let n = Math.max(1, Math.floor(guess) - 2); n <= Math.ceil(guess) + 2; n++) {
    const unit = width / (2 * n + 1);
    const near = Math.max(1, Math.round(unit * 0.08));
    let sum = 0;
    let count = 0;
    for (let i = 0; i <= n; i++) {
      for (const side of [1, -1]) {
        const at = Math.round(mid + side * (unit / 2 + i * unit));
        let most = 0;
        for (let x = at - near; x <= at + near; x++) if (x >= 0 && x < width) most = Math.max(most, share[x]!);
        if (at - near >= 0 && at + near < width) {
          sum += most;
          count++;
        }
      }
    }
    // Gaps between motifs, and slots not far from square.
    const score = (count ? sum / count : 0) - SQUARE_PULL * Math.abs(Math.log(unit / thick));
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

function runInfo(full: Pixels, kind: BandKind): RunInfo {
  const scale = Math.min(1, STRIP_SIDE / full.height);
  const strip = scale < 1 ? shrinkPixels(full, Math.max(1, Math.round(full.width * scale))).pixels : full;
  const k = full.width / strip.width;
  const length = full.width;
  const thick = full.height;
  const mirror = stripMirror(strip);
  const likeness = mirror.likeness;
  const none = { length, unit: null, symmetric: false, center: 0, axis: 0, slots: 1, count: 0, likeness, repeatLikeness: 0 };

  if (kind === 'main') {
    // A main border is laid out from its middle in slots about as long as the
    // band is thick, each slot a different motif: it does not repeat, it
    // mirrors. Hand-knotted slots vary too much to measure one by one.
    if (likeness < MIRRORED) {
      const found = findPeriod(strip, (thick * 0.6) / k, (thick * 3) / k);
      if (!found) return none;
      const unit = found.unit * k;
      return { ...none, unit, count: Math.max(1, Math.round(length / unit)), repeatLikeness: found.likeness };
    }
    const perHalf = slotsPerHalf(strip, thick / k, mirror.offset);
    const unit = length / (2 * perHalf + 1);
    return { ...none, unit, symmetric: true, center: unit, axis: mirror.offset * k, slots: perHalf, count: perHalf };
  }

  // Guards slide a small unit round the rug without mirroring.
  const found = findPeriod(strip, (thick * 0.4) / k, (thick * 4) / k);
  if (!found) return none;
  const unit = found.unit * k;
  return { ...none, unit, count: Math.max(1, Math.round(length / unit)), repeatLikeness: found.likeness };
}

/** The top run of a band, between its corner squares. */
export const endStrip = (px: Pixels, outer: BandEdge, inner: BandEdge): Pixels =>
  cropPixels(px, {
    x: inner.left,
    y: outer.top,
    width: px.width - inner.left - inner.right,
    height: inner.top - outer.top,
  });

/** The left run of a band, turned so it reads like the top one. */
export const sideStrip = (px: Pixels, outer: BandEdge, inner: BandEdge): Pixels =>
  transposePixels(
    cropPixels(px, {
      x: outer.left,
      y: inner.top,
      width: inner.left - outer.left,
      height: px.height - inner.top - inner.bottom,
    }),
  );

/**
 * Is a band one plain color? Most of its middle must stay close to its main
 * color. Hand-dyed wool streaks (abrash) stay close; motifs do not.
 */
export function isPlain(px: Pixels): boolean {
  const q = Math.max(1, Math.floor(px.height / 4));
  const middle = cropPixels(px, { x: 0, y: q, width: px.width, height: Math.max(1, px.height - 2 * q) });
  const lab = smoothLab(middle, 1);
  const n = middle.width * middle.height;
  const median = [0, 1, 2].map((j) => {
    const v = Float32Array.from({ length: n }, (_, i) => lab[i * 3 + j]!).sort();
    return v[Math.floor(n / 2)]!;
  });
  let close = 0;
  for (let i = 0; i < n; i++) {
    const p = i * 3;
    if (yarnDistance(lab[p]!, lab[p + 1]!, lab[p + 2]!, median[0]!, median[1]!, median[2]!) < 0.05) close++;
  }
  return close / n >= 0.88;
}

/**
 * A band is a run of one ground color: rows of motifs inside a band, or a
 * vine along it, can look like an edge, but the ground either side is the
 * same. Such edges are dropped.
 */
export function mergeBands(px: Pixels, edges: BandEdge[], origin: BandEdge): BandEdge[] {
  const out: BandEdge[] = [];
  let outer = origin;
  let ground: Oklab | null = null;
  for (const inner of edges) {
    const color = dominantColor(endStrip(px, outer, inner));
    if (ground && out.length > 0 && yarn(color, ground) < SAME_GROUND) {
      // Same ground as the band before: that band carries on to here.
      out[out.length - 1] = inner;
    } else {
      out.push(inner);
      ground = color;
    }
    outer = inner;
  }
  return out;
}

const SAME_GROUND = 0.04;

/**
 * A patterned sliver as the innermost band is usually a line along the
 * field's own edge, not a guard: the field starts at the edge before it.
 */
function dropSliver(px: Pixels, edges: BandEdge[], origin: BandEdge): BandEdge[] {
  if (edges.length < 3) return edges;
  const thick = edges.map((e, i) => depthOf(e) - depthOf(i === 0 ? origin : edges[i - 1]!));
  const last = thick.at(-1)!;
  const others = thick.slice(0, -1).sort((a, b) => a - b);
  const median = others[Math.floor((others.length - 1) / 2)]!;
  const inner = edges.at(-1)!;
  const outer = edges.at(-2)!;
  const ends = endStrip(px, outer, inner);
  if (isPlain(ends) || last >= median * 0.8) return edges;
  // A guard repeats a small unit along its length; the edge of a field does not.
  const repeats = [ends, sideStrip(px, outer, inner)].some((strip) => {
    const small = shrinkPixels(strip, Math.max(8, Math.round(strip.width * Math.min(1, STRIP_SIDE / strip.height)))).pixels;
    const k = strip.width / small.width;
    return findPeriod(small, (last * 0.4) / k, (last * 4) / k) !== null;
  });
  return repeats ? edges : edges.slice(0, -1);
}

function classifyBands(px: Pixels, edges: BandEdge[], origin: BandEdge): BandInfo[] {
  const raw = edges.map((inner, i) => {
    const outer = i === 0 ? origin : edges[i - 1]!;
    const top = endStrip(px, outer, inner);
    return { outer, inner, thick: depthOf(inner) - depthOf(outer), flat: isPlain(top), top };
  });
  const patterned = raw.filter((b) => !b.flat && b.thick >= 3);
  const sorted = patterned.map((b) => b.thick).sort((a, b) => a - b);
  // Lower median, so with two patterned bands the wider can still stand out.
  const median = sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
  const widest = patterned.reduce<(typeof raw)[number] | null>((w, b) => (!w || b.thick > w.thick ? b : w), null);
  const short = Math.min(px.width, px.height);
  const main =
    widest && (patterned.length === 1 ? widest.thick > short * 0.04 : widest.thick >= median * 1.8) ? widest : null;
  const mainIndex = main ? raw.indexOf(main) : raw.length;

  return raw.map((b, i): BandInfo => {
    const kind: BandKind = b.flat ? 'plain' : b === main ? 'main' : 'guard';
    const position = i < mainIndex ? ('outer' as const) : ('inner' as const);
    const ground = dominantColor(b.top);
    const base = { outer: b.outer, inner: b.inner, kind, position, ground };
    if (kind === 'plain') return { ...base, endRun: null, sideRun: null };
    return { ...base, endRun: runInfo(b.top, kind), sideRun: runInfo(sideStrip(px, b.outer, b.inner), kind) };
  });
}

// ---------------------------------------------------------------- field

export interface Region {
  /** Picture pixels. */
  box: Rect;
  /** Covers `box`; any resolution. */
  mask: Mask;
}

export interface FieldMotif extends Region {
  /** Times it appears in the whole field. */
  count: number;
}

export interface FieldInfo {
  box: Rect;
  ground: Oklab;
  /** OKLab distance that still counts as ground. */
  tolerance: number;
  /** Mirrored left/right and top/bottom, so a quarter makes the whole. */
  quartered: boolean;
  likeness: { x: number; y: number };
  /** Top-left spandrel; the others are its mirror images. */
  spandrel: (Region & { color: Oklab }) | null;
  /** Top-left spandrel's corner pocket. */
  pocket: (Region & { color: Oklab }) | null;
  medallion: Region | null;
  pendants: { top: Region; bottom: Region | null } | null;
  motifs: FieldMotif[];
  /** Why parts were or were not found, in words. */
  notes: string[];
}


/** The field is studied at this size at most; its small motifs at this. */
const FIELD_SIDE = 320;
const MOTIF_SIDE = 420;

function regionOf(mask: Mask, fieldBox: Rect, scale: number): Region | null {
  const b = boundsOf(mask);
  if (!b) return null;
  return {
    box: { x: fieldBox.x + b.x / scale, y: fieldBox.y + b.y / scale, width: b.width / scale, height: b.height / scale },
    mask: crop(mask, b),
  };
}

/** Big shapes are redrawn at most this size. */
const REFINE_SIDE = 720;

/**
 * A big shape found on the small field picture, drawn again at the picture's
 * own size. At the small size one pixel covers several knots, so the outline
 * comes out as a staircase, and a motif standing a few knots off the shape
 * looks joined to it. Here the ground between them shows, and only the shape
 * itself (its biggest piece, holes filled) is kept. The outline may move a
 * little either way from the small one, no further.
 *
 * A shape mirrored both ways about `center` (a medallion in a quartered
 * field) is then voted over its four mirror images, keeping what at least two
 * agree on. At full size a motif can touch the shape in one corner only, or
 * a gap in one corner's frame can let the ground in; neither survives a vote.
 */
function refineRegion(
  px: Pixels,
  region: Region,
  field: Rect,
  groundColors: Oklab[],
  tolerance: number,
  center?: { x: number; y: number },
): Region {
  const b = region.box;
  const pad = Math.max(4, Math.round(Math.max(b.width, b.height) * 0.04));
  let x0 = Math.max(field.x, Math.floor(b.x - pad));
  let y0 = Math.max(field.y, Math.floor(b.y - pad));
  let x1 = Math.min(field.x + field.width, Math.ceil(b.x + b.width + pad));
  let y1 = Math.min(field.y + field.height, Math.ceil(b.y + b.height + pad));
  if (center) {
    // The same reach either side of the middle, so every mirror image is in view.
    const rx = Math.max(center.x - x0, x1 - center.x);
    const ry = Math.max(center.y - y0, y1 - center.y);
    x0 = Math.max(field.x, Math.floor(center.x - rx));
    x1 = Math.min(field.x + field.width, Math.ceil(center.x + rx));
    y0 = Math.max(field.y, Math.floor(center.y - ry));
    y1 = Math.min(field.y + field.height, Math.ceil(center.y + ry));
  }
  const area: Rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  if (area.width < 8 || area.height < 8) return region;
  const { pixels: cp, scale: s } = shrinkPixels(cropPixels(px, area), REFINE_SIDE);
  const w = cp.width;
  const h = cp.height;
  // The small outline, at this size.
  const coarse = maskFrom(w, h, (i) => {
    const u = Math.floor(((x0 + (i % w) / s - b.x) / b.width) * region.mask.width);
    const v = Math.floor(((y0 + Math.floor(i / w) / s - b.y) / b.height) * region.mask.height);
    return u >= 0 && v >= 0 && u < region.mask.width && v < region.mask.height && region.mask.data[v * region.mask.width + u] === 1;
  });
  // How far the small outline can be off: about one of its pixels.
  const slack = Math.max(2, Math.round((Math.max(b.width, b.height) / Math.max(region.mask.width, region.mask.height)) * s * 1.5));
  const lab = smoothLab(cp, 1);
  const shape = open(not(nearColors(lab, w, h, groundColors, tolerance)), 1);
  const near = and(shape, dilate(coarse, slack));
  const pp = parts(near);
  const biggest = pp.parts.reduce<(typeof pp.parts)[number] | null>((m, p) => (!m || p.area > m.area ? p : m), null);
  if (!biggest) return region;
  let mask = fillHoles(partMask(pp.labels, w, h, [biggest.id]));
  if (center) {
    const filled = mask;
    const at = (x: number, y: number) => {
      const u = Math.round((x - x0) * s);
      const v = Math.round((y - y0) * s);
      return u >= 0 && v >= 0 && u < w && v < h ? filled.data[v * w + u]! : 0;
    };
    const voted = maskFrom(w, h, (i) => {
      const x = x0 + (i % w) / s;
      const y = y0 + Math.floor(i / w) / s;
      const mx = 2 * center.x - x;
      const my = 2 * center.y - y;
      return filled.data[i]! + at(mx, y) + at(x, my) + at(mx, my) >= 2;
    });
    const vp = parts(voted);
    const main = vp.parts.reduce<(typeof vp.parts)[number] | null>((m, p) => (!m || p.area > m.area ? p : m), null);
    if (main) mask = fillHoles(partMask(vp.labels, w, h, [main.id]));
  }
  const r = boundsOf(mask);
  // A redraw that lost most of the shape is a misreading; keep the small one.
  if (!r || countOf(mask) < countOf(coarse) * 0.5) return region;
  return { box: { x: x0 + r.x / s, y: y0 + r.y / s, width: r.width / s, height: r.height / s }, mask: crop(mask, r) };
}

function analyseField(px: Pixels, box: Rect, debug?: Record<string, Mask>): FieldInfo {
  const { pixels: fp, scale } = shrinkPixels(cropPixels(px, box), FIELD_SIDE);
  const W = fp.width;
  const H = fp.height;
  const area = W * H;
  // Clustered unblurred: blurring blends motif colors into muddy in-betweens.
  const lab = smoothLab(fp, 0);
  const k = cluster(lab, 10, 7);
  const none = emptyMask(W, H);

  const notes: string[] = [];
  // Blurred first: a hand-knotted rug, or a photo at a slight angle, is never
  // an exact mirror image of itself.
  const blurred = smoothLab(fp, Math.max(1, Math.round(W / 100)));
  const likeness = { x: labMirrorLikeness(blurred, W, H, 'x'), y: labMirrorLikeness(blurred, W, H, 'y') };
  const quartered = likeness.x >= MIRRORED && likeness.y >= MIRRORED;
  const vote = (m: Mask) => (quartered ? quarterVote(m, 2) : m);

  const histogram = (rects: Rect[], skip: Set<number> = new Set()) => {
    const counts = new Array<number>(k.centroids.length).fill(0);
    for (const r of rects) {
      for (let y = Math.max(0, Math.round(r.y)); y < Math.min(H, Math.round(r.y + r.height)); y++) {
        for (let x = Math.max(0, Math.round(r.x)); x < Math.min(W, Math.round(r.x + r.width)); x++) {
          const c = k.labels[y * W + x]!;
          if (!skip.has(c)) counts[c]!++;
        }
      }
    }
    return counts;
  };
  const argmax = (a: number[]) => a.indexOf(Math.max(...a));

  // Ground: what fills the middle of the long sides, between spandrels and medallion.
  const sideWindows: Rect[] = [
    { x: 0, y: H * 0.38, width: W * 0.14, height: H * 0.24 },
    { x: W * 0.86, y: H * 0.38, width: W * 0.14, height: H * 0.24 },
  ];
  const groundId = argmax(histogram(sideWindows));
  const groundSet = sameAs(k, groundId);
  const ground = k.centroids[groundId]!;
  const groundMask = vote(majority(maskFrom(W, H, (i) => groundSet.has(k.labels[i]!)), 1));
  // How far the ground's own pixels stray, for cutting shapes off it later.
  let spread = 0;
  let spreadCount = 0;
  for (let i = 0; i < W * H; i++) {
    if (!groundSet.has(k.labels[i]!)) continue;
    const p = i * 3;
    spread += yarnDistance(lab[p]!, lab[p + 1]!, lab[p + 2]!, ground[0], ground[1], ground[2]) ** 2;
    spreadCount++;
  }
  const tolerance = Math.min(0.07, Math.max(0.035, 2.2 * Math.sqrt(spread / Math.max(1, spreadCount))));
  if (debug) {
    debug.ground = groundMask;
    k.centroids.forEach((_, c) => (debug[`cluster${c}`] = maskFrom(W, H, (i) => k.labels[i] === c)));
  }

  // Spandrels: a second color owning all four corners.
  const cw = W * 0.3;
  const ch = H * 0.22;
  const corners: Rect[] = [
    { x: 0, y: 0, width: cw, height: ch },
    { x: W - cw, y: 0, width: cw, height: ch },
    { x: 0, y: H - ch, width: cw, height: ch },
    { x: W - cw, y: H - ch, width: cw, height: ch },
  ];
  // Spandrel colors: every non-ground color much denser in the corners than
  // in the rest of the field. A spandrel's gold is spread over several
  // clusters (light, shade, abrash), so no single cluster will do.
  const cornerCounts = histogram(corners);
  const allCounts = histogram([{ x: 0, y: 0, width: W, height: H }]);
  const cornerArea = corners.length * cw * ch;
  const restArea = area - cornerArea;
  const cornered = new Set(
    cornerCounts.flatMap((n, c) => {
      const inCorners = n / cornerArea;
      const elsewhere = (allCounts[c]! - n) / restArea;
      return !groundSet.has(c) && inCorners >= 0.03 && inCorners >= elsewhere * 1.8 ? [c] : [];
    }),
  );
  const mainCorner = [...cornered].sort((a, b) => cornerCounts[b]! - cornerCounts[a]!)[0];
  // The lit and shaded sides of the same gold pile cluster apart, and the
  // other shade is often used elsewhere too, so it fails the corner test on
  // its own. It is the same yarn all the same.
  if (mainCorner !== undefined) for (const c of sameAs(k, mainCorner)) if (!groundSet.has(c)) cornered.add(c);
  const perCorner = corners.map((r) => {
    const h = histogram([r]);
    return [...cornered].reduce((n, c) => n + h[c]!, 0) / (cw * ch);
  });
  notes.push(
    `Colors: ${k.centroids.map((c, i) => `${oklabToHex(c)} ${Math.round(k.shares[i]! * 100)}%`).join(', ')}.`,
    `Ground ${oklabToHex(ground)}; corner colors ${[...cornered].map((c) => oklabToHex(k.centroids[c]!)).join(' ') || 'none'} cover ${perCorner.map((v) => Math.round(v * 100) + '%').join(' ')}.`,
    `Mirror likeness ${likeness.x.toFixed(2)} across, ${likeness.y.toFixed(2)} down.`,
  );
  let spandrels: Mask | null = null;
  let spandrelColor: Oklab | null = null;
  let spandrelColorMask: Mask | null = null;
  if (mainCorner !== undefined && perCorner.filter((v) => v >= 0.2).length >= 3) {
    spandrelColor = k.centroids[mainCorner]!;
    spandrelColorMask = vote(majority(maskFrom(W, H, (i) => cornered.has(k.labels[i]!)), 1));
    // Only color that reaches into a corner; gold elsewhere (inside a
    // medallion, say) is not a spandrel.
    const touching = (r: Rect) => (p: { box: Rect }) =>
      p.box.x < r.x + r.width && p.box.x + p.box.width > r.x && p.box.y < r.y + r.height && p.box.y + p.box.height > r.y;
    // Sealed from the big corner areas alone: small gold flowers scattered
    // over the ground would otherwise be bridged into a wall across it.
    const gold = parts(spandrelColorMask);
    const large = gold.parts.filter((p) => p.area >= area * 0.005 && corners.some((r) => touching(r)(p)));
    const sealed = close(partMask(gold.labels, W, H, large.map((p) => p.id)), Math.max(1, Math.round(W * 0.012)));
    if (debug) debug.spandrelColor = sealed;
    const sp = parts(sealed);
    const inCorner = sp.parts.filter((p) => p.area >= area * 0.01 && corners.some((r) => touching(r)(p)));
    const barrier = partMask(sp.labels, W, H, inCorner.map((p) => p.id));
    // Everything the middle of the field cannot reach without crossing it.
    const seeds = [
      Math.floor(H / 2) * W + Math.floor(W / 2),
      Math.floor(W / 2),
      (H - 1) * W + Math.floor(W / 2),
      Math.floor(H / 2) * W,
      Math.floor(H / 2) * W + W - 1,
    ];
    const outside = flood(not(barrier), seeds);
    if (debug) Object.assign(debug, { barrier, outside });
    const enclosed = parts(not(outside));
    const kept = enclosed.parts.filter((p) => p.area >= area * 0.02 && corners.some((r) => touching(r)(p)));
    if (kept.length >= 3) spandrels = vote(partMask(enclosed.labels, W, H, kept.map((p) => p.id)));
  }

  // The top-left spandrel and its pocket.
  let spandrel: FieldInfo['spandrel'] = null;
  let pocket: FieldInfo['pocket'] = null;
  if (spandrels && spandrelColor && spandrelColorMask) {
    const quarter = maskFrom(W, H, (i) => i % W < W / 2 && i / W < H / 2);
    const tl = and(spandrels, quarter);
    const region = regionOf(tl, box, scale);
    if (region) {
      spandrel = { ...region, color: spandrelColor };
      // A pocket: a patch in the very corner that is not the spandrel's color.
      const b = boundsOf(tl)!;
      const notGold = open(minus(tl, spandrelColorMask), 1);
      const pp = parts(notGold);
      const reach = Math.max(3, Math.round(Math.min(b.width, b.height) * 0.12));
      const candidates = pp.parts.filter(
        (p) =>
          p.box.x <= b.x + reach &&
          p.box.y <= b.y + reach &&
          p.area >= b.width * b.height * 0.03 &&
          p.box.width * p.box.height <= b.width * b.height * 0.5 &&
          p.area / (p.box.width * p.box.height) >= 0.4,
      );
      const best = candidates.sort((a, c) => c.area - a.area)[0];
      if (best) {
        const m = fillHoles(partMask(pp.labels, W, H, [best.id]));
        const r = regionOf(m, box, scale);
        const pocketPx = cropPixels(fp, best.box);
        if (r) pocket = { ...r, color: dominantColor(pocketPx) };
      }
    }
  }

  // Medallion and pendants: big non-ground shapes on the middle lines.
  const notGround = minus(not(groundMask), spandrels ?? none);
  const thin = Math.max(1, Math.round(W * 0.004));
  const solid = fillHoles(close(open(notGround, thin), 1));
  if (debug) Object.assign(debug, { notGround, solid });
  const neck = Math.max(2, Math.round(W * 0.01));
  const cut = open(solid, neck);
  const cp = parts(cut);
  const cx = W / 2;
  const cy = H / 2;
  const centerPart =
    cp.parts.find((p) => p.id === cp.labels[Math.floor(cy) * W + Math.floor(cx)]) ??
    cp.parts
      .filter((p) => p.area >= area * 0.02)
      .find((p) => p.box.x <= cx && p.box.x + p.box.width >= cx && p.box.y <= cy && p.box.y + p.box.height >= cy);
  let medallion: Region | null = null;
  let medMask: Mask | null = null;
  if (centerPart && centerPart.area >= area * 0.02 && centerPart.area <= area * 0.7) {
    // Grow back what the cut took, but only onto the shape itself.
    medMask = fillHoles(and(dilate(partMask(cp.labels, W, H, [centerPart.id]), neck), solid));
    medallion = regionOf(medMask, box, scale);
  }

  let pendants: FieldInfo['pendants'] = null;
  let pendantMask: Mask | null = null;
  if (medMask && medallion && centerPart) {
    const onAxis = cp.parts.filter(
      (p) =>
        p.id !== centerPart.id &&
        p.area >= area * 0.004 &&
        p.box.x <= cx + 1 &&
        p.box.x + p.box.width >= cx - 1 &&
        p.box.width < W * 0.6,
    );
    const mb = boundsOf(medMask)!;
    const above = onAxis.filter((p) => p.box.y + p.box.height <= mb.y + mb.height * 0.15).sort((a, b) => b.area - a.area)[0];
    const below = onAxis.filter((p) => p.box.y >= mb.y + mb.height * 0.85).sort((a, b) => b.area - a.area)[0];
    const grow = (p: { id: number }) =>
      fillHoles(and(dilate(partMask(cp.labels, W, H, [p.id]), neck), minus(solid, dilate(medMask!, 1))));
    const topMask = above ? grow(above) : null;
    const bottomMask = below ? grow(below) : null;
    const top = topMask && regionOf(topMask, box, scale);
    const bottom = bottomMask && regionOf(bottomMask, box, scale);
    if (top) pendants = { top, bottom };
    else if (bottom) pendants = { top: bottom, bottom: null };
    if (topMask || bottomMask) pendantMask = or(topMask ?? none, bottomMask ?? none);
  }

  // Outlines of the big shapes, at full size.
  const groundColors = [...groundSet].map((c) => k.centroids[c]!);
  const sharpen = (r: Region) => refineRegion(px, r, box, groundColors, tolerance);
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (medallion) medallion = refineRegion(px, medallion, box, groundColors, tolerance, quartered ? middle : undefined);
  if (pendants) pendants = { top: sharpen(pendants.top), bottom: pendants.bottom && sharpen(pendants.bottom) };

  // Small motifs on the ground. They are only a few pixels across at the
  // size above, so they are looked for again in more detail, in one quarter
  // when the field is quartered.
  const big = dilate(or(or(medMask ?? none, pendantMask ?? none), spandrels ?? none), 1);
  const part: Rect = quartered ? { x: 0, y: 0, width: box.width / 2, height: box.height / 2 } : { ...box, x: 0, y: 0 };
  const { pixels: mp, scale: ms } = shrinkPixels(
    cropPixels(px, { x: box.x, y: box.y, width: part.width, height: part.height }),
    MOTIF_SIDE,
  );
  const MW = mp.width;
  const MH = mp.height;
  const mlab = smoothLab(mp, 0);
  const mlabels = new Uint16Array(MW * MH);
  assignNearest(mlab, Float32Array.from(k.centroids.flat()), mlabels);
  const mGround = majority(maskFrom(MW, MH, (i) => groundSet.has(mlabels[i]!)), 1);
  const bigHere = resize(crop(big, { x: 0, y: 0, width: Math.round(part.width * scale), height: Math.round(part.height * scale) }), MW, MH);
  const scatter = minus(fillHoles(open(not(mGround), 1)), dilate(bigHere, 2));
  const sp = parts(scatter);
  const mArea = MW * MH;
  const motifs = sp.parts
    .filter((p) => p.area >= mArea * 0.0015 && p.area <= mArea * 0.05)
    .sort((a, b) => b.area - a.area)
    .slice(0, 24)
    .map((p): FieldMotif => {
      const r = regionOf(partMask(sp.labels, MW, MH, [p.id]), box, ms)!;
      // On a middle line, a motif is its own mirror image: fewer copies.
      const onX = quartered && p.box.x + p.box.width >= MW - 2;
      const onY = quartered && p.box.y + p.box.height >= MH - 2;
      return { ...r, count: quartered ? 4 / (onX ? 2 : 1) / (onY ? 2 : 1) : 1 };
    });

  return { box, ground, tolerance, quartered, likeness, spandrel, pocket, medallion, pendants, motifs, notes };
}

export interface RugAnalysis {
  width: number;
  height: number;
  /** Light margin or floor round the rug, left out. */
  margin: BandEdge;
  bands: BandInfo[];
  field: FieldInfo;
}

// ---------------------------------------------------------------- light

/** Linear light (0..1, in 8192 steps) to an sRGB byte. */
const LINEAR_TO_BYTE = Uint8ClampedArray.from({ length: 8193 }, (_, i) => {
  const v = i / 8192;
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
});

/** Light falling off by less than this across the picture is left alone. */
const EVEN_ENOUGH = Math.log(1.06);

/**
 * How the light falls across the picture: log brightness rising by `x` from
 * the left edge to the right, and by `y` from top to bottom. A rug's design
 * is mirrored about its middle, so it has no such slope of its own; any slope
 * is the lighting. Fitted on the middle of the picture, clear of the floor.
 */
export function lightSlope(px: Pixels): { x: number; y: number } {
  const { width, height, data } = px;
  const step = Math.max(1, Math.round(Math.min(width, height) / 300));
  // Same number of samples either side of the middle, so the slopes separate.
  const half = (n: number) => Math.floor((n * 0.42) / step) * step;
  const hx = half(width);
  const hy = half(height);
  const mx = Math.floor(width / 2);
  const my = Math.floor(height / 2);
  let sux = 0;
  let suu = 0;
  let svy = 0;
  let svv = 0;
  for (let y = my - hy; y <= my + hy; y += step) {
    for (let x = mx - hx; x <= mx + hx; x += step) {
      const p = (y * width + x) * 4;
      const lum =
        0.2126 * SRGB_TO_LINEAR[data[p]!]! + 0.7152 * SRGB_TO_LINEAR[data[p + 1]!]! + 0.0722 * SRGB_TO_LINEAR[data[p + 2]!]!;
      const g = Math.log(lum + 0.004);
      const u = (x - mx) / width;
      const v = (y - my) / height;
      sux += u * g;
      suu += u * u;
      svy += v * g;
      svv += v * v;
    }
  }
  return { x: suu > 0 ? sux / suu : 0, y: svv > 0 ? svy / svv : 0 };
}

/**
 * The picture as if lit evenly. A photo lit from one side makes one yarn look
 * like two colors, lighter at one end of the rug: the ground then seems to
 * change part way down, and a spandrel's gold only matches in two corners.
 */
export function evenLight(px: Pixels): { pixels: Pixels; slope: { x: number; y: number } } {
  const slope = lightSlope(px);
  if (Math.max(Math.abs(slope.x), Math.abs(slope.y)) < EVEN_ENOUGH) return { pixels: px, slope };
  const { width, height, data } = px;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    const row = slope.y * (y / height - 0.5);
    for (let x = 0; x < width; x++) {
      const k = 8192 * Math.exp(-(row + slope.x * (x / width - 0.5)));
      const p = (y * width + x) * 4;
      for (let j = 0; j < 3; j++) out[p + j] = LINEAR_TO_BYTE[Math.min(8192, Math.round(SRGB_TO_LINEAR[data[p + j]!]! * k))]!;
      out[p + 3] = data[p + 3]!;
    }
  }
  return { pixels: { width, height, data: out }, slope };
}

/**
 * Everything at once. `edges` are band edges in picture pixels, outermost
 * first; found automatically when left out.
 */
export function analyseRug(picture: Pixels, edges?: BandEdge[], debug?: Record<string, Mask>): RugAnalysis {
  const { pixels: px, slope } = evenLight(picture);
  const short = Math.min(px.width, px.height);
  const fits = (e: BandEdge) => SIDES.every((s) => e[s] > 0) && Math.max(e.top + e.bottom, e.left + e.right) < short - 8;
  // Edges are found on the picture as taken: an edge is a sharp local change,
  // which uneven light barely moves, and evening it out would make the four
  // sides' profiles line up less well with each other.
  const margin = edges ? edgeAt(0) : findMargin(picture);
  const clear = (e: BandEdge) => SIDES.every((side) => e[side] > margin[side] + 3);
  let lines = (edges ?? findBandEdges(picture)).filter((e) => fits(e) && (edges !== undefined || clear(e)));
  if (!edges && lines.length > 1 && depthOf(lines[0]!) - depthOf(margin) < short * MARGIN_SHARE) lines = lines.slice(1);
  if (!edges) lines = dropSliver(px, mergeBands(px, lines, margin), margin);
  const bands = classifyBands(px, lines, margin);
  const e = lines.at(-1) ?? margin;
  const box = { x: e.left, y: e.top, width: px.width - e.left - e.right, height: px.height - e.top - e.bottom };
  const field = analyseField(px, box, debug);
  if (px !== picture) {
    const pct = (s: number) => Math.round((Math.exp(Math.abs(s)) - 1) * 100);
    const words = [
      slope.y !== 0 && `${pct(slope.y)}% ${slope.y > 0 ? 'lighter at the bottom' : 'lighter at the top'}`,
      slope.x !== 0 && `${pct(slope.x)}% ${slope.x > 0 ? 'lighter on the right' : 'lighter on the left'}`,
    ].filter(Boolean);
    field.notes.unshift(`Uneven light evened out: ${words.join(', ')}.`);
  }
  return { width: px.width, height: px.height, margin, bands, field };
}
