import type { SettingsStore } from '@comparer/core';
import type { HostFileSystem } from './file-system.ts';

/**
 * Keeps the comparer's preferences in one JSON file (the app's own data folder, never
 * OrcaSlicer's). A missing or unreadable file reads as no preferences, and the next save
 * replaces it.
 */
export function fileSettingsStore(fs: HostFileSystem, path: string): SettingsStore {
  return {
    async load() {
      if (!(await fs.exists(path))) return {};
      try {
        const settings: unknown = JSON.parse(await fs.readText(path));
        return typeof settings === 'object' && settings !== null && !Array.isArray(settings)
          ? (settings as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    },
    async save(settings) {
      await fs.makeDirectory(path.slice(0, path.lastIndexOf(fs.separator)));
      await fs.writeText(path, `${JSON.stringify(settings, null, 2)}\n`);
    },
  };
}
