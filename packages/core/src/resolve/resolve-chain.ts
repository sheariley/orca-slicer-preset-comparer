import { ComparerError } from '../errors/errors.ts';
import {
  includesOf,
  METADATA_KEYS,
  VARIANT_KEYS,
  type PresetRef,
  type ProfileDocument,
  type ProfileType,
  type RawValue,
} from '../model/profile.ts';
import {
  normalizeValue,
  resizeValue,
  valuesEqual,
  type NormalizedValue,
} from '../normalize/normalize-value.ts';
import { migrateLegacyValue } from './legacy-values.ts';

/**
 * One resolved setting and where it came from: a preset in the chain, a template one of them
 * includes, or a built-in default.
 */
export interface ResolvedSetting {
  readonly value: NormalizedValue;
  /** Whether the profile stores it as an array (most settings) or a plain string. */
  readonly isVector: boolean;
  readonly definedBy: PresetRef | 'default';
}

/** How OrcaSlicer migrates old keys when it loads a profile (PrintConfigDef::handle_legacy). */
export interface LegacyKeys {
  /** Keys OrcaSlicer discards. */
  readonly obsolete: ReadonlySet<string>;
  /** Old key → current key. */
  readonly renamed: ReadonlyMap<string, string>;
}

/** Templates by name, each as its own inheritance chain (leaf first). See `includesOf`. */
export type IncludedTemplates = ReadonlyMap<string, readonly ProfileDocument[]>;

export interface ResolveOptions {
  /** Built-in defaults the root starts from (see SettingCatalog.defaultsFor). */
  readonly defaults?: ReadonlyMap<string, RawValue>;
  /** Applied to every document's own keys before they're merged. */
  readonly legacyKeys?: LegacyKeys;
  /**
   * Settings stored once per extruder variant (KeyRules.perVariant). Each preset in the chain
   * resizes them to its number of variants.
   */
  readonly perVariant?: ReadonlySet<string>;
  /** The templates the chain's documents include. A missing one is skipped, as OrcaSlicer does. */
  readonly templates?: IncludedTemplates;
}

/** A profile with its inheritance chain applied. */
export interface ResolvedProfile {
  readonly ref: PresetRef;
  /** The chain the settings came from, leaf first. Included templates aren't listed. */
  readonly chain: readonly PresetRef[];
  readonly settings: ReadonlyMap<string, ResolvedSetting>;
}

/**
 * Applies an inheritance chain. `chain` is ordered leaf first, root last; keys in documents
 * nearer the leaf override keys further up. Metadata keys aren't inherited.
 *
 * Like OrcaSlicer (`PresetBundle::resolve_vendor_preset`), each preset in the chain:
 * 1. starts from its parent's resolved settings, or for the root, from `options.defaults` (the
 *    built-in default of every setting the preset's type owns);
 * 2. layers each template it includes on top, in the order listed (see includedLayer);
 * 3. applies its own keys, after `options.legacyKeys` migrates them;
 * 4. resizes its per-variant settings to its number of variants (`extend_default_config_length`).
 */
export function resolveChain(
  chain: readonly ProfileDocument[],
  options: ResolveOptions = {},
): ResolvedProfile {
  const leaf = chain[0];
  if (!leaf)
    throw new ComparerError('invalid-profile', 'Cannot resolve an empty inheritance chain.');
  return {
    ref: leaf.ref,
    chain: chain.map((document) => document.ref),
    settings: resolveSettings(chain, options, true, []),
  };
}

/**
 * The settings of `chain`, resolved (see resolveChain). `resizeLeaf` is false for a template:
 * its includers take its settings before it's resized. `including` lists the templates being
 * resolved further out, to catch include cycles.
 */
