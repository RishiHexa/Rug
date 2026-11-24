/** Pixels for the rug preview. Runs in workers, apart from the fringe. */
import { createRandom, type Palette } from '../domain/clustering';
import { hexToRgb, oklabToHex } from '../domain/color';
import type { GridSpec } from '../domain/dimensions';

const JITTER_LEVELS = 16;

/** Yarn colors as packed pixels: 16 shades per color, each 2–4% off. */
export function makeYarnShades(palette: readonly Palette[]): Uint32Array {
  const shades = new Uint32Array(palette.length * JITTER_LEVELS);
  palette.forEach((p, i) => {
    for (let j = 0; j < JITTER_LEVELS; j++) {
      const amount = 0.02 + 0.02 * ((j >> 1) / (JITTER_LEVELS / 2 - 1));
      const factor = j & 1 ? 1 + amount : 1 - amount;
      const [l, a, b] = p.oklab;
      const [r, g, bl] = hexToRgb(oklabToHex([Math.min(1, l * factor), a, b]));
      shades[i * JITTER_LEVELS + j] = (255 << 24) | (bl << 16) | (g << 8) | r;
    }
  });
  return shades;
}

/** Cheap integer hash, so a knot keeps its shade from frame to frame. */
function knotShade(knot: number): number {
  let h = Math.imul(knot + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return (h >>> 13) & (JITTER_LEVELS - 1);
}

/** The whole rug at one pixel per knot, for views where knots are tiny. */
export function makeYarnBitmap(
  indices: Uint16Array,
  shades: Uint32Array,
  columns: number,
  rows: number,
): ImageData {
  const image = new ImageData(columns, rows);
  const px = new Uint32Array(image.data.buffer);
  for (let i = 0; i < px.length; i++) px[i] = shades[indices[i]! * JITTER_LEVELS + knotShade(i)]!;
  return image;
}

/** A block of knots, in knots. */
export interface KnotArea {
  column: number;
  row: number;
  columns: number;
  rows: number;
}

/** How far, in knots, a yarn's color reaches into its neighbours. */
const YARN_SPREAD = 0.5;

/**
 * Part of the rug at `sub × sub` pixels per knot, with rounded, flowing color
 * edges in place of square cells. Every pixel goes to the yarn with the most
 * weight among the 3 × 3 knots around it; a single knot stays visible as a dot.
 */
export function renderYarnArea(
  indices: Uint16Array,
  shades: Uint32Array,
  columns: number,
  rows: number,
  area: KnotArea,
  sub: number,
): ImageData {
  // Weight of each neighbour for each position inside a knot, per axis.
  const axis = new Float32Array(sub * 3);
  for (let s = 0; s < sub; s++) {
    const at = (s + 0.5) / sub - 0.5;
    for (let n = 0; n < 3; n++) {
      axis[s * 3 + n] = Math.exp(-((at - (n - 1)) ** 2) / (2 * YARN_SPREAD ** 2));
    }
  }

  const image = new ImageData(area.columns * sub, area.rows * sub);
  const px = new Uint32Array(image.data.buffer);
  const width = image.width;
  /** Colors of the nine knots, and for each the first of the nine alike. */
  const near = new Uint16Array(9);
  const slot = new Uint8Array(9);
  const weight = new Float32Array(9);

  for (let r = 0; r < area.rows; r++) {
    const row = area.row + r;
    for (let c = 0; c < area.columns; c++) {
      const column = area.column + c;
      const knot = row * columns + column;
      const own = indices[knot]!;
      const shade = knotShade(knot);
      const corner = r * sub * width + c * sub;

      let mixed = false;
      for (let n = 0; n < 9; n++) {
        const nr = Math.min(rows - 1, Math.max(0, row + ((n / 3) | 0) - 1));
        const nc = Math.min(columns - 1, Math.max(0, column + (n % 3) - 1));
        const color = indices[nr * columns + nc]!;
        near[n] = color;
        if (color !== own) mixed = true;
        let first = 0;
        while (near[first] !== color) first++;
        slot[n] = first;
      }
      if (!mixed) {
        const pixel = shades[own * JITTER_LEVELS + shade]!;
        for (let y = 0; y < sub; y++) {
          px.fill(pixel, corner + y * width, corner + y * width + sub);
        }
        continue;
      }
      for (let y = 0; y < sub; y++) {
        for (let x = 0; x < sub; x++) {
          weight.fill(0);
          let best = own;
          let bestWeight = -1;
          for (let n = 0; n < 9; n++) {
            const s = slot[n]!;
            const total = weight[s]! + axis[x * 3 + (n % 3)]! * axis[y * 3 + ((n / 3) | 0)]!;
            weight[s] = total;
            if (total > bestWeight) {
              bestWeight = total;
              best = near[s]!;
            }
          }
          px[corner + y * width + x] = shades[best * JITTER_LEVELS + shade]!;
        }
      }
    }
  }
  return image;
}

/** Pile texture: the tile is this many pixels square, with `ROW` px per row. */
const TILE = 1024; // a power of two
const ROW = 16;
const MIN_LEVEL_ROW = 4;
/** How far one standard deviation of texture moves a color, in 0–255 levels. */
const RELIEF = 14.5;
/** Extra on dark yarn, which shows its sheen, and a little of its shadow, more. */
const DARK_SHEEN = 10;
const DARK_SHADOW = 4;

/** The texture at one resolution: mean 0, standard deviation 1. */
export interface PileLevel {
  /** Pixels per texture row. */
  row: number;
  size: number;
  field: Float32Array;
}

/**
 * Seamless woven pile: irregular horizontal dashes in wavy rows. Each level is
 * half the size of the one before and is brought back to the same contrast, so
 * the rug looks alike however far it is zoomed. Largest level first.
 */
export function makePileLevels(): PileLevel[] {
  const levels: PileLevel[] = [{ row: ROW, size: TILE, field: makePileField() }];
  for (let last = levels[0]!; last.row > MIN_LEVEL_ROW; ) {
    last = { row: last.row / 2, size: last.size / 2, field: normalise(halve(last.field, last.size)) };
    levels.push(last);
  }
  return levels;
}

function makePileField(): Float32Array {
  const random = createRandom(17);
  const noise = (spreadX: number, spreadY: number) => {
    const f = Float32Array.from({ length: TILE * TILE }, () => random() - 0.5);
    blurWrapped(f, TILE, spreadX, spreadY);
    return normalise(f);
  };
  const bumps = noise(2, 2);
  const dashes = noise(8, 2);
  const streaks = noise(40, 2);
  const wander = noise(30, 10);
  const strength = noise(24, 12);
  const out = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const row = Math.cos(2 * Math.PI * (y / ROW + 0.16 * wander[i]!));
      out[i] =
        0.8 * bumps[i]! +
        0.45 * dashes[i]! +
        0.42 * streaks[i]! +
        row * (0.6 + 0.25 * strength[i]!);
    }
  }
  return normalise(out);
}

