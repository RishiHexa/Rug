import { describe, expect, it } from 'vitest';
import { fitRun, layoutRug, type DrawOp } from './layout';
import { makeRule, minimumSize, newSegment, type Art, type Segment, type SegmentDoc } from './model';
import { findBandEdges, findPeriod, isPlain } from './analyse';
import type { Pixels } from './pixels';

const art = { canvas: {} as HTMLCanvasElement, crisp: false } satisfies Art;
const ends = (r: { pieces: { start: number; length: number }[] }) =>
  r.pieces.map((p) => [p.start, p.start + p.length]);

describe('fitRun: repeat', () => {
  it('keeps pieces at 100% when they fit exactly', () => {
    const run = fitRun(40, makeRule(10), 'crop');
    expect(ends(run)).toEqual([[0, 10], [10, 20], [20, 30], [30, 40]]);
    expect(run).toMatchObject({ stretch: 1, gap: 0, state: 'fits' });
  });
  it('lets the gaps grow before adding another piece', () => {
    const rule = makeRule(10, { gap: 1, maxGap: 3, minStretch: 0.9, maxStretch: 1.1 });
    expect(fitRun(44, rule, 'crop').pieces).toHaveLength(4);
    const wide = fitRun(51, rule, 'crop');
    expect(wide.pieces).toHaveLength(4);
    expect(wide.gap).toBeCloseTo(2.75);
    expect(wide.stretch).toBeCloseTo(1);
  });
  it('adds another piece once the allowed gap is used up', () => {
    const rule = makeRule(10, { gap: 1, maxGap: 2, minStretch: 0.9, maxStretch: 1.1 });
    const run = fitRun(54, rule, 'crop');
    expect(run.pieces).toHaveLength(5);
    expect(run.stretch).toBeGreaterThanOrEqual(0.9);
    expect(run.state).toBe('fits');
  });
  it('chooses whichever count changes the pieces least', () => {
    const rule = makeRule(10, { minStretch: 0.7, maxStretch: 1.5 });
    expect(fitRun(43, rule, 'crop').pieces).toHaveLength(4);
    expect(fitRun(47, rule, 'crop').pieces).toHaveLength(5);
  });
  it('crops around the center when no count fits', () => {
    const run = fitRun(25, makeRule(10, { minStretch: 0.95, maxStretch: 1.05 }), 'crop');
    expect(run.state).toBe('cropped');
    expect(run.pieces).toHaveLength(3);
    expect(run.pieces[0]!.start).toBeCloseTo(-2.5);
  });
  it('or stretches past the limits when told to', () => {
    const run = fitRun(25, makeRule(10, { minStretch: 0.95, maxStretch: 1.05 }), 'stretch');
    expect(run.state).toBe('forced');
    expect(run.stretch * run.pieces.length * 10).toBeCloseTo(25);
  });
  it('adds mirrored pieces in pairs', () => {
    for (const length of [35, 50, 61, 88]) {
      const run = fitRun(length, makeRule(10, { flip: true, minStretch: 0.5, maxStretch: 2 }), 'crop');
      expect(run.pieces.length % 2).toBe(0);
      expect(run.pieces.map((p) => p.flip)).toEqual(run.pieces.map((_, i) => i % 2 === 1));
    }
  });
  it('crops mirrored pairs with a whole pattern in the middle', () => {
    const rule = makeRule(10, { flip: true, minStretch: 0.95, maxStretch: 1.05 });
    for (const length of [28, 33, 52, 70]) {
      const run = fitRun(length, rule, 'crop');
      expect(run.state).toBe('cropped');
      const joins = run.pieces.filter((p) => !p.flip).map((p) => p.start + p.length);
      expect(joins.some((x) => Math.abs(x - length / 2) < 1e-6)).toBe(true);
    }
  });
  it('is left out below the minimum and stops growing at the maximum', () => {
    const rule = makeRule(10, { minLength: 30, maxLength: 60 });
    expect(fitRun(29, rule, 'crop').state).toBe('hidden');
    const run = fitRun(100, rule, 'crop');
    expect([run.start, run.length]).toEqual([20, 60]);
    expect(run.pieces).toHaveLength(6);
  });
  it('always tiles the room without overlap and within its limits', () => {
    const rule = makeRule(7, { gap: 0.5, maxGap: 2, minStretch: 0.8, maxStretch: 1.25 });
    for (let length = 6; length < 200; length += 0.37) {
      const run = fitRun(length, rule, 'crop');
      for (let i = 1; i < run.pieces.length; i++) {
        const before = run.pieces[i - 1]!;
        expect(run.pieces[i]!.start).toBeGreaterThanOrEqual(before.start + before.length - 1e-9);
      }
      if (run.state !== 'fits') continue;
      expect(run.stretch).toBeGreaterThan(0.8 - 1e-5);
      expect(run.stretch).toBeLessThan(1.25 + 1e-5);
      expect(run.gap).toBeGreaterThan(0.5 - 1e-5);
      expect(run.gap).toBeLessThan(2 + 1e-5);
      expect(run.pieces.length * (run.stretch * 7 + run.gap)).toBeCloseTo(length);
    }
  });
});

