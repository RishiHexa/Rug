import { useCallback, useEffect, useRef, useState } from 'react';
import type { GridSpec } from '../domain/dimensions';
import type { KnotMap } from '../state/store';
import type { FrameRequest, PreviewRequest, PreviewResponse } from '../worker/previewWorker';

export type { FrameRequest };

export interface RugFrame {
  frame: FrameRequest;
  bitmap: ImageBitmap;
}

// One worker for the session: it keeps the pile texture, which is slow to build.
let worker: Worker | null = null;
let lastRugId = 0;

function getWorker(): Worker {
  worker ??= new Worker(new URL('../worker/previewWorker.ts', import.meta.url), { type: 'module' });
  return worker;
}

const post = (request: PreviewRequest) => getWorker().postMessage(request);

/** Finished pictures of parts of the rug, drawn in a worker on request. */
export function useRugFrames(
  map: KnotMap,
  grid: GridSpec,
): {
  latest: RugFrame | null;
  error: string | null;
  /** The newest request, answered or not. */
  requested: React.RefObject<FrameRequest | null>;
  request(frame: FrameRequest): void;
} {
  const [latest, setLatest] = useState<RugFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef<FrameRequest | null>(null);
  const rugId = useRef(0);

  useEffect(() => {
    const id = ++lastRugId;
    rugId.current = id;
    const w = getWorker();
    const onMessage = ({ data }: MessageEvent<PreviewResponse>) => {
      if (data.rugId !== id) return;
      if (data.type === 'frame') setLatest(data);
      else setError(data.message);
    };
    const onError = (e: ErrorEvent) => setError(e.message || 'The worker stopped unexpectedly.');
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    post({
      type: 'rug',
      rugId: id,
      indices: map.indices,
      palette: map.palette,
      columns: grid.columns,
      rows: grid.rows,
    });
    // The viewer may have asked for a frame before this rug was sent.
    if (requested.current) post({ type: 'frame', rugId: id, frame: requested.current });
    return () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
    };
  }, [map, grid]);

  const request = useCallback((frame: FrameRequest) => {
    requested.current = frame;
    if (rugId.current) post({ type: 'frame', rugId: rugId.current, frame });
  }, []);

  return { latest, error, requested, request };
}
