import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  cmToIn,
  derive,
  formatLength,
  ftInToIn,
  gridProblem,
  inToCm,
  inToFtIn,
  inToMm,
  mmToIn,
  RECOMPUTES,
  softWarnings,
  type DimensionField,
  type DimensionValues,
} from './dimensions';

const base: DimensionValues = { widthIn: 96, heightIn: 120, warp: 10, weft: 10 };

describe('unit conversions', () => {
  it('converts cm and mm both ways', () => {
    expect(inToCm(1)).toBeCloseTo(2.54);
    expect(cmToIn(254)).toBeCloseTo(100);
    expect(inToMm(1)).toBeCloseTo(25.4);
    expect(mmToIn(25.4)).toBeCloseTo(1);
    expect(cmToIn(inToCm(37.3))).toBeCloseTo(37.3, 10);
  });
  it('converts feet + inches both ways', () => {
    expect(ftInToIn(8, 6)).toBe(102);
    expect(inToFtIn(102)).toEqual({ ft: 8, inches: 6 });
    expect(inToFtIn(108)).toEqual({ ft: 9, inches: 0 });
  });
  it('carries inches that would round up to 12', () => {
    expect(inToFtIn(107.999)).toEqual({ ft: 9, inches: 0 });
  });
  it('formats in each unit', () => {
    expect(formatLength(96.05, 'in')).toBe('96.05 in');
    expect(formatLength(108, 'ftin')).toBe('9 ft');
    expect(formatLength(102.5, 'ftin')).toBe('8 ft 6.5 in');
    expect(formatLength(100, 'cm')).toBe('254 cm');
  });
});

describe('derive', () => {
  it('computes knot size, KPSI and grid', () => {
    const d = derive({ widthIn: 108, heightIn: 144, warp: 10, weft: 10 });
    expect(d.columns).toBe(1080);
    expect(d.rows).toBe(1440);
    expect(d.totalKnots).toBe(1_555_200);
    expect(d.kpsi).toBe(100);
    expect(d.knotWidthMm).toBeCloseTo(2.54);
  });
  it('treats non-square knots independently', () => {
    const d = derive({ ...base, warp: 8, weft: 12 });
    expect(d.columns).toBe(768);
    expect(d.rows).toBe(1440);
    expect(d.knotWidthIn).toBeCloseTo(1 / 8);
    expect(d.knotHeightIn).toBeCloseTo(1 / 12);
  });
});

describe('rounding to whole knots', () => {
  it('reports nothing when the size is already a whole number of knots', () => {
    const d = derive(base);
    expect(d.widthRounded).toBe(false);
    expect(d.heightRounded).toBe(false);
    expect(d.actualWidthIn).toBeCloseTo(96);
  });
  it('reports the actual size when rounding changes it', () => {
    const d = derive({ ...base, widthIn: 96.06 });
    expect(d.columns).toBe(961);
    expect(d.actualWidthIn).toBeCloseTo(96.1);
    expect(d.widthRounded).toBe(true);
    expect(d.heightRounded).toBe(false);
  });
  it('rounds down as well as up', () => {
    const d = derive({ ...base, heightIn: 120.04 });
    expect(d.rows).toBe(1200);
    expect(d.actualHeightIn).toBeCloseTo(120);
    expect(d.heightRounded).toBe(true);
  });
});

