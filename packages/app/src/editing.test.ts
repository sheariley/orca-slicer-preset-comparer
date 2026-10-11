import type { PresetRef, ProfileDocument, SettingCatalog } from '@comparer/core';
import { createMemoryHost } from '@comparer/host-memory';
import { describe, expect, it } from 'vitest';
import { createComparerApp } from './comparer-app.ts';
import {
  canRedoSession,
  canUndoSession,
  hasPendingEdits,
  pending,
  redoLabel,
  redoSession,
  undoLabel,
  undoSession,
} from './session/session.ts';

const catalog: SettingCatalog = {
  describe: () => undefined,
  defaultsFor: () => new Map(),
  legacyKeys: () => ({ obsolete: new Set(), renamed: new Map() }),
  keyRules: () => ({ owned: new Set(), perVariant: new Set() }),
};

const user = (name: string, content: Record<string, unknown>): ProfileDocument => ({
  ref: { id: name, name, type: 'filament', origin: 'user' },
  content: { name, from: 'User', ...content },
});

function setup(options: { canSave?: boolean; extra?: ProfileDocument[] } = {}) {
  const host = createMemoryHost({
    documents: [
      user('PLA', { nozzle_temperature: ['210'], fan_max_speed: ['100'] }),
      user('PETG', { nozzle_temperature: ['240'], fan_max_speed: ['50'] }),
      ...(options.extra ?? []),
    ],
    capabilities: { canSave: options.canSave ?? true },
    newline: '\r\n',
  });
  const app = createComparerApp({ repository: host, catalog });
  const refs = async (...names: string[]): Promise<PresetRef[]> => {
    const all = await app.listPresets();
    return names.map((name) => all.find((ref) => ref.name === name)!);
  };
  return { host, app, refs };
}

