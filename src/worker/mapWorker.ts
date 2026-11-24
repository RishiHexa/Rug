import { assignNearest, clusterKnots, type ClusterSettings, type Palette } from '../domain/clustering';
import { sampleKnots } from '../domain/resample';

export type MapRequest =
  | { type: 'design'; image: ImageBitmap; columns: number; rows: number }
  | { type: 'cluster'; jobId: number; settings: ClusterSettings }
  /** Samples another design and gives its knots the colors of a palette. */
  | {
      type: 'assign';
      jobId: number;
      image: ImageBitmap;
      columns: number;
      rows: number;
      centroids: Float32Array;
    };

export type MapResponse =
  | { type: 'progress'; jobId: number; stage: string; progress: number }
  | { type: 'result'; jobId: number; indices: Uint16Array<ArrayBuffer>; palette: Palette[] }
  | { type: 'assigned'; jobId: number; indices: Uint16Array<ArrayBuffer> }
  | { type: 'error'; jobId: number; message: string };

// Typed as a plain worker scope; the DOM lib only knows about Window here.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<MapRequest>) => void) | null;
  postMessage(message: MapResponse, transfer?: Transferable[]): void;
};

let design: { image: ImageBitmap; columns: number; rows: number } | null = null;
/** OKLab value of every knot; kept so new settings skip resampling. */
let lab: Float32Array | null = null;
let pending: { jobId: number; settings: ClusterSettings } | null = null;

scope.onmessage = ({ data }) => {
  if (data.type === 'design') {
    design = data;
    lab = null;
    return;
  }
  if (data.type === 'assign') {
    assign(data);
    return;
  }
  // Only the newest request matters; a burst collapses into one run.
  const scheduled = pending !== null;
  pending = data;
  if (!scheduled) setTimeout(run, 0);
};

function run() {
  const job = pending;
  pending = null;
  if (!job) return;
  const { jobId, settings } = job;
  const report = (stage: string, from: number, to: number) => (f: number) =>
    scope.postMessage({ type: 'progress', jobId, stage, progress: from + (to - from) * f });
  try {
    const clusterFrom = lab ? 0 : 0.4;
    if (!design) throw new Error('No design to sample.');
    lab ??= sample(design, report('Sampling knots', 0, 0.4));
    const { indices, palette } = clusterKnots(lab, settings, report('Grouping colors', clusterFrom, 1));
    const owned = indices as Uint16Array<ArrayBuffer>;
    scope.postMessage({ type: 'result', jobId, indices: owned, palette }, [owned.buffer]);
  } catch (e) {
    scope.postMessage({ type: 'error', jobId, message: e instanceof Error ? e.message : String(e) });
  }
}

function assign(job: Extract<MapRequest, { type: 'assign' }>) {
  const { jobId } = job;
  try {
    const progress = (f: number) =>
      scope.postMessage({ type: 'progress', jobId, stage: 'Resizing', progress: f });
    const knots = sample(job, (f) => progress(f * 0.7));
    const indices = new Uint16Array(job.columns * job.rows);
    assignNearest(knots, job.centroids, indices, (f) => progress(0.7 + f * 0.3));
    scope.postMessage({ type: 'assigned', jobId, indices }, [indices.buffer]);
  } catch (e) {
    scope.postMessage({ type: 'error', jobId, message: e instanceof Error ? e.message : String(e) });
  }
}

function sample(
  { image, columns, rows }: { image: ImageBitmap; columns: number; rows: number },
  onProgress: (f: number) => void,
): Float32Array {
  onProgress(0);
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return sampleKnots(data, image.width, image.height, columns, rows, onProgress);
}
