// Composition root for the desktop app: the Tauri host reading OrcaSlicer's data folder.
import { createComparerApp } from '@comparer/app';
import {
  createDesktopHost,
  defaultBackupDir,
  defaultOrcaDataDir,
  defaultSettingsPath,
  fileSettingsStore,
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
  const app = createComparerApp({
    repository: createDesktopHost({
      fs: tauriFileSystem(),
      dataDir: await defaultOrcaDataDir(),
      lock: tauriPresetLock(),
      backupDir: await defaultBackupDir(),
    }),
    catalog: createSettingCatalog(),
    closeGuard: tauriCloseGuard(),
    settings: fileSettingsStore(tauriFileSystem(), await defaultSettingsPath()),
  });
  root.render(
    <StrictMode>
      <ComparerRoot app={app} />
    </StrictMode>,
  );
} catch (error) {
  root.render(<pre role="alert">Couldn't start the comparer: {String(error)}</pre>);
}
