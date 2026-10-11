// Composition root for the browser playground: the in-memory host seeded with the profile
// fixtures from packages/core. For fast UI work without Tauri or OrcaSlicer.
import { createComparerApp } from '@comparer/app';
import type { ProfileDocument, ProfileType, SettingsStore } from '@comparer/core';
import { createMemoryHost } from '@comparer/host-memory';
import { createSettingCatalog } from '@comparer/setting-catalog';
import { ComparerRoot } from '@comparer/ui';
import '@comparer/ui/theme/desktop.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const fixtures = import.meta.glob<Record<string, unknown>>(
  '../../../packages/core/test/fixtures/**/*.json',
  { eager: true, import: 'default' },
);

/** fixtures/system/<vendor>/<type>/<file> or fixtures/user/<user_id>/<type>/<file> */
function toDocument([path, content]: [string, Record<string, unknown>]): ProfileDocument {
  const id = path.slice(path.indexOf('/fixtures/') + '/fixtures/'.length);
  const [origin, owner, type] = id.split('/');
  return {
    ref: {
      id,
      name: String(content['name']),
      type: type as ProfileType,
      origin: origin === 'system' ? 'system' : 'user',
      ...(origin === 'system' && owner ? { vendor: owner } : {}),
      ...(origin === 'user' && owner ? { folder: owner } : {}),
    },
    content,
  };
}

/** Preferences in the browser's storage. It can be unavailable (private windows, blocked storage). */
const browserSettings: SettingsStore = {
  load: async () =>
    JSON.parse(localStorage.getItem('comparer-settings') ?? '{}') as Record<string, unknown>,
  save: async (settings) => localStorage.setItem('comparer-settings', JSON.stringify(settings)),
};

const app = createComparerApp({
  repository: createMemoryHost({ documents: Object.entries(fixtures).map(toDocument) }),
  catalog: createSettingCatalog(),
  settings: browserSettings,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ComparerRoot app={app} />
  </StrictMode>,
);
