/**
 * Runs the analysis on a real rug picture and writes what it found, for
 * tuning. Skipped unless RUG_FIXTURE points at a raw RGBA file (4-byte width,
 * 4-byte height, then pixels) and RUG_OUT at a folder.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { analyseRug } from '../src/segments/analyse';
import type { Mask } from '../src/segments/mask';

const fixture = process.env.RUG_FIXTURE;
const out = process.env.RUG_OUT;
const run = fixture && out && existsSync(fixture) ? describe : describe.skip;

const pgm = (m: Mask) =>
  Buffer.concat([Buffer.from(`P5 ${m.width} ${m.height} 255\n`), Buffer.from(m.data.map((v) => v * 255))]);

run('analyse a real rug', () => {
  it('writes the analysis', () => {
    const raw = readFileSync(fixture!);
    const width = raw.readUInt32LE(0);
    const height = raw.readUInt32LE(4);
    const px = { width, height, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, width * height * 4) };
    const t = performance.now();
    const debug: Record<string, Mask> = {};
    const a = analyseRug(px, undefined, debug);
    for (const [name, m] of Object.entries(debug)) writeFileSync(join(out!, `dbg_${name}.pgm`), pgm(m));
    const ms = performance.now() - t;
    const { field } = a;
    const regions: Record<string, { box: unknown; mask: Mask } | null> = {
      spandrel: field.spandrel,
      pocket: field.pocket,
      medallion: field.medallion,
      pendantTop: field.pendants?.top ?? null,
      pendantBottom: field.pendants?.bottom ?? null,
    };
    for (const [name, r] of Object.entries(regions)) if (r) writeFileSync(join(out!, `${name}.pgm`), pgm(r.mask));
    field.motifs.forEach((m, i) => writeFileSync(join(out!, `motif${i}.pgm`), pgm(m.mask)));
    const summary = {
      ms,
      margin: a.margin,
      bands: a.bands,
      field: {
        ...field,
        spandrel: field.spandrel && { box: field.spandrel.box, color: field.spandrel.color },
        pocket: field.pocket && { box: field.pocket.box, color: field.pocket.color },
        medallion: field.medallion?.box,
        pendants: field.pendants && { top: field.pendants.top.box, bottom: field.pendants.bottom?.box },
        motifs: field.motifs.map((m) => ({ box: m.box, count: m.count })),
        notes: field.notes,
      },
    };
    writeFileSync(join(out!, 'analysis.json'), JSON.stringify(summary, null, 1));
  });
});
