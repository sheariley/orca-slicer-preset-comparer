// Extracts setting metadata from OrcaSlicer's sources.
//
// PrintConfig.cpp defines each option as:
//   def = this->add("key", coType);
//   def->label = L("Label");
//   def->tooltip = L("Line one "
//                    "line two");
//   def->sidetext = L(u8"mm³/s");
//   def->set_default_value(new ConfigOptionFloats { 2. });
// Only literal keys are extracted; options added in loops with computed keys are skipped.
import {
  parseDefault,
  UnsupportedDefault,
  unescapeC,
  type DefaultValue,
  type DefaultsContext,
} from './parse-defaults.ts';

/** Where a setting appears in OrcaSlicer's settings UI: a tab page and an option group on it. */
export interface Section {
  readonly page: string;
  readonly group: string;
  /** The section's position among its preset type's sections, in OrcaSlicer's order. */
  readonly order: number;
}

export interface ExtractedSetting {
  label?: string;
  fullLabel?: string;
  category?: string;
  tooltip?: string;
  unit?: string;
  default?: DefaultValue;
  /** The values an option offers (`enum_values`) and their labels (`enum_labels`), in order. */
  enumValues?: string[];
  enumLabels?: string[];
  /** Where OrcaSlicer's settings tabs show it, per preset type (see parse-tab.ts). */
  sections?: Partial<Record<'filament' | 'process', Section>>;
}

export interface SkippedDefault {
  readonly key: string;
  readonly reason: string;
}

export interface PrintConfigResult {
  readonly settings: Map<string, ExtractedSetting>;
  /** Options whose default couldn't be parsed (e.g. copied from another option at runtime). */
  readonly skippedDefaults: readonly SkippedDefault[];
}

