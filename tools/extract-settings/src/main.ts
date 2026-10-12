// Generates packages/setting-catalog/data/settings.json from OrcaSlicer's sources: each
// setting's label, group, tooltip, unit, built-in default, enum labels, and where OrcaSlicer's
// settings tabs show it, plus which settings belong to filament and process presets.
//
// Usage: pnpm extract-settings [--ref <branch, tag, or commit>] [--orca <path>] [--check] [--verbose]
//   By default it reads OrcaSlicer on GitHub at `main` (--ref picks another). --orca <path> (or
//   the ORCASLICER_DIR env variable) reads a local clone instead.
//   --check writes nothing: it compares the extraction with the committed catalog, prints what
//   changed (also to $GITHUB_STEP_SUMMARY in CI), and exits with 1 if anything did.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { describeDrift, type CatalogShape } from './drift.ts';
import { githubSource, localSource, ORCA_REPOSITORY } from './orca-source.ts';
import {
  parseConstants,
  parseEnumKeys,
  parseLegacyKeys,
  parsePresetOptionLists,
  parsePrintConfig,
  parseVariantKeys,
} from './parse-print-config.ts';
import { parseTabSections } from './parse-tab.ts';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const { values } = parseArgs({
  options: {
    ref: { type: 'string', default: 'main' },
    orca: { type: 'string' },
    check: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
  },
});
const localDir = values.orca ?? process.env['ORCASLICER_DIR'];
const orca = localDir ? localSource(path.resolve(localDir)) : await githubSource(values.ref);
console.log(`Reading ${orca.description}`);

const [printConfig, constants, preset, tab] = await Promise.all([
  orca.read('src/libslic3r/PrintConfig.cpp'),
  orca.read('src/libslic3r/PrintConfigConstants.hpp'),
  orca.read('src/libslic3r/Preset.cpp'),
  orca.read('src/slic3r/GUI/Tab.cpp'),
]);

const { settings, skippedDefaults } = parsePrintConfig(printConfig, {
  enumKeys: parseEnumKeys(printConfig),
  constants: parseConstants(constants),
});
const presetTypes = parsePresetOptionLists(preset);
const { skippedRules, ...legacy } = parseLegacyKeys(printConfig);
const variantKeys = parseVariantKeys(printConfig);
// Where OrcaSlicer's settings tabs show each setting, per preset type.
const sections = parseTabSections(tab, new Set(settings.keys()));
for (const type of ['filament', 'process'] as const) {
  for (const [key, section] of sections[type]) {
    const setting = settings.get(key)!;
    setting.sections = { ...setting.sections, [type]: section };
  }
}

const output = {
  source: { repository: ORCA_REPOSITORY, commit: orca.commit },
  presetTypes,
  variantKeys,
  legacy,
  settings: Object.fromEntries([...settings].sort(([a], [b]) => a.localeCompare(b))),
};

const target = path.join(repoRoot, 'packages', 'setting-catalog', 'data', 'settings.json');
if (values.check) {
  const committed = JSON.parse(await readFile(target, 'utf8')) as CatalogShape;
  const drift = describeDrift(committed, output);
  const heading = drift.length
    ? `The setting catalog is out of date with ${orca.description}. Run \`pnpm extract-settings\` and review:`
    : `The setting catalog is up to date with ${orca.description}.`;
  const report = [heading, ...drift].join('\n');
  console.log(report);
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) await appendFile(summary, `${report}\n`);
  process.exit(drift.length ? 1 : 0);
}
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(output, null, 2)}\n`);

const withDefaults = [...settings.values()].filter((setting) => setting.default !== undefined);
console.log(`Wrote ${settings.size} settings to ${path.relative(repoRoot, target)}`);
console.log(`  ${withDefaults.length} with defaults, ${skippedDefaults.length} defaults skipped`);
console.log(
  `  ${presetTypes.process.length} process keys, ${presetTypes.filament.length} filament keys`,
);
console.log(
  `  ${variantKeys.process.length} process and ${variantKeys.filament.length} filament per-variant keys`,
);
const placed = (type: 'filament' | 'process') =>
  presetTypes[type].filter((key) => sections[type].has(key)).length;
console.log(
  `  ${placed('process')} of ${presetTypes.process.length} process and ${placed('filament')} of ` +
    `${presetTypes.filament.length} filament keys placed in OrcaSlicer's tab sections`,
);
const enums = [...settings.values()].filter((setting) => setting.enumLabels).length;
console.log(`  ${enums} settings with enum labels`);
console.log(
  `  ${legacy.obsolete.length} obsolete keys, ${Object.keys(legacy.renamed).length} renames, ` +
    `${skippedRules} legacy rules ported by hand (core/resolve/legacy-values.ts)`,
);
for (const { key, reason } of values.verbose ? skippedDefaults : []) {
  console.log(`  skipped ${key}: ${reason}`);
}
