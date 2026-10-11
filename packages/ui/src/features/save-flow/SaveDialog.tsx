import type { SavePreview } from '@comparer/app';
import { presetNameProblem } from '@comparer/core';
import { useId, useState } from 'react';
import { Dialog } from '../../components/Dialog.tsx';

interface SaveDialogProps {
  readonly previews: readonly SavePreview[];
  /**
   * A setting's name as the comparison shows it: its label, plus the key when another setting
   * shares the label (see settingNames).
   */
  readonly nameOf: (key: string) => string;
  /** The names presets of this type already use, or undefined while they load. */
  readonly takenNames: ReadonlySet<string> | undefined;
  readonly saving: boolean;
  /** Saves, with the name of the new user preset for each system preset (by its id). */
  readonly onConfirm: (newPresetNames: ReadonlyMap<string, string>) => void;
  readonly onCancel: () => void;
}

/**
 * The confirmation before saving: what each file gets, plus anything to know first. System
 * presets are never changed: each one asks for the name of the new user preset its changes go
 * into ("Save as" in OrcaSlicer), once for the whole save.
 */
export function SaveDialog({
  previews,
  nameOf,
  takenNames,
  saving,
  onConfirm,
  onCancel,
}: SaveDialogProps) {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(
    () =>
      new Map(
        previews.flatMap((preview) =>
          preview.status === 'new-user-preset'
            ? [[preview.target.id, preview.suggestedName ?? '']]
            : [],
        ),
      ),
  );
  // Each name must be free, including among the other new presets of this save.
  const problemOf = (id: string) => {
    if (!takenNames) return undefined;
    const others = [...names].filter(([other]) => other !== id).map(([, name]) => name);
    return presetNameProblem(names.get(id) ?? '', new Set([...takenNames, ...others]));
  };
  const blocked = !takenNames || [...names.keys()].some((id) => problemOf(id) !== undefined);

  return (
    <Dialog
      title="Save changes"
      // Not dismissible mid-save: the results need somewhere to land.
      {...(saving ? {} : { onClose: onCancel })}
      actions={
        <>
          <button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onConfirm(names)}
            disabled={saving || previews.length === 0 || blocked}
          >
            {saving ? 'Saving' : 'Save'}
          </button>
        </>
      }
    >
      <ul className="save-list">
        {previews.map(({ target, status, keys, reformatted }) => (
          <li key={target.id}>
            <strong>{target.name}</strong>: {keys.map(nameOf).join(', ')}
            {status === 'new-user-preset' && (
              <NewPresetName
                systemName={target.name}
                name={names.get(target.id) ?? ''}
                problem={problemOf(target.id)}
                disabled={saving}
                onChange={(name) => setNames(new Map(names).set(target.id, name))}
              />
            )}
            {reformatted && (
              <p className="warning">
                This file isn't laid out the way OrcaSlicer writes it (it may have been edited by
                hand), so saving rewrites all of it in OrcaSlicer&apos;s layout. The settings stay
                the same.
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="warning">
        A running OrcaSlicer won&apos;t see these changes until it reloads its presets (the results
        will say how). Until then, saving the same presets in OrcaSlicer would overwrite them.
      </p>
    </Dialog>
  );
}

/** The name of the new user preset a system preset's changes go into. */
function NewPresetName({
  systemName,
  name,
  problem,
  disabled,
  onChange,
}: {
  systemName: string;
  name: string;
  problem: string | undefined;
  disabled: boolean;
  onChange: (name: string) => void;
}) {
  const id = useId();
  return (
    <div className="new-preset">
      <p>
        A system preset can&apos;t be changed, so these changes are saved as a new user preset that
        inherits from {systemName}.
      </p>
      <label htmlFor={id}>New preset name for {systemName}</label>
      <input
        id={id}
        type="text"
        value={name}
        disabled={disabled}
        aria-invalid={problem !== undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {problem && (
        <p id={`${id}-problem`} className="field-problem">
          {problem}
        </p>
      )}
    </div>
  );
}
