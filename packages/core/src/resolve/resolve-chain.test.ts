import { describe, expect, it } from 'vitest';
import { chainFor, loadFixtureDocuments } from '../../test/load-fixtures.ts';
import { ComparerError } from '../errors/errors.ts';
import type { ProfileDocument } from '../model/profile.ts';
import { resolveChain } from './resolve-chain.ts';

const documents = loadFixtureDocuments();

describe('resolveChain', () => {
  it('resolves a real four-level filament chain, leaf first', () => {
    const resolved = resolveChain(chainFor(documents, 'Bambu ABS @BBL A1'));

    expect(resolved.chain.map((ref) => ref.name)).toEqual([
      'Bambu ABS @BBL A1',
      'Bambu ABS @base',
      'fdm_filament_abs',
      'fdm_filament_common',
    ]);
    // Overridden in the leaf.
    expect(resolved.settings.get('filament_max_volumetric_speed')?.value).toEqual(['16']);
    expect(resolved.settings.get('filament_max_volumetric_speed')?.definedBy).toMatchObject({
      name: 'Bambu ABS @BBL A1',
    });
    // Inherited from further up.
    expect(resolved.settings.get('filament_flow_ratio')?.definedBy).toMatchObject({
      name: 'Bambu ABS @base',
    });
  });

  it('lets a user preset override its system parent', () => {
    const resolved = resolveChain(chainFor(documents, 'My ABS'));

    expect(resolved.settings.get('nozzle_temperature')?.value).toEqual(['260']);
    expect(resolved.settings.get('filament_max_volumetric_speed')?.value).toEqual(['16']);
  });

  it('skips metadata keys', () => {
    const resolved = resolveChain(chainFor(documents, 'Bambu ABS @BBL A1'));

    for (const key of ['name', 'inherits', 'from', 'setting_id', 'instantiation', 'type']) {
      expect(resolved.settings.has(key)).toBe(false);
    }
  });

  it('starts the root from built-in defaults, which any preset in the chain overrides', () => {
    const defaults = new Map<string, string | string[]>([
      ['nozzle_temperature', ['200']],
      ['activate_air_filtration', ['0']],
      ['name', 'never inherited'],
    ]);
    const resolved = resolveChain(chainFor(documents, 'My ABS'), { defaults });

    expect(resolved.settings.get('nozzle_temperature')).toMatchObject({ value: ['260'] });
    expect(resolved.settings.get('activate_air_filtration')?.definedBy).not.toBe('default');
    expect(
      resolveChain(chainFor(documents, 'My ABS'), {
        defaults: new Map([['made_up_key', '7']]),
      }).settings.get('made_up_key'),
    ).toEqual({ value: ['7'], isVector: false, definedBy: 'default' });
    expect(resolved.settings.has('name')).toBe(false);
  });

  it('drops obsolete keys and renames old keys, like OrcaSlicer does on load', () => {
    const document: ProfileDocument = {
      ref: { id: 'old', name: 'Old', type: 'process', origin: 'user' },
      content: {
        name: 'Old',
        enable_wipe_tower: '1',
        wipe_tower_width: '60',
        prime_tower_width: '35',
        adaptive_layer_height: '1',
      },
    };
    const resolved = resolveChain([document], {
      legacyKeys: {
        obsolete: new Set(['adaptive_layer_height']),
        renamed: new Map([
          ['enable_wipe_tower', 'enable_prime_tower'],
          ['wipe_tower_width', 'prime_tower_width'],
        ]),
      },
    });

    expect([...resolved.settings.keys()].sort()).toEqual([
      'enable_prime_tower',
      'prime_tower_width',
    ]);
    expect(resolved.settings.get('enable_prime_tower')?.value).toEqual(['1']);
    // The current key wins over the old one it replaces.
    expect(resolved.settings.get('prime_tower_width')?.value).toEqual(['35']);
  });

  it('rejects a chain that repeats a preset', () => {
    const document: ProfileDocument = {
      ref: { id: 'a', name: 'A', type: 'filament', origin: 'user' },
      content: { name: 'A', inherits: 'A' },
    };

    expect(() => resolveChain([document, document])).toThrow(ComparerError);
  });
});

