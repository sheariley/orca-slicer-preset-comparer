import { describe, expect, it } from 'vitest';
import {
  chooseParent,
  findNamedPreset,
  libraryFallbackName,
  presetRenames,
  renamedFrom,
} from './parent-lookup.ts';
import type { PresetRef } from './profile.ts';

const system = (name: string, vendor: string): PresetRef => ({
  id: `system/${vendor}/${name}`,
  name,
  type: 'filament',
  origin: 'system',
  vendor,
});
const user = (name: string, folder: string): PresetRef => ({
  id: `user/${folder}/${name}`,
  name,
  type: 'filament',
  origin: 'user',
  folder,
});

describe('libraryFallbackName', () => {
  it("maps a missing Generic material to OrcaFilamentLibrary's, as OrcaSlicer's find_preset2 does", () => {
    expect(libraryFallbackName('My Generic PETG')).toBe('Generic PETG @System');
    expect(libraryFallbackName('Generic PLA @BBL X1C')).toBe('Generic PLA @System');
    expect(libraryFallbackName('Custom_Generic ABS')).toBe('Generic ABS @System');
    expect(libraryFallbackName('My Generic PLA-CF @Voron 0.4')).toBe('Generic PLA-CF @System');
  });

  it('leaves other names alone', () => {
    expect(libraryFallbackName('Bambu PLA Basic @BBL X1C')).toBeUndefined();
    expect(libraryFallbackName('Generic PETG @System')).toBeUndefined();
    expect(libraryFallbackName('MyGenericPETG')).toBeUndefined();
  });
});

describe('renamedFrom', () => {
  it('reads ";"-separated old names, quoted or not, and arrays', () => {
    expect(renamedFrom({ renamed_from: 'Elegoo PETG PRO;Elegoo PETG Pro @System' })).toEqual([
      'Elegoo PETG PRO',
      'Elegoo PETG Pro @System',
    ]);
    expect(renamedFrom({ renamed_from: '"Old; name";Other' })).toEqual(['Old; name', 'Other']);
    expect(renamedFrom({ renamed_from: '"Unterminated' })).toEqual([]);
    expect(renamedFrom({ renamed_from: ['A', 'B'] })).toEqual(['A', 'B']);
    expect(renamedFrom({})).toEqual([]);
  });
});

describe('findNamedPreset', () => {
  const presets = [
    { ref: user('My Base', 'default') },
    { ref: user('My Base', '1234') },
    { ref: system('Generic PETG @System', 'OrcaFilamentLibrary') },
    { ref: system('fdm_filament_pet', 'BBL') },
    { ref: system('fdm_filament_pet', 'OrcaFilamentLibrary') },
  ];
  const named = (name: string) => presets.filter(({ ref }) => ref.name === name);

  it("prefers the child's own user folder, then its vendor's system preset", () => {
    expect(chooseParent(user('Mine', '1234'), named('My Base'))?.ref.folder).toBe('1234');
    expect(chooseParent(system('PETG', 'BBL'), named('fdm_filament_pet'))?.ref.vendor).toBe('BBL');
    // Without one of its vendor's, any system preset.
    expect(chooseParent(user('Mine', 'default'), named('fdm_filament_pet'))?.ref.origin).toBe(
      'system',
    );
  });

  it('follows renames, and renames of renames, but only those system presets record', () => {
    const renames = presetRenames([
      {
        ref: system('Generic PETG @System', 'OrcaFilamentLibrary'),
        content: { renamed_from: 'Generic PETG' },
      },
      { ref: system('Generic PETG', 'OrcaFilamentLibrary'), content: { renamed_from: 'PETG v1' } },
      { ref: user('My PETG', 'default'), content: { renamed_from: 'Ignored' } },
    ]);
    const child = user('Mine', 'default');

    expect(findNamedPreset(child, 'Generic PETG', named, renames)?.ref.name).toBe(
      'Generic PETG @System',
    );
    expect(findNamedPreset(child, 'PETG v1', named, renames)?.ref.name).toBe(
      'Generic PETG @System',
    );
    expect(findNamedPreset(child, 'Ignored', named, renames)).toBeUndefined();
  });

  it('never returns the child itself', () => {
    const base = user('My Base', 'default');
    expect(chooseParent(base, [{ ref: base }])).toBeUndefined();
  });
});
