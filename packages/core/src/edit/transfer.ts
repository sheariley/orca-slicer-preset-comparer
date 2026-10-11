import {
  METADATA_KEYS,
  VARIANT_KEYS,
  type PresetRef,
  type ProfileDocument,
  type ProfileType,
  type RawValue,
} from '../model/profile.ts';
import { resizeValue, valuesEqual, type NormalizedValue } from '../normalize/normalize-value.ts';
import type { KeyRules } from '../ports/ports.ts';
import type { LegacyKeys, ResolvedProfile } from '../resolve/resolve-chain.ts';

/** Everything planTransfer needs to know about one target. */
export interface TransferTarget {
  /** The target's own file content: the overrides it sets itself. */
  readonly document: ProfileDocument;
  /** The target with its inheritance chain applied. */
  readonly resolved: ResolvedProfile;
  /**
   * What the target would have without its own overrides: its parent's resolved settings (or
   * the built-in defaults for a root preset), with the templates it includes on top.
   */
  readonly inherited: ResolvedProfile['settings'];
  readonly rules: KeyRules;
}

export interface TransferOptions {
  /**
   * OrcaSlicer's renames (see SettingCatalog.legacyKeys). A target file may still hold a setting
   * under its old name; changes are planned against the file's real keys, so the old key is
   * removed when the setting is written or its override dropped.
   */
  readonly legacyKeys?: LegacyKeys;
  /** The user's "Pin override" choices for redundant overrides (see PinOverrides). */
  readonly pinOverrides?: PinOverrides;
}

/**
 * "Pin override" choices, by target preset id, then setting key: true keeps the setting
 * overridden (pinning the value), false re-links it to the parent. Settings without an entry
 * get the default (see RedundantOverride.keep), so only what the user changed needs listing.
 */
export type PinOverrides = ReadonlyMap<string, ReadonlyMap<string, boolean>>;

/**
 * A setting where the copy would leave the target overriding the very value it inherits. The
 * user decides ("Pin override"): keeping the override pins the value, so later changes to the
 * parent no longer reach it; dropping it re-links the setting to the parent.
 */
export interface RedundantOverride {
  readonly key: string;
  /**
   * Whether the override is kept. By default it is when it already holds the value (the file
   * stays untouched), and it isn't when it holds a different value (the copy changes it anyway).
   */
  readonly keep: boolean;
}

export type SkipReason =
  /** A key that describes the file, not a setting (METADATA_KEYS). */
  | 'metadata'
  /** A setting that defines the variants: their names or extruder ids (VARIANT_KEYS). */
  | 'variant-list'
  /** A setting the target's preset type doesn't own (e.g. a process setting on a filament). */
  | 'not-owned'
  /** The source has no value for the key. */
  | 'missing-in-source'
  /** The target already has the value. */
  | 'already-equal';

export type Change =
  { readonly kind: 'set'; readonly value: RawValue } | { readonly kind: 'remove' };

/** A change to one key of the target's file. `key` is the key as the file holds it. */
export interface KeyChange {
  readonly key: string;
  readonly change: Change;
}

export interface KeySkip {
  readonly key: string;
  readonly reason: SkipReason;
}

export interface TargetPlan {
  readonly target: PresetRef;
  readonly changes: readonly KeyChange[];
  readonly skipped: readonly KeySkip[];
  /** Keys that need a "Pin override" choice; each also appears in changes or skipped. */
  readonly redundantOverrides: readonly RedundantOverride[];
}

export interface TransferPlan {
  readonly targets: readonly TargetPlan[];
}

/**
 * Plans copying `keys` from `source` to each target. One code path serves one setting or many,
 * and one target or many. Per target and key:
 * - metadata keys, the variant-defining settings, settings the target's type doesn't own, and
 *   keys the source lacks are skipped, with the reason;
 * - per-variant settings are fitted to the target's variants (see fitToVariants);
 * - a value the target already has is skipped;
 * - where the target overrides the key and the copied value equals what it would inherit, the
 *   user chooses (options.pinOverrides) between keeping the override and re-linking to the
 *   parent (see RedundantOverride for the defaults);
 * - otherwise the value is set, in the shape (array or plain string) the target uses. A value
 *   with several elements is always written as an array.
 */
export function planTransfer(
  source: ResolvedProfile,
  keys: readonly string[],
  targets: readonly TransferTarget[],
  options: TransferOptions = {},
): TransferPlan {
  const sourceVariants = variantIdentities(source);
  const oldNames = oldNamesByKey(options.legacyKeys);
  return {
    targets: targets.map((target) =>
      planTarget(source, sourceVariants, keys, target, oldNames, options.pinOverrides),
    ),
  };
}

