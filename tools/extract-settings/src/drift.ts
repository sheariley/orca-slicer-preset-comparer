// Compares a freshly extracted setting catalog with the committed one (`--check`), so a scheduled
// job can say what changed upstream in OrcaSlicer.

/** The parts of data/settings.json the comparison looks at. */
export interface CatalogShape {
  readonly source?: unknown;
  readonly presetTypes: Readonly<Record<string, readonly string[]>>;
  readonly variantKeys: Readonly<Record<string, readonly string[]>>;
  readonly legacy: {
    readonly obsolete: readonly string[];
    readonly renamed: Readonly<Record<string, string>>;
    readonly sourceHash?: string;
  };
  readonly settings: Readonly<Record<string, unknown>>;
}

/** How many names a line lists before "and N more". */
const LISTED = 15;

/**
 * What changed between the committed catalog and a new extraction, as lines of Markdown, or []
 * when nothing did. The source (OrcaSlicer's commit) is ignored: it changes on every extraction.
 */
export function describeDrift(committed: CatalogShape, extracted: CatalogShape): string[] {
  const lines: string[] = [];
  const list = (names: readonly string[]) =>
    names.length <= LISTED
      ? names.map((name) => `\`${name}\``).join(', ')
      : `${names
          .slice(0, LISTED)
          .map((name) => `\`${name}\``)
          .join(', ')}, and ${names.length - LISTED} more`;
  const compareLists = (what: string, before: readonly string[], after: readonly string[]) => {
    const added = after.filter((name) => !before.includes(name));
    const removed = before.filter((name) => !after.includes(name));
    if (added.length > 0) lines.push(`- ${what}: ${added.length} added (${list(added)})`);
    if (removed.length > 0) lines.push(`- ${what}: ${removed.length} removed (${list(removed)})`);
  };

  const beforeKeys = Object.keys(committed.settings);
  const afterKeys = Object.keys(extracted.settings);
  compareLists('Settings', beforeKeys, afterKeys);
  const changed = afterKeys.filter(
    (key) =>
      key in committed.settings &&
      JSON.stringify(committed.settings[key]) !== JSON.stringify(extracted.settings[key]),
  );
  if (changed.length > 0) {
    lines.push(`- Settings: ${changed.length} changed (${list(changed)})`);
  }
  for (const type of new Set([
    ...Object.keys(committed.presetTypes),
    ...Object.keys(extracted.presetTypes),
  ])) {
    compareLists(
      `Settings ${type} presets own`,
      committed.presetTypes[type] ?? [],
      extracted.presetTypes[type] ?? [],
    );
  }
  for (const type of new Set([
    ...Object.keys(committed.variantKeys),
    ...Object.keys(extracted.variantKeys),
  ])) {
    compareLists(
      `Per-variant ${type} settings`,
      committed.variantKeys[type] ?? [],
      extracted.variantKeys[type] ?? [],
    );
  }
  compareLists('Obsolete keys', committed.legacy.obsolete, extracted.legacy.obsolete);
  const renames = (renamed: Readonly<Record<string, string>>) =>
    Object.entries(renamed).map(([from, to]) => `${from} → ${to}`);
  compareLists(
    'Renamed keys',
    renames(committed.legacy.renamed),
    renames(extracted.legacy.renamed),
  );
  if (committed.legacy.sourceHash !== extracted.legacy.sourceHash) {
    lines.push(
      '- `PrintConfigDef::handle_legacy` changed: review its value rules against `packages/core/src/resolve/legacy-values.ts`, then update `LEGACY_VALUE_RULES_SOURCE_HASH`.',
    );
  }
  return lines;
}
