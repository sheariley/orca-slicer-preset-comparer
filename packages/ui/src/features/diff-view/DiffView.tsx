import type { BaseComparison } from '@comparer/app';
import type { NormalizedValue, ResolvedProfile } from '@comparer/core';
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CloseIcon, IconButton } from '../../components/IconButton.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { useComparerApp } from '../../hooks/useComparerApp.ts';
import { settingNames, unitFor } from './format.ts';

/** What DiffView needs for editing: selecting settings to copy. Without it, the view is read-only. */
export interface DiffEditing {
  /** Selected setting keys. */
  readonly selected: ReadonlySet<string>;
  readonly onSelect: (keys: readonly string[], selected: boolean) => void;
  /** Keys with unsaved changes, by preset id. */
  readonly edited: ReadonlyMap<string, ReadonlySet<string>>;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/** Where a preset's value for a setting came from, in words. */
function sourceText(profile: ResolvedProfile, settingKey: string, edited: boolean): string {
  const source = profile.settings.get(settingKey)?.definedBy;
  if (source === undefined) return edited ? 'not set (unsaved change)' : 'not set';
  const text = source === 'default' ? "OrcaSlicer's built-in default" : `set in "${source.name}"`;
  return edited ? `${text} (unsaved change)` : text;
}

/** A row's tip: the setting's description, then where each preset's value came from. */
function RowTip({
  profiles,
  settingKey,
  description,
  isEdited,
}: {
  profiles: readonly ResolvedProfile[];
  settingKey: string;
  description: string | undefined;
  isEdited: (id: string) => boolean;
}) {
  return (
    <>
      {description && <p>{description}</p>}
      <p>
        {profiles.map((profile, index) => (
          <Fragment key={profile.ref.id}>
            {index > 0 && <br />}
            {profile.ref.name}: {sourceText(profile, settingKey, isEdited(profile.ref.id))}
          </Fragment>
        ))}
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
  className,
}: {
  profile: ResolvedProfile;
  settingKey: string;
  value: NormalizedValue | undefined;
  unit: string | undefined;
  edited: boolean;
  className?: string | undefined;
}) {
  const isDefault = profile.settings.get(settingKey)?.definedBy === 'default';
  const shownUnit = value && unitFor(value, unit);
  const classes = [className, isDefault && 'is-default', edited && 'is-edited']
    .filter(Boolean)
    .join(' ');
  return (
    <td className={classes || undefined}>
      {value ? value.join(', ') : '—'}
      {shownUnit && <span className="unit"> {shownUnit}</span>}
      {edited && <span className="visually-hidden"> (unsaved)</span>}
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

/**
 * The comparison table: a base preset and one column per target. The setting and base columns
 * stay in view while the targets scroll sideways (on wide enough windows; see base.css).
 */
export function DiffView({
  comparison,
  editing,
  onRemoveTarget,
}: {
  comparison: BaseComparison;
  editing?: DiffEditing | undefined;
  /** Offers to take a target out of the comparison, from its column header. */
  onRemoveTarget?: ((id: string) => void) | undefined;
}) {
  const app = useComparerApp();
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  // Keys the catalog doesn't know are ones OrcaSlicer ignores when it loads a profile
  // (e.g. leftovers from Bambu Studio in bundled profiles).
  const [hideUnknown, setHideUnknown] = useState(true);
  const [filter, setFilter] = useState('');
  const { base, targets } = comparison;
  const profiles = [base, ...targets];
  const editedIn = (id: string) => editing?.edited.get(id) ?? NO_KEYS;

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
  const differenceCount = candidates.filter(({ row }) => row.differs).length;

  const needle = filter.trim().toLowerCase();
  const rows = candidates
    // Rows with unsaved changes stay, so a copy that makes the values equal doesn't hide its row.
    .filter(
      ({ row }) =>
        !onlyDifferences ||
        row.differs ||
        profiles.some((profile) => editedIn(profile.ref.id).has(row.key)),
    )
    .filter(
      ({ row, info }) =>
        needle === '' ||
        row.key.toLowerCase().includes(needle) ||
        (info?.label.toLowerCase().includes(needle) ?? false),
    );

  // Wide enough for every value column, so many targets scroll sideways instead of squeezing.
  const tableStyle = {
    '--targets': targets.length,
  } as CSSProperties;

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
      {/* The only part that scrolls; the header row and first columns stay put (sticky). */}
      <div className="diff-scroll">
        <table className={editing ? 'is-editing' : undefined} style={tableStyle}>
          <colgroup>
            {editing && <col className="select-column" />}
            <col className="setting-column" />
            <col className="value-column" />
            {targets.map((target) => (
              <col key={target.ref.id} className="value-column" />
            ))}
          </colgroup>
          <thead>
            <tr>
              {editing && (
                <th scope="col" className="select-cell pinned pin-select">
                  <SelectAll editing={editing} keys={rows.map(({ row }) => row.key)} />
                </th>
              )}
              <th scope="col" className="pinned pin-setting">
                Setting
              </th>
              <ColumnHeader
                profile={base}
                isBase
                edited={editedIn(base.ref.id).size > 0}
                editing={editing !== undefined}
              />
              {targets.map((target) => (
                <ColumnHeader
                  key={target.ref.id}
                  profile={target}
                  edited={editedIn(target.ref.id).size > 0}
                  editing={editing !== undefined}
                  onRemove={onRemoveTarget && (() => onRemoveTarget(target.ref.id))}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, info }) => {
              const label = info?.label ?? row.key;
              const name = names.get(row.key) ?? label;
              return (
                <tr
                  key={row.key}
                  data-status={row.differs ? 'changed' : 'same'}
                  data-selected={editing?.selected.has(row.key) || undefined}
                >
                  {editing && (
                    <td className="select-cell pinned pin-select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${name}`}
                        checked={editing.selected.has(row.key)}
                        onChange={(event) => editing.onSelect([row.key], event.target.checked)}
                      />
                    </td>
                  )}
                  <th scope="row" className="pinned pin-setting">
                    <InfoTip
                      subject={name}
                      content={
                        <RowTip
                          profiles={profiles}
                          settingKey={row.key}
                          description={info?.tooltip}
                          isEdited={(id) => editedIn(id).has(row.key)}
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
                    className="pinned pin-base"
                    profile={base}
                    settingKey={row.key}
                    value={row.base}
                    unit={info?.unit}
                    edited={editedIn(base.ref.id).has(row.key)}
                  />
                  {targets.map((target, index) => (
                    <ValueCell
                      key={target.ref.id}
                      // In a row that differs, a value that matches the base is muted.
                      className={
                        row.differs && row.targets[index]!.status === 'same'
                          ? 'matches-base'
                          : undefined
                      }
                      profile={target}
                      settingKey={row.key}
                      value={row.targets[index]!.value}
                      unit={info?.unit}
                      edited={editedIn(target.ref.id).has(row.key)}
                    />
                  ))}
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

/**
 * A preset's column header: its name, whether it has unsaved changes, whether it's a system
 * preset, and (for a target) a button that takes it out of the comparison.
 */
function ColumnHeader({
  profile,
  isBase = false,
  edited,
  editing,
  onRemove,
}: {
  profile: ResolvedProfile;
  isBase?: boolean;
  edited: boolean;
  editing: boolean;
  onRemove?: (() => void) | undefined;
}) {
  const { ref } = profile;
  return (
    <th scope="col" className={isBase ? 'pinned pin-base' : undefined}>
      <div className="column-header">
        <span className="column-name">
          {ref.name}
          {isBase && <span className="badge">Base</span>}
          {edited && <span className="badge">Unsaved</span>}
          {editing && ref.origin === 'system' && (
            <InfoTip
              subject={`${ref.name}, a system preset`}
              content="A system preset, which OrcaSlicer replaces on updates, so the comparer never changes it. Changes copied into it are saved as a new user preset that inherits from it; you name it when saving."
            >
              <span className="badge">System</span>
            </InfoTip>
          )}
        </span>
        {onRemove && (
          <IconButton
            label={`Remove ${ref.name} from the comparison`}
            icon={<CloseIcon />}
            onClick={onRemove}
          />
        )}
      </div>
    </th>
  );
}
