import { METADATA_KEYS, VARIANT_KEYS, type ProfileType } from '../model/profile.ts';
import { valuesEqual } from '../normalize/normalize-value.ts';
import type { ResolvedProfile } from '../resolve/resolve-chain.ts';

/** The option that repeats a preset's own name, per type (PrintConfig.cpp). */
const SETTINGS_ID_KEYS: Readonly<Record<ProfileType, string>> = {
  filament: 'filament_settings_id',
  process: 'print_settings_id',
  machine: 'printer_settings_id',
};

export interface NewUserPresetInput {
  /** The new preset's name. */
  readonly name: string;
  /** The system preset as it is: the new preset's parent. */
  readonly parent: ResolvedProfile;
  /** The same preset with the changes the new one should keep (its edited state). */
  readonly edited: ResolvedProfile;
}

/**
 * The content of a new user preset that inherits from a system preset and holds the changes
 * made to it, the way OrcaSlicer saves one (`PresetCollection::save_current_preset` and
 * `Preset::save`):
 * - the settings whose value differs from the parent's, plus the variant list, which OrcaSlicer
 *   always writes;
 * - `inherits` (the parent), `name`, `from: "User"`, `is_custom_defined: "0"`, and the option
 *   that repeats the preset's name (`filament_settings_id`, ...).
 *
 * The host adds `version` when it writes the file (see ProfileRepository.createPreset).
 */
export function newUserPresetContent({
  name,
  parent,
  edited,
}: NewUserPresetInput): Record<string, unknown> {
  const type = edited.ref.type;
  const variantKeys = VARIANT_KEYS[type];
  const alwaysWritten = new Set([variantKeys?.names, variantKeys?.extruderIds]);
  const content: Record<string, unknown> = {};
  for (const [key, setting] of edited.settings) {
    if (METADATA_KEYS.has(key)) continue;
    const inherited = parent.settings.get(key);
    if (alwaysWritten.has(key) || !inherited || !valuesEqual(setting.value, inherited.value)) {
      content[key] = setting.isVector ? [...setting.value] : (setting.value[0] ?? '');
    }
  }
  const settingsId = SETTINGS_ID_KEYS[type];
  return {
    ...content,
    name,
    from: 'User',
    inherits: parent.ref.name,
    is_custom_defined: '0',
    // filament_settings_id is a list in OrcaSlicer; the others are plain strings.
    [settingsId]: type === 'filament' ? [name] : name,
  };
}

/** OrcaSlicer's suggestion for a copy of a system preset (SavePresetDialog). */
export const suggestedPresetName = (systemName: string) => `${systemName} - Copy`;

const UNUSABLE_SYMBOLS = '<>[]:/\\|?*"';
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'Default Setting',
  'Default Filament',
  'Default Printer',
]);

/**
 * Why OrcaSlicer would refuse a new preset name, in words, or undefined if it's fine. Follows
 * `SavePresetDialog::Item::update`, except that a name already in use (`taken`, the names of
 * every preset of the same type) is refused: the comparer never overwrites by name.
 */
export function presetNameProblem(name: string, taken: ReadonlySet<string>): string | undefined {
  if (name.length === 0) return 'Enter a name.';
  const symbol = [...UNUSABLE_SYMBOLS].find((character) => name.includes(character));
  if (symbol) return `Names can't contain ${[...UNUSABLE_SYMBOLS].join(' ')}`;
  if (name.includes('(modified)')) return 'Names can\'t contain "(modified)".';
  if (name.startsWith(' ') || name.endsWith(' ')) return "Names can't start or end with a space.";
  if (RESERVED_NAMES.has(name)) return 'OrcaSlicer reserves this name.';
  if (taken.has(name)) return 'A preset with this name already exists.';
  return undefined;
}
