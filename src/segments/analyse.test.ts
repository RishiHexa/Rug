import { describe, expect, it } from 'vitest';
import { analyseRug, evenLight, findBandEdges, lightSlope, SIDES } from './analyse';
import { shapeMask } from './cutout';
import { boundsOf, close, countOf, dilate, erode, fillHoles, maskFrom, open, parts, quarterVote } from './mask';
import type { Pixels } from './pixels';
import { hexToOklab } from '../domain/color';

type RGB = [number, number, number];

function picture(width: number, height: number, color: (x: number, y: number) => RGB): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = color(x, y);
      const p = (y * width + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

const toLinear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const toByte = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));

/** The picture under uneven light: `light` of 1 leaves a pixel as it is. */
function shade(px: Pixels, light: (x: number, y: number) => number): Pixels {
  const data = new Uint8ClampedArray(px.data.length);
  for (let y = 0; y < px.height; y++) {
    for (let x = 0; x < px.width; x++) {
      const p = (y * px.width + x) * 4;
      const k = light(x, y);
      for (let j = 0; j < 3; j++) data[p + j] = toByte(toLinear(px.data[p + j]!) * k);
      data[p + 3] = px.data[p + 3]!;
    }
  }
  return { data, width: px.width, height: px.height };
}

describe('masks', () => {
  const square = maskFrom(20, 20, (i) => {
    const x = i % 20;
    const y = Math.floor(i / 20);
    return x >= 5 && x < 15 && y >= 5 && y < 15;
  });

  it('grows and shrinks by whole pixels', () => {
    expect(countOf(dilate(square, 1))).toBe(144);
    expect(countOf(erode(square, 1))).toBe(64);
    expect(countOf(open(square, 2))).toBe(100);
  });

  it('closes gaps and fills holes', () => {
    const ring = maskFrom(20, 20, (i) => square.data[i] === 1 && !(i % 20 >= 8 && i % 20 < 12 && i >= 160 && i < 240));
    expect(countOf(fillHoles(ring))).toBe(100);
    const split = maskFrom(20, 20, (i) => square.data[i] === 1 && i % 20 !== 10);
    expect(parts(split).parts).toHaveLength(2);
    expect(parts(close(split, 1)).parts).toHaveLength(1);
  });

  it('votes over four mirror images', () => {
    const corner = maskFrom(10, 10, (i) => i === 0 || i === 9 || i === 90);
    expect(quarterVote(corner, 2).data[99]).toBe(1);
    expect(quarterVote(corner, 4).data[0]).toBe(0);
  });
});

describe('cutting a shape off its background', () => {
  const RED: RGB = [150, 55, 45];
  const NAVY: RGB = [25, 28, 45];
  // A navy ring with red inside, on red, with part of a neighbour at the edge.
  const px = picture(60, 60, (x, y) => {
    const d = Math.hypot(x - 30, y - 30);
    if (d >= 12 && d <= 18) return NAVY;
    if (x < 4 && y > 20 && y < 40) return NAVY;
    return RED;
  });

  it('keeps the inside of a shape even where it matches the ground', () => {
    const mask = shapeMask(px, { background: [hexToOklab('#96372d')], tolerance: 0.05, reach: 'edge', keep: 'center', smooth: 0 });
    expect(mask.data[30 * 60 + 30]).toBe(1);
    expect(mask.data[5 * 60 + 5]).toBe(0);
    // The neighbour cut by the edge is dropped.
    expect(mask.data[30 * 60 + 1]).toBe(0);
    const b = boundsOf(mask)!;
    expect(b.x).toBeGreaterThanOrEqual(11);
    expect(b.width).toBeLessThanOrEqual(39);
  });

  it('removes the ground everywhere for a layer on the same ground', () => {
    const mask = shapeMask(px, { background: [hexToOklab('#96372d')], tolerance: 0.05, reach: 'anywhere', keep: 'all', smooth: 0 });
    expect(mask.data[30 * 60 + 30]).toBe(0);
    expect(mask.data[30 * 60 + 15]).toBe(1);
  });
});

