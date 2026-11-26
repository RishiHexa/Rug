import { useMemo, useState } from 'react';
import { confirmAction } from '../components/ConfirmDialog';
import { ResizeStage, type RugSize } from '../components/ResizeStage';
import { Button, Group, Heading, Notice, PanelBody, PanelFooter, TwoZone } from '../components/ui';
import { DrawDocument } from '../design/drawDocument';
import { CheckField, LengthField, PercentField, Row } from '../components/fields';
import { formatLength, gridSpecOf, MAX_GRID_SIDE, MAX_TOTAL_KNOTS, type GridSpec } from '../domain/dimensions';
import { paintLayout, segmentSource } from '../segments/compose';
import { layoutRug, type RugLayout } from '../segments/layout';
import {
  minimumSize,
  newSegment,
  ROLE_NAMES,
  type Art,
  type ArtSlot,
  type Placement,
  type Segment,
  type SegmentDoc,
} from '../segments/model';
import { useApp } from '../state/store';
import { AnalysePicture } from './AnalysePicture';
import { DrawingBoard } from './DrawEditor';
import { ArtThumb, TakeFromPicture, type Picture } from './PictureTools';
import { SegmentForm } from './SegmentForm';
import { DesignFooter } from './Step2Design';

type Mode =
  | { view: 'rug' }
  | { view: 'split' }
  | { view: 'picture'; id: string; slot: ArtSlot }
  | { view: 'draw'; id: string; slot: ArtSlot; doc: DrawDocument; grid: GridSpec };

/** Size of a segment's artwork on the rug, in inches. */
function artSize(segment: Segment, slot: ArtSlot): { width: number; height: number } {
  const p = segment.placement;
  if (p.type !== 'border') return { width: segment.x.piece, height: segment.y.piece };
  const along: Record<ArtSlot, number> = {
    art: segment.x.piece * segment.x.slots,
    sideArt: segment.y.piece * segment.y.slots,
    centerArt: segment.x.center || segment.x.piece,
    sideCenterArt: segment.y.center || segment.y.piece,
    cornerArt: p.thickness,
  };
  return { width: along[slot], height: p.thickness };
}

/** New artwork keeps its own proportions, so piece lengths follow it. */
function withArt(segment: Segment, slot: ArtSlot, art: Art): Segment {
  const next = { ...segment, [slot]: art };
  // A motif is its artwork; the stand-in color would show as a box around it.
  if (segment.placement.type === 'motif' && !segment.art) next.color = null;
  if (slot === 'cornerArt' || art.crisp) return next;
  const aspect = art.canvas.width / art.canvas.height;
  const p = segment.placement;
  if (p.type !== 'border') {
    if (slot === 'art') next.y = { ...segment.y, piece: segment.x.piece / aspect };
    return next;
  }
  const length = p.thickness * aspect;
  if (slot === 'art') next.x = { ...segment.x, piece: length / segment.x.slots };
  if (slot === 'sideArt') next.y = { ...segment.y, piece: length / segment.y.slots };
  if (slot === 'centerArt') next.x = { ...segment.x, center: length };
  if (slot === 'sideCenterArt') next.y = { ...segment.y, center: length };
  return next;
}

