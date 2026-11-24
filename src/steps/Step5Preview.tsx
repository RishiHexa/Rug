import { useMemo, useRef } from 'react';
import { ExportButtons, type ExportOption } from '../components/ExportButtons';
import { drawFringe, drawRim } from '../components/rugRender';
import { makeFringe } from '../components/rugTexture';
import { Button, Facts, Heading, Notice, PanelBody, PanelFooter, TwoZone } from '../components/ui';
import { useRugFrames, type FrameRequest, type RugFrame } from '../components/useRugFrames';
import { Viewport, type Size, type View } from '../components/Viewport';
import { formatCount, formatLength } from '../domain/dimensions';
import { gridSpec, useApp, type KnotMap } from '../state/store';

const EXPORTS: ExportOption[] = [
  { kind: 'png', label: 'PNG', name: 'rug' },
  { kind: 'jpg', label: 'JPG', name: 'rug' },
];

export function Step5Preview() {
  const map = useApp((s) => s.map)!;
  const unit = useApp((s) => s.dimensions.unit);
  const goTo = useApp((s) => s.goTo);
  const grid = useMemo(() => gridSpec(useApp.getState()), []);

  return (
    <TwoZone
      canvas={<RugViewer map={map} />}
      panel={
        <>
          <PanelBody>
            <Heading title="Rug preview">How the knot map could look as a finished rug.</Heading>
            <Facts
              rows={[
                ['Size', `${formatLength(grid.widthIn, unit)} × ${formatLength(grid.heightIn, unit)}`],
                ['Knots', formatCount(grid.columns * grid.rows)],
                ['Colors', String(map.palette.length)],
              ]}
            />
          </PanelBody>
          <PanelFooter>
            <ExportButtons title="Export rug" options={EXPORTS} map={map} />
            <Button className="mt-2" onClick={() => goTo(4)}>
              Back to knot map
            </Button>
          </PanelFooter>
        </>
      }
    />
  );
}

/** Smallest height of a texture row on screen, in CSS pixels. */
const MIN_ROW = 5;
/** Extra rug drawn around the view, as a share of its size, for panning. */
const SPARE = 0.15;

function RugViewer({ map }: { map: KnotMap }) {
  const grid = useMemo(() => gridSpec(useApp.getState()), []);
  const fringe = useMemo(() => makeFringe(grid), [grid]);
  const { latest, error, requested, request } = useRugFrames(map, grid);
  /** Last picture of the whole rug, shown where newer detail is missing. */
  const overview = useRef<RugFrame | null>(null);

  const knotW = grid.widthIn / grid.columns;
  const knotH = grid.heightIn / grid.rows;

  /** Asks for the visible part of the rug, unless it is already on its way. */
  const requestFrame = (view: View, size: Size, dpr: number) => {
    const scale = view.scale * dpr;
    const rugW = Math.round(grid.widthIn * scale);
    const rugH = Math.round(grid.heightIn * scale);
    const span = (offset: number, extent: number, rug: number, spare: number) => {
      const from = Math.max(0, Math.floor((-offset - extent * spare) * dpr));
      const to = Math.min(rug, Math.ceil((extent - offset + extent * spare) * dpr));
      return { from, to };
    };
    const needX = span(view.x, size.width, rugW, 0);
    const needY = span(view.y, size.height, rugH, 0);
    if (needX.to <= needX.from || needY.to <= needY.from) return;
    const held = requested.current;
    if (
      held &&
      held.knotW === knotW * scale &&
      held.left <= needX.from &&
      held.top <= needY.from &&
      held.left + held.width >= needX.to &&
      held.top + held.height >= needY.to
    ) {
      return;
    }
    const x = span(view.x, size.width, rugW, SPARE);
    const y = span(view.y, size.height, rugH, SPARE);
    request({
      left: x.from,
      top: y.from,
      width: x.to - x.from,
      height: y.to - y.from,
      knotW: knotW * scale,
      knotH: knotH * scale,
      minRow: MIN_ROW * dpr,
    });
  };

  const coversRug = (f: FrameRequest) =>
    f.left === 0 &&
    f.top === 0 &&
    f.width >= Math.round(f.knotW * grid.columns) &&
    f.height >= Math.round(f.knotH * grid.rows);
  if (latest && coversRug(latest.frame)) overview.current = latest;

  const draw = (ctx: CanvasRenderingContext2D, view: View, size: Size) => {
    const dpr = window.devicePixelRatio || 1;
    const { x, y, scale } = view;
    const w = grid.widthIn * scale;
    const h = grid.heightIn * scale;

    // Shadow under the rug and fringe, in proportion to the rug.
    const lift = Math.min(40, Math.max(6, Math.min(w, h) * 0.02));
    ctx.save();
    ctx.shadowColor = 'rgba(40,34,26,0.4)';
    ctx.shadowBlur = lift * 1.6 * dpr;
    ctx.shadowOffsetY = lift * 0.5 * dpr;
    ctx.fillStyle = '#b8ae9a';
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    drawFringe(ctx, fringe, x, y, scale, dpr);

    // The worker's newest picture, stretched into place until a sharper one
    // arrives for this view.
    requestFrame(view, size, dpr);
    const paint = ({ frame, bitmap }: RugFrame) => {
      const k = (knotW * scale) / frame.knotW;
      const exact = Math.abs(k * dpr - 1) < 1e-6;
      const snap = (v: number) => (exact ? Math.round(v * dpr) / dpr : v);
      ctx.imageSmoothingEnabled = !exact;
      ctx.drawImage(
        bitmap,
        snap(x + frame.left * k),
        snap(y + frame.top * k),
        frame.width * k,
        frame.height * k,
      );
    };
    if (overview.current && overview.current !== latest) paint(overview.current);
    if (latest) paint(latest);

    drawRim(ctx, x, y, w, h, scale);
  };

  const margin = fringe.length * 1.15;
  return (
    <Viewport
      bounds={{ x: 0, y: -margin, width: grid.widthIn, height: grid.heightIn + margin * 2 }}
      padding={{ left: 40, top: 28, right: 40, bottom: 40 }}
      maxScale={24 / Math.min(knotW, knotH)}
      label="Realistic rug preview"
      draw={draw}
    >
      {(error || !latest) && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
          <div className="rounded-lg border border-line bg-panel px-5 py-3 text-sm">
            {error ? (
              <Notice tone="error">The preview could not be drawn. {error}</Notice>
            ) : (
              <p role="status">Preparing the rug…</p>
            )}
          </div>
        </div>
      )}
    </Viewport>
  );
}
