import type { Comparison } from '@comparer/app';
import type { NormalizedValue, ResolvedProfile } from '@comparer/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { InfoTip } from '../../components/InfoTip.tsx';
import { useComparerApp } from '../../hooks/useComparerApp.ts';
import { settingNames, unitFor } from './format.ts';

export type Side = 'left' | 'right';

/** What DiffView needs to offer copying. Without it, the view is read-only. */
export interface DiffEditing {
  /** Selected setting keys. */
  readonly selected: ReadonlySet<string>;
  readonly onSelect: (keys: readonly string[], selected: boolean) => void;
  /** Keys with unsaved changes, per side. */
  readonly edited: Readonly<Record<Side, ReadonlySet<string>>>;
  /** Whether each side can receive copies (e.g. not a system preset). */
  readonly canCopyTo: Readonly<Record<Side, boolean>>;
  /** Copies one setting's value to the given side. */
  readonly onCopy: (key: string, to: Side) => void;
}

/** Where a preset's value for a setting came from, in words. */
function sourceText(profile: ResolvedProfile, settingKey: string, edited: boolean): string {
  const source = profile.settings.get(settingKey)?.definedBy;
  if (source === undefined) return edited ? 'not set (unsaved change)' : 'not set';
  const text = source === 'default' ? "OrcaSlicer's built-in default" : `set in "${source.name}"`;
  return edited ? `${text} (unsaved change)` : text;
}

/** A row's tip: the setting's description, then where each side's value came from. */
function RowTip({
  comparison,
  settingKey,
  description,
  edited,
}: {
  comparison: Comparison;
  settingKey: string;
  description: string | undefined;
  edited: Readonly<Record<Side, boolean>>;
}) {
  return (
    <>
      {description && <p>{description}</p>}
      <p>
        {comparison.left.ref.name}: {sourceText(comparison.left, settingKey, edited.left)}
        <br />
        {comparison.right.ref.name}: {sourceText(comparison.right, settingKey, edited.right)}
      </p>
    </>
  );
}

function ValueCell({
  profile,
  settingKey,
  value,
  unit,
  edited,
}: {
  profile: ResolvedProfile;
  settingKey: string;
  value: NormalizedValue | undefined;
  unit: string | undefined;
  edited: boolean;
}) {
  const isDefault = profile.settings.get(settingKey)?.definedBy === 'default';
  const shownUnit = value && unitFor(value, unit);
  const classes = [isDefault && 'is-default', edited && 'is-edited'].filter(Boolean).join(' ');
  return (
    <td className={classes || undefined}>
      {value ? value.join(', ') : '—'}
      {shownUnit && <span className="unit"> {shownUnit}</span>}
      {edited && <span className="visually-hidden"> (unsaved)</span>}
    </td>
  );
}

