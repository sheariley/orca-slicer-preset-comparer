import type { SettingsStore } from '@comparer/core';

/**
 * The user's preferences, read and written one key at a time over the host's SettingsStore.
 * They're conveniences, so a store that fails only costs the remembered value: loading resolves
 * to {} and a failed save is dropped. Without a store, they last the session.
 */
export interface Preferences {
  /** Every saved preference. Loaded from the store once, then cached. */
  load(): Promise<Readonly<Record<string, unknown>>>;
  /** Sets one preference and saves them all. Saves run one at a time, in order. */
  set(key: string, value: unknown): Promise<void>;
}

export function createPreferences(store: SettingsStore | undefined): Preferences {
  let loaded: Promise<Record<string, unknown>> | undefined;
  let saving: Promise<void> = Promise.resolve();

  const load = () =>
    (loaded ??= (store?.load() ?? Promise.resolve({})).then(
      (settings): Record<string, unknown> => ({ ...settings }),
      (): Record<string, unknown> => ({}),
    ));

  return {
    load,
    set(key, value) {
      saving = saving.then(async () => {
        const settings = await load();
        settings[key] = value;
        await store?.save({ ...settings }).catch(() => {});
      });
      return saving;
    },
  };
}
