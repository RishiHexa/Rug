/**
 * Turns segments and their rules into drawing instructions for a rug of any
 * size. Pure math: no canvas. All lengths are inches.
 */
import {
  borderFactor,
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
  /** Which of the artwork's pieces to draw; -1 for the middle piece. */
  slot: number;
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
   * and leaves space around it. hidden: not enough room. crowded: a motif
   * that, at its limits, runs into another motif more than it does at the
   * size the design was made for.
   */
  state: 'fits' | 'cropped' | 'forced' | 'room' | 'hidden' | 'crowded';
}

const EPS = 1e-6;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const HIDDEN: Run = { pieces: [], start: 0, length: 0, stretch: 1, gap: 0, state: 'hidden' };

/**
 * Fits pieces into the room available, in this order of preference:
 * keep the pieces at 100% and let the gaps grow up to their limit; then change
 * the number of pieces, squeezing or stretching within the limits, whichever
 * changes them least; and only then crop or stretch past the limits.
 */
export function fitRun(available: number, rule: AxisRule, overflow: Segment['overflow']): Run {
  if (available <= EPS || rule.piece <= EPS) return HIDDEN;
  if (rule.minLength !== null && available < rule.minLength - EPS) return HIDDEN;

  const length = rule.maxLength === null ? available : Math.min(available, rule.maxLength);
  const start = (available - length) / 2;
  if (length <= EPS) return HIDDEN;
  if (rule.symmetric && rule.fit === 'repeat') return fitSymmetric(start, length, rule, overflow);

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
    const piece = { start: start + (length - size) / 2, length: size, flip: false, slot: 0 };
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
      pieces: spread(count, from, pitch, rule.piece, rule.flip, rule.slots),
      start,
      length,
      stretch: 1,
      gap: rule.gap,
      state: 'cropped',
    };
  }
  const pitch = length / best.count;
  return {
    pieces: spread(best.count, start, pitch, pitch - best.gap, rule.flip, rule.slots),
    start,
    length,
    stretch: best.stretch,
    gap: best.gap,
    state: best.fits ? 'fits' : 'forced',
  };
}

function spread(count: number, from: number, pitch: number, length: number, flip: boolean, slots: number): Piece[] {
  return Array.from({ length: count }, (_, i) => ({
    start: from + i * pitch + (pitch - length) / 2,
    length,
    flip: flip && i % 2 === 1,
    slot: i % Math.max(1, slots),
  }));
}

/**
 * A run laid out from its middle, as a main border is: a middle piece, then
 * the same number of pieces either side, the left ones mirror images of the
 * right. Growing adds one piece each side; the artwork's pieces are used in
 * turn outwards from the middle, so a border of different motifs keeps its
 * order and simply continues it.
 */
function fitSymmetric(start: number, length: number, rule: AxisRule, overflow: Segment['overflow']): Run {
  const p = rule.piece;
  const c = Math.max(0, rule.center);
  const maxGap = Math.max(rule.gap, rule.maxGap);
  const least = c > EPS ? 0 : 1;
  const ideal = (length - c) / (2 * (p + rule.gap));
  const lower = Math.max(least, Math.floor(ideal + EPS));
  let best: { n: number; gap: number; stretch: number; cost: number; fits: boolean } | null = null;
  for (const n of [lower, lower + 1]) {
    // Gaps first take up what they may, at 100%; the rest is stretch.
    const gap = n > 0 ? clamp((length - c - 2 * n * p) / (2 * n), rule.gap, maxGap) : 0;
    const stretch = (length - 2 * n * gap) / (c + 2 * n * p);
    if (stretch <= EPS) continue;
    const fits = stretch >= rule.minStretch - EPS && stretch <= rule.maxStretch + EPS;
    const cost = Math.abs(Math.log(stretch));
    if (!best || (fits && !best.fits) || (fits === best.fits && cost < best.cost - EPS)) {
      best = { n, gap, stretch, cost, fits };
    }
  }
  let state: Run['state'] = 'fits';
  if (!best || (!best.fits && overflow === 'crop')) {
    // At 100%, with enough pieces to reach past both ends; the ends are cut.
    const n = Math.max(least, Math.ceil((length - c) / (2 * (p + rule.gap)) - EPS));
    best = { n, gap: rule.gap, stretch: 1, cost: 0, fits: false };
    state = 'cropped';
  } else if (!best.fits) {
    state = 'forced';
  }
  const { n, gap, stretch } = best;
  const mid = start + length / 2;
  const size = p * stretch;
  const half = (c * stretch) / 2;
  const pieces: Piece[] = [];
  if (c > EPS) pieces.push({ start: mid - half, length: 2 * half, flip: false, slot: -1 });
  const slots = Math.max(1, rule.slots);
  for (let i = 0; i < n; i++) {
    const from = mid + half + gap / 2 + i * (size + gap);
    const slot = i % slots;
    pieces.push({ start: from, length: size, flip: false, slot });
    pieces.push({ start: 2 * mid - from - size, length: size, flip: true, slot });
  }
  return { pieces, start, length, stretch, gap, state };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Local → rug: x = a·u + c·v + e, y = b·u + d·v + f. */
export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];