/** Builds a rug out of segments that know how to resize. */
export function SegmentBuilder() {
  const doc = useApp((s) => s.draft.segments)!;
  const dims = useApp((s) => s.dimensions);
  const unit = dims.unit;
  const { setDraft, invalidateDesign, resizeRug } = useApp.getState();
  const grid = useMemo(() => gridSpecOf(dims), [dims]);
  const rugSize: RugSize = useMemo(() => ({ width: dims.widthIn, height: dims.heightIn }), [dims]);

  const [mode, setMode] = useState<Mode>({ view: 'rug' });
  const [selectedId, setSelectedId] = useState<string | null>(doc.segments.at(-1)?.id ?? null);
  const [picture, setPicture] = useState<Picture | null>(null);
  /** The size while a handle is being dragged; the rug's own size otherwise. */
  const [dragSize, setDragSize] = useState<RugSize | null>(null);
  const size = dragSize ?? rugSize;
  const [, setDrawVersion] = useState(0);

  const update = (next: SegmentDoc) => {
    invalidateDesign();
    setDraft({ segments: next });
  };
  const updateSegment = (id: string, change: (s: Segment) => Segment) =>
    update({ ...doc, segments: doc.segments.map((s) => (s.id === id ? change(s) : s)) });

  const selectedIndex = doc.segments.findIndex((s) => s.id === selectedId);
  const layout = useMemo(() => layoutRug(doc, size.width, size.height, { x: 0, y: 0 }), [doc, size]);

  const add = (type: Placement['type']) => {
    const segment = newSegment(type, doc);
    // Borders and fills go under motifs, so a new one does not hide them.
    const firstMotif = doc.segments.findIndex((s) => s.placement.type === 'motif');
    const at = type === 'motif' || firstMotif < 0 ? doc.segments.length : firstMotif;
    update({ ...doc, segments: [...doc.segments.slice(0, at), segment, ...doc.segments.slice(at)] });
    setSelectedId(segment.id);
  };
  const remove = async (s: Segment) => {
    if (!(await confirmAction(`Delete “${s.name}”?`, 'Delete'))) return;
    update({ ...doc, segments: doc.segments.filter((o) => o.id !== s.id) });
  };
  const move = (index: number, by: 1 | -1) => {
    const segments = doc.segments.slice();
    const [s] = segments.splice(index, 1);
    segments.splice(index + by, 0, s!);
    update({ ...doc, segments });
  };

  const startDrawing = (segment: Segment, slot: ArtSlot) => {
    const s = artSize(segment, slot);
    const perX = grid.columns / grid.widthIn;
    const perY = grid.rows / grid.heightIn;
    // One pixel per knot, like drawing a whole rug.
    const perInch = Math.min(Math.max(perX, perY), 2000 / Math.max(s.width, s.height));
    const board = new DrawDocument(
      { width: Math.max(4, Math.round(s.width * perInch)), height: Math.max(4, Math.round(s.height * perInch)) },
      null,
    );
    const existing = segment[slot];
    if (existing) board.load(existing.canvas);
    const artGrid: GridSpec = {
      columns: Math.max(1, Math.round(s.width * perX)),
      rows: Math.max(1, Math.round(s.height * perY)),
      widthIn: s.width,
      heightIn: s.height,
    };
    setMode({ view: 'draw', id: segment.id, slot, doc: board, grid: artGrid });
  };

  const back = () => setMode({ view: 'rug' });

  if (mode.view === 'split') {
    return (
      <AnalysePicture
        picture={picture}
        onPicture={setPicture}
        size={{ width: grid.widthIn, height: grid.heightIn }}
        replaces={doc.segments.length}
        onCancel={back}
        onDone={(next) => {
          update(next);
          setSelectedId(null);
          back();
        }}
      />
    );
  }
  if (mode.view === 'picture') {
    const target = doc.segments.find((s) => s.id === mode.id);
    return (
      <TakeFromPicture
        title={`${target?.name ?? 'Segment'}: ${mode.slot === 'cornerArt' ? 'corner from a picture' : 'artwork from a picture'}`}
        picture={picture}
        onPicture={setPicture}
        onCancel={back}
        onTake={(art) => {
          updateSegment(mode.id, (s) => withArt(s, mode.slot, art));
          back();
        }}
      />
    );
  }
  if (mode.view === 'draw') {
    const target = doc.segments.find((s) => s.id === mode.id);
    return (
      <DrawingBoard
        doc={mode.doc}
        grid={mode.grid}
        title={`Draw: ${target?.name ?? 'segment'}`}
        under={target?.color ?? null}
        onChange={() => setDrawVersion((v) => v + 1)}
        footer={
          <PanelFooter>
            <Button
              variant="primary"
              disabled={mode.doc.blank}
              onClick={() => {
                updateSegment(mode.id, (s) => withArt(s, mode.slot, { canvas: mode.doc.canvas, crisp: true }));
                back();
              }}
            >
              Use this drawing
            </Button>
            <Button onClick={back}>Cancel</Button>
          </PanelFooter>
        }
      />
    );
  }

  const smallest = minimumSize(doc);
  /** Within what the borders need and what a knot map can hold. */
  const limit = (s: RugSize): RugSize => {
    const width = Math.min(MAX_GRID_SIDE / dims.warp, Math.max(smallest.width, s.width));
    const height = Math.min(MAX_GRID_SIDE / dims.weft, Math.max(smallest.height, s.height));
    const most = (MAX_TOTAL_KNOTS * 0.995) / (dims.warp * dims.weft);
    if (width * height <= most) return { width, height };
    return width > size.width ? { width: most / height, height } : { width, height: most / width };
  };
  const commit = (s: RugSize) => {
    setDragSize(null);
    resizeRug(s.width, s.height);
  };

  return (
    <TwoZone
      canvas={
        <>
          <ResizeStage
            size={size}
            unit={unit}
            onResize={setDragSize}
            onResizeEnd={commit}
            limit={limit}
            maxScale={48 * Math.max(dims.warp, dims.weft)}
            paint={(ctx, x, y, scale) => {
              paintLayout(ctx, doc, layout, x, y, scale, scale);
              if (selectedIndex >= 0) outline(ctx, layout, selectedIndex, x, y, scale);
            }}
          />
          <div className="absolute bottom-4 left-4 max-w-[calc(100%-12rem)] rounded-md border border-line-strong bg-panel px-3 py-1.5 text-sm text-muted">
            {dragSize
              ? `${formatLength(dragSize.width, unit)} × ${formatLength(dragSize.height, unit)}`
              : 'Drag the handles to size the rug. Every layer follows its rules, and step 1 keeps the new size.'}
          </div>
        </>
      }
      panel={
        <>
          <PanelBody>
            <Heading title="Build from segments">
              Each segment has its own color, artwork and rules for resizing.
            </Heading>
            <Row>
              <LengthField
                label="Rug width"
                value={rugSize.width}
                unit={unit}
                min={1}
                onChange={(width) => commit(limit({ ...rugSize, width }))}
              />
              <LengthField
                label="Rug length"
                value={rugSize.height}
                unit={unit}
                min={1}
                onChange={(height) => commit(limit({ ...rugSize, height }))}
              />
            </Row>
            <div className="flex items-center gap-3 text-sm">
              <input
                type="color"
                aria-label="Rug background color"
                value={doc.background}
                onChange={(e) => update({ ...doc, background: e.target.value })}
                className="h-9 w-12 rounded border border-line-strong"
              />
              Rug background
            </div>
            <div className="space-y-3">
              <CheckField
                label="Borders grow and shrink with the rug"
                checked={doc.borderScale !== undefined}
                onChange={(on) => update({ ...doc, borderScale: on ? { min: 0.55, max: 1.2 } : undefined })}
              />
              {doc.borderScale && (
                <Row>
                  <PercentField
                    label="Narrowest"
                    value={doc.borderScale.min}
                    min={0.1}
                    max={doc.borderScale.max}
                    onChange={(min) => update({ ...doc, borderScale: { ...doc.borderScale!, min } })}
                  />
                  <PercentField
                    label="Widest"
                    value={doc.borderScale.max}
                    min={doc.borderScale.min}
                    max={5}
                    onChange={(max) => update({ ...doc, borderScale: { ...doc.borderScale!, max } })}
                  />
                </Row>
              )}
            </div>

            <Group title="Add">
              <div className="grid grid-cols-3 gap-2">
                <Button className="px-2" onClick={() => add('border')}>
                  Border
                </Button>
                <Button className="px-2" onClick={() => add('fill')}>
                  Fill
                </Button>
                <Button className="px-2" onClick={() => add('motif')}>
                  Motif
                </Button>
              </div>
              <Button className="mt-2 w-full" onClick={() => setMode({ view: 'split' })}>
                Read a rug picture
              </Button>
            </Group>

            <Group title="Layers, top first">
              {doc.segments.length === 0 && (
                <p className="text-sm text-muted">None yet. Add one, or read a picture of a rug.</p>
              )}
              <ul className="divide-y divide-line">
                {doc.segments
                  .map((s, i) => ({ s, i }))
                  .reverse()
                  .map(({ s, i }) => (
                    <li key={s.id}>
                      <div
                        className={`flex items-center gap-2 px-1 py-1.5 ${s.id === selectedId ? 'bg-accent-soft' : ''}`}
                      >
                      <button
                        type="button"
                        aria-expanded={s.id === selectedId}
                        onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
                        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left text-sm"
                      >
                        {s.art ? (
                          <ArtThumb art={s.art} under={s.color} className="size-8 shrink-0" />
                        ) : (
                          <span
                            className="size-8 shrink-0 rounded border border-line-strong"
                            style={{ background: s.color ?? 'transparent' }}
                          />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{s.name}</span>
                          {s.role && !s.name.startsWith(ROLE_NAMES[s.role]) && (
                            <span className="block truncate text-xs text-muted">{ROLE_NAMES[s.role]}</span>
                          )}
                        </span>
                      </button>
                      <IconButton label={`Move ${s.name} up`} disabled={i === doc.segments.length - 1} path="M6 10l4-4 4 4M10 6v9" onClick={() => move(i, 1)} />
                      <IconButton label={`Move ${s.name} down`} disabled={i === 0} path="M6 11l4 4 4-4M10 15V6" onClick={() => move(i, -1)} />
                      <IconButton label={`Delete ${s.name}`} path="M6 6l8 8M14 6l-8 8" onClick={() => void remove(s)} />
                      </div>
                      {s.id === selectedId && (
                        <div className="border-l-2 border-accent py-4 pr-1 pl-3">
                          <SegmentForm
                            segment={s}
                            report={layout.reports[i]}
                            unit={unit}
                            doc={doc}
                            onChange={(patch) => updateSegment(s.id, (o) => ({ ...o, ...patch }))}
                            onDraw={(slot) => startDrawing(s, slot)}
                            onPicture={(slot) => setMode({ view: 'picture', id: s.id, slot })}
                          />
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </Group>

            {layout.reports.flatMap((r, i) => {
              const states = [r.x?.state, r.y?.state];
              const name = doc.segments[i]?.name ?? 'A layer';
              const text = states.includes('hidden')
                ? `${name} is left out at this size: too little room.`
                : states.includes('crowded')
                  ? `${name} is at its smallest and runs into another motif.`
                  : states.includes('forced')
                    ? `${name} is stretched past its limits.`
                    : null;
              return text ? [<Notice key={text} tone="warn">{text}</Notice>] : [];
            })}
            {(rugSize.width < smallest.width || rugSize.height < smallest.height) && (
              <Notice tone="warn">The borders are too thick for this rug. Some parts are left out.</Notice>
            )}
          </PanelBody>
          <DesignFooter source={doc.segments.length > 0 ? segmentSource(doc, grid) : null} />
        </>
      }
    />
  );
}

/** Shows the pieces of the selected segment. */
function outline(
  ctx: CanvasRenderingContext2D,
  layout: RugLayout,
  index: number,
  x: number,
  y: number,
  scale: number,
): void {
  ctx.save();
  ctx.transform(scale, 0, 0, scale, x, y);
  ctx.lineWidth = 1.25 / scale;
  for (const op of layout.ops) {
    if (op.segment !== index) continue;
    ctx.save();
    ctx.transform(...op.matrix);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeRect(op.box.x, op.box.y, op.box.width, op.box.height);
    ctx.setLineDash([4 / scale, 4 / scale]);
    ctx.strokeStyle = '#2b4479';
    ctx.strokeRect(op.box.x, op.box.y, op.box.width, op.box.height);
    ctx.restore();
  }
  ctx.restore();
}

function IconButton({
  label,
  path,
  disabled,
  onClick,
}: {
  label: string;
  path: string;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded hover:bg-well disabled:opacity-30"
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={path} />
      </svg>
    </button>
  );
}
