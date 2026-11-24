import { useLayoutEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { Button, Facts, Heading, Notice, PanelBody, TwoZone } from '../components/ui';
import {
  ACCEPTED_TYPES,
  loadUpload,
  matchesAspect,
  moveCrop,
  resizeCrop,
  uploadSource,
  type Corner,
  type Crop,
  type UploadDraft,
} from '../design/upload';
import { formatCount, formatLength } from '../domain/dimensions';
import { gridSpec, useApp } from '../state/store';
import { DesignFooter } from './Step2Design';

export function UploadEditor() {
  const upload = useApp((s) => s.draft.upload);
  const unit = useApp((s) => s.dimensions.unit);
  const { setDraft, invalidateDesign } = useApp.getState();
  const grid = gridSpec(useApp.getState());
  const aspect = grid.widthIn / grid.heightIn;

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const accept = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadUpload(file, aspect);
      const previous = useApp.getState().draft.upload;
      if (previous) URL.revokeObjectURL(previous.url);
      invalidateDesign();
      setDraft({ upload: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That image could not be read.');
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void accept(e.dataTransfer.files[0]);
  };

  const setCrop = (crop: Crop) => {
    if (!upload) return;
    invalidateDesign();
    setDraft({ upload: { ...upload, crop } });
  };

  const fits = upload !== null && matchesAspect(upload.image.width, upload.image.height, aspect);
  const upscaled =
    upload !== null &&
    (Math.round(upload.crop.width) < grid.columns || Math.round(upload.crop.height) < grid.rows);

  return (
    <TwoZone
      canvas={
        <div
          className={`absolute inset-0 ${dragOver ? 'outline-2 -outline-offset-4 outline-accent outline-dashed' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {upload ? (
            <CropStage
              key={upload.url}
              upload={upload}
              cropping={!fits}
              label={`${formatLength(grid.widthIn, unit)} × ${formatLength(grid.heightIn, unit)}`}
              onCrop={setCrop}
            />
          ) : (
            <div className="grid h-full place-items-center p-6">
              <div className="max-w-sm rounded-lg border border-dashed border-line-strong bg-panel px-8 py-10 text-center">
                <p className="font-medium">{loading ? 'Reading image…' : 'Drop an image here'}</p>
                <p className="mt-1 mb-5 text-sm text-muted">PNG, JPG or WebP</p>
                <Button variant="primary" disabled={loading} onClick={() => fileRef.current?.click()}>
                  Choose a file
                </Button>
              </div>
            </div>
          )}
        </div>
      }
      panel={
        <>
          <PanelBody>
            <Heading title="Upload an image">
              {!upload
                ? 'The image is fitted to the rug’s proportions.'
                : fits
                  ? 'The image already matches the rug’s proportions.'
                  : 'Move and resize the frame to choose what goes on the rug. Arrow keys move it, plus and minus resize it.'}
            </Heading>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              aria-label="Image file"
              className="hidden"
              onChange={(e) => {
                void accept(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {error && <Notice tone="error">{error}</Notice>}
            {upload && (
              <>
                <Facts
                  rows={[
                    ['File', <span className="break-all">{upload.name}</span>],
                    ['Image', `${formatCount(upload.image.width)} × ${formatCount(upload.image.height)} px`],
                    [
                      'Used area',
                      `${formatCount(Math.round(upload.crop.width))} × ${formatCount(Math.round(upload.crop.height))} px`,
                    ],
                    ['Knot grid', `${formatCount(grid.columns)} × ${formatCount(grid.rows)}`],
                  ]}
                />
                {upscaled && (
                  <Notice tone="warn">
                    The used area has fewer pixels than the knot grid, so it will be upscaled and may
                    look soft.
                  </Notice>
                )}
                <Button disabled={loading} onClick={() => fileRef.current?.click()}>
                  {loading ? 'Reading image…' : 'Replace image'}
                </Button>
              </>
            )}
          </PanelBody>
          <DesignFooter source={upload ? uploadSource(upload, grid) : null} />
        </>
      }
    />
  );
}

const STAGE_PADDING = 32;

function CropStage({
  upload,
  cropping,
  label,
  onCrop,
}: {
  upload: UploadDraft;
  cropping: boolean;
  label: string;
  onCrop(crop: Crop): void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const drag = useRef<{ mode: 'move' | Corner; x: number; y: number; crop: Crop } | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current!;
    const measure = () => setSize({ width: box.clientWidth, height: box.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const { image, crop, url } = upload;
  const scale = Math.max(
    0.0001,
    Math.min(
      (size.width - STAGE_PADDING * 2) / image.width,
      (size.height - STAGE_PADDING * 2) / image.height,
    ),
  );

  const start = (mode: 'move' | Corner) => (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, crop };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / scale;
    const dy = (e.clientY - d.y) / scale;
    onCrop(d.mode === 'move' ? moveCrop(d.crop, dx, dy, image) : resizeCrop(d.crop, d.mode, dx, dy, image));
  };
  const end = () => {
    drag.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = Math.max(1, image.width / 100);
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const by = moves[e.key];
    if (by) onCrop(moveCrop(crop, by[0], by[1], image));
    else if (e.key === '+' || e.key === '=') onCrop(resizeCrop(crop, 'se', step, 0, image));
    else if (e.key === '-') onCrop(resizeCrop(crop, 'se', -step, 0, image));
    else return;
    e.preventDefault();
  };

  return (
    <div ref={boxRef} className="grid h-full place-items-center overflow-hidden">
      <div
        className="relative overflow-hidden select-none"
        style={{ width: image.width * scale, height: image.height * scale }}
      >
        <img src={url} alt={upload.name} draggable={false} className="size-full" />
        {cropping && (
          <div
            role="group"
            tabIndex={0}
            aria-label={`Crop frame, ${label}. Arrow keys move, plus and minus resize.`}
            onKeyDown={onKeyDown}
            onPointerDown={start('move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute cursor-move touch-none border-2 border-accent shadow-[0_0_0_9999px_rgb(246_243_236/0.72)]"
            style={{
              left: crop.x * scale,
              top: crop.y * scale,
              width: crop.width * scale,
              height: crop.height * scale,
            }}
          >
            <span className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded bg-panel px-2 py-0.5 text-xs font-medium whitespace-nowrap">
              {label}
            </span>
            {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
              <span
                key={corner}
                onPointerDown={start(corner)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                className={`absolute size-6 touch-none ${corner.startsWith('n') ? 'top-0' : 'bottom-0'} ${
                  corner.endsWith('w') ? 'left-0' : 'right-0'
                } ${corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'}`}
              >
                <span
                  className={`absolute size-3 border border-panel bg-accent ${
                    corner.startsWith('n') ? 'top-0' : 'bottom-0'
                  } ${corner.endsWith('w') ? 'left-0' : 'right-0'}`}
                />
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
