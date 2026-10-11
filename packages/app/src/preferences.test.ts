import type { SettingsStore } from '@comparer/core';
import { describe, expect, it, vi } from 'vitest';
import { createPreferences } from './preferences.ts';

function memoryStore(initial: Record<string, unknown> = {}) {
  const saved: Record<string, unknown>[] = [];
  const store: SettingsStore = {
    load: vi.fn(async () => initial),
    save: async (settings) => {
      saved.push(settings);
    },
  };
  return { store, saved };
}

describe('createPreferences', () => {
  it('loads once, and saves every preference with the one that changed', async () => {
    const { store, saved } = memoryStore({ theme: 'dark' });
    const preferences = createPreferences(store);

    expect(await preferences.load()).toEqual({ theme: 'dark' });
    await Promise.all([preferences.set('a', 1), preferences.set('b', true)]);

    expect(saved).toEqual([
      { theme: 'dark', a: 1 },
      { theme: 'dark', a: 1, b: true },
    ]);
    expect(await preferences.load()).toEqual({ theme: 'dark', a: 1, b: true });
    expect(store.load).toHaveBeenCalledTimes(1);
  });

  it('works without a store, keeping values for the session only', async () => {
    const preferences = createPreferences(undefined);

    await preferences.set('a', 1);

    expect(await preferences.load()).toEqual({ a: 1 });
  });

  it('carries on when the store fails', async () => {
    const preferences = createPreferences({
      load: () => Promise.reject(new Error('unreadable')),
      save: () => Promise.reject(new Error('read-only')),
    });

    expect(await preferences.load()).toEqual({});
    await expect(preferences.set('a', 1)).resolves.toBeUndefined();
    expect(await preferences.load()).toEqual({ a: 1 });
  });
});
