import type { GridSpec } from '../domain/dimensions';
import type { DesignSource } from '../domain/pipeline';

/** Crop rectangle in image pixels; height follows from the rug's aspect ratio. */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UploadDraft {
  name: string;
  image: ImageBitmap;
  url: string;
  crop: Crop;
}

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MIN_IMAGE_SIDE = 32;
/** Aspect ratios closer than this count as matching. */
const ASPECT_TOLERANCE = 0.005;
const MAX_OUTPUT_SIDE = 4000;
const MAX_OUTPUT_SIDE_LARGE_GRID = 8192;

export async function loadUpload(file: File, aspect: number): Promise<UploadDraft> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('That file type is not supported. Use a PNG, JPG or WebP image.');
  }
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error('That image could not be read. The file may be damaged or too large.');
  }
  if (Math.min(image.width, image.height) < MIN_IMAGE_SIDE) {
    throw new Error(
      `That image is too small (${image.width} × ${image.height} px). Use one at least ${MIN_IMAGE_SIDE} px on each side.`,
    );
  }
  return {
    name: file.name,
    image,
    url: URL.createObjectURL(file),
    crop: largestCrop(image.width, image.height, aspect),
  };
}

export function matchesAspect(width: number, height: number, aspect: number): boolean {
  return Math.abs(width / height / aspect - 1) <= ASPECT_TOLERANCE;
}

/** Biggest centred crop; the whole image when the proportions already match. */
export function largestCrop(width: number, height: number, aspect: number): Crop {
  if (matchesAspect(width, height, aspect)) return { x: 0, y: 0, width, height };
  const w = Math.min(width, height * aspect);
  const h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export function moveCrop(crop: Crop, dx: number, dy: number, img: { width: number; height: number }): Crop {
  return {
    ...crop,
    x: Math.min(Math.max(0, crop.x + dx), img.width - crop.width),
    y: Math.min(Math.max(0, crop.y + dy), img.height - crop.height),
  };
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** Resizes from one corner; the opposite corner stays put, aspect is kept. */
export function resizeCrop(
  crop: Crop,
  corner: Corner,
  dx: number,
  dy: number,
  img: { width: number; height: number },
): Crop {
  const aspect = crop.width / crop.height;
  const west = corner.endsWith('w');
  const north = corner.startsWith('n');
  const anchorX = west ? crop.x + crop.width : crop.x;
  const anchorY = north ? crop.y + crop.height : crop.y;
  const growX = west ? -dx : dx;
  const growY = (north ? -dy : dy) * aspect;
  const grow = Math.abs(growX) > Math.abs(growY) ? growX : growY;
  const roomX = west ? anchorX : img.width - anchorX;
  const roomY = (north ? anchorY : img.height - anchorY) * aspect;
  const maxWidth = Math.min(roomX, roomY);
  const minWidth = Math.min(maxWidth, Math.max(16, 16 * aspect));
  const width = Math.min(maxWidth, Math.max(minWidth, crop.width + grow));
  const height = width / aspect;
  return {
    x: west ? anchorX - width : anchorX,
    y: north ? anchorY - height : anchorY,
    width,
    height,
  };
}

export function uploadSource(draft: UploadDraft, grid: GridSpec): DesignSource {
  return {
    kind: 'upload',
    produce: async () => {
      const { crop, image } = draft;
      const limit = Math.max(
        MAX_OUTPUT_SIDE,
        Math.min(MAX_OUTPUT_SIDE_LARGE_GRID, Math.max(grid.columns, grid.rows)),
      );
      const scale = Math.min(1, limit / Math.max(crop.width, crop.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(crop.width * scale));
      canvas.height = Math.max(1, Math.round(crop.height * scale));
      const ctx = canvas.getContext('2d')!;
      // Transparent areas become white, like undyed wool.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
      return createImageBitmap(canvas);
    },
  };
}
