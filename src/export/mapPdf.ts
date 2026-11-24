/**
 * The knot map as one very large PDF page. Cells and grid lines are vector
 * shapes, so every knot stays a sharp colored square at any zoom.
 */
import { hexToRgb } from '../domain/color';
import { formatCount, formatLength } from '../domain/dimensions';
import { colorId, percent } from '../domain/format';
import { Deflater, utf8, type Bytes } from './deflate';
import { HEAVY_EVERY, type ExportInput, type Progress } from './types';

/** Largest page side PDF readers accept (200 in). */
const MAX_PAGE = 14400;
/** Preferred size of a knot's shorter side, in points. */
const CELL = 12;
/** Viewers draw one huge path badly, so shapes are painted in batches. */
const SHAPES_PER_PATH = 400;
const BAND = 64;

/** Page measurements in units of one cell, scaled to points at the end. */
interface Layout {
  /** Points per unit. */
  unit: number;
  cellW: number;
  cellH: number;
  mapX: number;
  mapY: number;
  mapW: number;
  mapH: number;
  font: number;
  legendColumns: number;
  pageW: number;
  pageH: number;
}

const MARGIN = 8;
const RULER = 9;
const RULER_FONT = 2.4;
/** Header line and key entry sizes, in heading font sizes. */
const LINE = 2.2;
const ENTRY = 25;

function layoutPage({ grid, palette }: ExportInput): Layout {
  const knotW = grid.widthIn / grid.columns;
  const knotH = grid.heightIn / grid.rows;
  const shorter = Math.min(knotW, knotH);
  const cellW = knotW / shorter;
  const cellH = knotH / shorter;
  const mapW = grid.columns * cellW;
  const mapH = grid.rows * cellH;
  const font = Math.max(RULER_FONT, mapW / 80);
  const legendColumns = Math.max(1, Math.floor(mapW / (font * ENTRY)));
  const header = font * LINE * (2 + Math.ceil(palette.length / legendColumns)) + font * 2;
  const mapX = MARGIN + RULER;
  const mapY = MARGIN + header + RULER;
  // A very narrow rug still needs room for one line of text.
  const pageW = Math.max(mapX * 2 + mapW, MARGIN * 2 + font * (ENTRY + 20));
  const pageH = mapY + mapH + RULER + MARGIN;
  const unit = Math.min(CELL, MAX_PAGE / pageW, MAX_PAGE / pageH);
  return { unit, cellW, cellH, mapX, mapY, mapW, mapH, font, legendColumns, pageW, pageH };
}

const num = (v: number) => String(Number(v.toFixed(4)));
const fillColor = (hex: string) =>
  `${hexToRgb(hex)
    .map((v) => num(v / 255))
    .join(' ')} rg\n`;

