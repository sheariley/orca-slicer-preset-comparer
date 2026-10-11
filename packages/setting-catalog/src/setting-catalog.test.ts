import { LEGACY_VALUE_RULES_SOURCE_HASH } from '@comparer/core';
import { describe, expect, it } from 'vitest';
import generated from '../data/settings.json' with { type: 'json' };
import { createSettingCatalog } from './setting-catalog.ts';

describe('createSettingCatalog', () => {
  it('describes a setting from the generated data', () => {
    const info = createSettingCatalog().describe('layer_height');

    expect(info).toMatchObject({ key: 'layer_height', label: 'Layer height', unit: 'mm' });
  });

  it('prefers the full label over the short tab label', () => {
    const catalog = createSettingCatalog({
      presetTypes: {},
      settings: { hot_plate_temp: { label: 'Other layers', fullLabel: 'Bed temperature' } },
    });

    expect(catalog.describe('hot_plate_temp')?.label).toBe('Bed temperature');
  });

  it("labels an option's values, and says where OrcaSlicer's tabs show it", () => {
    const info = createSettingCatalog().describe('fuzzy_skin');

    expect(info?.valueLabels?.get('disabled_fuzzy')).toBe('Disabled');
    expect(info?.sections?.process).toMatchObject({ page: 'Others', group: 'Fuzzy skin' });
    expect(createSettingCatalog().describe('nozzle_temperature')?.sections?.filament).toMatchObject(
      {
        page: 'Filament',
        group: 'Print temperature',
      },
    );
  });

  it("leaves values unlabeled when the labels don't pair up with them", () => {
    const catalog = createSettingCatalog({
      presetTypes: {},
      settings: { odd: { enumValues: ['a', 'b'], enumLabels: ['A'] } },
    });

    expect(catalog.describe('odd')?.valueLabels).toBeUndefined();
  });

  it('returns undefined for unknown keys', () => {
    expect(
      createSettingCatalog({ presetTypes: {}, settings: {} }).describe('nope'),
    ).toBeUndefined();
  });

  it('gives each preset type the defaults of only the settings it owns', () => {
    const catalog = createSettingCatalog({
      presetTypes: { filament: ['nozzle_temperature', 'no_default'], process: ['layer_height'] },
      settings: {
        nozzle_temperature: { default: ['200'] },
        layer_height: { default: '0.2' },
        no_default: {},
      },
    });

    expect([...catalog.defaultsFor('filament')]).toEqual([['nozzle_temperature', ['200']]]);
    expect([...catalog.defaultsFor('process')]).toEqual([['layer_height', '0.2']]);
    expect(catalog.defaultsFor('machine').size).toBe(0);
  });

  it('ships the obsolete and renamed keys OrcaSlicer migrates on load', () => {
    const { obsolete, renamed } = createSettingCatalog().legacyKeys();

    expect(obsolete.has('adaptive_layer_height')).toBe(true);
    expect(renamed.get('enable_wipe_tower')).toBe('enable_prime_tower');
  });

  it('ships the keys each preset type owns and which are stored per variant', () => {
    const filament = createSettingCatalog().keyRules('filament');

    expect(filament.owned.has('nozzle_temperature')).toBe(true);
    expect(filament.owned.has('layer_height')).toBe(false);
    expect(filament.perVariant.has('filament_flow_ratio')).toBe(true);
    expect(filament.perVariant.has('nozzle_temperature')).toBe(true);
    expect(filament.perVariant.has('hot_plate_temp')).toBe(false);
    expect(createSettingCatalog().keyRules('machine').owned.size).toBe(0);
  });

  it('ships defaults for real OrcaSlicer settings', () => {
    const catalog = createSettingCatalog();

    expect(catalog.defaultsFor('process').get('layer_height')).toBe('0.2');
    expect(catalog.defaultsFor('filament').get('nozzle_temperature')).toEqual(['200']);
    expect(catalog.defaultsFor('filament').has('layer_height')).toBe(false);
  });

  it("matches the OrcaSlicer handle_legacy that core's value rules were ported from", () => {
    // When this fails, OrcaSlicer changed PrintConfigDef::handle_legacy: review the change, update
    // core/src/resolve/legacy-values.ts, then LEGACY_VALUE_RULES_SOURCE_HASH.
    expect(generated.legacy.sourceHash).toBe(LEGACY_VALUE_RULES_SOURCE_HASH);
  });
});
