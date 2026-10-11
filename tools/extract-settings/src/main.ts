// Generates packages/setting-catalog/data/settings.json from a local OrcaSlicer clone: each
// setting's label, group, tooltip, unit, built-in default, enum labels, and where OrcaSlicer's
// settings tabs show it, plus which settings belong to filament and process presets.
//
// Usage: pnpm extract-settings [--orca <path to OrcaSlicer clone>] [--verbose]
// The clone defaults to ../OrcaSlicer next to this repo, or the ORCASLICER_DIR env variable.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
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
  options: { orca: { type: 'string' }, verbose: { type: 'boolean', default: false } },
});
const orcaDir = path.resolve(
  values.orca ?? process.env['ORCASLICER_DIR'] ?? path.join(repoRoot, '..', 'OrcaSlicer'),
);
const libslic3r = (file: string) => readFile(path.join(orcaDir, 'src', 'libslic3r', file), 'utf8');

const [printConfig, constants, preset, tab] = await Promise.all([
  libslic3r('PrintConfig.cpp'),
  libslic3r('PrintConfigConstants.hpp'),
  libslic3r('Preset.cpp'),
  readFile(path.join(orcaDir, 'src', 'slic3r', 'GUI', 'Tab.cpp'), 'utf8'),
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
  source: { repository: 'OrcaSlicer/OrcaSlicer', commit: gitCommit(orcaDir) },
  presetTypes,
  variantKeys,
  legacy,
  settings: Object.fromEntries([...settings].sort(([a], [b]) => a.localeCompare(b))),
};

const target = path.join(repoRoot, 'packages', 'setting-catalog', 'data', 'settings.json');
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

function gitCommit(dir: string): string | null {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