const ADD_PATTERN = /this->add(?:_nullable)?\(\s*"([A-Za-z0-9_]+)"\s*,\s*co[A-Za-z]+\s*\)/g;
const FIELD_PATTERN = /def->(label|full_label|category|tooltip|sidetext)\s*=/g;
const DEFAULT_PATTERN = /def->set_default_value\s*(?=\()/g;

const FIELD_NAMES: Record<string, 'label' | 'fullLabel' | 'category' | 'tooltip' | 'unit'> = {
  label: 'label',
  full_label: 'fullLabel',
  category: 'category',
  tooltip: 'tooltip',
  sidetext: 'unit',
};

export function parsePrintConfig(source: string, context: DefaultsContext): PrintConfigResult {
  // Commented-out definitions (retired options) must not become settings.
  const code = stripComments(source);
  const settings = new Map<string, ExtractedSetting>();
  const skippedDefaults: SkippedDefault[] = [];
  const adds = [...code.matchAll(ADD_PATTERN)];
  // Options that copy another's enum lists name it by a variable:
  //   auto def_top_fill_pattern = def = this->add("top_surface_pattern", coEnum);
  //   def->enum_values = def_top_fill_pattern->enum_values;
  const keysByVariable = new Map(
    [...code.matchAll(/auto\s+(\w+)\s*=\s*def\s*=\s*this->add(?:_nullable)?\(\s*"(\w+)"/g)].map(
      (match) => [match[1]!, match[2]!],
    ),
  );
  const copiedEnums: { key: string; from: string; list: 'enumValues' | 'enumLabels' }[] = [];

  adds.forEach((match, index) => {
    const key = match[1]!;
    // A key can be added more than once (e.g. per printer technology); keep the first.
    if (settings.has(key)) return;
    const start = match.index + match[0].length;
    const end = adds[index + 1]?.index ?? code.length;
    const block = code.slice(start, end);
    const setting: ExtractedSetting = {};

    for (const field of block.matchAll(FIELD_PATTERN)) {
      const statement = readStatement(block, field.index + field[0].length);
      const value = firstStringArgument(statement);
      if (value !== undefined && value.length > 0) setting[FIELD_NAMES[field[1]!]!] = value;
    }

    for (const list of ['enumValues', 'enumLabels'] as const) {
      const field = list === 'enumValues' ? 'enum_values' : 'enum_labels';
      const items = [
        ...block.matchAll(new RegExp(`def->${field}\\.(?:push_back|emplace_back)\\s*(?=\\()`, 'g')),
      ].flatMap(
        (call) => firstStringArgument(readStatement(block, call.index + call[0].length)) ?? [],
      );
      if (items.length > 0) setting[list] = items;
      const copy = new RegExp(`def->${field}\\s*=\\s*(\\w+)->${field}`).exec(block);
      const from = copy && keysByVariable.get(copy[1]!);
      if (from) copiedEnums.push({ key, from, list });
    }

    const defaultCall = DEFAULT_PATTERN.exec(block);
    DEFAULT_PATTERN.lastIndex = 0;
    if (defaultCall) {
      const call = readStatement(block, defaultCall.index + defaultCall[0].length);
      const expression = call.trim().replace(/^\(([\s\S]*)\)$/, '$1');
      try {
        setting.default = parseDefault(expression, context);
      } catch (error) {
        if (!(error instanceof UnsupportedDefault)) throw error;
        skippedDefaults.push({ key, reason: error.message });
      }
    }

    settings.set(key, setting);
  });

  // Options defined in a loop over literal keys:
  //   for (const char* key : {"a", "b"}) { def = this->add(key, coString); def->label = ...; }
  for (const loop of code.matchAll(
    /for\s*\(\s*const\s+char\s*\*\s*(\w+)\s*:\s*\{([^}]*)\}\s*\)\s*\{\s*def\s*=\s*this->add(?:_nullable)?\(\s*\1\s*,/g,
  )) {
    const block = code.slice(loop.index + loop[0].length, code.indexOf('\n    }', loop.index));
    for (const [, key] of loop[2]!.matchAll(/"(\w+)"/g)) {
      if (settings.has(key!)) continue;
      const setting: ExtractedSetting = {};
      for (const field of block.matchAll(FIELD_PATTERN)) {
        const value = firstStringArgument(readStatement(block, field.index + field[0].length));
        if (value !== undefined && value.length > 0) setting[FIELD_NAMES[field[1]!]!] = value;
      }
      settings.set(key!, setting);
    }
  }

  for (const { key, from, list } of copiedEnums) {
    const items = settings.get(from)?.[list];
    if (items) settings.get(key)![list] = [...items];
  }

  // Filament overrides of printer settings (filament_retraction_length overrides
  // retraction_length, ...) are added in a loop that copies the printer setting's label,
  // tooltip, unit, and default.
  for (const key of filamentOverrideKeys(code)) {
    const base = settings.get(key.slice('filament_'.length));
    if (base && !settings.has(key)) settings.set(key, { ...base });
  }

  return { settings, skippedDefaults };
}

function filamentOverrideKeys(source: string): string[] {
  const match = /filament_extruder_override_keys\s*=\s*\{([\s\S]*?)\};/.exec(source);
  return match ? [...match[1]!.matchAll(/"(filament_\w+)"/g)].map((key) => key[1]!) : [];
}

/**
 * Reads the sets of settings stored once per extruder variant (`print_options_with_variant`,
 * `filament_options_with_variant`). OrcaSlicer resizes these arrays to the length of the
 * preset's own variant list (`extend_default_config_length` in Preset.cpp).
 */
export function parseVariantKeys(source: string): { process: string[]; filament: string[] } {
  const code = stripComments(source);
  const set = (name: string) => {
    const match = new RegExp(`std::set<std::string>\\s+${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`).exec(
      code,
    );
    if (!match) throw new Error(`PrintConfig.cpp has no ${name} set.`);
    return [...match[1]!.matchAll(/"(\w+)"/g)].map((key) => key[1]!);
  };
  return {
    process: set('print_options_with_variant'),
    filament: set('filament_options_with_variant'),
  };
}

export interface LegacyKeys {
  /** Keys OrcaSlicer discards when it loads a preset. */
  readonly obsolete: string[];
  /** Old key → current key, for renames that don't also rewrite the value. */
  readonly renamed: Record<string, string>;
  /** handle_legacy branches not extracted (value rewrites, conditions on the value, ...). */
  readonly skippedRules: number;
}

/**
 * Reads PrintConfigDef::handle_legacy, which OrcaSlicer applies to every key it loads: the
 * `ignore` set of obsolete keys, and the if/else-if chain of renames. Only branches whose
 * condition tests nothing but the key, and whose body only assigns the new key, are taken.
 */
export function parseLegacyKeys(source: string): LegacyKeys {
  const code = stripComments(source);
  const start = code.indexOf('void PrintConfigDef::handle_legacy(');
  if (start < 0) throw new Error('PrintConfig.cpp has no PrintConfigDef::handle_legacy.');
  const body = code.slice(start, code.indexOf('\n}', start));

  const ignore = /static\s+std::set<std::string>\s+ignore\s*=\s*\{([\s\S]*?)\};/.exec(body);
  const obsolete = ignore ? [...ignore[1]!.matchAll(/"(\w+)"/g)].map((key) => key[1]!) : [];

  const renamed: Record<string, string> = {};
  let skippedRules = 0;
  const chain = ignore ? body.slice(0, ignore.index) : body;
  for (const branch of chain.matchAll(/\bif\s*\(([^{};]*?)\)\s*\{([^{}]*)\}/g)) {
    const [, condition, block] = branch as unknown as [string, string, string];
    const oldKeys = [...condition.matchAll(/opt_key\s*==\s*"(\w+)"/g)].map((key) => key[1]!);
    const keyOnly = condition.replace(/opt_key\s*==\s*"\w+"|\|\||[()\s]/g, '') === '';
    const assignment = /^\s*opt_key\s*=\s*"(\w+)"\s*;\s*$/.exec(block);
    if (oldKeys.length > 0 && keyOnly && assignment) {
      for (const oldKey of oldKeys) renamed[oldKey] = assignment[1]!;
    } else if (/opt_key|value/.test(condition)) {
      skippedRules++;
    }
  }
  return { obsolete, renamed, skippedRules };
}

/**
 * Reads the enum tables (`static t_config_enum_values s_keys_map_PrintSequence { { "by layer",
 * int(PrintSequence::ByLayer) }, ... }`) into a map from enum constant to the key OrcaSlicer
 * serializes. Constants are keyed both qualified (`PrintSequence::ByLayer`) and bare
 * (`ByLayer`); a bare name that appears in more than one enum (e.g. `Default`) is left out.
 */
export function parseEnumKeys(source: string): Map<string, string> {
  const code = stripComments(source);
  const keys = new Map<string, string>();
  const bare = new Map<string, string | null>();
  for (const table of code.matchAll(/s_keys_map_(\w+)\s*=?\s*\{([\s\S]*?)\};/g)) {
    const enumName = table[1]!;
    const pairs = table[2]!.matchAll(
      /\{\s*"((?:[^"\\]|\\.)*)"\s*,\s*(?:int\s*\(\s*)?(?:(\w+)\s*::\s*)?(\w+)\s*\)?\s*\}/g,
    );
    for (const [, key, scope, constant] of pairs) {
      const value = unescapeC(key!);
      keys.set(`${scope ?? enumName}::${constant}`, value);
      bare.set(constant!, bare.has(constant!) && bare.get(constant!) !== value ? null : value);
    }
  }
  for (const [constant, value] of bare)
    if (value !== null && !keys.has(constant)) keys.set(constant, value);
  return keys;
}

/** Reads `#define NAME value` constants whose value is a number or a boolean. */
export function parseConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(
    /^#define\s+([A-Z_][A-Z0-9_]*)\s+(true|false|-?[\d.]+(?:e-?\d+)?f?)\s*$/gim,
  )) {
    constants.set(match[1]!, match[2]!.replace(/f$/i, ''));
  }
  return constants;
}

