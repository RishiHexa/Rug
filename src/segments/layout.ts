/**
 * Turns segments and their rules into drawing instructions for a rug of any
 * size. Pure math: no canvas. All lengths are inches.
 */
import {
  borderInsets,
  type AxisRule,
  type BorderPlacement,
  type MotifPlacement,
  type Segment,
  type SegmentDoc,
} from './model';

export interface Piece {
  start: number;
  length: number;
  flip: boolean;
}

export interface Run {
  pieces: Piece[];
  /** The part of the room the run occupies; pieces are cut off outside it. */
  start: number;
  length: number;
  /** Scale of each piece, and the space after it. */
  stretch: number;
  gap: number;
  /**
   * fits: every limit is met. cropped / forced: a limit could not be met, so
   * pieces are cut off or stretched past it. room: the piece is at its largest
   * and leaves space around it. hidden: not enough room.
   */
  state: 'fits' | 'cropped' | 'forced' | 'room' | 'hidden';
}

const EPS = 1e-6;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Fits pieces into the room available, in this order of preference:
 * keep the pieces at 100% and let the gaps grow up to their limit; then change
 * the number of pieces, squeezing or stretching within the limits, whichever
 * changes them least; and only then crop or stretch past the limits.
 */
export function fitRun(available: number, rule: AxisRule, overflow: Segment['overflow']): Run {
  const hidden: Run = { pieces: [], start: 0, length: 0, stretch: 1, gap: 0, state: 'hidden' };
  if (available <= EPS || rule.piece <= EPS) return hidden;
  if (rule.minLength !== null && available < rule.minLength - EPS) return hidden;

  const length = rule.maxLength === null ? available : Math.min(available, rule.maxLength);
  const start = (available - length) / 2;
  if (length <= EPS) return hidden;

  if (rule.fit === 'single') {
    let stretch = clamp(length / rule.piece, rule.minStretch, rule.maxStretch);
    let state: Run['state'] = 'fits';
    const difference = stretch * rule.piece - length;
    if (Math.abs(difference) > EPS) {
      if (overflow === 'stretch') {
        stretch = length / rule.piece;
        state = 'forced';
      } else {
        state = difference > 0 ? 'cropped' : 'room';
      }
    }
    const size = stretch * rule.piece;
    const piece = { start: start + (length - size) / 2, length: size, flip: false };
    return { pieces: [piece], start, length, stretch, gap: 0, state };
  }

  const unit = rule.flip ? 2 : 1;
  const maxGap = Math.max(rule.gap, rule.maxGap);
  const fewer = Math.floor((length + EPS) / (rule.piece + rule.gap) / unit) * unit;
  let best: { count: number; gap: number; stretch: number; cost: number; fits: boolean } | null = null;
  for (const count of fewer > 0 ? [fewer, fewer + unit] : [unit]) {
    const pitch = length / count;
    const gap = clamp(pitch - rule.piece, rule.gap, maxGap);
    const stretch = (pitch - gap) / rule.piece;
    if (stretch <= EPS) continue;
    const fits = stretch >= rule.minStretch - EPS && stretch <= rule.maxStretch + EPS;
    const cost = Math.abs(Math.log(stretch));
    if (!best || (fits && !best.fits) || (fits === best.fits && cost < best.cost - EPS)) {
      best = { count, gap, stretch, cost, fits };
    }
  }

  if (!best || (!best.fits && overflow === 'crop')) {
    const pitch = rule.piece + rule.gap;
    let units = Math.max(1, Math.ceil((length - EPS) / pitch / unit));
    // An odd number of mirrored pairs keeps a whole pattern in the middle.
    if (rule.flip && units % 2 === 0) units++;
    const count = units * unit;
    const from = start + (length - count * pitch) / 2;
    return {
      pieces: spread(count, from, pitch, rule.piece, rule.flip),
      start,
      length,
      stretch: 1,
      gap: rule.gap,
      state: 'cropped',
    };
  }
  const pitch = length / best.count;
  return {
    pieces: spread(best.count, start, pitch, pitch - best.gap, rule.flip),
    start,
    length,
    stretch: best.stretch,
    gap: best.gap,
    state: best.fits ? 'fits' : 'forced',
  };
}

