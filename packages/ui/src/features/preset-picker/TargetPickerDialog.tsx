import type { PresetRef } from '@comparer/core';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog.tsx';
import { isBoolean, usePreference } from '../../hooks/usePreference.ts';

interface TargetPickerDialogProps {
  /** Every preset of the comparison's type. */
  readonly presets: readonly PresetRef[];
  /** The base preset, which can't also be a target, so it isn't listed. */
  readonly base: PresetRef;
  /** The targets chosen so far. */
  readonly chosen: readonly PresetRef[];
  /** Replaces the targets, in list order. */
  readonly onConfirm: (targets: readonly PresetRef[]) => void;
  readonly onCancel: () => void;
}

type SortOrder = 'ascending' | 'descending';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Chooses the presets to compare with the base: a table of presets with a checkbox each,
 * sortable by name, filtered by name and (remembered) by whether system presets show. Presets
 * stay chosen while a filter hides them.
 */
export function TargetPickerDialog({
  presets,
  base,
  chosen,
  onConfirm,
  onCancel,
}: TargetPickerDialogProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(chosen.map((preset) => preset.id)),
  );
  const [text, setText] = useState('');
  const [order, setOrder] = useState<SortOrder>('ascending');
  const [showSystem, setShowSystem] = usePreference('targetPicker.showSystem', false, isBoolean);

  const candidates = presets.filter((preset) => preset.id !== base.id);
  const needle = text.trim().toLowerCase();
  const shown = candidates
    .filter(
      (preset) =>
        (showSystem || preset.origin !== 'system') &&
        (needle === '' || preset.name.toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return order === 'ascending' ? byName : -byName;
    });
  const shownIds = shown.map((preset) => preset.id);
  const shownSelected = shownIds.filter((id) => selected.has(id)).length;
  const chosenPresets = candidates.filter((preset) => selected.has(preset.id));
  const hiddenChosen = chosenPresets.length - shownSelected;

  const toggle = (ids: readonly string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };

  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAll.current) {
      selectAll.current.indeterminate = shownSelected > 0 && shownSelected < shown.length;
    }
  });

  return (
    <Dialog
      title="Choose targets"
      wide
      onClose={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onConfirm(chosenPresets)}>
            Compare
          </button>
        </>
      }
    >
      <div className="target-filters">
        <input
          type="search"
          placeholder="Filter by name"
          aria-label="Filter presets by name"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(event) => setShowSystem(event.target.checked)}
          />
          Show system presets
        </label>
      </div>
      <p className="target-count" role="status">
        {plural(chosenPresets.length, 'preset')} chosen
        {hiddenChosen > 0 && ` (${hiddenChosen} not shown)`}
      </p>
      <div className="target-table-scroll">
        <table className="target-table">
          <colgroup>
            <col className="select-column" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="select-cell">
                <input
                  ref={selectAll}
                  type="checkbox"
                  aria-label="Choose all shown presets"
                  checked={shown.length > 0 && shownSelected === shown.length}
                  disabled={shown.length === 0}
                  onChange={(event) => toggle(shownIds, event.target.checked)}
                />
              </th>
              <th scope="col" aria-sort={order}>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => setOrder(order === 'ascending' ? 'descending' : 'ascending')}
                >
                  Name
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      d={order === 'ascending' ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="visually-hidden">
                    {order === 'ascending' ? ', sorted A to Z' : ', sorted Z to A'}
                  </span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((preset) => (
              <tr key={preset.id} data-selected={selected.has(preset.id) || undefined}>
                <td className="select-cell">
                  <input
                    type="checkbox"
                    aria-label={`Choose ${preset.name}`}
                    checked={selected.has(preset.id)}
                    onChange={(event) => toggle([preset.id], event.target.checked)}
                  />
                </td>
                <td>
                  {preset.name}
                  {preset.origin === 'system' && (
                    <span className="badge">{preset.vendor ?? 'System'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">No presets match.</p>}
      </div>
    </Dialog>
  );
}
