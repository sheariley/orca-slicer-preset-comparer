import {
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
import { DiffView, type DiffEditing, type Side } from '../diff-view/DiffView.tsx';
import { settingNames } from '../diff-view/format.ts';
import { BulkCopyDialog } from '../bulk-copy/BulkCopyDialog.tsx';
import { SaveDialog } from '../save-flow/SaveDialog.tsx';
import { SaveResults } from '../save-flow/SaveResults.tsx';
import { CopyPreviewDialog, type SingleCopy } from './CopyPreviewDialog.tsx';
import { skipReasonText } from './skip-reasons.ts';

interface ComparisonEditorProps {
  /** The session opened for the two presets. The editor owns it from here on. */
  readonly initial: EditSession;
  readonly left: PresetRef;
  readonly right: PresetRef;
  /** Tells the screen whether there are unsaved changes (so it can confirm before leaving). */
  readonly onDirtyChange: (dirty: boolean) => void;
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
 * Compares two presets and edits them: copying values in either direction, undo/redo, and
 * saving. All edits live in an EditSession until saved.
 */
export function ComparisonEditor({
  initial,
  left,
  right,
  onDirtyChange,
  onPresetCreated,
}: ComparisonEditorProps) {
  const app = useComparerApp();
  const [session, setSession] = useState(initial);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<SingleCopy | null>(null);
  const [bulk, setBulk] = useState<readonly string[] | null>(null);
  const [save, setSave] = useState<SaveState>({ step: 'idle' });
  const [notice, setNotice] = useState('');
  // The names given to new user presets in the last save, so a retry uses them again.
  const [newPresetNames, setNewPresetNames] = useState<ReadonlyMap<string, string>>(new Map());
  // Preset names already in use, for naming new presets; reloaded after each save.
  const [saveCount, setSaveCount] = useState(0);
  const presetNames = useAsync(`${left.type}:${saveCount}`, () =>
    app.listPresets({ type: left.type }).then((refs) => new Set(refs.map((ref) => ref.name))),
  );

  const comparison = useMemo(
    () => app.compareEdited(session, left.id, right.id),
    [app, session, left.id, right.id],
  );
  const pendingEdits = useMemo(() => pending(session), [session]);
  const edited = useMemo(() => {
    const keysOf = (id: string) => {
      const edits = pendingEdits.find((entry) => entry.target.id === id)?.edits;
      return new Set([...Object.keys(edits?.set ?? {}), ...(edits?.remove ?? [])]);
    };
    return { left: keysOf(left.id), right: keysOf(right.id) };
  }, [pendingEdits, left.id, right.id]);
  const dirty = pendingEdits.length > 0;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const canEdit = app.capabilities.canSave && left.id !== right.id;
  // System presets too: saving puts their changes into new user presets.
  const canCopyTo: Record<Side, boolean> = { left: canEdit, right: canEdit };
  const ids: Record<Side, string> = { left: left.id, right: right.id };
  const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');
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
    preview !== null || bulk !== null || save.step === 'confirm' || save.step === 'saving';
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

  /** One-click copy of one setting. Asks first only when there's a "Pin override" choice. */
  const copyOne = (key: string, to: Side) => {
    const request: SingleCopy = { source: ids[other(to)], target: ids[to], keys: [key] };
    const targetName = comparison[to].ref.name;
    const plan = app.previewCopy(session, { ...request, targets: [request.target] }).targets[0]!;
    if (plan.redundantOverrides.length > 0) {
      setPreview(request);
    } else if (plan.changes.length === 0) {
      const reason = plan.skipped[0]?.reason;
      setNotice(
        `Didn't copy ${labelOf(key)}: ${reason ? skipReasonText(reason, targetName) : 'nothing to change.'}`,
      );
    } else {
      apply(request, new Map(), copyLabel(request));
    }
  };

  const copySelected = (to: Side) =>
    setPreview({ source: ids[other(to)], target: ids[to], keys: selectedKeys() });

  const applyBulk = (next: EditSession, label: string) => {
    setSession(next);
    setSelected(new Set());
    setBulk(null);
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
        canCopyTo,
        onCopy: copyOne,
      }
    : undefined;

  // Every preset with unsaved changes, including bulk-copy targets outside the two columns.
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
          {(['left', 'right'] as const).map((to) => (
            <button
              key={to}
              type="button"
              onClick={() => copySelected(to)}
              disabled={selected.size === 0}
            >
              {to === 'left' && <span aria-hidden="true">← </span>}
              Copy selected to {comparison[to].ref.name}
              {selected.size > 0 && ` (${selected.size})`}
              {to === 'right' && <span aria-hidden="true"> →</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setBulk(selectedKeys())}
            disabled={selected.size === 0}
          >
            Copy selected to other presets…
          </button>
          <span className="toolbar-separator" />
          <button
            type="button"
            className="primary"
            disabled={!dirty}
            onClick={() => setSave({ step: 'confirm' })}
          >
            Save…
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

      <DiffView comparison={comparison} editing={editing} />

      {preview && (
        <CopyPreviewDialog
          session={session}
          request={preview}
          onApply={(pins) => apply(preview, pins, copyLabel(preview))}
          onCancel={() => setPreview(null)}
        />
      )}
      {bulk && (
        <BulkCopyDialog
          session={session}
          left={left}
          right={right}
          keys={bulk}
          nameOf={labelOf}
          onApply={applyBulk}
          onCancel={() => setBulk(null)}
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
