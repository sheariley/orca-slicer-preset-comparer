// Prints a version's section of CHANGELOG.md, for the release workflow to use as the release notes.
// Fails when the changelog has no section for the version, or with --release, when the section
// isn't dated yet (so a tag can't be released with "Unreleased" notes).
//
// Usage:
//   node scripts/release-notes.mjs 0.1.0              prints the notes for 0.1.0
//   node scripts/release-notes.mjs 0.1.0 --release    also requires a date: "## [0.1.0] - 2026-10-20"
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const [version, ...args] = process.argv.slice(2);
if (!version) {
  console.error('Usage: node scripts/release-notes.mjs <version> [--release]');
  process.exit(1);
}

const lines = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
const heading = `## [${version}]`;
const start = lines.findIndex((line) => line.startsWith(heading));
if (start < 0) {
  console.error(`CHANGELOG.md has no "${heading}" section.`);
  process.exit(1);
}
if (args.includes('--release') && !/ - \d{4}-\d{2}-\d{2}\s*$/.test(lines[start])) {
  console.error(
    `CHANGELOG.md's "${heading}" section has no release date. Date it ("${heading} - YYYY-MM-DD") before tagging.`,
  );
  process.exit(1);
}
// The section runs to the next version heading, or to the link definitions at the end.
const end = lines.findIndex(
  (line, i) => i > start && (/^## /.test(line) || /^\[[^\]]+\]: /.test(line)),
);
const notes = lines
  .slice(start + 1, end < 0 ? undefined : end)
  .join('\n')
  .trim();
if (!notes) {
  console.error(`CHANGELOG.md's "${heading}" section is empty.`);
  process.exit(1);
}
console.log(notes);
