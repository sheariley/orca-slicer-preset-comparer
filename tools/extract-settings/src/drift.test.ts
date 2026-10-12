import { describe, expect, it } from 'vitest';
import { describeDrift, type CatalogShape } from './drift.ts';

const catalog = (overrides: Partial<CatalogShape> = {}): CatalogShape => ({
  source: { repository: 'OrcaSlicer/OrcaSlicer', commit: 'aaa' },
  presetTypes: { filament: ['nozzle_temperature'], process: ['layer_height'] },
  variantKeys: { filament: [], process: [] },
  legacy: {
    obsolete: ['acceleration'],
    renamed: { enable_wipe_tower: 'enable_prime_tower' },
    sourceHash: 'h1',
  },
  settings: {
    layer_height: { label: 'Layer height' },
    nozzle_temperature: { label: 'Nozzle temperature' },
  },
  ...overrides,
});

describe('describeDrift', () => {
  it("reports nothing when only OrcaSlicer's commit changed", () => {
    expect(describeDrift(catalog(), catalog({ source: { commit: 'bbb' } }))).toEqual([]);
  });

  it('lists added, removed, and changed settings', () => {
    const extracted = catalog({
      settings: { layer_height: { label: 'Layer Height' }, new_option: { label: 'New' } },
    });

    expect(describeDrift(catalog(), extracted)).toEqual([
      '- Settings: 1 added (`new_option`)',
      '- Settings: 1 removed (`nozzle_temperature`)',
      '- Settings: 1 changed (`layer_height`)',
    ]);
  });

  it('reports changes to what each type owns, legacy keys, and handle_legacy', () => {
    const extracted = catalog({
      presetTypes: { filament: ['nozzle_temperature', 'filament_type'], process: ['layer_height'] },
      legacy: {
        obsolete: [],
        renamed: { enable_wipe_tower: 'enable_prime_tower' },
        sourceHash: 'h2',
      },
    });

    expect(describeDrift(catalog(), extracted)).toEqual([
      '- Settings filament presets own: 1 added (`filament_type`)',
      '- Obsolete keys: 1 removed (`acceleration`)',
      expect.stringContaining('`PrintConfigDef::handle_legacy` changed'),
    ]);
  });

  it('shortens long lists', () => {
    const names = Array.from({ length: 20 }, (_, index) => `key_${index}`);
    const extracted = catalog({
      settings: { ...catalog().settings, ...Object.fromEntries(names.map((name) => [name, {}])) },
    });

    expect(describeDrift(catalog(), extracted)[0]).toMatch(
      /^- Settings: 20 added \(.*, and 5 more\)$/,
    );
  });
});
