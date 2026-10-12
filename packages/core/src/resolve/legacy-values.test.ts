import { describe, expect, it } from 'vitest';
import type { ProfileDocument } from '../model/profile.ts';
import { migrateLegacyValue } from './legacy-values.ts';
import { resolveChain } from './resolve-chain.ts';

describe('migrateLegacyValue', () => {
  it('rewrites old values', () => {
    expect(migrateLegacyValue('wall_direction', 'auto')).toEqual({
      key: 'wall_direction',
      value: 'ccw',
    });
    expect(migrateLegacyValue('support_type', 'hybrid(auto)')).toEqual({
      key: 'support_type',
      value: 'tree(auto)',
    });
    expect(migrateLegacyValue('top_surface_pattern', 'zig-zag')?.value).toBe('rectilinear');
    expect(migrateLegacyValue('ensure_vertical_shell_thickness', '1')?.value).toBe('ensure_all');
    expect(migrateLegacyValue('enable_power_loss_recovery', 'TRUE')?.value).toBe('enable');
    expect(migrateLegacyValue('ironing_angle', '-1')?.value).toBe('0');
  });

  it('leaves current values alone, so the catalog rules apply', () => {
    expect(migrateLegacyValue('wall_direction', 'cw')).toBeUndefined();
    expect(migrateLegacyValue('ironing_angle', '45')).toBeUndefined();
    expect(migrateLegacyValue('nozzle_temperature', ['200'])).toBeUndefined();
  });

  it('renames old filament selectors, where "1" (the first filament) now means "0" (inherit)', () => {
    expect(migrateLegacyValue('wall_filament', '1')).toEqual({
      key: 'outer_wall_filament_id',
      value: '0',
    });
    expect(migrateLegacyValue('infill_extruder', '2')).toEqual({
      key: 'sparse_infill_filament_id',
      value: '2',
    });
  });

  it('renames the old IDEX/IQEX printer keys by their prefix', () => {
    expect(migrateLegacyValue('ixex_parallel_mode', '1')).toEqual({
      key: 'imex_parallel_mode',
      value: '1',
    });
    expect(migrateLegacyValue('ixex_carriage_width_x', '30')?.key).toBe('imex_nozzle_clearance_x');
  });

  it('renames by value, and drops what OrcaSlicer can no longer read', () => {
    expect(migrateLegacyValue('wall_infill_order', 'infill/outer wall/inner wall')).toEqual({
      key: 'wall_sequence',
      value: 'outer wall/inner wall',
    });
    expect(migrateLegacyValue('top_one_wall_type', 'all top')).toEqual({
      key: 'only_one_wall_top',
      value: '1',
    });
    expect(migrateLegacyValue('rotate_solid_infill_direction', '1')).toEqual({
      key: 'solid_infill_rotate_template',
      value: '0,90',
    });
    expect(migrateLegacyValue('prime_tower_rib_wall', '1')).toEqual({
      key: 'wipe_tower_wall_type',
      value: 'rib',
    });
    expect(migrateLegacyValue('prime_tower_rib_wall', '0')?.key).toBeNull();
    // Old percentages of settings that are absolute now.
    expect(migrateLegacyValue('outer_wall_speed', '50%')?.key).toBeNull();
    expect(migrateLegacyValue('outer_wall_speed', '200')).toBeUndefined();
  });

  it('reads an array as its elements joined with commas, and edits string lists element by element', () => {
    expect(migrateLegacyValue('overhang_fan_threshold', ['5%'])?.value).toEqual(['10%']);
    // Two elements read as "5%,5%", which no rule matches.
    expect(migrateLegacyValue('overhang_fan_threshold', ['5%', '5%'])).toBeUndefined();
    expect(migrateLegacyValue('filament_type', ['ASA-Aero'])?.value).toEqual(['ASA-AERO']);
    expect(
      migrateLegacyValue('filament_extruder_variant', [
        'Direct Drive Normal',
        'Direct Drive Big Traffic',
      ])?.value,
    ).toEqual(['Direct Drive Standard', 'Direct Drive High Flow']);
  });
});

describe('resolveChain with legacy values', () => {
  const legacyKeys = { obsolete: new Set<string>(), renamed: new Map<string, string>() };
  const document = (content: Record<string, unknown>): ProfileDocument => ({
    ref: { id: 'old', name: 'old', type: 'process', origin: 'user' },
    content: { name: 'old', ...content },
  });

  it('resolves old values the way OrcaSlicer loads them', () => {
    const settings = resolveChain(
      [document({ wall_direction: 'auto', wall_filament: '1', outer_wall_speed: '50%' })],
      { legacyKeys },
    ).settings;

    expect(settings.get('wall_direction')?.value).toEqual(['ccw']);
    expect(settings.get('outer_wall_filament_id')?.value).toEqual(['0']);
    expect(settings.has('wall_filament')).toBe(false);
    expect(settings.has('outer_wall_speed')).toBe(false);
  });

  it('keeps the current key when a file has it alongside the old one', () => {
    const settings = resolveChain([document({ wall_filament: '1', outer_wall_filament_id: '3' })], {
      legacyKeys,
    }).settings;

    expect(settings.get('outer_wall_filament_id')?.value).toEqual(['3']);
  });

  it('applies none of it without the legacy rules (as with no catalog)', () => {
    expect(
      resolveChain([document({ wall_direction: 'auto' })]).settings.get('wall_direction')?.value,
    ).toEqual(['auto']);
  });
});
