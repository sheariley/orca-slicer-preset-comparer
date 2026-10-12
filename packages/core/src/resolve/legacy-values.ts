import type { RawValue } from '../model/profile.ts';

/**
 * The rules of OrcaSlicer's `PrintConfigDef::handle_legacy` (PrintConfig.cpp) that look at a
 * setting's value: they rewrite old values, rename a key depending on its value, or drop a value
 * OrcaSlicer can no longer read. Obsolete keys and plain renames are data, extracted into the
 * setting catalog (SettingCatalog.legacyKeys); these are code, so they're ported here.
 *
 * Keep this in step with OrcaSlicer: `tools/extract-settings` records a fingerprint of
 * handle_legacy in the catalog (`legacy.sourceHash`), and a test fails when it no longer matches
 * LEGACY_VALUE_RULES_SOURCE_HASH below. Review the function's changes, update the rules, then the
 * hash.
 */
export const LEGACY_VALUE_RULES_SOURCE_HASH =
  'b44eb95de269517c012cd61b3f2945287ff997b4e4ff6f015c5d0055a8504a40';

/** What a legacy rule does to one setting: its current key (null: dropped) and value. */
export interface LegacyMigration {
  readonly key: string | null;
  readonly value: RawValue;
}

/** Old keys these rules rename, with their current key (for writing back; see planTransfer). */
export const LEGACY_VALUE_RENAMES: ReadonlyMap<string, string> = new Map([
  ['infill_extruder', 'sparse_infill_filament_id'],
  ['sparse_infill_filament', 'sparse_infill_filament_id'],
  ['solid_infill_extruder', 'internal_solid_filament_id'],
  ['solid_infill_filament', 'internal_solid_filament_id'],
  ['top_solid_infill_filament', 'top_surface_filament_id'],
  ['bottom_solid_infill_filament', 'bottom_surface_filament_id'],
  ['perimeter_extruder', 'outer_wall_filament_id'],
  ['wall_filament', 'outer_wall_filament_id'],
  ['wall_filament_id', 'outer_wall_filament_id'],
  ['inner_wall_filament', 'inner_wall_filament_id'],
  ['outer_wall_filament', 'outer_wall_filament_id'],
  ['wall_infill_order', 'wall_sequence'],
  ['rotate_solid_infill_direction', 'solid_infill_rotate_template'],
  ['top_one_wall_type', 'only_one_wall_top'],
  ['prime_tower_rib_wall', 'wipe_tower_wall_type'],
]);

/** Settings OrcaSlicer reads as absolute values only: an old percentage is dropped. */
const ABSOLUTE_ONLY = new Set([
  'initial_layer_print_height',
  'initial_layer_speed',
  'internal_solid_infill_speed',
  'top_surface_speed',
  'support_interface_speed',
  'outer_wall_speed',
  'support_object_xy_distance',
]);

const PATTERNS = new Set([
  'sparse_infill_pattern',
  'top_surface_pattern',
  'bottom_surface_pattern',
  'internal_solid_infill_pattern',
  'ironing_pattern',
  'support_ironing_pattern',
]);

const VARIANT_NAMES = new Set([
  'nozzle_volume_type',
  'default_nozzle_volume_type',
  'printer_extruder_variant',
  'print_extruder_variant',
  'filament_extruder_variant',
  'extruder_variant_list',
]);

/** Exact old value → new value, per key. */
const VALUE_MAPS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  ['curr_bed_type', new Map([['SuperTack Plate', 'Supertack Plate']])],
  // Old files: "0" was none and "2" traditional; now "0" is traditional.
  ['timelapse_type', new Map([['2', '0']])],
  [
    'support_type',
    new Map([
      ['normal', 'normal(manual)'],
      ['tree', 'tree(manual)'],
      ['hybrid(auto)', 'tree(auto)'],
    ]),
  ],
  ['support_base_pattern', new Map([['none', 'hollow']])],
  ['tree_support_wall_count', new Map([['-1', '0']])],
  ['overhang_fan_threshold', new Map([['5%', '10%']])],
  [
    'ensure_vertical_shell_thickness',
    new Map([
      ['1', 'ensure_all'],
      ['0', 'ensure_moderate'],
    ]),
  ],
  ['draft_shield', new Map([['limited', 'disabled']])],
  ['filament_map_mode', new Map([['Auto', 'Auto For Flush']])],
  ['wall_direction', new Map([['auto', 'ccw']])],
]);

