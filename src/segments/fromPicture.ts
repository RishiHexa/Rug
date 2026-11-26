/**
 * Turns a picture of a whole rug into a stack of layers, one per part of the
 * rug, each with its background color, its shapes cut out of that background,
 * and rules for how it follows a new size.
 */
import { oklabToHex, type Oklab } from '../domain/color';
import {
  analyseRug,
  depthOf,
  dominantColor,
  SIDES,
  type BandEdge,
  type BandInfo,
  type Region,
  type RugAnalysis,
  type RunInfo,
} from './analyse';
import { makeCanvas } from './compose';
import { groundTolerance, shapeMask, smoothLab, type ShapeOptions } from './cutout';
import { dilate, emptyMask, not, resize, type Mask, type Rect } from './mask';
import { makeRule, newSegmentId, type Art, type ComponentRole, type Segment, type SegmentDoc } from './model';
import type { Pixels } from './pixels';

/** Pictures are analysed at this size at most. Thin guard bands need detail. */
const ANALYSIS_SIDE = 1800;
/** Cut-out shapes are kept at most this big. */
const MAX_SHAPE_SIDE = 1600;

export interface Analysed {
  image: ImageBitmap;
  /** Analysis pixels per picture pixel. */
  scale: number;
  analysis: RugAnalysis;
}

function pixelsOf(image: CanvasImageSource, width: number, height: number): Pixels {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Reads the parts of a rug picture. `edges` are band edges in picture pixels. */
export function analysePicture(image: ImageBitmap, edges?: BandEdge[]): Analysed {
  const scale = Math.min(1, ANALYSIS_SIDE / Math.max(image.width, image.height));
  const px = pixelsOf(image, image.width * scale, image.height * scale);
  const scaled = edges?.map((e) => Object.fromEntries(SIDES.map((s) => [s, Math.round(e[s] * scale)])) as unknown as BandEdge);
  return { image, scale, analysis: analyseRug(px, scaled) };
}

/** Band edges of an analysis, in picture pixels. */
export function pictureEdges({ analysis, scale }: Analysed): BandEdge[] {
  const toPicture = (e: BandEdge) => Object.fromEntries(SIDES.map((s) => [s, e[s] / scale])) as unknown as BandEdge;
  return analysis.bands.map((b) => toPicture(b.inner));
}

// ---------------------------------------------------------------- cutting

/** Turn applied when grabbing: a left-side run is read from the bottom up. */
type Turn = 'none' | 'left';

/**
 * Part of the picture at up to MAX_SHAPE_SIDE. For `left`, the rectangle is a
 * strip down the left side, returned lying down as the layout draws side
 * artwork: along = from the bottom up, across = from the rug's edge inwards.
 */
function grab(image: ImageBitmap, r: Rect, turn: Turn = 'none'): HTMLCanvasElement {
  const along = turn === 'left' ? r.height : r.width;
  const across = turn === 'left' ? r.width : r.height;
  const k = Math.min(1, MAX_SHAPE_SIDE / Math.max(along, across));
  const canvas = makeCanvas(along * k, across * k);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  if (turn === 'left') {
    // u = (r.y + r.height − y)·k, v = (x − r.x)·k
    ctx.setTransform(0, k, -k, 0, (r.y + r.height) * k, -r.x * k);
  } else {
    ctx.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
  }
  ctx.drawImage(image, 0, 0);
  return canvas;
}

/** Makes everything outside `mask` see-through. */
function applyMask(canvas: HTMLCanvasElement, mask: Mask): Art {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i] === 0) image.data[i * 4 + 3] = 0;
  ctx.putImageData(image, 0, 0);
  return { canvas, crisp: false };
}

/** A shape cut off its background, from a grabbed canvas. */
function cut(canvas: HTMLCanvasElement, options: Omit<ShapeOptions, 'tolerance'> & { tolerance?: number }): Art {
  const px = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
  const tolerance = options.tolerance ?? groundTolerance(smoothLab(px, 1), options.background[0]!);
  const smooth = Math.max(1, Math.round(Math.min(canvas.width, canvas.height) / 220));
  return applyMask(canvas, shapeMask(px, { smooth, ...options, tolerance }));
}