/** Which of a segment's pictures an operation draws. */
export type ArtKind = 'main' | 'corner' | 'side' | 'center' | 'sideCenter';

export interface DrawOp {
  segment: number;
  /** null paints `color`; otherwise one of the segment's pictures. */
  art: ArtKind | null;
  color: string;
  matrix: Matrix;
  /** Where to draw, and what to keep, in local coordinates. */
  box: Box;
  flipX: boolean;
  flipY: boolean;
  clip: [number, number][] | null;
  /** Draw only this one of `of` equal pieces of the picture, side by side. */
  slot: { index: number; of: number } | null;
}

/** How each segment came out, for the rule editor. */
export interface SegmentReport {
  x: Run | null;
  y: Run | null;
}

export interface RugLayout {
  ops: DrawOp[];
  reports: SegmentReport[];
  /** Where each motif landed, in inches, by segment index. */
  placed: Map<number, Box[]>;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Knot size to line pieces up with; 0 leaves them where they fall. */
export interface Snap {
  x: number;
  y: number;
}

const snapTo = (v: number, step: number) => (step > 0 ? Math.round(v / step + 1e-7) * step : v);

export function layoutRug(doc: SegmentDoc, width: number, height: number, snap: Snap, checkCrowding = true): RugLayout {
  const ops: DrawOp[] = [];
  const rug: Box = { x: 0, y: 0, width, height };
  const factor = borderFactor(doc, width, height);
  const inside = insideOf(doc.segments, width, height, snap, factor);
  const baseInside = insideOf(doc.segments, doc.baseWidth, doc.baseHeight, { x: 0, y: 0 }, 1);
  const baseRug: Box = { x: 0, y: 0, width: doc.baseWidth, height: doc.baseHeight };

  // Motifs may depend on each other, so they are worked out first, each
  // after the one it follows.
  const motifs = new Map<number, MotifPlan>();
  const plan = (index: number, seen: Set<number>): MotifPlan | null => {
    const known = motifs.get(index);
    if (known) return known;
    const segment = doc.segments[index]!;
    const p = segment.placement;
    if (p.type !== 'motif' || seen.has(index)) return null;
    seen.add(index);
    const leaderIndex = p.follow ? doc.segments.findIndex((s) => s.id === p.follow) : -1;
    const leader = leaderIndex >= 0 && leaderIndex !== index ? plan(leaderIndex, seen) : null;
    const whole = p.area === 'rug';
    const result = planMotif(segment, p, whole ? rug : inside, whole ? baseRug : baseInside, leader);
    motifs.set(index, result);
    return result;
  };
  doc.segments.forEach((_, i) => plan(i, new Set()));

  ops.push(colorOp(-1, doc.background, IDENTITY, rug));
  const placed = new Map<number, Box[]>();
  const reports = doc.segments.map((segment, index): SegmentReport => {
    const { placement } = segment;
    switch (placement.type) {
      case 'border':
        return layoutBorder(ops, scaleBorder(segment, factor), index, width, height, snap);
      case 'fill':
        return layoutFill(ops, segment, index, placement.area === 'rug' ? rug : inside, snap);
      case 'motif': {
        const m = motifs.get(index)!;
        placed.set(index, m.places.map((pl) => pl.box));
        emitMotif(ops, segment, index, m, placement.area === 'rug' ? rug : inside, snap);
        return { x: m.x, y: m.y };
      }
    }
  });
  if (checkCrowding) markCrowding(doc, reports, placed);
  return { ops, reports, placed };
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** Share of the smaller of two motifs that the other covers. */
function covered(a: Box[], b: Box[]): number {
  let shared = 0;
  for (const p of a) for (const q of b) shared += overlap(p, q);
  const area = (boxes: Box[]) => boxes.reduce((n, o) => n + o.width * o.height, 0);
  const least = Math.min(area(a), area(b));
  return least > 0 ? shared / least : 0;
}

/** How much more two motifs may overlap than they do at the design's own size. */
const CROWDING = 0.05;

/**
 * Motifs placed on their own (not one following the other) that now overlap
 * clearly more than in the design as made are marked crowded: they have
 * reached their limits and the rug is too small for them.
 */
function markCrowding(doc: SegmentDoc, reports: SegmentReport[], placed: Map<number, Box[]>): void {
  const base = layoutRug(doc, doc.baseWidth, doc.baseHeight, { x: 0, y: 0 }, false).placed;
  const indices = [...placed.keys()];
  const related = (i: number, j: number) => {
    const a = doc.segments[i]!.placement;
    const b = doc.segments[j]!.placement;
    return (a.type === 'motif' && a.follow === doc.segments[j]!.id) || (b.type === 'motif' && b.follow === doc.segments[i]!.id);
  };
  for (const i of indices) {
    for (const j of indices) {
      if (j <= i || related(i, j)) continue;
      const now = covered(placed.get(i)!, placed.get(j)!);
      const was = covered(base.get(i) ?? [], base.get(j) ?? []);
      if (now <= was + CROWDING) continue;
      for (const k of [i, j]) {
        const r = reports[k]!;
        for (const run of [r.x, r.y]) if (run && run.state === 'fits') run.state = 'crowded';
      }
    }
  }
}

/**
 * A border as it is on a rug where borders are scaled by `factor`: thicker or
 * thinner, and its pieces with it, so its motifs keep their shape.
 */
function scaleBorder(segment: Segment, factor: number): Segment {
  if (factor === 1 || segment.placement.type !== 'border') return segment;
  const rule = (r: AxisRule): AxisRule => ({
    ...r,
    piece: r.piece * factor,
    center: r.center * factor,
    gap: r.gap * factor,
    maxGap: r.maxGap * factor,
  });
  const p = segment.placement;
  return {
    ...segment,
    placement: { ...p, inset: p.inset * factor, thickness: p.thickness * factor },
    x: rule(segment.x),
    y: rule(segment.y),
  };
}

function insideOf(segments: readonly Segment[], width: number, height: number, snap: Snap, factor: number): Box {
  const b = borderInsets(segments, factor);
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
  return { segment, art: null, color, matrix, box, flipX: false, flipY: false, clip, slot: null };
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
  index: number,
  width: number,
  height: number,
  snap: Snap,
): SegmentReport {
  const none: SegmentReport = { x: null, y: null };
  const p = segment.placement as BorderPlacement;
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
  // With their own artwork, the sides follow their own rule.
  const ownSides = segment.sideArt !== null;
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
    const useSide = !side.isEnd && ownSides;
    const rule = useSide ? segment.y : segment.x;
    const run = fitRun(side.length - 2 * reserve, rule, segment.overflow);
    if (side.isEnd) report.x ??= run;
    else report.y ??= run;
    const main = useSide ? segment.sideArt : segment.art;
    if (!main) continue;
    const center: ArtKind = useSide && segment.sideCenterArt ? 'sideCenter' : 'center';
    const hasCenter = (center === 'sideCenter' ? segment.sideCenterArt : segment.centerArt) !== null;

    const from = reserve + run.start;
    const to = from + run.length;
    const clip: [number, number][] =
      all && p.corner === 'mitre'
        ? mitre(from, to, side.length, side.depth, side.ends)
        : corners({ x: from, y: 0, width: to - from, height: side.depth });
    for (const piece of run.pieces) {
      if (piece.slot < 0 && !hasCenter) continue;
      const a = snapTo(reserve + piece.start, side.step);
      const b = snapTo(reserve + piece.start + piece.length, side.step);
      if (b <= a) continue;
      ops.push({
        segment: index,
        art: piece.slot < 0 ? center : useSide ? 'side' : 'main',
        color: '',
        matrix: side.matrix,
        box: { x: a, y: 0, width: b - a, height: side.depth },
        flipX: piece.flip,
        flipY: false,
        clip,
        slot: piece.slot >= 0 && rule.slots > 1 ? { index: piece.slot, of: rule.slots } : null,
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
          slot: null,
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
          slot: null,
        });
      }
    }
  }
  return { x, y };
}

