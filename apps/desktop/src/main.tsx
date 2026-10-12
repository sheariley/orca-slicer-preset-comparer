// Composition root for the desktop app: the Tauri host reading OrcaSlicer's data folder (the
// default one, or the one chosen in Settings).
import { createComparerApp } from '@comparer/app';
import {
  allowOrcaDataDir,
  createDesktopHost,
  defaultBackupDir,
  defaultOrcaDataDir,
  defaultSettingsPath,
  desktopDataFolder,
  fileSettingsStore,
  pickFolder,
  tauriCloseGuard,
  tauriFileSystem,
  tauriPresetLock,
} from '@comparer/host-tauri';
import { createSettingCatalog } from '@comparer/setting-catalog';
import { ComparerRoot } from '@comparer/ui';
import '@comparer/ui/theme/desktop.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = createRoot(document.getElementById('root')!);

try {
  const settings = fileSettingsStore(tauriFileSystem(), await defaultSettingsPath());
  // OrcaSlicer's data folder: the default, or the one the user chose in Settings.
  const dataFolder = await desktopDataFolder({
    settings,
    defaultDir: await defaultOrcaDataDir(),
    allow: allowOrcaDataDir,
    pick: pickFolder,
    restart: () => window.location.reload(),
  });
  const app = createComparerApp({
    repository: createDesktopHost({
      fs: tauriFileSystem(),
      dataDir: dataFolder.path,
      lock: tauriPresetLock(),
      backupDir: await defaultBackupDir(),
    }),
    catalog: createSettingCatalog(),
    closeGuard: tauriCloseGuard(),
    dataFolder,
    settings,
  });
  root.render(
    <StrictMode>
      <ComparerRoot app={app} />
    </StrictMode>,
  );
} catch (error) {
  root.render(<pre role="alert">Couldn't start the comparer: {String(error)}</pre>);
}
