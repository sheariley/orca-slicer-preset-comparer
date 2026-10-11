export { createDesktopHost, type DesktopHostOptions } from './desktop-host.ts';
export type { DirectoryEntry, HostFileSystem, PresetLock } from './file-system.ts';
export {
  defaultBackupDir,
  defaultOrcaDataDir,
  defaultSettingsPath,
  tauriFileSystem,
  tauriPresetLock,
} from './tauri-file-system.ts';
export { tauriCloseGuard } from './tauri-close-guard.ts';
export { fileSettingsStore } from './file-settings-store.ts';
