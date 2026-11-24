/** The finished rug as one large picture. */
import { drawFringe, drawRim, makeRug, renderFrame } from '../components/rugRender';
import { makeFringe } from '../components/rugTexture';
import type { ExportInput, Progress } from './types';

const MAX_PIXELS = 40_000_000;
const MAX_SIDE = 10_000;
const MAX_KNOT_PX = 16;
const STRIP = 512;
/** Same texture scale as the preview at 100%. */
const MIN_ROW = 5;

export async function buildRugImage(
  input: ExportInput,
  type: 'image/png' | 'image/jpeg',
  onProgress?: Progress,
): Promise<Blob> {
  const { grid } = input;
  const fringe = makeFringe(grid);
  const margin = fringe.length * 0.6;
  const fullW = grid.widthIn + margin * 2;
  const fullH = grid.heightIn + (fringe.length + margin) * 2;
  const knotW = grid.widthIn / grid.columns;
  const knotH = grid.heightIn / grid.rows;
  const scale = Math.min(
    Math.sqrt(MAX_PIXELS / (fullW * fullH)),
    MAX_SIDE / Math.max(fullW, fullH),
    MAX_KNOT_PX / Math.min(knotW, knotH),
  );

  const width = Math.max(1, Math.round(grid.widthIn * scale));
  const height = Math.max(1, Math.round(grid.heightIn * scale));
  const x = Math.round(margin * scale);
  const y = Math.round((fringe.length + margin) * scale);
  const canvas = new OffscreenCanvas(width + x * 2, height + y * 2);
  // Kept in main memory: this is far larger than graphics hardware likes.
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  if (!ctx) throw new Error('This device cannot make an image that large.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawFringe(ctx, fringe, x, y, scale, 1);

  const rug = makeRug(input.indices, input.palette, grid.columns, grid.rows);
  for (let top = 0; top < height; top += STRIP) {
    const strip = renderFrame(rug, {
      left: 0,
      top,
      width,
      height: Math.min(STRIP, height - top),
      knotW: width / grid.columns,
      knotH: height / grid.rows,
      minRow: MIN_ROW,
      broad: true,
    });
    ctx.drawImage(strip, x, y + top);
    onProgress?.((top / height) * 0.8);
  }
  drawRim(ctx, x, y, width, height, scale);
  onProgress?.(0.85);
  return canvas.convertToBlob({ type, quality: 0.95 });
}
