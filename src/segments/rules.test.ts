/**
 * The resize rules for a rug read from a picture: mirrored main borders,
 * motifs that follow another motif, and a Heriz-style stack of layers that
 * must hold together at every size.
 */
import { describe, expect, it } from 'vitest';
import { fitRun, layoutRug, type Box, type DrawOp } from './layout';
import { makeRule, type Art, type Segment, type SegmentDoc } from './model';

const art = { canvas: {} as HTMLCanvasElement, crisp: false } satisfies Art;
const EPS = 1e-6;

describe('fitRun: laid out from the middle', () => {
  const rule = makeRule(10, { symmetric: true, center: 10, slots: 4, minStretch: 0.8, maxStretch: 1.25 });

  it('puts the middle piece in the middle and the same count either side', () => {
    const run = fitRun(90, rule, 'crop');
    expect(run.state).toBe('fits');
    expect(run.stretch).toBeCloseTo(1);
    const middle = run.pieces.filter((p) => p.slot === -1);
    expect(middle).toHaveLength(1);
    expect(middle[0]!.start + middle[0]!.length / 2).toBeCloseTo(45);
    const right = run.pieces.filter((p) => p.slot >= 0 && !p.flip);
    const left = run.pieces.filter((p) => p.flip);
    expect(right).toHaveLength(4);
    expect(left).toHaveLength(4);
  });

  it('mirrors the left half onto the right, piece for piece', () => {
    const run = fitRun(90, rule, 'crop');
    const right = run.pieces.filter((p) => p.slot >= 0 && !p.flip);
    const left = run.pieces.filter((p) => p.flip);
    right.forEach((r, i) => {
      const l = left[i]!;
      expect(l.slot).toBe(r.slot);
      expect(l.start + l.length).toBeCloseTo(90 - r.start);
    });
  });

  it('uses the different pieces in turn outwards, continuing the order when it grows', () => {
    const run = fitRun(130, rule, 'crop');
    const right = run.pieces.filter((p) => p.slot >= 0 && !p.flip).sort((a, b) => a.start - b.start);
    expect(right.map((p) => p.slot)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('adds one piece each side rather than stretching past the limits', () => {
    for (let length = 30; length <= 300; length += 1.7) {
      const run = fitRun(length, rule, 'crop');
      if (run.state !== 'fits') continue;
      expect(run.stretch).toBeGreaterThanOrEqual(0.8 - EPS);
      expect(run.stretch).toBeLessThanOrEqual(1.25 + EPS);
      const covered = run.pieces.reduce((n, p) => n + p.length, 0);
      expect(covered).toBeCloseTo(length);
      // No overlaps.
      const sorted = run.pieces.slice().sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.start).toBeGreaterThanOrEqual(sorted[i - 1]!.start + sorted[i - 1]!.length - EPS);
      }
    }
  });

  it('crops at the ends, never in the middle, when it cannot fit', () => {
    const tight = makeRule(10, { symmetric: true, center: 10, slots: 2, minStretch: 0.98, maxStretch: 1.02 });
    const run = fitRun(55, tight, 'crop');
    expect(run.state).toBe('cropped');
    const middle = run.pieces.find((p) => p.slot === -1)!;
    expect(middle.start + middle.length / 2).toBeCloseTo(27.5);
    expect(middle.length).toBeCloseTo(10);
  });

  it('works without a middle piece', () => {
    const run = fitRun(80, makeRule(10, { symmetric: true, center: 0 }), 'crop');
    expect(run.pieces.some((p) => p.slot === -1)).toBe(false);
    expect(run.pieces).toHaveLength(8);
  });
});

describe('fitRun: sequences', () => {
  it('cycles through the pieces of a plain repeat', () => {
    const run = fitRun(50, makeRule(10, { slots: 3 }), 'crop');
    expect(run.pieces.map((p) => p.slot)).toEqual([0, 1, 2, 0, 1]);
  });
});

// ---------------------------------------------------------------- a Heriz-style rug

const segment = (patch: Partial<Segment> & Pick<Segment, 'placement' | 'x' | 'y'>): Segment => ({
  id: Math.random().toString(36).slice(2),
  name: 'x',
  role: null,
  color: null,
  art,
  cornerArt: null,
  sideArt: null,
  centerArt: null,
  sideCenterArt: null,
  overflow: 'crop',
  ...patch,
});

/** Proportions of the rug in the component map, in inches, at 9 × 12 ft. */
function heriz(): SegmentDoc {
  const single = (length: number) => makeRule(length, { fit: 'single', minStretch: 0.3, maxStretch: 1.6 });
  const border = segment({
    name: 'Main border',
    role: 'mainBorder',
    color: '#9b4334',
    sideArt: art,
    centerArt: art,
    sideCenterArt: art,
    cornerArt: art,
    placement: { type: 'border', inset: 4, thickness: 9, sides: 'all', corner: 'piece' },
    x: makeRule(9, { symmetric: true, center: 9, slots: 4, minStretch: 0.8, maxStretch: 1.25 }),
    y: makeRule(9, { symmetric: true, center: 9, slots: 6, minStretch: 0.8, maxStretch: 1.25 }),
  });
  const guard = segment({
    name: 'Inner guard',
    role: 'innerGuard',
    color: '#5b7a99',
    placement: { type: 'border', inset: 13, thickness: 3.5, sides: 'all', corner: 'mitre' },
    x: makeRule(2, { minStretch: 0.8, maxStretch: 1.25 }),
    y: makeRule(2),
  });
  const field = segment({
    name: 'Field',
    role: 'field',
    color: '#883228',
    placement: { type: 'fill', area: 'inside' },
    x: makeRule(40, { flip: true, minStretch: 0.75, maxStretch: 1.35 }),
    y: makeRule(55.5, { flip: true, minStretch: 0.75, maxStretch: 1.35 }),
  });
  const spandrel = segment({
    name: 'Spandrels',
    role: 'spandrel',
    placement: { type: 'motif', area: 'inside', anchor: 'corners', offsetX: 0, offsetY: 0, keepShape: true, follow: null, edgeGap: 0 },
    x: single(32),
    y: single(34),
  });
  const pocket = segment({
    name: 'Pockets',
    role: 'pocket',
    placement: { type: 'motif', area: 'inside', anchor: 'corners', offsetX: 0.5, offsetY: 0.5, keepShape: true, follow: spandrel.id, edgeGap: 0 },
    x: single(15),
    y: single(16),
  });
  const medallion = segment({
    name: 'Medallion',
    role: 'medallion',
    placement: { type: 'motif', area: 'inside', anchor: 'center', offsetX: 0, offsetY: 0, keepShape: true, follow: null, edgeGap: 0 },
    x: single(52),
    y: single(59),
  });
  const pendant = segment({
    name: 'Pendants',
    role: 'pendant',
    placement: { type: 'motif', area: 'inside', anchor: 'axis', offsetX: 0, offsetY: 6, keepShape: true, follow: medallion.id, edgeGap: 1.5 },
    x: single(18),
    y: single(18),
  });
  return {
    background: '#9b4334',
    baseWidth: 108,
    baseHeight: 144,
    segments: [border, guard, field, spandrel, pocket, medallion, pendant],
  };
}

const inside = (a: Box, b: Box, slack = 1e-6) =>
  a.x >= b.x - slack && a.y >= b.y - slack && a.x + a.width <= b.x + b.width + slack && a.y + a.height <= b.y + b.height + slack;
const overlapArea = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

describe('a Heriz-style stack at every size', () => {
  const doc = heriz();
  const index = (role: Segment['role']) => doc.segments.findIndex((s) => s.role === role);
  const sizes: [number, number][] = [];
  for (let w = 48; w <= 192; w += 12) for (let h = 60; h <= 264; h += 12) sizes.push([w, h]);

  it('keeps the medallion in the middle of the field, its shape unchanged', () => {
    for (const [w, h] of sizes) {
      const layout = layoutRug(doc, w, h, { x: 0, y: 0 });
      const [box] = layout.placed.get(index('medallion'))!;
      if (!box) continue;
      expect(box.x + box.width / 2).toBeCloseTo(w / 2);
      expect(box.y + box.height / 2).toBeCloseTo(h / 2);
      expect(box.width / box.height).toBeCloseTo(52 / 59);
    }
  });

  it('hangs the pendants from the medallion, at its size, without touching the border', () => {
    for (const [w, h] of sizes) {
      const layout = layoutRug(doc, w, h, { x: 0, y: 0 });
      const [med] = layout.placed.get(index('medallion'))!;
      const pendants = layout.placed.get(index('pendant'))!;
      const field = { x: 13 + 3.5, y: 13 + 3.5, width: w - 33, height: h - 33 };
      if (!med || pendants.length === 0) continue;
      const [top, bottom] = pendants as [Box, Box];
      expect(top.x + top.width / 2).toBeCloseTo(w / 2);
      // Above and below, never overlapping it.
      expect(top.y + top.height).toBeLessThanOrEqual(med.y + EPS);
      expect(bottom.y).toBeGreaterThanOrEqual(med.y + med.height - EPS);
      // Room kept from the border.
      expect(top.y).toBeGreaterThanOrEqual(field.y + 1.5 - 1e-4);
      expect(bottom.y + bottom.height).toBeLessThanOrEqual(field.y + field.height - 1.5 + 1e-4);
      // Never larger in proportion than the medallion it hangs from.
      expect(top.width / 18).toBeLessThanOrEqual(med.width / 52 + 1e-6);
    }
  });

  it('drops the pendants rather than squeeze them below their limit', () => {
    for (const [w, h] of sizes) {
      const layout = layoutRug(doc, w, h, { x: 0, y: 0 });
      const report = layout.reports[index('pendant')]!;
      const pendants = layout.placed.get(index('pendant'))!;
      if (pendants.length === 0) expect(report.y?.state).toBe('hidden');
      else expect(report.y!.stretch).toBeGreaterThanOrEqual(0.3 - EPS);
    }
  });

  it('keeps spandrels in the field corners, pockets inside them, same scale as the medallion', () => {
    for (const [w, h] of sizes) {
      const layout = layoutRug(doc, w, h, { x: 0, y: 0 });
      const field = { x: 16.5, y: 16.5, width: w - 33, height: h - 33 };
      const spandrels = layout.placed.get(index('spandrel'))!;
      const pockets = layout.placed.get(index('pocket'))!;
      expect(spandrels).toHaveLength(4);
      for (const s of spandrels) {
        const touchesX = Math.abs(s.x - field.x) < EPS || Math.abs(s.x + s.width - (field.x + field.width)) < EPS;
        const touchesY = Math.abs(s.y - field.y) < EPS || Math.abs(s.y + s.height - (field.y + field.height)) < EPS;
        expect(touchesX && touchesY).toBe(true);
      }
      pockets.forEach((p, i) => expect(inside(p, spandrels[i]!, 1e-6)).toBe(true));
      const med = layout.reports[index('medallion')]!.x!;
      const spa = layout.reports[index('spandrel')]!.x!;
      if (med.state === 'fits' && spa.state === 'fits') {
        expect(spa.stretch).toBeCloseTo(med.stretch);
      }
    }
  });

  it('never lets the spandrels reach the medallion without saying so', () => {
    let crowded = 0;
    for (const [w, h] of sizes) {
      const layout = layoutRug(doc, w, h, { x: 0, y: 0 });
      const [med] = layout.placed.get(index('medallion'))!;
      if (!med) continue;
      const corners = layout.placed.get(index('spandrel'))!;
      // Box overlap is a generous test: spandrels are triangles in a box.
      const hits = corners.some((s) => overlapArea(s, med) / (med.width * med.height) >= 0.08);
      if (!hits) continue;
      crowded++;
      expect(layout.reports[index('medallion')]!.x!.state).not.toBe('fits');
      expect(layout.reports[index('spandrel')]!.x!.state).not.toBe('fits');
    }
    // Only the very smallest rugs, where both are at their least size.
    expect(crowded).toBeLessThan(sizes.length / 10);
  });

  it('turns the main border at fixed-size corners and keeps the middle piece in the middle', () => {
    for (const [w, h] of sizes) {
      const layout = layoutRug(doc, w, h, { x: 0, y: 0 });
      const ops = layout.ops.filter((o: DrawOp) => o.segment === index('mainBorder'));
      const corners = ops.filter((o) => o.art === 'corner');
      expect(corners).toHaveLength(4);
      for (const c of corners) {
        expect(c.box.width).toBeCloseTo(9);
        expect(c.box.height).toBeCloseTo(9);
      }
      const middles = ops.filter((o) => o.art === 'center' || o.art === 'sideCenter');
      expect(middles).toHaveLength(4);
      for (const m of middles) {
        const length = m.art === 'center' ? w - 8 : h - 8;
        expect(m.box.x + m.box.width / 2).toBeCloseTo(length / 2);
      }
      const report = layout.reports[index('mainBorder')]!;
      for (const run of [report.x!, report.y!]) {
        if (run.state === 'fits') {
          expect(run.stretch).toBeGreaterThanOrEqual(0.8 - EPS);
          expect(run.stretch).toBeLessThanOrEqual(1.25 + EPS);
        }
      }
      // The sides use their own artwork and rule.
      expect(ops.some((o) => o.art === 'side')).toBe(true);
    }
  });

  it('lines every piece up with whole knots', () => {
    const knot = { x: 0.1, y: 0.1 };
    const layout = layoutRug(doc, 127.3, 171.9, knot);
    for (const op of layout.ops) {
      if (op.matrix[0] !== 1 || op.matrix[3] !== 1) continue;
      const k = op.box.x / knot.x;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }
  });
});

describe('borders that follow the rug', () => {
  const doc = { ...heriz(), borderScale: { min: 0.55, max: 1.2 } };
  const borders = doc.segments.flatMap((s, i) => (s.placement.type === 'border' ? [i] : []));

  it('keep their size at the size the design was made for', () => {
    const layout = layoutRug(doc, 108, 144, { x: 0, y: 0 });
    const corner = layout.ops.find((o) => o.segment === borders[0] && o.art === 'corner')!;
    expect(corner.box.width).toBeCloseTo(9);
  });

  it('narrow on a smaller rug, all alike, and stay flush with each other', () => {
    const layout = layoutRug(doc, 72, 96, { x: 0, y: 0 });
    const factor = 72 / 108;
    const corner = layout.ops.find((o) => o.segment === borders[0] && o.art === 'corner')!;
    expect(corner.box.width).toBeCloseTo(9 * factor);
    expect(corner.box.x).toBeCloseTo(4 * factor);
    // The guard starts where the main border ends.
    const guard = layout.ops.find((o) => o.segment === borders[1] && o.art === null)!;
    expect(guard.matrix[4]).toBeCloseTo(13 * factor);
    // The field fills exactly what the borders leave.
    const field = layout.ops.find((o) => doc.segments[o.segment]?.role === 'field' && o.art === null)!;
    expect(field.box.x).toBeCloseTo(16.5 * factor);
  });

  it('stop at their limits', () => {
    const tiny = layoutRug(doc, 30, 60, { x: 0, y: 0 });
    const huge = layoutRug(doc, 240, 300, { x: 0, y: 0 });
    const width = (l: typeof tiny) => l.ops.find((o) => o.segment === borders[0] && o.art === 'corner')!.box.width;
    expect(width(tiny)).toBeCloseTo(9 * 0.55);
    expect(width(huge)).toBeCloseTo(9 * 1.2);
  });

  it('scale their pieces with them, so the motifs keep their shape', () => {
    const layout = layoutRug(doc, 72, 96, { x: 0, y: 0 });
    const run = layout.reports[borders[0]!]!.x!;
    const piece = layout.ops.find((o) => o.segment === borders[0] && o.art === 'main')!;
    expect(piece.box.width / piece.box.height).toBeCloseTo(run.stretch, 5);
  });
});
