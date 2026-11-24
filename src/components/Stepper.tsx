import { canEnter, isComplete, useApp, type Step } from '../state/store';

const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: 'Dimensions' },
  { step: 2, label: 'Create design' },
  { step: 3, label: 'Finalise' },
  { step: 4, label: 'Knot map' },
];

/** Available once there is a knot map. */
const EXTRAS: { step: Step; label: string }[] = [
  { step: 6, label: 'Resize' },
  { step: 5, label: 'Rug preview' },
];

export function Stepper() {
  const state = useApp();

  return (
    <nav aria-label="Steps">
      <ol className="flex items-center gap-1">
        {STEPS.map(({ step, label }) => {
          const current = state.step === step;
          const done = isComplete(state, step);
          return (
            <li key={step}>
              <button
                type="button"
                aria-current={current ? 'step' : undefined}
                disabled={!canEnter(state, step)}
                onClick={() => state.goTo(step)}
                className={`flex min-h-10 items-center gap-2 rounded-md px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  current ? 'bg-accent-soft font-semibold text-accent' : 'enabled:hover:bg-well'
                }`}
              >
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
                    current
                      ? 'border-accent bg-accent text-white'
                      : done
                        ? 'border-accent text-accent'
                        : 'border-line-strong'
                  }`}
                >
                  {done ? <CheckIcon /> : step}
                </span>
                <span className="hidden sm:inline">{label}</span>
                {done && <span className="sr-only">(completed)</span>}
              </button>
            </li>
          );
        })}
        {state.map &&
          EXTRAS.map(({ step, label }, i) => (
            <li key={step} className={i === 0 ? 'ml-2 border-l border-line pl-3' : ''}>
              <button
                type="button"
                aria-current={state.step === step ? 'step' : undefined}
                onClick={() => state.goTo(step)}
                className={`min-h-10 rounded-md px-3 text-sm transition-colors ${
                  state.step === step ? 'bg-accent-soft font-semibold text-accent' : 'hover:bg-well'
                }`}
              >
                {label}
              </button>
            </li>
          ))}
      </ol>
    </nav>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 6.5 4.8 9 10 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