/** A region's mask, placed in a canvas covering `rect` (picture pixels), grown a little. */
function regionWithin(region: Region, scale: number, rect: Rect, width: number, height: number, grow = 0.02): Mask {
  const out = emptyMask(width, height);
  const box = { x: region.box.x / scale, y: region.box.y / scale, w: region.box.width / scale, h: region.box.height / scale };
  const sx = width / rect.width;
  const sy = height / rect.height;
  const x0 = Math.round((box.x - rect.x) * sx);
  const y0 = Math.round((box.y - rect.y) * sy);
  const mw = Math.max(1, Math.round(box.w * sx));
  const mh = Math.max(1, Math.round(box.h * sy));
  const m = resize(region.mask, mw, mh);
  for (let y = 0; y < mh; y++) {
    const ty = y + y0;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < mw; x++) {
      const tx = x + x0;
      if (tx >= 0 && tx < width && m.data[y * mw + x] === 1) out.data[ty * width + tx] = 1;
    }
  }
  return dilate(out, Math.max(1, Math.round(Math.min(width, height) * grow)));
}

const toPicture = (r: Rect, scale: number): Rect => ({
  x: r.x / scale,
  y: r.y / scale,
  width: r.width / scale,
  height: r.height / scale,
});

const pad = (r: Rect, by: number, limit: { width: number; height: number }): Rect => {
  const x = Math.max(0, r.x - by);
  const y = Math.max(0, r.y - by);
  return {
    x,
    y,
    width: Math.min(limit.width, r.x + r.width + by) - x,
    height: Math.min(limit.height, r.y + r.height + by) - y,
  };
};

/** Splits a sequence picture into its equal pieces, for the library. */
function slotsOf(art: Art, count: number): Art[] {
  const w = art.canvas.width / count;
  return Array.from({ length: count }, (_, i) => {
    const canvas = makeCanvas(w, art.canvas.height);
    canvas.getContext('2d')!.drawImage(art.canvas, i * w, 0, w, art.canvas.height, 0, 0, canvas.width, canvas.height);
    return { canvas, crisp: false };
  });
}

// ---------------------------------------------------------------- layers

/** One part of the rug, numbered as on a rug component map. */
export interface Component {
  key: string;
  /** 1 End finish … 13 Spandrel corner pockets. */
  number: number;
  name: string;
  found: boolean;
  /** Background color the shapes are cut from. */
  ground: string | null;
  /** How it repeats, in words. */
  repeat: string;
  /** Whether it becomes a layer; some parts are information only. */
  layer: boolean;
  shapes: LibraryShape[];
}

export interface LibraryShape {
  name: string;
  art: Art;
  /** Times it appears in the whole rug. */
  count: number;
}

const hex = (c: Oklab) => oklabToHex(c);

/** Size in inches the picture's rug stands for, and the scale that gives it. */
function measure(a: Analysed, size: { width: number; height: number }) {
  const { analysis: an, scale } = a;
  const m = an.margin;
  const rugW = (an.width - m.left - m.right) / scale;
  const rugH = (an.height - m.top - m.bottom) / scale;
  // One scale both ways, so nothing in the picture is distorted.
  const perInch = Math.sqrt((rugW / size.width) * (rugH / size.height));
  return { perInch, baseWidth: rugW / perInch, baseHeight: rugH / perInch };
}

function runWords(run: RunInfo | null, where: string): string {
  if (!run || !run.unit) return `${where}: no clear repeat, mirrored halves`;
  if (run.symmetric) {
    return `${where}: middle piece and ${run.slots} different motifs each side, mirrored`;
  }
  return `${where}: one unit slid along, about ${run.count}×`;
}

interface BandLayer {
  segment: Segment;
  shapes: LibraryShape[];
}

