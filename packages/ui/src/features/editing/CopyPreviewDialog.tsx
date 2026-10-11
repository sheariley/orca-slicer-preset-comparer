import { presetIn, type EditSession } from '@comparer/app';
import { useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog.tsx';
import { useComparerApp } from '../../hooks/useComparerApp.ts';
import { CopyPlanTable } from './CopyPlanTable.tsx';

/** Copy `keys` from one open preset to another. */
export interface SingleCopy {
  readonly source: string;
  readonly target: string;
  readonly keys: readonly string[];
}

interface CopyPreviewDialogProps {
  readonly session: EditSession;
  readonly request: SingleCopy;
  /** Records the copy with the user's "Pin override" choices (setting key → keep). */
  readonly onApply: (pins: ReadonlyMap<string, boolean>) => void;
  readonly onCancel: () => void;
}

/**
 * Shows what a copy would do before recording it (see CopyPlanTable). Changing a "Pin override"
 * checkbox re-plans the copy.
 */
export function CopyPreviewDialog({ session, request, onApply, onCancel }: CopyPreviewDialogProps) {
  const app = useComparerApp();
  const [pins, setPins] = useState<ReadonlyMap<string, boolean>>(new Map());
  const { source, target, keys } = request;
  const targetName = presetIn(session, target).ref.name;

  const preview = useMemo(
    // Recording it on a copy of the session shows the exact result (variant fitting included).
    () =>
      app.copy(session, {
        source,
        targets: [target],
        keys,
        pinOverrides: new Map([[target, pins]]),
      }),
    [app, session, source, target, keys, pins],
  );
  const plan = preview.plan.targets[0]!;
  const skipped = new Set(plan.skipped.map((skip) => skip.key));
  const changing = keys.filter((key) => !skipped.has(key)).length;

  return (
    <Dialog
      title={`Copy ${keys.length === 1 ? '1 setting' : `${keys.length} settings`} to ${targetName}`}
      onClose={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={changing === 0}
            onClick={() => onApply(pins)}
          >
            Copy
          </button>
        </>
      }
    >
      <p>
        {changing === 0
          ? 'Nothing would change.'
          : `${changing} ${changing === 1 ? 'setting changes' : 'settings change'} in ${targetName}.`}
        {changing < keys.length && ` ${keys.length - changing} left as they are.`}
      </p>
      <CopyPlanTable
        before={session}
        after={preview.session}
        source={source}
        plan={plan}
        keys={keys}
        onPin={(key, keep) => setPins(new Map(pins).set(key, keep))}
      />
    </Dialog>
  );
}
