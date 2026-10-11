import {
  addToSession,
  canRedoSession,
  canUndoSession,
  pending,
  presetIn,
  redoLabel,
  redoSession,
  undoLabel,
  undoSession,
  type EditSession,
  type TargetSaveResult,
} from '@comparer/app';
import type { PresetRef } from '@comparer/core';
import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import { useAsync } from '../../hooks/useAsync.ts';
import { useComparerApp } from '../../hooks/useComparerApp.ts';
import { DiffView, type DiffEditing } from '../diff-view/DiffView.tsx';
import { settingNames } from '../diff-view/format.ts';
import { SaveDialog } from '../save-flow/SaveDialog.tsx';
import { SaveResults } from '../save-flow/SaveResults.tsx';
import { CopyPreviewDialog, type SingleCopy } from './CopyPreviewDialog.tsx';
import { CopyToTargetsDialog } from './CopyToTargetsDialog.tsx';

interface ComparisonEditorProps {
  /** The session opened for the base (and any targets). The editor owns it from here on. */
  readonly initial: EditSession;
  readonly base: PresetRef;
  /**
   * The presets compared with the base, in column order. The editor opens new ones in its
   * session and closes ones taken out (with their unsaved changes: the screen asks first).
   */
  readonly targets: readonly PresetRef[];
  /**
   * Tells the screen which presets have unsaved changes (so it can confirm before closing them).
   */
  readonly onPendingChange: (ids: ReadonlySet<string>) => void;
  /** Takes a target out of the comparison (from its column header). */
  readonly onRemoveTarget: (id: string) => void;
  /**
   * A system preset's changes were saved as a new user preset, now open in the session. The
   * screen shows the new preset in place of the system one, without reopening the session.
   */
  readonly onPresetCreated?: (system: PresetRef, created: PresetRef) => void;
}

type SaveState =
  | { readonly step: 'idle' }
  | { readonly step: 'confirm' | 'saving' }
  | { readonly step: 'done'; readonly results: readonly TargetSaveResult[] }
  /** Retrying failed saves, or reloading presets that changed on disk. */
  | { readonly step: 'working'; readonly results: readonly TargetSaveResult[] }
  | { readonly step: 'error'; readonly error: unknown };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Compares a base preset with targets and edits them: copying the selected settings from the
 * base to the targets (after a preview), undo/redo, and saving. Copies only ever go from the base
 * to the targets; to copy the other way, choose another base. All edits live in an EditSession
 * until saved.
 */
