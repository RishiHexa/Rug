/**
 * Yes/no masks over a picture, and the few operations the rug analysis needs:
 * growing and shrinking, connected parts, flood fill and mirroring. Pure.
 */

export interface Mask {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const emptyMask = (width: number, height: number): Mask => ({
  data: new Uint8Array(width * height),
  width,
  height,
});

export const maskFrom = (width: number, height: number, test: (i: number) => boolean): Mask => {
  const m = emptyMask(width, height);
  for (let i = 0; i < m.data.length; i++) m.data[i] = test(i) ? 1 : 0;
  return m;
};

export const countOf = (m: Mask): number => m.data.reduce((n, v) => n + v, 0);

export function and(a: Mask, b: Mask): Mask {
  return maskFrom(a.width, a.height, (i) => a.data[i]! === 1 && b.data[i]! === 1);
}
export function or(a: Mask, b: Mask): Mask {
  return maskFrom(a.width, a.height, (i) => a.data[i]! === 1 || b.data[i]! === 1);
}
export function not(a: Mask): Mask {
  return maskFrom(a.width, a.height, (i) => a.data[i]! === 0);
}
export function minus(a: Mask, b: Mask): Mask {
  return maskFrom(a.width, a.height, (i) => a.data[i]! === 1 && b.data[i]! === 0);
}

/**
 * Grows (`grow` true) or shrinks a mask by `r` pixels with a square brush, in
 * two passes. Outside the picture counts as `outside`.
 */
function morph(m: Mask, r: number, grow: boolean, outside: 0 | 1): Mask {
  if (r <= 0) return { ...m, data: m.data.slice() };
  const { width, height } = m;
  const hit = grow ? 1 : 0;
  const pass = (src: Uint8Array, along: 'x' | 'y'): Uint8Array => {
    const out = new Uint8Array(src.length);
    const lines = along === 'x' ? height : width;
    const len = along === 'x' ? width : height;
    const at = along === 'x' ? (line: number, k: number) => line * width + k : (line: number, k: number) => k * width + line;
    for (let line = 0; line < lines; line++) {
      // Running count of `hit` values in the window.
      let count = 0;
      const value = (k: number) => (k < 0 || k >= len ? outside : src[at(line, k)]!);
      for (let k = -r; k <= r; k++) if (value(k) === hit) count++;
      for (let k = 0; k < len; k++) {
        out[at(line, k)] = grow ? (count > 0 ? 1 : 0) : count > 0 ? 0 : 1;
        if (value(k - r) === hit) count--;
        if (value(k + r + 1) === hit) count++;
      }
    }
    return out;
  };
  return { width, height, data: pass(pass(m.data, 'x'), 'y') };
}

export const dilate = (m: Mask, r: number) => morph(m, r, true, 0);
export const erode = (m: Mask, r: number, outside: 0 | 1 = 1) => morph(m, r, false, outside);
/** Removes parts thinner than about 2r. */
export const open = (m: Mask, r: number) => dilate(erode(m, r), r);
/** Fills gaps narrower than about 2r. */
export const close = (m: Mask, r: number) => erode(dilate(m, r), r, 1);

/** Keeps a pixel when most of its (2r+1)² neighbourhood is set. Removes speckle. */
export function majority(m: Mask, r: number): Mask {
  const { width, height } = m;
  const sums = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += m.data[y * width + x]!;
      sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1]! + row;
    }
  }
  return maskFrom(width, height, (i) => {
    const x = i % width;
    const y = (i - x) / width;
    const x0 = Math.max(0, x - r);
    const y0 = Math.max(0, y - r);
    const x1 = Math.min(width, x + r + 1);
    const y1 = Math.min(height, y + r + 1);
    const w = width + 1;
    const total = sums[y1 * w + x1]! - sums[y0 * w + x1]! - sums[y1 * w + x0]! + sums[y0 * w + x0]!;
    return total * 2 > (x1 - x0) * (y1 - y0);
  });
}

