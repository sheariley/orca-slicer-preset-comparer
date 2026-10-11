import { presetIn, type EditSession } from '@comparer/app';
import type { PinOverrides, TargetPlan } from '@comparer/core';
import { useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog.tsx';
import { useComparerApp } from '../../hooks/useComparerApp.ts';
import { CopyPlanTable } from './CopyPlanTable.tsx';

interface CopyToTargetsDialogProps {
  readonly session: EditSession;
  /** The base preset, copied from. */
  readonly source: string;
  /** The targets in the comparison, in column order. */
  readonly targets: readonly string[];
  /** The selected settings, in the table's order. */
  readonly keys: readonly string[];
  /** Records the copy as one undoable step. */
  readonly onApply: (session: EditSession, label: string) => void;
  readonly onCancel: () => void;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Copies the selected settings from the base to every target, as one undoable step, after
 * showing what changes in each (see CopyPlanTable). Targets that already match are skipped, and
 * any target can be left out.
 */
export function CopyToTargetsDialog({
  session,
  source,
  targets,
  keys,
  onApply,
  onCancel,
}: CopyToTargetsDialogProps) {
  const app = useComparerApp();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [pins, setPins] = useState<PinOverrides>(new Map());
  const isSystem = (id: string) => presetIn(session, id).ref.origin === 'system';
  const sourceName = presetIn(session, source).ref.name;

  // Every target, planned on a copy of the session (variant fitting included).
  const all = useMemo(
    () => app.copy(session, { source, targets, keys, pinOverrides: pins }),
    [app, session, source, targets, keys, pins],
  );
  const plans = new Map(all.plan.targets.map((plan) => [plan.target.id, plan]));
  const changing = (plan: TargetPlan) => {
    const skipped = new Set(plan.skipped.map((skip) => skip.key));
    return keys.filter((key) => !skipped.has(key)).length;
  };
  const included = targets.filter((id) => !excluded.has(id) && changing(plans.get(id)!) > 0);
  const system = included.filter(isSystem);
  const systemNames = system.map((id) => presetIn(session, id).ref.name).join(', ');

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
  const toggle = (id: string, include: boolean) => {
    const next = new Set(excluded);
    if (include) next.delete(id);
    else next.add(id);
    setExcluded(next);
  };

  return (
    <Dialog
      title={`Copy ${plural(keys.length, 'setting')} from ${sourceName}`}
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
            disabled={included.length === 0}
            onClick={apply}
          >
            {included.length === 1 ? 'Copy to 1 preset' : `Copy to ${included.length} presets`}
          </button>
        </>
      }
    >
      <p>
        {included.length} of {plural(targets.length, 'target')} will change.
      </p>
      {system.length > 0 && (
        <p className="warning">
          {system.length === 1
            ? `${systemNames} is a system preset, which can't be changed. When you save, its changes go into a new user preset that inherits from it; you name it then.`
            : `${systemNames} are system presets, which can't be changed. When you save, their changes go into new user presets that inherit from them; you name them then.`}
        </p>
      )}
      <ul className="copy-targets">
        {targets.map((id) => {
          const plan = plans.get(id)!;
          const name = plan.target.name;
          const count = changing(plan);
          const on = count > 0 && !excluded.has(id);
          return (
            <li key={id} data-included={on}>
              <div className="copy-target-head">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={count === 0}
                    onChange={(event) => toggle(id, event.target.checked)}
                  />
                  <strong>{name}</strong>
                </label>
                <span className="copy-target-status">
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
                    setPins(new Map(pins).set(id, new Map(pins.get(id)).set(key, keep)))
                  }
                />
              </details>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
