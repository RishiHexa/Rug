import { linearToOklab, SRGB_TO_LINEAR } from './color';

/**
 * Area-averages an RGBA image down (or up) to exactly `columns × rows` and
 * returns OKLab triples, one per knot. Each knot is the exact box average of
 * the image area under its footprint, with fractional pixel coverage, mixed in
 * linear light.
 */
export function sampleKnots(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  columns: number,
  rows: number,
  onProgress?: (fraction: number) => void,
): Float32Array {
  const out = new Float32Array(columns * rows * 3);

  // Horizontal coverage, shared by every source row.
  const xStart = new Int32Array(columns);
  const xEnd = new Int32Array(columns);
  const firstWeight = new Float32Array(columns);
  const lastWeight = new Float32Array(columns);
  const scaleX = width / columns;
  for (let c = 0; c < columns; c++) {
    const x0 = c * scaleX;
    const x1 = (c + 1) * scaleX;
    const start = Math.min(Math.floor(x0), width - 1);
    const end = Math.min(Math.max(Math.ceil(x1), start + 1), width);
    xStart[c] = start;
    xEnd[c] = end;
    firstWeight[c] = Math.min(x1, start + 1) - x0;
    lastWeight[c] = end - 1 > start ? Math.min(x1, end) - (end - 1) : 0;
  }

  const line = new Float32Array(columns * 3);
  let lineY = -1;
  const loadLine = (y: number) => {
    if (y === lineY) return;
    lineY = y;
    const base = y * width * 4;
    for (let c = 0; c < columns; c++) {
      const start = xStart[c]!;
      const last = xEnd[c]! - 1;
      let r = 0;
      let g = 0;
      let b = 0;
      let total = 0;
      for (let x = start; x <= last; x++) {
        const w = x === start ? firstWeight[c]! : x === last ? lastWeight[c]! : 1;
        const p = base + x * 4;
        r += SRGB_TO_LINEAR[rgba[p]!]! * w;
        g += SRGB_TO_LINEAR[rgba[p + 1]!]! * w;
        b += SRGB_TO_LINEAR[rgba[p + 2]!]! * w;
        total += w;
      }
      line[c * 3] = r / total;
      line[c * 3 + 1] = g / total;
      line[c * 3 + 2] = b / total;
    }
  };

  const sum = new Float32Array(columns * 3);
  const scaleY = height / rows;
  for (let row = 0; row < rows; row++) {
    const y0 = row * scaleY;
    const y1 = (row + 1) * scaleY;
    const start = Math.min(Math.floor(y0), height - 1);
    const end = Math.min(Math.max(Math.ceil(y1), start + 1), height);
    sum.fill(0);
    let total = 0;
    for (let y = start; y < end; y++) {
      const w = Math.min(y1, y + 1) - Math.max(y0, y);
      if (w <= 0) continue;
      loadLine(y);
      for (let i = 0; i < sum.length; i++) sum[i]! += line[i]! * w;
      total += w;
    }
    for (let c = 0; c < columns; c++) {
      const i = c * 3;
      linearToOklab(
        sum[i]! / total,
        sum[i + 1]! / total,
        sum[i + 2]! / total,
        out,
        (row * columns + c) * 3,
      );
    }
    if (onProgress && row % 64 === 0) onProgress(row / rows);
  }
  return out;
}
