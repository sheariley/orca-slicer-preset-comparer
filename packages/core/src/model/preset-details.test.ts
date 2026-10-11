import { describe, expect, it } from 'vitest';
import { loadFixtureDocuments } from '../../test/load-fixtures.ts';
import { presetDetails, type ListedPreset } from './preset-details.ts';
import type { PresetRef } from './profile.ts';

const listed = presetDetails(loadFixtureDocuments());
const details = (name: string) => listed.find((ref) => ref.name === name)!.details!;

describe('presetDetails', () => {
  it("marks system templates as not selectable, as OrcaSlicer's lists skip them", () => {
    expect(details('Bambu ABS @BBL A1').selectable).toBe(true);
    expect(details('Bambu ABS @base').selectable).toBe(false);
    expect(details('fdm_filament_common').selectable).toBe(false);
    expect(details('My ABS').selectable).toBe(true);
  });

  it('takes the printers from the preset or the nearest parent that lists them', () => {
    expect(details('Bambu ABS @BBL H2C').printers).toEqual(['Bambu Lab H2C 0.4 nozzle']);
    // My ABS doesn't list them, so it has its parent's.
    expect(details('My ABS').printers).toEqual(details('Bambu ABS @BBL A1').printers);
    // An empty list of its own means any printer.
    expect(details('My Old PLA').printers).toEqual([]);
    expect(details('fdm_filament_abs').printers).toEqual([]);
  });

  it('gives user presets the vendor of the system preset they derive from', () => {
    expect(details('Bambu ABS @base').vendor).toBe('BBL');
    expect(details('My ABS').vendor).toBe('BBL');
  });

  it("looks parents up in the child's own user folder first", () => {
    const preset = (
      name: string,
      folder: string,
      content: Record<string, unknown>,
    ): ListedPreset => {
      const ref: PresetRef = {
        id: `${folder}/${name}`,
        name,
        type: 'filament',
        origin: 'user',
        folder,
      };
      return { ref, content: { name, ...content } };
    };
    const refs = presetDetails([
      preset('Parent', 'default', { compatible_printers: ['A'] }),
      preset('Parent', '1234', { compatible_printers: ['B'] }),
      preset('Child', '1234', { inherits: 'Parent' }),
    ]);

    expect(refs.find((ref) => ref.id === '1234/Child')!.details!.printers).toEqual(['B']);
    expect(refs.find((ref) => ref.id === '1234/Child')!.details!.vendor).toBeUndefined();
  });

  it('stops at an inheritance cycle', () => {
    const preset = (name: string, inherits: string): ListedPreset => ({
      ref: { id: name, name, type: 'process', origin: 'user' },
      content: { name, inherits },
    });

    expect(presetDetails([preset('A', 'B'), preset('B', 'A')])).toHaveLength(2);
  });
});