/**
 * Reads the key lists in Preset.cpp that decide which settings belong to each preset type
 * (and so which defaults a root preset of that type starts from).
 */
export function parsePresetOptionLists(source: string): { process: string[]; filament: string[] } {
  const list = (name: string) => {
    const match = new RegExp(`static std::vector<std::string> ${name}\\s*\\{([\\s\\S]*?)\\};`).exec(
      source,
    );
    if (!match) throw new Error(`Preset.cpp has no ${name} list.`);
    return [...stripComments(match[1]!).matchAll(/"([A-Za-z0-9_]+)"/g)].map((key) => key[1]!);
  };
  return { process: list('s_Preset_print_options'), filament: list('s_Preset_filament_options') };
}

/** Reads from `from` to the statement's terminating semicolon, skipping string literals. */
function readStatement(text: string, from: number): string {
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === ';') {
      return text.slice(from, i);
    }
  }
  return text.slice(from);
}

/** Removes // and /* *\/ comments that aren't inside string literals. */
export function stripComments(text: string): string {
  let output = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      const end = /"(?:[^"\\]|\\.)*"/y;
      end.lastIndex = i;
      const literal = end.exec(text)?.[0] ?? char;
      output += literal;
      i += literal.length - 1;
    } else if (text.startsWith('//', i)) {
      const newline = text.indexOf('\n', i);
      i = newline < 0 ? text.length : newline - 1;
    } else if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? text.length : close + 1;
    } else {
      output += char;
    }
  }
  return output;
}

/**
 * Returns the first string argument, joining adjacent literals ("a" "b") the way C++ does.
 * For L_CONTEXT("s", "second") that's "s".
 */
function firstStringArgument(statement: string): string | undefined {
  const run = /(?:(?:u8)?"(?:[^"\\]|\\.)*"\s*)+/.exec(statement);
  if (!run) return undefined;
  return [...run[0].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => unescapeC(match[1]!)).join('');
}
