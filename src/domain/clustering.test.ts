import { describe, expect, it } from 'vitest';
import { hexToOklab, linearToOklab, oklabToHex, SRGB_TO_LINEAR, hexToRgb } from './color';
import {
  clusterKnots,
  createRandom,
  mergeCentroids,
  oklabDistance,
  subsample,
  type ClusterResult,
} from './clustering';
import { sampleKnots } from './resample';

const labOf = (hexes: string[]) => Float32Array.from(hexes.flatMap((h) => hexToOklab(h)));

function minPairDistance({ palette }: ClusterResult): number {
  let min = Infinity;
  palette.forEach((a, i) =>
    palette.slice(i + 1).forEach((b) => (min = Math.min(min, oklabDistance(a.oklab, b.oklab)))),
  );
  return min;
}

/** Red (top) to purple (bottom), one flat color per row. */
function redToPurple(columns: number, rows: number): Float32Array {
  const red = hexToRgb('#ff0000');
  const purple = hexToRgb('#800080');
  const hexes: string[] = [];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const hex = `#${red
      .map((v, i) =>
        Math.round(v + (purple[i]! - v) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
    for (let c = 0; c < columns; c++) hexes.push(hex);
  }
  return labOf(hexes);
}

describe('color conversion', () => {
  it('matches culori in the fast per-knot path', () => {
    for (const hex of ['#000000', '#ffffff', '#b03a2e', '#2b4479', '#7f8c3d', '#800080']) {
      const out = new Float32Array(3);
      const [r, g, b] = hexToRgb(hex).map((v) => SRGB_TO_LINEAR[v]!) as [number, number, number];
      linearToOklab(r, g, b, out, 0);
      hexToOklab(hex).forEach((v, i) => expect(out[i]).toBeCloseTo(v, 4));
    }
  });
  it('round-trips hex', () => {
    expect(oklabToHex(hexToOklab('#b03a2e'))).toBe('#b03a2e');
  });
});

describe('clusterKnots on a red→purple gradient', () => {
  const columns = 20;
  const rows = 15;
  const settings = { targetColorCount: 20, minColorDifference: 0.06 };
  const result = clusterKnots(redToPurple(columns, rows), settings);

  it('groups 15 rows into a handful of colors', () => {
    expect(result.palette.length).toBeGreaterThanOrEqual(3);
    expect(result.palette.length).toBeLessThanOrEqual(6);
  });
  it('has no near-duplicate colors', () => {
    expect(minPairDistance(result)).toBeGreaterThanOrEqual(settings.minColorDifference);
  });
  it('forms contiguous bands: whole rows, each color in one unbroken run', () => {
    const bandOfRow = Array.from({ length: rows }, (_, r) => {
      const line = result.indices.slice(r * columns, (r + 1) * columns);
      expect(new Set(line).size).toBe(1);
      return line[0]!;
    });
    const runs = bandOfRow.filter((b, i) => i === 0 || b !== bandOfRow[i - 1]);
    expect(runs.length).toBe(result.palette.length);
    expect(new Set(runs).size).toBe(runs.length);
  });
  it('can give exactly four bands', () => {
    const four = clusterKnots(redToPurple(columns, rows), { ...settings, targetColorCount: 4 });
    expect(four.palette).toHaveLength(4);
    expect(minPairDistance(four)).toBeGreaterThanOrEqual(settings.minColorDifference);
  });
});

describe('clusterKnots', () => {
  const flat = ['#b03a2e', '#f4ecd8', '#2b4479', '#1e6b4f'];

  it('finds exactly the colors of flat art, sorted by knot count', () => {
    const hexes = flat.flatMap((h, i) => Array<string>(10 * (i + 1)).fill(h));
    const { palette, indices } = clusterKnots(labOf(hexes), {
      targetColorCount: 20,
      minColorDifference: 0.05,
    });
    expect(palette.map((p) => p.hex)).toEqual([...flat].reverse());
    expect(palette.map((p) => p.knotCount)).toEqual([40, 30, 20, 10]);
    expect(palette.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    expect(palette[indices[0]!]!.hex).toBe('#b03a2e');
  });
  it('counts every knot exactly once', () => {
    const lab = redToPurple(40, 60);
    const { palette, indices } = clusterKnots(lab, { targetColorCount: 8, minColorDifference: 0 });
    expect(palette.reduce((n, p) => n + p.knotCount, 0)).toBe(2400);
    palette.forEach((p, i) =>
      expect(indices.reduce((n, v) => n + (v === i ? 1 : 0), 0)).toBe(p.knotCount),
    );
  });
  it('never exceeds the requested number of colors', () => {
    const random = createRandom(7);
    const lab = Float32Array.from({ length: 9000 }, (_, i) =>
      i % 3 === 0 ? random() : random() * 0.4 - 0.2,
    );
    for (const k of [2, 12, 40]) {
      const r = clusterKnots(lab, { targetColorCount: k, minColorDifference: 0.05 });
      expect(r.palette.length).toBeLessThanOrEqual(k);
      expect(minPairDistance(r)).toBeGreaterThanOrEqual(0.05);
    }
  });
  it('is deterministic', () => {
    const s = { targetColorCount: 6, minColorDifference: 0.03 };
    const a = clusterKnots(redToPurple(10, 50), s);
    const b = clusterKnots(redToPurple(10, 50), s);
    expect(a.palette).toEqual(b.palette);
    expect(a.indices).toEqual(b.indices);
  });
});

describe('mergeCentroids', () => {
  it('weights the merged color by knot count and leaves distinct colors alone', () => {
    const out = mergeCentroids(
      Float32Array.from([0.5, 0, 0, 0.51, 0, 0, 0.9, 0, 0]),
      [300, 100, 5],
      0.05,
    );
    expect(out.length).toBe(6);
    expect(out[0]).toBeCloseTo(0.5025);
    expect(out[3]).toBeCloseTo(0.9);
  });
  it('drops empty centroids', () => {
    expect(mergeCentroids(Float32Array.from([0.1, 0, 0, 0.9, 0, 0]), [0, 4], 0.05).length).toBe(3);
  });
});

describe('subsample', () => {
  it('returns at most the requested number of colors', () => {
    expect(subsample(new Float32Array(3000), 100, createRandom(1)).length).toBe(300);
    expect(subsample(new Float32Array(30), 100, createRandom(1)).length).toBe(30);
  });
});

describe('sampleKnots', () => {
  const rgba = (hexes: string[]) =>
    Uint8ClampedArray.from(hexes.flatMap((h) => [...hexToRgb(h), 255]));
  const hexAt = (lab: Float32Array, i: number) =>
    oklabToHex([lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!]);

  it('keeps pixels unchanged at 1 : 1', () => {
    const px = ['#ff0000', '#00ff00', '#0000ff', '#ffffff'];
    const lab = sampleKnots(rgba(px), 2, 2, 2, 2);
    expect(px.map((_, i) => hexAt(lab, i))).toEqual(px);
  });
  it('averages the whole footprint instead of picking one pixel', () => {
    // Half black, half white: linear-light mean is sRGB 188.
    const lab = sampleKnots(rgba(['#000000', '#ffffff', '#ffffff', '#000000']), 2, 2, 1, 1);
    expect(hexAt(lab, 0)).toBe('#bcbcbc');
  });
  it('weights partially covered pixels', () => {
    // 3 px → 2 knots: knot 0 = px0 + half of px1 → linear 1/3.
    const lab = sampleKnots(rgba(['#000000', '#ffffff', '#ffffff']), 3, 1, 2, 1);
    const third = new Float32Array(3);
    linearToOklab(1 / 3, 1 / 3, 1 / 3, third, 0);
    expect(lab[0]).toBeCloseTo(third[0]!, 4);
    expect(hexAt(lab, 1)).toBe('#ffffff');
  });
  it('handles upscaling', () => {
    const lab = sampleKnots(rgba(['#ff0000', '#0000ff']), 2, 1, 6, 4);
    expect(hexAt(lab, 0)).toBe('#ff0000');
    expect(hexAt(lab, 23)).toBe('#0000ff');
  });
  it('covers every knot for awkward ratios', () => {
    const lab = sampleKnots(new Uint8ClampedArray(97 * 53 * 4).fill(255), 97, 53, 61, 71);
    for (let i = 0; i < 61 * 71; i++) expect(lab[i * 3]).toBeCloseTo(1, 4);
  });
});
