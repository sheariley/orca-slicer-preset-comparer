import type { PresetRef, ProfileType } from '@comparer/core';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Dialog } from './components/Dialog.tsx';
import { ErrorMessage } from './components/ErrorMessage.tsx';
import { CloseIcon, IconButton } from './components/IconButton.tsx';
import { InfoTip } from './components/InfoTip.tsx';
import { useTooltip } from './components/Tooltip.tsx';
import { ComparisonEditor } from './features/editing/ComparisonEditor.tsx';
import { PresetPickerDialog } from './features/preset-picker/PresetPickerDialog.tsx';
import { useAsync } from './hooks/useAsync.ts';
import { useComparerApp } from './hooks/useComparerApp.ts';

/** A change that waits for the user to confirm it. */
interface Confirmation {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly run: () => void;
}

const TYPES: readonly { type: ProfileType; label: string }[] = [
  { type: 'filament', label: 'Filament' },
  { type: 'process', label: 'Process' },
];

export function ComparerScreen() {
  const app = useComparerApp();
  const [type, setType] = useState<ProfileType>('filament');
  const [base, setBase] = useState<PresetRef | null>(null);
  const [targets, setTargets] = useState<readonly PresetRef[]>([]);
  // Which picker dialog is open.
  const [picking, setPicking] = useState<'base' | 'targets' | null>(null);

  // The presets with unsaved changes (ids), as the editor reports them.
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set());
  const dirty = unsaved.size > 0;
  // A change waiting for the user to confirm it: discarding unsaved changes (closing the
  // comparison or the window, taking targets out), or clearing the base or the targets.
  const [pendingChange, setPendingChange] = useState<Confirmation | null>(null);
  const discardChanges = (run: () => void, message: string): Confirmation => ({
    title: 'Discard unsaved changes?',
    message,
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
    run,
  });

  // Bumped when saving creates presets, so the pickers list them.
  const [listVersion, setListVersion] = useState(0);
  const presets = useAsync(`${type}:${listVersion}`, () => app.listPresets({ type }));
  // Bumped whenever the user picks a base (or type): each opens a new session. Targets open and
  // close within the session (see ComparisonEditor), and a preset created by saving takes a
  // system preset's place without a new one (see onPresetCreated).
  const [picks, setPicks] = useState(0);
  const comparisonKey = base ? String(picks) : null;
  const session = useAsync(comparisonKey, () => app.openSession([base!, ...targets]));
  const pickBase = (next: PresetRef | null) =>
    leaveComparison(() => {
      setBase(next);
      setTargets((current) => current.filter((target) => target.id !== next?.id));
      setPicks((count) => count + 1);
      setUnsaved(new Set());
    });
  /** Replaces the targets, confirming first if any taken out have unsaved changes. */
  const changeTargets = (next: readonly PresetRef[]) => {
    const kept = new Set(next.map((target) => target.id));
    const losing = targets.filter((target) => !kept.has(target.id) && unsaved.has(target.id));
    if (losing.length === 0) setTargets(next);
    else {
      const names = losing.map((target) => target.name);
      setPendingChange(
        discardChanges(
          () => setTargets(next),
          `Taking ${names.join(', ')} out of the comparison loses ${names.length === 1 ? 'its' : 'their'} unsaved changes.`,
        ),
      );
    }
  };
  /** Clears the base, and with it the targets, after the user confirms. */
  const clearBase = () =>
    setPendingChange({
      title: 'Clear the base preset?',
      message: `Clearing the base also clears the targets${dirty ? ', and the unsaved changes are lost' : ''}.`,
      confirmLabel: 'Clear',
      cancelLabel: 'Cancel',
      run: () => {
        setBase(null);
        setTargets([]);
        setPicks((count) => count + 1);
        setUnsaved(new Set());
      },
    });
  /** Clears the targets, after the user confirms. */
  const clearTargets = () =>
    setPendingChange({
      title: 'Clear the targets?',
      message: `This takes every target out of the comparison${targets.some((target) => unsaved.has(target.id)) ? ', and their unsaved changes are lost' : ''}.`,
      confirmLabel: 'Clear',
      cancelLabel: 'Cancel',
      run: () => setTargets([]),
    });
  const onPresetCreated = useCallback((system: PresetRef, created: PresetRef) => {
    setBase((current) => (current?.id === system.id ? created : current));
    setTargets((current) => current.map((target) => (target.id === system.id ? created : target)));
    setListVersion((version) => version + 1);
  }, []);
  const onPendingChange = useCallback((ids: ReadonlySet<string>) => setUnsaved(ids), []);

  /** Runs a change that would close the current comparison, confirming first if it has edits. */
  const leaveComparison = (change: () => void) => {
    if (dirty) {
      setPendingChange(
        discardChanges(
          change,
          'Choosing another base preset or type closes this comparison, and its unsaved changes are lost.',
        ),
      );
    } else change();
  };
  // Closing the window (where the host can intercept it) asks first too.
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    const guard = app.closeGuard;
    if (!guard) return;
    return guard.onCloseRequested(() => {
      if (!dirtyRef.current) return true;
      setPendingChange({
        title: 'Discard unsaved changes?',
        message: 'Closing the window loses the unsaved changes.',
        confirmLabel: 'Close without saving',
        cancelLabel: 'Keep editing',
        run: () => guard.close(),
      });
      return false;
    });
  }, [app]);

  const chooseType = (next: ProfileType) =>
    leaveComparison(() => {
      setType(next);
      setBase(null);
      setTargets([]);
      setPicks((count) => count + 1);
      setUnsaved(new Set());
    });

  const presetList = presets.status === 'done' ? presets.value : [];

  return (
    <div className="comparer">
      {/* One row: the title, the type tabs, and the pickers, over an accent rule. */}
      <header className="comparer-header">
        <h1>Profile Comparer</h1>
        <div className="type-tabs" role="tablist" aria-label="Profile type">
          {TYPES.map(({ type: value, label }) => (
            <button
              key={value}
              role="tab"
              aria-selected={type === value}
              onClick={() => type !== value && chooseType(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <PresetSelection
          text={base?.name ?? 'Choose base'}
          name={base ? `Base: ${base.name}` : 'Choose base'}
          fullName={base?.name}
          aboutSubject="the base preset"
          disabled={presets.status !== 'done'}
          onChoose={() => setPicking('base')}
          clearLabel="Clear base"
          canClear={base !== null}
          onClear={clearBase}
        />
        {/* The targets show as the table's columns, so the button names one or counts them. */}
        <PresetSelection
          text={
            targets.length === 0
              ? 'Choose targets'
              : targets.length === 1
                ? targets[0]!.name
                : `${targets.length} targets chosen`
          }
          name={
            targets.length === 0
              ? 'Choose targets'
              : targets.length === 1
                ? `Target: ${targets[0]!.name}`
                : `${targets.length} targets chosen`
          }
          fullName={targets.length === 1 ? targets[0]!.name : undefined}
          aboutSubject="the target"
          disabled={presets.status !== 'done'}
          // Targets are compared with the base, so the base comes first: until then, a click
          // only says so.
          blocked={base === null ? 'Choose a base preset first' : undefined}
          onChoose={() => setPicking('targets')}
          clearLabel="Clear targets"
          canClear={targets.length > 0}
          onClear={clearTargets}
        />
        {!app.capabilities.canSave && (
          <InfoTip
            subject="read-only mode"
            content="Saving isn't available here yet, so copying settings is turned off. You can still compare presets."
          >
            <span className="badge">Read-only</span>
          </InfoTip>
        )}
      </header>
      {presets.status === 'failed' && <ErrorMessage error={presets.error} />}

      {session.status === 'loading' && <p className="status">Comparing…</p>}
      {session.status === 'failed' && <ErrorMessage error={session.error} />}
      {session.status === 'done' && (
        <ComparisonEditor
          key={comparisonKey}
          initial={session.value}
          base={base!}
          targets={targets}
          onPendingChange={onPendingChange}
          onRemoveTarget={(id) => changeTargets(targets.filter((target) => target.id !== id))}
          onPresetCreated={onPresetCreated}
        />
      )}
      {session.status === 'idle' && (
        <p className="status">Choose a base preset and the targets to compare it with.</p>
      )}

      {picking === 'base' && (
        <PresetPickerDialog
          mode="single"
          presets={presetList}
          chosen={base}
          onConfirm={(next) => {
            setPicking(null);
            if (next.id !== base?.id) pickBase(next);
          }}
          onCancel={() => setPicking(null)}
        />
      )}
      {picking === 'targets' && base && (
        <PresetPickerDialog
          mode="multiple"
          presets={presetList}
          exclude={base}
          chosen={targets}
          onConfirm={(next) => {
            setPicking(null);
            changeTargets(next);
          }}
          onCancel={() => setPicking(null)}
        />
      )}

      {pendingChange && (
        <Dialog
          title={pendingChange.title}
          onClose={() => setPendingChange(null)}
          actions={
            <>
              <button type="button" onClick={() => setPendingChange(null)}>
                {pendingChange.cancelLabel}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  pendingChange.run();
                  setPendingChange(null);
                }}
              >
                {pendingChange.confirmLabel}
              </button>
            </>
          }
        >
          <p>{pendingChange.message}</p>
        </Dialog>
      )}
    </div>
  );
}

/**
 * A picker's button and its clear button, joined. A long preset name is cut short with an
 * ellipsis; its info tip shows it in full. While the picker can't open yet (`blocked`), the
 * button's tooltip says why, and a click shows it.
 */
function PresetSelection({
  text,
  name,
  fullName,
  aboutSubject,
  disabled,
  blocked,
  onChoose,
  clearLabel,
  canClear,
  onClear,
}: {
  /** The button's text: the chosen preset's name, a count, or what to do. */
  text: string;
  /** The button's accessible name (its text, plus what it's for). */
  name: string;
  /** A chosen preset's full name, for the info tip. */
  fullName?: string | undefined;
  aboutSubject: string;
  disabled: boolean;
  /** Why the picker can't open yet, if it can't. */
  blocked?: string | undefined;
  onChoose: () => void;
  clearLabel: string;
  canClear: boolean;
  onClear: () => void;
}) {
  const blockedId = useId();
  const { setReference, getReferenceProps, show, tooltip } = useTooltip(blocked);
  return (
    <div className="selection-control">
      <div className="button-group">
        <button
          ref={setReference}
          type="button"
          className="selection-button"
          aria-label={name}
          {...(blocked ? { 'aria-describedby': blockedId } : {})}
          disabled={disabled}
          {...getReferenceProps({ onClick: () => (blocked ? show() : onChoose()) })}
        >
          <span className="selection-text">{text}</span>
        </button>
        <IconButton
          label={clearLabel}
          icon={<CloseIcon />}
          disabled={!canClear}
          onClick={onClear}
        />
      </div>
      {fullName && <InfoTip subject={aboutSubject} content={fullName} />}
      {blocked && (
        <span className="visually-hidden" id={blockedId}>
          {blocked}
        </span>
      )}
      {tooltip}
    </div>
  );
}
