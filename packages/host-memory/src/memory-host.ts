import {
  ComparerError,
  orcaSlicerFormat,
  serializeProfile,
  type HostCapabilities,
  type ProfileDocument,
  type ProfileRepository,
  type SettingsStore,
  type TextFormat,
} from '@comparer/core';

export interface MemoryHostOptions {
  readonly documents: readonly ProfileDocument[];
  readonly capabilities?: Partial<HostCapabilities>;
  /** The "platform" line endings for new files. Defaults to "\n". */
  readonly newline?: TextFormat['newline'];
}

export type MemoryHost = ProfileRepository & SettingsStore;

/** An in-memory host for tests, the browser playground, and UI previews. */
export function createMemoryHost({
  documents,
  capabilities,
  newline = '\n',
}: MemoryHostOptions): MemoryHost {
  // Every stored document has text, like a file would: documents built without it get
  // OrcaSlicer's format.
  const withText = (document: ProfileDocument): ProfileDocument => ({
    ...document,
    text: document.text ?? serializeProfile(document.content, orcaSlicerFormat(newline)),
  });
  const byId = new Map(documents.map((document) => [document.ref.id, withText(document)]));
  const resolvedCapabilities: HostCapabilities = {
    canSave: true,
    canBrowseFiles: false,
    canWatchForChanges: false,
    ...capabilities,
  };
  let settings: Readonly<Record<string, unknown>> = {};

  return {
    capabilities: resolvedCapabilities,
    newline,

    async listPresets(query) {
      return [...byId.values()]
        .map((document) => document.ref)
        .filter((ref) => query?.type === undefined || ref.type === query.type)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async readDocument(ref) {
      const document = byId.get(ref.id);
      if (!document) throw new ComparerError('not-found', `No preset "${ref.name}".`, ref.id);
      return document;
    },

    async resolveParent(child, parentName) {
      // Same vendor first, then anywhere (user presets inherit across vendors).
      const candidates = [...byId.values()]
        .map((document) => document.ref)
        .filter((ref) => ref.type === child.type && ref.name === parentName);
      return candidates.find((ref) => ref.vendor === child.vendor) ?? candidates[0];
    },

    async saveDocument({ ref, text, previousText }) {
      if (!resolvedCapabilities.canSave) {
        throw new ComparerError('unsupported', 'This host is read-only.');
      }
      const existing = byId.get(ref.id);
      if (!existing) throw new ComparerError('not-found', `No preset "${ref.name}".`, ref.id);
      if (previousText !== undefined && existing.text !== previousText) {
        throw new ComparerError('conflict', `"${ref.name}" changed since it was read.`, ref.id);
      }
      let content: Record<string, unknown>;
      try {
        content = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new ComparerError('invalid-profile', `Refusing to save invalid JSON.`, ref.id);
      }
      byId.set(ref.id, { ref, content, text });
      return { ref, reloadRequired: 'none' };
    },

    async createPreset({ type, name, content }) {
      if (!resolvedCapabilities.canSave) {
        throw new ComparerError('unsupported', 'This host is read-only.');
      }
      if ([...byId.values()].some(({ ref }) => ref.type === type && ref.name === name)) {
        throw new ComparerError(
          'name-taken',
          `A ${type} preset named "${name}" already exists.`,
          name,
        );
      }
      const ref = { id: `user/${type}/${name}`, name, type, origin: 'user' as const };
      byId.set(ref.id, withText({ ref, content: { ...content } }));
      return { ref, reloadRequired: 'none' };
    },

    async load() {
      return settings;
    },

    async save(next) {
      settings = { ...next };
    },
  };
}
