import type { PresetRef, ProfileType } from '@comparer/core';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Dialog } from './components/Dialog.tsx';
import { ErrorMessage } from './components/ErrorMessage.tsx';
import { InfoTip } from './components/InfoTip.tsx';
import { ComparisonEditor } from './features/editing/ComparisonEditor.tsx';
import { PresetPicker } from './features/preset-picker/PresetPicker.tsx';
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
  const [left, setLeft] = useState<PresetRef | null>(null);
  const [right, setRight] = useState<PresetRef | null>(null);

  const [dirty, setDirty] = useState(false);
  // A change of presets waiting for the user to confirm discarding unsaved changes.
  const [pendingChange, setPendingChange] = useState<{
    readonly run: () => void;
    readonly reason: 'presets' | 'close';
  } | null>(null);

  const presets = useAsync(type, () => app.listPresets({ type }));
  const comparisonKey = left && right ? `${left.id}\u0000${right.id}` : null;
  const session = useAsync(comparisonKey, () => app.openSession([left!, right!]));
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);

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
      setLeft(null);
      setRight(null);
    });

  const presetList = presets.status === 'done' ? presets.value : [];

  // The type tabs and pickers can fold away to a summary line, leaving more room for the table.
  // Only while comparing: with nothing chosen, they're all there is.
  const selectionId = useId();
  const [hidePresets, setHidePresets] = usePreference('layout.hidePresets', false, isBoolean);
  const comparing = left !== null && right !== null;
  const collapsed = hidePresets && comparing;

  return (
    <div className="comparer">
      <div className="comparer-top">
        <header className="comparer-header">
          <h1>Profile Comparer</h1>
          {collapsed && left && right && (
            <p className="selection-summary">
              {TYPES.find((option) => option.type === type)?.label}: <strong>{left.name}</strong> vs{' '}
              <strong>{right.name}</strong>
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
              <PresetPicker
                label="Left"
                presets={presetList}
                value={left}
                onChange={(next) => leaveComparison(() => setLeft(next))}
              />
              <PresetPicker
                label="Right"
                presets={presetList}
                value={right}
                onChange={(next) => leaveComparison(() => setRight(next))}
              />
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
          left={left!}
          right={right!}
          onDirtyChange={onDirtyChange}
        />
      )}
      {session.status === 'idle' && (
        <p className="status">Choose two presets to see how they differ.</p>
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
                  setDirty(false);
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
              : 'Choosing other presets closes this comparison, and its unsaved changes are lost.'}
          </p>
        </Dialog>
      )}
    </div>
  );
}
