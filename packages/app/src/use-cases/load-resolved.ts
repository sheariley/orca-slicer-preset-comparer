import {
  ComparerError,
  includesOf,
  inheritsFrom,
  resolveChain,
  type IncludedTemplates,
  type PresetRef,
  type ProfileDocument,
  type ProfileRepository,
  type ResolvedProfile,
  type ResolveOptions,
} from '@comparer/core';

/** Deeper than any real OrcaSlicer chain; guards against runaway lookups. */
const MAX_CHAIN_DEPTH = 32;

/** Reads a preset and its ancestors through the repository: the raw documents, leaf first. */
export async function loadChain(
  repository: ProfileRepository,
  ref: PresetRef,
): Promise<ProfileDocument[]> {
  const chain: ProfileDocument[] = [];
  const visited = new Set<string>();
  let current: PresetRef | undefined = ref;

  while (current) {
    if (visited.has(current.id)) {
      throw new ComparerError(
        'inheritance-cycle',
        `Inheritance cycle at "${current.name}".`,
        current.name,
      );
    }
    if (chain.length >= MAX_CHAIN_DEPTH) {
      throw new ComparerError('invalid-profile', `Inheritance chain of "${ref.name}" is too deep.`);
    }
    visited.add(current.id);

    const document = await repository.readDocument(current);
    chain.push(document);

    const parentName = inheritsFrom(document);
    if (parentName === undefined) break;
    current = await repository.resolveParent(current, parentName);
    if (!current) {
      throw new ComparerError(
        'not-found',
        `"${document.ref.name}" inherits from "${parentName}", which wasn't found.`,
        parentName,
      );
    }
  }
  return chain;
}

/** A preset's inheritance chain (leaf first) and the templates its documents include. */
export interface PresetDocuments {
  readonly chain: readonly ProfileDocument[];
  readonly templates: IncludedTemplates;
}

/**
 * Reads the templates that `chain`'s documents include, each with its own chain, and any they
 * include in turn. Templates are looked up by name like parents are (`resolveParent`). One that
 * isn't found is left out: OrcaSlicer skips it too and loads the preset without it.
 */
export async function loadTemplates(
  repository: ProfileRepository,
  chain: readonly ProfileDocument[],
): Promise<IncludedTemplates> {
  const templates = new Map<string, readonly ProfileDocument[]>();
  const missing = new Set<string>();
  const queue = [...chain];
  for (let document = queue.shift(); document; document = queue.shift()) {
    for (const name of includesOf(document)) {
      if (templates.has(name) || missing.has(name)) continue;
      const ref = await repository.resolveParent(document.ref, name);
      if (!ref) {
        missing.add(name);
        continue;
      }
      const templateChain = await loadChain(repository, ref);
      templates.set(name, templateChain);
      queue.push(...templateChain);
    }
  }
  return templates;
}

/** Reads a preset's chain and the templates it includes. */
export async function loadPresetDocuments(
  repository: ProfileRepository,
  ref: PresetRef,
): Promise<PresetDocuments> {
  const chain = await loadChain(repository, ref);
  return { chain, templates: await loadTemplates(repository, chain) };
}

/**
 * Reads a preset, its ancestors, and the templates they include through the repository, then
 * resolves them in core with `options` (built-in defaults, legacy key migration, ...).
 */
export async function loadResolved(
  repository: ProfileRepository,
  ref: PresetRef,
  options: ResolveOptions = {},
): Promise<ResolvedProfile> {
  const { chain, templates } = await loadPresetDocuments(repository, ref);
  return resolveChain(chain, { ...options, templates });
}