describe('resolveChain with include templates', () => {
  const h2cTemplates = new Map([
    [
      'fdm_filament_template_direct_dual_e3d',
      chainFor(documents, 'fdm_filament_template_direct_dual_e3d'),
    ],
  ]);
  const variants = [
    'Direct Drive Standard',
    'Direct Drive High Flow',
    'Direct Drive E3D High Flow',
  ];

  it('layers a real template between the parent and the preset', () => {
    const resolved = resolveChain(chainFor(documents, 'Bambu ABS @BBL H2C'), {
      templates: h2cTemplates,
    });

    // The template overrides the parent chain (fdm_filament_common sets ["0"])...
    expect(resolved.settings.get('long_retractions_when_ec')).toMatchObject({
      value: ['1', '1', '1'],
      definedBy: { name: 'fdm_filament_template_direct_dual_e3d' },
    });
    expect(resolved.settings.get('filament_extruder_variant')?.value).toEqual(variants);
    // ...and the preset's own keys override the template.
    expect(resolved.settings.get('filament_flow_ratio')).toMatchObject({
      value: ['0.98', '0.98', '0.98'],
      definedBy: { name: 'Bambu ABS @BBL H2C' },
    });
    // Templates aren't part of the inheritance chain.
    expect(resolved.chain.map((ref) => ref.name)).not.toContain(
      'fdm_filament_template_direct_dual_e3d',
    );
  });

  it('resizes inherited per-variant values to the variants the template brings', () => {
    const resolved = resolveChain(chainFor(documents, 'Bambu ABS @BBL H2C'), {
      templates: h2cTemplates,
      perVariant: new Set(['fan_min_speed', 'additional_cooling_fan_speed']),
    });

    expect(resolved.settings.get('fan_min_speed')).toMatchObject({
      value: ['10', '10', '10'],
      definedBy: { name: 'fdm_filament_abs' },
    });
    expect(resolved.settings.get('additional_cooling_fan_speed')?.value).toEqual(['0', '0', '0']);
    // Only per-variant settings are resized.
    expect(resolved.settings.get('filament_cost')?.value).toEqual(['15.99']);
  });

  const doc = (
    name: string,
    content: Record<string, unknown>,
    origin: 'system' | 'user' = 'system',
  ): ProfileDocument => ({
    ref: { id: name, name, type: 'filament', origin },
    content: { name, ...content },
  });

  it("layers what the template's chain resolves to, minus the built-in defaults", () => {
    const parent = doc('Parent', { speed: ['5'], temp: ['200'] });
    const base = doc('Template base', { temp: ['230'] });
    const template = doc('Template', { inherits: 'Template base', speed: ['1'], fan: ['80'] });
    const leaf = doc('Leaf', { inherits: 'Parent', include: 'Template' });

    const resolved = resolveChain([leaf, parent], {
      defaults: new Map([
        ['speed', ['1']],
        ['temp', ['200']],
        ['fan', ['0']],
      ]),
      templates: new Map([['Template', [template, base]]]),
    });

    // Setting the default value doesn't override the parent's value.
    expect(resolved.settings.get('speed')).toMatchObject({ value: ['5'], definedBy: parent.ref });
    // The template's own parent counts too.
    expect(resolved.settings.get('temp')).toMatchObject({ value: ['230'], definedBy: base.ref });
    expect(resolved.settings.get('fan')).toMatchObject({ value: ['80'], definedBy: template.ref });
  });

  it('layers several templates in the order listed', () => {
    const first = doc('First', { fan: ['10'], speed: ['10'] });
    const second = doc('Second', { fan: ['20'] });
    const leaf = doc('Leaf', { include: ['First', 'Second'] });

    const resolved = resolveChain([leaf], {
      templates: new Map([
        ['First', [first]],
        ['Second', [second]],
      ]),
    });

    expect(resolved.settings.get('fan')?.value).toEqual(['20']);
    expect(resolved.settings.get('speed')?.value).toEqual(['10']);
  });

  it('ignores include in user presets and skips missing templates, like OrcaSlicer', () => {
    const template = doc('Template', { fan: ['80'] });
    const templates = new Map([['Template', [template]]]);

    expect(
      resolveChain([doc('Mine', { include: 'Template' }, 'user')], { templates }).settings.has(
        'fan',
      ),
    ).toBe(false);
    expect(
      resolveChain([doc('Leaf', { include: ['Missing', 'Template'] })], { templates }).settings.get(
        'fan',
      )?.value,
    ).toEqual(['80']);
  });

  it('resizes at each level of the chain, as OrcaSlicer resolves each parent first', () => {
    const variantList = (count: number) => ({
      filament_extruder_variant: ['A', 'B', 'C'].slice(0, count),
    });
    const root = doc('Root', { ...variantList(3), temp: ['1', '2', '3'] });
    const middle = doc('Middle', { inherits: 'Root', ...variantList(1) });
    const leaf = doc('Leaf', { inherits: 'Middle', ...variantList(3) });

    const resolved = resolveChain([leaf, middle, root], { perVariant: new Set(['temp']) });

    expect(resolved.settings.get('temp')?.value).toEqual(['1', '1', '1']);
  });

  it('rejects templates that include each other', () => {
    const a = doc('A', { include: 'B' });
    const b = doc('B', { include: 'A' });
    const templates = new Map([
      ['A', [a]],
      ['B', [b]],
    ]);

    expect(() => resolveChain([doc('Leaf', { include: 'A' })], { templates })).toThrow(
      ComparerError,
    );
  });
});
