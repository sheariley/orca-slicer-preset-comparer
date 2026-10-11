import { describe, expect, it } from 'vitest';
import type { PresetRef, ProfileDocument } from '../model/profile.ts';
import {
  applyContentEdits,
  canRedo,
  canUndo,
  editsBetween,
  emptyHistory,
  hasEdits,
  pendingEdits,
  record,
  redo,
  undo,
  withoutTarget,
  type EditBatch,
} from './history.ts';
import type { Change } from './transfer.ts';

const ref = (name: string): PresetRef => ({ id: name, name, type: 'filament', origin: 'user' });

const batch = (label: string, targets: Record<string, Record<string, Change>>): EditBatch => ({
  label,
  plan: {
    targets: Object.entries(targets).map(([name, changes]) => ({
      target: ref(name),
      changes: Object.entries(changes).map(([key, change]) => ({ key, change })),
      skipped: [],
      redundantOverrides: [],
    })),
  },
});

const set = (value: string | string[]): Change => ({ kind: 'set', value });
const remove: Change = { kind: 'remove' };

const originals = new Map<string, ProfileDocument>([
  ['PLA', { ref: ref('PLA'), content: { name: 'PLA', nozzle_temperature: ['210'], fan: ['100'] } }],
  ['PETG', { ref: ref('PETG'), content: { name: 'PETG', nozzle_temperature: ['240'] } }],
]);

describe('edit history', () => {
  it('records, undoes, and redoes whole batches', () => {
    const first = batch('first', { PLA: { nozzle_temperature: set(['215']) } });
    const second = batch('second', { PETG: { nozzle_temperature: set(['235']) } });

    let history = record(record(emptyHistory, first), second);
    expect(history.done.map((b) => b.label)).toEqual(['first', 'second']);

    history = undo(history);
    expect(history.done.map((b) => b.label)).toEqual(['first']);
    expect(canRedo(history)).toBe(true);

    history = redo(history);
    expect(history.done.map((b) => b.label)).toEqual(['first', 'second']);
    expect(canRedo(history)).toBe(false);
  });

  it('clears redo when a new batch is recorded', () => {
    const history = record(
      undo(record(emptyHistory, batch('a', { PLA: { fan: set(['50']) } }))),
      batch('b', { PLA: { fan: set(['60']) } }),
    );

    expect(history.undone).toEqual([]);
    expect(history.done.map((b) => b.label)).toEqual(['b']);
  });

  it("doesn't record a batch that changes nothing", () => {
    expect(record(emptyHistory, batch('noop', { PLA: {} }))).toBe(emptyHistory);
    expect(canUndo(emptyHistory)).toBe(false);
    expect(undo(emptyHistory)).toBe(emptyHistory);
    expect(redo(emptyHistory)).toBe(emptyHistory);
  });
});

describe('pendingEdits', () => {
  it('combines batches per target, later changes winning', () => {
    const history = record(
      record(
        emptyHistory,
        batch('a', { PLA: { nozzle_temperature: set(['215']), fan: set(['50']) } }),
      ),
      batch('b', { PLA: { fan: set(['60']) }, PETG: { cooling: set(['1']) } }),
    );

    expect(pendingEdits(history, originals)).toEqual([
      { target: ref('PLA'), edits: { set: { nozzle_temperature: ['215'], fan: ['60'] } } },
      { target: ref('PETG'), edits: { set: { cooling: ['1'] } } },
    ]);
  });

  it('drops changes that end up where the file started', () => {
    const history = record(
      record(
        emptyHistory,
        batch('a', { PLA: { nozzle_temperature: set(['215']), extra: set(['1']) } }),
      ),
      batch('b', { PLA: { nozzle_temperature: set(['210']), extra: remove } }),
    );

    expect(pendingEdits(history, originals)).toEqual([]);
  });

  it('keeps a change of shape, and removes keys the file has', () => {
    const history = record(
      emptyHistory,
      batch('a', { PLA: { nozzle_temperature: set('210'), fan: remove } }),
    );

    expect(pendingEdits(history, originals)).toEqual([
      { target: ref('PLA'), edits: { set: { nozzle_temperature: '210' }, remove: ['fan'] } },
    ]);
  });

  it("doesn't mistake built-in object members for keys the file has", () => {
    const history = record(
      emptyHistory,
      batch('a', { PLA: { constructor: remove, toString: set(['1']) } }),
    );

    expect(pendingEdits(history, originals)).toEqual([
      { target: ref('PLA'), edits: { set: { toString: ['1'] } } },
    ]);
  });

  it('ignores undone batches', () => {
    const history = undo(record(emptyHistory, batch('a', { PLA: { fan: set(['50']) } })));

    expect(pendingEdits(history, originals)).toEqual([]);
  });
});

describe('applyContentEdits and editsBetween', () => {
  const from = { name: 'PLA', a: ['1'], b: '2', gone: ['x'] };

  it('applies sets and removes, replacing values in place', () => {
    expect(applyContentEdits(from, { set: { a: ['9'], c: '3' }, remove: ['gone'] })).toEqual({
      name: 'PLA',
      a: ['9'],
      b: '2',
      c: '3',
    });
  });

  it('computes the edits between two contents, and they round-trip', () => {
    const to = { name: 'PLA', a: ['9'], b: '2', c: '3' };
    const edits = editsBetween(from, to);

    expect(edits).toEqual({ set: { a: ['9'], c: '3' }, remove: ['gone'] });
    expect(applyContentEdits(from, edits)).toEqual(to);
    expect(hasEdits(editsBetween(to, to))).toBe(false);
  });

  it('treats a change of shape as a change', () => {
    expect(editsBetween({ a: ['1'] }, { a: '1' })).toEqual({ set: { a: '1' } });
  });
});

describe('withoutTarget', () => {
  it("drops one target's changes from done and undone batches, and batches left empty", () => {
    const both = batch('Copy to both', { PLA: { fan: set(['80']) }, PETG: { fan: set(['80']) } });
    const petgOnly = batch('Copy to PETG', { PETG: { nozzle_temperature: set(['250']) } });
    const history = undo(record(record(emptyHistory, both), petgOnly));

    const result = withoutTarget(history, 'PETG');

    expect(result.done.map((entry) => entry.label)).toEqual(['Copy to both']);
    expect(result.done[0]!.plan.targets.map((plan) => plan.target.id)).toEqual(['PLA']);
    expect(result.undone).toEqual([]);
    expect(pendingEdits(result, originals).map((entry) => entry.target.id)).toEqual(['PLA']);
  });
});
