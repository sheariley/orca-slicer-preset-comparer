export { createDesktopHost, type DesktopHostOptions } from './desktop-host.ts';
export type { DirectoryEntry, HostFileSystem, PresetLock } from './file-system.ts';
export {
  allowOrcaDataDir,
  defaultBackupDir,
  defaultOrcaDataDir,
  defaultSettingsPath,
  pickFolder,
  tauriFileSystem,
  tauriPresetLock,
} from './tauri-file-system.ts';
export { tauriCloseGuard } from './tauri-close-guard.ts';
export { fileSettingsStore } from './file-settings-store.ts';
export {
  DATA_FOLDER_PREFERENCE,
  desktopDataFolder,
  type DesktopDataFolderOptions,
} from './desktop-data-folder.ts';