/** Shifts and scales in place to mean 0, standard deviation 1. */
function normalise(f: Float32Array): Float32Array {
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < f.length; i++) {
    sum += f[i]!;
    squares += f[i]! * f[i]!;
  }
  const mean = sum / f.length;
  const deviation = Math.sqrt(squares / f.length - mean * mean) || 1;
  for (let i = 0; i < f.length; i++) f[i] = (f[i]! - mean) / deviation;
  return f;
}

/** Three box passes per axis, wrapping at the edges: close to a Gaussian. */
function blurWrapped(f: Float32Array, size: number, radiusX: number, radiusY: number): void {
  const line = new Float32Array(size);
  const pass = (start: number, step: number, radius: number) => {
    for (let i = 0; i < size; i++) line[i] = f[start + i * step]!;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += line[(i + size) % size]!;
    let enter = radius + 1;
    let leave = size - radius;
    const scale = 1 / (2 * radius + 1);
    for (let i = 0; i < size; i++) {
      f[start + i * step] = sum * scale;
      sum += line[enter]! - line[leave]!;
      if (++enter === size) enter = 0;
      if (++leave === size) leave = 0;
    }
  };
  for (let k = 0; k < 3; k++) {
    for (let n = 0; n < size; n++) {
      pass(n * size, 1, radiusX);
      pass(n, size, radiusY);
    }
  }
}

