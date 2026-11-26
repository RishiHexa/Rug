/**
 * Cuts a shape out of its background. A rectangular crop of a rug always
 * carries some of the ground color around the motif; this finds the ground
 * that reaches the crop's edges and makes only that see-through, so colors
 * inside the shape that happen to match the ground stay. Pure, over RGBA.
 */
import { linearToOklab, SRGB_TO_LINEAR, type Oklab } from '../domain/color';
import type { Pixels } from './pixels';
import {
  and,
  dilate,
  edgePixels,
  flood,
  maskFrom,
  not,
  parts,
  partMask,
  removeSpecks,
  type Mask,
} from './mask';

/** OKLab of every pixel, averaged over a (2r+1)² box to calm the knot texture. */
export function smoothLab(px: Pixels, r: number): Float32Array {
  const { width, height, data } = px;
  const lab = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    linearToOklab(SRGB_TO_LINEAR[data[p]!]!, SRGB_TO_LINEAR[data[p + 1]!]!, SRGB_TO_LINEAR[data[p + 2]!]!, lab, i * 3);
  }
  if (r <= 0) return lab;
  // Separable box blur, clamped at the edges.
  const tmp = new Float32Array(lab.length);
  const blur = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const lines = horizontal ? height : width;
    const len = horizontal ? width : height;
    for (let line = 0; line < lines; line++) {
      const at = (k: number) => {
        const c = k < 0 ? 0 : k >= len ? len - 1 : k;
        return (horizontal ? line * width + c : c * width + line) * 3;
      };
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      for (let k = -r; k <= r; k++) {
        const q = at(k);
        s0 += src[q]!;
        s1 += src[q + 1]!;
        s2 += src[q + 2]!;
      }
      const n = 2 * r + 1;
      for (let k = 0; k < len; k++) {
        const o = at(k);
        dst[o] = s0 / n;
        dst[o + 1] = s1 / n;
        dst[o + 2] = s2 / n;
        const out = at(k - r);
        const inn = at(k + r + 1);
        s0 += src[inn]! - src[out]!;
        s1 += src[inn + 1]! - src[out + 1]!;
        s2 += src[inn + 2]! - src[out + 2]!;
      }
    }
  };
  blur(lab, tmp, true);
  blur(tmp, lab, false);
  return lab;
}

/**
 * Lightness counts half in color comparisons: abrash, the natural variation
 * of hand-dyed wool, mostly changes how light a color is, not its hue.
 */
export const LIGHT_WEIGHT = 0.5;

/** Color difference with lightness weighted down, see LIGHT_WEIGHT. */
export function yarnDistance(l1: number, a1: number, b1: number, l2: number, a2: number, b2: number): number {
  const dl = (l1 - l2) * LIGHT_WEIGHT;
  return Math.sqrt(dl * dl + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/** Pixels within `tolerance` of any of the colors. */
export function nearColors(lab: Float32Array, width: number, height: number, colors: Oklab[], tolerance: number): Mask {
  return maskFrom(width, height, (i) => {
    const p = i * 3;
    return colors.some(([l, a, b]) => yarnDistance(lab[p]!, lab[p + 1]!, lab[p + 2]!, l, a, b) <= tolerance);
  });
}

export interface ShapeOptions {
  /** Colors of the ground around the shape. */
  background: Oklab[];
  /** OKLab distance that still counts as ground. */
  tolerance: number;
  /**
   * edge: only ground connected to the crop's edges is removed, so the shape
   * keeps its inside. anywhere: all ground is removed (for a layer that sits
   * on a ground of the same color).
   */
  reach: 'edge' | 'anywhere';
  /**
   * all: every part big enough. center: the one part at the middle (a single
   * motif with bits of its neighbours at the crop's edges). A point keeps the
   * part nearest to it.
   */
  keep: 'all' | 'center' | { x: number; y: number };
  /** Parts smaller than this share of the crop are dropped. */
  minShare?: number;
  /** Pixels outside this mask are never part of the shape. */
  within?: Mask;
  /** Blur radius before comparing colors. */
  smooth?: number;
}

/** 1 where the shape is, 0 where the ground shows through. */
export function shapeMask(px: Pixels, o: ShapeOptions): Mask {
  const { width, height } = px;
  const lab = smoothLab(px, o.smooth ?? 1);
  const ground = nearColors(lab, width, height, o.background, o.tolerance);
  const removed = o.reach === 'edge' ? flood(ground, edgePixels(width, height)) : ground;
  let shape = not(removed);
  if (o.within) shape = and(shape, o.within);
  const minArea = Math.max(4, Math.round(width * height * (o.minShare ?? 0.0015)));
  shape = removeSpecks(shape, minArea);
  if (o.keep === 'all') return shape;

  const target = o.keep === 'center' ? { x: width / 2, y: height / 2 } : o.keep;
  const { labels, parts: found } = parts(shape);
  if (found.length === 0) return shape;
  // The part under the point, else the nearest by its box, preferring big parts.
  const under = labels[Math.round(target.y) * width + Math.round(target.x)];
  let best = found.find((p) => p.id === under) ?? null;
  if (!best) {
    let bestScore = Infinity;
    for (const p of found) {
      const dx = Math.max(p.box.x - target.x, 0, target.x - (p.box.x + p.box.width));
      const dy = Math.max(p.box.y - target.y, 0, target.y - (p.box.y + p.box.height));
      const score = Math.hypot(dx, dy) / Math.sqrt(p.area);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  // Pieces that touch the chosen part after a small grow belong to it too
  // (a motif broken by a stray ground-colored knot).
  const chosen = partMask(labels, width, height, [best!.id]);
  const near = dilate(chosen, Math.max(1, Math.round(Math.min(width, height) / 150)));
  const joined = new Set<number>([best!.id]);
  for (let i = 0; i < labels.length; i++) if (near.data[i] === 1 && labels[i]! > 0) joined.add(labels[i]!);
  return partMask(labels, width, height, [...joined]);
}

/** Typical spread of a color in a picture, as a tolerance for `shapeMask`. */
export function groundTolerance(lab: Float32Array, color: Oklab, near = 0.06): number {
  let sum = 0;
  let n = 0;
  for (let p = 0; p < lab.length; p += 3) {
    const d = yarnDistance(lab[p]!, lab[p + 1]!, lab[p + 2]!, color[0], color[1], color[2]);
    if (d < near) {
      sum += d * d;
      n++;
    }
  }
  const rms = n > 0 ? Math.sqrt(sum / n) : 0.03;
  return Math.min(0.07, Math.max(0.035, rms * 2));
}
