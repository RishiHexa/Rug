import { useId, useState, type ReactNode } from 'react';
import { Button, Facts, Heading, Notice } from '../components/ui';
import {
  cmToIn,
  derive,
  formatCount,
  formatLength,
  formatNumber,
  ftInToIn,
  gridProblem,
  inToCm,
  inToFtIn,
  isPositive,
  RECOMPUTES,
  softWarnings,
  type DimensionField,
  type Unit,
} from '../domain/dimensions';
import { requestEditDimensions } from '../state/editActions';
import { useApp } from '../state/store';

/** Text inputs. Width and height have two of them in ft + in mode. */
type InputId = DimensionField | 'widthFt' | 'widthRest' | 'heightFt' | 'heightRest';

const FIELD_OF: Record<InputId, DimensionField> = {
  width: 'width',
  widthFt: 'width',
  widthRest: 'width',
  height: 'height',
  heightFt: 'height',
  heightRest: 'height',
  warp: 'warp',
  weft: 'weft',
  knotWidth: 'knotWidth',
  knotHeight: 'knotHeight',
  kpsi: 'kpsi',
};

type Drafts = Partial<Record<InputId, string>>;

const UNITS: { unit: Unit; label: string }[] = [
  { unit: 'ftin', label: 'ft + in' },
  { unit: 'in', label: 'in' },
  { unit: 'cm', label: 'cm' },
];

function parseNumber(text: string): number {
  const t = text.trim();
  return /^\d*\.?\d*$/.test(t) && /\d/.test(t) ? Number(t) : NaN;
}

/** In ft + in mode an empty half counts as zero. */
const parsePart = (text: string) => (text.trim() === '' ? 0 : parseNumber(text));

export function Step1Dimensions() {
  const locked = useApp((s) => s.dimensions.locked);
  return locked ? <LockedSummary /> : <DimensionsForm />;
}

function LockedSummary() {
  const dims = useApp((s) => s.dimensions);
  const goTo = useApp((s) => s.goTo);
  const d = derive(dims);
  return (
    <div className="mx-auto max-w-xl px-5 py-10">
      <Heading title="Dimensions are locked">
        Every later step uses this grid. Editing it starts the design again.
      </Heading>
      <div className="my-6 rounded-lg border border-line bg-panel px-5 py-2">
        <Facts
          rows={[
            [
              'Rug size',
              `${formatLength(d.actualWidthIn, dims.unit)} × ${formatLength(d.actualHeightIn, dims.unit)}`,
            ],
            ['Knot grid', `${formatCount(d.columns)} × ${formatCount(d.rows)}`],
            ['Total knots', formatCount(d.totalKnots)],
            ['Warp × weft', `${formatNumber(dims.warp)} × ${formatNumber(dims.weft)} per in`],
            ['Knot size', `${formatNumber(d.knotWidthMm)} × ${formatNumber(d.knotHeightMm)} mm`],
            ['KPSI', formatNumber(d.kpsi)],
          ]}
        />
      </div>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => goTo(2)}>
          Go to design
        </Button>
        <Button onClick={() => void requestEditDimensions()}>Edit</Button>
      </div>
    </div>
  );
}

