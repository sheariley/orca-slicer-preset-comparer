// Loads the profile fixtures as ProfileDocuments. Test-only: uses Node's file system.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProfileDocument, ProfileType } from '../src/index.ts';

export const fixturesDir = path.join(import.meta.dirname, 'fixtures');

/** Loads every fixture. Ids are paths relative to the fixtures folder, with forward slashes. */
export function loadFixtureDocuments(): ProfileDocument[] {
  return readdirSync(fixturesDir, { recursive: true, encoding: 'utf8' })
    .map((relative) => relative.split(path.sep).join('/'))
    .filter((relative) => relative.endsWith('.json'))
    .sort()
    .map(fixtureDocument);
}

function fixtureDocument(id: string): ProfileDocument {
  // system/<vendor>/<type>/<file> or user/<user_id>/<type>/<file>
  const [origin, owner, type] = id.split('/');
  const content = JSON.parse(readFileSync(path.join(fixturesDir, id), 'utf8')) as Record<
    string,
    unknown
  >;
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

/** Builds the leaf-first inheritance chain for a preset name from the given documents. */
export function chainFor(documents: readonly ProfileDocument[], name: string): ProfileDocument[] {
  const chain: ProfileDocument[] = [];
  let current = documents.find((document) => document.ref.name === name);
  while (current) {
    chain.push(current);
    const parent = current.content['inherits'];
    current =
      typeof parent === 'string'
        ? documents.find((document) => document.ref.name === parent)
        : undefined;
  }
  return chain;
}