describe('applyEdit', () => {
  it('width: changes columns only', () => {
    const v = applyEdit(base, 'width', 100);
    expect(v).toEqual({ ...base, widthIn: 100 });
    expect(derive(v).columns).toBe(1000);
    expect(derive(v).rows).toBe(1200);
    expect(derive(v).kpsi).toBe(100);
  });
  it('height: changes rows only', () => {
    const v = applyEdit(base, 'height', 60);
    expect(derive(v).rows).toBe(600);
    expect(derive(v).columns).toBe(960);
  });
  it('warp: updates knot width, KPSI, columns; leaves the weft side alone', () => {
    const d = derive(applyEdit(base, 'warp', 20));
    expect(d.knotWidthMm).toBeCloseTo(1.27);
    expect(d.knotHeightMm).toBeCloseTo(2.54);
    expect(d.kpsi).toBe(200);
    expect(d.columns).toBe(1920);
    expect(d.rows).toBe(1200);
    expect(d.totalKnots).toBe(1920 * 1200);
  });
  it('weft: updates knot height, KPSI, rows; leaves the warp side alone', () => {
    const d = derive(applyEdit(base, 'weft', 5));
    expect(d.knotHeightMm).toBeCloseTo(5.08);
    expect(d.knotWidthMm).toBeCloseTo(2.54);
    expect(d.kpsi).toBe(50);
    expect(d.rows).toBe(600);
    expect(d.columns).toBe(960);
  });
  it('knot width (mm): updates warp, KPSI, columns', () => {
    const v = applyEdit(base, 'knotWidth', 5.08);
    expect(v.warp).toBeCloseTo(5);
    expect(v.weft).toBe(10);
    expect(derive(v).kpsi).toBeCloseTo(50);
    expect(derive(v).columns).toBe(480);
  });
  it('knot height (mm): updates weft, KPSI, rows', () => {
    const v = applyEdit(base, 'knotHeight', 1.27);
    expect(v.weft).toBeCloseTo(20);
    expect(v.warp).toBe(10);
    expect(derive(v).rows).toBe(2400);
  });
  it('KPSI: keeps the warp : weft ratio and scales both', () => {
    const v = applyEdit({ ...base, warp: 8, weft: 12 }, 'kpsi', 384);
    expect(v.warp).toBeCloseTo(16);
    expect(v.weft).toBeCloseTo(24);
    expect(v.warp / v.weft).toBeCloseTo(8 / 12);
    expect(derive(v).kpsi).toBeCloseTo(384);
    expect(derive(v).columns).toBe(1536);
    expect(derive(v).rows).toBe(2880);
  });
  it('does not mutate its input', () => {
    const copy = { ...base };
    applyEdit(base, 'kpsi', 50);
    expect(base).toEqual(copy);
  });
  it.each([0, -1, NaN, Infinity])('rejects %s', (bad) => {
    expect(() => applyEdit(base, 'warp', bad)).toThrow(RangeError);
  });
  it('RECOMPUTES lists exactly the fields that each edit changes', () => {
    const read = (v: DimensionValues): Record<DimensionField, number> => {
      const d = derive(v);
      return {
        width: v.widthIn,
        height: v.heightIn,
        warp: v.warp,
        weft: v.weft,
        knotWidth: d.knotWidthMm,
        knotHeight: d.knotHeightMm,
        kpsi: d.kpsi,
      };
    };
    const before = read(base);
    for (const field of Object.keys(RECOMPUTES) as DimensionField[]) {
      const after = read(applyEdit(base, field, before[field] * 2));
      const changed = (Object.keys(after) as DimensionField[]).filter(
        (f) => f !== field && Math.abs(after[f] - before[f]) > 1e-9,
      );
      expect(changed.sort()).toEqual([...RECOMPUTES[field]].sort());
    }
  });
});

describe('validation', () => {
  it('warns softly outside realistic ranges', () => {
    expect(softWarnings(base)).toEqual({});
    expect(softWarnings({ ...base, warp: 2.9 }).warp).toBeDefined();
    expect(softWarnings({ ...base, weft: 31 }).weft).toBeDefined();
    expect(softWarnings({ ...base, warp: 3, weft: 30 })).toEqual({});
    expect(softWarnings({ ...base, widthIn: 361 }).width).toBeDefined();
    expect(softWarnings({ ...base, heightIn: 360 }).height).toBeUndefined();
  });
  it('blocks only grids that cannot exist', () => {
    expect(gridProblem(derive(base))).toBeNull();
    expect(gridProblem(derive({ ...base, widthIn: 0.01 }))).toMatch(/smaller/);
    const huge = { ...base, widthIn: 400, heightIn: 400, warp: 40, weft: 40 };
    expect(gridProblem(derive(huge))).toMatch(/too large/);
  });
});
