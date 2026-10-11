import { valuesEqual, type NormalizedValue } from '../normalize/normalize-value.ts';
import type { ResolvedProfile } from '../resolve/resolve-chain.ts';

export type DiffStatus = 'same' | 'changed' | 'left-only' | 'right-only';

export interface DiffRow {
  readonly key: string;
  readonly status: DiffStatus;
  readonly left: NormalizedValue | undefined;
  readonly right: NormalizedValue | undefined;
}

/** Compares two resolved profiles key by key. Rows are sorted by key. */
export function diffProfiles(left: ResolvedProfile, right: ResolvedProfile): DiffRow[] {
  const keys = new Set([...left.settings.keys(), ...right.settings.keys()]);
  return [...keys].sort().map((key) => {
    const leftValue = left.settings.get(key)?.value;
    const rightValue = right.settings.get(key)?.value;
    return { key, status: statusOf(leftValue, rightValue), left: leftValue, right: rightValue };
  });
}

function statusOf(
  left: NormalizedValue | undefined,
  right: NormalizedValue | undefined,
): DiffStatus {
  // Neither has it (another target of diffAgainstBase does).
  if (left === undefined && right === undefined) return 'same';
  if (left === undefined) return 'right-only';
  if (right === undefined) return 'left-only';
  return valuesEqual(left, right) ? 'same' : 'changed';
}

/** One target's value for a setting, and how it compares with the base's. */
export interface TargetCell {
  readonly value: NormalizedValue | undefined;
  /** `left` is the base, `right` the target (as in diffProfiles). */
  readonly status: DiffStatus;
}

export interface BaseDiffRow {
  readonly key: string;
  readonly base: NormalizedValue | undefined;
  /** One cell per target, in the order given. */
  readonly targets: readonly TargetCell[];
  /** Some target's value differs from the base's. */
  readonly differs: boolean;
}

/**
 * Compares a base profile with each of several targets, key by key: the union of their keys,
 * sorted. With one target, it holds the same information as diffProfiles.
 */
export function diffAgainstBase(
  base: ResolvedProfile,
  targets: readonly ResolvedProfile[],
): BaseDiffRow[] {
  const keys = new Set([
    ...base.settings.keys(),
    ...targets.flatMap((target) => [...target.settings.keys()]),
  ]);
  return [...keys].sort().map((key) => {
    const baseValue = base.settings.get(key)?.value;
    const cells = targets.map((target) => {
      const value = target.settings.get(key)?.value;
      return { value, status: statusOf(baseValue, value) };
    });
    return {
      key,
      base: baseValue,
      targets: cells,
      differs: cells.some((cell) => cell.status !== 'same'),
    };
  });
}
