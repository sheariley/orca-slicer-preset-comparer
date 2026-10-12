// Where the extractor reads OrcaSlicer's sources from: GitHub (the default, at a branch, tag, or
// commit) or a local clone (for working offline, or against unpushed changes).
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface OrcaSource {
  /** The commit the files come from, when known. */
  readonly commit: string | null;
  /** Where they come from, for messages. */
  readonly description: string;
  /** Reads a file by its path in the OrcaSlicer repository (e.g. "src/libslic3r/Preset.cpp"). */
  read(file: string): Promise<string>;
}

export const ORCA_REPOSITORY = 'OrcaSlicer/OrcaSlicer';

/**
 * OrcaSlicer on GitHub at `ref`. The ref is resolved to a commit first, so every file comes
 * from the same one. Sends GITHUB_TOKEN when it's set (CI), which raises GitHub's rate limit.
 */
export async function githubSource(
  ref: string,
  token = process.env['GITHUB_TOKEN'],
  fetchImpl: typeof fetch = fetch,
): Promise<OrcaSource> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.sha',
    'User-Agent': 'orca-slicer-preset-comparer',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetchImpl(
    `https://api.github.com/repos/${ORCA_REPOSITORY}/commits/${encodeURIComponent(ref)}`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(
      `Couldn't resolve ${ORCA_REPOSITORY}@${ref}: ${response.status} ${response.statusText}`,
    );
  }
  const commit = (await response.text()).trim();
  return {
    commit,
    description: `${ORCA_REPOSITORY}@${ref} (${commit.slice(0, 12)})`,
    async read(file) {
      const url = `https://raw.githubusercontent.com/${ORCA_REPOSITORY}/${commit}/${file}`;
      const fileResponse = await fetchImpl(url, {
        headers: { 'User-Agent': 'orca-slicer-preset-comparer' },
      });
      if (!fileResponse.ok) {
        throw new Error(
          `Couldn't download ${file}: ${fileResponse.status} ${fileResponse.statusText}`,
        );
      }
      return fileResponse.text();
    },
  };
}

/** A local OrcaSlicer clone. */
export function localSource(dir: string): OrcaSource {
  return {
    commit: gitCommit(dir),
    description: dir,
    read: (file) => readFile(path.join(dir, ...file.split('/')), 'utf8'),
  };
}

function gitCommit(dir: string): string | null {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
