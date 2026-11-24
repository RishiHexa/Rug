/**
 * The knot map as an Excel workbook: one filled cell per knot with row and
 * column numbers that stay in view, and a second sheet with the color key.
 */
import { formatCount, formatLength } from '../domain/dimensions';
import { colorId } from '../domain/format';
import { HEAVY_EVERY, type ExportInput, type Progress } from './types';
import { ZipWriter } from './zip';

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006';
const TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

/** Cell formats before the knot formats; see `styles`. */
const COLUMN_NUMBER = 1;
const ROW_NUMBER = 2;
const BOLD = 3;
const PERCENT = 4;
const COUNT = 5;
const FIRST_KNOT = 6;
/** Plain, heavy right, heavy bottom, heavy both. */
const BORDERS = 4;

const ROWS_PER_CHUNK = 100;
/** Points per pixel at the 96 dpi Excel assumes. */
const PT = 0.75;
/** The shorter side of a knot cell, in pixels. */
const CELL_PX = 20;

const knotStyle = (color: number, column: number, row: number) =>
  FIRST_KNOT +
  color * BORDERS +
  ((column + 1) % HEAVY_EVERY === 0 ? 1 : 0) +
  ((row + 1) % HEAVY_EVERY === 0 ? 2 : 0);

export async function buildMapXlsx(input: ExportInput, onProgress?: Progress): Promise<Blob> {
  const zip = new ZipWriter();
  await zip.add('[Content_Types].xml', [
    `${HEAD}<Types xmlns="${PACKAGE}/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/xl/workbook.xml" ContentType="${TYPE}.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="${TYPE}.styles+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${TYPE}.worksheet+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="${TYPE}.worksheet+xml"/>` +
      '</Types>',
  ]);
  await zip.add('_rels/.rels', [
    `${HEAD}<Relationships xmlns="${PACKAGE}/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  ]);
  await zip.add('xl/workbook.xml', [
    `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>` +
      '<sheet name="Knot map" sheetId="1" r:id="rId1"/><sheet name="Color key" sheetId="2" r:id="rId2"/>' +
      '</sheets></workbook>',
  ]);
  await zip.add('xl/_rels/workbook.xml.rels', [
    `${HEAD}<Relationships xmlns="${PACKAGE}/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/>` +
      `<Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  ]);
  await zip.add('xl/styles.xml', [styles(input)]);
  await zip.add('xl/worksheets/sheet1.xml', mapSheet(input, onProgress));
  await zip.add('xl/worksheets/sheet2.xml', [keySheet(input)]);
  return zip.finish(`${TYPE}.sheet`);
}

function styles({ palette }: ExportInput): string {
  const fills = palette
    .map((p) => {
      const rgb = p.hex.slice(1).toUpperCase();
      return `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
    })
    .join('');
  const side = (name: string, heavy: boolean) =>
    heavy
      ? `<${name} style="medium"><color rgb="FF1A1814"/></${name}>`
      : `<${name} style="thin"><color rgb="FF8C867B"/></${name}>`;
  // Only right and bottom edges, so neighbouring cells never disagree.
  const borders = Array.from(
    { length: BORDERS },
    (_, i) =>
      `<border><left/>${side('right', (i & 1) > 0)}<top/>${side('bottom', (i & 2) > 0)}<diagonal/></border>`,
  ).join('');
  const plain = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="bottom" textRotation="90"/></xf>',
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1"/>',
    '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>',
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>',
  ];
  const knots = palette.flatMap((_, color) =>
    Array.from(
      { length: BORDERS },
      (_, b) =>
        `<xf numFmtId="0" fontId="0" fillId="${color + 2}" borderId="${b + 1}" applyFill="1" applyBorder="1"/>`,
    ),
  );
  const xfs = [...plain, ...knots];
  return (
    `${HEAD}<styleSheet xmlns="${MAIN}">` +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><sz val="8"/><color rgb="FF625C51"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    `<fills count="${palette.length + 2}"><fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>${fills}</fills>` +
    `<borders count="${BORDERS + 1}"><border><left/><right/><top/><bottom/><diagonal/></border>${borders}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  );
}

export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

const text = (ref: string, style: number, value: string) =>
  `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;

function* mapSheet({ indices, grid }: ExportInput, onProgress?: Progress): Generator<string> {
  const { columns, rows } = grid;
  const knotW = grid.widthIn / columns;
  const knotH = grid.heightIn / rows;
  const unit = CELL_PX / Math.min(knotW, knotH);
  // Excel stores widths in characters of 7 px, padding included.
  const widthChars = ((knotW * unit) / 7).toFixed(4);
  const heightPt = (knotH * unit * PT).toFixed(2);
  const names = Array.from({ length: columns + 1 }, (_, c) => columnName(c));

  yield `${HEAD}<worksheet xmlns="${MAIN}"><sheetViews>` +
    '<sheetView showGridLines="0" tabSelected="1" zoomScale="60" workbookViewId="0">' +
    '<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>' +
    `<sheetFormatPr defaultRowHeight="${heightPt}" customHeight="1"/>` +
    `<cols><col min="1" max="1" width="6.5" customWidth="1"/>` +
    `<col min="2" max="${columns + 1}" width="${widthChars}" customWidth="1"/></cols><sheetData>` +
    '<row r="1" ht="32" customHeight="1">' +
    Array.from({ length: columns }, (_, c) =>
      text(`${names[c + 1]}1`, COLUMN_NUMBER, String(c + 1)),
    ).join('') +
    '</row>';

  let chunk = '';
  for (let r = 0; r < rows; r++) {
    const line = r + 2;
    chunk += `<row r="${line}" ht="${heightPt}" customHeight="1">${text(`A${line}`, ROW_NUMBER, String(r + 1))}`;
    const cells: string[] = new Array<string>(columns);
    for (let c = 0; c < columns; c++) {
      cells[c] = `<c r="${names[c + 1]}${line}" s="${knotStyle(indices[r * columns + c]!, c, r)}"/>`;
    }
    chunk += `${cells.join('')}</row>`;
    if ((r + 1) % ROWS_PER_CHUNK === 0) {
      yield chunk;
      chunk = '';
      onProgress?.((r + 1) / rows);
    }
  }
  yield `${chunk}</sheetData></worksheet>`;
}

function keySheet({ indices, palette, grid, unit }: ExportInput): string {
  const facts: [string, string][] = [
    ['Rug size', `${formatLength(grid.widthIn, unit)} x ${formatLength(grid.heightIn, unit)}`],
    ['Knot grid', `${formatCount(grid.columns)} columns x ${formatCount(grid.rows)} rows`],
    ['Total knots', formatCount(indices.length)],
  ];
  const rows = [
    ...facts.map(([label, value], i) => [text(`A${i + 1}`, BOLD, label), text(`B${i + 1}`, 0, value)].join('')),
    '',
    ['ID', 'Color', 'Hex', 'Knots', '% of rug'].map((t, c) => text(`${columnName(c)}5`, BOLD, t)).join(''),
    ...palette.map((p, i) => {
      const n = i + 6;
      return (
        text(`A${n}`, 0, colorId(p.id)) +
        `<c r="B${n}" s="${FIRST_KNOT + i * BORDERS}"/>` +
        text(`C${n}`, 0, p.hex) +
        `<c r="D${n}" s="${COUNT}"><v>${p.knotCount}</v></c>` +
        `<c r="E${n}" s="${PERCENT}"><v>${p.knotCount / indices.length}</v></c>`
      );
    }),
  ];
  return (
    `${HEAD}<worksheet xmlns="${MAIN}"><cols><col min="1" max="1" width="12" customWidth="1"/>` +
    '<col min="2" max="2" width="30" customWidth="1"/><col min="3" max="5" width="12" customWidth="1"/></cols><sheetData>' +
    rows.map((cells, i) => `<row r="${i + 1}">${cells}</row>`).join('') +
    '</sheetData></worksheet>'
  );
}