function halve(f: Float32Array, size: number): Float32Array {
  const half = size / 2;
  const out = new Float32Array(half * half);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const i = y * 2 * size + x * 2;
      out[y * half + x] = (f[i]! + f[i + 1]! + f[i + size]! + f[i + size + 1]!) / 4;
    }
  }
  return out;
}

/** One scale of texture to lay over the rug. */
export interface PileLayer {
  /** Height of one texture row in pixels of the image. */
  row: number;
  strength: number;
}

/**
 * Lightens and darkens flat yarn colors with pile texture, in place. All three
 * channels move by the same amount, which keeps the yarn's hue.
 * `originX/Y` is where the rug's corner lies in the image, in pixels.
 */
export function applyPile(
  image: ImageData,
  levels: readonly PileLevel[],
  layers: readonly PileLayer[],
  originX: number,
  originY: number,
): void {
  const { width, height, data } = image;
  const line = new Float32Array(width);
  const samplers = layers
    .filter((l) => l.strength > 0.01)
    .map((layer) => {
      // The smallest level that does not have to be enlarged.
      const level = levels.findLast((l) => l.row >= layer.row) ?? levels[0]!;
      const step = level.row / layer.row;
      const mask = level.size - 1;
      const index = new Int32Array(width);
      const fraction = new Float32Array(width);
      for (let x = 0; x < width; x++) {
        const at = (x + 0.5 - originX) * step - 0.5;
        const whole = Math.floor(at);
        index[x] = whole & mask;
        fraction[x] = at - whole;
      }
      return { ...level, strength: layer.strength, step, mask, index, fraction };
    });

  for (let y = 0; y < height; y++) {
    line.fill(0);
    for (const s of samplers) {
      const at = (y + 0.5 - originY) * s.step - 0.5;
      const whole = Math.floor(at);
      const fy = at - whole;
      const upper = (whole & s.mask) * s.size;
      const lower = ((whole + 1) & s.mask) * s.size;
      for (let x = 0; x < width; x++) {
        const i = s.index[x]!;
        const j = (i + 1) & s.mask;
        const fx = s.fraction[x]!;
        const top = s.field[upper + i]! * (1 - fx) + s.field[upper + j]! * fx;
        const bottom = s.field[lower + i]! * (1 - fx) + s.field[lower + j]! * fx;
        line[x]! += (top * (1 - fy) + bottom * fy) * s.strength;
      }
    }
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      const r = data[o]!;
      const g = data[o + 1]!;
      const b = data[o + 2]!;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const dark = Math.min(1, Math.max(0, (110 - luma) / 65));
      const v = line[x]!;
      const k = v * (RELIEF + dark * (v > 0 ? DARK_SHEEN : DARK_SHADOW));
      data[o] = r + k;
      data[o + 1] = g + k;
      data[o + 2] = b + k;
    }
  }
}

const STRANDS_PER_INCH = 3;

export interface Fringe {
  length: number;
  /** Strands in inches, split by tone. */
  tones: { color: string; path: Path2D }[];
}

/** Warp ends left hanging at the top and bottom of the rug. */
export function makeFringe(grid: GridSpec): Fringe {
  const length = Math.min(3.5, Math.max(0.5, grid.heightIn * 0.028));
  const random = createRandom(5);
  const tones = ['#cfc4ad', '#e4dbc8', '#f1eadb'].map((color) => ({ color, path: new Path2D() }));
  const count = Math.max(4, Math.round(grid.widthIn * STRANDS_PER_INCH));
  for (const [edge, dir] of [
    [0, -1],
    [grid.heightIn, 1],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const x = ((i + 0.5) / count) * grid.widthIn;
      const reach = length * (0.82 + random() * 0.18) * dir;
      const sway = (random() - 0.5) * length * 0.3;
      const { path } = tones[i % tones.length]!;
      path.moveTo(x, edge - dir * 0.05);
      path.bezierCurveTo(
        x + sway * 0.2,
        edge + reach * 0.35,
        x + sway * 1.2,
        edge + reach * 0.65,
        x + sway,
        edge + reach,
      );
    }
  }
  return { length, tones };
}
