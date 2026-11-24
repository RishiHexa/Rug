import { useState } from 'react';
import { DesignSheet } from '../components/DesignSheet';
import { Button, Heading, PanelBody, PanelFooter, TwoZone } from '../components/ui';
import { drawingSize, DrawDocument } from '../design/drawDocument';
import { runDesignPipeline, type DesignSource } from '../domain/pipeline';
import { requestEditDesign } from '../state/editActions';
import { gridSpec, useApp } from '../state/store';
import { DrawEditor } from './DrawEditor';
import { SegmentBuilder } from './SegmentBuilder';
import { UploadEditor } from './UploadEditor';

export function Step2Design() {
  const designFinal = useApp((s) => s.designFinal);
  const mode = useApp((s) => s.draft.mode);
  if (designFinal) return <LockedDesign />;
  if (mode === 'upload') return <UploadEditor />;
  if (mode === 'draw') return <DrawEditor />;
  if (mode === 'segments') return <SegmentBuilder />;
  return <Chooser />;
}

function LockedDesign() {
  const goTo = useApp((s) => s.goTo);
  return (
    <TwoZone
      canvas={<DesignSheet />}
      panel={
        <>
          <PanelBody>
            <Heading title="Design is locked">
              The knot map is made from this design. Editing it discards the knot map.
            </Heading>
          </PanelBody>
          <PanelFooter>
            <Button variant="primary" onClick={() => goTo(4)}>
              Go to knot map
            </Button>
            <Button onClick={() => void requestEditDesign()}>Edit</Button>
          </PanelFooter>
        </>
      }
    />
  );
}

function Chooser() {
  const draft = useApp((s) => s.draft);
  const setDraft = useApp((s) => s.setDraft);

  const draw = () =>
    setDraft({ mode: 'draw', draw: draft.draw ?? new DrawDocument(drawingSize(gridSpec(useApp.getState()))) });

  const build = () => {
    const { widthIn, heightIn } = gridSpec(useApp.getState());
    setDraft({
      mode: 'segments',
      segments: draft.segments ?? {
        background: '#8c2f24',
        baseWidth: widthIn,
        baseHeight: heightIn,
        segments: [],
      },
    });
  };

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <Heading title="Create design">How do you want to make the design?</Heading>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Choice
          title="Upload an image"
          text={
            draft.upload
              ? `Continue with ${draft.upload.name}.`
              : 'Use a PNG, JPG or WebP and crop it to the rug.'
          }
          onClick={() => setDraft({ mode: 'upload' })}
          icon="M12 16V5m0 0L7 10m5-5 5 5M5 19h14"
        />
        <Choice
          title="Draw a design"
          text={
            draft.draw && !draft.draw.blank
              ? 'Continue with your drawing.'
              : 'Paint on a canvas in the shape of the rug.'
          }
          onClick={draw}
          icon="M4 20l1-4L16 5l3 3L8 19l-4 1ZM14 7l3 3"
        />
        <Choice
          title="Build from segments"
          text={
            draft.segments && draft.segments.segments.length > 0
              ? 'Continue with your segments.'
              : 'Borders, fills and motifs with rules, so the rug can be resized.'
          }
          onClick={build}
          icon="M3 3h18v18H3zM8 8h8v8H8zM3 3l5 5M21 3l-5 5M3 21l5-5M21 21l-5-5"
        />
      </div>
    </div>
  );
}

function Choice({
  title,
  text,
  icon,
  onClick,
}: {
  title: string;
  text: string;
  icon: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-line-strong bg-panel p-6 text-left transition-colors hover:border-accent hover:bg-accent-soft"
    >
      <svg
        viewBox="0 0 24 24"
        className="mb-4 size-8 text-accent"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={icon} />
      </svg>
      <span className="block font-semibold">{title}</span>
      <span className="mt-1 block text-sm text-muted">{text}</span>
    </button>
  );
}

/** Panel footer shared by both editors. */
export function DesignFooter({ source }: { source: DesignSource | null }) {
  const setDraft = useApp((s) => s.setDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proceed = async () => {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const { design } = useApp.getState();
      const image = await runDesignPipeline(source, design.transforms, gridSpec(useApp.getState()));
      useApp.getState().setDesignImage(source.kind, image);
    } catch {
      setError('The design image could not be prepared. Try again.');
      setBusy(false);
    }
  };

  return (
    <PanelFooter>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button variant="primary" disabled={!source || busy} onClick={() => void proceed()}>
        {busy ? 'Preparing…' : 'Continue'}
      </Button>
      <Button variant="quiet" disabled={busy} onClick={() => setDraft({ mode: null })}>
        Choose another way
      </Button>
    </PanelFooter>
  );
}