function resolveSettings(
  chain: readonly ProfileDocument[],
  options: ResolveOptions,
  resizeLeaf: boolean,
  including: readonly string[],
): Map<string, ResolvedSetting> {
  const { defaults = new Map(), legacyKeys, perVariant, templates } = options;
  const seen = new Set<string>();
  for (const document of chain) {
    if (seen.has(document.ref.id)) {
      throw new ComparerError(
        'inheritance-cycle',
        `Inheritance cycle at "${document.ref.name}".`,
        document.ref.name,
      );
    }
    seen.add(document.ref.id);
  }

  const settings = new Map<string, ResolvedSetting>();
  for (const [key, raw] of defaults) {
    if (!METADATA_KEYS.has(key))
      settings.set(key, {
        value: normalizeValue(raw),
        isVector: Array.isArray(raw),
        definedBy: 'default',
      });
  }
  [...chain].reverse().forEach((document, index) => {
    for (const name of includesOf(document)) {
      const template = templates?.get(name);
      if (!template) continue;
      if (including.includes(name)) {
        throw new ComparerError('inheritance-cycle', `Include cycle at "${name}".`, name);
      }
      for (const [key, setting] of includedLayer(template, options, [...including, name])) {
        settings.set(key, setting);
      }
    }
    for (const [key, raw] of migrateKeys(document.content, legacyKeys)) {
      if (METADATA_KEYS.has(key)) continue;
      settings.set(key, {
        value: normalizeValue(raw),
        isVector: Array.isArray(raw),
        definedBy: document.ref,
      });
    }
    if (perVariant && (resizeLeaf || index < chain.length - 1)) {
      resizeToVariants(settings, document.ref.type, perVariant);
    }
  });
  return settings;
}

/**
 * What including a template adds: its resolved settings that differ from the built-in defaults.
 * OrcaSlicer layers the template's diff against the defaults, not just the keys in its own file,
 * so a template that sets a default value doesn't override the includer's parent. Settings that
 * aren't among the defaults are left out too, unless there are no defaults at all.
 */
function includedLayer(
  template: readonly ProfileDocument[],
  options: ResolveOptions,
  including: readonly string[],
): [string, ResolvedSetting][] {
  const defaults = options.defaults ?? new Map<string, RawValue>();
  return [...resolveSettings(template, options, false, including)].filter(([key, setting]) => {
    const fallback = defaults.get(key);
    return fallback === undefined
      ? defaults.size === 0
      : !valuesEqual(setting.value, normalizeValue(fallback));
  });
}

/**
 * Resizes every per-variant setting to the preset's number of variants: the length of its
 * variant list, or one without a list (see resizeValue).
 */
function resizeToVariants(
  settings: Map<string, ResolvedSetting>,
  type: ProfileType,
  perVariant: ReadonlySet<string>,
): void {
  const names = VARIANT_KEYS[type]?.names;
  const length = (names && settings.get(names)?.value.length) || 1;
  for (const key of perVariant) {
    const setting = settings.get(key);
    if (!setting?.isVector) continue;
    const value = resizeValue(setting.value, length);
    if (value !== setting.value) settings.set(key, { ...setting, value });
  }
}

/**
 * A document's own entries after legacy migration: old values rewritten (migrateLegacyValue),
 * obsolete keys dropped, old keys renamed. When a document has both an old key and its
 * replacement, the replacement wins.
 */
function migrateKeys(
  content: Readonly<Record<string, unknown>>,
  legacyKeys: LegacyKeys | undefined,
): [string, unknown][] {
  if (!legacyKeys) return Object.entries(content);
  const entries = new Map<string, unknown>();
  for (const [key, raw] of Object.entries(content)) {
    const migration = isRawValue(raw) ? migrateLegacyValue(key, raw) : undefined;
    if (migration) {
      if (migration.key !== null && (migration.key === key || !(migration.key in content))) {
        entries.set(migration.key, migration.value);
      }
      continue;
    }
    if (legacyKeys.obsolete.has(key)) continue;
    const current = legacyKeys.renamed.get(key);
    if (current === undefined) entries.set(key, raw);
    else if (!(current in content)) entries.set(current, raw);
  }
  return [...entries];
}

function isRawValue(raw: unknown): raw is RawValue {
  return (
    typeof raw === 'string' || (Array.isArray(raw) && raw.every((item) => typeof item === 'string'))
  );
}
