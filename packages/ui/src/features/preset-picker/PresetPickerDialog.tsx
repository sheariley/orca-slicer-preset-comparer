import type { PresetRef } from '@comparer/core';
import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { isBoolean, usePreference } from '../../hooks/usePreference.ts';

interface CommonProps {
  /** Every preset of the comparison's type. */
  readonly presets: readonly PresetRef[];
  /** A preset that isn't offered (the base, when choosing targets). */
  readonly exclude?: PresetRef | null;
  readonly onCancel: () => void;
}

/** Choosing the base: one preset, with radio buttons. */
interface SingleProps extends CommonProps {
  readonly mode: 'single';
  readonly chosen: PresetRef | null;
  readonly onConfirm: (preset: PresetRef) => void;
}

/** Choosing the targets: any number, with checkboxes and select-all. */
interface MultipleProps extends CommonProps {
  readonly mode: 'multiple';
  readonly chosen: readonly PresetRef[];
  /** Replaces the targets, in list order. */
  readonly onConfirm: (presets: readonly PresetRef[]) => void;
}

type SortOrder = 'ascending' | 'descending';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Chooses presets from a table sortable by name, filtered by name and (remembered for each mode)
 * by whether system presets show. One dialog for both pickers: the base (`single`, radio
 * buttons) and the targets (`multiple`, checkboxes and select-all). A choice stays made while a
 * filter hides it.
 */
