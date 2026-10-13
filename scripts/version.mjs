// One version for the whole app (the root package.json is the source): sets it everywhere it's
// written, or checks they all agree.
//
// Usage:
//   pnpm set-version 0.2.0          writes 0.2.0 into every file below
//   pnpm check-version              fails if the files disagree (CI runs this)
//   pnpm check-version --tag v0.2.0 also fails unless the tag matches (for release builds)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

/** Each file that carries the version, and how to find it there (the first match). */
const LOCATIONS = [
  { file: 'package.json', pattern: /("version":\s*")([^"]+)(")/ },
  { file: 'apps/desktop/package.json', pattern: /("version":\s*")([^"]+)(")/ },
  { file: 'apps/desktop/src-tauri/tauri.conf.json', pattern: /("version":\s*")([^"]+)(")/ },
  {
    file: 'apps/desktop/src-tauri/Cargo.toml',
    pattern: /(\[package\][^[]*?\nversion\s*=\s*")([^"]+)(")/,
  },
  {
    file: 'apps/desktop/src-tauri/Cargo.lock',
    pattern: /(name = "comparer-desktop"\nversion = ")([^"]+)(")/,
  },
  { file: 'apps/orca-plugin/package.json', pattern: /("version":\s*")([^"]+)(")/ },
  // The plugin's PEP 723 header, which OrcaSlicer shows in its Plugins dialog.
  { file: 'apps/orca-plugin/python/comparer_plugin.py', pattern: /(^# version = ")([^"]+)(")/m },
];

const read = (file) => readFileSync(path.join(root, file), 'utf8');
const versionIn = ({ file, pattern }) => {
  const match = pattern.exec(read(file));
  if (!match) throw new Error(`No version found in ${file}.`);
  return match[2];
};

const [command, ...args] = process.argv.slice(2);

if (command === 'set') {
  const version = args[0];
  if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error('Usage: pnpm set-version <major.minor.patch>, e.g. 0.2.0 or 0.2.0-beta.1');
    process.exit(1);
  }
  for (const location of LOCATIONS) {
    const text = read(location.file);
    if (!location.pattern.test(text)) throw new Error(`No version found in ${location.file}.`);
    writeFileSync(
      path.join(root, location.file),
      text.replace(location.pattern, (_, before, _old, after) => `${before}${version}${after}`),
    );
  }
  console.log(`Set version ${version} in ${LOCATIONS.length} files.`);
} else if (command === 'check') {
  const expected = versionIn(LOCATIONS[0]);
  const problems = LOCATIONS.slice(1)
    .map((location) => ({ file: location.file, version: versionIn(location) }))
    .filter(({ version }) => version !== expected)
    .map(({ file, version }) => `${file} has ${version}, not ${expected}`);
  const tagIndex = args.indexOf('--tag');
  if (tagIndex >= 0) {
    const tag = args[tagIndex + 1];
    if (tag !== `v${expected}`)
      problems.push(`The tag is ${tag}, but the version is ${expected} (expected v${expected})`);
  }
  if (problems.length > 0) {
    console.error(`Versions disagree:\n  ${problems.join('\n  ')}`);
    console.error(`Run pnpm set-version <version> to set one version everywhere.`);
    process.exit(1);
  }
  console.log(`Version ${expected} everywhere (${LOCATIONS.length} files).`);
} else {
  console.error('Usage: node scripts/version.mjs set <version> | check [--tag v<version>]');
  process.exit(1);
}
