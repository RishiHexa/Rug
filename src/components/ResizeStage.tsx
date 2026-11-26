import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { CM_PER_IN, formatLength, type Unit } from '../domain/dimensions';
import { prepareCanvas, useBoxSize, usePanGesture, useZoomPan, ZoomControls } from './Viewport';

export interface RugSize {
  width: number;
  height: number;
}

interface View {
  /** Pixels per inch, and the rug's top-left corner. */
  scale: number;
  x: number;
  y: number;
}

/** Which sides a handle moves: -1 left or top, 1 right or bottom. */
interface Handle {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  label: string;
}

const HANDLES: Handle[] = [
  { dx: 0, dy: -1, label: 'top edge' },
  { dx: 1, dy: 0, label: 'right edge' },
  { dx: 0, dy: 1, label: 'bottom edge' },
  { dx: -1, dy: 0, label: 'left edge' },
  { dx: -1, dy: -1, label: 'top-left corner' },
  { dx: 1, dy: -1, label: 'top-right corner' },
  { dx: 1, dy: 1, label: 'bottom-right corner' },
  { dx: -1, dy: 1, label: 'bottom-left corner' },
];

const CURSORS: Record<string, string> = {
  '0-1': 'ns-resize',
  '01': 'ns-resize',
  '10': 'ew-resize',
  '-10': 'ew-resize',
  '-1-1': 'nwse-resize',
  '11': 'nwse-resize',
  '1-1': 'nesw-resize',
  '-11': 'nesw-resize',
};

/** Share of the stage the rug takes, leaving room to drag it bigger. */
const FILL = 0.74;

/**
 * A rug that is resized by dragging its edges and corners. Wheel, pinch and
 * the zoom buttons zoom; dragging the background pans.
 */
export function ResizeStage({
  size,
  unit,
  keepShape = false,
  maxScale = 200,
  limit,
  onResize,
  onResizeEnd,
  paint,
}: {
  size: RugSize;
  unit: Unit;
  keepShape?: boolean;
  /** Most pixels per inch when zoomed in. */
  maxScale?: number;
  /** Brings a size within what is possible. */
  limit(size: RugSize): RugSize;
  onResize(size: RugSize): void;
  /** A drag, or a key press, has finished at this size. */
  onResizeEnd?(size: RugSize): void;
  /** Draws the rug with its corner at `x`, `y`, at `scale` pixels per inch. */
  paint(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, size: RugSize): void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const box = useBoxSize(boxRef);
  /** While dragging, the view stays put and the opposite side stays in place. */
  const [drag, setDrag] = useState<{ handle: Handle; from: RugSize; view: View; px: number; py: number } | null>(null);

  const fitted = (b: RugSize): View => {
    const scale = Math.min((b.width * FILL) / size.width, (b.height * FILL) / size.height);
    return { scale, x: (b.width - size.width * scale) / 2, y: (b.height - size.height * scale) / 2 };
  };
  const zp = useZoomPan(boxRef, box && fitted(box), box, maxScale);
  const pan = usePanGesture(zp);
  const dragView = (d: NonNullable<typeof drag>, now: RugSize): View => ({
    scale: d.view.scale,
    x: d.view.x + (d.handle.dx < 0 ? (d.from.width - now.width) * d.view.scale : 0),
    y: d.view.y + (d.handle.dy < 0 ? (d.from.height - now.height) * d.view.scale : 0),
  });
  const view: View | null = drag ? dragView(drag, size) : zp.view;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box || !view) return;
    const ctx = prepareCanvas(canvas, box);
    ctx.save();
    paint(ctx, view.x, view.y, view.scale, size);
    ctx.restore();
    ctx.strokeStyle = '#8d8678';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(view.x) - 0.5,
      Math.round(view.y) - 0.5,
      Math.round(size.width * view.scale) + 1,
      Math.round(size.height * view.scale) + 1,
    );
  });

  const step = unit === 'cm' ? 1 / CM_PER_IN : 1;
  const resized = (handle: Handle, from: RugSize, dw: number, dh: number): RugSize => {
    let width = from.width + dw;
    let height = from.height + dh;
    if (keepShape) {
      const growth =
        handle.dx === 0
          ? height / from.height
          : handle.dy === 0
            ? width / from.width
            : Math.max(width / from.width, height / from.height);
      width = from.width * growth;
      height = from.height * growth;
    }
    // Whole inches or centimeters for whatever actually changed.
    const round = (v: number, was: number) => (Math.abs(v - was) < step / 2 ? was : Math.round(v / step) * step);
    return limit({ width: round(width, from.width), height: round(height, from.height) });
  };

  const start = (handle: Handle) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !view) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ handle, from: size, view, px: e.clientX, py: e.clientY });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const { handle, from, view: v } = drag;
    const dw = ((e.clientX - drag.px) / v.scale) * handle.dx;
    const dh = ((e.clientY - drag.py) / v.scale) * handle.dy;
    onResize(resized(handle, from, dw, dh));
  };
  const end = () => {
    if (!drag) return;
    // A zoomed view keeps the rug where the drag left it; a fitted one refits.
    if (zp.zoomed) zp.setView(dragView(drag, size));
    onResizeEnd?.(size);
    setDrag(null);
  };

  const onKeyDown = (handle: Handle) => (e: React.KeyboardEvent) => {
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = by[e.key];
    if (!d) return;
    e.preventDefault();
    const dw = d[0] * handle.dx * step;
    const dh = d[1] * handle.dy * step;
    if (dw !== 0 || dh !== 0) {
      const next = resized(handle, size, dw, dh);
      onResize(next);
      onResizeEnd?.(next);
    }
  };

  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label="Rug. Arrow keys pan, plus and minus zoom, 0 fits."
        style={{ cursor: pan.panning ? 'grabbing' : 'grab' }}
        className="block h-full w-full touch-none focus-visible:-outline-offset-2"
        onKeyDown={zp.onKeyDown}
        {...pan.handlers}
      />
      {view && (
        <>
          <p
            className="pointer-events-none absolute -translate-x-1/2 text-sm font-semibold whitespace-nowrap"
            style={{ left: view.x + (size.width * view.scale) / 2, top: view.y - 34 }}
          >
            {formatLength(size.width, unit)}
          </p>
          <p
            className="pointer-events-none absolute -translate-y-1/2 rotate-180 text-sm font-semibold whitespace-nowrap [writing-mode:vertical-rl]"
            style={{ left: view.x - 36, top: view.y + (size.height * view.scale) / 2 }}
          >
            {formatLength(size.height, unit)}
          </p>
          {HANDLES.map((handle) => (
            <button
              key={handle.label}
              type="button"
              aria-label={`Drag the ${handle.label} to resize. Arrow keys also work.`}
              onPointerDown={start(handle)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onKeyDown={onKeyDown(handle)}
              className="group absolute grid size-8 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center"
              style={{
                left: view.x + ((handle.dx + 1) / 2) * size.width * view.scale,
                top: view.y + ((handle.dy + 1) / 2) * size.height * view.scale,
                cursor: CURSORS[`${handle.dx}${handle.dy}`],
              }}
            >
              <span
                className={`block rounded-sm border-2 border-panel bg-accent shadow-sm group-hover:bg-accent-hover ${
                  handle.dx === 0 ? 'h-3 w-8' : handle.dy === 0 ? 'h-8 w-3' : 'size-4'
                }`}
              />
            </button>
          ))}
        </>
      )}
      <ZoomControls zoomPan={zp} />
    </div>
  );
}