describe('editing session', () => {
  it('copies settings, then saves only the changed lines, in the file’s own format', async () => {
    const { host, app, refs } = setup();
    const session = await app.openSession(await refs('PLA', 'PETG'));
    const before = (await host.readDocument((await refs('PETG'))[0]!)).text!;

    const { session: edited, plan } = app.copy(session, {
      source: 'PLA',
      targets: ['PETG'],
      keys: ['nozzle_temperature'],
    });
    expect(plan.targets[0]!.changes).toHaveLength(1);
    expect(hasPendingEdits(edited)).toBe(true);

    const { session: saved, results } = await app.saveChanges(edited);

    expect(results).toEqual([
      {
        status: 'saved',
        target: expect.objectContaining({ name: 'PETG' }),
        reloadRequired: 'none',
        reformatted: false,
      },
    ]);
    const after = (await host.readDocument((await refs('PETG'))[0]!)).text!;
    expect(after).toBe(before.replace('"240"', '"210"'));
    expect(after).toContain('\r\n');
    expect(hasPendingEdits(saved)).toBe(false);
  });

  it('labels a copy as one undoable step, and undoes and redoes it', async () => {
    const { app, refs } = setup();
    const session = await app.openSession(await refs('PLA', 'PETG'));

    const { session: edited } = app.copy(session, {
      source: 'PLA',
      targets: ['PETG'],
      keys: ['nozzle_temperature', 'fan_max_speed'],
    });
    expect(edited.history.done.map((batch) => batch.label)).toEqual(['Copy 2 settings to PETG']);
    expect(undoLabel(edited)).toBe('Copy 2 settings to PETG');

    const undone = undoSession(edited);
    expect(pending(undone)).toEqual([]);
    expect(canRedoSession(undone)).toBe(true);
    expect([undoLabel(undone), redoLabel(undone)]).toEqual([undefined, 'Copy 2 settings to PETG']);
    expect(pending(redoSession(undone))).toHaveLength(1);
  });

  it('compares presets as they currently stand, pending edits included', async () => {
    const { app, refs } = setup();
    const session = await app.openSession(await refs('PLA', 'PETG'));
    const { session: edited } = app.copy(session, {
      source: 'PLA',
      targets: ['PETG'],
      keys: ['nozzle_temperature'],
    });

    const rows = app.compareEdited(edited, 'PLA', 'PETG').rows;

    expect(rows.find((row) => row.key === 'nozzle_temperature')?.status).toBe('same');
    expect(rows.find((row) => row.key === 'fan_max_speed')?.status).toBe('changed');
  });

  it('lets edits to an open parent reach its children', async () => {
    const child = user('PETG Fast', { inherits: 'PETG' });
    const { app, refs } = setup({ extra: [child] });
    const session = await app.openSession(await refs('PLA', 'PETG', 'PETG Fast'));

    const { session: edited } = app.copy(session, {
      source: 'PLA',
      targets: ['PETG'],
      keys: ['fan_max_speed'],
    });

    const childRow = app
      .compareEdited(edited, 'PLA', 'PETG Fast')
      .rows.find((row) => row.key === 'fan_max_speed');
    expect(childRow).toMatchObject({ status: 'same', right: ['100'] });
  });

  it('previews a copy without recording it', async () => {
    const { app, refs } = setup();
    const session = await app.openSession(await refs('PLA', 'PETG'));

    const plan = app.previewCopy(session, {
      source: 'PLA',
      targets: ['PETG'],
      keys: ['fan_max_speed'],
    });

    expect(plan.targets[0]!.changes).toHaveLength(1);
    expect(canUndoSession(session)).toBe(false);
  });

  it('passes "Pin override" choices through to the plan', async () => {
    const parent = user('Base', { fan_max_speed: ['100'] });
    const child = user('Child', { inherits: 'Base', fan_max_speed: ['50'] });
    const { app, refs } = setup({ extra: [parent, child] });
    const session = await app.openSession(await refs('PLA', 'Child'));
    const request = { source: 'PLA', targets: ['Child'], keys: ['fan_max_speed'] };

    expect(app.previewCopy(session, request).targets[0]!.changes).toEqual([
      { key: 'fan_max_speed', change: { kind: 'remove' } },
    ]);
    expect(
      app.previewCopy(session, {
        ...request,
        pinOverrides: new Map([['Child', new Map([['fan_max_speed', true]])]]),
      }).targets[0]!.changes,
    ).toEqual([{ key: 'fan_max_speed', change: { kind: 'set', value: ['100'] } }]);
  });

  it('previews a save without writing: the keys per preset, and which files would be reformatted', async () => {
    const system: ProfileDocument = {
      ref: { id: 'Sys', name: 'Sys', type: 'filament', origin: 'system', vendor: 'V' },
      content: { name: 'Sys', nozzle_temperature: ['200'] },
    };
    const { host, app, refs } = setup({ extra: [system] });
    // PETG edited by hand: compact JSON, not the layout OrcaSlicer writes.
    const petg = await host.readDocument((await refs('PETG'))[0]!);
    const compact = JSON.stringify(petg.content);
    await host.saveDocument({ ref: petg.ref, text: compact, previousText: petg.text });
    const session = await app.openSession(await refs('PLA', 'PETG', 'Sys'));

    const { session: edited } = app.copy(session, {
      source: 'PLA',
      targets: ['PETG', 'Sys'],
      keys: ['nozzle_temperature', 'fan_max_speed'],
    });

    expect(app.previewSave(edited)).toEqual([
      {
        target: expect.objectContaining({ name: 'PETG' }),
        status: 'ready',
        keys: ['nozzle_temperature', 'fan_max_speed'],
        reformatted: true,
      },
      {
        target: expect.objectContaining({ name: 'Sys' }),
        status: 'needs-user-preset',
        keys: ['nozzle_temperature', 'fan_max_speed'],
        reformatted: false,
      },
    ]);
    expect((await host.readDocument(petg.ref)).text).toBe(compact);
  });

  it('never writes system presets, and reports that they need a user preset', async () => {
    const system: ProfileDocument = {
      ref: { id: 'Sys', name: 'Sys', type: 'filament', origin: 'system', vendor: 'V' },
      content: { name: 'Sys', nozzle_temperature: ['200'] },
    };
    const { host, app, refs } = setup({ extra: [system] });
    const session = await app.openSession(await refs('PLA', 'Sys'));
    const before = (await host.readDocument(system.ref)).text;

    const { session: edited } = app.copy(session, {
      source: 'PLA',
      targets: ['Sys'],
      keys: ['nozzle_temperature'],
    });
    const { session: after, results } = await app.saveChanges(edited);

    expect(results.map((result) => result.status)).toEqual(['needs-user-preset']);
    expect((await host.readDocument(system.ref)).text).toBe(before);
    expect(hasPendingEdits(after)).toBe(true);
  });

  it('keeps edits pending when a save fails, and saves the other targets', async () => {
    const { host, app, refs } = setup({ extra: [user('ASA', { nozzle_temperature: ['250'] })] });
    const session = await app.openSession(await refs('PLA', 'PETG', 'ASA'));
    // Someone else (e.g. OrcaSlicer) saves PETG after the session read it.
    const petg = await host.readDocument((await refs('PETG'))[0]!);
    await host.saveDocument({
      ref: petg.ref,
      text: petg.text!.replace('"50"', '"55"'),
      previousText: petg.text,
    });

    const { session: edited } = app.copy(session, {
      source: 'PLA',
      targets: ['PETG', 'ASA'],
      keys: ['nozzle_temperature'],
    });
    const { session: after, results } = await app.saveChanges(edited);

    expect(results.map((result) => [result.target.name, result.status])).toEqual([
      ['PETG', 'failed'],
      ['ASA', 'saved'],
    ]);
    expect(results[0]).toMatchObject({ error: { kind: 'conflict' } });
    expect(pending(after).map((entry) => entry.target.name)).toEqual(['PETG']);
  });

  describe('reloading after a conflict', () => {
    /** Someone else (e.g. OrcaSlicer) saves PETG after the session read it. */
    async function saveElsewhere(host: ReturnType<typeof setup>['host'], from: string, to: string) {
      const petg = (await host.listPresets()).find((ref) => ref.name === 'PETG')!;
      const { text } = await host.readDocument(petg);
      await host.saveDocument({ ref: petg, text: text!.replace(from, to), previousText: text });
    }

    it('replays pending copies on top of what is on disk now', async () => {
      const { host, app, refs } = setup();
      const session = await app.openSession(await refs('PLA', 'PETG'));
      const { session: edited } = app.copy(session, {
        source: 'PLA',
        targets: ['PETG'],
        keys: ['nozzle_temperature'],
      });
      await saveElsewhere(host, '"50"', '"55"');
      const { session: conflicted, results } = await app.saveChanges(edited);
      expect(results[0]).toMatchObject({ status: 'failed', error: { kind: 'conflict' } });

      const reloaded = await app.reloadPresets(conflicted, ['PETG']);

      expect(pending(reloaded)).toEqual([
        {
          target: expect.objectContaining({ name: 'PETG' }),
          edits: { set: { nozzle_temperature: ['210'] } },
        },
      ]);
      expect(
        app.compareEdited(reloaded, 'PLA', 'PETG').right.settings.get('fan_max_speed'),
      ).toMatchObject({ value: ['55'] });
      const { results: retried } = await app.saveChanges(reloaded);
      expect(retried[0]?.status).toBe('saved');
      const text = (await host.readDocument((await refs('PETG'))[0]!)).text!;
      expect(text).toContain('"55"');
      expect(text).toContain('"210"');
    });

    it("keeps the user's copy where the file changed the same setting", async () => {
      const { host, app, refs } = setup();
      const session = await app.openSession(await refs('PLA', 'PETG'));
      const { session: edited } = app.copy(session, {
        source: 'PLA',
        targets: ['PETG'],
        keys: ['nozzle_temperature'],
      });
      await saveElsewhere(host, '"240"', '"245"');

      const reloaded = await app.reloadPresets(edited, ['PETG']);

      expect(pending(reloaded)[0]?.edits).toEqual({ set: { nozzle_temperature: ['210'] } });
    });

    it('still lets undo reverse a copy saved before the reload', async () => {
      const { host, app, refs } = setup();
      const session = await app.openSession(await refs('PLA', 'PETG'));
      const { session: edited } = app.copy(session, {
        source: 'PLA',
        targets: ['PETG'],
        keys: ['nozzle_temperature'],
      });
      const { session: saved } = await app.saveChanges(edited);
      await saveElsewhere(host, '"50"', '"55"');

      const reloaded = await app.reloadPresets(saved, ['PETG']);

      expect(pending(reloaded)).toEqual([]);
      // Reverting the copy is pending; the change made elsewhere stays.
      expect(pending(undoSession(reloaded))[0]?.edits).toEqual({
        set: { nozzle_temperature: ['240'] },
      });
    });
  });

  it('reports a read-only host as failed with unsupported', async () => {
    const { app, refs } = setup({ canSave: false });
    const session = await app.openSession(await refs('PLA', 'PETG'));
    const { session: edited } = app.copy(session, {
      source: 'PLA',
      targets: ['PETG'],
      keys: ['nozzle_temperature'],
    });

    const { results } = await app.saveChanges(edited);

    expect(results[0]).toMatchObject({ status: 'failed', error: { kind: 'unsupported' } });
  });

  it('makes a saved change pending again when it is undone', async () => {
    const { app, refs } = setup();
    const session = await app.openSession(await refs('PLA', 'PETG'));
    const { session: edited } = app.copy(session, {
      source: 'PLA',
      targets: ['PETG'],
      keys: ['nozzle_temperature'],
    });
    const { session: saved } = await app.saveChanges(edited);

    expect(pending(undoSession(saved))).toEqual([
      {
        target: expect.objectContaining({ name: 'PETG' }),
        edits: { set: { nozzle_temperature: ['240'] } },
      },
    ]);
  });

  describe('bulk copy to presets outside the comparison', () => {
    it('opens more presets, copies to all of them as one step, and saves each', async () => {
      const { host, app, refs } = setup({
        extra: [
          user('ASA', { nozzle_temperature: ['250'] }),
          user('TPU', { nozzle_temperature: ['220'] }),
        ],
      });
      const session = await app.openSession(await refs('PLA', 'PETG'));
      const edited = app.copy(session, {
        source: 'PLA',
        targets: ['PETG'],
        keys: ['fan_max_speed'],
      });

      const widened = await app.addPresets(edited.session, await refs('ASA', 'TPU', 'PETG'));
      // PETG was already open: it keeps its pending copy, and the history is kept.
      expect([...widened.presets.keys()]).toEqual(['PLA', 'PETG', 'ASA', 'TPU']);
      expect(pending(widened)).toHaveLength(1);

      const { session: copied } = app.copy(widened, {
        source: 'PLA',
        targets: ['ASA', 'TPU'],
        keys: ['nozzle_temperature'],
      });
      expect(pending(copied).map((entry) => entry.target.name)).toEqual(['PETG', 'ASA', 'TPU']);
      // One step: undo takes back both targets.
      expect(pending(undoSession(copied)).map((entry) => entry.target.name)).toEqual(['PETG']);

      const { results } = await app.saveChanges(copied);
      expect(results.map((result) => [result.target.name, result.status])).toEqual([
        ['PETG', 'saved'],
        ['ASA', 'saved'],
        ['TPU', 'saved'],
      ]);
      const asa = await host.readDocument((await refs('ASA'))[0]!);
      expect(asa.content['nozzle_temperature']).toEqual(['210']);
    });
  });
});