function spread(count: number, from: number, pitch: number, length: number, flip: boolean): Piece[] {
  return Array.from({ length: count }, (_, i) => ({
    start: from + i * pitch + (pitch - length) / 2,
    length,
    flip: flip && i % 2 === 1,
  }));
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Local → rug: x = a·u + c·v + e, y = b·u + d·v + f. */
export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];

export interface DrawOp {
  segment: number;
  /** null paints `color`; otherwise the segment's artwork. */
  art: 'main' | 'corner' | null;
  color: string;
  matrix: Matrix;
  /** Where to draw, and what to keep, in local coordinates. */
  box: Box;
  flipX: boolean;
  flipY: boolean;
  clip: [number, number][] | null;
}

/** How each segment came out, for the rule editor. */
export interface SegmentReport {
  x: Run | null;
  y: Run | null;
}

export interface RugLayout {
  ops: DrawOp[];
  reports: SegmentReport[];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Knot size to line pieces up with; 0 leaves them where they fall. */
export interface Snap {
  x: number;
  y: number;
}

const snapTo = (v: number, step: number) => (step > 0 ? Math.round(v / step + 1e-7) * step : v);

export function layoutRug(doc: SegmentDoc, width: number, height: number, snap: Snap): RugLayout {
  const ops: DrawOp[] = [];
  const rug: Box = { x: 0, y: 0, width, height };
  const inside = insideOf(doc.segments, width, height, snap);
  const baseInside = insideOf(doc.segments, doc.baseWidth, doc.baseHeight, { x: 0, y: 0 });
  const baseRug: Box = { x: 0, y: 0, width: doc.baseWidth, height: doc.baseHeight };

  ops.push(colorOp(-1, doc.background, IDENTITY, rug));
  const reports = doc.segments.map((segment, index): SegmentReport => {
    const { placement } = segment;
    switch (placement.type) {
      case 'border':
        return layoutBorder(ops, segment, placement, index, width, height, snap);
      case 'fill':
        return layoutFill(ops, segment, index, placement.area === 'rug' ? rug : inside, snap);
      case 'motif': {
        const whole = placement.area === 'rug';
        return layoutMotif(ops, segment, placement, index, whole ? rug : inside, whole ? baseRug : baseInside, snap);
      }
    }
  });
  return { ops, reports };
}

function insideOf(segments: readonly Segment[], width: number, height: number, snap: Snap): Box {
  const b = borderInsets(segments);
  const x = snapTo(b.left, snap.x);
  const y = snapTo(b.top, snap.y);
  return {
    x,
    y,
    width: Math.max(0, width - x - snapTo(b.right, snap.x)),
    height: Math.max(0, height - y - snapTo(b.bottom, snap.y)),
  };
}

function colorOp(segment: number, color: string, matrix: Matrix, box: Box, clip: DrawOp['clip'] = null): DrawOp {
  return { segment, art: null, color, matrix, box, flipX: false, flipY: false, clip };
}

const corners = ({ x, y, width, height }: Box): [number, number][] => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height],
];

