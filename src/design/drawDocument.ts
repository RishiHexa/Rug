import { hexToRgb } from '../domain/color';
import type { GridSpec } from '../domain/dimensions';
import type { DesignSource } from '../domain/pipeline';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One undoable change: the pixels of a rectangle before and after. */
interface Patch {
  x: number;
  y: number;
  before: HTMLCanvasElement;
  after: HTMLCanvasElement;
  blankBefore: boolean;
  blankAfter: boolean;
}

export const PAPER = '#ffffff';
const MAX_SIDE = 4000;
const MAX_HISTORY = 60;
/** Two RGBA copies per pixel: 40M px is about 320 MB. */
const MAX_HISTORY_PIXELS = 40_000_000;

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function drawingSize(grid: GridSpec): { width: number; height: number } {
  // Exactly one pixel per knot along the denser direction, at the physical
  // proportions. With square knots every knot is then one pixel, so drawn edges
  // land on knot edges and no blended colors appear in the map.
  const density = Math.max(grid.columns / grid.widthIn, grid.rows / grid.heightIn);
  const longIn = Math.max(grid.widthIn, grid.heightIn);
  const long = Math.min(MAX_SIDE, Math.round(longIn * density));
  const perInch = long / longIn;
  return {
    width: Math.max(1, Math.round(grid.widthIn * perInch)),
    height: Math.max(1, Math.round(grid.heightIn * perInch)),
  };
}

/**
 * The raster being drawn. Tools paint on `ctx`, then call `commit` with the
 * area they touched, which records the undo step.
 */
export class DrawDocument {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  /** True until something has been drawn. */
  blank = true;

  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private undoStack: Patch[] = [];
  private redoStack: Patch[] = [];

  /** `paper` is the empty canvas color; null leaves it transparent. */
  constructor(
    size: { width: number; height: number },
    readonly paper: string | null = PAPER,
  ) {
    this.width = size.width;
    this.height = size.height;
    this.canvas = makeCanvas(this.width, this.height);
    this.ctx = this.canvas.getContext('2d')!;
    this.base = makeCanvas(this.width, this.height);
    this.baseCtx = this.base.getContext('2d')!;
    if (paper) {
      for (const c of [this.ctx, this.baseCtx]) {
        c.fillStyle = paper;
        c.fillRect(0, 0, this.width, this.height);
      }
    }
  }

  /** Starts from an existing picture, stretched to the canvas. */
  load(image: CanvasImageSource): void {
    for (const c of [this.ctx, this.baseCtx]) {
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, this.width, this.height);
      c.drawImage(image, 0, 0, this.width, this.height);
    }
    this.blank = false;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  commit(dirty: Rect, blankAfter = false): void {
    const x = Math.max(0, Math.floor(dirty.x));
    const y = Math.max(0, Math.floor(dirty.y));
    const w = Math.min(this.width, Math.ceil(dirty.x + dirty.width)) - x;
    const h = Math.min(this.height, Math.ceil(dirty.y + dirty.height)) - y;
    if (w <= 0 || h <= 0) return;
    const copy = (from: HTMLCanvasElement) => {
      const c = makeCanvas(w, h);
      c.getContext('2d')!.drawImage(from, x, y, w, h, 0, 0, w, h);
      return c;
    };
    const patch: Patch = {
      x,
      y,
      before: copy(this.base),
      after: copy(this.canvas),
      blankBefore: this.blank,
      blankAfter,
    };
    replace(this.baseCtx, patch.after, x, y);
    this.blank = blankAfter;
    this.undoStack.push(patch);
    this.redoStack = [];
    this.trimHistory();
  }