/** Every pixel reachable from `seeds` through set pixels of `passable`, 4-connected. */
export function flood(passable: Mask, seeds: Iterable<number>): Mask {
  const { width, height } = passable;
  const out = emptyMask(width, height);
  const stack: number[] = [];
  for (const s of seeds) {
    if (passable.data[s] === 1 && out.data[s] === 0) {
      out.data[s] = 1;
      stack.push(s);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const visit = (j: number) => {
      if (passable.data[j] === 1 && out.data[j] === 0) {
        out.data[j] = 1;
        stack.push(j);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < width * (height - 1)) visit(i + width);
  }
  return out;
}

/** Indices of the pixels along the picture's edge. */
export function edgePixels(width: number, height: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < width; x++) out.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) out.push(y * width, y * width + width - 1);
  return out;
}

/** Sets every unset pixel that cannot reach the picture's edge. */
export function fillHoles(m: Mask): Mask {
  const outside = flood(not(m), edgePixels(m.width, m.height));
  return not(outside);
}

export interface Part {
  /** Label in `labels`, from 1. */
  id: number;
  area: number;
  box: Rect;
}

/** Connected parts (8-connected) and a label per pixel; 0 is unset. */
export function parts(m: Mask): { labels: Int32Array; parts: Part[] } {
  const { width, height } = m;
  const labels = new Int32Array(width * height);
  const found: Part[] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (m.data[start] === 0 || labels[start] !== 0) continue;
    const id = found.length + 1;
    let area = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (m.data[j] === 1 && labels[j] === 0) {
            labels[j] = id;
            stack.push(j);
          }
        }
      }
    }
    found.push({ id, area, box: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } });
  }
  return { labels, parts: found };
}

export function partMask(labels: Int32Array, width: number, height: number, ids: number[]): Mask {
  const keep = new Set(ids);
  return maskFrom(width, height, (i) => keep.has(labels[i]!));
}

/** Drops parts smaller than `minArea` pixels. */
export function removeSpecks(m: Mask, minArea: number): Mask {
  const { labels, parts: all } = parts(m);
  return partMask(
    labels,
    m.width,
    m.height,
    all.filter((p) => p.area >= minArea).map((p) => p.id),
  );
}

export function boundsOf(m: Mask): Rect | null {
  let x0 = m.width;
  let y0 = m.height;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < m.data.length; i++) {
    if (m.data[i] === 0) continue;
    const x = i % m.width;
    const y = (i - x) / m.width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

export function mirror(m: Mask, flipX: boolean, flipY: boolean): Mask {
  const { width, height } = m;
  return maskFrom(width, height, (i) => {
    const x = i % width;
    const y = (i - x) / width;
    return m.data[(flipY ? height - 1 - y : y) * width + (flipX ? width - 1 - x : x)] === 1;
  });
}

/**
 * For a design mirrored left/right and top/bottom: a pixel is set when at
 * least `need` of its four mirror images are. Cleans up hand-knotted noise.
 */
export function quarterVote(m: Mask, need = 2): Mask {
  const { width, height } = m;
  return maskFrom(width, height, (i) => {
    const x = i % width;
    const y = (i - x) / width;
    const mx = width - 1 - x;
    const my = height - 1 - y;
    const votes = m.data[i]! + m.data[y * width + mx]! + m.data[my * width + x]! + m.data[my * width + mx]!;
    return votes >= need;
  });
}

export function crop(m: Mask, r: Rect): Mask {
  const out = emptyMask(r.width, r.height);
  for (let y = 0; y < r.height; y++) {
    const sy = y + r.y;
    if (sy < 0 || sy >= m.height) continue;
    for (let x = 0; x < r.width; x++) {
      const sx = x + r.x;
      if (sx >= 0 && sx < m.width) out.data[y * r.width + x] = m.data[sy * m.width + sx]!;
    }
  }
  return out;
}

/** Resamples a mask to a new size, by the pixel each new pixel's centre falls in. */
export function resize(m: Mask, width: number, height: number): Mask {
  const sx = m.width / width;
  const sy = m.height / height;
  return maskFrom(width, height, (i) => {
    const x = i % width;
    const y = (i - x) / width;
    const fx = Math.min(m.width - 1, Math.floor((x + 0.5) * sx));
    const fy = Math.min(m.height - 1, Math.floor((y + 0.5) * sy));
    return m.data[fy * m.width + fx] === 1;
  });
}
