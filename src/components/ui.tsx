import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'quiet';

const BUTTON: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-panel text-ink hover:bg-paper',
  quiet: 'text-accent underline-offset-4 hover:underline',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const size = variant === 'quiet' ? 'px-1 py-1' : 'min-h-10 px-4 py-2';
  return (
    <button
      type="button"
      className={`rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${size} ${BUTTON[variant]} ${className}`}
      {...rest}
    />
  );
}

/** Canvas hero on the left, narrow control panel on the right. */
export function TwoZone({ canvas, panel }: { canvas: ReactNode; panel: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="relative min-h-[320px] min-w-0 flex-1 bg-well">{canvas}</div>
      <aside className="flex max-h-[50%] w-full shrink-0 flex-col border-t border-line bg-panel lg:max-h-none lg:w-[340px] lg:border-t-0 lg:border-l">
        {panel}
      </aside>
    </div>
  );
}

export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">{children}</div>;
}

export function PanelFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 border-t border-line p-5">{children}</div>;
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <p className="mt-1 text-sm text-muted">{children}</p>}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'warn' | 'error'; children: ReactNode }) {
  const colour = tone === 'error' ? 'border-danger text-danger' : 'border-warn text-warn';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`border-l-2 pl-3 text-sm ${colour}`}>
      {children}
    </p>
  );
}

export function Facts({ rows }: { rows: [label: string, value: ReactNode][] }) {
  return (
    <dl className="divide-y divide-line text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 py-2">
          <dt className="text-muted">{label}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgressBar({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div className="h-full origin-left bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Keeps mouse clicks from stealing focus, so Space still pans the canvas. */
export const keepFocus = (e: React.MouseEvent) => e.preventDefault();
