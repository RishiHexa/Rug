/**
 * Checks the analysis against real rug photos that it once read wrongly, so
 * a fix for one photo cannot quietly break another. Photos stay private in
 * dev/photos (not in git). For each `name.raw` (made by dev/to-raw.py) with a
 * `name.expect.json` beside it, the analysis must match what is expected:
 *
 *   {
 *     "bands": ["plain", "guard", "main", ...],   kinds, outermost first
 *     "edges": { "top": [60, 81, ...] },           inner edges in px, any sides
 *     "within": 3,                                 px allowed off each edge
 *     "spandrel": true, "pocket": true, "pendants": true,
 *     "medallion": { "x": [340, 355], "width": [590, 620] }   ranges, any of x/y/width/height
 *   }
 *
 * Skipped when there are no photos.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyseRug, type BandKind, type Side } from '../src/segments/analyse';
import type { Rect } from '../src/segments/mask';

interface Expect {
  bands?: BandKind[];
  edges?: Partial<Record<Side, number[]>>;
  within?: number;
  spandrel?: boolean;
  pocket?: boolean;
  pendants?: boolean;
  medallion?: Partial<Record<keyof Rect, [number, number]>> | boolean;
}

const folder = join(__dirname, 'photos');
const cases = existsSync(folder)
  ? readdirSync(folder)
      .filter((f) => f.endsWith('.expect.json'))
      .map((f) => f.replace(/\.expect\.json$/, ''))
      .filter((name) => existsSync(join(folder, `${name}.raw`)))
  : [];

(cases.length > 0 ? describe : describe.skip)('real rug photos', () => {
  for (const name of cases) {
    it(name, () => {
      const want = JSON.parse(readFileSync(join(folder, `${name}.expect.json`), 'utf8')) as Expect;
      const raw = readFileSync(join(folder, `${name}.raw`));
      const width = raw.readUInt32LE(0);
      const height = raw.readUInt32LE(4);
      const px = { width, height, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, width * height * 4) };
      const a = analyseRug(px);
      const f = a.field;

      if (want.bands) expect(a.bands.map((b) => b.kind), 'band kinds').toEqual(want.bands);
      for (const [side, depths] of Object.entries(want.edges ?? {}) as [Side, number[]][]) {
        const got = a.bands.map((b) => Math.round(b.inner[side]));
        depths.forEach((d, i) =>
          expect(Math.abs((got[i] ?? Infinity) - d), `${side} edge ${i + 1}: ${got[i]} for ${d}`).toBeLessThanOrEqual(want.within ?? 3),
        );
      }
      if (want.spandrel !== undefined) expect(f.spandrel !== null, 'spandrel').toBe(want.spandrel);
      if (want.pocket !== undefined) expect(f.pocket !== null, 'pocket').toBe(want.pocket);
      if (want.pendants !== undefined) expect(f.pendants !== null, 'pendants').toBe(want.pendants);
      if (want.medallion !== undefined) {
        expect(f.medallion !== null, 'medallion').toBe(want.medallion !== false);
        if (typeof want.medallion === 'object' && f.medallion) {
          for (const [k, [lo, hi]] of Object.entries(want.medallion) as [keyof Rect, [number, number]][]) {
            const v = Math.round(f.medallion.box[k]);
            expect(v >= lo && v <= hi, `medallion ${k} ${v} not in ${lo}..${hi}`).toBe(true);
          }
        }
      }
    });
  }
});
