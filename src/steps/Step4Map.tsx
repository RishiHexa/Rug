import { useEffect, useMemo, useRef, useState } from 'react';
import { confirmAction } from '../components/ConfirmDialog';
import { ExportButtons, type ExportOption } from '../components/ExportButtons';
import { drawGridLines, drawRulers, RULER_LEFT, RULER_TOP } from '../components/knotGrid';
import { Button, Heading, Notice, PanelBody, PanelFooter, ProgressBar, TwoZone } from '../components/ui';
import { Viewport, type Point, type Size, type View } from '../components/Viewport';
import type { ClusterSettings } from '../domain/clustering';
import { hexToRgb } from '../domain/color';
import { formatCount } from '../domain/dimensions';
import { colorId, percent } from '../domain/format';
import { MAX_EXCEL_KNOTS } from '../export/types';
import { generateMap } from '../state/mapJob';
import { gridSpec, hasColorEdits, useApp, type KnotMap } from '../state/store';

const DEBOUNCE_MS = 350;

export function Step4Map() {
  const map = useApp((s) => s.map);
  const job = useApp((s) => s.job);
  const goTo = useApp((s) => s.goTo);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const s = useApp.getState();
    if (!s.map && s.job.status === 'idle') void generateMap();
  }, []);

  // A new map has new clusters, so an old selection means nothing.
  const indices = map?.indices;
  useEffect(() => setSelected(null), [indices]);

  return (
    <TwoZone
      canvas={map ? <MapViewer map={map} selected={selected} /> : <MapPlaceholder />}
      panel={
        <>
          <PanelBody>
            <div>
              <Heading title="Knot map" />
              {/* Fixed height, so the sliders below never move while recomputing. */}
              <div className="mt-1 min-h-9 text-sm">
                {map && job.status === 'running' ? (
                  <ProgressBar label={job.stage} value={job.progress} />
                ) : (
                  <p aria-live="polite" className="text-muted">
                    {map
                      ? `Detected ${map.palette.length} ${map.palette.length === 1 ? 'color' : 'colors'}`
                      : 'Detecting colors'}
                  </p>
                )}
              </div>
            </div>
            {map && job.status === 'error' && <JobError message={job.message} />}
            <ClusterControls />
            {map && (
              <PaletteList
                map={map}
                selected={selected}
                onSelect={(i) => setSelected(selected === i ? null : i)}
              />
            )}
          </PanelBody>
          {map && (
            <PanelFooter>
              <ExportButtons title="Export knot map" options={exportsFor(map)} map={map} />
              <Button className="mt-2" onClick={() => goTo(5)}>
                Rug preview
              </Button>
            </PanelFooter>
          )}
        </>
      }
    />
  );
}

function exportsFor(map: KnotMap): ExportOption[] {
  return [
    { kind: 'pdf', label: 'PDF', name: 'knot-map' },
    {
      kind: 'xlsx',
      label: 'Excel',
      name: 'knot-map',
      unavailable:
        map.indices.length > MAX_EXCEL_KNOTS
          ? `Excel is limited to ${formatCount(MAX_EXCEL_KNOTS)} knots. Use the PDF instead.`
          : undefined,
    },
  ];
}

function JobError({ message }: { message: string }) {
  return (
    <div className="space-y-3">
      <Notice tone="error">The knot map could not be generated. {message}</Notice>
      <Button onClick={() => void generateMap()}>Try again</Button>
    </div>
  );
}

function MapPlaceholder() {
  const job = useApp((s) => s.job);
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel p-6">
        {job.status === 'error' ? (
          <JobError message={job.message} />
        ) : (
          <ProgressBar
            label={job.status === 'running' ? job.stage : 'Starting'}
            value={job.status === 'running' ? job.progress : 0}
          />
        )}
      </div>
    </div>
  );
}