export async function buildMapPdf(input: ExportInput, onProgress?: Progress): Promise<Blob> {
  const page = layoutPage(input);
  const file = new PdfFile();
  const { columns, rows } = input.grid;

  // Content first: its size is only known once it is compressed.
  const content = new Deflater('deflate');
  const write = (s: string) => content.write(utf8(s));

  // Page units: one cell, y downwards from the top-left corner.
  await write(`${num(page.unit)} 0 0 ${num(-page.unit)} 0 ${num(page.pageH * page.unit)} cm\n`);
  await write(header(input, page));
  await write(rulers(input, page));

  // A plain picture of the map lies underneath, so no hairline gaps show
  // between the shapes when the page is viewed small.
  await write(
    `q ${num(page.mapW)} 0 0 ${num(-page.mapH)} ${num(page.mapX)} ${num(page.mapY + page.mapH)} cm /Map Do Q\n`,
  );
  await write(
    `q ${num(page.cellW)} 0 0 ${num(page.cellH)} ${num(page.mapX)} ${num(page.mapY)} cm\n`,
  );
  for (let top = 0; top < rows; top += BAND) {
    await write(cells(input, top, Math.min(rows, top + BAND)));
    onProgress?.((top / rows) * 0.9);
  }
  await write('Q\n');
  await write(gridLines(input, page));

  const image = new Deflater('deflate');
  for (let r = 0; r < rows; r++) {
    await image.write(Uint8Array.from(input.indices.subarray(r * columns, (r + 1) * columns)));
  }
  onProgress?.(0.95);

  const lookup = input.palette
    .flatMap((p) => hexToRgb(p.hex))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  const imageId = file.stream(
    `/Type /XObject /Subtype /Image /Width ${columns} /Height ${rows} /BitsPerComponent 8 ` +
      `/ColorSpace [/Indexed /DeviceRGB ${input.palette.length - 1} <${lookup}>] /Interpolate false`,
    await image.finish(),
  );
  const contentId = file.stream('', await content.finish());
  const font = (name: string) =>
    file.object(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
  const regular = font('Helvetica');
  const bold = font('Helvetica-Bold');
  const pagesId = file.reserve();
  const pageId = file.object(
    `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.pageW * page.unit)} ${num(page.pageH * page.unit)}] ` +
      `/Contents ${contentId} 0 R /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> ` +
      `/XObject << /Map ${imageId} 0 R >> >> >>`,
  );
  file.object(`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`, pagesId);
  return file.finish(file.object(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
}

/**
 * Rectangles for a band of rows. Neighbouring knots of one color are joined
 * along the row, and then downwards where the next row matches.
 */
function cells({ indices, palette, grid }: ExportInput, top: number, bottom: number): string {
  const { columns } = grid;
  const shapes: string[][] = palette.map(() => []);
  interface Run {
    from: number;
    to: number;
    color: number;
    row: number;
  }
  let open = new Map<number, Run>();
  const close = (run: Run, row: number) =>
    shapes[run.color]!.push(`${run.from} ${run.row} ${run.to - run.from} ${row - run.row} re\n`);

  for (let r = top; r < bottom; r++) {
    const next = new Map<number, Run>();
    const base = r * columns;
    for (let c = 0; c < columns; ) {
      const from = c;
      const color = indices[base + c]!;
      while (c < columns && indices[base + c] === color) c++;
      const above = open.get(from);
      if (above && above.to === c && above.color === color) {
        next.set(from, above);
        open.delete(from);
      } else {
        next.set(from, { from, to: c, color, row: r });
      }
    }
    for (const run of open.values()) close(run, r);
    open = next;
  }
  for (const run of open.values()) close(run, bottom);

  let out = '';
  shapes.forEach((list, color) => {
    if (list.length === 0) return;
    out += fillColor(palette[color]!.hex);
    for (let i = 0; i < list.length; i += SHAPES_PER_PATH) {
      out += `${list.slice(i, i + SHAPES_PER_PATH).join('')}f\n`;
    }
  });
  return out;
}

/** Lines are thin filled shapes: viewers thicken strokes when zoomed out. */
function gridLines({ grid }: ExportInput, page: Layout): string {
  let out = '';
  for (const heavy of [false, true]) {
    const t = heavy ? 0.16 : 0.06;
    const shapes: string[] = [];
    const isHeavy = (n: number, count: number) => n % HEAVY_EVERY === 0 || n === count;
    for (let c = 0; c <= grid.columns; c++) {
      if (isHeavy(c, grid.columns) !== heavy) continue;
      const x = page.mapX + c * page.cellW - t / 2;
      shapes.push(`${num(x)} ${num(page.mapY)} ${t} ${num(page.mapH)} re\n`);
    }
    for (let r = 0; r <= grid.rows; r++) {
      if (isHeavy(r, grid.rows) !== heavy) continue;
      const y = page.mapY + r * page.cellH - t / 2;
      shapes.push(`${num(page.mapX)} ${num(y)} ${num(page.mapW)} ${t} re\n`);
    }
    out += heavy ? '0.1 g\n' : '0.5 g\n';
    for (let i = 0; i < shapes.length; i += 50) out += `${shapes.slice(i, i + 50).join('')}f\n`;
  }
  return out;
}

/** Text at a baseline. Page units point down, so glyphs are flipped back. */
function label(x: number, y: number, size: number, value: string, font = 'F1'): string {
  const safe = value.replace(/[\\()]/g, '\\$&');
  return `BT /${font} ${num(size)} Tf 1 0 0 -1 ${num(x)} ${num(y)} Tm (${safe}) Tj ET\n`;
}

/** Width of digits and thousands separators in Helvetica. */
const digitsWidth = (value: string, size: number) =>
  [...value].reduce((w, ch) => w + (ch === ',' || ch === '.' ? 0.278 : 0.556), 0) * size;

function header({ indices, palette, grid, unit }: ExportInput, page: Layout): string {
  const { font } = page;
  const x = MARGIN + RULER;
  let y = MARGIN + font * 1.4;
  let out = '0.1 g\n';
  out += label(x, y, font * 1.4, 'Knot map', 'F2');
  y += font * LINE;
  out += label(
    x,
    y,
    font,
    `${formatLength(grid.widthIn, unit)} x ${formatLength(grid.heightIn, unit)}, ` +
      `${formatCount(grid.columns)} columns x ${formatCount(grid.rows)} rows, ` +
      `${formatCount(indices.length)} knots, ${palette.length} ${palette.length === 1 ? 'color' : 'colors'}`,
  );
  y += font * 0.6;
  palette.forEach((p, i) => {
    const left = x + (i % page.legendColumns) * font * ENTRY;
    const top = y + Math.floor(i / page.legendColumns) * font * LINE;
    const base = top + font * 1.55;
    const swatch = `${num(left)} ${num(top + font * 0.3)} ${num(font * 3)} ${num(font * 1.7)} re`;
    out += `${fillColor(p.hex)}${swatch} f\n0.1 g 0.3 G ${num(font * 0.06)} w ${swatch} S\n`;
    out += label(left + font * 3.7, base, font, colorId(p.id), 'F2');
    out += label(left + font * 6.4, base, font, p.hex);
    const count = formatCount(p.knotCount);
    out += label(left + font * 16.5 - digitsWidth(count, font), base, font, count);
    out += label(left + font * 17.3, base, font, `knots, ${percent(p.knotCount / indices.length)}`);
  });
  return out;
}

/** Knot numbers on all four sides. */
function rulers({ grid }: ExportInput, page: Layout): string {
  const size = RULER_FONT;
  let out = '0.25 g\n';
  for (let c = HEAVY_EVERY; c <= grid.columns; c += HEAVY_EVERY) {
    const text = String(c);
    const x = page.mapX + (c - 0.5) * page.cellW - digitsWidth(text, size) / 2;
    out += label(x, page.mapY - 1.5, size, text);
    out += label(x, page.mapY + page.mapH + 1.5 + size * 0.72, size, text);
  }
  for (let r = HEAVY_EVERY; r <= grid.rows; r += HEAVY_EVERY) {
    const text = String(r);
    const y = page.mapY + (r - 0.5) * page.cellH + size * 0.36;
    out += label(page.mapX - 1.5 - digitsWidth(text, size), y, size, text);
    out += label(page.mapX + page.mapW + 1.5, y, size, text);
  }
  return out;
}

/** Collects numbered PDF objects and writes the file around them. */
class PdfFile {
  private readonly parts: Bytes[] = [];
  private readonly offsets: number[] = [0];
  private size = 0;

  constructor() {
    this.push(utf8('%PDF-1.6\n'), Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a));
  }

  reserve(): number {
    return this.offsets.push(0) - 1;
  }

  object(body: string, id = this.reserve()): number {
    this.offsets[id] = this.size;
    this.push(utf8(`${id} 0 obj\n${body}\nendobj\n`));
    return id;
  }

  stream(entries: string, data: { parts: Bytes[]; size: number }): number {
    const id = this.reserve();
    this.offsets[id] = this.size;
    this.push(
      utf8(`${id} 0 obj\n<< ${entries} /Filter /FlateDecode /Length ${data.size} >>\nstream\n`),
      ...data.parts,
      utf8('\nendstream\nendobj\n'),
    );
    return id;
  }

  finish(rootId: number): Blob {
    const start = this.size;
    const table = this.offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
      .join('');
    this.push(
      utf8(
        `xref\n0 ${this.offsets.length}\n0000000000 65535 f \n${table}` +
          `trailer\n<< /Size ${this.offsets.length} /Root ${rootId} 0 R >>\nstartxref\n${start}\n%%EOF\n`,
      ),
    );
    return new Blob(this.parts, { type: 'application/pdf' });
  }

  private push(...parts: Bytes[]): void {
    for (const part of parts) {
      this.parts.push(part);
      this.size += part.length;
    }
  }
}
