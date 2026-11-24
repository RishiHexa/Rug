import { useEffect, useRef, useState } from 'react';
import { formatLength } from '../domain/dimensions';
import {
  deleteProject,
  listProjects,
  openProject,
  saveProject,
  useOpenProject,
  type ProjectInfo,
} from '../state/projects';
import { useApp } from '../state/store';
import { confirmAction } from './ConfirmDialog';
import { Button, Notice } from './ui';

/** Save and open designs. */
export function ProjectMenu() {
  const [dialog, setDialog] = useState<'save' | 'open' | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(t);
  }, [saved]);
  return (
    <div className="ml-auto flex items-center gap-2">
      <span role="status" className="text-sm text-muted">
        {saved ? 'Saved' : ''}
      </span>
      <Button onClick={() => setDialog('save')}>Save</Button>
      <Button onClick={() => setDialog('open')}>Open</Button>
      {dialog === 'save' && (
        <SaveDialog
          onClose={(done) => {
            setDialog(null);
            setSaved(done);
          }}
        />
      )}
      {dialog === 'open' && <OpenDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-full max-w-md rounded-lg border border-line bg-panel p-6 text-ink"
    >
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </dialog>
  );
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function SaveDialog({ onClose }: { onClose(saved: boolean): void }) {
  const current = useOpenProject.getState();
  const [name, setName] = useState(current.name || 'My rug');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (id: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await saveProject(name.trim(), id);
      onClose(true);
    } catch (e) {
      setError(`The design could not be saved. ${messageOf(e)}`);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Save design" onClose={() => onClose(false)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(current.id);
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 w-full rounded-md border border-line-strong bg-panel px-3 text-base"
          />
        </label>
        <p className="mt-2 text-sm text-muted">Kept in this browser, with its rules, colors and size.</p>
        {error && (
          <div className="mt-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          {current.id && (
            <Button disabled={busy || !name.trim()} onClick={() => void save(null)}>
              Save as new
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function OpenDialog({ onClose }: { onClose(): void }) {
  const unit = useApp((s) => s.dimensions.unit);
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    listProjects().then(setProjects, (e: unknown) => {
      setProjects([]);
      setError(`Saved designs could not be read. ${messageOf(e)}`);
    });
  useEffect(() => void refresh(), []);

  const open = async (info: ProjectInfo) => {
    const s = useApp.getState();
    const working = s.design.image || s.draft.upload || s.draft.draw || s.draft.segments;
    if (working && !(await confirmAction('This replaces what you have open. Unsaved changes are lost. Continue?', 'Open'))) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await openProject(info);
      onClose();
    } catch (e) {
      setError(`The design could not be opened. ${messageOf(e)}`);
      setBusy(false);
    }
  };
  const remove = async (info: ProjectInfo) => {
    if (!(await confirmAction(`Delete “${info.name}”? This can’t be undone.`, 'Delete'))) return;
    try {
      await deleteProject(info.id);
    } catch (e) {
      setError(`The design could not be deleted. ${messageOf(e)}`);
    }
    await refresh();
  };

  return (
    <Dialog title="Open a saved design" onClose={onClose}>
      {error && <Notice tone="error">{error}</Notice>}
      {projects?.length === 0 && !error && <p className="text-sm text-muted">Nothing saved yet.</p>}
      <ul className="max-h-96 divide-y divide-line overflow-y-auto">
        {projects?.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void open(p)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-left hover:bg-well"
            >
              <Thumb blob={p.thumb} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block text-sm text-muted">
                  {formatLength(p.widthIn, unit)} × {formatLength(p.heightIn, unit)},{' '}
                  {new Date(p.savedAt).toLocaleString()}
                </span>
              </span>
            </button>
            <Button variant="quiet" disabled={busy} onClick={() => void remove(p)}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

function Thumb({ blob }: { blob: Blob | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded border border-line bg-well">
      {url && <img src={url} alt="" className="max-h-full max-w-full" />}
    </span>
  );
}