function layoutBorder(
  ops: DrawOp[],
  segment: Segment,
  p: BorderPlacement,
  index: number,
  width: number,
  height: number,
  snap: Snap,
): SegmentReport {
  const none: SegmentReport = { x: null, y: null };
  const all = p.sides === 'all';
  const insetX = p.sides === 'ends' ? 0 : snapTo(p.inset, snap.x);
  const insetY = p.sides === 'sides' ? 0 : snapTo(p.inset, snap.y);
  // Thickness on the upright sides and on the ends, in whole knots.
  const thickX = snapTo(p.inset + p.thickness, snap.x) - snapTo(p.inset, snap.x);
  const thickY = snapTo(p.inset + p.thickness, snap.y) - snapTo(p.inset, snap.y);
  const w = width - 2 * insetX;
  const h = height - 2 * insetY;
  if (w < 2 * thickX || h < 2 * thickY || w <= 0 || h <= 0) return none;

  const right = insetX + w;
  const bottom = insetY + h;
  // Along the side (u) and inwards from its outer edge (v).
  const sides: { matrix: Matrix; length: number; depth: number; ends: number; step: number; isEnd: boolean }[] = [
    { matrix: [1, 0, 0, 1, insetX, insetY], length: w, depth: thickY, ends: thickX, step: snap.x, isEnd: true },
    { matrix: [0, 1, -1, 0, right, insetY], length: h, depth: thickX, ends: thickY, step: snap.y, isEnd: false },
    { matrix: [-1, 0, 0, -1, right, bottom], length: w, depth: thickY, ends: thickX, step: snap.x, isEnd: true },
    { matrix: [0, -1, 1, 0, insetX, bottom], length: h, depth: thickX, ends: thickY, step: snap.y, isEnd: false },
  ];

  const report: SegmentReport = { x: null, y: null };
  for (const side of sides) {
    if (p.sides === 'ends' && !side.isEnd) continue;
    if (p.sides === 'sides' && side.isEnd) continue;
    const band: Box = { x: 0, y: 0, width: side.length, height: side.depth };
    if (segment.color) ops.push(colorOp(index, segment.color, side.matrix, band));

    // Corner pieces and plain corners leave a square free at each end.
    const reserve = all && p.corner !== 'mitre' ? side.ends : 0;
    const run = fitRun(side.length - 2 * reserve, segment.x, segment.overflow);
    if (side.isEnd) report.x ??= run;
    else report.y ??= run;
    if (!segment.art) continue;

    const from = reserve + run.start;
    const to = from + run.length;
    const clip: [number, number][] =
      all && p.corner === 'mitre'
        ? mitre(from, to, side.length, side.depth, side.ends)
        : corners({ x: from, y: 0, width: to - from, height: side.depth });
    for (const piece of run.pieces) {
      const a = snapTo(reserve + piece.start, side.step);
      const b = snapTo(reserve + piece.start + piece.length, side.step);
      if (b <= a) continue;
      ops.push({
        segment: index,
        art: 'main',
        color: '',
        matrix: side.matrix,
        box: { x: a, y: 0, width: b - a, height: side.depth },
        flipX: piece.flip,
        flipY: false,
        clip,
      });
    }
  }

  if (all && p.corner === 'piece' && segment.cornerArt) {
    for (const [x, flipX] of [[insetX, false], [right - thickX, true]] as const) {
      for (const [y, flipY] of [[insetY, false], [bottom - thickY, true]] as const) {
        ops.push({
          segment: index,
          art: 'corner',
          color: '',
          matrix: IDENTITY,
          box: { x, y, width: thickX, height: thickY },
          flipX,
          flipY,
          clip: null,
        });
      }
    }
  }
  return report;
}

/** A side cut diagonally at both ends, limited to `from`–`to`. */
function mitre(from: number, to: number, length: number, depth: number, ends: number): [number, number][] {
  const lean = ends / depth;
  // Along the inner edge the side is shorter by `ends` at both ends.
  const at = (u: number): number => clamp(Math.min(u, length - u) / lean, 0, depth);
  const left: [number, number][] = from < ends ? [[from, at(from)], [from, 0]] : [[from, depth], [from, 0]];
  const right: [number, number][] =
    to > length - ends ? [[to, 0], [to, at(to)], [length - ends, depth]] : [[to, 0], [to, depth]];
  const close: [number, number][] = from < ends ? [[ends, depth]] : [];
  return [...left, ...right, ...close];
}

