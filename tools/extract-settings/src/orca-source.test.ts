import { describe, expect, it } from 'vitest';
import { githubSource } from './orca-source.ts';

/** A fetch that answers from a map of URL → body, and records what it was asked. */
function fakeFetch(responses: Record<string, string>) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const body = responses[url];
    return body === undefined
      ? new Response('missing', { status: 404, statusText: 'Not Found' })
      : new Response(body);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe('githubSource', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567';

  it('resolves the ref to a commit, then reads every file at that commit', async () => {
    const { fetchImpl, requests } = fakeFetch({
      'https://api.github.com/repos/OrcaSlicer/OrcaSlicer/commits/main': `${commit}\n`,
      [`https://raw.githubusercontent.com/OrcaSlicer/OrcaSlicer/${commit}/src/libslic3r/Preset.cpp`]:
        'preset source',
    });
    const source = await githubSource('main', 'token', fetchImpl);

    expect(source.commit).toBe(commit);
    expect(source.description).toBe('OrcaSlicer/OrcaSlicer@main (0123456789ab)');
    expect(await source.read('src/libslic3r/Preset.cpp')).toBe('preset source');
    expect(requests[0]!.headers['Authorization']).toBe('Bearer token');
  });

  it('says what failed when a ref or file is missing', async () => {
    const { fetchImpl } = fakeFetch({
      'https://api.github.com/repos/OrcaSlicer/OrcaSlicer/commits/main': commit,
    });

    await expect(githubSource('nope', undefined, fetchImpl)).rejects.toThrow(
      "Couldn't resolve OrcaSlicer/OrcaSlicer@nope: 404 Not Found",
    );
    const source = await githubSource('main', undefined, fetchImpl);
    await expect(source.read('src/missing.cpp')).rejects.toThrow(
      "Couldn't download src/missing.cpp",
    );
  });
});
