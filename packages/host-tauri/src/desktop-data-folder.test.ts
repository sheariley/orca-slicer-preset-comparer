import type { SettingsStore } from '@comparer/core';
import { describe, expect, it } from 'vitest';
import { DATA_FOLDER_PREFERENCE, desktopDataFolder } from './desktop-data-folder.ts';

const DEFAULT = 'C:\\Users\\me\\AppData\\Roaming\\OrcaSlicer';
const PORTABLE = 'D:\\OrcaSlicer\\data';

/** Preferences in memory, plus a record of what the folder asked the app to do. */
function setup(saved: Record<string, unknown> = {}, valid: readonly string[] = [PORTABLE]) {
  const store: SettingsStore & { saved: Readonly<Record<string, unknown>> } = {
    saved,
    load: async () => store.saved,
    save: async (next) => {
      store.saved = { ...next };
    },
  };
  const allowed: string[] = [];
  let restarts = 0;
  const folder = () =>
    desktopDataFolder({
      settings: store,
      defaultDir: DEFAULT,
      allow: async (path) => {
        if (!valid.includes(path)) throw `${path} doesn't look like OrcaSlicer's data folder.`;
        allowed.push(path);
        return path;
      },
      pick: async () => PORTABLE,
      restart: () => {
        restarts++;
      },
    });
  return { store, allowed, folder, restarts: () => restarts };
}

describe('desktopDataFolder', () => {
  it("uses OrcaSlicer's default folder until one is chosen", async () => {
    const { folder, allowed } = setup({ 'layout.other': true });
    const dataFolder = await folder();

    expect(dataFolder).toMatchObject({ path: DEFAULT, isDefault: true });
    expect(dataFolder.problem).toBeUndefined();
    expect(allowed).toEqual([]);
  });

  it('uses the chosen folder, granting access to it at startup', async () => {
    const { folder, allowed } = setup({ [DATA_FOLDER_PREFERENCE]: PORTABLE });

    expect(await folder()).toMatchObject({ path: PORTABLE, isDefault: false });
    expect(allowed).toEqual([PORTABLE]);
  });

  it("falls back to the default, saying why, when the chosen folder can't be used", async () => {
    const { folder } = setup({ [DATA_FOLDER_PREFERENCE]: 'E:\\Gone' });
    const dataFolder = await folder();

    expect(dataFolder).toMatchObject({ path: DEFAULT, isDefault: true });
    expect(dataFolder.problem).toBe(
      "Couldn't use E:\\Gone, so the default folder is in use: E:\\Gone doesn't look like OrcaSlicer's data folder.",
    );
  });

  it('switches: remembers the folder, keeping the other preferences, and restarts', async () => {
    const { folder, store, restarts } = setup({ 'table.onlyDifferences': false });
    const dataFolder = await folder();

    expect(await dataFolder.choose()).toBe(PORTABLE);
    await dataFolder.use(PORTABLE);
    expect(store.saved).toEqual({
      'table.onlyDifferences': false,
      [DATA_FOLDER_PREFERENCE]: PORTABLE,
    });
    expect(restarts()).toBe(1);

    await dataFolder.use(null);
    expect(store.saved).toEqual({ 'table.onlyDifferences': false });
    expect(restarts()).toBe(2);
  });

  it("refuses a folder that isn't OrcaSlicer's, changing nothing", async () => {
    const { folder, store, restarts } = setup();
    const dataFolder = await folder();

    await expect(dataFolder.use('D:\\Downloads')).rejects.toThrow(
      "D:\\Downloads doesn't look like OrcaSlicer's data folder.",
    );
    expect(store.saved).toEqual({});
    expect(restarts()).toBe(0);
  });
});