function layoutFill(ops: DrawOp[], segment: Segment, index: number, area: Box, snap: Snap): SegmentReport {
  if (area.width <= EPS || area.height <= EPS) return { x: null, y: null };
  const x = fitRun(area.width, segment.x, segment.overflow);
  const y = fitRun(area.height, segment.y, segment.overflow);
  if (x.state === 'hidden' || y.state === 'hidden') return { x, y };
  const part: Box = {
    x: snapTo(area.x + x.start, snap.x),
    y: snapTo(area.y + y.start, snap.y),
    width: 0,
    height: 0,
  };
  part.width = snapTo(area.x + x.start + x.length, snap.x) - part.x;
  part.height = snapTo(area.y + y.start + y.length, snap.y) - part.y;
  if (segment.color) ops.push(colorOp(index, segment.color, IDENTITY, part));
  if (segment.art) {
    const clip = corners(part);
    for (const row of y.pieces) {
      const top = snapTo(area.y + row.start, snap.y);
      const bottom = snapTo(area.y + row.start + row.length, snap.y);
      for (const col of x.pieces) {
        const left = snapTo(area.x + col.start, snap.x);
        const right = snapTo(area.x + col.start + col.length, snap.x);
        if (right <= left || bottom <= top) continue;
        ops.push({
          segment: index,
          art: 'main',
          color: '',
          matrix: IDENTITY,
          box: { x: left, y: top, width: right - left, height: bottom - top },
          flipX: col.flip,
          flipY: row.flip,
          clip,
        });
      }
    }
  }
  return { x, y };
}

function layoutMotif(
  ops: DrawOp[],
  segment: Segment,
  p: MotifPlacement,
  index: number,
  area: Box,
  base: Box,
  snap: Snap,
): SegmentReport {
  const scaled = (available: number, original: number, rule: AxisRule): Run => {
    const hidden: Run = { pieces: [], start: 0, length: 0, stretch: 1, gap: 0, state: 'hidden' };
    if (available <= EPS || (rule.minLength !== null && available < rule.minLength - EPS)) return hidden;
    const grown = original > EPS ? available / original : 1;
    let stretch = clamp(grown, rule.minStretch, rule.maxStretch);
    if (rule.maxLength !== null) stretch = Math.min(stretch, rule.maxLength / rule.piece);
    let state: Run['state'] = 'fits';
    if (stretch * rule.piece > available + EPS) {
      if (segment.overflow === 'stretch') {
        stretch = available / rule.piece;
        state = 'forced';
      } else {
        state = 'cropped';
      }
    }
    return { pieces: [], start: 0, length: stretch * rule.piece, stretch, gap: 0, state };
  };
  const x = scaled(area.width, base.width, segment.x);
  const y = scaled(area.height, base.height, segment.y);
  if (x.state === 'hidden' || y.state === 'hidden') return { x, y };
  if (p.keepShape) {
    const stretch = Math.min(x.stretch, y.stretch);
    Object.assign(x, { stretch, length: stretch * segment.x.piece });
    Object.assign(y, { stretch, length: stretch * segment.y.piece });
  }

  const w = x.length;
  const h = y.length;
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const midX = area.x + area.width / 2;
  const midY = area.y + area.height / 2;
  const clip = corners(area);

  const place = (box: Box, flipX = false, flipY = false) => {
    const left = snapTo(box.x, snap.x);
    const top = snapTo(box.y, snap.y);
    const snapped: Box = {
      x: left,
      y: top,
      width: snapTo(box.x + box.width, snap.x) - left,
      height: snapTo(box.y + box.height, snap.y) - top,
    };
    if (segment.color) ops.push(colorOp(index, segment.color, IDENTITY, snapped, clip));
    if (segment.art) {
      ops.push({ segment: index, art: 'main', color: '', matrix: IDENTITY, box: snapped, flipX, flipY, clip });
    }
  };

  switch (p.anchor) {
    case 'center':
      place({ x: midX - w / 2 + p.offsetX, y: midY - h / 2 + p.offsetY, width: w, height: h });
      break;
    case 'corners':
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          place(
            {
              x: flipX ? right - p.offsetX - w : area.x + p.offsetX,
              y: flipY ? bottom - p.offsetY - h : area.y + p.offsetY,
              width: w,
              height: h,
            },
            flipX,
            flipY,
          );
        }
      }
      break;
    case 'edges':
      place({ x: midX - w / 2 + p.offsetX, y: area.y + p.offsetY, width: w, height: h });
      place({ x: midX - w / 2 + p.offsetX, y: bottom - p.offsetY - h, width: w, height: h }, false, true);
      break;
  }
  return { x, y };
}
