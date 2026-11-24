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
  anchor: 'center' | 'corners' | 'edges';
  /** From the center, the nearest corner, or the nearest edge. */
  offsetX: number;
  offsetY: number;
  /** Scale both directions alike. */
  keepShape: boolean;
}

export type Placement = BorderPlacement | FillPlacement | MotifPlacement;

export interface Segment {
  id: string;
  name: string;
  /** Color behind the artwork; null to show what lies underneath. */
  color: string | null;
  art: Art | null;
  /** Corner artwork for a border, as it looks in the top-left corner. */
  cornerArt: Art | null;
  placement: Placement;
  /** Along the border, or across the rug. */
  x: AxisRule;
  /** Down the rug; unused by borders. */
  y: AxisRule;
  /** When the limits cannot be met. */
  overflow: 'crop' | 'stretch';
}

export interface SegmentDoc {
  background: string;
  /** Size the design was made for; motifs grow relative to it. */
  baseWidth: number;
  baseHeight: number;
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

/** How much of each side the borders take up. */
export function borderInsets(segments: readonly Segment[]): Insets {
  const out: Insets = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const { placement: p } of segments) {
    if (p.type !== 'border') continue;
    const depth = p.inset + p.thickness;
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
  const base = { id: newSegmentId(), art: null, cornerArt: null, overflow: 'crop' as const };
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
        placement: { type, area: 'inside', anchor: 'center', offsetX: 0, offsetY: 0, keepShape: true },
        x: rule,
        y: rule,
      };
    }
  }
}

/** Smallest rug the borders leave room on. */
export function minimumSize(doc: SegmentDoc): { width: number; height: number } {
  const b = borderInsets(doc.segments);
  return { width: Math.max(6, b.left + b.right + 2), height: Math.max(6, b.top + b.bottom + 2) };
}