function ClusterControls() {
  const settings = useApp((s) => s.clusterSettings);
  const [draft, setDraft] = useState(settings);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const change = (patch: Partial<ClusterSettings>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void commit(next), DEBOUNCE_MS);
  };

  const commit = async (next: ClusterSettings) => {
    const { map, setClusterSettings } = useApp.getState();
    if (hasColorEdits(map)) {
      const ok = await confirmAction('This will discard your color changes. Continue?', 'Discard changes');
      if (!ok) {
        setDraft(useApp.getState().clusterSettings);
        return;
      }
    }
    setClusterSettings(next);
    void generateMap();
  };

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="flex justify-between">
          <span className="font-medium">Number of colors</span>
          <span>{draft.targetColorCount}</span>
        </span>
        <input
          type="range"
          min={2}
          max={40}
          value={draft.targetColorCount}
          onChange={(e) => change({ targetColorCount: Number(e.target.value) })}
          className="mt-1 w-full"
        />
        <span className="text-muted">The most the palette can have. Look-alike colors are merged.</span>
      </label>
      <details className="text-sm">
        <summary className="font-medium">Advanced</summary>
        <label className="mt-3 block">
          <span className="flex justify-between">
            <span>Minimum color difference</span>
            <span>{draft.minColorDifference.toFixed(3)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={0.2}
            step={0.005}
            value={draft.minColorDifference}
            onChange={(e) => change({ minColorDifference: Number(e.target.value) })}
            className="mt-1 w-full"
          />
          <span className="text-muted">Higher merges more similar colors.</span>
        </label>
      </details>
    </div>
  );
}

