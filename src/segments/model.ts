/** A rug made of segments, each with its own color, artwork and resize rules. */

/** Picture used by a segment. Transparent pixels show the segment's color. */
export interface Art {
  canvas: HTMLCanvasElement;
  /** Drawn art has hard edges that must stay hard when scaled. */
  crisp: boolean;
}

/** How a segment fills one direction. All lengths are inches. */
export interface AxisRule {
  fit: 'repeat' | 'single';
  /** Length of one piece at 100%. */
  piece: number;
  /** How far one piece may be squeezed or stretched; 1 is 100%. */
  minStretch: number;
  maxStretch: number;
  /** Space between pieces, and how far it may grow before another is added. */
  gap: number;
  maxGap: number;
  /** Below this much room the segment is left out; null for no limit. */
  minLength: number | null;
  /** The run never grows past this; null for no limit. */
  maxLength: number | null;
  /** Mirror every other piece. Pieces are then added in pairs. */
  flip: boolean;
  /**
   * Laid out from the middle: a middle piece, then pieces outwards, the far
   * half a mirror image of the near one. Pieces are added one each side.
   */
  symmetric: boolean;
  /** Length of the middle piece of a symmetric run at 100%; 0 for none. */
  center: number;
  /**
   * The artwork holds this many different pieces side by side, used in turn
   * (outwards from the middle when symmetric). 1 for a plain repeat.
   */
  slots: number;
}

export interface BorderPlacement {
  type: 'border';
  /** Distance from the rug's edge to the border's outer side. */
  inset: number;
  thickness: number;
  sides: 'all' | 'ends' | 'sides';
  /** What happens where two sides meet. */
  corner: 'mitre' | 'piece' | 'plain';
}

export interface FillPlacement {
  type: 'fill';
  /** Inside all borders, or the whole rug. */
  area: 'inside' | 'rug';
}

export interface MotifPlacement {
  type: 'motif';
  area: 'inside' | 'rug';
  /**
   * axis: above and below the motif it follows, on the middle line (a
   * medallion's pendants). Without one to follow it is like edges.
   */
  anchor: 'center' | 'corners' | 'edges' | 'axis';
  /**
   * From the center, the nearest corner, or the nearest edge; for axis, the
   * gap to the motif it follows (negative to overlap). At 100% size: offsets
   * grow and shrink with the motif.
   */
  offsetX: number;
  offsetY: number;
  /** Scale both directions alike. */
  keepShape: boolean;
  /** Id of a motif to take the size from, and for axis, the place. */
  follow: string | null;
  /** Least room left between the motif and the edge of its area. */
  edgeGap: number;
}

export type Placement = BorderPlacement | FillPlacement | MotifPlacement;

/** Which part of a rug a segment is, when it came from reading a picture. */
export type ComponentRole =
  | 'edge'
  | 'outerGuard'
  | 'mainBorder'
  | 'innerGuard'
  | 'field'
  | 'spandrel'
  | 'pocket'
  | 'medallion'
  | 'pendant';

export const ROLE_NAMES: Record<ComponentRole, string> = {
  edge: 'Outer edge band',
  outerGuard: 'Outer guard',
  mainBorder: 'Main border',
  innerGuard: 'Inner guard',
  field: 'Field',
  spandrel: 'Corner spandrels',
  pocket: 'Spandrel pockets',
  medallion: 'Central medallion',
  pendant: 'Pendants',
};

/** Artwork a segment can hold. */
export type ArtSlot = 'art' | 'cornerArt' | 'sideArt' | 'centerArt' | 'sideCenterArt';
export const ART_SLOTS: ArtSlot[] = ['art', 'cornerArt', 'sideArt', 'centerArt', 'sideCenterArt'];

export interface Segment {
  id: string;
  name: string;
  /** Color behind the artwork; null to show what lies underneath. */
  color: string | null;
  art: Art | null;
  /** Corner artwork for a border, as it looks in the top-left corner. */
  cornerArt: Art | null;
  /**
   * A border's own artwork for the left and right sides, drawn as on the left
   * side read from the bottom up, with the rug's edge at the top. Without it
   * the sides use `art`.
   */
  sideArt: Art | null;
  /** Middle piece of a symmetric run, on the ends and on the sides. */
  centerArt: Art | null;
  sideCenterArt: Art | null;
  /** Which part of the rug this is; null for one made by hand. */
  role: ComponentRole | null;
  placement: Placement;
  /** Along the border's ends, or across the rug. */
  x: AxisRule;
  /** Down the rug, or along a border's sides when it has its own side artwork. */
  y: AxisRule;
  /** When the limits cannot be met. */
  overflow: 'crop' | 'stretch';
}

export interface SegmentDoc {
  background: string;
  /** Size the design was made for; motifs grow relative to it. */
  baseWidth: number;
  baseHeight: number;
  /**
   * Borders grow and shrink with the rug's shorter side, within these limits
   * (1 is the size they were made at), all by the same amount so they stay
   * flush. Left out, borders keep their size.
   */
  borderScale?: { min: number; max: number };
  /** Bottom first. */
  segments: Segment[];
}