function planTarget(
  source: ResolvedProfile,
  sourceVariants: readonly string[] | undefined,
  keys: readonly string[],
  target: TransferTarget,
  oldNames: ReadonlyMap<string, readonly string[]>,
  pinOverrides: PinOverrides | undefined,
): TargetPlan {
  const changes: KeyChange[] = [];
  const skipped: KeySkip[] = [];
  const redundantOverrides: RedundantOverride[] = [];
  const ref = target.resolved.ref;
  const content = target.document.content;
  const targetVariants = variantIdentities(target.resolved);
  const variantKeys = VARIANT_KEYS[target.resolved.ref.type];

  for (const key of keys) {
    const reason = ruleOut(key, target.rules, variantKeys);
    const sourceSetting = source.settings.get(key);
    if (reason || !sourceSetting) {
      skipped.push({ key, reason: reason ?? 'missing-in-source' });
      continue;
    }

    const value = target.rules.perVariant.has(key)
      ? fitToVariants(sourceSetting.value, sourceVariants, targetVariants)
      : sourceSetting.value;

    // The keys the target's file holds this setting under: its current name and any old ones.
    const ownKeys = [key, ...(oldNames.get(key) ?? [])].filter((k) => Object.hasOwn(content, k));
    const removeOwn = (except?: string) =>
      ownKeys
        .filter((k) => k !== except)
        .forEach((k) => changes.push({ key: k, change: { kind: 'remove' } }));

    const current = target.resolved.settings.get(key);
    const alreadyThere = current !== undefined && valuesEqual(value, current.value);
    const inherited = target.inherited.get(key);
    if (ownKeys.length > 0 && inherited && valuesEqual(value, inherited.value)) {
      // Default: change no more than the copy requires. Keep an override that already has this
      // value; drop one that would otherwise be rewritten to the inherited value.
      const keep = pinOverrides?.get(ref.id)?.get(key) ?? alreadyThere;
      redundantOverrides.push({ key, keep });
      if (!keep) {
        removeOwn();
        continue;
      }
    }
    if (alreadyThere) {
      skipped.push({ key, reason: 'already-equal' });
      continue;
    }

    const isVector = (current?.isVector ?? sourceSetting.isVector) || value.length > 1;
    changes.push({ key, change: { kind: 'set', value: isVector ? value : (value[0] ?? '') } });
    removeOwn(key);
  }

  return { target: ref, changes, skipped, redundantOverrides };
}

/** Keys that are never copied to this target, whatever the values. */
function ruleOut(
  key: string,
  rules: KeyRules,
  variantKeys: (typeof VARIANT_KEYS)[ProfileType],
): SkipReason | undefined {
  if (METADATA_KEYS.has(key)) return 'metadata';
  if (key === variantKeys?.names || key === variantKeys?.extruderIds) return 'variant-list';
  if (rules.owned.size > 0 && !rules.owned.has(key)) return 'not-owned';
  return undefined;
}

/**
 * Identifies each of a preset's variants: its name, paired with its extruder id where the type
 * has one (so "Standard" on extruder 1 and "Standard" on extruder 2 stay distinct). Undefined
 * when the preset doesn't list its variants, or lists none (it then has one variant).
 */
export function variantIdentities(profile: ResolvedProfile): string[] | undefined {
  const keys = VARIANT_KEYS[profile.ref.type];
  const names = keys && profile.settings.get(keys.names)?.value;
  if (!names || names.length === 0) return undefined;
  const ids = keys.extruderIds ? profile.settings.get(keys.extruderIds)?.value : undefined;
  return ids && ids.length === names.length
    ? names.map((name, index) => `${ids[index]}:${name}`)
    : [...names];
}

/** Current key → the old names OrcaSlicer still reads it from. */
function oldNamesByKey(legacyKeys: LegacyKeys | undefined): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [oldName, current] of legacyKeys?.renamed ?? []) {
    result.set(current, [...(result.get(current) ?? []), oldName]);
  }
  return result;
}

/**
 * Fits a per-variant array to the target's variants (see variantIdentities).
 * - When both presets identify their variants and the source has every one the target has,
 *   values are matched by identity, so a "High Flow" value never lands in a "Standard" slot and
 *   one extruder's values never land on the other.
 * - Otherwise it's resized the way OrcaSlicer resizes these arrays when it loads a preset
 *   (`extend_default_config_length` → `ConfigOptionVector::resize`): truncated, or padded by
 *   repeating the first value. A preset without a variant list has one variant.
 */
export function fitToVariants(
  value: NormalizedValue,
  sourceVariants: readonly string[] | undefined,
  targetVariants: readonly string[] | undefined,
): NormalizedValue {
  if (sourceVariants && targetVariants && value.length === sourceVariants.length) {
    const indexes = targetVariants.map((variant) => sourceVariants.indexOf(variant));
    if (indexes.every((index) => index >= 0)) return indexes.map((index) => value[index]!);
  }
  return resizeValue(value, targetVariants?.length ?? 1);
}
