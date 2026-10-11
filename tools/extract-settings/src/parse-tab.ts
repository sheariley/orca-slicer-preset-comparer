// Extracts where OrcaSlicer's settings UI shows each setting, from src/slic3r/GUI/Tab.cpp:
//   auto page = add_options_page(L("Quality"), "...");
//       auto optgroup = page->new_optgroup(L("Layer height"), L"...");
//       optgroup->append_single_option_line("layer_height", "...");
// A setting belongs to the page and option group in effect where its key first appears as a
// string literal in the tab's build functions (append_single_option_line, get_option, or a
// literal list a loop walks over).
import { stripComments, type Section } from './parse-print-config.ts';

/** The functions that build each preset type's settings tab. */
const BUILD_FUNCTIONS = {
  process: ['TabPrint::build'],
  filament: ['TabFilament::build', 'TabFilament::add_filament_overrides_page'],
} as const;

/**
 * Maps each setting key to its section, per preset type. Only keys in `known` count, so help
 * anchors and other strings that aren't setting keys are ignored.
 */
export function parseTabSections(
  source: string,
  known: ReadonlySet<string>,
): { process: Map<string, Section>; filament: Map<string, Section> } {
  // Commented-out options must not count.
  const code = stripComments(source);
  const sectionsOf = (functions: readonly string[]) => {
    const sections = new Map<string, Section>();
    const orders = new Map<string, number>();
    for (const name of functions) {
      const body = functionBody(code, name);
      let page: string | undefined;
      let group: string | undefined;
      const token =
        /add_options_page\(\s*L\("([^"]+)"\)|new_optgroup\(\s*L\("([^"]+)"\)|"([A-Za-z0-9_]+)"/g;
      for (const match of body.matchAll(token)) {
        if (match[1] !== undefined) {
          page = match[1];
          group = undefined;
        } else if (match[2] !== undefined) {
          group = match[2];
        } else if (page && group && known.has(match[3]!) && !sections.has(match[3]!)) {
          const id = `${page}\n${group}`;
          if (!orders.has(id)) orders.set(id, orders.size);
          sections.set(match[3]!, { page, group, order: orders.get(id)! });
        }
      }
    }
    return sections;
  };
  return {
    process: sectionsOf(BUILD_FUNCTIONS.process),
    filament: sectionsOf(BUILD_FUNCTIONS.filament),
  };
}

/** The body of `void Name()` (between its braces), or throws if it's missing. */
function functionBody(code: string, name: string): string {
  const start = code.search(new RegExp(`void\\s+${name}\\s*\\(\\s*\\)\\s*\\{`));
  if (start < 0) throw new Error(`Tab.cpp has no ${name}().`);
  const open = code.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return code.slice(open + 1, i);
  }
  throw new Error(`Unbalanced braces in ${name}().`);
}
