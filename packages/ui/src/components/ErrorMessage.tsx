import { isComparerError } from '@comparer/core';

const HINTS: Record<string, string> = {
  'access-denied': 'The comparer was not allowed to read this file.',
  'not-found': 'A preset or one of its parents could not be found.',
  'invalid-profile': 'The preset file is damaged or not a profile.',
  'inheritance-cycle': 'The preset inherits from itself through its parents.',
  unsupported: 'This action is not available here yet.',
  conflict: 'The file changed after it was opened (for example, OrcaSlicer saved it).',
  busy: 'OrcaSlicer is busy with its presets. Wait a moment, then try again.',
  'name-taken': 'Another preset already has this name. Choose a different one.',
};

export function ErrorMessage({ error }: { error: unknown }) {
  const hint = isComparerError(error) ? HINTS[error.kind] : undefined;
  const detail = error instanceof Error ? error.message : String(error);
  return (
    <div className="error" role="alert">
      {hint && <strong>{hint}</strong>}
      <span>{detail}</span>
    </div>
  );
}
