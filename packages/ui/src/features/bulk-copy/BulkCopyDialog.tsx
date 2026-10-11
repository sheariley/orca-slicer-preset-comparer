import { presetIn, type EditSession } from '@comparer/app';
import type { PinOverrides, PresetRef, TargetPlan } from '@comparer/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog.tsx';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import { useAsync } from '../../hooks/useAsync.ts';
import { useComparerApp } from '../../hooks/useComparerApp.ts';
import { CopyPlanTable } from '../editing/CopyPlanTable.tsx';

interface BulkCopyDialogProps {
  readonly session: EditSession;
  /** The two compared presets; either can be the source. */
  readonly left: PresetRef;
  readonly right: PresetRef;
  /** The settings selected in the table, in the table's order. */
  readonly keys: readonly string[];
  /** A setting's name as the table shows it (see settingNames). */
  readonly nameOf: (key: string) => string;
  /** Records the copy as one undoable step; `session` has the targets opened in it. */
  readonly onApply: (session: EditSession, label: string) => void;
  readonly onCancel: () => void;
}

type Step =
  | { readonly step: 'choose' }
  | { readonly step: 'opening' }
  | { readonly step: 'preview'; readonly session: EditSession }
  | { readonly step: 'error'; readonly error: unknown };

type OriginFilter = 'all' | 'user' | 'system';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const originText = (preset: PresetRef) =>
  preset.origin === 'user' ? 'User' : (preset.vendor ?? 'System');

/**
 * Copies settings from one of the compared presets to many others, as one undoable step:
 * choose the source, the settings, and the targets (filtered, with select-all), then preview
 * what changes in each target and leave out any of them before copying.
 */
