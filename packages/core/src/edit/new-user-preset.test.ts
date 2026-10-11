import { describe, expect, it } from 'vitest';
import { chainFor, loadFixtureDocuments } from '../../test/load-fixtures.ts';
import type { ProfileDocument } from '../model/profile.ts';
import { resolveChain } from '../resolve/resolve-chain.ts';
import { newUserPresetContent, presetNameProblem, suggestedPresetName } from './new-user-preset.ts';

const documents = loadFixtureDocuments();

describe('newUserPresetContent', () => {
  it('holds only what differs from the system parent, plus the metadata OrcaSlicer writes', () => {
    const chain = chainFor(documents, 'Bambu ABS @BBL H2C');
    const templates = new Map([
      [
        'fdm_filament_template_direct_dual_e3d',
        chainFor(documents, 'fdm_filament_template_direct_dual_e3d'),
      ],
    ]);
    const options = { templates, perVariant: new Set(['nozzle_temperature']) };
    const parent = resolveChain(chain, options);
    const leaf = chain[0]!;
    const editedLeaf: ProfileDocument = {
      ...leaf,
      content: {
        ...leaf.content,
        nozzle_temperature: ['255', '255', '255'],
        fan_max_speed: ['70'],
      },
    };
    const edited = resolveChain([editedLeaf, ...chain.slice(1)], options);

    expect(newUserPresetContent({ name: 'My ABS H2C', parent, edited })).toEqual({
      nozzle_temperature: ['255', '255', '255'],
      fan_max_speed: ['70'],
      // OrcaSlicer always writes the variant list.
      filament_extruder_variant: [
        'Direct Drive Standard',
        'Direct Drive High Flow',
        'Direct Drive E3D High Flow',
      ],
      name: 'My ABS H2C',
      from: 'User',
      inherits: 'Bambu ABS @BBL H2C',
      is_custom_defined: '0',
      filament_settings_id: ['My ABS H2C'],
    });
  });

  it('names a process preset with a plain print_settings_id', () => {
    const chain = chainFor(documents, '0.20mm Standard @BBL A1');
    const parent = resolveChain(chain);
    const edited = resolveChain([
      { ...chain[0]!, content: { ...chain[0]!.content, wall_loops: '4' } },
      ...chain.slice(1),
    ]);

    expect(newUserPresetContent({ name: 'Strong', parent, edited })).toMatchObject({
      wall_loops: '4',
      print_settings_id: 'Strong',
      inherits: '0.20mm Standard @BBL A1',
    });
  });
});

describe('presetNameProblem', () => {
  const taken = new Set(['PLA', 'Bambu ABS @BBL A1']);

  it('accepts a free name, like the suggested one', () => {
    expect(suggestedPresetName('Bambu ABS @BBL A1')).toBe('Bambu ABS @BBL A1 - Copy');
    expect(presetNameProblem('Bambu ABS @BBL A1 - Copy', taken)).toBeUndefined();
  });

  it.each([
    ['', 'Enter a name.'],
    ['PLA', 'A preset with this name already exists.'],
    ['My: PLA', "Names can't contain"],
    ['PLA (modified)', '"(modified)"'],
    [' PLA 2', "can't start or end with a space"],
    ['PLA 2 ', "can't start or end with a space"],
    ['Default Filament', 'OrcaSlicer reserves this name.'],
  ])('refuses %j', (name, problem) => {
    expect(presetNameProblem(name, taken)).toContain(problem);
  });
});