describe('reading a rug picture', () => {
  // A small Heriz-like rug: plain edge band, a dotted guard, a main border
  // of different motifs mirrored about its middle, a field with gold corner
  // spandrels holding pockets, a navy medallion and two pendants.
  const W = 360;
  const H = 480;
  const RED: RGB = [150, 55, 45];
  const DEEP: RGB = [135, 50, 40];
  const BLUE: RGB = [95, 125, 150];
  const IVORY: RGB = [225, 210, 180];
  const NAVY: RGB = [25, 28, 45];
  const GOLD: RGB = [195, 150, 80];
  const SALMON: RGB = [195, 120, 95];
  const noise = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) % 9 - 4;
  const jitter = ([r, g, b]: RGB, x: number, y: number): RGB => [r + noise(x, y), g + noise(y, x), b + noise(x + y, x)];

  const px = picture(W, H, (x, y) => {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (d < 8) return jitter((x + y) % 23 < 11 ? RED : DEEP, x, y);
    if (d < 20) {
      // Guard: ivory dots every 12 px along the band.
      const t = x === d || x === W - 1 - d ? y : x;
      return jitter((t % 12) - 6 > -3 && (t % 12) - 6 < 3 && d > 11 && d < 17 ? IVORY : BLUE, x, y);
    }
    if (d < 56) {
      // Main border: navy and ivory motifs, mirrored about the middle.
      const along = y === d || y === H - 1 - d || y - d < 36 || H - 1 - d - y < 36 ? x : y;
      const length = along === x ? W : H;
      const u = Math.abs(along - length / 2);
      const slot = Math.floor((u + 18) / 36);
      const inSlot = Math.abs(((u + 18) % 36) - 18);
      const depth = Math.abs(d - 38);
      const shape = slot % 2 === 0 ? inSlot + depth < 11 : (inSlot < 3 && depth < 10) || (depth < 3 && inSlot < 10);
      return jitter(shape ? (slot % 2 === 0 ? NAVY : IVORY) : RED, x, y);
    }
    if (d < 62) return jitter(BLUE, x, y);
    // Field.
    const fx = x - 62;
    const fy = y - 62;
    const fw = W - 124;
    const fh = H - 124;
    const qx = Math.min(fx, fw - 1 - fx);
    const qy = Math.min(fy, fh - 1 - fy);
    if (qx < 30 && qy < 30) {
      if ((qx === 3 || qx === 26 || qy === 3 || qy === 26) && qx >= 3 && qy >= 3) return jitter(NAVY, x, y);
      return jitter(RED, x, y);
    }
    if (qx + qy < 75) return jitter(GOLD, x, y);
    const cx = Math.abs(fx - fw / 2);
    const cy = Math.abs(fy - fh / 2);
    const r = cx / 70 + cy / 95;
    if (r < 1) return jitter(r > 0.82 ? NAVY : r < 0.3 ? IVORY : SALMON, x, y);
    // Pendants: navy diamonds on the vertical axis.
    const py = Math.min(Math.abs(fy - (fh / 2 - 125)), Math.abs(fy - (fh / 2 + 125)));
    if (cx / 22 + py / 22 < 1) return jitter(NAVY, x, y);
    // Scattered small motifs on the ground.
    if ((fx % 40 < 5 && fy % 47 < 5 && qx + qy > 85)) return jitter(IVORY, x, y);
    return jitter((x * 7 + y * 3) % 31 < 15 ? RED : DEEP, x, y);
  });

  const result = analyseRug(px);

  it('finds the bands and tells them apart', () => {
    expect(result.bands.map((b) => b.kind)).toEqual(['plain', 'guard', 'main', 'plain']);
    const main = result.bands[2]!;
    expect(main.endRun?.symmetric).toBe(true);
    expect(main.sideRun?.symmetric).toBe(true);
    expect(Math.round(result.bands[0]!.inner.top)).toBeGreaterThanOrEqual(6);
    expect(Math.round(result.bands[0]!.inner.top)).toBeLessThanOrEqual(10);
  });

  it('finds the field, its ground and that it is quartered', () => {
    const f = result.field;
    expect(f.box.x).toBeGreaterThanOrEqual(58);
    expect(f.box.x).toBeLessThanOrEqual(66);
    expect(f.quartered).toBe(true);
    expect(Math.hypot(f.ground[1] - hexToOklab('#96372d')[1], f.ground[2] - hexToOklab('#96372d')[2])).toBeLessThan(0.05);
  });

  it('finds spandrels with pockets, the medallion and both pendants', () => {
    const f = result.field;
    expect(f.spandrel).not.toBeNull();
    expect(f.pocket).not.toBeNull();
    expect(f.medallion).not.toBeNull();
    const m = f.medallion!.box;
    expect(m.x + m.width / 2).toBeCloseTo(W / 2, -1);
    expect(m.y + m.height / 2).toBeCloseTo(H / 2, -1);
    expect(f.pendants?.top).toBeTruthy();
    expect(f.pendants?.bottom).toBeTruthy();
    expect(f.pendants!.top.box.y + f.pendants!.top.box.height).toBeLessThanOrEqual(m.y + 2);
  });

  it('leaves an evenly lit picture as it is', () => {
    expect(evenLight(px).pixels).toBe(px);
  });

  describe('in a photo lit from below', () => {
    // Half as much light at the top as at the bottom.
    const shaded = shade(px, (_, y) => 0.5 + 0.5 * (y / H));
    const dim = analyseRug(shaded);

    it('sees the light fall off and evens it out', () => {
      const slope = lightSlope(shaded);
      expect(Math.exp(slope.y)).toBeGreaterThan(1.6);
      expect(Math.abs(slope.x)).toBeLessThan(0.05);
      expect(dim.field.notes[0]).toMatch(/lighter at the bottom/);
    });

    it('still finds one ground, the spandrels and the pendants', () => {
      const f = dim.field;
      expect(f.quartered).toBe(true);
      expect(f.spandrel).not.toBeNull();
      expect(f.pocket).not.toBeNull();
      expect(f.medallion).not.toBeNull();
      expect(f.pendants?.bottom).toBeTruthy();
    });
  });
});

describe('band edges', () => {
  // Red, then blue, then a gold field, divided by dark lines 3 px wide whose
  // middles are at 31 and 61. The color change is stronger on one side of
  // each line than the other.
  const RED: RGB = [150, 55, 45];
  const BLUE: RGB = [95, 125, 150];
  const GOLD: RGB = [195, 150, 80];
  const LINE: RGB = [45, 35, 40];
  const px = picture(300, 300, (x, y) => {
    const d = Math.min(x, y, 299 - x, 299 - y);
    if (d < 30) return RED;
    if (d < 33) return LINE;
    if (d < 60) return BLUE;
    if (d < 63) return LINE;
    return GOLD;
  });

  it('sit in the middle of the dark lines dividing the bands', () => {
    const edges = findBandEdges(px);
    expect(edges).toHaveLength(2);
    for (const side of SIDES) {
      expect(Math.abs(edges[0]![side] - 31)).toBeLessThanOrEqual(1);
      expect(Math.abs(edges[1]![side] - 61)).toBeLessThanOrEqual(1);
    }
  });
});
