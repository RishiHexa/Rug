import { buildMapPdf } from '../export/mapPdf';
import { buildMapXlsx } from '../export/mapXlsx';
import { buildRugImage } from '../export/rugImage';
import type { ExportInput, Progress } from '../export/types';

export type ExportKind = 'pdf' | 'xlsx' | 'png' | 'jpg';

export interface ExportRequest {
  kind: ExportKind;
  input: ExportInput;
}

export type ExportResponse =
  | { type: 'progress'; progress: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; message: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ExportRequest>) => void) | null;
  postMessage(message: ExportResponse): void;
};

const BUILDERS: Record<ExportKind, (input: ExportInput, onProgress: Progress) => Promise<Blob>> = {
  pdf: buildMapPdf,
  xlsx: buildMapXlsx,
  png: (input, onProgress) => buildRugImage(input, 'image/png', onProgress),
  jpg: (input, onProgress) => buildRugImage(input, 'image/jpeg', onProgress),
};

scope.onmessage = ({ data }) => {
  BUILDERS[data.kind](data.input, (progress) => scope.postMessage({ type: 'progress', progress }))
    .then((blob) => scope.postMessage({ type: 'done', blob }))
    .catch((e: unknown) =>
      scope.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
};
