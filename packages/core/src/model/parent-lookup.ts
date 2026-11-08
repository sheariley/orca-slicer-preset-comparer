import type { PresetRef, ProfileType } from './profile.ts';

/**
 * How OrcaSlicer finds the preset another inherits from by name (`PresetCollection::find_preset`
 * and `find_preset2` in Preset.cpp), beyond an exact match:
 *
 * - **Renames:** a system preset renamed in a vendor update lists its old names in
 *   `renamed_from`, so presets that still name it by an old name find it (renames of renames
 *   too).
 * - **The library fallback:** a name containing "Generic" that matches nothing falls back to
 *   OrcaFilamentLibrary's preset for the material, "Generic <material> @System" (see
 *   libraryFallbackName). User presets made from a "My Generic PETG" that no longer exists load
 *   in OrcaSlicer this way.
 *
 * Hosts apply the renames in `resolveParent` (they know the system presets); the app layer applies
 * the library fallback, the same for every host.
 */

/** A preset to look up, with what's needed to choose among same-named ones. */
export interface NamedPreset {
  readonly ref: PresetRef;
}

/**
 * The old names a system preset lists in `renamed_from`: names separated by ";", each optionally
 * in double quotes with C-style escapes (OrcaSlicer's `unescape_strings_cstyle`), or an array.
 * A value OrcaSlicer can't parse is ignored, as OrcaSlicer ignores it.
 */
export function renamedFrom(content: Readonly<Record<string, unknown>>): string[] {
  const value = content['renamed_from'];
  if (Array.isArray(value)) return value.filter((name): name is string => typeof name === 'string');
  if (typeof value !== 'string') return [];
  return unescapeStrings(value) ?? [];
}

/** Port of OrcaSlicer's `unescape_strings_cstyle` (Config.cpp); undefined where it fails. */
function unescapeStrings(text: string): string[] | undefined {
  const names: string[] = [];
  const skipBlanks = (at: number) => {
    while (at < text.length && (text[at] === ' ' || text[at] === '\t')) at++;
    return at;
  };
  let i = skipBlanks(0);
  while (i < text.length) {
    let name = '';
    if (text[i] === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === '\\') {
          if (++i === text.length) return undefined;
          name += text[i] === 'r' ? '\r' : text[i] === 'n' ? '\n' : text[i];
        } else name += text[i];
      }
      if (i === text.length) return undefined;
      i++;
    } else {
      for (; i < text.length && text[i] !== ';'; i++) name += text[i];
    }
    names.push(name);
    i = skipBlanks(i);
    if (i === text.length) break;
    if (text[i] !== ';') return undefined;
    i = skipBlanks(i + 1);
  }
  return names.filter((name) => name !== '');
}

/** Old preset names, by type, mapped to the system presets that took them (see renamedFrom). */
export type PresetRenames = ReadonlyMap<string, string>;

const renameKey = (type: ProfileType, name: string) => `${type}\n${name}`;

/**
 * The renames that system presets record. OrcaSlicer keeps the first preset that claims an old
 * name (`update_map_system_profile_renamed`); user presets' `renamed_from` is ignored.
 */
export function presetRenames(
  presets: readonly {
    readonly ref: PresetRef;
    readonly content: Readonly<Record<string, unknown>>;
  }[],
): PresetRenames {
  const renames = new Map<string, string>();
  for (const { ref, content } of presets) {
    if (ref.origin !== 'system') continue;
    for (const old of renamedFrom(content)) {
      const key = renameKey(ref.type, old);
      if (!renames.has(key)) renames.set(key, ref.name);
    }
  }
  return renames;
}

// OrcaSlicer's pattern, unchanged: an optional prefix ending in "_", then "Generic", the material,
// and an optional "@..." suffix.
const LIBRARY_FALLBACK = /^(?:.*?\b(?:\w+_)?)(Generic)\b\s+([^@]+?)\s*(?:@.*)?$/;

/**
 * The OrcaFilamentLibrary preset OrcaSlicer falls back to when no preset is named `name`:
 * "My Generic PETG" and "Generic PETG @BBL X1C" both become "Generic PETG @System". Undefined for
 * names without "Generic", or that already are the fallback.
 */
export function libraryFallbackName(name: string): string | undefined {
  if (!name.includes('Generic')) return undefined;
  const fallback = name.replace(LIBRARY_FALLBACK, 'Generic $2 @System');
  return fallback === name ? undefined : fallback;
}

/**
 * Chooses the parent among presets with the right name: in the child's own user folder first
 * (OrcaSlicer loads one user folder at a time), then a system preset of the child's vendor, then
 * any system preset.
 */
export function chooseParent<T extends NamedPreset>(
  child: PresetRef,
  candidates: readonly T[],
): T | undefined {
  const others = candidates.filter(({ ref }) => ref.id !== child.id && ref.type === child.type);
  return (
    // Hosts with one user folder leave `folder` unset on both.
    others.find(
      ({ ref }) => child.origin === 'user' && ref.origin === 'user' && ref.folder === child.folder,
    ) ??
    others.find(({ ref }) => ref.origin === 'system' && ref.vendor === child.vendor) ??
    others.find(({ ref }) => ref.origin === 'system')
  );
}

/**
 * Finds the preset `child` names by `name` (see chooseParent), or failing that, the system preset
 * renamed from it (following renames of renames). `named` lists the presets with a given name.
 */
export function findNamedPreset<T extends NamedPreset>(
  child: PresetRef,
  name: string,
  named: (name: string) => readonly T[],
  renames: PresetRenames,
): T | undefined {
  const seen = new Set<string>();
  for (
    let current: string | undefined = name;
    current !== undefined && !seen.has(current);
    current = renames.get(renameKey(child.type, current))
  ) {
    seen.add(current);
    const found = chooseParent(child, named(current));
    if (found) return found;
  }
  return undefined;
}
