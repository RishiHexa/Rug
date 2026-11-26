/** Paints a segment design, and prepares the artwork it uses. */
import { assignNearest, type Palette } from '../domain/clustering';
import { hexToOklab, hexToRgb, linearToOklab, oklabToHex, SRGB_TO_LINEAR } from '../domain/color';
import { dominantColor } from './analyse';
import { shapeMask } from './cutout';
import type { GridSpec } from '../domain/dimensions';
import type { DesignSource } from '../domain/pipeline';
import { layoutRug, type ArtKind, type RugLayout } from './layout';
import { ART_SLOTS, type Art, type ArtSlot, type SegmentDoc } from './model';

const MAX_ART_SIDE = 2000;
const MAX_OUTPUT_SIDE = 8192;

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** The segment field each kind of drawing operation takes its picture from. */
const ART_OF: Record<ArtKind, ArtSlot> = {
  main: 'art',
  corner: 'cornerArt',
  side: 'sideArt',
  center: 'centerArt',
  sideCenter: 'sideCenterArt',
};

/** Paints a layout; `scaleX/Y` are pixels per inch. */
export function paintLayout(
  ctx: CanvasRenderingContext2D,
  doc: SegmentDoc,
  layout: RugLayout,
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
): void {
  ctx.save();
  ctx.transform(scaleX, 0, 0, scaleY, x, y);
  for (const op of layout.ops) {
    const segment = doc.segments[op.segment];
    const art = op.art && segment ? segment[ART_OF[op.art]] : null;
    if (op.art && !art) continue;
    ctx.save();
    ctx.transform(...op.matrix);
    if (op.clip) {
      ctx.beginPath();
      op.clip.forEach(([u, v], i) => (i === 0 ? ctx.moveTo(u, v) : ctx.lineTo(u, v)));
      ctx.closePath();
      ctx.clip();
    }
    const { box } = op;
    if (!art) {
      ctx.fillStyle = op.color;
      ctx.fillRect(box.x, box.y, box.width, box.height);
    } else {
      ctx.imageSmoothingEnabled = !art.crisp;
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(box.x + box.width / 2, box.y + box.height / 2);
      ctx.scale(op.flipX ? -1 : 1, op.flipY ? -1 : 1);
      if (op.slot) {
        const { width, height } = art.canvas;
        const sw = width / op.slot.of;
        ctx.drawImage(art.canvas, sw * op.slot.index, 0, sw, height, -box.width / 2, -box.height / 2, box.width, box.height);
      } else {
        ctx.drawImage(art.canvas, -box.width / 2, -box.height / 2, box.width, box.height);
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The design at a given size, in whole pixels per knot. Hard-edged designs use
 * one, so every pixel is a knot; pictures use two for smoother sampling.
 */
export function renderSegments(doc: SegmentDoc, grid: GridSpec): HTMLCanvasElement {
  const { columns, rows, widthIn, heightIn } = grid;
  const arts = doc.segments.flatMap((s) => ART_SLOTS.map((slot) => s[slot]));
  const soft = arts.some((a) => a && !a.crisp);
  const perKnot = soft && Math.max(columns, rows) * 2 <= MAX_OUTPUT_SIDE ? 2 : 1;
  const canvas = makeCanvas(columns * perKnot, rows * perKnot);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const layout = layoutRug(doc, widthIn, heightIn, { x: widthIn / columns, y: heightIn / rows });
  paintLayout(ctx, doc, layout, 0, 0, canvas.width / widthIn, canvas.height / heightIn);
  return canvas;
}

export function segmentSource(doc: SegmentDoc, grid: GridSpec): DesignSource {
  return { kind: 'segments', produce: () => createImageBitmap(renderSegments(doc, grid)) };
}

/** Part of a picture as artwork, in picture pixels. */
export function cutArt(
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  maxSide = MAX_ART_SIDE,
): Art {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = makeCanvas(width * scale, height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return { canvas, crisp: false };
}

/** Makes every pixel close to `hex` transparent. Tolerance is in OKLab. */
export function clearColor(art: Art, hex: string, tolerance: number): Art {
  const { width, height } = art.canvas;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(art.canvas, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  const target = hexToOklab(hex);
  const lab = new Float32Array(3);
  for (let p = 0; p < data.length; p += 4) {
    linearToOklab(SRGB_TO_LINEAR[data[p]!]!, SRGB_TO_LINEAR[data[p + 1]!]!, SRGB_TO_LINEAR[data[p + 2]!]!, lab, 0);
    if (Math.hypot(lab[0]! - target[0], lab[1]! - target[1], lab[2]! - target[2]) <= tolerance) {
      data[p + 3] = 0;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { ...art, canvas };
}

/** Most common color round the edge of a picture: its background. */
export function edgeColor(canvas: HTMLCanvasElement): string {
  const { width, height } = canvas;
  const all = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height);
  const ring: number[] = [];
  for (let x = 0; x < width; x++) ring.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) ring.push(y * width, y * width + width - 1);
  const data = new Uint8ClampedArray(ring.length * 4);
  ring.forEach((i, n) => data.set(all.data.subarray(i * 4, i * 4 + 4), n * 4));
  return oklabToHex(dominantColor({ data, width: ring.length, height: 1 }));
}

/**
 * Only the shape: the background color is removed where it reaches the
 * picture's edges, so the same color inside the shape stays. `keep` center
 * drops bits of neighbouring motifs cut by the edges.
 */
export function keepShape(art: Art, hex: string, tolerance: number, keep: 'center' | 'all'): Art {
  const { width, height } = art.canvas;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(art.canvas, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  const mask = shapeMask(image, {
    background: [hexToOklab(hex)],
    tolerance,
    reach: 'edge',
    keep,
    smooth: Math.max(1, Math.round(Math.min(width, height) / 220)),
  });
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i] === 0) image.data[i * 4 + 3] = 0;
  ctx.putImageData(image, 0, 0);
  return { ...art, canvas };
}

/** Color of one pixel of a canvas. */
export function pixelHex(canvas: HTMLCanvasElement, x: number, y: number): string {
  const [r, g, b] = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
  return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
}

/** Artwork in the colors of a finished knot map. */
export function recolorArt(art: Art, detected: Palette[], current: Palette[]): Art {
  const { width, height } = art.canvas;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(art.canvas, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  const lab = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    linearToOklab(
      SRGB_TO_LINEAR[data[p]!]!,
      SRGB_TO_LINEAR[data[p + 1]!]!,
      SRGB_TO_LINEAR[data[p + 2]!]!,
      lab,
      i * 3,
    );
  }
  const index = new Uint16Array(width * height);
  assignNearest(lab, Float32Array.from(detected.flatMap((p) => p.oklab)), index);
  const rgb = current.map((p) => hexToRgb(p.hex));
  for (let i = 0; i < index.length; i++) {
    const [r, g, b] = rgb[index[i]!]!;
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
  }
  ctx.putImageData(image, 0, 0);
  return { ...art, canvas };
}

/**
 * The same design in the colors of a finished knot map: every color becomes
 * the palette color it was grouped into. Used to show the rug while resizing.
 */
export function recolorDoc(doc: SegmentDoc, detected: Palette[], current: Palette[]): SegmentDoc {
  const centroids = Float32Array.from(detected.flatMap((p) => p.oklab));
  const nearest = new Uint16Array(1);
  const recolorHex = (hex: string): string => {
    assignNearest(Float32Array.from(hexToOklab(hex)), centroids, nearest);
    return current[nearest[0]!]!.hex;
  };
  const art = (a: Art | null) => a && recolorArt(a, detected, current);
  return {
    ...doc,
    background: recolorHex(doc.background),
    segments: doc.segments.map((s) => ({
      ...s,
      color: s.color && recolorHex(s.color),
      ...Object.fromEntries(ART_SLOTS.map((slot) => [slot, art(s[slot])])),
    })),
  };
}

/** How a design without rules follows a new size. */
export type FreeResize = 'stretch' | 'crop';

/**
 * The part of a `width × height` picture of a rug that a rug of the new size
 * shows. Stretch uses all of it. Crop keeps the pattern at its size and trims
 * the edges, enlarging only as far as needed to cover a bigger rug.
 */
export function freeResizeSource(
  mode: FreeResize,
  image: { width: number; height: number },
  from: { widthIn: number; heightIn: number },
  to: { widthIn: number; heightIn: number },
): { x: number; y: number; width: number; height: number } {
  if (mode === 'stretch') return { x: 0, y: 0, width: image.width, height: image.height };
  const enlarge = Math.max(1, to.widthIn / from.widthIn, to.heightIn / from.heightIn);
  const width = image.width * (to.widthIn / from.widthIn / enlarge);
  const height = image.height * (to.heightIn / from.heightIn / enlarge);
  return { x: (image.width - width) / 2, y: (image.height - height) / 2, width, height };
}

/** A rule-less design at a new size. `crisp` keeps drawn edges hard. */
export function renderFreeResize(
  mode: FreeResize,
  image: ImageBitmap,
  from: GridSpec,
  to: GridSpec,
  crisp: boolean,
): HTMLCanvasElement {
  const part = freeResizeSource(mode, image, from, to);
  const limit = Math.max(4000, Math.min(MAX_OUTPUT_SIDE, Math.max(to.columns, to.rows)));
  const perInch = Math.max(part.width / to.widthIn, part.height / to.heightIn);
  const scale = Math.min(perInch, limit / Math.max(to.widthIn, to.heightIn));
  const canvas = crisp
    ? makeCanvas(to.columns, to.rows)
    : makeCanvas(to.widthIn * scale, to.heightIn * scale);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.imageSmoothingEnabled = !crisp;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, part.x, part.y, part.width, part.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
