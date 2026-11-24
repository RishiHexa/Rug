import { ConfirmDialog } from './components/ConfirmDialog';
import { ProjectMenu } from './components/ProjectMenu';
import { Stepper } from './components/Stepper';
import { useApp } from './state/store';
import { Step1Dimensions } from './steps/Step1Dimensions';
import { Step2Design } from './steps/Step2Design';
import { Step3Finalise } from './steps/Step3Finalise';
import { Step4Map } from './steps/Step4Map';
import { Step5Preview } from './steps/Step5Preview';
import { StepResize } from './steps/StepResize';

const SCREENS = {
  1: Step1Dimensions,
  2: Step2Design,
  3: Step3Finalise,
  4: Step4Map,
  5: Step5Preview,
  6: StepResize,
};

export function App() {
  const step = useApp((s) => s.step);
  const session = useApp((s) => s.session);
  const Screen = SCREENS[step];
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-1 border-b border-line bg-panel px-5 py-2">
        <h1 className="text-base font-semibold">Rug Knot Map</h1>
        <Stepper />
        <ProjectMenu />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Screen key={session} />
      </main>
      <ConfirmDialog />
    </div>
  );
}
