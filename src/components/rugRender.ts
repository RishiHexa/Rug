/** Draws finished, textured pictures of the rug. Used inside workers. */
import type { Palette } from '../domain/clustering';
import {
  applyPile,
  makePileLevels,
  makeYarnBitmap,
  makeYarnShades,
  renderYarnArea,
  type Fringe,
  type KnotArea,
  type PileLayer,
  type PileLevel,
} from './rugTexture';

/**
 * The part of the rug to draw. All lengths are device pixels, measured from the
 * rug's top-left corner.
 */
export interface FrameRequest {
  left: number;
  top: number;
  width: number;
  height: number;
  knotW: number;
  knotH: number;
  /** Smallest height of a texture row. */
  minRow: number;
  /** Adds a broad layer, for pictures seen both whole and close up. */
  broad?: boolean;
}

export interface Rug {
  indices: Uint16Array;
  shades: Uint32Array;
  columns: number;
  rows: number;
  yarn: OffscreenCanvas;
}

/** Knots at least this many pixels wide get drawn with flowing edges. */
const MIN_FLOWING_CELL = 1.5;

let pile: PileLevel[] | null = null;

export function makeRug(
  indices: Uint16Array,
  palette: readonly Palette[],
  columns: number,
  rows: number,
): Rug {
  const shades = makeYarnShades(palette);
  const yarn = toCanvas(makeYarnBitmap(indices, shades, columns, rows));
  return { indices, shades, columns, rows, yarn };
}

function toCanvas(image: ImageData): OffscreenCanvas {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas;
}

export function renderFrame(r: Rug, f: FrameRequest): OffscreenCanvas {
  const canvas = new OffscreenCanvas(f.width, f.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const cell = Math.min(f.knotW, f.knotH);
  if (cell < MIN_FLOWING_CELL) {
    ctx.drawImage(r.yarn, -f.left, -f.top, r.columns * f.knotW, r.rows * f.knotH);
  } else {
    const column = clamp(Math.floor(f.left / f.knotW) - 1, 0, r.columns - 1);
    const row = clamp(Math.floor(f.top / f.knotH) - 1, 0, r.rows - 1);
    const area: KnotArea = {
      column,
      row,
      columns: clamp(Math.ceil((f.left + f.width) / f.knotW) + 1, column + 1, r.columns) - column,
      rows: clamp(Math.ceil((f.top + f.height) / f.knotH) + 1, row + 1, r.rows) - row,
    };
    const sub = clamp(2 ** Math.round(Math.log2(cell)), 2, 16);
    const flowing = toCanvas(renderYarnArea(r.indices, r.shades, r.columns, r.rows, area, sub));
    ctx.drawImage(
      flowing,
      area.column * f.knotW - f.left,
      area.row * f.knotH - f.top,
      area.columns * f.knotW,
      area.rows * f.knotH,
    );
  }

  pile ??= makePileLevels();
  const image = ctx.getImageData(0, 0, f.width, f.height);
  applyPile(image, pile, pileLayers(f), -f.left, -f.top);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * One texture row per knot row when knots are large enough. Otherwise rows
 * cover 2, 4, 8… knots, so they stay the same size on screen; two steps are
 * mixed so nothing jumps while zooming.
 */
function pileLayers({ knotH, minRow, broad }: FrameRequest): PileLayer[] {
  const steps = Math.max(0, Math.log2(minRow / knotH));
  const step = Math.floor(steps);
  const blend = ((steps - step) * Math.PI) / 2;
  const layers = [
    { row: knotH * 2 ** step, strength: Math.cos(blend) },
    { row: knotH * 2 ** (step + 1), strength: Math.sin(blend) },
  ];
  // An uneven multiple, so the repeats of the two scales never line up.
  if (broad) layers.push({ row: knotH * 2 ** step * 6.37, strength: 0.4 });
  return layers;
}

/** The fringe at both warp ends; `x`, `y` is the rug's top-left corner. */
export function drawFringe(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  fringe: Fringe,
  x: number,
  y: number,
  scale: number,
  dpr: number,
): void {
  const reach = fringe.length * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.09, 0.6 / scale);
  ctx.shadowColor = 'rgba(40,34,26,0.35)';
  ctx.shadowBlur = Math.min(6, reach * 0.08) * dpr;
  ctx.shadowOffsetY = Math.min(3, reach * 0.04) * dpr;
  for (const tone of fringe.tones) {
    ctx.strokeStyle = tone.color;
    ctx.stroke(tone.path);
  }
  ctx.restore();
}

/** Slightly darker rim where the pile falls away at the edges. */
export function drawRim(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): void {
  const rim = Math.max(1, 0.25 * scale);
  ctx.strokeStyle = 'rgba(20,16,10,0.16)';
  ctx.lineWidth = rim;
  ctx.strokeRect(x + rim / 2, y + rim / 2, w - rim, h - rim);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
