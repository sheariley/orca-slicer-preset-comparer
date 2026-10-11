/** The preset types OrcaSlicer stores as profile files. The comparer edits filament and process. */
export type ProfileType = 'filament' | 'process' | 'machine';

/** Where a preset comes from. Only user presets are safe to save over. */
export type PresetOrigin = 'system' | 'user' | 'file';

/**
 * A host-neutral reference to one preset. `id` is opaque: each adapter decides what it
 * contains (a file path, a preset name, ...) and only that adapter interprets it.
 */
export interface PresetRef {
  readonly id: string;
  readonly name: string;
  readonly type: ProfileType;
  readonly origin: PresetOrigin;
  /** Vendor folder for system presets (e.g. "BBL"), when the host knows it. */
  readonly vendor?: string;
  /**
   * For user presets, the user folder that holds it (the desktop's `default` or an account
   * id), when the host knows it: two folders can hold presets with the same name.
   */
  readonly folder?: string;
  /** What pickers filter and label presets by, when the host can tell (see presetDetails). */
  readonly details?: PresetDetails;
}

/** A preset's listing details, from its file and the files it inherits from. */
export interface PresetDetails {
  /**
   * False for a system preset OrcaSlicer only uses as a parent or template
   * (`instantiation: "false"`), which it never offers in its own preset lists.
   */
  readonly selectable: boolean;
  /**
   * The printers it's for (`compatible_printers`, its own or inherited). Empty: any printer
   * (OrcaSlicer may still narrow that with `compatible_printers_condition`).
   */
  readonly printers: readonly string[];
  /**
   * The vendor it belongs to: a system preset's own, or for a user preset, that of the system
   * preset it derives from. Undefined for user presets that derive from none.
   */
  readonly vendor?: string;
}

/** A raw setting value as stored in a profile file: a string or an array of strings. */
export type RawValue = string | readonly string[];

/** A profile file's own content, before inheritance is applied. */
export interface ProfileDocument {
  readonly ref: PresetRef;
  /** The parsed JSON object, metadata keys included. */
  readonly content: Readonly<Record<string, unknown>>;
  /**
   * The file's text exactly as read. Hosts always set it; saving applies edits to it so the file
   * keeps its format (see core/serialize). Documents built in memory (tests) may omit it.
   */
  readonly text?: string;
}

/**
 * Keys that describe a profile rather than configure printing: the BBL_JSON_KEY_* and
 * ORCA_JSON_KEY_* constants in OrcaSlicer's Preset.hpp, plus the *_settings_id options. They're
 * never inherited, compared as settings, or copied between profiles.
 */
export const METADATA_KEYS: ReadonlySet<string> = new Set([
  'type',
  'name',
  'inherits',
  'include',
  'from',
  'setting_id',
  'base_id',
  'user_id',
  'filament_id',
  'instantiation',
  'version',
  'is_custom_defined',
  'description',
  'renamed_from',
  'created_time',
  'updated_time',
  // Config options that only record the preset's own name (PrintConfig.cpp, no label).
  'filament_settings_id',
  'print_settings_id',
  'printer_settings_id',
]);

/** The parent preset name a document inherits from, if any. */
export function inheritsFrom(document: ProfileDocument): string | undefined {
  const parent = document.content['inherits'];
  return typeof parent === 'string' && parent.length > 0 ? parent : undefined;
}

/**
 * The templates a document includes (`include`: an array of preset names, or one bare name), in
 * the order listed. OrcaSlicer reads `include` only in bundled vendor profiles; it ignores the
 * key in user presets, so this returns none for them.
 */
export function includesOf(document: ProfileDocument): string[] {
  if (document.ref.origin !== 'system') return [];
  const include = document.content['include'];
  const names = Array.isArray(include) ? (include as unknown[]) : [include];
  return names.filter((name): name is string => typeof name === 'string' && name.length > 0);
}

/**
 * The settings that define a preset's extruder variants, per type: the variant names (e.g.
 * "Direct Drive Standard") and, for processes, the extruder each variant belongs to.
 * OrcaSlicer pairs the two (`Preset::get_extruder_names_and_keysets`): on a dual-extruder printer
 * the names repeat once per extruder. Filaments have no extruder ids (`filament_extruder_id` is
 * commented out in OrcaSlicer). These define the shape of every per-variant array, so copies
 * never change them.
 */
export const VARIANT_KEYS: Readonly<
  Partial<Record<ProfileType, { readonly names: string; readonly extruderIds?: string }>>
> = {
  filament: { names: 'filament_extruder_variant' },
  process: { names: 'print_extruder_variant', extruderIds: 'print_extruder_id' },
};
