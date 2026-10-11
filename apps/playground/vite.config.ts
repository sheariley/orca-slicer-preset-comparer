import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// WSL can't watch files on a Windows drive (/mnt/c, /mnt/d, ...), so edits there never reach the
// dev server. Poll instead, only in that setup: it costs some CPU while the server runs.
const onWindowsDriveFromWsl = /^\/mnt\/[a-z]\//.test(import.meta.dirname);

export default defineConfig({
  plugins: [react()],
  server: {
    // The fixtures live in packages/core, outside this app's folder.
    fs: { allow: ['../..'] },
    ...(onWindowsDriveFromWsl ? { watch: { usePolling: true, interval: 300 } } : {}),
  },
});