function PaletteList({
  map,
  selected,
  onSelect,
}: {
  map: KnotMap;
  selected: number | null;
  onSelect(index: number): void;
}) {
  const { setClusterColor, resetClusterColor } = useApp.getState();
  const total = map.indices.length;
  // Resizing changes the counts, so the order is worked out here.
  const order = map.palette
    .map((_, i) => i)
    .filter((i) => map.palette[i]!.knotCount > 0)
    .sort((a, b) => map.palette[b]!.knotCount - map.palette[a]!.knotCount);

  return (
    <section>
      <h3 className="text-sm font-semibold">Palette</h3>
      <p className="mb-2 text-sm text-muted">Select a swatch to highlight its knots.</p>
      <ul className="divide-y divide-line">
        {order.map((i) => {
          const p = map.palette[i]!;
          const edited = p.hex !== map.detectedPalette[i]!.hex;
          return (
            <li key={p.id} className="py-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-pressed={selected === i}
                  aria-label={`Highlight color ${p.id}, ${p.hex}`}
                  onClick={() => onSelect(i)}
                  className="size-10 shrink-0 rounded border border-line-strong aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-accent"
                  style={{ background: p.hex }}
                />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{colorId(p.id)}</span>
                    <span>{percent(p.knotCount / total)}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-muted">
                    <span>{p.hex}</span>
                    <span>{formatCount(p.knotCount)} knots</span>
                  </div>
                </div>
                <label className="relative grid size-9 shrink-0 cursor-pointer place-items-center rounded border border-line-strong hover:bg-paper has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent">
                  <span className="sr-only">Change color {p.id}</span>
                  <svg
                    viewBox="0 0 24 24"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="m4 20 1-4L16 5l3 3L8 19l-4 1ZM14 7l3 3" />
                  </svg>
                  <input
                    type="color"
                    value={p.hex}
                    onChange={(e) => setClusterColor(i, e.target.value)}
                    className="absolute inset-0 size-full opacity-0"
                  />
                </label>
              </div>
              {edited && (
                <Button variant="quiet" className="mt-1 ml-12" onClick={() => resetClusterColor(i)}>
                  Reset to detected color
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Knots at one pixel each. Rebuilt when the colors or the highlight change. */
function useMapBitmap(map: KnotMap, selected: number | null): HTMLCanvasElement {
  const { columns, rows } = useApp((s) => s.grid)!;
  return useMemo(() => {
    const rgb = map.palette.map((p) => hexToRgb(p.hex));
    const chosen = selected === null ? undefined : map.palette[selected];
    // Fade the rest away from the highlighted color: pale ones get a dark field.
    const field = chosen && chosen.oklab[0] > 0.7 ? [52, 50, 47] : [238, 235, 229];
    const keep = 0.14;
    const lut = Uint32Array.from(rgb, (c, i) => {
      const [r, g, b] =
        chosen && i !== selected
          ? c.map((v, j) => Math.round(v * keep + field[j]! * (1 - keep)))
          : c;
      return (255 << 24) | (b! << 16) | (g! << 8) | r!;
    });
    const image = new ImageData(columns, rows);
    const px = new Uint32Array(image.data.buffer);
    for (let i = 0; i < px.length; i++) px[i] = lut[map.indices[i]!]!;
    const canvas = document.createElement('canvas');
    canvas.width = columns;
    canvas.height = rows;
    canvas.getContext('2d')!.putImageData(image, 0, 0);
    return canvas;
  }, [map, selected, columns, rows]);
}

function MapViewer({ map, selected }: { map: KnotMap; selected: number | null }) {
  const image = useApp((s) => s.design.image)!;
  const grid = useMemo(() => gridSpec(useApp.getState()), []);
  const bitmap = useMapBitmap(map, selected);
  const [comparing, setComparing] = useState(false);
  const [hover, setHover] = useState<{ world: Point; screen: Point } | null>(null);

  const knotW = grid.widthIn / grid.columns;
  const knotH = grid.heightIn / grid.rows;

  const draw = (ctx: CanvasRenderingContext2D, view: View, size: Size) => {
    const w = grid.widthIn * view.scale;
    const h = grid.heightIn * view.scale;
    if (comparing) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, view.x, view.y, w, h);
    } else {
      // Crisp cells when enlarged; averaged when several knots share a pixel.
      const enlarged = Math.min(knotW, knotH) * view.scale * (window.devicePixelRatio || 1) >= 1;
      ctx.imageSmoothingEnabled = !enlarged;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, view.x, view.y, w, h);
      drawGridLines(ctx, grid, view, size);
    }
    drawRulers(ctx, grid, view, size);
  };

  const column = hover ? Math.floor(hover.world.x / knotW) : -1;
  const row = hover ? Math.floor(hover.world.y / knotH) : -1;
  const inside = column >= 0 && row >= 0 && column < grid.columns && row < grid.rows;
  const entry =
    hover && inside && !comparing ? map.palette[map.indices[row * grid.columns + column]!] : undefined;

  const hold = {
    onPointerDown: () => setComparing(true),
    onPointerUp: () => setComparing(false),
    onPointerLeave: () => setComparing(false),
    onPointerCancel: () => setComparing(false),
    onBlur: () => setComparing(false),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') setComparing(true);
    },
    onKeyUp: () => setComparing(false),
  };

  return (
    <Viewport
      bounds={{ x: 0, y: 0, width: grid.widthIn, height: grid.heightIn }}
      padding={{ left: RULER_LEFT + 24, top: RULER_TOP + 24, right: 24, bottom: 24 }}
      maxScale={64 / Math.min(knotW, knotH)}
      label="Knot map"
      draw={draw}
      onHover={setHover}
    >
      <button
        type="button"
        aria-pressed={comparing}
        {...hold}
        className="absolute bottom-4 min-h-10 touch-none rounded-md border border-line-strong bg-panel px-4 text-sm font-medium select-none aria-pressed:bg-accent aria-pressed:text-white"
        style={{ left: RULER_LEFT + 16 }}
      >
        Hold to compare with design
      </button>
      {hover && entry && (
        <div
          className="pointer-events-none absolute flex items-center gap-2 rounded border border-line-strong bg-panel px-2 py-1 text-xs whitespace-nowrap"
          style={{
            left: hover.screen.x,
            top: hover.screen.y,
            transform: `translate(${hover.screen.x > 260 ? 'calc(-100% - 12px)' : '14px'}, ${hover.screen.y > 80 ? 'calc(-100% - 12px)' : '18px'})`,
          }}
        >
          <span className="size-4 rounded-sm border border-line-strong" style={{ background: entry.hex }} />
          <span className="font-semibold">{colorId(entry.id)}</span>
          <span>
            Row {formatCount(row + 1)}, column {formatCount(column + 1)}
          </span>
        </div>
      )}
    </Viewport>
  );
}
