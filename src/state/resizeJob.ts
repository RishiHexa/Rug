import type { Palette } from '../domain/clustering';
import type { GridSpec } from '../domain/dimensions';
import type { MapRequest, MapResponse } from '../worker/mapWorker';

/** Gives every knot of a design the nearest color of an existing palette. */
export async function assignKnots(
  image: ImageBitmap,
  grid: GridSpec,
  detected: Palette[],
  onProgress: (fraction: number) => void,
): Promise<Uint16Array> {
  const copy = await createImageBitmap(image);
  const worker = new Worker(new URL('../worker/mapWorker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Uint16Array>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<MapResponse>) => {
        if (data.type === 'progress') onProgress(data.progress);
        else if (data.type === 'assigned') resolve(data.indices);
        else if (data.type === 'error') reject(new Error(data.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'The worker stopped unexpectedly.'));
      const request: MapRequest = {
        type: 'assign',
        jobId: 0,
        image: copy,
        columns: grid.columns,
        rows: grid.rows,
        centroids: Float32Array.from(detected.flatMap((p) => p.oklab)),
      };
      worker.postMessage(request, [copy]);
    });
  } finally {
    worker.terminate();
  }
}
