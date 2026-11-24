import type { Palette } from '../domain/clustering';
import type { GridSpec, Unit } from '../domain/dimensions';

/** Everything an exporter needs. */
export interface ExportInput {
  indices: Uint16Array;
  palette: Palette[];
  grid: GridSpec;
  unit: Unit;
}

export type Progress = (fraction: number) => void;

/** Heavier grid line after this many knots, as on screen. */
export const HEAVY_EVERY = 10;

/** Beyond this many cells a spreadsheet is too heavy to open. */
export const MAX_EXCEL_KNOTS = 5_000_000;
