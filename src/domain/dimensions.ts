/**
 * All rug-dimension math. Pure: no React, no store, no DOM.
 * Lengths are stored in inches and densities in knots per inch; every other
 * value (knot size, KPSI, grid, actual size) is derived from those four.
 */

export type Unit = 'in' | 'ftin' | 'cm';

export interface DimensionValues {
  widthIn: number;
  heightIn: number;
  /** Knots per inch across the width. */
  warp: number;
  /** Knot rows per inch along the length. */
  weft: number;
}

export type DimensionField =
  | 'width'
  | 'height'
  | 'warp'
  | 'weft'
  | 'knotWidth'
  | 'knotHeight'
  | 'kpsi';

export interface DerivedDimensions {
  knotWidthIn: number;
  knotHeightIn: number;
  knotWidthMm: number;
  knotHeightMm: number;
  kpsi: number;
  columns: number;
  rows: number;
  totalKnots: number;
  actualWidthIn: number;
  actualHeightIn: number;
  widthRounded: boolean;
  heightRounded: boolean;
}

/** The frozen grid plus its physical size; what later steps work against. */
export interface GridSpec {
  columns: number;
  rows: number;
  /** Physical size after rounding to whole knots. */
  widthIn: number;
  heightIn: number;
}

export const MM_PER_IN = 25.4;
export const CM_PER_IN = 2.54;
export const IN_PER_FT = 12;

/** Technical ceiling for a browser canvas, see DECISIONS.md. */
export const MAX_GRID_SIDE = 16384;
export const MAX_TOTAL_KNOTS = 25_000_000;

/** Differences smaller than this are invisible at the precision we display. */
const ROUNDING_EPSILON_IN = 0.005;

export const inToCm = (v: number) => v * CM_PER_IN;
export const cmToIn = (v: number) => v / CM_PER_IN;
export const inToMm = (v: number) => v * MM_PER_IN;
export const mmToIn = (v: number) => v / MM_PER_IN;
export const ftInToIn = (ft: number, inches: number) => ft * IN_PER_FT + inches;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Splits inches into feet + inches, carrying when the inches round up to 12. */
export function inToFtIn(total: number): { ft: number; inches: number } {
  let ft = Math.floor(total / IN_PER_FT);
  let inches = round2(total - ft * IN_PER_FT);
  if (inches >= IN_PER_FT) {
    ft += 1;
    inches = 0;
  }
  return { ft, inches };
}

export const isPositive = (v: number) => Number.isFinite(v) && v > 0;

/**
 * Applies one user edit and returns the new canonical values.
 * `value` is inches for width/height, mm for knot size, per-inch for densities.
 */
export function applyEdit(
  current: DimensionValues,
  field: DimensionField,
  value: number,
): DimensionValues {
  if (!isPositive(value)) throw new RangeError(`${field} must be a positive number`);
  switch (field) {
    case 'width':
      return { ...current, widthIn: value };
    case 'height':
      return { ...current, heightIn: value };
    case 'warp':
      return { ...current, warp: value };
    case 'weft':
      return { ...current, weft: value };
    case 'knotWidth':
      return { ...current, warp: 1 / mmToIn(value) };
    case 'knotHeight':
      return { ...current, weft: 1 / mmToIn(value) };
    case 'kpsi': {
      const scale = Math.sqrt(value / (current.warp * current.weft));
      return { ...current, warp: current.warp * scale, weft: current.weft * scale };
    }
  }
}

/** Input fields whose displayed value is recomputed when `field` is edited. */
export const RECOMPUTES: Record<DimensionField, readonly DimensionField[]> = {
  width: [],
  height: [],
  warp: ['knotWidth', 'kpsi'],
  weft: ['knotHeight', 'kpsi'],
  knotWidth: ['warp', 'kpsi'],
  knotHeight: ['weft', 'kpsi'],
  kpsi: ['warp', 'weft', 'knotWidth', 'knotHeight'],
};

export function derive(v: DimensionValues): DerivedDimensions {
  const knotWidthIn = 1 / v.warp;
  const knotHeightIn = 1 / v.weft;
  const columns = Math.round(v.widthIn * v.warp);
  const rows = Math.round(v.heightIn * v.weft);
  const actualWidthIn = columns * knotWidthIn;
  const actualHeightIn = rows * knotHeightIn;
  return {
    knotWidthIn,
    knotHeightIn,
    knotWidthMm: inToMm(knotWidthIn),
    knotHeightMm: inToMm(knotHeightIn),
    kpsi: v.warp * v.weft,
    columns,
    rows,
    totalKnots: columns * rows,
    actualWidthIn,
    actualHeightIn,
    widthRounded: Math.abs(actualWidthIn - v.widthIn) >= ROUNDING_EPSILON_IN,
    heightRounded: Math.abs(actualHeightIn - v.heightIn) >= ROUNDING_EPSILON_IN,
  };
}

export function gridSpecOf(v: DimensionValues): GridSpec {
  const d = derive(v);
  return { columns: d.columns, rows: d.rows, widthIn: d.actualWidthIn, heightIn: d.actualHeightIn };
}

/** Hard problems that stop the grid from being locked. */
export function gridProblem(d: DerivedDimensions): string | null {
  if (d.columns < 1 || d.rows < 1) return 'The rug is smaller than a single knot.';
  if (d.columns > MAX_GRID_SIDE || d.rows > MAX_GRID_SIDE || d.totalKnots > MAX_TOTAL_KNOTS) {
    return `This grid is too large for the browser (limit: ${formatCount(MAX_TOTAL_KNOTS)} knots, ${formatCount(MAX_GRID_SIDE)} per side).`;
  }
  return null;
}

export type WarningField = 'width' | 'height' | 'warp' | 'weft';

/** Soft warnings: unusual values that are still allowed. */
export function softWarnings(v: DimensionValues): Partial<Record<WarningField, string>> {
  const out: Partial<Record<WarningField, string>> = {};
  const maxIn = 30 * IN_PER_FT;
  if (v.widthIn > maxIn) out.width = 'Over 30 ft is unusual for a rug.';
  if (v.heightIn > maxIn) out.height = 'Over 30 ft is unusual for a rug.';
  if (v.warp < 3 || v.warp > 30) out.warp = 'Outside the usual 3–30 knots per inch.';
  if (v.weft < 3 || v.weft > 30) out.weft = 'Outside the usual 3–30 rows per inch.';
  return out;
}

/** Up to `digits` decimals, trailing zeros removed. */
export function formatNumber(v: number, digits = 2): string {
  return String(Number(v.toFixed(digits)));
}

export function formatLength(inches: number, unit: Unit): string {
  switch (unit) {
    case 'in':
      return `${formatNumber(inches)} in`;
    case 'cm':
      return `${formatNumber(inToCm(inches))} cm`;
    case 'ftin': {
      const { ft, inches: rest } = inToFtIn(inches);
      return rest === 0 ? `${ft} ft` : `${ft} ft ${formatNumber(rest)} in`;
    }
  }
}

/** Integer with thousands separators. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}
