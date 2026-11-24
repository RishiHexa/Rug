import { confirmAction } from '../components/ConfirmDialog';
import { downstreamOfDimensions, useApp } from './store';

/** "Edit dimensions", with a warning when later work would be lost. */
export async function requestEditDimensions(): Promise<void> {
  const losing = downstreamOfDimensions(useApp.getState());
  if (losing && !(await confirmAction(`This will discard ${losing}. Continue?`, 'Discard and edit'))) {
    return;
  }
  useApp.getState().unlockDimensions();
}

/** "Edit design" once it has been finalised; the design work itself is kept. */
export async function requestEditDesign(): Promise<void> {
  const ok = await confirmAction('This will discard the knot map. Continue?', 'Discard and edit');
  if (ok) useApp.getState().unlockDesign();
}
