import { useId, useState, type ReactNode } from 'react';
import { cmToIn, formatNumber, inToCm, type Unit } from '../domain/dimensions';

/** Small numeric field that never reformats while it is being typed in. */
function NumberField({
  label,
  suffix,
  text,
  onText,
  hideLabel = false,
  placeholder,
}: {
  label: string;
  suffix: string;
  text: string;
  /** Returns whether the text was usable. */
  onText(text: string): boolean;
  hideLabel?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1 block text-sm'}>
        {label}
      </label>
      <div
        className={`flex min-h-9 items-center rounded-md border bg-panel focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent ${
          invalid ? 'border-danger' : 'border-line-strong'
        }`}
      >
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={draft ?? text}
          placeholder={placeholder}
          aria-invalid={invalid}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(!onText(e.target.value));
          }}
          onBlur={() => {
            setDraft(null);
            setInvalid(false);
          }}
          className="w-full min-w-0 bg-transparent px-2 text-sm outline-none"
        />
        <span className="shrink-0 pr-2 text-xs text-muted" aria-hidden>
          {suffix}
        </span>
      </div>
    </div>
  );
}

const parse = (text: string): number => (/^-?\d*\.?\d+$|^-?\d+\.$/.test(text.trim()) ? Number(text) : NaN);

/** Short lengths are always shown in inches or centimeters. */
export const shortUnit = (unit: Unit): 'in' | 'cm' => (unit === 'cm' ? 'cm' : 'in');

export function formatShort(inches: number, unit: Unit): string {
  const cm = unit === 'cm';
  return `${formatNumber(cm ? inToCm(inches) : inches, cm ? 1 : 2)} ${shortUnit(unit)}`;
}

export function LengthField({
  label,
  value,
  unit,
  min = 0,
  onChange,
  hideLabel,
}: {
  label: string;
  value: number;
  unit: Unit;
  min?: number;
  onChange(inches: number): void;
  hideLabel?: boolean;
}) {
  const cm = unit === 'cm';
  return (
    <NumberField
      label={label}
      hideLabel={hideLabel}
      suffix={shortUnit(unit)}
      text={formatNumber(cm ? inToCm(value) : value)}
      onText={(text) => {
        const v = cm ? cmToIn(parse(text)) : parse(text);
        if (!Number.isFinite(v) || v < min) return false;
        onChange(v);
        return true;
      }}
    />
  );
}

/** A length that may be left empty. */
export function LimitField({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: number | null;
  unit: Unit;
  onChange(inches: number | null): void;
}) {
  const cm = unit === 'cm';
  return (
    <NumberField
      label={label}
      suffix={shortUnit(unit)}
      placeholder="no limit"
      text={value === null ? '' : formatNumber(cm ? inToCm(value) : value)}
      onText={(text) => {
        if (text.trim() === '') {
          onChange(null);
          return true;
        }
        const v = cm ? cmToIn(parse(text)) : parse(text);
        if (!Number.isFinite(v) || v <= 0) return false;
        onChange(v);
        return true;
      }}
    />
  );
}

/** A whole number within limits. */
export function CountField({
  label,
  value,
  min,
  max,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange(value: number): void;
}) {
  return (
    <NumberField
      label={label}
      suffix={suffix}
      text={String(value)}
      onText={(text) => {
        const v = parse(text);
        if (!Number.isInteger(v) || v < min || v > max) return false;
        onChange(v);
        return true;
      }}
    />
  );
}

export function PercentField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  /** 1 is 100%. */
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  return (
    <NumberField
      label={label}
      suffix="%"
      text={formatNumber(value * 100, 0)}
      onText={(text) => {
        const v = parse(text) / 100;
        if (!Number.isFinite(v) || v < min - 1e-9 || v > max + 1e-9) return false;
        onChange(v);
        return true;
      }}
    />
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [value: T, label: string][];
  onChange(value: T): void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="mb-1 block text-sm">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="min-h-9 w-full rounded-md border border-line-strong bg-panel px-2 text-sm"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="flex gap-2">{children}</div>;
}
