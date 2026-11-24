import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckField } from '../components/fields';
import { Button, Group, Heading, Notice, PanelBody, PanelFooter, TwoZone } from '../components/ui';
import { Viewport, type Point, type Size, type View } from '../components/Viewport';
import { ACCEPTED_TYPES } from '../design/upload';
import { clearColor, cutArt, pixelHex } from '../segments/compose';
import { segmentsFromPicture, suggestBands } from '../segments/fromPicture';
import type { Art, SegmentDoc } from '../segments/model';

/** A picture to take segments from; shared, so many parts can come from one. */
export interface Picture {
  name: string;
  image: ImageBitmap;
}

function PicturePicker({
  picture,
  onPicture,
}: {
  picture: Picture | null;
  onPicture(picture: Picture): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const accept = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('That file type is not supported. Use a PNG, JPG or WebP image.');
      return;
    }
    try {
      const image = await createImageBitmap(file);
      if (Math.min(image.width, image.height) < 8) setError('That image is too small.');
      else onPicture({ name: file.name, image });
    } catch {
      setError('That image could not be read.');
    }
  };
  return (
    <div className="space-y-2">
      <input
        ref={ref}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        aria-label="Picture file"
        className="hidden"
        onChange={(e) => {
          void accept(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Button variant={picture ? 'secondary' : 'primary'} onClick={() => ref.current?.click()}>
        {picture ? 'Use another picture' : 'Choose a picture'}
      </Button>
      {picture && <p className="text-sm break-all text-muted">{picture.name}</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function PictureStage({
  picture,
  draw,
  onDown,
  onMove,
  onUp,
  children,
}: {
  picture: Picture | null;
  draw(ctx: CanvasRenderingContext2D, view: View): void;
  onDown(p: Point, scale: number): void;
  onMove(p: Point): void;
  onUp(): void;
  children?: ReactNode;
}) {
  const scale = useRef(1);
  if (!picture) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-muted">
        <p>Choose a picture to begin.</p>
      </div>
    );
  }
  const { image } = picture;
  return (
    <Viewport
      key={picture.name + image.width + image.height}
      bounds={{ x: 0, y: 0, width: image.width, height: image.height }}
      padding={{ left: 32, top: 32, right: 32, bottom: 32 }}
      maxScale={24}
      label="Picture"
      cursor="crosshair"
      draw={(ctx: CanvasRenderingContext2D, view: View, _size: Size) => {
        scale.current = view.scale;
        ctx.imageSmoothingEnabled = view.scale < 2;
        ctx.drawImage(image, view.x, view.y, image.width * view.scale, image.height * view.scale);
        draw(ctx, view);
      }}
      tool={{
        onDown: (p) => onDown(p, scale.current),
        onMove: (ps) => onMove(ps[ps.length - 1]!),
        onUp,
      }}
    >
      {children}
    </Viewport>
  );
}

interface Selection {
  a: Point;
  b: Point;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Takes a rectangular part of a picture as artwork, optionally cut out. */
export function TakeFromPicture({
  title,
  picture,
  onPicture,
  onTake,
  onCancel,
}: {
  title: string;
  picture: Picture | null;
  onPicture(picture: Picture): void;
  onTake(art: Art): void;
  onCancel(): void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [cutOut, setCutOut] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState(0.08);

  const rect = useMemo(() => {
    if (!selection || !picture) return null;
    const { width, height } = picture.image;
    const x = Math.round(clamp(Math.min(selection.a.x, selection.b.x), 0, width));
    const y = Math.round(clamp(Math.min(selection.a.y, selection.b.y), 0, height));
    const right = Math.round(clamp(Math.max(selection.a.x, selection.b.x), 0, width));
    const bottom = Math.round(clamp(Math.max(selection.a.y, selection.b.y), 0, height));
    return right - x >= 2 && bottom - y >= 2 ? { x, y, width: right - x, height: bottom - y } : null;
  }, [selection, picture]);

  // Cutting is only worth doing once the selection is finished.
  const plain = useMemo(
    () => (rect && picture && !dragging ? cutArt(picture.image, rect.x, rect.y, rect.width, rect.height) : null),
    [rect, picture, dragging],
  );
  const corner = useMemo(() => (plain ? pixelHex(plain.canvas, 0, 0) : null), [plain]);
  const keyColor = key ?? corner;
  const art = useMemo(
    () => (plain && cutOut && keyColor ? clearColor(plain, keyColor, tolerance) : plain),
    [plain, cutOut, keyColor, tolerance],
  );

  return (
    <TwoZone
      canvas={
        <PictureStage
          picture={picture}
          onDown={(p) => {
            setDragging(true);
            setKey(null);
            setSelection({ a: p, b: p });
          }}
          onMove={(p) => dragging && setSelection((s) => s && { ...s, b: p })}
          onUp={() => setDragging(false)}
          draw={(ctx, view) => {
            if (!rect || !picture) return;
            const x = view.x + rect.x * view.scale;
            const y = view.y + rect.y * view.scale;
            const w = rect.width * view.scale;
            const h = rect.height * view.scale;
            ctx.fillStyle = 'rgba(246,243,236,0.6)';
            ctx.beginPath();
            ctx.rect(view.x, view.y, picture.image.width * view.scale, picture.image.height * view.scale);
            ctx.rect(x, y, w, h);
            ctx.fill('evenodd');
            ctx.strokeStyle = '#2b4479';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
          }}
        />
      }
      panel={
        <>
          <PanelBody>
            <Heading title={title}>
              Drag over the part to use. Scroll to zoom, hold Space and drag to pan.
            </Heading>
            <PicturePicker
              picture={picture}
              onPicture={(p) => {
                setSelection(null);
                onPicture(p);
              }}
            />
            {rect && (
              <Group title="Selected part">
                <p className="mb-2 text-sm text-muted">
                  {rect.width} × {rect.height} px
                </p>
                {art && <ArtThumb art={art} className="h-32 w-full" />}
                <div className="mt-3 space-y-3">
                  <CheckField label="Remove the background color" checked={cutOut} onChange={setCutOut} />
                  {cutOut && keyColor && (
                    <>
                      <label className="flex items-center gap-3 text-sm">
                        <input
                          type="color"
                          value={keyColor}
                          onChange={(e) => setKey(e.target.value)}
                          className="h-9 w-12 rounded border border-line-strong"
                        />
                        Color to remove
                      </label>
                      <label className="block text-sm">
                        <span className="flex justify-between">
                          <span>How close counts</span>
                          <span>{tolerance.toFixed(2)}</span>
                        </span>
                        <input
                          type="range"
                          min={0.01}
                          max={0.3}
                          step={0.01}
                          value={tolerance}
                          onChange={(e) => setTolerance(Number(e.target.value))}
                          className="mt-1 w-full"
                        />
                      </label>
                    </>
                  )}
                </div>
              </Group>
            )}
          </PanelBody>
          <PanelFooter>
            <Button variant="primary" disabled={!art} onClick={() => art && onTake(art)}>
              Use this part
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </PanelFooter>
        </>
      }
    />
  );
}

/** Splits a picture of a whole rug into border bands and a field. */
export function SplitPicture({
  picture,
  onPicture,
  size,
  replaces,
  onDone,
  onCancel,
}: {
  picture: Picture | null;
  onPicture(picture: Picture): void;
  size: { baseWidth: number; baseHeight: number };
  /** Number of segments that will be replaced. */
  replaces: number;
  onDone(doc: SegmentDoc): void;
  onCancel(): void;
}) {
  const [bands, setBands] = useState<number[]>([]);
  const [field, setField] = useState<'whole' | 'quarter'>('quarter');
  const held = useRef<number | null>(null);
  const image = picture?.image ?? null;

  useEffect(() => {
    if (image) setBands(suggestBands(image));
  }, [image]);

  const deepest = image ? Math.floor(Math.min(image.width, image.height) / 2) - 2 : 0;
  /** How far a point is from the nearest edge. */
  const depthOf = (p: Point) =>
    image ? Math.min(p.x, p.y, image.width - p.x, image.height - p.y) : 0;
  const moveBand = (index: number, depth: number) =>
    setBands((all) => {
      const lo = (all[index - 1] ?? 0) + 2;
      const hi = (all[index + 1] ?? deepest + 2) - 2;
      return all.map((b, i) => (i === index ? Math.round(clamp(depth, lo, Math.max(lo, hi))) : b));
    });

  return (
    <TwoZone
      canvas={
        <PictureStage
          picture={picture}
          onDown={(p, scale) => {
            const depth = depthOf(p);
            const near = bands
              .map((b, i) => ({ i, off: Math.abs(b - depth) * scale }))
              .sort((a, b) => a.off - b.off)[0];
            held.current = near && near.off < 12 ? near.i : null;
          }}
          onMove={(p) => {
            if (held.current !== null) moveBand(held.current, depthOf(p));
          }}
          onUp={() => {
            held.current = null;
          }}
          draw={(ctx, view) => {
            if (!image) return;
            for (const b of bands) {
              const box: [number, number, number, number] = [
                view.x + b * view.scale,
                view.y + b * view.scale,
                (image.width - 2 * b) * view.scale,
                (image.height - 2 * b) * view.scale,
              ];
              ctx.strokeStyle = 'rgba(255,255,255,0.9)';
              ctx.lineWidth = 4;
              ctx.strokeRect(...box);
              ctx.strokeStyle = '#2b4479';
              ctx.lineWidth = 2;
              ctx.strokeRect(...box);
            }
          }}
        />
      }
      panel={
        <>
          <PanelBody>
            <Heading title="Split a rug picture">
              Each line is where one border ends and the next begins. Drag a line to move it.
            </Heading>
            <PicturePicker picture={picture} onPicture={onPicture} />
            {image && (
              <>
                <Group title="Border lines">
                  {bands.length === 0 && (
                    <p className="mb-2 text-sm text-muted">No borders found. Add a line where one ends.</p>
                  )}
                  <ul className="space-y-2">
                    {bands.map((b, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <label className="flex flex-1 items-center gap-2">
                          <span className="w-14 shrink-0">Line {i + 1}</span>
                          <input
                            type="range"
                            min={2}
                            max={deepest}
                            value={b}
                            onChange={(e) => moveBand(i, Number(e.target.value))}
                            className="w-full min-w-0"
                          />
                          <span className="w-14 shrink-0 text-right">{b} px</span>
                        </label>
                        <Button variant="quiet" onClick={() => setBands(bands.filter((_, j) => j !== i))}>
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-3"
                    disabled={(bands.at(-1) ?? 0) + 8 > deepest}
                    onClick={() => setBands([...bands, Math.min(deepest, Math.round((bands.at(-1) ?? 0) + deepest / 8))])}
                  >
                    Add a line
                  </Button>
                </Group>
                <Group title="Middle of the rug">
                  <div className="space-y-1 text-sm">
                    {(
                      [
                        ['quarter', 'Mirrored quarter that repeats'],
                        ['whole', 'One piece that stretches'],
                      ] as const
                    ).map(([value, text]) => (
                      <label key={value} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="split-field"
                          checked={field === value}
                          onChange={() => setField(value)}
                        />
                        {text}
                      </label>
                    ))}
                  </div>
                </Group>
                {replaces > 0 && (
                  <Notice tone="warn">
                    This replaces the {replaces} {replaces === 1 ? 'segment' : 'segments'} you have now.
                  </Notice>
                )}
              </>
            )}
          </PanelBody>
          <PanelFooter>
            <Button
              variant="primary"
              disabled={!image}
              onClick={() => image && onDone(segmentsFromPicture(image, { bands, field }, size))}
            >
              Create segments
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </PanelFooter>
        </>
      }
    />
  );
}

/** Small picture of a piece of artwork on a checkerboard. */
export function ArtThumb({ art, under, className = '' }: { art: Art; under?: string | null; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const w = (canvas.width = Math.max(1, canvas.clientWidth * 2));
    const h = (canvas.height = Math.max(1, canvas.clientHeight * 2));
    const ctx = canvas.getContext('2d')!;
    const { width, height } = art.canvas;
    const scale = Math.min(w / width, h / height);
    const x = (w - width * scale) / 2;
    const y = (h - height * scale) / 2;
    ctx.clearRect(0, 0, w, h);
    for (let row = 0; row * 12 < h; row++) {
      for (let col = 0; col * 12 < w; col++) {
        ctx.fillStyle = under ?? ((row + col) % 2 ? '#e2ded6' : '#ffffff');
        ctx.fillRect(col * 12, row * 12, 12, 12);
      }
    }
    ctx.imageSmoothingEnabled = !art.crisp;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(art.canvas, x, y, width * scale, height * scale);
  }, [art, under]);
  return <canvas ref={ref} aria-hidden className={`rounded border border-line-strong ${className}`} />;
}