describe('fitRun: single', () => {
  const rule = makeRule(10, { fit: 'single', minStretch: 0.8, maxStretch: 1.2 });
  it('stretches within its limits', () => {
    expect(ends(fitRun(11, rule, 'crop'))).toEqual([[0, 11]]);
  });
  it('leaves room around it, or is cropped, past them', () => {
    expect(fitRun(20, rule, 'crop')).toMatchObject({ state: 'room', stretch: 1.2 });
    expect(fitRun(5, rule, 'crop')).toMatchObject({ state: 'cropped', stretch: 0.8 });
    expect(fitRun(20, rule, 'stretch')).toMatchObject({ state: 'forced', stretch: 2 });
  });
});

const emptyDoc: SegmentDoc = { background: '#800000', baseWidth: 108, baseHeight: 144, segments: [] };
const withSegments = (...segments: Segment[]): SegmentDoc => ({ ...emptyDoc, segments });

/** Corners of an op's box, in rug coordinates. */
function rugBox({ matrix: [a, b, c, d, e, f], box }: DrawOp) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const u of [box.x, box.x + box.width]) {
    for (const v of [box.y, box.y + box.height]) {
      xs.push(a * u + c * v + e);
      ys.push(b * u + d * v + f);
    }
  }
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

describe('layoutRug', () => {
  const border: Segment = {
    ...newSegment('border', emptyDoc),
    art,
    cornerArt: art,
    placement: { type: 'border', inset: 2, thickness: 6, sides: 'all', corner: 'piece' },
    x: makeRule(6),
  };
  const fill: Segment = { ...newSegment('fill', emptyDoc), art };

  it('keeps every border piece inside the band at any size', () => {
    for (const [w, h] of [[108, 144], [60, 60], [131, 47], [200.3, 99.7]] as const) {
      const { ops } = layoutRug(withSegments(border), w, h, { x: 0, y: 0 });
      for (const op of ops.filter((o) => o.art !== null)) {
        const b = rugBox(op);
        expect(b.left).toBeGreaterThanOrEqual(2 - 1e-6);
        expect(b.top).toBeGreaterThanOrEqual(2 - 1e-6);
        expect(b.right).toBeLessThanOrEqual(w - 2 + 1e-6);
        expect(b.bottom).toBeLessThanOrEqual(h - 2 + 1e-6);
        const touches = b.left < 8.001 || b.top < 8.001 || b.right > w - 8.001 || b.bottom > h - 8.001;
        expect(touches).toBe(true);
      }
      expect(ops.filter((o) => o.art === 'corner')).toHaveLength(4);
    }
  });
  it('repeats more pieces on a bigger rug', () => {
    const count = (w: number, h: number) =>
      layoutRug(withSegments(border), w, h, { x: 0, y: 0 }).ops.filter((o) => o.art === 'main').length;
    expect(count(216, 144)).toBeGreaterThan(count(108, 144));
  });
  it('mirrors the corner piece into each corner', () => {
    const { ops } = layoutRug(withSegments(border), 108, 144, { x: 0, y: 0 });
    const flips = ops.filter((o) => o.art === 'corner').map((o) => `${o.flipX}${o.flipY}`);
    expect(new Set(flips).size).toBe(4);
  });
  it('fills only the room inside the borders', () => {
    const { ops } = layoutRug(withSegments(border, fill), 108, 144, { x: 0, y: 0 });
    const clip = ops.find((o) => o.segment === 1 && o.art === 'main')!.clip!;
    expect(clip[0]).toEqual([8, 8]);
    expect(clip[2]).toEqual([100, 136]);
  });
  it('lines pieces up with whole knots', () => {
    const snap = { x: 0.1, y: 0.125 };
    const { ops } = layoutRug(withSegments(border, fill), 101.3, 99.5, snap);
    const whole = (v: number, step: number) =>
      expect(Math.abs(v / step - Math.round(v / step))).toBeLessThan(1e-6);
    for (const op of ops.filter((o) => o.art !== null)) {
      const b = rugBox(op);
      whole(b.left, snap.x);
      whole(b.top, snap.y);
    }
  });
  it('mitred corners stay within the side', () => {
    const mitred: Segment = { ...border, placement: { type: 'border', inset: 0, thickness: 6, sides: 'all', corner: 'mitre' } };
    const { ops } = layoutRug(withSegments(mitred), 108, 144, { x: 0, y: 0 });
    const clip = ops.find((o) => o.art === 'main')!.clip!;
    expect(clip).toContainEqual([6, 6]);
    expect(clip).toContainEqual([102, 6]);
  });
  it('grows a motif with the rug, within its limits', () => {
    const motif: Segment = {
      ...newSegment('motif', emptyDoc),
      color: null,
      art,
      x: makeRule(20, { fit: 'single', minStretch: 0.5, maxStretch: 1.5 }),
      y: makeRule(20, { fit: 'single', minStretch: 0.5, maxStretch: 1.5 }),
    };
    const size = (w: number, h: number) =>
      layoutRug(withSegments(motif), w, h, { x: 0, y: 0 }).ops.find((o) => o.art === 'main')!.box;
    expect(size(108, 144).width).toBeCloseTo(20);
    expect(size(216, 288).width).toBeCloseTo(30);
    expect(size(54, 72).width).toBeCloseTo(10);
    // Keeps its shape when only one direction grows.
    expect(size(216, 144)).toMatchObject({ width: 20, height: 20 });
  });
  it('knows the smallest rug that leaves room inside', () => {
    expect(minimumSize(withSegments(border))).toEqual({ width: 18, height: 18 });
  });
});

