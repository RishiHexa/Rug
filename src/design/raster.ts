/**
 * Hard-edged drawing. Canvas paths are anti-aliased, and the blended edge
 * pixels would turn into stray yarn colors in the knot map, so shapes are
 * painted as rows of whole pixels instead.
 */

interface P {
  x: number;
  y: number;
}

/** Paints one pixel row between two edges; pixels count by their centre. */
function span(ctx: CanvasRenderingContext2D, y: number, left: number, right: number): void {
  const x0 = Math.ceil(left - 0.5);
  const x1 = Math.floor(right - 0.5);
  if (x1 >= x0) ctx.fillRect(x0, y, x1 - x0 + 1, 1);
}

/** Thick line with round ends; a dot when both ends coincide. */
export function paintLine(ctx: CanvasRenderingContext2D, a: P, b: P, width: number): void {
  // Anything thinner can slip between pixel centres and leave gaps.
  const r = Math.max(0.75, width / 2);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const nx = length ? (-dy / length) * r : 0;
  const ny = length ? (dx / length) * r : 0;
  const corners: P[] = [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
  const first = Math.max(0, Math.floor(Math.min(a.y, b.y) - r));
  const last = Math.min(ctx.canvas.height - 1, Math.ceil(Math.max(a.y, b.y) + r));
  for (let y = first; y <= last; y++) {
    const cy = y + 0.5;
    let left = Infinity;
    let right = -Infinity;
    for (const end of [a, b]) {
      const h = r * r - (cy - end.y) ** 2;
      if (h < 0) continue;
      left = Math.min(left, end.x - Math.sqrt(h));
      right = Math.max(right, end.x + Math.sqrt(h));
    }
    for (let i = 0; i < 4; i++) {
      const p = corners[i]!;
      const q = corners[(i + 1) % 4]!;
      if (p.y === q.y || cy < Math.min(p.y, q.y) || cy > Math.max(p.y, q.y)) continue;
      const x = p.x + ((cy - p.y) / (q.y - p.y)) * (q.x - p.x);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
    span(ctx, y, left, right);
  }
}

/** Rectangle between two corners; `outline` is a line width, or null to fill. */
export function paintRect(ctx: CanvasRenderingContext2D, a: P, b: P, outline: number | null): void {
  const grow = outline === null ? 0 : outline / 2;
  const x0 = Math.round(Math.min(a.x, b.x) - grow);
  const y0 = Math.round(Math.min(a.y, b.y) - grow);
  const x1 = Math.max(x0 + 1, Math.round(Math.max(a.x, b.x) + grow));
  const y1 = Math.max(y0 + 1, Math.round(Math.max(a.y, b.y) + grow));
  const t = outline ?? Infinity;
  if (t * 2 >= Math.min(x1 - x0, y1 - y0)) {
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    return;
  }
  ctx.fillRect(x0, y0, x1 - x0, t);
  ctx.fillRect(x0, y1 - t, x1 - x0, t);
  ctx.fillRect(x0, y0 + t, t, y1 - y0 - 2 * t);
  ctx.fillRect(x1 - t, y0 + t, t, y1 - y0 - 2 * t);
}

/** Ellipse inside two corners; `outline` is a line width, or null to fill. */
export function paintEllipse(ctx: CanvasRenderingContext2D, a: P, b: P, outline: number | null): void {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  const grow = outline === null ? 0 : Math.max(0.75, outline / 2);
  const outerX = Math.max(0.75, rx + grow);
  const outerY = Math.max(0.75, ry + grow);
  const innerX = outline === null ? 0 : rx - grow;
  const innerY = outline === null ? 0 : ry - grow;

  const first = Math.max(0, Math.floor(cy - outerY));
  const last = Math.min(ctx.canvas.height - 1, Math.ceil(cy + outerY));
  for (let y = first; y <= last; y++) {
    const dy = y + 0.5 - cy;
    const o = 1 - (dy / outerY) ** 2;
    if (o < 0) continue;
    const out = outerX * Math.sqrt(o);
    const i = innerX > 0 && innerY > 0 ? 1 - (dy / innerY) ** 2 : -1;
    if (i <= 0) {
      span(ctx, y, cx - out, cx + out);
    } else {
      const inn = innerX * Math.sqrt(i);
      span(ctx, y, cx - out, cx - inn);
      span(ctx, y, cx + inn, cx + out);
    }
  }
}
