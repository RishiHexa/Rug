import { useEffect, useRef, useState, type ReactNode } from 'react';
import { confirmAction } from '../components/ConfirmDialog';
import { drawGridLines } from '../components/knotGrid';
import { Button, Group, Heading, keepFocus, PanelBody, TwoZone } from '../components/ui';
import { Viewport, type Point, type Size, type View } from '../components/Viewport';
import { drawSource, type DrawDocument, type Rect } from '../design/drawDocument';
import { paintEllipse, paintLine, paintRect } from '../design/raster';
import type { GridSpec } from '../domain/dimensions';
import { gridSpec, useApp } from '../state/store';
import { DesignFooter } from './Step2Design';

type Tool = 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'pick';
type ShapeTool = 'line' | 'rect' | 'ellipse';

const TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: 'brush', label: 'Brush', icon: 'M5 19c0-3 1-4 3-4s3 1 3 2.5S9 20 5 19ZM10.5 14.5 19 4l1 1-8.5 11' },
  { tool: 'eraser', label: 'Eraser', icon: 'M9 20h11M5 15 14 6l5 5-8 9H9l-4-5Zm4-4 5 5' },
  { tool: 'line', label: 'Line', icon: 'M5 19 19 5' },
  { tool: 'rect', label: 'Rectangle', icon: 'M4 6h16v12H4z' },
  { tool: 'ellipse', label: 'Ellipse', icon: 'M12 6c5 0 8 2.7 8 6s-3 6-8 6-8-2.7-8-6 3-6 8-6Z' },
  { tool: 'fill', label: 'Bucket fill', icon: 'm11 4 8 8-7 7-7-7 7-7M5 12h14M20 16c1 1.5 1 3 0 3s-1-1.5 0-3Z' },
  { tool: 'pick', label: 'Eyedropper', icon: 'm14 6 4 4M13 7l1-1c1-1.5 3-2 4-1s.5 3-1 4l-1 1M14 9l-8 8-2 3 3-2 8-8' },
];

const isShape = (t: Tool): t is ShapeTool => t === 'line' || t === 'rect' || t === 'ellipse';

interface ShapeDrag {
  tool: ShapeTool;
  from: Point;
  to: Point;
}

export function DrawEditor() {
  const doc = useApp((s) => s.draft.draw)!;
  const invalidateDesign = useApp((s) => s.invalidateDesign);
  const [, setVersion] = useState(0);
  return (
    <DrawingBoard
      doc={doc}
      grid={gridSpec(useApp.getState())}
      title="Draw a design"
      onChange={() => {
        invalidateDesign();
        setVersion((v) => v + 1);
      }}
      footer={<DesignFooter source={doc.blank ? null : drawSource(doc)} />}
    />
  );
}