const WALL_SEQUENCES: ReadonlyMap<string, string> = new Map([
  ['inner wall/outer wall/infill', 'inner wall/outer wall'],
  ['infill/inner wall/outer wall', 'inner wall/outer wall'],
  ['outer wall/inner wall/infill', 'outer wall/inner wall'],
  ['infill/outer wall/inner wall', 'outer wall/inner wall'],
  ['inner-outer-inner wall/infill', 'inner-outer-inner wall'],
]);

/**
 * Applies the value-dependent legacy rules to one setting as a file stores it, or returns
 * undefined when none applies (then the catalog's obsolete keys and plain renames do).
 *
 * OrcaSlicer runs these on the value as text: a plain string as it is, an array as its elements
 * joined with commas (string lists are quoted and joined with semicolons, so only the rules that
 * edit each element apply to them). Rewritten arrays are split back into elements.
 */
export function migrateLegacyValue(key: string, raw: RawValue): LegacyMigration | undefined {
  const isArray = Array.isArray(raw);
  const elements: readonly string[] = isArray ? raw : [raw as string];
  const value = elements.join(',');
  const asRaw = (text: string): RawValue => (isArray ? text.split(',') : text);
  const each = (edit: (element: string) => string): RawValue =>
    isArray ? elements.map(edit) : edit(raw as string);

  // IDEX/IQEX printer keys from before the feature was named IMEX (ixex_* → imex_*), with the
  // two clearance keys renamed again. A rename by prefix, so the catalog can't list it.
  if (key.startsWith('ixex_')) {
    const imex = `imex_${key.slice('ixex_'.length)}`;
    const current =
      imex === 'imex_carriage_width_x'
        ? 'imex_nozzle_clearance_x'
        : imex === 'imex_carriage_width_y'
          ? 'imex_nozzle_clearance_y'
          : imex;
    return { key: current, value: raw };
  }
  // Keys renamed whatever their value, with the old default "1" (first filament) now "0"
  // (inherit the object's filament).
  const filamentId = LEGACY_VALUE_RENAMES.get(key);
  if (filamentId?.endsWith('_filament_id')) {
    return { key: filamentId, value: value === '1' ? asRaw('0') : raw };
  }
  if (ABSOLUTE_ONLY.has(key) && value.includes('%')) return { key: null, value: raw };
  const mapped = VALUE_MAPS.get(key)?.get(value);
  if (mapped !== undefined) return { key, value: asRaw(mapped) };
  if (PATTERNS.has(key) && value === 'zig-zag') return { key, value: asRaw('rectilinear') };
  if (key === 'wall_infill_order') {
    return { key: 'wall_sequence', value: asRaw(WALL_SEQUENCES.get(value) ?? value) };
  }
  if (VARIANT_NAMES.has(key)) {
    return {
      key,
      value: each((element) =>
        element.replaceAll('Normal', 'Standard').replaceAll('Big Traffic', 'High Flow'),
      ),
    };
  }
  if (key === 'extruder_type') {
    return { key, value: each((element) => element.replaceAll('DirectDrive', 'Direct Drive')) };
  }
  if (key === 'enable_power_loss_recovery') {
    const lower = value.toLowerCase();
    if (value === '1' || lower === 'true') return { key, value: asRaw('enable') };
    if (value === '0' || lower === 'false') return { key, value: asRaw('disable') };
    return undefined;
  }
  if (key === 'rotate_solid_infill_direction') {
    const template = value === '1' ? '0,90' : value === '0' ? '0' : value;
    // The template is one string ("0,90"), not a list.
    return { key: 'solid_infill_rotate_template', value: isArray ? [template] : template };
  }
  if (key === 'top_one_wall_type' && value !== 'none') {
    return { key: 'only_one_wall_top', value: asRaw('1') };
  }
  if (key === 'ironing_angle' && value.startsWith('-')) return { key, value: asRaw('0') };
  if (key === 'filament_type') {
    return { key, value: each((element) => (element === 'ASA-Aero' ? 'ASA-AERO' : element)) };
  }
  if (key === 'prime_tower_rib_wall') {
    return value === '1'
      ? { key: 'wipe_tower_wall_type', value: asRaw('rib') }
      : { key: null, value: raw };
  }
  return undefined;
}