  /** Puts back the last committed pixels of an area, e.g. under a live shape. */
  revert(area: Rect): void {
    const x = Math.max(0, Math.floor(area.x));
    const y = Math.max(0, Math.floor(area.y));
    const w = Math.min(this.width, Math.ceil(area.x + area.width)) - x;
    const h = Math.min(this.height, Math.ceil(area.y + area.height)) - y;
    if (w <= 0 || h <= 0) return;
    this.ctx.clearRect(x, y, w, h);
    this.ctx.drawImage(this.base, x, y, w, h, x, y, w, h);
  }

  undo(): void {
    const patch = this.undoStack.pop();
    if (!patch) return;
    this.put(patch.before, patch);
    this.blank = patch.blankBefore;
    this.redoStack.push(patch);
  }

  redo(): void {
    const patch = this.redoStack.pop();
    if (!patch) return;
    this.put(patch.after, patch);
    this.blank = patch.blankAfter;
    this.undoStack.push(patch);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    if (this.paper) {
      this.ctx.fillStyle = this.paper;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
    this.commit({ x: 0, y: 0, width: this.width, height: this.height }, true);
  }

  /** null where nothing is painted. */
  colorAt(x: number, y: number): string | null {
    const px = Math.min(this.width - 1, Math.max(0, Math.floor(x)));
    const py = Math.min(this.height - 1, Math.max(0, Math.floor(y)));
    const [r, g, b, a] = this.ctx.getImageData(px, py, 1, 1).data;
    if (a === 0) return null;
    return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
  }

  /** Flood fill from a point (scanline), committed as one step. */
  fill(startX: number, startY: number, hex: string): void {
    const sx = Math.floor(startX);
    const sy = Math.floor(startY);
    const { width, height } = this;
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) return;
    const image = this.ctx.getImageData(0, 0, width, height);
    const px = new Uint32Array(image.data.buffer);
    const [r, g, b] = hexToRgb(hex);
    const next = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    const target = px[sy * width + sx]!;
    if (target === next) return;
    // Tools paint hard edges, so an area is exactly one color.
    const open = (i: number) => px[i] === target;

    let minX = sx;
    let maxX = sx;
    let minY = sy;
    let maxY = sy;
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop()!;
      let x = stack.pop()!;
      const line = y * width;
      if (!open(line + x)) continue;
      while (x > 0 && open(line + x - 1)) x--;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      let above = false;
      let below = false;
      for (; x < width && open(line + x); x++) {
        const i = line + x;
        px[i] = next;
        if (y > 0) {
          const o = open(i - width);
          if (o && !above) stack.push(x, y - 1);
          above = o;
        }
        if (y < height - 1) {
          const o = open(i + width);
          if (o && !below) stack.push(x, y + 1);
          below = o;
        }
      }
      maxX = Math.max(maxX, x - 1);
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    this.ctx.putImageData(image, 0, 0, minX, minY, w, h);
    this.commit({ x: minX, y: minY, width: w, height: h });
  }

  private put(pixels: HTMLCanvasElement, at: { x: number; y: number }): void {
    replace(this.ctx, pixels, at.x, at.y);
    replace(this.baseCtx, pixels, at.x, at.y);
  }

  private trimHistory(): void {
    let pixels = 0;
    let keep = 0;
    for (let i = this.undoStack.length - 1; i >= 0 && keep < MAX_HISTORY; i--) {
      const { width, height } = this.undoStack[i]!.before;
      pixels += width * height;
      // The latest step is always undoable, however large it is.
      if (keep > 0 && pixels > MAX_HISTORY_PIXELS) break;
      keep++;
    }
    this.undoStack = this.undoStack.slice(this.undoStack.length - keep);
  }
}

/** Swaps pixels in, see-through ones included. */
function replace(ctx: CanvasRenderingContext2D, pixels: HTMLCanvasElement, x: number, y: number): void {
  ctx.clearRect(x, y, pixels.width, pixels.height);
  ctx.drawImage(pixels, x, y);
}

export function drawSource(doc: DrawDocument): DesignSource {
  return { kind: 'draw', produce: () => createImageBitmap(doc.canvas) };
}