interface MotifPlan {
  x: Run;
  y: Run;
  places: { box: Box; flipX: boolean; flipY: boolean }[];
}

/**
 * Size and place of a motif. On its own, a motif grows with the room it is in
 * (the tighter direction when it keeps its shape). Following another motif, it
 * takes that one's size, so a medallion's pendants or a spandrel's pockets
 * stay in proportion with it. Offsets grow and shrink with the motif.
 */
function planMotif(segment: Segment, p: MotifPlacement, area: Box, base: Box, leader: MotifPlan | null): MotifPlan {
  const hiddenPlan: MotifPlan = { x: HIDDEN, y: HIDDEN, places: [] };
  const scaled = (available: number, original: number, rule: AxisRule, given: number | null): Run => {
    if (available <= EPS || (rule.minLength !== null && available < rule.minLength - EPS)) return HIDDEN;
    const grown = given ?? (original > EPS ? available / original : 1);
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
  const following = leader && leader.places.length > 0 ? leader : null;
  const x = scaled(area.width, base.width, segment.x, following ? following.x.stretch : null);
  const y = scaled(area.height, base.height, segment.y, following ? following.y.stretch : null);
  if (x.state === 'hidden' || y.state === 'hidden') return { ...hiddenPlan, x, y };
  if (p.keepShape) {
    const stretch = Math.min(x.stretch, y.stretch);
    Object.assign(x, { stretch, length: stretch * segment.x.piece });
    Object.assign(y, { stretch, length: stretch * segment.y.piece });
  }

  let w = x.length;
  let h = y.length;
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const midX = area.x + area.width / 2;
  const midY = area.y + area.height / 2;
  const ox = p.offsetX * x.stretch;
  const oy = p.offsetY * y.stretch;
  const places: MotifPlan['places'] = [];
  const add = (box: Box, flipX = false, flipY = false) => places.push({ box, flipX, flipY });

  switch (p.anchor) {
    case 'center':
      add({ x: midX - w / 2 + ox, y: midY - h / 2 + oy, width: w, height: h });
      break;
    case 'corners':
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          add(
            {
              x: flipX ? right - ox - w : area.x + ox,
              y: flipY ? bottom - oy - h : area.y + oy,
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
      add({ x: midX - w / 2 + ox, y: area.y + oy, width: w, height: h });
      add({ x: midX - w / 2 + ox, y: bottom - oy - h, width: w, height: h }, false, true);
      break;
    case 'axis': {
      const lead = following?.places[0]?.box;
      if (!lead) {
        add({ x: midX - w / 2 + ox, y: area.y + oy, width: w, height: h });
        add({ x: midX - w / 2 + ox, y: bottom - oy - h, width: w, height: h }, false, true);
        break;
      }
      // Room between the motif it hangs from and the edge, less the gap
      // that must stay clear of the edge.
      const room = lead.y - area.y - p.edgeGap;
      const pieceH = segment.y.piece;
      let s = y.stretch;
      if (p.offsetY * s + pieceH * s > room + EPS) {
        // Shrink, gap and all, until it fits.
        s = room / (p.offsetY + pieceH);
        const least = segment.y.minStretch;
        if (!(s > EPS) || s < least - EPS) {
          if (segment.overflow !== 'stretch' || !(s > EPS)) return { ...hiddenPlan, x, y: { ...HIDDEN } };
          y.state = 'forced';
          x.state = 'forced';
        }
        const sx = p.keepShape ? s : x.stretch;
        Object.assign(y, { stretch: s, length: s * pieceH });
        Object.assign(x, { stretch: sx, length: sx * segment.x.piece });
        w = x.length;
        h = y.length;
      }
      const gap = p.offsetY * y.stretch;
      const cx = lead.x + lead.width / 2 + p.offsetX * x.stretch;
      add({ x: cx - w / 2, y: lead.y - gap - h, width: w, height: h });
      add({ x: cx - w / 2, y: lead.y + lead.height + gap, width: w, height: h }, false, true);
      break;
    }
  }
  return { x, y, places };
}

function emitMotif(ops: DrawOp[], segment: Segment, index: number, m: MotifPlan, area: Box, snap: Snap): void {
  const clip = corners(area);
  for (const { box, flipX, flipY } of m.places) {
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
      ops.push({ segment: index, art: 'main', color: '', matrix: IDENTITY, box: snapped, flipX, flipY, clip, slot: null });
    }
  }
}
