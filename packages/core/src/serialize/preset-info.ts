/**
 * OrcaSlicer's `.info` file, written next to every user preset (`Preset::save_info` in
 * Preset.cpp). It's an INI-style list of cloud-sync bookkeeping, one `key = value` per line:
 *
 *   sync_info = update        what the sync service should do next ("", create, update, ...)
 *   user_id = <account id>
 *   setting_id = <cloud id>
 *   base_id = <parent's id>
 *   updated_time = <epoch s>  compared with the cloud copy's time when pulling
 *
 * When OrcaSlicer saves an edited preset, it sets `sync_info` to "update" (Tab.cpp), which
 * queues the change for upload. A preset whose `.json` changes while its `.info` doesn't would
 * never be uploaded, and a newer cloud copy could later overwrite it, so the comparer marks it
 * the same way.
 */

/** The sync states that must survive an edit: a preset not created in the cloud yet stays "create". */
const KEEP: ReadonlySet<string> = new Set(['create', 'delete']);

/**
 * Marks a preset's `.info` text so OrcaSlicer uploads the edit: `sync_info` becomes "update"
 * unless it's "create" (not uploaded yet) or "delete". Every other byte is kept, including the
 * file's line endings. Returns the text unchanged when there's nothing to change.
 */
export function markPresetInfoForSync(infoText: string): string {
  const line = /^sync_info[ \t]*=[ \t]*(.*?)[ \t]*(\r?)$/m.exec(infoText);
  if (!line) {
    const newline = infoText.includes('\r\n') ? '\r\n' : '\n';
    return `sync_info = update${newline}${infoText}`;
  }
  if (KEEP.has(line[1]!) || line[1] === 'update') return infoText;
  return (
    infoText.slice(0, line.index) +
    `sync_info = update${line[2]}` +
    infoText.slice(line.index + line[0].length)
  );
}

export interface NewPresetInfo {
  /** The signed-in account's id (the user folder's name), or "" when signed out. */
  readonly userId: string;
  /** The parent's cloud id: its `setting_id`, or "" if it has none. */
  readonly baseId: string;
  readonly newline: '\n' | '\r\n';
}

/**
 * The `.info` of a preset created on this computer, as OrcaSlicer writes it when it saves a new
 * preset (`Preset::save_info` after `save_current_preset`): `sync_info = create` queues the
 * upload, there's no cloud id yet, and `updated_time = 0` until the sync service sets it.
 */
export function newPresetInfo({ userId, baseId, newline }: NewPresetInfo): string {
  return [
    'sync_info = create',
    `user_id = ${userId}`,
    'setting_id = ',
    `base_id = ${baseId}`,
    'updated_time = 0',
    '',
  ].join(newline);
}

/**
 * A vendor bundle's version (e.g. "02.08.00.12" in `<Vendor>.json`) the way OrcaSlicer writes
 * it into a preset's `version` key: `Semver::parse` folds a fourth part into the patch number
 * (patch × 100 + fourth), and `Semver::to_string` splits it back out, dropping leading zeros
 * ("2.8.0.12"). A three-part version "2.4.2" becomes "2.4.0.2". Undefined if it isn't a version.
 */
export function orcaPresetVersion(version: string): string | undefined {
  const match = /^(\d+)\.(\d+)(?:\.(\d+)(?:\.(\d+))?)?$/.exec(version.trim());
  if (!match) return undefined;
  const [, major, minor, third = '0', fourth] = match;
  const patch = fourth === undefined ? Number(third) : Number(third) * 100 + Number(fourth);
  return `${Number(major)}.${Number(minor)}.${Math.floor(patch / 100)}.${patch % 100}`;
}