export function PresetPickerDialog(props: SingleProps | MultipleProps) {
  const { presets, exclude, onCancel } = props;
  const multiple = props.mode === 'multiple';
  const [selected, setSelected] = useState<ReadonlySet<string>>(() =>
    multiple
      ? new Set(props.chosen.map((preset) => preset.id))
      : new Set(props.chosen ? [props.chosen.id] : []),
  );
  const radioGroup = useId();
  const [text, setText] = useState('');
  const [order, setOrder] = useState<SortOrder>('ascending');
  const [showSystem, setShowSystem] = usePreference(
    multiple ? 'targetPicker.showSystem' : 'basePicker.showSystem',
    false,
    isBoolean,
  );

  // Templates OrcaSlicer never offers (instantiation: "false") stay hidden unless asked for.
  const [showTemplates, setShowTemplates] = useState(false);
  const [vendor, setVendor] = useState('');
  const [printer, setPrinter] = useState('');

  const candidates = presets.filter((preset) => preset.id !== exclude?.id);
  const vendors = sortedUnique(candidates.flatMap((preset) => vendorOf(preset) ?? []));
  const printers = sortedUnique(candidates.flatMap((preset) => preset.details?.printers ?? []));
  const hasTemplates = candidates.some((preset) => preset.details?.selectable === false);
  // Same-named presets (e.g. copies in two user folders) say where each one is.
  const nameCounts = new Map<string, number>();
  for (const preset of candidates) {
    nameCounts.set(preset.name, (nameCounts.get(preset.name) ?? 0) + 1);
  }
  // OrcaSlicer's user folders: "default" (signed out) and one per account, named by its id.
  const accounts = sortedUnique(
    presets.flatMap((preset) =>
      preset.folder && preset.folder !== 'default' ? [preset.folder] : [],
    ),
  );
  const whereabouts = (preset: PresetRef) =>
    (nameCounts.get(preset.name) ?? 0) > 1 ? placeOf(preset, accounts) : undefined;

  const needle = text.trim().toLowerCase();
  const shown = candidates
    .filter(
      (preset) =>
        (showSystem || preset.origin !== 'system') &&
        (showTemplates || preset.details?.selectable !== false) &&
        (vendor === '' || vendorOf(preset) === vendor) &&
        // A preset that lists no printers is for any printer.
        (printer === '' ||
          !preset.details?.printers.length ||
          preset.details.printers.includes(printer)) &&
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
    const next = new Set(multiple ? selected : []);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };

  const confirm = () => {
    if (props.mode === 'multiple') props.onConfirm(chosenPresets);
    else if (chosenPresets[0]) props.onConfirm(chosenPresets[0]);
  };

  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAll.current) {
      selectAll.current.indeterminate = shownSelected > 0 && shownSelected < shown.length;
    }
  });

  return (
    <Dialog
      title={multiple ? 'Choose targets' : 'Choose the base preset'}
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
            disabled={!multiple && chosenPresets.length === 0}
            onClick={confirm}
          >
            {multiple ? 'Compare' : 'Choose'}
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
        {showSystem && hasTemplates && (
          <span className="toggle">
            <label className="toggle">
              <input
                type="checkbox"
                checked={showTemplates}
                onChange={(event) => setShowTemplates(event.target.checked)}
              />
              Show templates
            </label>
            <InfoTip
              subject="templates"
              content="System presets that OrcaSlicer only uses as parents of other presets (such as @base ones) and never offers in its own lists."
            />
          </span>
        )}
      </div>
      {(vendors.length > 0 || printers.length > 0) && (
        <div className="target-filters">
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
          {printers.length > 0 && (
            <select
              aria-label="Printer"
              value={printer}
              onChange={(event) => setPrinter(event.target.value)}
            >
              <option value="">All printers</option>
              {printers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <p className="target-count" role="status">
        {multiple
          ? `${plural(chosenPresets.length, 'preset')} chosen`
          : `Chosen: ${chosenPresets[0]?.name ?? 'none'}`}
        {hiddenChosen > 0 && (multiple ? ` (${hiddenChosen} not shown)` : ' (not shown)')}
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
                {multiple ? (
                  <label className="hit-area">
                    <input
                      ref={selectAll}
                      type="checkbox"
                      aria-label="Choose all shown presets"
                      checked={shown.length > 0 && shownSelected === shown.length}
                      disabled={shown.length === 0}
                      onChange={(event) => toggle(shownIds, event.target.checked)}
                    />
                  </label>
                ) : (
                  <span className="visually-hidden">Chosen</span>
                )}
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
            {shown.map((preset, index) => (
              <tr key={preset.id} data-selected={selected.has(preset.id) || undefined}>
                <td className="select-cell">
                  <label className="hit-area">
                    <input
                      id={`${radioGroup}-${index}`}
                      type={multiple ? 'checkbox' : 'radio'}
                      name={multiple ? undefined : radioGroup}
                      aria-label={`Choose ${preset.name}${whereabouts(preset) ? ` (${whereabouts(preset)})` : ''}`}
                      checked={selected.has(preset.id)}
                      onChange={(event) => toggle([preset.id], event.target.checked)}
                    />
                  </label>
                </td>
                <td>
                  {/* The name chooses the preset too. */}
                  <label className="preset-name" htmlFor={`${radioGroup}-${index}`}>
                    {preset.name}
                    {preset.origin === 'system' && (
                      <span className="badge">{preset.vendor ?? 'System'}</span>
                    )}
                    {preset.details?.selectable === false && (
                      <span className="badge">Template</span>
                    )}
                    {whereabouts(preset) && preset.origin !== 'system' && (
                      <span className="badge">{whereabouts(preset)}</span>
                    )}
                  </label>
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

/** The vendor a preset belongs to: its own folder's, or the one its system parent is in. */
const vendorOf = (preset: PresetRef) => preset.details?.vendor ?? preset.vendor;

/**
 * Where a preset lives, to tell it from one with the same name: its vendor, or its user folder
 * ("default", or "account" for an account's; with several accounts, the start of each id).
 */
function placeOf(preset: PresetRef, accounts: readonly string[]): string {
  if (preset.origin === 'system') return preset.vendor ?? 'system';
  if (!preset.folder) return 'user';
  if (preset.folder === 'default') return 'default';
  return accounts.length > 1 ? `account ${preset.folder.slice(0, 8)}` : 'account';
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
