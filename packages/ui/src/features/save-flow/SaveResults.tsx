import type { TargetSaveResult } from '@comparer/app';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';

interface SaveResultsProps {
  readonly results: readonly TargetSaveResult[];
  /** A retry or reload is running. */
  readonly working: boolean;
  /** Saves the failed presets again (their edits are still pending). */
  readonly onRetry: () => void;
  /** Re-reads the presets whose files changed meanwhile, replaying the pending edits on top. */
  readonly onReload: (ids: readonly string[]) => void;
  readonly onDismiss: () => void;
}

/** The outcome of a save, per preset, and what the user has to do next. */
export function SaveResults({ results, working, onRetry, onReload, onDismiss }: SaveResultsProps) {
  const saved = results.filter(
    (result): result is Extract<TargetSaveResult, { reloadRequired: unknown }> =>
      result.status === 'saved' || result.status === 'created',
  );
  const failed = results.filter((result) => result.status === 'failed');
  // Retrying can't fix a conflict (the file changed since it was read); reloading can.
  const conflicts = failed.filter((result) => result.error.kind === 'conflict');
  const retryable = failed.length > conflicts.length;
  const restart = saved.some((result) => result.reloadRequired === 'restart');
  const reselect = saved.some((result) => result.reloadRequired === 'reselect-preset');

  const summary = [
    saved.length > 0 && `Saved ${saved.length} of ${results.length}.`,
    failed.length > 0 && `${failed.length} failed.`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="save-results" aria-label="Save results">
      <p role="status">
        <strong>{summary || 'Nothing was saved.'}</strong>
        {restart && ' Restart OrcaSlicer to see the changes.'}
        {!restart && reselect && ' Re-select the presets in OrcaSlicer to see the changes.'}
      </p>
      <ul>
        {results.map((result) => (
          <li key={result.target.id} data-status={result.status}>
            {result.status === 'saved' && (
              <>
                Saved {result.target.name}.
                {result.reformatted && " The file was rewritten in OrcaSlicer's layout."}
              </>
            )}
            {result.status === 'created' && (
              <>
                Saved the changes to {result.target.name} as a new user preset, &quot;
                {result.created.name}&quot;. {result.target.name} itself is unchanged.
              </>
            )}
            {result.status === 'needs-user-preset' && (
              <>
                {result.target.name} is a system preset, which can&apos;t be changed, and no name
                was given for a new user preset, so its changes stay unsaved.
              </>
            )}
            {result.status === 'failed' && (
              <>
                Couldn't save {result.target.name}; its changes stay unsaved.
                <ErrorMessage error={result.error} />
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="save-results-actions">
        {conflicts.length > 0 && (
          <button
            type="button"
            onClick={() => onReload(conflicts.map((result) => result.target.id))}
            disabled={working}
          >
            Reload from disk and keep my changes
          </button>
        )}
        {retryable && (
          <button type="button" onClick={onRetry} disabled={working}>
            Try again
          </button>
        )}
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
