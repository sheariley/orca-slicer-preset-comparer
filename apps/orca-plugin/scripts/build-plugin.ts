// Assembles the single-file OrcaSlicer plugin: comparer_plugin.py with comparer_bridge.py and
// the built page (dist/web/index.html) inlined. Output: dist/orca_preset_comparer.py
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appDir = path.resolve(import.meta.dirname, '..');
const read = (...parts: string[]) => readFile(path.join(appDir, ...parts), 'utf8');

const [plugin, bridge, page] = await Promise.all([
  read('python', 'comparer_plugin.py'),
  read('python', 'comparer_bridge.py'),
  read('dist', 'web', 'index.html'),
]);

function replaceRegion(source: string, name: string, replacement: string): string {
  const pattern = new RegExp(`# build:begin-${name}\\n[\\s\\S]*?# build:end-${name}\\n`);
  if (!pattern.test(source)) throw new Error(`Missing "# build:begin-${name}" region.`);
  return source.replace(pattern, () => replacement);
}

const bridgeBody = bridge.replace(/^"""[\s\S]*?"""\n/, ''); // keeps the bridge's own imports
let output = replaceRegion(plugin, 'bridge', `# Inlined from comparer_bridge.py\n${bridgeBody}\n`);
output = replaceRegion(output, 'page', `PAGE_HTML = ${JSON.stringify(page)}\n`);

const target = path.join(appDir, 'dist', 'orca_preset_comparer.py');
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, output);
console.log(`Wrote ${path.relative(appDir, target)} (${Math.round(output.length / 1024)} KB)`);
