import { describe, expect, it } from 'vitest';
import type { Palette } from '../domain/clustering';
import { hexToOklab, hexToRgb } from '../domain/color';
import type { GridSpec } from '../domain/dimensions';
import { buildMapPdf } from './mapPdf';
import { buildMapXlsx, columnName } from './mapXlsx';
import type { ExportInput } from './types';

const HEXES = ['#b03a2e', '#f4ecd8', '#2b4479'];

/** Blocks, single knots and an edge pattern, on a non-square grid. */
function sample(columns = 47, rows = 150): ExportInput {
  const indices = new Uint16Array(columns * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      indices[r * columns + c] = (c + r) % 13 === 0 ? 2 : c > 20 && r < 80 ? 1 : 0;
    }
  }
  const palette = HEXES.map((hex, i): Palette => ({
    id: i + 1,
    hex,
    oklab: hexToOklab(hex),
    knotCount: indices.filter((v) => v === i).length,
  }));
  const grid: GridSpec = { columns, rows, widthIn: columns / 8, heightIn: rows / 10 };
  return { indices, palette, grid, unit: 'ftin' };
}

async function inflate(data: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<string> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream(format));
  return new Response(stream).text();
}

const latin1 = (data: Uint8Array) => {
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return s;
};

describe('PDF knot map', () => {
  it('covers every knot exactly once, in its own color', async () => {
    const input = sample();
    const { columns, rows } = input.grid;
    const bytes = new Uint8Array(await (await buildMapPdf(input)).arrayBuffer());
    const file = latin1(bytes);

    // The page content is the stream without an image dictionary.
    const start = file.search(/obj\n<<\s+\/Filter \/FlateDecode/);
    const body = file.indexOf('stream\n', start) + 7;
    const length = Number(/\/Length (\d+)/.exec(file.slice(start))![1]);
    const content = await inflate(bytes.subarray(body, body + length), 'deflate');

    const painted = new Int8Array(columns * rows).fill(-1);
    const mapPart = content.slice(content.indexOf('/Map Do Q'), content.indexOf('0.5 g'));
    let color = -1;
    for (const line of mapPart.split('\n')) {
      const fill = /^([\d.]+) ([\d.]+) ([\d.]+) rg$/.exec(line);
      if (fill) {
        const rgb = fill.slice(1).map((v) => Math.round(Number(v) * 255));
        color = HEXES.findIndex((h) => hexToRgb(h).join() === rgb.join());
        expect(color).toBeGreaterThanOrEqual(0);
      }
      const rect = /^(\d+) (\d+) (\d+) (\d+) re$/.exec(line);
      if (!rect) continue;
      const [x, y, w, h] = rect.slice(1).map(Number) as [number, number, number, number];
      for (let r = y; r < y + h; r++) {
        for (let c = x; c < x + w; c++) {
          expect(painted[r * columns + c]).toBe(-1);
          painted[r * columns + c] = color;
        }
      }
    }
    expect([...painted]).toEqual([...input.indices]);
  });

  it('has valid object offsets', async () => {
    const file = latin1(new Uint8Array(await (await buildMapPdf(sample())).arrayBuffer()));
    const xref = Number(/startxref\n(\d+)/.exec(file)![1]);
    expect(file.startsWith('xref\n', xref)).toBe(true);
    const offsets = [...file.slice(xref).matchAll(/^(\d{10}) 00000 n/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(file.startsWith(`${i + 1} 0 obj`, o)).toBe(true));
  });

  it('stays within the page size PDF readers accept', async () => {
    for (const [columns, rows] of [[1080, 144], [40, 3000], [8, 8]] as const) {
      const input = sample(columns, rows);
      const file = latin1(new Uint8Array(await (await buildMapPdf(input)).arrayBuffer()));
      const [w, h] = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(file)!.slice(1).map(Number) as [number, number];
      expect(Math.max(w, h)).toBeLessThanOrEqual(14400);
    }
  });
});

describe('Excel knot map', () => {
  it('names columns the way Excel does', () => {
    expect([0, 25, 26, 701, 702, 1079, 16383].map(columnName)).toEqual([
      'A', 'Z', 'AA', 'ZZ', 'AAA', 'AON', 'XFD',
    ]);
  });

  it('has one cell per knot with that knot’s fill', async () => {
    const input = sample();
    const { columns, rows } = input.grid;
    const bytes = new Uint8Array(await (await buildMapXlsx(input)).arrayBuffer());
    const view = new DataView(bytes.buffer);

    const entries = new Map<string, string>();
    for (let at = 0; view.getUint32(at, true) === 0x04034b50; ) {
      const packed = view.getUint32(at + 18, true);
      const nameLength = view.getUint16(at + 26, true);
      const name = latin1(bytes.subarray(at + 30, at + 30 + nameLength));
      const data = at + 30 + nameLength;
      const text = await inflate(bytes.subarray(data, data + packed), 'deflate-raw');
      expect(text.length).toBe(view.getUint32(at + 22, true));
      entries.set(name, text);
      at = data + packed;
    }

    const styles = entries.get('xl/styles.xml')!;
    const fills = [...styles.matchAll(/<fgColor rgb="FF([0-9A-F]{6})"/g)].map((m) => m[1]!);
    const xfs = [...styles.slice(styles.indexOf('<cellXfs')).matchAll(/<xf [^>]*fillId="(\d+)"/g)];
    const sheet = entries.get('xl/worksheets/sheet1.xml')!;
    const colors = [...sheet.matchAll(/<c r="([A-Z]+)(\d+)" s="(\d+)"\/>/g)].map((m) => {
      const fill = Number(xfs[Number(m[3])]![1]);
      return `#${fills[fill - 2]!.toLowerCase()}`;
    });
    expect(colors).toHaveLength(columns * rows);
    expect(colors).toEqual([...input.indices].map((i) => HEXES[i]));
    expect(entries.get('xl/worksheets/sheet2.xml')).toContain(`<v>${input.palette[0]!.knotCount}</v>`);
  });
});
