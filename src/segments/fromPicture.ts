/** Turns a picture of a whole rug into segments with sensible rules. */
import { oklabToHex } from '../domain/color';
import { cutArt, makeCanvas } from './compose';
import { makeRule, newSegmentId, type Segment, type SegmentDoc } from './model';
import { findBands, findRepeat, flatColor, type Pixels } from './split';

/** Pictures are analysed at this size at most, to stay quick. */
const MAX_ANALYSIS_SIDE = 900;

function pixelsOf(
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
): { pixels: Pixels; scale: number } {
  const scale = Math.min(1, MAX_ANALYSIS_SIDE / Math.max(width, height));
  const canvas = makeCanvas(width * scale, height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height), scale };
}

/** Suggested band edges, as distances from the picture's edge in pixels. */
export function suggestBands(image: ImageBitmap): number[] {
  const { pixels, scale } = pixelsOf(image, 0, 0, image.width, image.height);
  return findBands(pixels).map((d) => Math.round(d / scale));
}

const meanHex = ({ data, width, height }: Pixels): string => {
  const sum = [0, 0, 0];
  for (let p = 0; p < data.length; p += 4) for (let j = 0; j < 3; j++) sum[j]! += data[p + j]!;
  return `#${sum
    .map((v) =>
      Math.round(v / (width * height))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

export interface SplitOptions {
  /** Band edges, ascending, in picture pixels. */
  bands: number[];
  /** Keep the field in one piece, or repeat its mirrored top-left quarter. */
  field: 'whole' | 'quarter';
}

export function segmentsFromPicture(
  image: ImageBitmap,
  { bands, field }: SplitOptions,
  size: { baseWidth: number; baseHeight: number },
): SegmentDoc {
  const { width: W, height: H } = image;
  // One scale for both directions, so nothing in the picture is distorted.
  const perInch = Math.sqrt((W / size.baseWidth) * (H / size.baseHeight));
  const segments: Segment[] = [];
  let background = '#8c2f24';

  bands.forEach((to, i) => {
    const from = i === 0 ? 0 : bands[i - 1]!;
    const thick = to - from;
    const length = W - 2 * to;
    if (thick < 2 || length < 8) return;
    const { pixels, scale } = pixelsOf(image, to, from, length, thick);
    const flat = flatColor(pixels);
    const hex = flat ? oklabToHex(flat) : meanHex(pixels);
    if (i === 0) background = hex;
    const thickness = thick / perInch;
    const placement = { type: 'border' as const, inset: from / perInch, thickness, sides: 'all' as const };
    const base = { id: newSegmentId(), name: `Border ${i + 1}`, color: hex, overflow: 'stretch' as const };
    if (flat) {
      const rule = makeRule(thickness);
      segments.push({ ...base, art: null, cornerArt: null, placement: { ...placement, corner: 'plain' }, x: rule, y: rule });
      return;
    }
    const repeat = findRepeat(pixels, pixels.height * 0.5);
    // Without a clear repeat, half the side mirrored gives the whole side back.
    const piece = repeat ? Math.round(repeat / scale) : Math.round(length / 2);
    const rule = makeRule(piece / perInch, { minStretch: 0.75, maxStretch: 1.35, flip: !repeat });
    segments.push({
      ...base,
      art: cutArt(image, to, from, piece, thick),
      cornerArt: cutArt(image, from, from, thick, thick),
      placement: { ...placement, corner: 'piece' },
      x: rule,
      y: rule,
    });
  });

  const start = bands.at(-1) ?? 0;
  const fieldW = W - 2 * start;
  const fieldH = H - 2 * start;
  const { pixels } = pixelsOf(image, start, start, fieldW, fieldH);
  const quarter = field === 'quarter';
  const art = quarter
    ? cutArt(image, start, start, Math.ceil(fieldW / 2), Math.ceil(fieldH / 2))
    : cutArt(image, start, start, fieldW, fieldH);
  const rule = (length: number) =>
    quarter
      ? makeRule(length / 2, { flip: true, minStretch: 0.8, maxStretch: 1.3 })
      : makeRule(length, { fit: 'single', minStretch: 0.6, maxStretch: 1.7 });
  segments.push({
    id: newSegmentId(),
    name: 'Field',
    color: meanHex(pixels),
    art,
    cornerArt: null,
    placement: { type: 'fill', area: 'inside' },
    x: rule(fieldW / perInch),
    y: rule(fieldH / perInch),
    overflow: quarter ? 'crop' : 'stretch',
  });
  return { ...size, background, segments };
}
