import { describe, expect, it } from 'vitest';
import { chainFor, loadFixtureDocuments } from '../../test/load-fixtures.ts';
import { resolveChain } from '../resolve/resolve-chain.ts';
import { diffAgainstBase, diffProfiles } from './diff-profiles.ts';

const documents = loadFixtureDocuments();
const resolve = (name: string) => resolveChain(chainFor(documents, name));

describe('diffProfiles', () => {
  it('reports changed and identical settings between two real filaments', () => {
    const rows = diffProfiles(resolve('Bambu ABS @BBL A1'), resolve('Bambu PLA Basic @BBL A1'));
    const byKey = new Map(rows.map((row) => [row.key, row]));

    expect(byKey.get('nozzle_temperature')?.status).toBe('changed');
    expect(byKey.get('filament_type')?.left).toEqual(['ABS']);
    expect(byKey.get('filament_type')?.right).toEqual(['PLA']);
    expect(rows.some((row) => row.status === 'same')).toBe(true);
  });

  it('sorts rows by key', () => {
    const rows = diffProfiles(resolve('My ABS'), resolve('Bambu ABS @BBL A1'));
    const keys = rows.map((row) => row.key);

    expect(keys).toEqual([...keys].sort());
  });

  it('marks only the user overrides as changed against the parent', () => {
    const rows = diffProfiles(resolve('My ABS'), resolve('Bambu ABS @BBL A1'));
    const changed = rows.filter((row) => row.status !== 'same').map((row) => row.key);

    expect(changed.sort()).toEqual(['filament_flow_ratio', 'nozzle_temperature']);
  });
});

describe('diffAgainstBase', () => {
  const base = resolve('Bambu ABS @BBL A1');
  const pla = resolve('Bambu PLA Basic @BBL A1');
  const mine = resolve('My ABS');

  it('compares each target with the base, one cell per target', () => {
    const rows = diffAgainstBase(base, [pla, mine]);
    const temperature = rows.find((row) => row.key === 'nozzle_temperature')!;

    expect(temperature.base).toEqual(base.settings.get('nozzle_temperature')?.value);
    expect(temperature.targets.map((cell) => cell.status)).toEqual(['changed', 'changed']);
    expect(temperature.differs).toBe(true);
    const type = rows.find((row) => row.key === 'filament_type')!;
    expect(type.targets.map((cell) => cell.status)).toEqual(['changed', 'same']);
    expect(type.differs).toBe(true);
  });

  it('matches diffProfiles for a single target', () => {
    const single = diffAgainstBase(mine, [base]);
    const pair = diffProfiles(mine, base);

    expect(
      single.map((row) => [row.key, row.base, row.targets[0]!.value, row.targets[0]!.status]),
    ).toEqual(pair.map((row) => [row.key, row.left, row.right, row.status]));
    expect(single.filter((row) => row.differs).map((row) => row.key)).toEqual(
      pair.filter((row) => row.status !== 'same').map((row) => row.key),
    );
  });

  it('treats a key that neither the base nor a target has as the same for that target', () => {
    const preset = (name: string, content: Record<string, string>) =>
      resolveChain([
        {
          ref: { id: name, name, type: 'filament', origin: 'user' },
          content: { name, ...content },
        },
      ]);
    const rows = diffAgainstBase(preset('Base', {}), [
      preset('A', { nozzle_temperature: '210' }),
      preset('B', {}),
    ]);
    const row = rows.find((candidate) => candidate.key === 'nozzle_temperature')!;

    expect(row.targets.map((cell) => cell.status)).toEqual(['right-only', 'same']);
    expect(row.differs).toBe(true);
  });
});
