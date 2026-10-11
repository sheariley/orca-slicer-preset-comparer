/**
 * Typed errors every layer can rely on. Adapters translate host failures (file system errors,
 * plugin audit denials, bridge errors) into these so the UI can explain them.
 */
export type ComparerErrorKind =
  | 'access-denied'
  | 'not-found'
  | 'invalid-profile'
  | 'inheritance-cycle'
  | 'unsupported'
  /** The file changed on disk since it was read (e.g. OrcaSlicer saved it meanwhile). */
  | 'conflict'
  /** Another program (OrcaSlicer) holds the lock on the files for too long; worth retrying. */
  | 'busy'
  /** A new preset's name is already used by another preset of the same type. */
  | 'name-taken'
  | 'host-error';

export class ComparerError extends Error {
  readonly kind: ComparerErrorKind;
  /** The file or preset the error is about, when there is one. */
  readonly subject: string | undefined;

  constructor(kind: ComparerErrorKind, message: string, subject?: string) {
    super(message);
    this.name = 'ComparerError';
    this.kind = kind;
    this.subject = subject;
  }
}

export function isComparerError(value: unknown): value is ComparerError {
  return value instanceof ComparerError;
}
