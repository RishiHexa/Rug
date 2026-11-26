import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckField } from '../components/fields';
import { Button, Group, Heading, Notice, PanelBody, PanelFooter, TwoZone } from '../components/ui';
import { Viewport, type Point, type Size, type View } from '../components/Viewport';
import { ACCEPTED_TYPES } from '../design/upload';
import { clearColor, cutArt, edgeColor, keepShape } from '../segments/compose';
import type { Art } from '../segments/model';

/** A picture to take segments from; shared, so many parts can come from one. */
export interface Picture {
  name: string;
  image: ImageBitmap;
}

export function PicturePicker({
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

export function PictureStage({
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
  /** whole: the rectangle as it is. shape: only the shape, off its background. color: one color removed everywhere. */
  const [cutOut, setCutOut] = useState<'whole' | 'shape' | 'color'>('shape');
  const [key, setKey] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState(0.05);
  const [keepPart, setKeepPart] = useState<'center' | 'all'>('center');

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
  const corner = useMemo(() => (plain ? edgeColor(plain.canvas) : null), [plain]);
  const keyColor = key ?? corner;
  const art = useMemo(
    () =>
      plain && keyColor && cutOut !== 'whole'
        ? cutOut === 'shape'
          ? keepShape(plain, keyColor, tolerance, keepPart)
          : clearColor(plain, keyColor, tolerance)
        : plain,
    [plain, cutOut, keyColor, tolerance, keepPart],
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
                  <div className="space-y-1 text-sm" role="radiogroup" aria-label="What to keep">
                    {(
                      [
                        ['shape', 'Only the shape, off its background'],
                        ['color', 'Remove one color everywhere'],
                        ['whole', 'The whole rectangle'],
                      ] as const
                    ).map(([value, text]) => (
                      <label key={value} className="flex items-center gap-2">
                        <input type="radio" name="cut-out" checked={cutOut === value} onChange={() => setCutOut(value)} />
                        {text}
                      </label>
                    ))}
                  </div>
                  {cutOut === 'shape' && (
                    <CheckField
                      label="Only the shape in the middle, not bits of its neighbours"
                      checked={keepPart === 'center'}
                      onChange={(on) => setKeepPart(on ? 'center' : 'all')}
                    />
                  )}
                  {cutOut !== 'whole' && keyColor && (
                    <>
                      <label className="flex items-center gap-3 text-sm">
                        <input
                          type="color"
                          value={keyColor}
                          onChange={(e) => setKey(e.target.value)}
                          className="h-9 w-12 rounded border border-line-strong"
                        />
                        {cutOut === 'shape' ? 'Background color' : 'Color to remove'}
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