function ArrowIcon({ to }: { to: Side }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d={to === 'right' ? 'M2 8h11M9 4l4 4-4 4' : 'M14 8H3M7 4L3 8l4 4'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The copy buttons between the two value columns. */
function CopyCell({
  editing,
  comparison,
  settingKey,
  label,
  row,
}: {
  editing: DiffEditing;
  comparison: Comparison;
  settingKey: string;
  label: string;
  row: Comparison['rows'][number];
}) {
  // Nothing to copy when both sides agree, or from a side without a value.
  const offer = (to: Side) =>
    editing.canCopyTo[to] &&
    row.status !== 'same' &&
    (to === 'right' ? row.left : row.right) !== undefined;
  return (
    <td className="copy-cell">
      {(['right', 'left'] as const).map((to) =>
        offer(to) ? (
          <button
            key={to}
            type="button"
            className="icon-button"
            aria-label={`Copy ${label} to ${comparison[to].ref.name}`}
            onClick={() => editing.onCopy(settingKey, to)}
          >
            <ArrowIcon to={to} />
          </button>
        ) : (
          <span key={to} className="icon-button-placeholder" />
        ),
      )}
    </td>
  );
}

/** Selects or clears every row shown; mixed when only some are selected. */
function SelectAll({ editing, keys }: { editing: DiffEditing; keys: readonly string[] }) {
  const ref = useRef<HTMLInputElement>(null);
  const count = keys.filter((key) => editing.selected.has(key)).length;
  const all = keys.length > 0 && count === keys.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all;
  }, [count, all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all shown settings"
      checked={all}
      disabled={keys.length === 0}
      onChange={(event) => editing.onSelect(keys, event.target.checked)}
    />
  );
}

export function DiffView({
  comparison,
  editing,
}: {
  comparison: Comparison;
  editing?: DiffEditing | undefined;
}) {
  const app = useComparerApp();
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  // Keys the catalog doesn't know are ones OrcaSlicer ignores when it loads a profile
  // (e.g. leftovers from Bambu Studio in bundled profiles).
  const [hideUnknown, setHideUnknown] = useState(true);
  const [filter, setFilter] = useState('');

  const described = useMemo(
    () => comparison.rows.map((row) => ({ row, info: app.describeSetting(row.key) })),
    [app, comparison],
  );
  // For accessible names: OrcaSlicer reuses some labels, so these add the key where needed.
  const names = useMemo(
    () =>
      settingNames(
        described.map(({ row }) => row.key),
        (key) => app.describeSetting(key)?.label ?? key,
      ),
    [app, described],
  );
  const unknownCount = described.filter(({ info }) => !info).length;
  const candidates = hideUnknown ? described.filter(({ info }) => info) : described;
  const differenceCount = candidates.filter(({ row }) => row.status !== 'same').length;

  const needle = filter.trim().toLowerCase();
  const rows = candidates
    // Rows with unsaved changes stay, so a copy that makes both sides equal doesn't hide its row.
    .filter(
      ({ row }) =>
        !onlyDifferences ||
        row.status !== 'same' ||
        editing?.edited.left.has(row.key) ||
        editing?.edited.right.has(row.key),
    )
    .filter(
      ({ row, info }) =>
        needle === '' ||
        row.key.toLowerCase().includes(needle) ||
        (info?.label.toLowerCase().includes(needle) ?? false),
    );

  return (
    <section className="diff" aria-label="Differences">
      <div className="diff-toolbar">
        <input
          type="search"
          placeholder="Filter settings"
          aria-label="Filter settings"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={onlyDifferences}
            onChange={(event) => setOnlyDifferences(event.target.checked)}
          />
          Only differences ({differenceCount})
        </label>
        {unknownCount > 0 && (
          <span className="toggle">
            <label className="toggle">
              <input
                type="checkbox"
                checked={hideUnknown}
                onChange={(event) => setHideUnknown(event.target.checked)}
              />
              Hide settings OrcaSlicer doesn't use ({unknownCount})
            </label>
            <InfoTip
              subject="hidden settings"
              content="Keys OrcaSlicer doesn't define, such as Bambu Studio leftovers in bundled profiles. OrcaSlicer ignores them when it loads a profile."
            />
          </span>
        )}
      </div>
      {/* The only part that scrolls; the header row stays put (sticky). */}
      <div className="diff-scroll">
        <table>
          <colgroup>
            {editing && <col className="select-column" />}
            <col className="setting-column" />
            <col />
            {editing && <col className="copy-column" />}
            <col />
          </colgroup>
          <thead>
            <tr>
              {editing && (
                <th scope="col" className="select-cell">
                  <SelectAll editing={editing} keys={rows.map(({ row }) => row.key)} />
                </th>
              )}
              <th scope="col">Setting</th>
              <ColumnHeader comparison={comparison} side="left" editing={editing} />
              {editing && (
                <th scope="col">
                  <span className="visually-hidden">Copy</span>
                </th>
              )}
              <ColumnHeader comparison={comparison} side="right" editing={editing} />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, info }) => {
              const label = info?.label ?? row.key;
              const name = names.get(row.key) ?? label;
              const edited = {
                left: editing?.edited.left.has(row.key) ?? false,
                right: editing?.edited.right.has(row.key) ?? false,
              };
              return (
                <tr
                  key={row.key}
                  data-status={row.status}
                  data-selected={editing?.selected.has(row.key) || undefined}
                >
                  {editing && (
                    <td className="select-cell">
                      <input
                        type="checkbox"
                        aria-label={`Select ${name}`}
                        checked={editing.selected.has(row.key)}
                        onChange={(event) => editing.onSelect([row.key], event.target.checked)}
                      />
                    </td>
                  )}
                  <th scope="row">
                    <InfoTip
                      subject={name}
                      content={
                        <RowTip
                          comparison={comparison}
                          settingKey={row.key}
                          description={info?.tooltip}
                          edited={edited}
                        />
                      }
                    >
                      <span className="setting-label">{label}</span>
                    </InfoTip>
                    {info && info.label !== row.key && (
                      <code className="setting-key">{row.key}</code>
                    )}
                  </th>
                  <ValueCell
                    profile={comparison.left}
                    settingKey={row.key}
                    value={row.left}
                    unit={info?.unit}
                    edited={edited.left}
                  />
                  {editing && (
                    <CopyCell
                      editing={editing}
                      comparison={comparison}
                      settingKey={row.key}
                      label={name}
                      row={row}
                    />
                  )}
                  <ValueCell
                    profile={comparison.right}
                    settingKey={row.key}
                    value={row.right}
                    unit={info?.unit}
                    edited={edited.right}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">No settings match.</p>}
      </div>
    </section>
  );
}

/** A preset's column header: its name, whether it has unsaved changes, and whether it's a system preset. */
function ColumnHeader({
  comparison,
  side,
  editing,
}: {
  comparison: Comparison;
  side: Side;
  editing: DiffEditing | undefined;
}) {
  const { ref } = comparison[side];
  return (
    <th scope="col">
      {ref.name}
      {editing && editing.edited[side].size > 0 && <span className="badge">Unsaved</span>}
      {editing && ref.origin === 'system' && (
        <InfoTip
          subject={`${ref.name}, a system preset`}
          content="A system preset, which OrcaSlicer replaces on updates, so the comparer never changes it. Changes copied into it are saved as a new user preset that inherits from it; you name it when saving."
        >
          <span className="badge">System</span>
        </InfoTip>
      )}
    </th>
  );
}
