import { useEffect, useRef, useState } from 'react';
import { gridSpec, useApp, type KnotMap } from '../state/store';
import type { ExportKind, ExportRequest, ExportResponse } from '../worker/exportWorker';
import { Button, Notice, ProgressBar } from './ui';

export interface ExportOption {
  kind: ExportKind;
  label: string;
  /** Start of the file name. */
  name: string;
  /** Why this format is not available, if it is not. */
  unavailable?: string;
}

type Status =
  | { state: 'idle' }
  | { state: 'running'; label: string; progress: number }
  | { state: 'error'; message: string };

/** One button per file format; the file is built in a worker and downloaded. */
export function ExportButtons({
  title,
  options,
  map,
}: {
  title: string;
  options: ExportOption[];
  map: KnotMap;
}) {
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const worker = useRef<Worker | null>(null);

  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
  };
  useEffect(() => stop, []);

  const start = ({ kind, label, name }: ExportOption) => {
    stop();
    setStatus({ state: 'running', label: `Making the ${label} file`, progress: 0 });
    const { dimensions } = useApp.getState();
    const grid = gridSpec({ dimensions });
    const w = new Worker(new URL('../worker/exportWorker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    const fail = (message: string) => {
      stop();
      setStatus({ state: 'error', message: `The ${label} file could not be made. ${message}` });
    };
    w.onmessage = ({ data }: MessageEvent<ExportResponse>) => {
      if (data.type === 'progress') {
        setStatus((s) => (s.state === 'running' ? { ...s, progress: data.progress } : s));
      } else if (data.type === 'done') {
        stop();
        setStatus({ state: 'idle' });
        download(data.blob, `${name}-${grid.columns}x${grid.rows}.${kind}`);
      } else {
        fail(data.message);
      }
    };
    w.onerror = (e) => fail(e.message || 'There may not be enough memory.');
    const request: ExportRequest = {
      kind,
      input: { indices: map.indices, palette: map.palette, grid, unit: dimensions.unit },
    };
    w.postMessage(request);
  };

  const notes = options.flatMap((o) => (o.unavailable ? [o.unavailable] : []));

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {status.state === 'running' ? (
        <div className="flex min-h-10 items-center gap-3">
          <div className="flex-1">
            <ProgressBar label={status.label} value={status.progress} />
          </div>
          <Button
            variant="quiet"
            onClick={() => {
              stop();
              setStatus({ state: 'idle' });
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          {options.map((o) => (
            <Button
              key={o.kind}
              className="flex-1 px-2"
              disabled={o.unavailable !== undefined}
              onClick={() => start(o)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      )}
      {status.state === 'error' && (
        <div className="mt-2">
          <Notice tone="error">{status.message}</Notice>
        </div>
      )}
      {notes.map((note) => (
        <p key={note} className="mt-2 text-sm text-muted">
          {note}
        </p>
      ))}
    </section>
  );
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // The browser needs the address until it has started reading the file.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
