import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { keepFocus } from './ui';

/** Screen = world × scale + offset. World units are inches of rug. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ToolHandlers {
  onDown(world: Point): void;
  onMove(world: Point[]): void;
  onUp(): void;
}

interface Props {
  /** The area "Fit" shows, in world units. */
  bounds: WorldRect;
  /** Space reserved around the fitted area, e.g. for rulers. */
  padding: { left: number; top: number; right: number; bottom: number };
  maxScale: number;
  label: string;
  cursor?: string;
  /** Called with the context already scaled to CSS pixels. */
  draw(ctx: CanvasRenderingContext2D, view: View, size: Size): void;
  /** When set, the primary button drives the tool and Space + drag pans. */
  tool?: ToolHandlers;
  onHover?(hover: { world: Point; screen: Point } | null): void;
  children?: ReactNode;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Zoomable, pannable canvas. Wheel or pinch zooms, drag (or Space + drag, or
 * the middle button) pans, and the keyboard works when the canvas has focus.
 */
export function Viewport({
  bounds,
  padding,
  maxScale,
  label,
  cursor = 'grab',
  draw,
  tool,
  onHover,
  children,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  /** null = fitted, and stays fitted while the window resizes. */
  const [custom, setCustom] = useState<View | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<'none' | 'tool' | 'pan' | 'pinch'>('none');

  useLayoutEffect(() => {
    const box = boxRef.current!;
    const measure = () => setSize({ width: box.clientWidth, height: box.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const fit = size && fitView(bounds, padding, size);
  const view = custom ?? fit;
  const minScale = fit ? fit.scale * 0.5 : 0;
  const topScale = Math.max(maxScale, fit ? fit.scale * 4 : 0);

  // Event handlers outlive renders, so they read the current view from a ref.
  const viewRef = useRef(view);
  viewRef.current = view;

  const apply = useCallback((next: View) => {
    viewRef.current = next;
    setCustom(next);
  }, []);

  const zoomAt = useCallback(
    (factor: number, at: Point) => {
      const v = viewRef.current;
      if (!v) return;
      const scale = clamp(v.scale * factor, minScale, topScale);
      const k = scale / v.scale;
      apply({ scale, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k });
    },
    [apply, minScale, topScale],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = viewRef.current;
      if (v) apply({ ...v, x: v.x + dx, y: v.y + dy });
    },
    [apply],
  );

  const zoomCentre = (factor: number) => {
    if (size) zoomAt(factor, { x: size.width / 2, y: size.height / 2 });
  };
  const toFit = () => setCustom(null);

  // React attaches wheel listeners as passive, which would let the page scroll.
  useEffect(() => {
    const box = boxRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      zoomAt(Math.exp(-e.deltaY * lines * speed), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (e.code !== 'Space' || (active !== document.body && active !== canvasRef.current)) return;
      e.preventDefault();
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    const reset = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size || !view) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(size.width * dpr));
    const h = Math.max(1, Math.round(size.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    draw(ctx, view, size);
  });

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p: Point): Point => {
    const v = viewRef.current!;
    return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!viewRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2) {
      if (gesture.current === 'tool') tool?.onUp();
      gesture.current = 'pinch';
    } else if (tool && !spaceHeld && e.button === 0) {
      gesture.current = 'tool';
      tool.onDown(toWorld(local(e)));
    } else if (e.button <= 1) {
      gesture.current = 'pan';
      setPanning(true);
      onHover?.(null);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    const last = pointers.current.get(e.pointerId);
    if (!last) {
      if (viewRef.current) onHover?.({ world: toWorld(p), screen: p });
      return;
    }
    if (gesture.current === 'pan') panBy(p.x - last.x, p.y - last.y);
    else if (gesture.current === 'tool') {
      const native = e.nativeEvent;
      const events = native.getCoalescedEvents?.() ?? [];
      tool?.onMove((events.length ? events : [native]).map((ev) => toWorld(local(ev))));
    } else if (gesture.current === 'pinch') {
      const other = [...pointers.current].find(([id]) => id !== e.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(last.x - other.x, last.y - other.y);
        const after = Math.hypot(p.x - other.x, p.y - other.y);
        panBy((p.x - last.x) / 2, (p.y - last.y) / 2);
        if (before > 0) zoomAt(after / before, { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 });
      }
    }
    pointers.current.set(e.pointerId, p);
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (gesture.current === 'tool') tool?.onUp();
    gesture.current = 'none';
    setPanning(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 60;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => panBy(step, 0),
      ArrowRight: () => panBy(-step, 0),
      ArrowUp: () => panBy(0, step),
      ArrowDown: () => panBy(0, -step),
      '+': () => zoomCentre(1.4),
      '=': () => zoomCentre(1.4),
      '-': () => zoomCentre(1 / 1.4),
      '0': toFit,
    };
    const action = actions[e.key];
    if (!action || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    action();
  };

  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={`${label}. Arrow keys pan, plus and minus zoom, 0 fits.`}
        style={{ cursor: panning ? 'grabbing' : spaceHeld ? 'grab' : cursor }}
        className="block h-full w-full touch-none focus-visible:-outline-offset-2"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={() => onHover?.(null)}
        onKeyDown={onKeyDown}
      />
      {children}
      <div className="absolute right-4 bottom-4 flex overflow-hidden rounded-md border border-line-strong bg-panel">
        <ZoomButton label="Zoom out" text="−" onClick={() => zoomCentre(1 / 1.4)} />
        <ZoomButton label="Zoom in" text="+" onClick={() => zoomCentre(1.4)} />
        <ZoomButton label="Fit to view" text="Fit" onClick={toFit} />
      </div>
    </div>
  );
}

function ZoomButton({ label, text, onClick }: { label: string; text: string; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onMouseDown={keepFocus}
      onClick={onClick}
      className="min-h-10 min-w-10 border-line px-3 text-sm font-medium not-first:border-l hover:bg-paper focus-visible:-outline-offset-2"
    >
      {text}
    </button>
  );
}

function fitView(bounds: WorldRect, padding: Props['padding'], size: Size): View {
  const w = Math.max(1, size.width - padding.left - padding.right);
  const h = Math.max(1, size.height - padding.top - padding.bottom);
  const scale = Math.min(w / bounds.width, h / bounds.height);
  return {
    scale,
    x: padding.left + (w - bounds.width * scale) / 2 - bounds.x * scale,
    y: padding.top + (h - bounds.height * scale) / 2 - bounds.y * scale,
  };
}
