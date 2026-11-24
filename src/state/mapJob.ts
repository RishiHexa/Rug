/** Runs knot-map generation in the worker and mirrors its progress to the store. */
import type { MapRequest, MapResponse } from '../worker/mapWorker';
import { useApp } from './store';

let worker: Worker | null = null;
let loadedImage: ImageBitmap | null = null;
let latestJob = 0;

const post = (w: Worker, request: MapRequest, transfer: Transferable[] = []) =>
  w.postMessage(request, transfer);

function startWorker(): Worker {
  const w = new Worker(new URL('../worker/mapWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = ({ data }: MessageEvent<MapResponse>) => {
    if (data.jobId !== latestJob) return;
    const { setJob, setMap } = useApp.getState();
    if (data.type === 'progress') setJob({ status: 'running', stage: data.stage, progress: data.progress });
    else if (data.type === 'result') setMap(data.indices, data.palette);
    else if (data.type === 'error') setJob({ status: 'error', message: data.message });
  };
  w.onerror = (e) => {
    if (worker !== w) return;
    stop();
    useApp.getState().setJob({ status: 'error', message: e.message || 'The worker stopped unexpectedly.' });
  };
  return w;
}

function stop() {
  latestJob++;
  worker?.terminate();
  worker = null;
  loadedImage = null;
}

/** Generates the map with the current settings; supersedes any running job. */
export async function generateMap(): Promise<void> {
  const { design, grid, clusterSettings, setJob } = useApp.getState();
  const { image } = design;
  if (!image || !grid) return;
  const jobId = ++latestJob;
  setJob({ status: 'running', stage: 'Starting', progress: 0 });
  try {
    if (loadedImage !== image) {
      // Copied off the main thread and handed over; cloning it in postMessage
      // would block the UI for large designs.
      const copy = await createImageBitmap(image);
      if (jobId !== latestJob) {
        copy.close();
        return;
      }
      worker ??= startWorker();
      post(worker, { type: 'design', image: copy, ...grid }, [copy]);
      loadedImage = image;
    }
    if (worker) post(worker, { type: 'cluster', jobId, settings: clusterSettings });
  } catch (e) {
    if (jobId !== latestJob) return;
    setJob({ status: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

// Anything that changes or reopens the design makes the worker's data stale.
useApp.subscribe((state, previous) => {
  const reopened = previous.designFinal && !state.designFinal;
  if (reopened || previous.design.image !== state.design.image) stop();
});
