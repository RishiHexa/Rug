import { useMemo, useState } from 'react';
import { CheckField, LengthField, Row } from '../components/fields';
import { ResizeStage, type RugSize } from '../components/ResizeStage';
import { Button, Facts, Group, Heading, Notice, PanelBody, PanelFooter, ProgressBar, TwoZone } from '../components/ui';
import {
  derive,
  formatCount,
  formatLength,
  gridProblem,
  gridSpecOf,
  MAX_GRID_SIDE,
  MAX_TOTAL_KNOTS,
} from '../domain/dimensions';
import {
  cutArt,
  freeResizeSource,
  paintLayout,
  recolorArt,
  recolorDoc,
  renderFreeResize,
  renderSegments,
  type FreeResize,
} from '../segments/compose';
import { layoutRug } from '../segments/layout';
import { minimumSize } from '../segments/model';
import { assignKnots } from '../state/resizeJob';
import { gridSpec, useApp } from '../state/store';

/** Longest side of the picture used to preview designs without rules. */
const PREVIEW_SIDE = 1400;

export function StepResize() {
  const map = useApp((s) => s.map)!;
  const dims = useApp((s) => s.dimensions);
  const image = useApp((s) => s.design.image)!;
  const source = useApp((s) => s.design.source);
  const segments = useApp((s) => s.draft.segments);
  const resizeBase = useApp((s) => s.resizeBase);
  const clustering = useApp((s) => s.job.status === 'running');
  const { goTo, applyResize } = useApp.getState();

  const doc = source === 'segments' ? segments : null;
  const applied: RugSize = { width: dims.widthIn, height: dims.heightIn };
  const [size, setSize] = useState<RugSize>(applied);
  const [keepShape, setKeepShape] = useState(false);
  const [free, setFree] = useState<FreeResize>('stretch');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = useMemo(
    () => resizeBase ?? { image, grid: gridSpec({ dimensions: dims }) },
    [resizeBase, image, dims],
  );

  // Dragging shows the design in the colors the knot map already settled on.
  const { palette, detectedPalette } = map;
  const colors = palette.map((p) => p.hex).join();
  const recolored = useMemo(
    () => (doc ? recolorDoc(doc, detectedPalette, palette) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `colors` stands for both palettes
    [doc, colors],
  );
  const flat = useMemo(() => {
    if (doc) return null;
    const { width, height } = base.image;
    const art = cutArt(base.image, 0, 0, width, height, PREVIEW_SIDE);
    return recolorArt(art, detectedPalette, palette).canvas;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `colors` stands for both palettes
  }, [doc, base.image, colors]);

  const layout = useMemo(
    () => (recolored ? layoutRug(recolored, size.width, size.height, { x: 0, y: 0 }) : null),
    [recolored, size],
  );

  const smallest = doc ? minimumSize(doc) : { width: 6, height: 6 };
  const limit = (s: RugSize): RugSize => {
    const width = Math.min(MAX_GRID_SIDE / dims.warp, Math.max(smallest.width, s.width));
    const height = Math.min(MAX_GRID_SIDE / dims.weft, Math.max(smallest.height, s.height));
    const most = (MAX_TOTAL_KNOTS * 0.995) / (dims.warp * dims.weft);
    if (width * height <= most) return { width, height };
    // Too many knots: hold back whichever side is growing.
    return width > size.width ? { width: most / height, height } : { width, height: most / width };
  };

  const next = { ...dims, widthIn: size.width, heightIn: size.height };
  const d = derive(next);
  const problem = gridProblem(d);
  const changed = size.width !== applied.width || size.height !== applied.height;
  const original = resizeBase?.grid;

  const apply = async (target: RugSize) => {
    const values = { ...dims, widthIn: target.width, heightIn: target.height };
    const grid = gridSpecOf(values);
    setError(null);
    setProgress(0);
    try {
      // Let the progress bar appear before the design is painted.
      await new Promise((r) => setTimeout(r, 20));
      const canvas = doc ? renderSegments(doc, grid) : renderFreeResize(free, base.image, base.grid, grid, source === 'draw');
      const picture = await createImageBitmap(canvas);
      const indices = await assignKnots(picture, grid, detectedPalette, setProgress);
      applyResize({ widthIn: target.width, heightIn: target.height, image: picture, indices });
      setSize(target);
    } catch (e) {
      setError(`The rug could not be resized. ${e instanceof Error ? e.message : ''}`);
    } finally {
      setProgress(null);
    }
  };

  const strained = layout
    ? layout.reports.flatMap((r, i) => {
        const states = [r.x?.state, r.y?.state];
        const name = doc!.segments[i]!.name;
        if (states.includes('hidden')) return [`${name} is left out: too little room.`];
        if (states.includes('cropped')) return [`${name} is cropped.`];
        if (states.includes('forced')) return [`${name} is stretched past its limits.`];
        if (states.includes('crowded')) return [`${name} is at its smallest and runs into another motif.`];
        return [];
      })
    : [];

  return (
    <TwoZone
      canvas={
        <ResizeStage
          size={size}
          unit={dims.unit}
          keepShape={keepShape}
          limit={limit}
          onResize={setSize}
          paint={(ctx, x, y, scale, s) => {
            if (recolored && layout) {
              paintLayout(ctx, recolored, layout, x, y, scale, scale);
            } else if (flat) {
              const part = freeResizeSource(free, flat, base.grid, { widthIn: s.width, heightIn: s.height });
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(flat, part.x, part.y, part.width, part.height, x, y, s.width * scale, s.height * scale);
            }
          }}
        />
      }
      panel={
        <>
          <PanelBody>
            <Heading title="Resize">
              {doc
                ? 'Drag an edge or corner. Every segment follows its own rules, in the same colors.'
                : 'Drag an edge or corner. This design has no segment rules, so it is stretched or cropped.'}
            </Heading>
            <Row>
              <LengthField label="Width" value={size.width} unit={dims.unit} min={1} onChange={(width) => setSize(limit({ ...size, width }))} />
              <LengthField label="Height" value={size.height} unit={dims.unit} min={1} onChange={(height) => setSize(limit({ ...size, height }))} />
            </Row>
            <CheckField label="Keep proportions while dragging" checked={keepShape} onChange={setKeepShape} />
            {!doc && (
              <Group title="How it follows">
                <div className="space-y-1 text-sm">
                  {(
                    [
                      ['stretch', 'Stretch the whole design'],
                      ['crop', 'Crop the edges, keep the pattern'],
                    ] as const
                  ).map(([value, text]) => (
                    <label key={value} className="flex items-center gap-2">
                      <input type="radio" name="free-resize" checked={free === value} onChange={() => setFree(value)} />
                      {text}
                    </label>
                  ))}
                </div>
              </Group>
            )}
            <Facts
              rows={[
                ['New size', `${formatLength(d.actualWidthIn, dims.unit)} × ${formatLength(d.actualHeightIn, dims.unit)}`],
                ['Knot grid', `${formatCount(d.columns)} × ${formatCount(d.rows)}`],
                ['Total knots', formatCount(d.totalKnots)],
                ['Colors', `${palette.length}, unchanged`],
              ]}
            />
            {problem && <Notice tone="error">{problem}</Notice>}
            {strained.map((text) => (
              <Notice key={text} tone="warn">
                {text}
              </Notice>
            ))}
            {error && <Notice tone="error">{error}</Notice>}
          </PanelBody>
          <PanelFooter>
            {progress !== null ? (
              <ProgressBar label="Resizing" value={progress} />
            ) : (
              <>
                <Button
                  variant="primary"
                  disabled={(!changed && (doc !== null || !resizeBase)) || problem !== null || clustering}
                  onClick={() => void apply(size)}
                >
                  Apply this size
                </Button>
                {changed && <Button onClick={() => setSize(applied)}>Undo dragging</Button>}
                {original && !changed && (
                  <Button onClick={() => void apply({ width: original.widthIn, height: original.heightIn })}>
                    Back to {formatLength(original.widthIn, dims.unit)} × {formatLength(original.heightIn, dims.unit)}
                  </Button>
                )}
                <Button onClick={() => goTo(4)}>Go to knot map</Button>
              </>
            )}
          </PanelFooter>
        </>
      }
    />
  );
}