/** The raster editor, for a whole rug or the artwork of one segment. */
export function DrawingBoard({
  doc,
  grid,
  title,
  under = null,
  onChange,
  footer,
}: {
  doc: DrawDocument;
  grid: GridSpec;
  title: string;
  /** Color that shows through where nothing is painted. */
  under?: string | null;
  onChange(): void;
  footer: ReactNode;
}) {
  const perInch = doc.width / grid.widthIn;

  const [tool, setTool] = useState<Tool>('brush');
  const [brush, setBrush] = useState(() => Math.max(2, Math.round(Math.min(doc.width, doc.height) / 60)));
  const [color, setColor] = useState('#8c2f24');
  const [recent, setRecent] = useState<string[]>([]);
  const [filled, setFilled] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [cursorAt, setCursorAt] = useState<Point | null>(null);
  const [, setVersion] = useState(0);
  const redraw = () => setVersion((v) => v + 1);

  const stroke = useRef<{ last: Point; dirty: Rect } | null>(null);
  const shape = useRef<ShapeDrag | null>(null);

  const changed = () => {
    onChange();
    redraw();
  };
  const remember = () =>
    setRecent((r) => [color, ...r.filter((c) => c !== color)].slice(0, 8));

  const undo = () => {
    doc.undo();
    changed();
  };
  const redo = () => {
    doc.redo();
    changed();
  };
  const clear = async () => {
    if (!(await confirmAction('Clear the whole drawing?', 'Clear'))) return;
    doc.clear();
    changed();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      if (stroke.current || shape.current || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toPixel = (p: Point): Point => ({ x: p.x * perInch, y: p.y * perInch });

  const segment = (from: Point, to: Point) => {
    const erase = tool === 'eraser';
    doc.ctx.globalCompositeOperation = erase && !doc.paper ? 'destination-out' : 'source-over';
    doc.ctx.fillStyle = erase ? (doc.paper ?? '#000000') : color;
    paintLine(doc.ctx, from, to, brush);
    doc.ctx.globalCompositeOperation = 'source-over';
  };

  const onDown = (world: Point) => {
    const p = toPixel(world);
    if (tool === 'pick') {
      const picked = doc.colorAt(p.x, p.y);
      if (picked) setColor(picked);
    } else if (tool === 'fill') {
      doc.fill(p.x, p.y, color);
      remember();
      changed();
    } else if (isShape(tool)) {
      shape.current = { tool, from: p, to: p };
      paintShape(doc.ctx, shape.current, color, brush, filled);
      redraw();
    } else {
      stroke.current = { last: p, dirty: boundsOf(p, p, brush) };
      segment(p, p);
      redraw();
    }
  };

  const onMove = (points: Point[]) => {
    const last = points[points.length - 1]!;
    setCursorAt(last);
    if (shape.current) {
      doc.revert(boundsOf(shape.current.from, shape.current.to, brush));
      shape.current.to = toPixel(last);
      paintShape(doc.ctx, shape.current, color, brush, filled);
      redraw();
      return;
    }
    const s = stroke.current;
    if (!s) return;
    for (const world of points) {
      const p = toPixel(world);
      segment(s.last, p);
      s.dirty = union(s.dirty, boundsOf(s.last, p, brush));
      s.last = p;
    }
    redraw();
  };

  const onUp = () => {
    if (shape.current) {
      doc.commit(boundsOf(shape.current.from, shape.current.to, brush));
      shape.current = null;
      remember();
      changed();
    } else if (stroke.current) {
      doc.commit(stroke.current.dirty);
      stroke.current = null;
      if (tool === 'brush') remember();
      changed();
    }
  };

  const draw = (ctx: CanvasRenderingContext2D, view: View, size: Size) => {
    const w = grid.widthIn * view.scale;
    const h = grid.heightIn * view.scale;
    if (!doc.paper) {
      if (under) {
        ctx.fillStyle = under;
        ctx.fillRect(view.x, view.y, w, h);
      } else {
        drawChecks(ctx, size, view.x, view.y, w, h);
      }
    }
    ctx.imageSmoothingEnabled = w < doc.width;
    ctx.drawImage(doc.canvas, view.x, view.y, w, h);

    if (showGrid) drawGridLines(ctx, grid, view, size);
    ctx.strokeStyle = '#8d8678';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(view.x) - 0.5, Math.round(view.y) - 0.5, Math.round(w) + 1, Math.round(h) + 1);

    if (cursorAt && (tool === 'brush' || tool === 'eraser')) {
      const x = view.x + cursorAt.x * view.scale;
      const y = view.y + cursorAt.y * view.scale;
      const r = Math.max(1.5, (brush * view.scale) / perInch / 2);
      for (const [style, offset] of [['#ffffff', 0.5], ['#25221d', -0.5]] as const) {
        ctx.strokeStyle = style;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, r + offset), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  };

  const knotPx = grid.widthIn / grid.columns;
  const maxBrush = Math.max(20, Math.round(Math.min(doc.width, doc.height) / 4));

  return (
    <TwoZone
      canvas={
        <Viewport
          bounds={{ x: 0, y: 0, width: grid.widthIn, height: grid.heightIn }}
          padding={{ left: 32, top: 32, right: 32, bottom: 32 }}
          maxScale={48 / knotPx}
          label="Drawing canvas"
          cursor="crosshair"
          draw={draw}
          tool={{ onDown, onMove, onUp }}
          onHover={(h) => setCursorAt(h?.world ?? null)}
        />
      }
      panel={
        <>
          <PanelBody>
            <Heading title={title}>Scroll to zoom. Hold Space and drag to pan.</Heading>

            <Group title="Tool">
              <div className="grid grid-cols-4 gap-2">
                {TOOLS.map((t) => (
                  <button
                    key={t.tool}
                    type="button"
                    aria-label={t.label}
                    title={t.label}
                    aria-pressed={tool === t.tool}
                    onMouseDown={keepFocus}
                    onClick={() => setTool(t.tool)}
                    className="grid min-h-11 place-items-center rounded-md border border-line-strong hover:bg-paper aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-white"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d={t.icon} />
                    </svg>
                  </button>
                ))}
              </div>
              {(tool === 'rect' || tool === 'ellipse') && (
                <div role="group" aria-label="Shape style" className="mt-3 flex gap-4 text-sm">
                  {[true, false].map((value) => (
                    <label key={String(value)} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="shape-style"
                        checked={filled === value}
                        onChange={() => setFilled(value)}
                      />
                      {value ? 'Filled' : 'Outline'}
                    </label>
                  ))}
                </div>
              )}
              {tool !== 'fill' && tool !== 'pick' && !(isShape(tool) && tool !== 'line' && filled) && (
                <label className="mt-4 block text-sm">
                  <span className="flex justify-between">
                    <span>{isShape(tool) ? 'Line width' : 'Size'}</span>
                    <span>{brush} px</span>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={maxBrush}
                    value={brush}
                    onChange={(e) => setBrush(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </label>
              )}
            </Group>

            <Group title="Color">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label="Drawing color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-11 w-16 rounded border border-line-strong"
                />
                <span className="text-sm">{color}</span>
              </div>
              {recent.length > 0 && (
                <div role="group" aria-label="Recently used colors" className="mt-3 flex gap-1.5">
                  {recent.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Use ${c}`}
                      onMouseDown={keepFocus}
                      onClick={() => setColor(c)}
                      className="size-8 rounded border border-line-strong"
                      style={{ background: c }}
                    />
                  ))}
                </div>
              )}
            </Group>

            <Group title="Canvas">
              <div className="flex gap-2">
                <Button className="flex-1 px-2" disabled={!doc.canUndo} onMouseDown={keepFocus} onClick={undo}>
                  Undo
                </Button>
                <Button className="flex-1 px-2" disabled={!doc.canRedo} onMouseDown={keepFocus} onClick={redo}>
                  Redo
                </Button>
                <Button className="flex-1 px-2" disabled={doc.blank} onClick={() => void clear()}>
                  Clear
                </Button>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                Show knot grid when zoomed in
              </label>
            </Group>
          </PanelBody>
          {footer}
        </>
      }
    />
  );
}

/** Checkerboard that stands for "see-through". */
function drawChecks(
  ctx: CanvasRenderingContext2D,
  size: Size,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const step = 8;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e2ded6';
  const right = Math.min(x + w, size.width);
  const bottom = Math.min(y + h, size.height);
  for (let row = Math.max(0, Math.floor(-y / step)); y + row * step < bottom; row++) {
    for (let col = Math.max(0, Math.floor(-x / step)); x + col * step < right; col++) {
      if ((row + col) % 2 === 0) ctx.fillRect(x + col * step, y + row * step, step, step);
    }
  }
  ctx.restore();
}

function boundsOf(a: Point, b: Point, width: number): Rect {
  const pad = width / 2 + 2;
  const x = Math.min(a.x, b.x) - pad;
  const y = Math.min(a.y, b.y) - pad;
  return { x, y, width: Math.max(a.x, b.x) + pad - x, height: Math.max(a.y, b.y) + pad - y };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function paintShape(
  ctx: CanvasRenderingContext2D,
  { tool, from, to }: ShapeDrag,
  color: string,
  width: number,
  filled: boolean,
): void {
  ctx.fillStyle = color;
  const outline = filled ? null : width;
  if (tool === 'line') paintLine(ctx, from, to, width);
  else if (tool === 'rect') paintRect(ctx, from, to, outline);
  else paintEllipse(ctx, from, to, outline);
}
