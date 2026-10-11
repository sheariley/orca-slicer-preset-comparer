import { describe, expect, it } from 'vitest';
import { fileSettingsStore } from './file-settings-store.ts';
import type { HostFileSystem } from './file-system.ts';

const PATH = '/home/user/.local/share/comparer/settings.json';

function fileSystem(files: Map<string, string>, made: string[] = []): HostFileSystem {
  return {
    separator: '/',
    list: async () => [],
    exists: async (path) => files.has(path),
    readText: async (path) => files.get(path)!,
    writeText: async (path, text) => {
      files.set(path, text);
    },
    rename: async () => {},
    remove: async () => {},
    makeDirectory: async (path) => {
      made.push(path);
    },
  };
}

describe('fileSettingsStore', () => {
  it('saves to the file, creating its folder, and loads it back', async () => {
    const files = new Map<string, string>();
    const made: string[] = [];
    const store = fileSettingsStore(fileSystem(files, made), PATH);

    await store.save({ collapsed: true });

    expect(made).toEqual(['/home/user/.local/share/comparer']);
    expect(files.get(PATH)).toBe('{\n  "collapsed": true\n}\n');
    expect(await store.load()).toEqual({ collapsed: true });
  });

  it('reads a missing, broken, or non-object file as no preferences', async () => {
    const files = new Map<string, string>();
    const store = fileSettingsStore(fileSystem(files), PATH);

    expect(await store.load()).toEqual({});
    files.set(PATH, '{ broken');
    expect(await store.load()).toEqual({});
    files.set(PATH, '[1, 2]');
    expect(await store.load()).toEqual({});
  });
});
