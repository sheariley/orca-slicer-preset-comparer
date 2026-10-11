import {
  ComparerError,
  isComparerError,
  markPresetInfoForSync,
  newPresetInfo,
  orcaPresetVersion,
  orcaSlicerFormat,
  createDetailsLister,
  serializeProfile,
  type HostCapabilities,
  type PresetRef,
  type ProfileRepository,
  type ProfileType,
} from '@comparer/core';
import type { HostFileSystem, PresetLock } from './file-system.ts';

export interface DesktopHostOptions {
  readonly fs: HostFileSystem;
  /** OrcaSlicer's data folder (holds system/ and user/). */
  readonly dataDir: string;
  /** OrcaSlicer's user-preset lock, taken around every save. */
  readonly lock: PresetLock;
  /** The app's own folder for backups of the files it saves. Never inside OrcaSlicer's folder. */
  readonly backupDir: string;
  /**
   * How long to wait before each retry when a file can't be replaced (e.g. Windows, while
   * another program holds it open). Defaults to about 2 s in total.
   */
  readonly retryDelaysMs?: readonly number[];
}

const EDITABLE_TYPES: readonly ProfileType[] = ['filament', 'process'];

const CAPABILITIES: HostCapabilities = {
  canSave: true,
  canBrowseFiles: false,
  canWatchForChanges: false,
};

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [50, 150, 400, 1200];

/**
 * Reads presets from OrcaSlicer's data folder:
 *   system/<Vendor>/<type>/<name>.json        copies of the installed vendor profiles
 *   user/<user_id>/<type>/<name>.json         user presets (each with a sibling .info file)
 *   user/<user_id>/<type>/base/<name>.json    user root presets (inherits ""), parents of others
 * <user_id> is "default" when signed out, or the account id when signed in.
 * Preset ids are absolute file paths. Names come from file names, which OrcaSlicer keeps
 * equal to the preset name.
 */
