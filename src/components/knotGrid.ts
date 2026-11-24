import type { GridSpec } from '../domain/dimensions';
import type { Size, View } from './Viewport';

export const RULER_LEFT = 44;
export const RULER_TOP = 24;

/** Grid lines appear once a knot is at least this many CSS pixels. */
const GRID_MIN_CELL = 6;
const HEAVY_EVERY = 10;
const LABEL_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

interface Axis {
  cell: number;
  origin: number;
  /** First and one-past-last visible knot. */
  from: number;
  to: number;
}

function axis(count: number, cell: number, origin: number, extent: number): Axis {
  return {
    cell,
    origin,
    from: Math.max(0, Math.floor(-origin / cell)),
    to: Math.min(count, Math.ceil((extent - origin) / cell)),
  };
}

function axes(grid: GridSpec, view: View, size: Size) {
  return {
    col: axis(grid.columns, (grid.widthIn / grid.columns) * view.scale, view.x, size.width),
    row: axis(grid.rows, (grid.heightIn / grid.rows) * view.scale, view.y, size.height),
  };
}

/** Knot boundaries with a heavier line every 10, as on a naksha. */
export function drawGridLines(
  ctx: CanvasRenderingContext2D,
  grid: GridSpec,
  view: View,
  size: Size,
): void {
  const { col, row } = axes(grid, view, size);
  if (Math.min(col.cell, row.cell) < GRID_MIN_CELL || col.to <= col.from || row.to <= row.from) return;

  const x0 = col.origin + col.from * col.cell;
  const x1 = col.origin + col.to * col.cell;
  const y0 = row.origin + row.from * row.cell;
  const y1 = row.origin + row.to * row.cell;

  for (const heavy of [false, true]) {
    ctx.beginPath();
    for (let c = col.from; c <= col.to; c++) {
      if ((c % HEAVY_EVERY === 0) !== heavy) continue;
      const x = Math.round(col.origin + c * col.cell) + 0.5;
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let r = row.from; r <= row.to; r++) {
      if ((r % HEAVY_EVERY === 0) !== heavy) continue;
      const y = Math.round(row.origin + r * row.cell) + 0.5;
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    // A light halo under the dark line keeps it readable on any yarn color.
    if (heavy) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }
    ctx.strokeStyle = heavy ? 'rgba(20,18,15,0.85)' : 'rgba(128,123,115,0.55)';
    ctx.lineWidth = heavy ? 1.75 : 1;
    ctx.stroke();
  }
}

/** Column numbers along the top edge and row numbers along the left edge. */
export function drawRulers(
  ctx: CanvasRenderingContext2D,
  grid: GridSpec,
  view: View,
  size: Size,
): void {
  const { col, row } = axes(grid, view, size);
  ctx.fillStyle = '#fcfaf6';
  ctx.fillRect(0, 0, size.width, RULER_TOP);
  ctx.fillRect(0, 0, RULER_LEFT, size.height);
  ctx.strokeStyle = '#dcd6ca';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_TOP - 0.5);
  ctx.lineTo(size.width, RULER_TOP - 0.5);
  ctx.moveTo(RULER_LEFT - 0.5, 0);
  ctx.lineTo(RULER_LEFT - 0.5, size.height);
  ctx.stroke();

  ctx.fillStyle = '#625c51';
  ctx.font = '12px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'center';
  eachLabel(col, 44, (n, at) => {
    if (at > RULER_LEFT + 12) ctx.fillText(String(n), at, RULER_TOP / 2);
  });
  ctx.textAlign = 'right';
  eachLabel(row, 22, (n, at) => {
    if (at > RULER_TOP + 6) ctx.fillText(String(n), RULER_LEFT - 8, at);
  });
}

/** Visits the numbers to print: multiples of a step that fits, plus knot 1. */
function eachLabel(a: Axis, minGap: number, visit: (n: number, at: number) => void): void {
  const step = LABEL_STEPS.find((s) => s * a.cell >= minGap) ?? 10_000;
  const centre = (n: number) => a.origin + (n - 0.5) * a.cell;
  if (a.from === 0 && step > 1 && (step - 1) * a.cell >= minGap * 0.6) visit(1, centre(1));
  for (let n = Math.ceil((a.from + 1) / step) * step; n <= a.to; n += step) visit(n, centre(n));
}
