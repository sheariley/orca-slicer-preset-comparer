import type { PresetDetails, PresetRef } from './profile.ts';

/** A preset and its own file's content, as hosts list them. */
export interface ListedPreset {
  readonly ref: PresetRef;
  readonly content: Readonly<Record<string, unknown>>;
}

/**
 * Adds listing details to every preset (see PresetDetails), from the presets' own files: each
 * follows its `inherits` chain within `presets`, by name. Parents are looked up the way hosts
 * resolve them: in the child's own user folder first, then among system presets of its vendor,
 * then any preset of the type with that name.
 */
export function presetDetails(presets: readonly ListedPreset[]): PresetRef[] {
  const byName = new Map<string, ListedPreset[]>();
  for (const preset of presets) {
    const key = `${preset.ref.type}\n${preset.ref.name}`;
    byName.set(key, [...(byName.get(key) ?? []), preset]);
  }
  const parentOf = ({ ref, content }: ListedPreset): ListedPreset | undefined => {
    const name = typeof content.inherits === 'string' ? content.inherits : '';
    if (name === '') return undefined;
    const candidates = (byName.get(`${ref.type}\n${name}`) ?? []).filter(
      (candidate) => candidate.ref.id !== ref.id,
    );
    return (
      candidates.find(
        (candidate) => candidate.ref.origin === 'user' && candidate.ref.folder === ref.folder,
      ) ??
      candidates.find(
        (candidate) => candidate.ref.origin === 'system' && candidate.ref.vendor === ref.vendor,
      ) ??
      candidates.find((candidate) => candidate.ref.origin === 'system') ??
      candidates[0]
    );
  };
  /** The preset and its parents, leaf first; stops at a missing parent or a cycle. */
  const chainOf = (preset: ListedPreset): ListedPreset[] => {
    const chain = [preset];
    for (let parent = parentOf(preset); parent; parent = parentOf(parent)) {
      if (chain.includes(parent)) break;
      chain.push(parent);
    }
    return chain;
  };

  return presets.map((preset) => {
    const chain = chainOf(preset);
    const owner = chain.find(({ content }) => 'compatible_printers' in content);
    const system = chain.find(({ ref }) => ref.origin === 'system');
    const vendor = system?.ref.vendor;
    const details: PresetDetails = {
      // OrcaSlicer lists every user preset; it skips system presets marked as templates.
      selectable: preset.ref.origin !== 'system' || preset.content.instantiation !== 'false',
      printers: owner ? printerList(owner.content.compatible_printers) : [],
      ...(vendor ? { vendor } : {}),
    };
    return { ...preset.ref, details };
  });
}

function printerList(value: unknown): string[] {
  const names = Array.isArray(value) ? value : typeof value === 'string' ? value.split(';') : [];
  return names.filter((name): name is string => typeof name === 'string' && name.trim() !== '');
}

/** How many files a details lister reads at once. */
const READ_BATCH = 32;

/**
 * For hosts that list presets by file: returns a function that reads each listed preset's own
 * content (with `readContent`, a batch at a time) and adds its details (presetDetails). System
 * presets only change when OrcaSlicer updates them, so their content is read once per lister. A
 * file that can't be read or parsed lists without content: selectable, for any printer.
 */
export function createDetailsLister(
  readContent: (ref: PresetRef) => Promise<unknown>,
): (refs: readonly PresetRef[]) => Promise<PresetRef[]> {
  const systemContent = new Map<string, Readonly<Record<string, unknown>>>();
  const read = async (ref: PresetRef): Promise<ListedPreset> => {
    const cached = systemContent.get(ref.id);
    if (cached) return { ref, content: cached };
    let content: Readonly<Record<string, unknown>> = {};
    try {
      const value = await readContent(ref);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        content = value as Record<string, unknown>;
      }
    } catch {
      // Listed without details; opening the preset reports the problem.
    }
    if (ref.origin === 'system') systemContent.set(ref.id, content);
    return { ref, content };
  };
  return async (refs) => {
    const listed: ListedPreset[] = [];
    for (let start = 0; start < refs.length; start += READ_BATCH) {
      listed.push(...(await Promise.all(refs.slice(start, start + READ_BATCH).map(read))));
    }
    return presetDetails(listed);
  };
}