describe('reading a rug picture', () => {
  const picture = (width: number, height: number, at: (x: number, y: number) => [number, number, number]): Pixels => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) data.set([...at(x, y), 255], (y * width + x) * 4);
    }
    return { data, width, height };
  };
  it('finds where the bands change', () => {
    const px = picture(300, 400, (x, y) => {
      const d = Math.min(x, y, 299 - x, 399 - y);
      return d < 10 ? [120, 10, 20] : d < 24 ? [220, 190, 130] : d < 60 ? [15, 12, 14] : [110, 12, 22];
    });
    expect(findBandEdges(px).map((e) => e.top)).toEqual([10, 24, 60]);
  });
  it('finds nothing in a plain picture', () => {
    expect(findBandEdges(picture(200, 200, () => [90, 40, 40]))).toEqual([]);
  });
  it('recognises a plain band', () => {
    expect(isPlain(picture(40, 20, () => [90, 40, 40]))).toBe(true);
    expect(isPlain(picture(40, 20, (x) => (x % 8 < 4 ? [20, 20, 20] : [230, 230, 230])))).toBe(false);
  });
  it('finds the length of a repeat', () => {
    const px = picture(240, 20, (x, y) => {
      const u = x % 34;
      return (u - 17) ** 2 + (y - 10) ** 2 < 60 ? [230, 200, 150] : u < 5 ? [150, 60, 40] : [20, 16, 18];
    });
    expect(findPeriod(px, 10, 120)?.unit).toBe(34);
  });
  it('finds no repeat where there is none', () => {
    let seed = 3;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    expect(findPeriod(picture(240, 20, () => [random() * 255, random() * 255, random() * 255]), 10, 120)).toBeNull();
  });
});
