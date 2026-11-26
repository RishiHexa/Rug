import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Group, Heading, Notice, PanelBody, PanelFooter, TwoZone } from '../components/ui';
import type { Point } from '../components/Viewport';
import { depthOf, SIDES, type BandEdge, type Region } from '../segments/analyse';
import { makeCanvas } from '../segments/compose';
import {
  analysePicture,
  buildLayers,
  pictureEdges,
  type Analysed,
  type Built,
  type Component,
} from '../segments/fromPicture';
import { erode, resize, type Mask } from '../segments/mask';
import type { SegmentDoc } from '../segments/model';
import { ArtThumb, PicturePicker, PictureStage, type Picture } from './PictureTools';

/** Outline colors, as on a rug component map. */
const TINT: Record<string, [number, number, number]> = {
  spandrel: [255, 214, 0],
  pocket: [255, 64, 200],
  medallion: [0, 214, 255],
  pendants: [120, 255, 0],
};

/** Waits a moment so the screen can say what is happening first. */
const later = <T,>(work: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => {
  try {
    resolve(work());
  } catch (e) {
    reject(e instanceof Error ? e : new Error(String(e)));
  }
}, 30));

/** Colored outlines of the field's parts, over the picture, at analysis size. */
function overlayOf(a: Analysed): HTMLCanvasElement {
  const { analysis: an } = a;
  const canvas = makeCanvas(an.width, an.height);
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  const paint = (r: Region, color: [number, number, number], flipX = false, flipY = false) => {
    const w = Math.max(1, Math.round(r.box.width));
    const h = Math.max(1, Math.round(r.box.height));
    const m: Mask = resize(r.mask, w, h);
    const inner = erode(m, Math.max(1, Math.round(Math.min(an.width, an.height) / 500)), 0);
    const f = an.field.box;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (m.data[i] === 0) continue;
        let px = Math.round(r.box.x) + x;
        let py = Math.round(r.box.y) + y;
        if (flipX) px = Math.round(2 * f.x + f.width) - 1 - px;
        if (flipY) py = Math.round(2 * f.y + f.height) - 1 - py;
        if (px < 0 || py < 0 || px >= an.width || py >= an.height) continue;
        const o = (py * an.width + px) * 4;
        const edge = inner.data[i] === 0;
        image.data[o] = color[0];
        image.data[o + 1] = color[1];
        image.data[o + 2] = color[2];
        image.data[o + 3] = Math.max(image.data[o + 3]!, edge ? 255 : 40);
      }
    }
  };
  const { field } = an;
  for (const [fx, fy] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    if (field.spandrel) paint(field.spandrel, TINT.spandrel!, fx, fy);
    if (field.pocket) paint(field.pocket, TINT.pocket!, fx, fy);
  }
  if (field.medallion) paint(field.medallion, TINT.medallion!);
  if (field.pendants) {
    paint(field.pendants.top, TINT.pendants!);
    if (field.pendants.bottom) paint(field.pendants.bottom, TINT.pendants!);
    else paint(field.pendants.top, TINT.pendants!, false, true);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Where to put each numbered badge, in analysis pixels. */
interface Badge {
  n: number;
  x: number;
  y: number;
  /** Badges on thin bands sit side by side, this many places to the right. */
  shift?: number;
}

function badges(a: Analysed): Badge[] {
  const { analysis: an } = a;
  const out: Badge[] = [];
  const mid = an.width / 2;
  out.push({ n: 1, x: mid, y: Math.max(8, an.margin.top / 2 + 8) });
  let outer = 0;
  let inner = 0;
  an.bands.forEach((b, i) => {
    // On the top run, where each band is.
    const y = (b.outer.top + b.inner.top) / 2;
    const x = an.width * 0.6;
    if (b.kind === 'main') {
      out.push({ n: 5, x: an.width * 0.75, y });
      out.push({ n: 6, x: (b.outer.left + b.inner.left) / 2, y: (b.outer.top + b.inner.top) / 2 });
    } else if (b.position === 'outer') {
      out.push({ n: b.kind === 'plain' ? 2 : ++outer === 1 ? 3 : 4, x, y, shift: i });
    } else {
      out.push({ n: ++inner === 1 ? 7 : 8, x, y, shift: i });
    }
  });
  const f = an.field;
  const center = (r: Region) => ({ x: r.box.x + r.box.width / 2, y: r.box.y + r.box.height / 2 });
  out.push({ n: 9, x: f.box.x + f.box.width * 0.1, y: f.box.y + f.box.height / 2 });
  if (f.medallion) out.push({ n: 10, ...center(f.medallion) });
  if (f.pendants) out.push({ n: 11, ...center(f.pendants.top) });
  if (f.spandrel) {
    const c = center(f.spandrel);
    out.push({ n: 12, x: c.x + f.spandrel.box.width * 0.15, y: c.y + f.spandrel.box.height * 0.2 });
  }
  if (f.pocket) out.push({ n: 13, ...center(f.pocket) });
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Reads a picture of a whole rug: its border bands, field, medallion,
 * pendants, spandrels and pockets, each with its background color, how it
 * repeats, and its shapes cut free of the background. Then turns them into a
 * stack of layers with resize rules.
 */
export function AnalysePicture({
  picture,
  onPicture,
  size,
  replaces,
  onDone,
  onCancel,
}: {
  picture: Picture | null;
  onPicture(picture: Picture): void;
  /** The rug's size from step 1, inches. */
  size: { width: number; height: number };
  replaces: number;
  onDone(doc: SegmentDoc): void;
  onCancel(): void;
}) {
  const image = picture?.image ?? null;
  const [analysed, setAnalysed] = useState<Analysed | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  /** Band edges in picture pixels while one is being dragged. */
  const [edges, setEdges] = useState<BandEdge[] | null>(null);
  const held = useRef<{ index: number; from: number; start: BandEdge[] } | null>(null);

  const run = async (target: ImageBitmap, given?: BandEdge[]) => {
    setError(null);
    try {
      setBusy('Reading the picture…');
      const a = await later(() => analysePicture(target, given));
      setAnalysed(a);
      setEdges(pictureEdges(a));
      setBusy('Cutting out the shapes…');
      setBuilt(await later(() => buildLayers(a, size)));
    } catch (e) {
      setError(`The picture could not be read. ${e instanceof Error ? e.message : ''}`);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    setAnalysed(null);
    setBuilt(null);
    setEdges(null);
    if (image) void run(image);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per picture
  }, [image]);

  const overlay = useMemo(() => (analysed ? overlayOf(analysed) : null), [analysed]);
  const marks = useMemo(() => (analysed ? badges(analysed) : []), [analysed]);

  const deepest = image ? Math.min(image.width, image.height) / 2 - 4 : 0;
  const depthAt = (p: Point) => (image ? Math.min(p.x, p.y, image.width - p.x, image.height - p.y) : 0);

  const create = async () => {
    if (!analysed) return;
    setBusy('Making the layers…');
    try {
      const result = skip.size === 0 && built ? built : await later(() => buildLayers(analysed, size, skip));
      onDone(result.doc);
    } catch (e) {
      setError(`The layers could not be made. ${e instanceof Error ? e.message : ''}`);
    } finally {
      setBusy(null);
    }
  };

  const toggle = (key: string, on: boolean) =>
    setSkip((s) => {
      const next = new Set(s);
      if (on) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <TwoZone
      canvas={
        <PictureStage
          picture={picture}
          onDown={(p, scale) => {
            if (!edges || busy) return;
            const depth = depthAt(p);
            const near = edges
              .map((e, index) => ({ index, off: Math.abs(depthOf(e) - depth) * scale }))
              .sort((a, b) => a.off - b.off)[0];
            held.current = near && near.off < 12 ? { index: near.index, from: depth, start: edges } : null;
          }}
          onMove={(p) => {
            const h = held.current;
            if (!h) return;
            const by = depthAt(p) - h.from;
            setEdges(
              h.start.map((e, i) => {
                if (i !== h.index) return e;
                const lo = (h.start[i - 1] ? depthOf(h.start[i - 1]!) : 0) + 2 - depthOf(e);
                const hi = (h.start[i + 1] ? depthOf(h.start[i + 1]!) : deepest) - 2 - depthOf(e);
                const d = clamp(by, lo, hi);
                return Object.fromEntries(SIDES.map((s) => [s, e[s] + d])) as unknown as BandEdge;
              }),
            );
          }}
          onUp={() => {
            if (held.current && edges && image) void run(image, edges);
            held.current = null;
          }}
          draw={(ctx, view) => {
            if (!image) return;
            if (overlay && analysed) {
              const k = view.scale / analysed.scale;
              ctx.drawImage(overlay, view.x, view.y, overlay.width * k, overlay.height * k);
            }
            for (const e of edges ?? []) {
              const box: [number, number, number, number] = [
                view.x + e.left * view.scale,
                view.y + e.top * view.scale,
                (image.width - e.left - e.right) * view.scale,
                (image.height - e.top - e.bottom) * view.scale,
              ];
              ctx.strokeStyle = 'rgba(255,255,255,0.9)';
              ctx.lineWidth = 3;
              ctx.strokeRect(...box);
              ctx.strokeStyle = '#2b4479';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(...box);
            }
            if (analysed) {
              ctx.font = '600 12px "IBM Plex Sans", sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              for (const m of marks) {
                const x = view.x + (m.x / analysed.scale) * view.scale + (m.shift ?? 0) * 26;
                const y = view.y + (m.y / analysed.scale) * view.scale;
                ctx.beginPath();
                ctx.arc(x, y, 11, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = '#1d1b18';
                ctx.stroke();
                ctx.fillStyle = '#1d1b18';
                ctx.fillText(String(m.n), x, y + 0.5);
              }
            }
          }}
        />
      }
      panel={
        <>
          <PanelBody>
            <Heading title="Read a rug picture">
              Finds each part of the rug, its background color and how it repeats, and cuts its shapes free of the
              background. Each part becomes a layer with its own resize rules. Drag a white line to move a band edge.
            </Heading>
            <PicturePicker picture={picture} onPicture={onPicture} />
            {busy && <p className="text-sm text-muted" role="status">{busy}</p>}
            {error && <Notice tone="error">{error}</Notice>}
            {built && (
              <Group title="Parts found">
                <ol className="space-y-4">
                  {built.components.map((c) => (
                    <ComponentRow
                      key={c.key}
                      component={c}
                      included={!skip.has(c.key)}
                      onInclude={(on) => toggle(c.key, on)}
                    />
                  ))}
                </ol>
              </Group>
            )}
            {analysed && (
              <details className="text-sm text-muted">
                <summary className="cursor-pointer">How the picture was read</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {analysed.analysis.field.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
            {replaces > 0 && built && (
              <Notice tone="warn">
                This replaces the {replaces} {replaces === 1 ? 'layer' : 'layers'} you have now.
              </Notice>
            )}
          </PanelBody>
          <PanelFooter>
            <Button variant="primary" disabled={!analysed || busy !== null} onClick={() => void create()}>
              Create layers
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </PanelFooter>
        </>
      }
    />
  );
}

function ComponentRow({
  component: c,
  included,
  onInclude,
}: {
  component: Component;
  included: boolean;
  onInclude(on: boolean): void;
}) {
  return (
    <li className="text-sm">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
            c.found ? 'border-ink' : 'border-line-strong text-muted'
          }`}
        >
          {c.number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${c.found ? '' : 'text-muted'}`}>{c.name}</span>
            {c.ground && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <span className="inline-block size-3.5 rounded-sm border border-line-strong" style={{ background: c.ground }} />
                {c.ground}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-muted">{c.found ? c.repeat : `Not found. ${c.repeat}`}</p>
          {c.shapes.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label={`${c.name} shapes`}>
              {c.shapes.map((s) => (
                <li key={s.name} className="flex flex-col items-center gap-0.5" title={s.name}>
                  <ArtThumb
                    art={s.art}
                    className={s.art.canvas.width > s.art.canvas.height * 2.5 ? 'h-10 w-52' : 'size-14'}
                  />
                  <span className="text-xs text-muted">×{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {c.found && c.layer && (
          <label className="flex shrink-0 items-center gap-1 text-xs">
            <input type="checkbox" checked={included} onChange={(e) => onInclude(e.target.checked)} />
            Layer
          </label>
        )}
      </div>
    </li>
  );
}