export function ComparisonEditor({
  initial,
  base,
  targets,
  onPendingChange,
  onRemoveTarget,
  onPresetCreated,
}: ComparisonEditorProps) {
  const app = useComparerApp();
  const [session, setSession] = useState(initial);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<SingleCopy | null>(null);
  const [copyToAll, setCopyToAll] = useState<readonly string[] | null>(null);
  const [save, setSave] = useState<SaveState>({ step: 'idle' });
  const [notice, setNotice] = useState('');
  // The names given to new user presets in the last save, so a retry uses them again.
  const [newPresetNames, setNewPresetNames] = useState<ReadonlyMap<string, string>>(new Map());
  // Preset names already in use, for naming new presets; reloaded after each save.
  const [saveCount, setSaveCount] = useState(0);
  const presetNames = useAsync(`${base.type}:${saveCount}`, () =>
    app.listPresets({ type: base.type }).then((refs) => new Set(refs.map((ref) => ref.name))),
  );

  // Keep the session's presets in step with the comparison. Presets taken out (and system
  // presets that saving replaced with new user presets) close as soon as the targets change...
  const wantedKey = [base.id, ...targets.map((target) => target.id)].join('\n');
  const [syncedKey, setSyncedKey] = useState(wantedKey);
  if (syncedKey !== wantedKey) {
    setSyncedKey(wantedKey);
    const wanted = new Set(wantedKey.split('\n'));
    setSession(
      app.removePresets(
        session,
        [...session.presets.keys()].filter((id) => !wanted.has(id)),
      ),
    );
  }
  // ...and new targets open in the background; until then, their columns wait.
  const missing = targets.filter((target) => !session.presets.has(target.id));
  const missingKey = missing.map((target) => target.id).join('\n');
  const [openError, setOpenError] = useState<{ key: string; error: unknown } | null>(null);
  useEffect(() => {
    if (missing.length === 0) return;
    let current = true;
    app.openSession(missing).then(
      (opened) =>
        current && setSession((state) => addToSession(state, [...opened.presets.values()])),
      (error: unknown) => current && setOpenError({ key: missingKey, error }),
    );
    return () => {
      current = false;
    };
    // `missing` is keyed by its ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, missingKey]);
  const opening = missing.length > 0;
  const openFailed = opening && openError?.key === missingKey ? openError : null;

  const shown = useMemo(
    () => targets.filter((target) => session.presets.has(target.id)),
    [targets, session],
  );
  const comparison = useMemo(
    () =>
      app.compareTargets(
        session,
        base.id,
        shown.map((target) => target.id),
      ),
    [app, session, base.id, shown],
  );
  const pendingEdits = useMemo(() => pending(session), [session]);
  const edited = useMemo(
    () =>
      new Map(
        pendingEdits.map(({ target, edits }) => [
          target.id,
          new Set([...Object.keys(edits.set ?? {}), ...(edits.remove ?? [])]),
        ]),
      ),
    [pendingEdits],
  );
  const dirty = pendingEdits.length > 0;
  const pendingKey = pendingEdits.map(({ target }) => target.id).join('\n');

  useEffect(
    () => onPendingChange(new Set(pendingKey === '' ? [] : pendingKey.split('\n'))),
    [pendingKey, onPendingChange],
  );

  // System presets too: saving puts their changes into new user presets.
  const canEdit = app.capabilities.canSave;
  const names = useMemo(
    () =>
      settingNames(
        comparison.rows.map((row) => row.key),
        (key) => app.describeSetting(key)?.label ?? key,
      ),
    [app, comparison],
  );
  const labelOf = (key: string) => names.get(key) ?? key;
  const dialogOpen =
    preview !== null || copyToAll !== null || save.step === 'confirm' || save.step === 'saving';
  /** The selected settings, in the table's order (not the order they were ticked). */
  const selectedKeys = () =>
    comparison.rows.map((row) => row.key).filter((key) => selected.has(key));

  const apply = (request: SingleCopy, pins: ReadonlyMap<string, boolean>, label?: string) => {
    const { session: next } = app.copy(
      session,
      {
        source: request.source,
        targets: [request.target],
        keys: request.keys,
        pinOverrides: new Map([[request.target, pins]]),
      },
      label,
    );
    setSession(next);
    setSelected(new Set());
    setPreview(null);
    setNotice(`${next.history.done.at(-1)?.label ?? 'Copied'}. Not saved yet.`);
  };

  /** Names the setting when there's just one (the app's default label counts them). */
  const copyLabel = ({ target, keys }: SingleCopy) =>
    keys.length === 1
      ? `Copy ${labelOf(keys[0]!)} to ${presetIn(session, target).ref.name}`
      : undefined;

  /** The selection, from the base to every target: one target's preview, or all of theirs. */
  const copySelected = () => {
    if (shown.length === 1) {
      setPreview({ source: base.id, target: shown[0]!.id, keys: selectedKeys() });
    } else {
      setCopyToAll(selectedKeys());
    }
  };

  const applyToAll = (next: EditSession, label: string) => {
    setSession(next);
    setSelected(new Set());
    setCopyToAll(null);
    setNotice(`${label}. Not saved yet.`);
  };

  const undo = () => {
    const label = undoLabel(session);
    if (!label) return;
    setSession(undoSession(session));
    setNotice(`Undid: ${label}.`);
  };
  const redo = () => {
    const label = redoLabel(session);
    if (!label) return;
    setSession(redoSession(session));
    setNotice(`Redid: ${label}.`);
  };

  // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (⌘ on macOS), except while typing or in a dialog.
  useEffect(() => {
    if (!canEdit || dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input:not([type="checkbox"]), textarea, select, [contenteditable]')) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) undo();
      else if (key === 'y' || (key === 'z' && event.shiftKey)) redo();
      else return;
      event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const runSave = async (retry: TargetSaveResult[] | null, names = newPresetNames) => {
    setSave(retry ? { step: 'working', results: retry } : { step: 'saving' });
    setNewPresetNames(names);
    try {
      const { session: next, results } = await app.saveChanges(session, {
        newPresetNames: names,
      });
      setSession(next);
      setSave({ step: 'done', results });
      setNotice('');
      setSaveCount((count) => count + 1);
      for (const result of results) {
        if (result.status === 'created') onPresetCreated?.(result.target, result.created);
      }
    } catch (error) {
      setSave({ step: 'error', error });
    }
  };

  const reload = async (ids: readonly string[], results: TargetSaveResult[]) => {
    setSave({ step: 'working', results });
    try {
      setSession(await app.reloadPresets(session, ids));
      setSave({ step: 'idle' });
      const names = ids.map((id) => presetIn(session, id).ref.name).join(', ');
      setNotice(
        `Reloaded ${names} from disk and reapplied your unsaved changes. Check them, then save again.`,
      );
    } catch (error) {
      setSave({ step: 'error', error });
    }
  };

  const editing: DiffEditing | undefined = canEdit
    ? {
        selected,
        onSelect: (keys, isSelected) => {
          const next = new Set(selected);
          for (const key of keys) {
            if (isSelected) next.add(key);
            else next.delete(key);
          }
          setSelected(next);
        },
        edited,
      }
    : undefined;

  // Every preset with unsaved changes.
  const editedCount = pendingEdits.reduce(
    (count, { edits }) => count + Object.keys(edits.set ?? {}).length + (edits.remove ?? []).length,
    0,
  );
  const unsavedText =
    editedCount === 0
      ? 'No unsaved changes'
      : pendingEdits.length > 1
        ? `${plural(editedCount, 'unsaved change')} in ${plural(pendingEdits.length, 'preset')}`
        : plural(editedCount, 'unsaved change');
  const nextUndo = undoLabel(session);
  const nextRedo = redoLabel(session);

  return (
    <div className="comparison">
      {canEdit && (
        <div className="edit-toolbar" role="group" aria-label="Editing">
          <span className="unsaved-count">{unsavedText}</span>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndoSession(session)}
            aria-label={nextUndo ? `Undo: ${nextUndo}` : 'Undo'}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedoSession(session)}
            aria-label={nextRedo ? `Redo: ${nextRedo}` : 'Redo'}
          >
            Redo
          </button>
          <span className="toolbar-separator" />
          <button
            type="button"
            onClick={copySelected}
            disabled={selected.size === 0 || shown.length === 0}
          >
            Copy selected to{' '}
            {shown.length === 1 ? shown[0]!.name : `${plural(shown.length, 'target')}`}
            {selected.size > 0 && ` (${selected.size})`}
            <span aria-hidden="true"> →</span>
          </button>
          <span className="toolbar-separator" />
          <button
            type="button"
            className="primary"
            disabled={!dirty}
            onClick={() => setSave({ step: 'confirm' })}
          >
            Save
          </button>
        </div>
      )}
      <p role="status" className="notice">
        {notice}
      </p>

      {(save.step === 'done' || save.step === 'working') && (
        <SaveResults
          results={save.results}
          working={save.step === 'working'}
          onRetry={() => void runSave([...save.results])}
          onReload={(ids) => void reload(ids, [...save.results])}
          onDismiss={() => setSave({ step: 'idle' })}
        />
      )}
      {save.step === 'error' && <ErrorMessage error={save.error} />}

      {openFailed && <ErrorMessage error={openFailed.error} />}
      {opening && !openFailed && <p className="status">Opening presets…</p>}
      {targets.length === 0 ? (
        <p className="status">Choose targets to compare with {base.name}.</p>
      ) : (
        <DiffView comparison={comparison} editing={editing} onRemoveTarget={onRemoveTarget} />
      )}

      {preview && (
        <CopyPreviewDialog
          session={session}
          request={preview}
          onApply={(pins) => apply(preview, pins, copyLabel(preview))}
          onCancel={() => setPreview(null)}
        />
      )}
      {copyToAll && (
        <CopyToTargetsDialog
          session={session}
          source={base.id}
          targets={shown.map((target) => target.id)}
          keys={copyToAll}
          onApply={applyToAll}
          onCancel={() => setCopyToAll(null)}
        />
      )}
      {(save.step === 'confirm' || save.step === 'saving') && (
        <SaveDialog
          previews={app.previewSave(session)}
          nameOf={labelOf}
          takenNames={presetNames.status === 'done' ? presetNames.value : undefined}
          saving={save.step === 'saving'}
          onConfirm={(names) => void runSave(null, names)}
          onCancel={() => setSave({ step: 'idle' })}
        />
      )}
    </div>
  );
}
