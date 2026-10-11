import type { PresetRef, ProfileType } from '@comparer/core';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Dialog } from './components/Dialog.tsx';
import { ErrorMessage } from './components/ErrorMessage.tsx';
import { InfoTip } from './components/InfoTip.tsx';
import { ComparisonEditor } from './features/editing/ComparisonEditor.tsx';
import { PresetPicker } from './features/preset-picker/PresetPicker.tsx';
import { TargetPickerDialog } from './features/preset-picker/TargetPickerDialog.tsx';
import { useAsync } from './hooks/useAsync.ts';
import { useComparerApp } from './hooks/useComparerApp.ts';
import { isBoolean, usePreference } from './hooks/usePreference.ts';

const TYPES: readonly { type: ProfileType; label: string }[] = [
  { type: 'filament', label: 'Filament' },
  { type: 'process', label: 'Process' },
];

export function ComparerScreen() {
  const app = useComparerApp();
  const [type, setType] = useState<ProfileType>('filament');
  const [base, setBase] = useState<PresetRef | null>(null);
  const [targets, setTargets] = useState<readonly PresetRef[]>([]);
  const [choosingTargets, setChoosingTargets] = useState(false);

  // The presets with unsaved changes (ids), as the editor reports them.
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set());
  const dirty = unsaved.size > 0;
  // A change waiting for the user to confirm discarding unsaved changes: closing the comparison
  // or the window, or taking targets with unsaved changes out (`names`).
  const [pendingChange, setPendingChange] = useState<
    | { readonly run: () => void; readonly reason: 'presets' | 'close' }
    | { readonly run: () => void; readonly reason: 'targets'; readonly names: readonly string[] }
    | null
  >(null);

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
      setPendingChange({
        run: () => setTargets(next),
        reason: 'targets',
        names: losing.map((target) => target.name),
      });
    }
  };
  const onPresetCreated = useCallback((system: PresetRef, created: PresetRef) => {
    setBase((current) => (current?.id === system.id ? created : current));
    setTargets((current) => current.map((target) => (target.id === system.id ? created : target)));
    setListVersion((version) => version + 1);
  }, []);
  const onPendingChange = useCallback((ids: ReadonlySet<string>) => setUnsaved(ids), []);

  /** Runs a change that would close the current comparison, confirming first if it has edits. */
  const leaveComparison = (change: () => void) => {
    if (dirty) setPendingChange({ run: change, reason: 'presets' });
    else change();
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
      setPendingChange({ run: () => guard.close(), reason: 'close' });
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

  // The type tabs and pickers can fold away to a summary line, leaving more room for the table.
  // Only while comparing: with nothing chosen, they're all there is.
  const selectionId = useId();
  const [hidePresets, setHidePresets] = usePreference('layout.hidePresets', false, isBoolean);
  const comparing = base !== null && targets.length > 0;
  const collapsed = hidePresets && comparing;

  return (
    <div className="comparer">
      <div className="comparer-top">
        <header className="comparer-header">
          <h1>Profile Comparer</h1>
          {collapsed && base && (
            <p className="selection-summary">
              {TYPES.find((option) => option.type === type)?.label}: <strong>{base.name}</strong> vs{' '}
              <strong>{targets.map((target) => target.name).join(', ')}</strong>
            </p>
          )}
          {!app.capabilities.canSave && (
            <InfoTip
              subject="read-only mode"
              content="Saving isn't available here yet, so copying settings is turned off. You can still compare presets."
            >
              <span className="badge">Read-only</span>
            </InfoTip>
          )}
          {comparing && (
            <button
              type="button"
              className="collapse-button"
              aria-expanded={!collapsed}
              aria-controls={selectionId}
              onClick={() => setHidePresets(!collapsed)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <path
                  d={collapsed ? 'M4 6l4 4 4-4' : 'M4 10l4-4 4 4'}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {collapsed ? 'Show presets' : 'Hide presets'}
            </button>
          )}
        </header>

        <div id={selectionId} className="selection" hidden={collapsed}>
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
          {presets.status === 'failed' ? (
            <ErrorMessage error={presets.error} />
          ) : (
            <div className="pickers">
              <PresetPicker label="Base" presets={presetList} value={base} onChange={pickBase} />
              <div className="picker">
                <span className="picker-label" id={`${selectionId}-targets`}>
                  Targets
                </span>
                <div className="targets-control">
                  {/* The targets show as the table's columns, so the button only counts them. */}
                  <button
                    type="button"
                    {...(base === null
                      ? { 'aria-describedby': `${selectionId}-targets-hint` }
                      : {})}
                    // Targets are compared with the base, so the base comes first.
                    disabled={presets.status !== 'done' || base === null}
                    onClick={() => setChoosingTargets(true)}
                  >
                    {targets.length === 0
                      ? 'Choose targets'
                      : `${targets.length} ${targets.length === 1 ? 'target' : 'targets'} chosen`}
                  </button>
                  {base === null && (
                    <span className="targets-hint" id={`${selectionId}-targets-hint`}>
                      Choose a base preset first
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

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

      {choosingTargets && base && (
        <TargetPickerDialog
          presets={presetList}
          base={base}
          chosen={targets}
          onConfirm={(next) => {
            setChoosingTargets(false);
            changeTargets(next);
          }}
          onCancel={() => setChoosingTargets(false)}
        />
      )}

      {pendingChange && (
        <Dialog
          title="Discard unsaved changes?"
          onClose={() => setPendingChange(null)}
          actions={
            <>
              <button type="button" onClick={() => setPendingChange(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  pendingChange.run();
                  setPendingChange(null);
                }}
              >
                {pendingChange.reason === 'close' ? 'Close without saving' : 'Discard changes'}
              </button>
            </>
          }
        >
          <p>
            {pendingChange.reason === 'close'
              ? 'Closing the window loses the unsaved changes.'
              : pendingChange.reason === 'targets'
                ? `Taking ${pendingChange.names.join(', ')} out of the comparison loses ${pendingChange.names.length === 1 ? 'its' : 'their'} unsaved changes.`
                : 'Choosing another base preset closes this comparison, and its unsaved changes are lost.'}
          </p>
        </Dialog>
      )}
    </div>
  );
}
