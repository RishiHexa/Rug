import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { Button } from './ui';

interface Request {
  message: string;
  confirmLabel: string;
  resolve(ok: boolean): void;
}

const useRequest = create<{ request: Request | null }>()(() => ({ request: null }));

/** Asks the user to confirm; resolves to their answer. */
export function confirmAction(message: string, confirmLabel = 'Continue'): Promise<boolean> {
  return new Promise((resolve) => {
    useRequest.getState().request?.resolve(false);
    useRequest.setState({ request: { message, confirmLabel, resolve } });
  });
}

export function ConfirmDialog() {
  const request = useRequest((s) => s.request);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (request) ref.current?.showModal();
    else ref.current?.close();
  }, [request]);

  const answer = (ok: boolean) => {
    request?.resolve(ok);
    useRequest.setState({ request: null });
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-message"
      onCancel={(e) => {
        e.preventDefault();
        answer(false);
      }}
      className="m-auto w-full max-w-sm rounded-lg border border-line bg-panel p-6 text-ink"
    >
      <p id="confirm-message" className="mb-5">
        {request?.message}
      </p>
      <div className="flex justify-end gap-2">
        <Button autoFocus onClick={() => answer(false)}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => answer(true)}>
          {request?.confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