function bandLayer(a: Analysed, band: BandInfo, role: ComponentRole, name: string, perInch: number): BandLayer {
  const { image, scale, analysis: an } = a;
  const W = an.width / scale;
  const H = an.height / scale;
  const avg = (e: BandEdge) => depthOf(e) / scale;
  const margin = avg(an.margin);
  const inset = (avg(band.outer) - margin) / perInch;
  const thickness = (avg(band.inner) - avg(band.outer)) / perInch;
  const ground = hex(band.ground);
  const base: Segment = {
    id: newSegmentId(),
    name,
    role,
    color: ground,
    art: null,
    cornerArt: null,
    sideArt: null,
    centerArt: null,
    sideCenterArt: null,
    overflow: 'stretch',
    placement: { type: 'border', inset, thickness, sides: 'all', corner: 'plain' },
    x: makeRule(thickness),
    y: makeRule(thickness),
  };
  if (band.kind === 'plain') return { segment: base, shapes: [] };

  const o = { left: band.outer.left / scale, top: band.outer.top / scale };
  const i = { left: band.inner.left / scale, top: band.inner.top / scale, right: band.inner.right / scale, bottom: band.inner.bottom / scale };
  const cutBand = (canvas: HTMLCanvasElement) => cut(canvas, { background: [band.ground], reach: 'edge', keep: 'all' });
  // The top run, between the corner squares, and the left one read upwards.
  const top: Rect = { x: i.left, y: o.top, width: W - i.left - i.right, height: i.top - o.top };
  const left: Rect = { x: o.left, y: i.top, width: i.left - o.left, height: H - i.top - i.bottom };
  const shapes: LibraryShape[] = [];

  /** Artwork and rule for one run of the band. */
  const runArt = (run: RunInfo | null, rect: Rect, turn: Turn, label: string, count: number) => {
    const length = turn === 'left' ? rect.height : rect.width;
    // A piece of the run from `from` to `to` (distances along it, read the way
    // the layout draws it).
    const piece = (from: number, to: number) =>
      turn === 'left'
        ? grab(image, { x: rect.x, y: rect.y + rect.height - to, width: rect.width, height: to - from }, 'left')
        : grab(image, { x: rect.x + from, y: rect.y, width: to - from, height: rect.height });
    if (run?.unit && run.symmetric) {
      const unit = run.unit / scale;
      // The strip was read top to bottom for the sides; the layout reads up.
      const mid = length / 2 + (turn === 'left' ? -run.axis : run.axis) / scale;
      const center = cutBand(piece(mid - unit / 2, mid + unit / 2));
      const half = cutBand(piece(mid + unit / 2, mid + unit / 2 + run.slots * unit));
      shapes.push({ name: `${label}: middle`, art: center, count: 2 });
      slotsOf(half, run.slots).forEach((art, n) => shapes.push({ name: `${label}: motif ${n + 1}`, art, count: count * 2 }));
      const rule = makeRule(unit / perInch, {
        symmetric: true,
        center: unit / perInch,
        slots: run.slots,
        minStretch: 0.8,
        maxStretch: 1.25,
      });
      return { art: half, center, rule };
    }
    if (run?.unit) {
      const unit = run.unit / scale;
      const from = length / 2 - unit / 2;
      const art = cutBand(piece(from, from + unit));
      shapes.push({ name: `${label}: repeat`, art, count: run.count * count });
      return { art, center: null, rule: makeRule(unit / perInch, { minStretch: 0.8, maxStretch: 1.25 }) };
    }
    // Nothing clearly repeats: half the run, mirrored, gives the whole back.
    const art = cutBand(piece(0, length / 2));
    shapes.push({ name: `${label}: half`, art, count: count * 2 });
    return { art, center: null, rule: makeRule(length / 2 / perInch, { flip: true, minStretch: 0.75, maxStretch: 1.35 }) };
  };

  const ends = runArt(band.endRun, top, 'none', 'Ends', 2);
  const sides = runArt(band.sideRun, left, 'left', 'Sides', 2);
  const main = band.kind === 'main';
  let cornerArt: Art | null = null;
  if (main) {
    cornerArt = cutBand(grab(image, { x: o.left, y: o.top, width: i.left - o.left, height: i.top - o.top }));
    shapes.unshift({ name: 'Corner', art: cornerArt, count: 4 });
  }
  return {
    segment: {
      ...base,
      overflow: 'crop',
      art: ends.art,
      centerArt: ends.center,
      sideArt: sides.art,
      sideCenterArt: sides.center,
      cornerArt,
      // Guards slide round the corners; a main border turns with a corner piece.
      placement: { ...base.placement, type: 'border', corner: main ? 'piece' : 'mitre' } as Segment['placement'],
      x: ends.rule,
      y: sides.rule,
    },
    shapes,
  };
}

export interface Built {
  doc: SegmentDoc;
  components: Component[];
}

/**
 * Layers from an analysed picture, bottom first. `skip` lists component keys
 * to leave out.
 */
