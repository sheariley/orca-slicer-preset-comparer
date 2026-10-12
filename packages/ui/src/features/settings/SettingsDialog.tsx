import type { DataFolder } from '@comparer/core';
import { useState } from 'react';
import { Dialog } from '../../components/Dialog.tsx';

interface SettingsDialogProps {
  readonly dataFolder: DataFolder;
  /** Some presets have unsaved changes, which switching folders drops. */
  readonly dirty: boolean;
  readonly onClose: () => void;
}

/**
 * The app's settings: which OrcaSlicer data folder it reads (the default one, or one the user
 * chooses). Switching restarts the comparer.
 */
export function SettingsDialog({ dataFolder, dirty, onClose }: SettingsDialogProps) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(dataFolder.problem);

  const switchTo = async (path: string | null) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await dataFolder.use(path);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };
  const choose = async () => {
    const path = await dataFolder.choose();
    if (path !== undefined) await switchTo(path);
  };

  return (
    <Dialog
      title="Settings"
      // Not dismissible while switching: the comparer is about to restart.
      {...(busy ? {} : { onClose })}
      actions={
        <button type="button" onClick={onClose} disabled={busy}>
          Close
        </button>
      }
    >
      <section className="settings-section" aria-labelledby="settings-data-folder">
        <h3 id="settings-data-folder">OrcaSlicer data folder</h3>
        <p>
          Where the comparer finds OrcaSlicer&apos;s presets: its <code>system</code> and{' '}
          <code>user</code> folders. Choose another one for a portable OrcaSlicer, or a second
          OrcaSlicer build.
        </p>
        <p className="data-folder-path">
          <code>{dataFolder.path}</code>
          {dataFolder.isDefault && <span className="badge">Default</span>}
        </p>
        {problem && (
          <p className="field-problem" role="alert">
            {problem}
          </p>
        )}
        {dirty && (
          <p className="warning">
            Switching folders restarts the comparer, and the unsaved changes are lost.
          </p>
        )}
        <div className="settings-actions">
          <button type="button" onClick={() => void choose()} disabled={busy}>
            Choose folder
          </button>
          <button
            type="button"
            onClick={() => void switchTo(null)}
            disabled={busy || dataFolder.isDefault}
          >
            Use default
          </button>
        </div>
      </section>
    </Dialog>
  );
}
