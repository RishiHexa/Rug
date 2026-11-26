import {
  CheckField,
  CountField,
  formatShort,
  LengthField,
  LimitField,
  PercentField,
  Row,
  SelectField,
} from '../components/fields';
import { Button } from '../components/ui';
import type { Unit } from '../domain/dimensions';
import type { Run, SegmentReport } from '../segments/layout';
import type { ArtSlot, AxisRule, Placement, Segment, SegmentDoc } from '../segments/model';
import { ArtThumb } from './PictureTools';

/** Everything about one segment: color, artwork, place and rules. */
export function SegmentForm({
  segment,
  report,
  unit,
  doc,
  onChange,
  onDraw,
  onPicture,
}: {
  segment: Segment;
  report: SegmentReport | undefined;
  unit: Unit;
  /** The whole design, for choosing a motif to follow. */
  doc: SegmentDoc;
  onChange(patch: Partial<Segment>): void;
  onDraw(slot: ArtSlot): void;
  onPicture(slot: ArtSlot): void;
}) {
  const p = segment.placement;
  const place = (patch: Partial<Placement>) => onChange({ placement: { ...p, ...patch } as Placement });
  const rule = (axis: 'x' | 'y') => (patch: Partial<AxisRule>) =>
    onChange({ [axis]: { ...segment[axis], ...patch } });

  const artRow = (slot: ArtSlot, label: string) => {
    const art = segment[slot];
    return (
      <div>
        <p className="mb-1 text-sm">{label}</p>
        <div className="flex items-center gap-2">
          {art && <ArtThumb art={art} under={segment.color} className="size-12 shrink-0" />}
          <Button className="px-2" onClick={() => onDraw(slot)}>
            {art?.crisp ? 'Edit drawing' : 'Draw'}
          </Button>
          <Button className="px-2" onClick={() => onPicture(slot)}>
            Picture
          </Button>
          {art && (
            <Button variant="quiet" onClick={() => onChange({ [slot]: null })}>
              Remove
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <label className="block text-sm">
        <span className="mb-1 block">Name</span>
        <input
          value={segment.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="min-h-9 w-full rounded-md border border-line-strong bg-panel px-2"
        />
      </label>

      <div className="flex items-center gap-3">
        <CheckField
          label="Color"
          checked={segment.color !== null}
          onChange={(on) => onChange({ color: on ? '#8c2f24' : null })}
        />
        {segment.color !== null ? (
          <>
            <input
              type="color"
              aria-label="Segment color"
              value={segment.color}
              onChange={(e) => onChange({ color: e.target.value })}
              className="h-9 w-12 rounded border border-line-strong"
            />
            <span className="text-sm text-muted">{segment.color}</span>
          </>
        ) : (
          <span className="text-sm text-muted">See-through</span>
        )}
      </div>
      {artRow('art', p.type === 'border' ? 'Artwork along the ends' : 'Artwork')}
      {p.type === 'border' && segment.x.symmetric && artRow('centerArt', 'Middle piece of the ends')}
      {p.type === 'border' && artRow('sideArt', 'Own artwork for the sides (optional)')}
      {p.type === 'border' && segment.sideArt && segment.y.symmetric && artRow('sideCenterArt', 'Middle piece of the sides')}

      <Section title="Place">
        {p.type === 'border' && (
          <>
            <Row>
              <LengthField label="From the edge" value={p.inset} unit={unit} onChange={(inset) => place({ inset })} />
              <LengthField
                label="Thickness"
                value={p.thickness}
                unit={unit}
                min={0.05}
                onChange={(thickness) => place({ thickness })}
              />
            </Row>
            <Row>
              <SelectField
                label="Sides"
                value={p.sides}
                options={[
                  ['all', 'All four'],
                  ['ends', 'Top and bottom'],
                  ['sides', 'Left and right'],
                ]}
                onChange={(sides) => place({ sides })}
              />
              {p.sides === 'all' && (
                <SelectField
                  label="Corners"
                  value={p.corner}
                  options={[
                    ['mitre', 'Mitred'],
                    ['piece', 'Own artwork'],
                    ['plain', 'Plain color'],
                  ]}
                  onChange={(corner) => place({ corner })}
                />
              )}
            </Row>
            {p.sides === 'all' && p.corner === 'piece' && artRow('cornerArt', 'Corner artwork (top-left)')}
          </>
        )}
        {p.type !== 'border' && (
          <SelectField
            label="Within"
            value={p.area}
            options={[
              ['inside', 'Inside the borders'],
              ['rug', 'The whole rug'],
            ]}
            onChange={(area) => place({ area })}
          />
        )}
        {p.type === 'motif' && (
          <>
            <SelectField
              label="At"
              value={p.anchor}
              options={[
                ['center', 'Center'],
                ['corners', 'All four corners, mirrored'],
                ['edges', 'Top and bottom, mirrored'],
                ['axis', 'Above and below the motif it follows'],
              ]}
              onChange={(anchor) => place({ anchor })}
            />
            <SelectField
              label="Size from"
              value={p.follow ?? ''}
              options={[
                ['', 'Its own room'],
                ...doc.segments
                  .filter((o) => o.id !== segment.id && o.placement.type === 'motif')
                  .map((o): [string, string] => [o.id, o.name]),
              ]}
              onChange={(follow) => place({ follow: follow || null })}
            />
            <Row>
              <LengthField label="Offset across" value={p.offsetX} unit={unit} min={-1000} onChange={(offsetX) => place({ offsetX })} />
              <LengthField
                label={p.anchor === 'axis' && p.follow ? 'Gap to it' : 'Offset down'}
                value={p.offsetY}
                unit={unit}
                min={-1000}
                onChange={(offsetY) => place({ offsetY })}
              />
            </Row>
            {p.anchor === 'axis' && (
              <LengthField
                label="Least room to the border"
                value={p.edgeGap}
                unit={unit}
                onChange={(edgeGap) => place({ edgeGap })}
              />
            )}
            <p className="text-sm text-muted">
              Offsets are at 100% size and grow with the motif.
              {p.follow ? ' It takes its size from the motif it follows.' : ''}
              {p.anchor === 'axis' ? ' Without room for it, it shrinks, then is left out.' : ''}
            </p>
            <Row>
              <LengthField label="Width" value={segment.x.piece} unit={unit} min={0.1} onChange={(piece) => rule('x')({ piece })} />
              <LengthField label="Height" value={segment.y.piece} unit={unit} min={0.1} onChange={(piece) => rule('y')({ piece })} />
            </Row>
            <CheckField label="Keep its shape when growing" checked={p.keepShape} onChange={(keepShape) => place({ keepShape })} />
          </>
        )}
      </Section>

      {p.type === 'border' && (
        <RuleSection
          title={segment.sideArt ? 'Along the ends' : 'Along the border'}
          rule={segment.x}
          run={report?.x ?? report?.y}
          unit={unit}
          onChange={rule('x')}
        />
      )}
      {p.type === 'border' && segment.sideArt && (
        <RuleSection title="Along the sides" rule={segment.y} run={report?.y} unit={unit} onChange={rule('y')} />
      )}
      {p.type === 'fill' && (
        <>
          <RuleSection title="Across (X)" rule={segment.x} run={report?.x} unit={unit} onChange={rule('x')} />
          <RuleSection title="Down (Y)" rule={segment.y} run={report?.y} unit={unit} onChange={rule('y')} />
        </>
      )}
      {p.type === 'motif' && (
        <>
          <GrowthSection title="Growth across (X)" rule={segment.x} run={report?.x} unit={unit} onChange={rule('x')} />
          <GrowthSection title="Growth down (Y)" rule={segment.y} run={report?.y} unit={unit} onChange={rule('y')} />
        </>
      )}

      <SelectField
        label="When the limits can’t be met"
        value={segment.overflow}
        options={[
          ['crop', 'Crop'],
          ['stretch', 'Stretch anyway'],
        ]}
        onChange={(overflow) => onChange({ overflow })}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-4">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </section>
  );
}

interface RuleProps {
  title: string;
  rule: AxisRule;
  run: Run | null | undefined;
  unit: Unit;
  onChange(patch: Partial<AxisRule>): void;
}

function StretchFields({ rule, onChange }: Pick<RuleProps, 'rule' | 'onChange'>) {
  return (
    <Row>
      <PercentField
        label="Least stretch"
        value={rule.minStretch}
        min={0.05}
        max={rule.maxStretch}
        onChange={(minStretch) => onChange({ minStretch })}
      />
      <PercentField
        label="Most stretch"
        value={rule.maxStretch}
        min={rule.minStretch}
        max={10}
        onChange={(maxStretch) => onChange({ maxStretch })}
      />
    </Row>
  );
}

function RuleSection({ title, rule, run, unit, onChange }: RuleProps) {
  const repeat = rule.fit === 'repeat';
  return (
    <Section title={title}>
      <Row>
        <SelectField
          label="Fit"
          value={rule.fit}
          options={[
            ['repeat', 'Repeat'],
            ['single', 'One piece'],
          ]}
          onChange={(fit) => onChange({ fit })}
        />
        <LengthField label="Piece length" value={rule.piece} unit={unit} min={0.1} onChange={(piece) => onChange({ piece })} />
      </Row>
      <StretchFields rule={rule} onChange={onChange} />
      {repeat && (
        <>
          <Row>
            <LengthField label="Space between" value={rule.gap} unit={unit} onChange={(gap) => onChange({ gap, maxGap: Math.max(gap, rule.maxGap) })} />
            <LengthField
              label="Most before adding one"
              value={Math.max(rule.gap, rule.maxGap)}
              unit={unit}
              min={rule.gap}
              onChange={(maxGap) => onChange({ maxGap })}
            />
          </Row>
          <CheckField
            label="Lay out from the middle, the far half mirrored"
            checked={rule.symmetric}
            onChange={(symmetric) => onChange({ symmetric, flip: symmetric ? false : rule.flip })}
          />
          {rule.symmetric ? (
            <LengthField label="Middle piece" value={rule.center} unit={unit} onChange={(center) => onChange({ center })} />
          ) : (
            <CheckField label="Mirror every other piece" checked={rule.flip} onChange={(flip) => onChange({ flip })} />
          )}
          <CountField
            label="Different pieces in the artwork, used in turn"
            value={rule.slots}
            min={1}
            max={24}
            onChange={(slots) => onChange({ slots })}
          />
        </>
      )}
      <Row>
        <LimitField label="Shortest" value={rule.minLength} unit={unit} onChange={(minLength) => onChange({ minLength })} />
        <LimitField label="Longest" value={rule.maxLength} unit={unit} onChange={(maxLength) => onChange({ maxLength })} />
      </Row>
      <RunNote run={run} unit={unit} />
    </Section>
  );
}

function GrowthSection({ title, rule, run, unit, onChange }: RuleProps) {
  return (
    <Section title={title}>
      <StretchFields rule={rule} onChange={onChange} />
      <Row>
        <LimitField label="Room needed" value={rule.minLength} unit={unit} onChange={(minLength) => onChange({ minLength })} />
        <LimitField label="Largest" value={rule.maxLength} unit={unit} onChange={(maxLength) => onChange({ maxLength })} />
      </Row>
      <RunNote run={run} unit={unit} />
    </Section>
  );
}

/** What the rule comes to at the size shown. */
function RunNote({ run, unit }: { run: Run | null | undefined; unit: Unit }) {
  if (!run) return null;
  const pieces = run.pieces.length;
  const parts = [
    pieces > 1 ? `${pieces} pieces` : null,
    `${Math.round(run.stretch * 100)}% size`,
    run.gap > 0.005 ? `${formatShort(run.gap, unit)} apart` : null,
  ].filter(Boolean);
  const note = {
    fits: '',
    room: ', with room around it',
    cropped: ', cropped at the edges',
    forced: ', past its limits',
    hidden: '',
    crowded: ', at its limit and running into another motif',
  }[run.state];
  const warn = run.state !== 'fits' && run.state !== 'room';
  return (
    <p className={`text-sm ${warn ? 'text-warn' : 'text-muted'}`}>
      {run.state === 'hidden' ? 'At this size: left out, too little room.' : `At this size: ${parts.join(', ')}${note}.`}
    </p>
  );
}