export function buildLayers(a: Analysed, size: { width: number; height: number }, skip: ReadonlySet<string> = new Set()): Built {
  const { image, scale, analysis: an } = a;
  const { perInch, baseWidth, baseHeight } = measure(a, size);
  const segments: Segment[] = [];
  const components: Component[] = [];
  const field = an.field;
  const fieldBox = toPicture(field.box, scale);
  const pictureSize = { width: image.width, height: image.height };

  components.push({
    key: 'end',
    number: 1,
    name: 'End finish',
    found: true,
    ground: null,
    repeat: 'Flat ends at top and bottom, where the fringe comes out. Drawn with the rug preview, not a layer.',
    layer: false,
    shapes: [],
  });

  // Border bands, outside in.
  let outerGuards = 0;
  let innerGuards = 0;
  let background = an.bands[0] ? hex(an.bands[0].ground) : hex(field.ground);
  an.bands.forEach((band, n) => {
    const key = `band-${n}`;
    let role: ComponentRole;
    let name: string;
    let number: number;
    if (band.kind === 'main') {
      role = 'mainBorder';
      name = 'Main border';
      number = 5;
    } else if (band.kind === 'plain' && band.position === 'outer') {
      role = 'edge';
      name = n === 0 ? 'Outer edge band' : 'Plain band';
      number = 2;
    } else if (band.position === 'outer') {
      role = 'outerGuard';
      outerGuards++;
      name = `Outer guard ${outerGuards}`;
      number = outerGuards === 1 ? 3 : 4;
    } else {
      role = 'innerGuard';
      innerGuards++;
      name = band.kind === 'plain' ? `Inner plain band ${innerGuards}` : `Inner guard ${innerGuards}`;
      number = innerGuards === 1 ? 7 : 8;
    }
    const built = bandLayer(a, band, role, name, perInch);
    if (n === 0) background = built.segment.color ?? background;
    const repeat =
      band.kind === 'plain'
        ? 'Plain color, no motif'
        : `${runWords(band.endRun, 'Ends')}. ${runWords(band.sideRun, 'Sides')}.`;
    const mainShapes = band.kind === 'main' ? built.shapes.filter((s) => s.name !== 'Corner') : built.shapes;
    components.push({ key, number, name, found: true, ground: built.segment.color, repeat, layer: true, shapes: mainShapes });
    if (band.kind === 'main') {
      const corner = built.shapes.find((s) => s.name === 'Corner');
      components.push({
        key: `${key}-corners`,
        number: 6,
        name: 'Border corners',
        found: corner !== undefined,
        ground: built.segment.color,
        repeat: 'One per corner, turned for each. Keeps its size: corners do not stretch.',
        layer: false,
        shapes: corner ? [corner] : [],
      });
    }
    if (!skip.has(key)) segments.push(built.segment);
  });

  // The field: ground with its small motifs, cut free of the big shapes.
  const quarter: Rect = field.quartered
    ? { x: fieldBox.x, y: fieldBox.y, width: fieldBox.width / 2, height: fieldBox.height / 2 }
    : fieldBox;
  const fieldCanvas = grab(image, quarter);
  const big = [field.spandrel, field.medallion, field.pendants?.top ?? null, field.pendants?.bottom ?? null]
    .filter((r): r is Region => r !== null)
    .map((r) => regionWithin(r, scale, quarter, fieldCanvas.width, fieldCanvas.height, 0.01));
  const notBig = big.length ? not(big.reduce((m, b) => ({ ...m, data: m.data.map((v, i) => v | b.data[i]!) }))) : undefined;
  const fieldArt = cut(fieldCanvas, {
    background: [field.ground],
    tolerance: field.tolerance,
    reach: 'anywhere',
    keep: 'all',
    minShare: 0.0002,
    within: notBig,
  });
  const fieldShapes: LibraryShape[] = field.motifs.map((m, n) => {
    const rect = pad(toPicture(m.box, scale), 4, pictureSize);
    const canvas = grab(image, rect);
    const art = cut(canvas, {
      background: [field.ground],
      tolerance: field.tolerance,
      reach: 'edge',
      keep: 'center',
      within: regionWithin(m, scale, rect, canvas.width, canvas.height),
    });
    return { name: `Ground motif ${n + 1}`, art, count: m.count };
  });
  const quarterRule = (length: number) =>
    field.quartered
      ? makeRule(length / 2 / perInch, { flip: true, minStretch: 0.75, maxStretch: 1.35 })
      : makeRule(length / perInch, { fit: 'single', minStretch: 0.6, maxStretch: 1.7 });
  components.push({
    key: 'field',
    number: 9,
    name: 'Field (ground)',
    found: true,
    ground: hex(field.ground),
    repeat: field.quartered
      ? 'Quartered mirror: one quarter, mirrored left/right and top/bottom. Not a sliding tile.'
      : 'One piece that stretches: the field does not mirror.',
    layer: true,
    shapes: fieldShapes,
  });
  if (!skip.has('field')) {
    segments.push({
      id: newSegmentId(),
      name: 'Field',
      role: 'field',
      color: hex(field.ground),
      art: fieldArt,
      cornerArt: null,
      sideArt: null,
      centerArt: null,
      sideCenterArt: null,
      placement: { type: 'fill', area: 'inside' },
      x: quarterRule(fieldBox.width),
      y: quarterRule(fieldBox.height),
      overflow: field.quartered ? 'crop' : 'stretch',
    });
  }

  const motif = (
    name: string,
    role: ComponentRole,
    art: Art,
    box: Rect,
    patch: Partial<Extract<Segment['placement'], { type: 'motif' }>>,
  ): Segment => {
    // Small rugs carry proportionally smaller medallions and spandrels.
    const rule = (length: number) => makeRule(length / perInch, { fit: 'single', minStretch: 0.3, maxStretch: 1.6 });
    return {
      id: newSegmentId(),
      name,
      role,
      color: null,
      art,
      cornerArt: null,
      sideArt: null,
      centerArt: null,
      sideCenterArt: null,
      placement: {
        type: 'motif',
        area: 'inside',
        anchor: 'center',
        offsetX: 0,
        offsetY: 0,
        keepShape: true,
        follow: null,
        edgeGap: 0,
        ...patch,
      },
      x: rule(box.width),
      y: rule(box.height),
      overflow: 'crop',
    };
  };
  const groundOf = (canvas: HTMLCanvasElement, mask: Mask) => {
    const px = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < mask.data.length; i++) if (mask.data[i] === 0) px.data[i * 4 + 3] = 0;
    return dominantColor(px, true);
  };

  // Spandrels, with their pockets.
  let spandrelId: string | null = null;
  if (field.spandrel) {
    const rect = toPicture(field.spandrel.box, scale);
    const canvas = grab(image, rect);
    const within = regionWithin(field.spandrel, scale, rect, canvas.width, canvas.height);
    const art = cut(canvas, { background: [field.ground], tolerance: field.tolerance, reach: 'edge', keep: { x: 2, y: 2 }, within });
    const segment = motif('Corner spandrels', 'spandrel', art, rect, { anchor: 'corners' });
    spandrelId = segment.id;
    components.push({
      key: 'spandrel',
      number: 12,
      name: 'Corner spandrels',
      found: true,
      ground: hex(field.spandrel.color),
      repeat: 'One per field corner, mirrored. Keeps its shape and grows with the field’s tighter side, like the medallion, so the octagon keeps its angles.',
      layer: true,
      shapes: [{ name: 'Spandrel', art, count: 4 }],
    });
    if (!skip.has('spandrel')) segments.push(segment);
  } else {
    components.push(missing('spandrel', 12, 'Corner spandrels', field.notes));
  }
  if (field.pocket) {
    const rect = toPicture(field.pocket.box, scale);
    const canvas = grab(image, rect);
    const within = regionWithin(field.pocket, scale, rect, canvas.width, canvas.height, 0.01);
    const spandrelColor = field.spandrel?.color ?? field.ground;
    const art = cut(canvas, { background: [spandrelColor], reach: 'edge', keep: 'all', within });
    const ground = groundOf(canvas, within);
    const segment = motif('Spandrel pockets', 'pocket', art, rect, {
      anchor: 'corners',
      follow: spandrelId,
      offsetX: (rect.x - fieldBox.x) / perInch,
      offsetY: (rect.y - fieldBox.y) / perInch,
    });
    components.push({
      key: 'pocket',
      number: 13,
      name: 'Spandrel corner pockets',
      found: true,
      ground: hex(ground),
      repeat: 'One in each spandrel’s outer corner. Takes the spandrel’s size and stays in its corner.',
      layer: true,
      shapes: [{ name: 'Pocket', art, count: 4 }],
    });
    if (!skip.has('pocket') && !(spandrelId && skip.has('spandrel'))) segments.push(segment);
  } else {
    components.push(missing('pocket', 13, 'Spandrel corner pockets', []));
  }

  // Medallion, then its pendants on top.
  let medallionId: string | null = null;
  let medallionRect: Rect | null = null;
  if (field.medallion) {
    const rect = pad(toPicture(field.medallion.box, scale), 6, pictureSize);
    const canvas = grab(image, rect);
    const within = regionWithin(field.medallion, scale, rect, canvas.width, canvas.height);
    const art = cut(canvas, { background: [field.ground], tolerance: field.tolerance, reach: 'edge', keep: 'center', within });
    medallionRect = rect;
    const center = { x: rect.x + rect.width / 2 - (fieldBox.x + fieldBox.width / 2), y: rect.y + rect.height / 2 - (fieldBox.y + fieldBox.height / 2) };
    // Sitting on the middle lines, give or take the hand of the weaver.
    const offset = (v: number, size: number) => (Math.abs(v) < size * 0.03 ? 0 : v / perInch);
    const segment = motif('Central medallion', 'medallion', art, rect, {
      anchor: 'center',
      offsetX: offset(center.x, fieldBox.width),
      offsetY: offset(center.y, fieldBox.height),
    });
    medallionId = segment.id;
    components.push({
      key: 'medallion',
      number: 10,
      name: 'Central medallion',
      found: true,
      ground: hex(groundOf(canvas, within)),
      repeat: 'One, fixed at the center. Never repeats; only grows or shrinks, keeping its shape, with the field’s tighter side.',
      layer: true,
      shapes: [{ name: 'Medallion', art, count: 1 }],
    });
    if (!skip.has('medallion')) segments.push(segment);
  } else {
    components.push(missing('medallion', 10, 'Central medallion', field.notes));
  }
  if (field.pendants) {
    const top = field.pendants.top;
    const rect = pad(toPicture(top.box, scale), 4, pictureSize);
    const canvas = grab(image, rect);
    const within = regionWithin(top, scale, rect, canvas.width, canvas.height);
    const art = cut(canvas, { background: [field.ground], tolerance: field.tolerance, reach: 'edge', keep: 'center', within });
    const hangs = medallionId !== null && !skip.has('medallion') && medallionRect !== null;
    const gap = medallionRect ? (medallionRect.y - (rect.y + rect.height)) / perInch : 0;
    const roomAbove = (rect.y - fieldBox.y) / perInch;
    const segment = motif('Pendants', 'pendant', art, rect, {
      anchor: 'axis',
      follow: hangs ? medallionId : null,
      offsetY: hangs ? gap : roomAbove,
      offsetX: 0,
      // Keep at least half the room it had from the border.
      edgeGap: Math.max(0, roomAbove * 0.5),
    });
    components.push({
      key: 'pendants',
      number: 11,
      name: 'Pendants',
      found: true,
      ground: hex(groundOf(canvas, within)),
      repeat: field.pendants.bottom
        ? 'Two, above and below the medallion; the lower one is the upper mirrored. They hang from the medallion’s tips, take its size, and keep clear of the border: they shrink, then drop out, when there is no room.'
        : 'One found on the middle line; drawn above and below, mirrored.',
      layer: true,
      shapes: [{ name: 'Pendant', art, count: 2 }],
    });
    if (!skip.has('pendants')) segments.push(segment);
  } else {
    components.push(missing('pendants', 11, 'Pendants', []));
  }

  components.sort((p, q) => p.number - q.number);
  // A smaller rug gets narrower borders, as a weaver would draw them.
  const borderScale = { min: 0.55, max: 1.2 };
  return { doc: { background, baseWidth, baseHeight, borderScale, segments }, components };
}

function missing(key: string, number: number, name: string, notes: string[]): Component {
  return { key, number, name, found: false, ground: null, repeat: notes.slice(1, 2).join(' ') || 'Not found in this picture.', layer: true, shapes: [] };
}
