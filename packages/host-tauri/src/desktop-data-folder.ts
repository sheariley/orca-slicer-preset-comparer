import type { DataFolder, SettingsStore } from '@comparer/core';

/** The preference that holds a chosen data folder. Absent: OrcaSlicer's default folder. */
export const DATA_FOLDER_PREFERENCE = 'desktop.orcaDataDir';

export interface DesktopDataFolderOptions {
  /** Where the app keeps its preferences (fileSettingsStore). */
  readonly settings: SettingsStore;
  /** OrcaSlicer's default data folder (defaultOrcaDataDir). */
  readonly defaultDir: string;
  /**
   * Lets the app use a folder (the `use_orca_data_dir` Rust command): checks it looks like
   * OrcaSlicer's data folder and grants access to it. Rejects with the reason in words.
   */
  readonly allow: (path: string) => Promise<string>;
  /** The system's folder picker. Undefined when the user cancels. */
  readonly pick: (startIn: string) => Promise<string | undefined>;
  /** Restarts the comparer (reloads the window), so it opens the new folder. */
  readonly restart: () => void;
}

/**
 * The desktop app's OrcaSlicer data folder (core's DataFolder): the default, or one the user
 * chose, remembered in the preferences. A remembered folder that can't be used any more (moved,
 * deleted) falls back to the default and says why.
 */
export async function desktopDataFolder({
  settings,
  defaultDir,
  allow,
  pick,
  restart,
}: DesktopDataFolderOptions): Promise<DataFolder> {
  const saved = (await settings.load())[DATA_FOLDER_PREFERENCE];
  let path = defaultDir;
  let problem: string | undefined;
  if (typeof saved === 'string' && saved !== '') {
    try {
      path = await allow(saved);
    } catch (error) {
      problem = `Couldn't use ${saved}, so the default folder is in use: ${message(error)}`;
    }
  }
  const isDefault = path === defaultDir;

  return {
    path,
    isDefault,
    ...(problem ? { problem } : {}),
    choose: () => pick(path),
    async use(next) {
      if (next !== null) {
        try {
          await allow(next);
        } catch (error) {
          throw new Error(message(error), { cause: error });
        }
      }
      const preferences: Record<string, unknown> = { ...(await settings.load()) };
      if (next === null) delete preferences[DATA_FOLDER_PREFERENCE];
      else preferences[DATA_FOLDER_PREFERENCE] = next;
      await settings.save(preferences);
      restart();
    },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