export function BulkCopyDialog({
  session,
  left,
  right,
  keys: selectedKeys,
  nameOf,
  onApply,
  onCancel,
}: BulkCopyDialogProps) {
  const app = useComparerApp();
  const [step, setStep] = useState<Step>({ step: 'choose' });
  const [source, setSource] = useState(left.id);
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set(selectedKeys));
  const [targets, setTargets] = useState<ReadonlySet<string>>(new Set());
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [pins, setPins] = useState<PinOverrides>(new Map());

  const chosenKeys = selectedKeys.filter((key) => keys.has(key));
  const presets = useAsync(left.type, () => app.listPresets({ type: left.type }));
  const candidates = presets.status === 'done' ? presets.value : [];
  const chosenTargets = candidates.filter(
    (preset) => preset.id !== source && targets.has(preset.id),
  );
  const sourceName = (source === left.id ? left : right).name;

  const preview = async () => {
    setStep({ step: 'opening' });
    try {
      setStep({ step: 'preview', session: await app.addPresets(session, chosenTargets) });
    } catch (error) {
      setStep({ step: 'error', error });
    }
  };

  const title = `Copy ${plural(chosenKeys.length, 'setting')} to other presets`;
  if (step.step === 'preview') {
    return (
      <BulkPreview
        title={title}
        session={step.session}
        source={source}
        sourceName={sourceName}
        keys={chosenKeys}
        targets={chosenTargets.map((preset) => preset.id)}
        excluded={excluded}
        onExclude={setExcluded}
        pins={pins}
        onPins={setPins}
        onBack={() => setStep({ step: 'choose' })}
        onApply={onApply}
        onCancel={onCancel}
      />
    );
  }

  return (
    <Dialog
      title={title}
      wide
      onClose={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={
              chosenKeys.length === 0 || chosenTargets.length === 0 || step.step === 'opening'
            }
            onClick={() => void preview()}
          >
            {step.step === 'opening' ? 'Opening presets…' : 'Preview…'}
          </button>
        </>
      }
    >
      {step.step === 'error' && <ErrorMessage error={step.error} />}
      <div className="bulk-choose">
        <fieldset>
          <legend>Copy from</legend>
          {[left, right].map((preset) => (
            <label key={preset.id} className="toggle">
              <input
                type="radio"
                name="bulk-source"
                checked={source === preset.id}
                onChange={() => setSource(preset.id)}
              />
              {preset.id === left.id ? 'Left' : 'Right'}: {preset.name}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>
            Settings ({chosenKeys.length} of {selectedKeys.length})
          </legend>
          <ul className="check-list">
            {selectedKeys.map((key) => (
              <li key={key}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={keys.has(key)}
                    onChange={(event) => setKeys(toggled(keys, [key], event.target.checked))}
                  />
                  {nameOf(key)}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>

      <fieldset>
        <legend>To these presets ({chosenTargets.length} selected)</legend>
        {presets.status === 'failed' ? (
          <ErrorMessage error={presets.error} />
        ) : (
          <TargetBrowser
            presets={candidates.filter((preset) => preset.id !== source)}
            loading={presets.status === 'loading'}
            selected={targets}
            onSelect={setTargets}
          />
        )}
      </fieldset>
    </Dialog>
  );
}

/** The presets to copy to: filter by name, origin, and vendor, then tick them. */
function TargetBrowser({
  presets,
  loading,
  selected,
  onSelect,
}: {
  presets: readonly PresetRef[];
  loading: boolean;
  selected: ReadonlySet<string>;
  onSelect: (selected: ReadonlySet<string>) => void;
}) {
  const [text, setText] = useState('');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const [vendor, setVendor] = useState('');
  const vendors = [...new Set(presets.flatMap((preset) => preset.vendor ?? []))].sort();

  const needle = text.trim().toLowerCase();
  const shown = presets.filter(
    (preset) =>
      (origin === 'all' || preset.origin === origin) &&
      (vendor === '' || preset.vendor === vendor) &&
      (needle === '' || preset.name.toLowerCase().includes(needle)),
  );
  const shownIds = shown.map((preset) => preset.id);
  const shownSelected = shownIds.filter((id) => selected.has(id)).length;

  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAll.current) {
      selectAll.current.indeterminate = shownSelected > 0 && shownSelected < shown.length;
    }
  });

  return (
    <div className="target-browser">
      <div className="target-filters">
        <input
          type="search"
          placeholder="Filter presets"
          aria-label="Filter presets"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <select
          aria-label="Origin"
          value={origin}
          onChange={(event) => setOrigin(event.target.value as OriginFilter)}
        >
          <option value="all">User and system presets</option>
          <option value="user">User presets</option>
          <option value="system">System presets</option>
        </select>
        {vendors.length > 0 && (
          <select
            aria-label="Vendor"
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
          >
            <option value="">All vendors</option>
            {vendors.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>
      <label className="toggle select-all">
        <input
          ref={selectAll}
          type="checkbox"
          checked={shown.length > 0 && shownSelected === shown.length}
          disabled={shown.length === 0}
          onChange={(event) => onSelect(toggled(selected, shownIds, event.target.checked))}
        />
        Select all shown ({shown.length})
      </label>
      {loading ? (
        <p className="status">Loading presets…</p>
      ) : shown.length === 0 ? (
        <p className="empty">No presets match.</p>
      ) : (
        <ul className="check-list target-list">
          {shown.map((preset) => (
            <li key={preset.id}>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={selected.has(preset.id)}
                  onChange={(event) =>
                    onSelect(toggled(selected, [preset.id], event.target.checked))
                  }
                />
                {preset.name} <span className="origin">({originText(preset)})</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the copy does to each target, with a checkbox to leave any of them out. */
function BulkPreview({
  title,
  session,
  source,
  sourceName,
  keys,
  targets,
  excluded,
  onExclude,
  pins,
  onPins,
  onBack,
  onApply,
  onCancel,
}: {
  title: string;
  session: EditSession;
  source: string;
  sourceName: string;
  keys: readonly string[];
  targets: readonly string[];
  excluded: ReadonlySet<string>;
  onExclude: (excluded: ReadonlySet<string>) => void;
  pins: PinOverrides;
  onPins: (pins: PinOverrides) => void;
  onBack: () => void;
  onApply: (session: EditSession, label: string) => void;
  onCancel: () => void;
}) {
  const app = useComparerApp();
  const editable = targets.filter((id) => presetIn(session, id).ref.origin === 'user');
  const system = targets.filter((id) => presetIn(session, id).ref.origin !== 'user');

  // Every editable target, planned on a copy of the session (variant fitting included).
  const all = useMemo(
    () => app.copy(session, { source, targets: editable, keys, pinOverrides: pins }),
    // `editable` is derived from `targets` and `session`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, session, source, targets, keys, pins],
  );
  const plans = new Map(all.plan.targets.map((plan) => [plan.target.id, plan]));
  const changing = (plan: TargetPlan) => {
    const skipped = new Set(plan.skipped.map((skip) => skip.key));
    return keys.filter((key) => !skipped.has(key)).length;
  };
  const included = editable.filter((id) => !excluded.has(id) && changing(plans.get(id)!) > 0);

  const label =
    included.length === 1
      ? `Copy ${plural(keys.length, 'setting')} to ${presetIn(session, included[0]!).ref.name}`
      : `Copy ${plural(keys.length, 'setting')} to ${included.length} presets`;
  const apply = () => {
    const { session: next } = app.copy(
      session,
      { source, targets: included, keys, pinOverrides: pins },
      label,
    );
    onApply(next, label);
  };

  return (
    <Dialog
      title={title}
      wide
      onClose={onCancel}
      actions={
        <>
          <button type="button" onClick={onBack}>
            Back
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={included.length === 0}
            onClick={apply}
          >
            {included.length === 1 ? 'Copy to 1 preset' : `Copy to ${included.length} presets`}
          </button>
        </>
      }
    >
      <p>
        From {sourceName}: {included.length} of {plural(targets.length, 'preset')} will change.
      </p>
      <ul className="bulk-targets">
        {editable.map((id) => {
          const plan = plans.get(id)!;
          const name = plan.target.name;
          const count = changing(plan);
          return (
            <li key={id} data-included={count > 0 && !excluded.has(id)}>
              <div className="bulk-target-head">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={count > 0 && !excluded.has(id)}
                    disabled={count === 0}
                    onChange={(event) => onExclude(toggled(excluded, [id], !event.target.checked))}
                  />
                  <strong>{name}</strong>
                </label>
                <span className="bulk-target-status">
                  {count === 0
                    ? 'Already matches, so it is skipped.'
                    : `${plural(count, 'setting')} ${count === 1 ? 'changes' : 'change'}.`}
                </span>
              </div>
              <details>
                <summary>
                  Details<span className="visually-hidden"> for {name}</span>
                </summary>
                <CopyPlanTable
                  before={session}
                  after={all.session}
                  source={source}
                  plan={plan}
                  keys={keys}
                  nameSuffix={` in ${name}`}
                  onPin={(key, keep) =>
                    onPins(new Map(pins).set(id, new Map(pins.get(id)).set(key, keep)))
                  }
                />
              </details>
            </li>
          );
        })}
        {system.map((id) => (
          <li key={id} data-included={false}>
            <div className="bulk-target-head">
              <label className="toggle">
                <input type="checkbox" checked={false} disabled />
                <strong>{presetIn(session, id).ref.name}</strong>
              </label>
              <span className="bulk-target-status">
                A system preset, which can't be changed. Saving it as a new user preset isn't
                available yet, so it's left out.
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** `set` with `ids` added (on) or removed (off). */
function toggled(set: ReadonlySet<string>, ids: readonly string[], on: boolean): Set<string> {
  const next = new Set(set);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}
