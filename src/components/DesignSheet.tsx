import { useLayoutEffect, useRef, useState } from 'react';
import { formatCount, formatLength } from '../domain/dimensions';
import { gridSpec, useApp } from '../state/store';

/** Room for the dimension labels on the top and left edges. */
const EDGE = 76;
const MARGIN = 32;

/** The finished design at the rug's true proportions, dimensioned on two edges. */
export function DesignSheet() {
  const image = useApp((s) => s.design.image);
  const unit = useApp((s) => s.dimensions.unit);
  const grid = gridSpec(useApp.getState());
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const box = boxRef.current!;
    const measure = () => setSize({ width: box.clientWidth, height: box.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const scale = Math.max(
    0,
    Math.min(
      (size.width - EDGE - MARGIN) / grid.widthIn,
      (size.height - EDGE - MARGIN) / grid.heightIn,
    ),
  );
  const w = Math.round(grid.widthIn * scale);
  const h = Math.round(grid.heightIn * scale);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || w < 1 || h < 1) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }, [image, w, h]);

  const left = (size.width - w + EDGE - MARGIN) / 2;
  const top = (size.height - h + EDGE - MARGIN) / 2;

  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Design at the rug’s proportions"
        className="absolute bg-white outline outline-line-strong"
        style={{ left, top, width: w, height: h }}
      />
      <div className="absolute text-center text-sm" style={{ left, width: w, bottom: size.height - top + 14 }}>
        <p>
          <span className="font-semibold">{formatLength(grid.widthIn, unit)}</span>{' '}
          <span className="text-muted">{formatCount(grid.columns)} columns</span>
        </p>
        <div className="mt-1 h-2 border-x border-ink">
          <div className="h-1 border-b border-ink" />
        </div>
      </div>
      <div
        className="absolute flex items-center justify-end text-sm"
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
    </div>
  );
}
