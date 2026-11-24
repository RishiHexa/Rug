import { useMemo, useState } from 'react';
import { confirmAction } from '../components/ConfirmDialog';
import { ResizeStage, type RugSize } from '../components/ResizeStage';
import { Button, Group, Heading, Notice, PanelBody, PanelFooter, TwoZone } from '../components/ui';
import { DrawDocument } from '../design/drawDocument';
import { formatLength, type GridSpec } from '../domain/dimensions';
import { paintLayout, segmentSource } from '../segments/compose';
import { layoutRug, type RugLayout } from '../segments/layout';
import { minimumSize, newSegment, type Art, type Placement, type Segment, type SegmentDoc } from '../segments/model';
import { gridSpec, useApp } from '../state/store';
import { DrawingBoard } from './DrawEditor';
import { ArtThumb, SplitPicture, TakeFromPicture, type Picture } from './PictureTools';
import { SegmentForm, type ArtSlot } from './SegmentForm';
import { DesignFooter } from './Step2Design';

type Mode =
  | { view: 'rug' }
  | { view: 'split' }
  | { view: 'picture'; id: string; slot: ArtSlot }
  | { view: 'draw'; id: string; slot: ArtSlot; doc: DrawDocument; grid: GridSpec };

const MAX_TEST_SIDE = 480;

/** Size of a segment's artwork on the rug, in inches. */
function artSize(segment: Segment, slot: ArtSlot): { width: number; height: number } {
  const p = segment.placement;
  if (p.type !== 'border') return { width: segment.x.piece, height: segment.y.piece };
  return { width: slot === 'cornerArt' ? p.thickness : segment.x.piece, height: p.thickness };
}

/** New artwork keeps its own proportions, so piece lengths follow it. */
function withArt(segment: Segment, slot: ArtSlot, art: Art): Segment {
  const next = { ...segment, [slot]: art };
  // A motif is its artwork; the stand-in color would show as a box around it.
  if (segment.placement.type === 'motif' && !segment.art) next.color = null;
  if (slot === 'cornerArt' || art.crisp) return next;
  const aspect = art.canvas.width / art.canvas.height;
  const p = segment.placement;
  if (p.type === 'border') next.x = { ...segment.x, piece: p.thickness * aspect };
  else next.y = { ...segment.y, piece: segment.x.piece / aspect };
  return next;
}

/** Builds a rug out of segments that know how to resize. */
export function SegmentBuilder() {
  const doc = useApp((s) => s.draft.segments)!;
  const unit = useApp((s) => s.dimensions.unit);
  const { setDraft, invalidateDesign } = useApp.getState();
  const grid = useMemo(() => gridSpec(useApp.getState()), []);
  const rugSize: RugSize = useMemo(() => ({ width: grid.widthIn, height: grid.heightIn }), [grid]);

  const [mode, setMode] = useState<Mode>({ view: 'rug' });
  const [selectedId, setSelectedId] = useState<string | null>(doc.segments.at(-1)?.id ?? null);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [size, setSize] = useState(rugSize);
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
      <SplitPicture
        picture={picture}
        onPicture={setPicture}
        size={{ baseWidth: rugSize.width, baseHeight: rugSize.height }}
        replaces={doc.segments.length}
        onCancel={back}
        onDone={(next) => {
          update(next);
          setSelectedId(next.segments[0]?.id ?? null);
          setSize(rugSize);
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

  const testing = size.width !== rugSize.width || size.height !== rugSize.height;
  const smallest = minimumSize(doc);

  return (
    <TwoZone
      canvas={
        <>
          <ResizeStage
            size={size}
            unit={unit}
            onResize={setSize}
            limit={(s) => ({
              width: Math.min(MAX_TEST_SIDE, Math.max(smallest.width, s.width)),
              height: Math.min(MAX_TEST_SIDE, Math.max(smallest.height, s.height)),
            })}
            paint={(ctx, x, y, scale) => {
              paintLayout(ctx, doc, layout, x, y, scale, scale);
              if (selectedIndex >= 0) outline(ctx, layout, selectedIndex, x, y, scale);
            }}
          />
          <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded-md border border-line-strong bg-panel px-3 py-1.5 text-sm">
            {testing ? (
              <>
                <span>
                  Testing {formatLength(size.width, unit)} × {formatLength(size.height, unit)}
                </span>
                <Button variant="quiet" onClick={() => setSize(rugSize)}>
                  Back to rug size
                </Button>
              </>
            ) : (
              <span className="text-muted">Drag the handles to test the rules. The rug size stays the same.</span>
            )}
          </div>
        </>
      }
      panel={
        <>
          <PanelBody>
            <Heading title="Build from segments">
              Each segment has its own color, artwork and rules for resizing.
            </Heading>
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
                Split a rug picture
              </Button>
            </Group>

            <Group title="Segments, top first">
              {doc.segments.length === 0 && (
                <p className="text-sm text-muted">None yet. Add one, or split a picture of a rug.</p>
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
                        <span className="truncate font-medium">{s.name}</span>
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
