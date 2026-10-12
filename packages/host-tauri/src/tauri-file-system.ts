import { invoke } from '@tauri-apps/api/core';
import { appDataDir, configDir, join, sep } from '@tauri-apps/api/path';
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import { ComparerError } from '@comparer/core';
import type { HostFileSystem, PresetLock } from './file-system.ts';

/** HostFileSystem over Tauri's fs plugin. Paths must be inside the scopes in capabilities/. */
export function tauriFileSystem(): HostFileSystem {
  return {
    separator: sep(),
    async list(path) {
      if (!(await exists(path))) return [];
      const entries = await readDir(path);
      return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory }));
    },
    exists: (path) => exists(path),
    readText: (path) => readTextFile(path),
    writeText: (path, text) => writeTextFile(path, text),
    rename: (from, to) => rename(from, to),
    remove: (path) => remove(path),
    makeDirectory: (path) => mkdir(path, { recursive: true }),
  };
}

/**
 * OrcaSlicer's user-preset lock, taken through the app's two Rust commands
 * (`lock_user_presets` / `unlock_user_presets` in src-tauri/src/lib.rs).
 */
export function tauriPresetLock(): PresetLock {
  return {
    async withLock(work) {
      let token: number;
      try {
        token = await invoke<number>('lock_user_presets');
      } catch (error) {
        // "busy" (LOCK_BUSY in lib.rs): OrcaSlicer kept the lock past the timeout.
        throw error === 'busy'
          ? new ComparerError('busy', 'OrcaSlicer is reading or saving its presets right now.')
          : new ComparerError(
              'host-error',
              `Couldn't take OrcaSlicer's preset lock: ${String(error)}`,
            );
      }
      try {
        return await work();
      } finally {
        await invoke('unlock_user_presets', { token });
      }
    },
  };
}

/**
 * OrcaSlicer's default data folder: %APPDATA%\OrcaSlicer on Windows,
 * ~/Library/Application Support/OrcaSlicer on macOS, $XDG_CONFIG_HOME/OrcaSlicer on Linux.
 */
export function defaultOrcaDataDir(): Promise<string> {
  return configDir().then((dir) => join(dir, 'OrcaSlicer'));
}

/** Where the app keeps backups of the files it saves: its own data folder, never OrcaSlicer's. */
export function defaultBackupDir(): Promise<string> {
  return appDataDir().then((dir) => join(dir, 'backups'));
}

/** Where the app keeps its preferences (see fileSettingsStore): its own data folder. */
export function defaultSettingsPath(): Promise<string> {
  return appDataDir().then((dir) => join(dir, 'settings.json'));
}

/**
 * Asks the app to use a data folder the user chose (the `use_orca_data_dir` command in
 * src-tauri/src/lib.rs): it checks the folder and grants access to it for this run.
 */
export async function allowOrcaDataDir(path: string): Promise<string> {
  return invoke<string>('use_orca_data_dir', { path });
}

/** The system's folder picker (Tauri's dialog plugin), starting in `startIn`. */
export async function pickFolder(startIn: string): Promise<string | undefined> {
  const picked = await open({
    directory: true,
    multiple: false,
    defaultPath: startIn,
    title: "Choose OrcaSlicer's data folder",
  });
  return typeof picked === 'string' ? picked : undefined;
}