function DimensionsForm() {
  const dims = useApp((s) => s.dimensions);
  const { editDimension, setUnit, lockDimensions } = useApp.getState();
  const [drafts, setDrafts] = useState<Drafts>({});
  const [driver, setDriver] = useState<DimensionField | null>(null);

  const d = derive(dims);
  const warnings = softWarnings(dims);

  const canonicalText = (id: InputId): string => {
    const cm = dims.unit === 'cm';
    switch (id) {
      case 'width':
        return formatNumber(cm ? inToCm(dims.widthIn) : dims.widthIn);
      case 'height':
        return formatNumber(cm ? inToCm(dims.heightIn) : dims.heightIn);
      case 'widthFt':
        return String(inToFtIn(dims.widthIn).ft);
      case 'widthRest':
        return formatNumber(inToFtIn(dims.widthIn).inches);
      case 'heightFt':
        return String(inToFtIn(dims.heightIn).ft);
      case 'heightRest':
        return formatNumber(inToFtIn(dims.heightIn).inches);
      case 'warp':
        return formatNumber(dims.warp);
      case 'weft':
        return formatNumber(dims.weft);
      case 'knotWidth':
        return formatNumber(d.knotWidthMm, 3);
      case 'knotHeight':
        return formatNumber(d.knotHeightMm, 3);
      case 'kpsi':
        return formatNumber(d.kpsi);
    }
  };

  const textIn = (from: Drafts, id: InputId) => from[id] ?? canonicalText(id);

  /** Canonical value of a field as currently typed; NaN when unusable. */
  const valueIn = (from: Drafts, field: DimensionField): number => {
    if (field === 'width' || field === 'height') {
      if (dims.unit === 'ftin') {
        return ftInToIn(
          parsePart(textIn(from, `${field}Ft`)),
          parsePart(textIn(from, `${field}Rest`)),
        );
      }
      const v = parseNumber(textIn(from, field));
      return dims.unit === 'cm' ? cmToIn(v) : v;
    }
    return parseNumber(textIn(from, field));
  };

  const fieldInvalid = (from: Drafts, field: DimensionField) =>
    (Object.keys(from) as InputId[]).some((id) => FIELD_OF[id] === field) &&
    !isPositive(valueIn(from, field));

  const change = (id: InputId, text: string) => {
    const field = FIELD_OF[id];
    const next: Drafts = { ...drafts, [id]: text };
    setDriver(field);
    const value = valueIn(next, field);
    if (isPositive(value)) {
      editDimension(field, value);
      for (const other of RECOMPUTES[field]) delete next[other];
    }
    setDrafts(next);
  };

  const blur = (id: InputId) => {
    if (fieldInvalid(drafts, FIELD_OF[id])) return;
    const next = { ...drafts };
    for (const key of Object.keys(next) as InputId[]) {
      if (FIELD_OF[key] === FIELD_OF[id]) delete next[key];
    }
    setDrafts(next);
  };

  const changeUnit = (unit: Unit) => {
    const next = { ...drafts };
    for (const key of Object.keys(next) as InputId[]) {
      if (FIELD_OF[key] === 'width' || FIELD_OF[key] === 'height') delete next[key];
    }
    setDrafts(next);
    setUnit(unit);
  };

  const anyInvalid = Object.values(FIELD_OF).some((f) => fieldInvalid(drafts, f));
  const problem = gridProblem(d);

  const input = (id: InputId, label: string, suffix: string) => (
    <NumberInput
      label={label}
      suffix={suffix}
      value={textIn(drafts, id)}
      invalid={fieldInvalid(drafts, FIELD_OF[id])}
      driver={driver === FIELD_OF[id]}
      onChange={(t) => change(id, t)}
      onBlur={() => blur(id)}
    />
  );

  const actual = (inches: number, count: number, noun: string) => (
    <p className="text-muted">
      Actual: {formatLength(inches, dims.unit)} — rounded to {formatCount(count)} {noun}
    </p>
  );
  const actualNote = {
    width: d.widthRounded && actual(d.actualWidthIn, d.columns, 'knots'),
    height: d.heightRounded && actual(d.actualHeightIn, d.rows, 'rows'),
  };

  const size = (field: 'width' | 'height', label: string) => (
    <Field
      legend={label}
      driver={driver === field}
      error={fieldInvalid(drafts, field)}
      warning={warnings[field]}
      note={actualNote[field]}
    >
      {dims.unit === 'ftin' ? (
        <div className="grid grid-cols-2 gap-2">
          {input(`${field}Ft`, `${label}, feet`, 'ft')}
          {input(`${field}Rest`, `${label}, inches`, 'in')}
        </div>
      ) : (
        input(field, label, dims.unit)
      )}
    </Field>
  );

  return (
    <form
      className="mx-auto grid max-w-5xl gap-10 px-5 py-10 lg:grid-cols-[1fr_320px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!anyInvalid && !problem) lockDimensions();
      }}
    >
      <div className="space-y-8">
        <Heading title="Specify dimensions">
          The rug size and knot density set the grid that the design is mapped onto.
        </Heading>

        <section>
          <div className="mb-4 flex items-center justify-between border-b border-line pb-2">
            <h3 className="font-semibold">Rug size</h3>
            <div role="group" aria-label="Unit" className="flex rounded-md border border-line-strong">
              {UNITS.map(({ unit, label }) => (
                <button
                  key={unit}
                  type="button"
                  aria-pressed={dims.unit === unit}
                  onClick={() => changeUnit(unit)}
                  className="min-h-9 px-3 text-sm first:rounded-l-[5px] last:rounded-r-[5px] aria-pressed:bg-accent aria-pressed:text-white"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {size('width', 'Width')}
            {size('height', 'Height (length)')}
          </div>
        </section>

        <section>
          <h3 className="mb-4 border-b border-line pb-2 font-semibold">Knot density</h3>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field
              legend="Warp"
              driver={driver === 'warp'}
              error={fieldInvalid(drafts, 'warp')}
              warning={warnings.warp}
            >
              {input('warp', 'Warp, knots per inch across the width', 'knots/in')}
            </Field>
            <Field
              legend="Weft"
              driver={driver === 'weft'}
              error={fieldInvalid(drafts, 'weft')}
              warning={warnings.weft}
            >
              {input('weft', 'Weft, knot rows per inch along the length', 'rows/in')}
            </Field>
            <Field legend="KPSI" driver={driver === 'kpsi'} error={fieldInvalid(drafts, 'kpsi')}>
              {input('kpsi', 'Knots per square inch', 'knots/in²')}
            </Field>
          </div>
          <p className="mt-1 text-sm text-muted">
            Warp × Weft = KPSI. Changing one updates the others. Changing KPSI keeps the warp : weft
            ratio.
          </p>
        </section>

        <section>
          <h3 className="mb-4 border-b border-line pb-2 font-semibold">Knot size</h3>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              legend="Knot width"
              driver={driver === 'knotWidth'}
              error={fieldInvalid(drafts, 'knotWidth')}
              note={<p className="text-muted">{formatNumber(d.knotWidthIn, 4)} in</p>}
            >
              {input('knotWidth', 'Knot width', 'mm')}
            </Field>
            <Field
              legend="Knot height"
              driver={driver === 'knotHeight'}
              error={fieldInvalid(drafts, 'knotHeight')}
              note={<p className="text-muted">{formatNumber(d.knotHeightIn, 4)} in</p>}
            >
              {input('knotHeight', 'Knot height', 'mm')}
            </Field>
          </div>
        </section>
      </div>

      <aside className="self-start rounded-lg border border-line bg-panel p-5 lg:sticky lg:top-10">
        <h3 className="mb-2 font-semibold">Knot grid</h3>
        <div aria-live="polite">
          <Facts
            rows={[
              ['Columns', formatCount(d.columns)],
              ['Rows', formatCount(d.rows)],
              ['Total knots', formatCount(d.totalKnots)],
              ['Actual width', formatLength(d.actualWidthIn, dims.unit)],
              ['Actual height', formatLength(d.actualHeightIn, dims.unit)],
            ]}
          />
        </div>
        <div className="mt-5 space-y-3">
          {problem && <Notice tone="error">{problem}</Notice>}
          {anyInvalid && <Notice tone="error">Correct the marked fields to continue.</Notice>}
          <Button type="submit" variant="primary" className="w-full" disabled={anyInvalid || !!problem}>
            Lock dimensions &amp; continue
          </Button>
        </div>
      </aside>
    </form>
  );
}

function Field({
  legend,
  driver,
  error,
  warning,
  note,
  children,
}: {
  legend: string;
  driver: boolean;
  error: boolean;
  warning?: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <fieldset>
      <legend className="mb-1 flex items-center gap-2 text-sm font-medium">
        {legend}
        {driver && (
          <span className="rounded bg-accent-soft px-1.5 text-xs font-medium text-accent">driver</span>
        )}
      </legend>
      {children}
      {/* Space is reserved so a message never moves the field being typed in. */}
      <div className="mt-1 min-h-[21px] text-sm">
        {error ? (
          <p role="alert" className="text-danger">
            Enter a number greater than 0.
          </p>
        ) : (
          <>
            {note}
            {warning && <p className="text-warn">{warning}</p>}
          </>
        )}
      </div>
    </fieldset>
  );
}

function NumberInput({
  label,
  suffix,
  value,
  invalid,
  driver,
  onChange,
  onBlur,
}: {
  label: string;
  suffix: string;
  value: string;
  invalid: boolean;
  driver: boolean;
  onChange(text: string): void;
  onBlur(): void;
}) {
  const id = useId();
  const border = invalid ? 'border-danger' : driver ? 'border-accent' : 'border-line-strong';
  return (
    <div
      className={`flex min-h-11 items-center rounded-md border bg-panel focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${border}`}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="w-full min-w-0 bg-transparent px-3 text-base outline-none"
      />
      <span className="shrink-0 pr-3 text-sm text-muted" aria-hidden>
        {suffix}
      </span>
    </div>
  );
}