export function makeRule(piece: number, patch: Partial<AxisRule> = {}): AxisRule {
  return {
    fit: 'repeat',
    piece,
    minStretch: 0.85,
    maxStretch: 1.15,
    gap: 0,
    maxGap: 0,
    minLength: null,
    maxLength: null,
    flip: false,
    symmetric: false,
    center: 0,
    slots: 1,
    ...patch,
  };
}

let nextId = 0;
export const newSegmentId = () => `s${Date.now().toString(36)}${(nextId++).toString(36)}`;

export interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How much borders are scaled on a rug of this size: with the shorter side,
 * within the design's limits.
 */
export function borderFactor(doc: Pick<SegmentDoc, 'baseWidth' | 'baseHeight' | 'borderScale'>, width: number, height: number): number {
  const limits = doc.borderScale;
  if (!limits) return 1;
  const grown = Math.min(width, height) / Math.max(1e-9, Math.min(doc.baseWidth, doc.baseHeight));
  return Math.min(limits.max, Math.max(limits.min, grown));
}

/** How much of each side the borders take up, scaled by `factor`. */
export function borderInsets(segments: readonly Segment[], factor = 1): Insets {
  const out: Insets = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const { placement: p } of segments) {
    if (p.type !== 'border') continue;
    const depth = (p.inset + p.thickness) * factor;
    if (p.sides !== 'sides') {
      out.top = Math.max(out.top, depth);
      out.bottom = Math.max(out.bottom, depth);
    }
    if (p.sides !== 'ends') {
      out.left = Math.max(out.left, depth);
      out.right = Math.max(out.right, depth);
    }
  }
  return out;
}

export function newSegment(type: Placement['type'], doc: SegmentDoc): Segment {
  const inside = borderInsets(doc.segments);
  const count = doc.segments.filter((s) => s.placement.type === type).length + 1;
  const base = {
    id: newSegmentId(),
    art: null,
    cornerArt: null,
    sideArt: null,
    centerArt: null,
    sideCenterArt: null,
    role: null,
    overflow: 'crop' as const,
  };
  const short = Math.min(doc.baseWidth, doc.baseHeight);
  const unit = Math.max(1, Math.round(short / 18));
  switch (type) {
    case 'border':
      return {
        ...base,
        name: `Border ${count}`,
        color: '#2b4479',
        overflow: 'stretch',
        placement: { type, inset: Math.max(inside.left, inside.top), thickness: unit, sides: 'all', corner: 'mitre' },
        x: makeRule(unit),
        y: makeRule(unit),
      };
    case 'fill':
      return {
        ...base,
        name: `Fill ${count}`,
        color: '#8c2f24',
        placement: { type, area: 'inside' },
        x: makeRule(unit * 2, { gap: 0, maxGap: unit / 2 }),
        y: makeRule(unit * 2, { gap: 0, maxGap: unit / 2 }),
      };
    case 'motif': {
      const size = Math.max(2, Math.round(short / 4));
      const rule = makeRule(size, { fit: 'single', minStretch: 0.5, maxStretch: 1.5 });
      return {
        ...base,
        name: `Motif ${count}`,
        color: '#d9b36c',
        placement: {
          type,
          area: 'inside',
          anchor: 'center',
          offsetX: 0,
          offsetY: 0,
          keepShape: true,
          follow: null,
          edgeGap: 0,
        },
        x: rule,
        y: rule,
      };
    }
  }
}

/** Smallest rug the borders leave room on, at their smallest. */
export function minimumSize(doc: SegmentDoc): { width: number; height: number } {
  const b = borderInsets(doc.segments, doc.borderScale?.min ?? 1);
  return { width: Math.max(6, b.left + b.right + 2), height: Math.max(6, b.top + b.bottom + 2) };
}

/** Fills in what designs saved before a field existed leave out. */
export function upgradeSegment(s: Partial<Segment> & Pick<Segment, 'id' | 'placement' | 'x' | 'y'>): Segment {
  const rule = (r: AxisRule): AxisRule => ({ ...makeRule(r.piece), ...r });
  const p = s.placement;
  return {
    name: 'Segment',
    color: null,
    art: null,
    cornerArt: null,
    sideArt: null,
    centerArt: null,
    sideCenterArt: null,
    role: null,
    overflow: 'crop',
    ...s,
    placement: p.type === 'motif' ? ({ follow: null, edgeGap: 0, ...(p as Partial<MotifPlacement>) } as MotifPlacement) : p,
    x: rule(s.x),
    y: rule(s.y),
  };
}

/** The motif a segment follows, if it is there and is a motif. */
export function followed(doc: SegmentDoc, segment: Segment): Segment | null {
  const p = segment.placement;
  if (p.type !== 'motif' || !p.follow) return null;
  const leader = doc.segments.find((s) => s.id === p.follow);
  return leader && leader.placement.type === 'motif' && leader.id !== segment.id ? leader : null;
}
