import { makeRug, renderFrame, type FrameRequest, type Rug } from '../components/rugRender';
import type { Palette } from '../domain/clustering';

export type { FrameRequest };

export type PreviewRequest =
  | { type: 'rug'; rugId: number; indices: Uint16Array; palette: Palette[]; columns: number; rows: number }
  | { type: 'frame'; rugId: number; frame: FrameRequest };

export type PreviewResponse =
  | { type: 'frame'; rugId: number; frame: FrameRequest; bitmap: ImageBitmap }
  | { type: 'error'; rugId: number; message: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<PreviewRequest>) => void) | null;
  postMessage(message: PreviewResponse, transfer?: Transferable[]): void;
};

let rug: (Rug & { id: number }) | null = null;
let pending: { rugId: number; frame: FrameRequest } | null = null;

scope.onmessage = ({ data }) => {
  if (data.type === 'rug') {
    guard(data.rugId, () => {
      rug = { ...makeRug(data.indices, data.palette, data.columns, data.rows), id: data.rugId };
    });
    return;
  }
  // Only the newest view matters; a burst collapses into one run.
  const scheduled = pending !== null;
  pending = data;
  if (!scheduled) setTimeout(run, 0);
};

function guard(rugId: number, work: () => void) {
  try {
    work();
  } catch (e) {
    scope.postMessage({ type: 'error', rugId, message: e instanceof Error ? e.message : String(e) });
  }
}

function run() {
  const job = pending;
  pending = null;
  if (!job || !rug || rug.id !== job.rugId) return;
  const current = rug;
  guard(job.rugId, () => {
    const bitmap = renderFrame(current, job.frame).transferToImageBitmap();
    scope.postMessage({ type: 'frame', rugId: job.rugId, frame: job.frame, bitmap }, [bitmap]);
  });
}
