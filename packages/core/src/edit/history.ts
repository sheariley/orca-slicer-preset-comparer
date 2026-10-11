import type { PresetRef, ProfileDocument, RawValue } from '../model/profile.ts';
import { normalizeValue, valuesEqual } from '../normalize/normalize-value.ts';
import type { ProfileEdits } from '../serialize/serialize-profile.ts';
import type { TransferPlan } from './transfer.ts';

/** One user action (e.g. "Copy 3 settings to PETG"): undone and redone as a whole. */
export interface EditBatch {
  readonly label: string;
  readonly plan: TransferPlan;
}

/** Applied batches, oldest first, and undone batches that can be redone, most recent first. */
export interface EditHistory {
  readonly done: readonly EditBatch[];
  readonly undone: readonly EditBatch[];
}

export const emptyHistory: EditHistory = { done: [], undone: [] };

/** Records a batch. A batch that changes nothing isn't recorded. Recording clears redo. */
export function record(history: EditHistory, batch: EditBatch): EditHistory {
  if (batch.plan.targets.every((target) => target.changes.length === 0)) return history;
  return { done: [...history.done, batch], undone: [] };
}

export function undo(history: EditHistory): EditHistory {
  const last = history.done.at(-1);
  if (!last) return history;
  return { done: history.done.slice(0, -1), undone: [last, ...history.undone] };
}

export function redo(history: EditHistory): EditHistory {
  const [next, ...rest] = history.undone;
  if (!next) return history;
  return { done: [...history.done, next], undone: rest };
}

/**
 * The history without one target's changes, done and undone, e.g. once they've been saved
 * somewhere else (a system preset's changes saved as a new user preset). Batches left with no
 * targets are dropped.
 */
export function withoutTarget(history: EditHistory, id: string): EditHistory {
  const strip = (batches: readonly EditBatch[]) =>
    batches.flatMap((batch) => {
      const targets = batch.plan.targets.filter((plan) => plan.target.id !== id);
      return targets.length === 0 ? [] : [{ ...batch, plan: { ...batch.plan, targets } }];
    });
  return { done: strip(history.done), undone: strip(history.undone) };
}

export const canUndo = (history: EditHistory) => history.done.length > 0;
export const canRedo = (history: EditHistory) => history.undone.length > 0;

export interface PendingEdits {
  readonly target: PresetRef;
  readonly edits: ProfileEdits;
}

/**
 * The net edits each target needs, relative to its original file (`originals`, by preset id):
 * what saving must write. Later batches win over earlier ones, and changes that end up back
 * where the file started (set to its original value, or removing a key it never had) drop out.
 * Targets with nothing left to change aren't listed.
 */
export function pendingEdits(
  history: EditHistory,
  originals: ReadonlyMap<string, ProfileDocument>,
): PendingEdits[] {
  const latest = new Map<string, { target: PresetRef; changes: Map<string, RawValue | null> }>();
  for (const batch of history.done) {
    for (const { target, changes } of batch.plan.targets) {
      const entry = latest.get(target.id) ?? { target, changes: new Map() };
      for (const { key, change } of changes) {
        entry.changes.set(key, change.kind === 'set' ? change.value : null);
      }
      latest.set(target.id, entry);
    }
  }

  const result: PendingEdits[] = [];
  for (const { target, changes } of latest.values()) {
    const original = originals.get(target.id)?.content ?? {};
    const toSet: [string, RawValue][] = [];
    const remove: string[] = [];
    for (const [key, value] of changes) {
      const had = Object.hasOwn(original, key);
      if (value === null) {
        if (had) remove.push(key);
      } else if (!had || !sameRaw(value, original[key])) {
        toSet.push([key, value]);
      }
    }
    if (toSet.length > 0 || remove.length > 0) {
      result.push({
        target,
        edits: {
          ...(toSet.length > 0 ? { set: Object.fromEntries(toSet) } : {}),
          ...(remove.length > 0 ? { remove } : {}),
        },
      });
    }
  }
  return result;
}

/** Same value and same shape (array vs plain string), so rewriting it would change nothing. */
function sameRaw(value: RawValue, original: unknown): boolean {
  return (
    Array.isArray(value) === Array.isArray(original) &&
    valuesEqual(normalizeValue(value), normalizeValue(original))
  );
}

/** Applies edits to a profile's own content (keys and values only; formatting is serialize's job). */
export function applyContentEdits(
  content: Readonly<Record<string, unknown>>,
  edits: ProfileEdits,
): Record<string, unknown> {
  const removed = new Set(edits.remove ?? []);
  return Object.fromEntries([
    ...Object.entries(content).filter(([key]) => !removed.has(key)),
    ...Object.entries(edits.set ?? {}),
  ]);
}

/** The edits that turn content `from` into content `to`. Unchanged keys aren't listed. */
export function editsBetween(
  from: Readonly<Record<string, unknown>>,
  to: Readonly<Record<string, unknown>>,
): ProfileEdits {
  const toSet = Object.entries(to).filter(
    ([key, value]) => !Object.hasOwn(from, key) || !sameRaw(value as RawValue, from[key]),
  ) as [string, RawValue][];
  const remove = Object.keys(from).filter((key) => !Object.hasOwn(to, key));
  return {
    ...(toSet.length > 0 ? { set: Object.fromEntries(toSet) } : {}),
    ...(remove.length > 0 ? { remove } : {}),
  };
}

export const hasEdits = (edits: ProfileEdits) =>
  Object.keys(edits.set ?? {}).length > 0 || (edits.remove?.length ?? 0) > 0;
