import { useLayoutEffect, useRef } from 'react';
import { formatCount, formatLength } from '../domain/dimensions';
import { gridSpec, useApp } from '../state/store';
import { fitView, prepareCanvas, useBoxSize, usePanGesture, useZoomPan, ZoomControls } from './Viewport';

/** Room for the dimension labels on the top and left edges. */
const EDGE = 76;
const MARGIN = 32;
const PADDING = { left: EDGE, top: EDGE, right: MARGIN, bottom: MARGIN };

/**
 * The finished design at the rug's true proportions, dimensioned on two edges.
 * Wheel, pinch and the zoom buttons zoom in as far as single knots; dragging pans.
 */
export function DesignSheet() {
  const image = useApp((s) => s.design.image);
  const unit = useApp((s) => s.dimensions.unit);
  const grid = gridSpec(useApp.getState());
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useBoxSize(boxRef);

  const fit = size && fitView({ x: 0, y: 0, width: grid.widthIn, height: grid.heightIn }, PADDING, size);
  const knotsPerInch = Math.max(grid.columns / grid.widthIn, grid.rows / grid.heightIn);
  const zp = useZoomPan(boxRef, fit, size, 48 * knotsPerInch);
  const pan = usePanGesture(zp);
  const view = zp.view;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size || !view) return;
    const ctx = prepareCanvas(canvas, size);
    const w = grid.widthIn * view.scale;
    const h = grid.heightIn * view.scale;
    ctx.fillStyle = '#fff';
    ctx.fillRect(view.x, view.y, w, h);
    if (image) {
      // Close up, show each knot as a crisp block rather than a blur.
      const pixel = w / image.width;
      ctx.imageSmoothingEnabled = pixel < 2;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, view.x, view.y, w, h);
    }
    ctx.strokeStyle = '#8d8678';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(view.x) - 0.5, Math.round(view.y) - 0.5, Math.round(w) + 1, Math.round(h) + 1);
  });

  const left = view?.x ?? 0;
  const top = view?.y ?? 0;
  const w = view ? grid.widthIn * view.scale : 0;
  const h = view ? grid.heightIn * view.scale : 0;

  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label="Design at the rug’s proportions. Arrow keys pan, plus and minus zoom, 0 fits."
        style={{ cursor: pan.panning ? 'grabbing' : 'grab' }}
        className="block h-full w-full touch-none focus-visible:-outline-offset-2"
        onKeyDown={zp.onKeyDown}
        {...pan.handlers}
      />
      {view && size && (
        <>
          <div
            className="pointer-events-none absolute text-center text-sm"
            style={{ left, width: w, bottom: size.height - top + 14 }}
          >
            <p>
              <span className="font-semibold">{formatLength(grid.widthIn, unit)}</span>{' '}
              <span className="text-muted">{formatCount(grid.columns)} columns</span>
            </p>
            <div className="mt-1 h-2 border-x border-ink">
              <div className="h-1 border-b border-ink" />
            </div>
          </div>
          <div
            className="pointer-events-none absolute flex items-center justify-end text-sm"
            style={{ top, height: h, right: size.width - left + 14 }}
          >
            <p className="rotate-180 text-center whitespace-nowrap [writing-mode:vertical-rl]">
              <span className="font-semibold">{formatLength(grid.heightIn, unit)}</span>{' '}
              <span className="text-muted">{formatCount(grid.rows)} rows</span>
            </p>
            <div className="ml-1 h-full w-2 border-y border-ink">
              <div className="h-full w-1 border-r border-ink" />
            </div>
          </div>
        </>
      )}
      <ZoomControls zoomPan={zp} />
    </div>
  );
}