export function createDesktopHost({
  fs,
  dataDir,
  lock,
  backupDir,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
}: DesktopHostOptions): ProfileRepository {
  const join = (...parts: string[]) => parts.join(fs.separator);
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf(fs.separator));
  const userRoot = join(dataDir, 'user');
  // OrcaSlicer writes CRLF on Windows (text-mode files), LF elsewhere.
  const newline = fs.separator === '\\' ? '\r\n' : '\n';

  async function presetsIn(
    folder: string,
    type: ProfileType,
    origin: 'system' | 'user',
    owner?: string,
  ): Promise<PresetRef[]> {
    const refs: PresetRef[] = [];
    for (const entry of await fs.list(folder)) {
      if (entry.isDirectory || !entry.name.endsWith('.json')) continue;
      refs.push({
        id: join(folder, entry.name),
        name: entry.name.slice(0, -'.json'.length),
        type,
        origin,
        // The vendor folder of a system preset, the user folder of a user preset.
        ...(owner ? (origin === 'system' ? { vendor: owner } : { folder: owner }) : {}),
      });
    }
    return refs;
  }

  async function scan(): Promise<PresetRef[]> {
    const refs: PresetRef[] = [];
    for (const vendor of await fs.list(join(dataDir, 'system'))) {
      if (!vendor.isDirectory) continue;
      for (const type of EDITABLE_TYPES) {
        refs.push(
          ...(await presetsIn(
            join(dataDir, 'system', vendor.name, type),
            type,
            'system',
            vendor.name,
          )),
        );
      }
    }
    for (const user of await fs.list(userRoot)) {
      if (!user.isDirectory) continue;
      for (const type of EDITABLE_TYPES) {
        const folder = join(userRoot, user.name, type);
        refs.push(...(await presetsIn(folder, type, 'user', user.name)));
        refs.push(...(await presetsIn(join(folder, 'base'), type, 'user', user.name)));
      }
    }
    return refs.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Listing details come from the files themselves (see presetDetails).
  const listWithDetails = createDetailsLister(
    async (ref) => JSON.parse(await fs.readText(ref.id)) as unknown,
  );

  /**
   * The user folder OrcaSlicer saves new presets to: the signed-in account's, named in
   * OrcaSlicer.conf (`app.preset_folder`), or "default" when signed out. The file is JSON
   * followed by an "# MD5 checksum" line. Anything unreadable falls back to "default".
   */
  async function currentUserFolder(): Promise<string> {
    const confPath = join(dataDir, 'OrcaSlicer.conf');
    try {
      if (!(await fs.exists(confPath))) return 'default';
      const json = (await fs.readText(confPath))
        .split(/\r?\n/)
        .filter((line) => !line.startsWith('#'))
        .join('\n');
      const folder: unknown = (JSON.parse(json) as { app?: { preset_folder?: unknown } }).app
        ?.preset_folder;
      return typeof folder === 'string' && folder.length > 0 ? folder : 'default';
    } catch {
      return 'default';
    }
  }

  /**
   * The `version` OrcaSlicer gives a preset created from `parent`: the parent's own, which for a
   * system preset is its vendor bundle's (`system/<Vendor>.json`), in OrcaSlicer's format.
   */
  async function versionFrom(parent: PresetRef): Promise<string | undefined> {
    try {
      const path =
        parent.origin === 'system' && parent.vendor
          ? join(dataDir, 'system', `${parent.vendor}.json`)
          : parent.id;
      const version: unknown = (JSON.parse(await fs.readText(path)) as { version?: unknown })
        .version;
      return typeof version === 'string' ? orcaPresetVersion(version) : undefined;
    } catch {
      return undefined;
    }
  }

  /** The user folder (user/<user_id>/) a user preset's file lives in. */
  const userFolderOf = (ref: PresetRef) =>
    ref.origin === 'user'
      ? ref.id.slice(0, ref.id.indexOf(fs.separator, userRoot.length + 1) + 1)
      : undefined;

  return {
    capabilities: CAPABILITIES,
    newline,

    async listPresets(query) {
      const refs = (await scan()).filter(
        (ref) => query?.type === undefined || ref.type === query.type,
      );
      return listWithDetails(refs);
    },

    async readDocument(ref) {
      let text: string;
      try {
        text = await fs.readText(ref.id);
      } catch (error) {
        throw toComparerError(error, ref.id);
      }
      try {
        return { ref, content: JSON.parse(text) as Record<string, unknown>, text };
      } catch {
        throw new ComparerError('invalid-profile', `"${ref.name}" isn't valid JSON.`, ref.id);
      }
    },

    async resolveParent(child, parentName) {
      const candidates = (await scan()).filter(
        (ref) => ref.type === child.type && ref.name === parentName,
      );
      const childFolder = userFolderOf(child);
      // The child's own user folder first, then the same vendor, then any system preset.
      return (
        candidates.find((ref) => childFolder && ref.id.startsWith(childFolder)) ??
        candidates.find((ref) => ref.origin === 'system' && ref.vendor === child.vendor) ??
        candidates.find((ref) => ref.origin === 'system')
      );
    },

    /**
     * Creates a user preset the way OrcaSlicer saves a new one: in the current user folder (see
     * currentUserFolder), in OrcaSlicer's format for new files, with the parent's `version`, and
     * a new `.info` (`sync_info = create`, so OrcaSlicer uploads it). Under OrcaSlicer's lock, and
     * never over an existing file.
     */
    async createPreset({ type, name, content, parent }) {
      if ((await scan()).some((ref) => ref.type === type && ref.name === name)) {
        throw new ComparerError(
          'name-taken',
          `A ${type} preset named "${name}" already exists.`,
          name,
        );
      }
      const userFolder = await currentUserFolder();
      const folder = join(userRoot, userFolder, type);
      const path = join(folder, `${name}.json`);
      const version = await versionFrom(parent);
      const parentContent = await fs
        .readText(parent.id)
        .then((text) => JSON.parse(text) as Record<string, unknown>)
        .catch(() => ({}) as Record<string, unknown>);
      const settingId = parentContent['setting_id'];
      const text = serializeProfile(
        { ...content, ...(version ? { version } : {}) },
        orcaSlicerFormat(newline),
      );
      const info = newPresetInfo({
        userId: userFolder === 'default' ? '' : userFolder,
        baseId: typeof settingId === 'string' ? settingId : '',
        newline,
      });
      return lock.withLock(async () => {
        try {
          if (await fs.exists(path)) {
            throw new ComparerError('name-taken', `"${name}" already exists.`, path);
          }
          await fs.makeDirectory(folder);
          await writeAtomically(path, text);
          await writeAtomically(path.replace(/\.json$/i, '.info'), info);
          // OrcaSlicer only loads new presets when it starts.
          return {
            ref: { id: path, name, type, origin: 'user' as const },
            reloadRequired: 'restart' as const,
          };
        } catch (error) {
          throw isComparerError(error) ? error : toComparerError(error, path);
        }
      });
    },

    /**
     * Saves one user preset, under OrcaSlicer's lock: re-reads the file and refuses with
     * `conflict` if it changed, backs up the file and its .info, writes the new text atomically,
     * and marks the .info so OrcaSlicer uploads the edit to the cloud (see markPresetInfoForSync).
     */
    async saveDocument({ ref, text, previousText, batch }) {
      if (ref.origin !== 'user' || !ref.id.startsWith(userRoot + fs.separator)) {
        throw new ComparerError('unsupported', 'Only user presets can be saved.', ref.id);
      }
      const infoPath = ref.id.replace(/\.json$/i, '.info');
      return lock.withLock(async () => {
        try {
          const current = await fs.readText(ref.id);
          if (previousText !== undefined && current !== previousText) {
            throw new ComparerError(
              'conflict',
              `"${ref.name}" changed after it was opened.`,
              ref.id,
            );
          }
          const info = (await fs.exists(infoPath)) ? await fs.readText(infoPath) : undefined;

          const backupFolder = join(backupDir, folderName(batch ?? new Date().toISOString()));
          await backUp(ref.id, current, backupFolder);
          if (info !== undefined) await backUp(infoPath, info, backupFolder);

          await writeAtomically(ref.id, text);
          if (info !== undefined) {
            const marked = markPresetInfoForSync(info);
            if (marked !== info) await writeAtomically(infoPath, marked);
          }
          // OrcaSlicer keeps presets in memory; it only sees the change after a restart.
          return { ref, reloadRequired: 'restart' as const };
        } catch (error) {
          throw isComparerError(error) ? error : toComparerError(error, ref.id);
        }
      });
    },
  };

  /** Copies a file's current text into the backup folder, mirroring its path under dataDir. */
  async function backUp(path: string, text: string, backupFolder: string): Promise<void> {
    const relative = path.slice(dataDir.length + fs.separator.length);
    const target = join(backupFolder, relative);
    await fs.makeDirectory(parentOf(target));
    await fs.writeText(target, text);
  }

  /**
   * Writes through a temporary file in the same folder, then renames it over the original, so a
   * reader never sees a half-written file. Windows refuses the rename while another program
   * holds the file open, so it's retried. If it still fails, the text is written in place, as
   * OrcaSlicer does in the same situation; the backup was taken first.
   */
  async function writeAtomically(path: string, text: string): Promise<void> {
    const temp = `${path}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`;
    await fs.writeText(temp, text);
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temp, path);
        return;
      } catch {
        const delay = retryDelaysMs[attempt];
        if (delay === undefined) {
          await fs.remove(temp).catch(() => undefined);
          await fs.writeText(path, text);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}

/** A batch id (an ISO timestamp) as a folder name that's valid on every OS. */
function folderName(batch: string): string {
  return batch.replace(/[^A-Za-z0-9_-]/g, '-');
}

/** Maps file system failures to typed errors. Tauri reports them as plain strings. */
function toComparerError(error: unknown, path: string): ComparerError {
  const text = String(error);
  if (/not allowed|forbidden|denied|permission/i.test(text)) {
    return new ComparerError('access-denied', `Access to ${path} was denied.`, path);
  }
  if (/not found|no such file|cannot find|os error 2\b/i.test(text)) {
    return new ComparerError('not-found', `${path} doesn't exist.`, path);
  }
  return new ComparerError('host-error', text, path);
}
