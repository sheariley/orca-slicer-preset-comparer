# AGENTS.md

OrcaSlicer Profile Comparer: a cross-platform tool for comparing OrcaSlicer **filament** and **process** profiles in a diff-like view of how their settings differ. It's also an editor. From the diff view, users select settings in a base profile and copy them to one or many target profiles at once, then save the changed profiles back to disk. It ships first as a Tauri desktop app and later as an OrcaSlicer plugin, running the same UI and core in both.

**Status:** comparing works end to end (read-only) in the playground, desktop, and plugin builds, and the desktop app has been checked against a real OrcaSlicer data folder on Windows. Editing works in `core` and `app` (copy, undo/redo, save with a result per target), and the desktop host can save user presets (tested on Windows against a real OrcaSlicer folder, including the conflict check and OrcaSlicer's preset lock). The editing UI compares a base preset with any number of targets, one column each: copying the selected rows from the base to the targets through a preview with "Pin override", undo/redo, and saving with a confirmation and per-preset results (with recovery from conflicts and a busy OrcaSlicer), plus a warning before closing with unsaved changes. Changes to system presets are saved as new user presets that inherit from them.

**Open work is tracked in [TASKS.md](TASKS.md).** Check it before starting, and keep it current: add tasks you discover, and mark the ones you finish `[x]`, in the same change.

**OrcaSlicer source:** many directives here point into OrcaSlicer's source code, which is the source of truth for the profile format, setting definitions, and plugin API. In the local workspace a clone sits next to this repo at `../OrcaSlicer/`. Otherwise, clone [OrcaSlicer/OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer). Treat it as read-only reference material.

## Requirements

- **User-friendly UI.** The audience is OrcaSlicer users, not developers, so the UI should feel like a polished desktop tool, on mouse and touch displays alike. The rules are in "UI/UX rules" below.
- **Cross-platform.** It must run on Windows, macOS, and Linux, matching OrcaSlicer's own platforms:
  - Use a stack and packaging that ship on all three.
  - Build file paths with platform APIs, never hard-coded separators.
  - Detect the OrcaSlicer config directory per OS (see "OrcaSlicer profile format") and let users override it.
  - Handle preset filenames that contain spaces, `@`, and other unusual characters. Don't assume the filesystem is case-sensitive or case-insensitive.
  - Expect Windows file locking when OrcaSlicer has a file open.
  - Run tests and CI on all three OSes.

## UI/UX rules

These apply to every host (desktop, plugin, playground). When a rule here conflicts with convenience in code, the rule wins.

### Layout

- **Desktop first.** The comparer is a desktop tool, so design for desktop windows. Layouts should still adapt to smaller windows (e.g. unpin sticky columns below a medium width, 768 px), but phone widths aren't a target and don't need checking.

### Input and accessibility

- **Every hover interaction needs a touch-friendly alternative.** Touch displays have no hover, so nothing may be reachable only by hovering:
  - Wherever a hover tooltip is used or applicable, also show an "info" icon next to the element. Clicking or tapping the icon shows the same tooltip content.
  - The icon is a real button with an accessible name (e.g. "About Nozzle temperature"). It works from the keyboard (Enter/Space opens, Escape closes), and the tooltip closes on a second tap or a tap outside.
  - Put the tooltip text in one place and use it for both the hover and the icon, so the two never drift apart.
  - Native `title` attributes alone don't satisfy this rule; they're hover-only and unreachable by touch or keyboard.
  - **Use `InfoTip`** (`packages/ui/src/components/InfoTip.tsx`) for every tooltip; it implements all of the above. Don't add `title` attributes.
  - **The exception: a button's own tooltip uses `useTooltip`** (`components/Tooltip.tsx`), with no info icon. It shows on mouse hover and keyboard focus, and its text is also the button's accessible name or description, so a tap loses nothing. Icon-only buttons use `IconButton`, whose label is both its name and its tooltip. A button that can't act yet (e.g. "Choose targets" before a base is chosen) stays enabled, describes why, and shows that tooltip when clicked.
  - In dense tables, give each row one info tip that covers the whole row (e.g. the setting's description plus where each side's value came from) rather than an icon per cell.
- **Use `Dialog`** (`packages/ui/src/components/Dialog.tsx`, on Floating UI) for every modal: it traps focus, restores it on close, and closes on Escape or a backdrop click (unless it's mid-task, like saving).
- **Give every control a unique accessible name.** OrcaSlicer reuses short labels (three settings are called "Fan speed"), so names built from a label add the key when another setting shares it (`settingNames` in `diff-view/format.ts`).
- **Size touch targets for fingers.** Buttons, checkboxes, info icons, and picker rows need a hit area of at least 32 × 32 CSS px (44 × 44 preferred), even when the visible glyph is smaller.
- **Label every control.** Use a visible `<label>` or an `aria-label`, and semantic roles (`tablist`/`tab`, `table`, `alert`). Component tests query by role and label (React Testing Library), which keeps this honest.
- **No ellipses in button text** ("Save", not "Save…"). They add nothing.
- **Support the keyboard.** Every action reachable by mouse or touch must also be reachable by keyboard, with a visible focus indicator.

### Comparing

- **Base and targets side by side.** A setting column, the base preset's values, then one column per target, all value columns of equal width, under a sticky header naming each preset. The table is at least wide enough for every value column (`--targets` in `base.css`), so many targets scroll sideways while the selection, setting, and base columns stay pinned (sticky); below 768 px wide they unpin and scroll with the rest. In a row that differs, a target value that matches the base is muted. Long values wrap instead of overflowing.
- **Choose the base and the targets in the same picker dialog** (`PresetPickerDialog`): a table of the type's presets with a Name column that sorts from its header, filtered by name and by "Show system presets" (off by default, remembered separately for each picker as `basePicker.showSystem` and `targetPicker.showSystem`). For the base it picks one preset (radio buttons); for the targets, any number (checkboxes and select-all), never the base, and only once a base is chosen (until then, its button's tooltip says "Choose a base preset first"). Features planned for one picker (hiding templates, filtering by vendor and printer, ...) go into both.
- **The picker buttons say what's chosen.** The base button shows the base's name, and the targets button the target's name when there's one, or a count ("3 targets chosen"), since the table's columns name them. A name that doesn't fit on one line is cut short with an ellipsis, and an info tip next to the button shows it in full. Each button has a joined clear button (an "X"). Clearing asks first: clearing the base clears the targets too, and either one says when unsaved changes would be lost. Each target's column header can also take it out of the comparison.
- **Show only differences by default** (rows where any target differs from the base), with a toggle that shows everything. The toggle shows the count of differences.
- **Filter by setting name,** matching both OrcaSlicer's label and the raw key.
- **Label settings the way OrcaSlicer does.** Show OrcaSlicer's label (preferring its full label over the short tab label), and the raw key underneath in a muted monospace style. Show the key only when it differs from the label.
- **Sort and group the way OrcaSlicer reads.** Rows sort by label (A–Z, or Z–A from the Setting column's header; `aria-sort`), not by key. "Group by section" (on by default, remembered as `table.groupBySection`) puts them under OrcaSlicer's settings-tab sections ("Quality › Layer height", `SettingInfo.sections`, extracted from `Tab.cpp`) in OrcaSlicer's order, sorted within each; settings its tabs don't show go last, in "Other". Sections with no rows to show are hidden, and each has its own select-all.
- **Render values readably.** Show an option's values by OrcaSlicer's labels for them ("Disabled", not `disabled_fuzzy`; `SettingInfo.valueLabels`), with the stored value in the row's tip. Values without a label show as stored. Join arrays with commas, show multi-line G-code as multi-line text, and show the unit after a value. Never add a unit to a value that's already a percentage, and drop the "or %" part of units like "mm/s² or %" for plain numbers.
- **Show where every value came from.** Its tooltip (hover, plus the info icon) names the preset that set it. Built-in OrcaSlicer defaults are visually distinct (muted, italic) and say so.
- **Never silently drop data from the view.** Keys OrcaSlicer ignores (not in the setting catalog) are hidden by default behind a "Hide unused (N)" toggle (its info tip says what they are) that shows the count, never removed outright.
- **Highlight changed rows** with the `--c-changed` token, including rows set on only one side.
- **Scroll only the table.** The screen fills the window: the header, pickers, editing toolbar, and filter row stay in view, and only the table scrolls (`.diff-scroll`), under its sticky header. Windows too short for that (under 420 px tall) scroll as a whole. Everything above the table's toolbar is one header row, over an accent rule: the title, the Filament/Process tabs, and the two picker buttons (no labels: "Choose base" and "Choose targets" say what they're for). Narrow windows wrap it.
- **Remember preferences through `usePreference`** (UI) and `ComparerApp.preferences` (app), which sit on the host's `SettingsStore`. They're conveniences: a store that fails or is missing only costs the remembered value, never an error. Remembered: the preset type (`comparer.presetType`), the table's toggles (`table.onlyDifferences`, `table.hideUnused`, `table.groupBySection`), and each picker's "Show system presets" (`basePicker.showSystem`, `targetPicker.showSystem`). Never the presets compared: each start begins with none chosen.

### Picking presets

- **Browse, don't type.** Pick presets from lists of system and user presets (`PresetPickerDialog`), filterable by name, vendor, and printer (opening a file directly isn't built yet). Never ask for a path.
  - A user preset belongs to the vendor of the system preset it derives from.
  - The printer filter keeps presets made for that printer (`compatible_printers`, their own or inherited) and those that list none, which are for any printer.
- **Make every option identifiable.** Show the vendor of system presets with each name. When the same name appears more than once (e.g. in two user folders), add whatever tells them apart: the user folder (`PresetRef.folder`) as "default" or "account" (with several accounts, "account" and the start of its id), in the badge and in the checkbox's or radio's name.
- **Hide non-selectable templates** (system presets with `instantiation: "false"`, which OrcaSlicer never offers) behind "Show templates", off by default, and badge them "Template" when shown.
- **Listing details come from the hosts.** `listPresets` returns each preset with `details` (`PresetDetails`: selectable, printers, vendor), computed by core's `presetDetails` from the presets' own files and their `inherits` chains. The desktop and plugin hosts read every listed file for it (`createDetailsLister`, 32 at a time), and read system presets only once per session.

### Editing and bulk copy

- **Copies go one way: from the base to the targets.** Select settings in the table, then copy them; there are no per-cell copy buttons. To copy the other way, the user makes the other preset the base. (Two-way, one-click copying was removed: with many targets it made the direction of a copy confusing.)
- **Always show unsaved changes,** offer undo, and confirm before saving.
  - Mark each edited value (accent bar, bold, and "(unsaved)" for screen readers), badge the preset's column, and count the changes in the editing toolbar.
  - Rows with unsaved changes stay visible under "Only differences", even when a copy made the values equal.
  - Undo and redo also work from the keyboard (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z; ⌘ on macOS), except while typing in a field.
  - Confirm before discarding unsaved changes: choosing another base preset or profile type, taking targets with unsaved changes out of the comparison, or closing the window (through the host's `CloseGuard`, where it has one: the desktop app does).
- **Don't offer what can't be saved.** No copy controls on a read-only host. Copies into a system preset are allowed because saving puts them into a new user preset; its column's "System" badge (an `InfoTip`) says so.
- **Ask about redundant overrides with a "Pin override" toggle** (`PinToggle`: a thumbtack button, upright and filled when pinned, tilted and outlined when not, with `aria-pressed` and a tooltip naming the current state) on each affected setting, in the preview of a copy (see "Writing profiles back"). Its tooltip (an `InfoTip`) explains the trade-off: keeping the override pins the value, so changes to the parent no longer reach it; unpinning re-links it to the parent.
- **Bulk copy is the comparison itself:** select settings in the table and "Copy selected to N targets" copies them from the base to every target in one action, after a preview (`CopyToTargetsDialog`; with one target, `CopyPreviewDialog`).
  - Before applying, preview each target: the current value, the new value, and which targets already match and will be skipped.
  - Apply the batch as one undoable step, while letting users leave out individual targets.
  - The session holds exactly the base and the targets: the editor opens targets added later (keeping the history) and closes ones taken out (`ComparerApp.removePresets`, which drops their pending edits, after the screen asked).
  - When the batch includes system presets, say which ones in the preview, and ask for the names of their new user presets once, in the save confirmation.

### Saving and feedback

- **Report results per target:** saved, skipped, failed, or needs a new user preset. One failure must not stop the others or hide which ones succeeded, and failed edits stay pending so the user can retry.
- **Offer the fix that works for each failure.** A `conflict` (the file changed since it was read) can't be fixed by retrying, so offer "Reload from disk and keep my changes" instead (`reloadPresets`). A `busy` OrcaSlicer, or any other failure, gets "Try again".
- **Tell users what to do next.** If OrcaSlicer must re-select a preset or restart to see a change, the save result says so and the UI tells the user. Never assume the change took effect.
- **Warn about a running OrcaSlicer,** which may overwrite saved files or not pick up changes.

### Errors and host limits

- **Explain errors in plain language.** Show a short explanation of the error's kind, plus the specific detail (which preset, which parent, which file). Never show raw exceptions or stack traces. Errors must not crash the UI.
- **Adapt to host capabilities, and say so.** When a host can't do something (e.g. `canSave: false`), show it (the "Read-only" badge) and disable or hide the action with an explanation, instead of letting it fail.

### Visual design and theming

- **Take colors only from design tokens** (CSS variables in `packages/ui/src/theme/`). Component styles (`base.css`) never hard-code colors.
  - `desktop.css` defines the token values for the desktop app and the playground, with light and dark variants that follow the OS (`prefers-color-scheme`).
  - `orca.css` maps the tokens onto the variables OrcaSlicer injects into plugin pages (`--orca-bg`, `--orca-fg`, `--orca-muted`, `--orca-border`, `--orca-accent`, `--orca-accent-fg`, `--orca-font`), so the plugin follows OrcaSlicer's theme.
- **Look at home in OrcaSlicer:** compact density (13 px base font), OrcaSlicer's accent color for selection and primary actions, and its font inside the plugin.
- **Use only features every target web view supports:** WebView2 (Windows), WebKit (macOS), and WebKitGTK (Linux).
- **Keep the plugin page self-contained:** no external fonts, images, or scripts. Everything is inlined into one HTML file.

## Stack

- **Use TypeScript everywhere outside the Python plugin layer.** Use React for the UI and Vite for builds. Don't use Next.js: there's no server.
- **Ship the desktop app with Tauri 2.** Use Tauri's official JS plugins (file system, path, dialog) for host access, and keep custom Rust to the minimum. Tauri is chosen over Electron because it renders in the OS web view, the same engines the OrcaSlicer plugin runs in (WebView2 on Windows, WebKit on macOS, WebKitGTK on Linux). Web view quirks then show up during desktop development.
- **Plan for an OrcaSlicer plugin as a second host.** The same UI and core must later run as an OrcaSlicer plugin without changes. See "OrcaSlicer plugin target".
- **Use pnpm workspaces for the monorepo.** Its strict installs back up the layering: a package can only import what it declares. Don't switch to npm, Yarn, or Bun without revisiting [ADR 0001](docs/adr/0001-pnpm-workspaces.md), which records the reasons and alternatives.
- **Use Vitest** for unit and contract tests, and **React Testing Library** for component tests.
- **Keep TypeScript on 6.0** until typescript-eslint supports TypeScript 7 (its peer range is `<6.1`). The pin and its reason are in `pnpm-workspace.yaml`.
- **Run tools with Node's built-in TypeScript support** (`node file.ts`, Node 22.18+). Tools and build scripts need no compile step.
- **Record significant decisions as ADRs** in `docs/adr/`.

## Architecture: isolate the UI and core from hosts

The host interface (Tauri) and the plugin interface (OrcaSlicer's Python `orca` API, still new) will both change. Design so a change in either touches only that host's adapter.

- **Split the code into layers with one-way dependencies:** `ui` → `app` → `core`. Host adapters depend on `core` (to implement its ports). Nothing in `core`, `app`, or `ui` depends on an adapter.
  - **`core`:** pure domain logic. Covers the profile model, value normalization, inheritance resolution with provenance, diffing, the edit model for transfers (one source to one or many targets), undo/redo, and serialization that preserves formatting. No I/O, DOM, React, Tauri, or `orca` imports. Everything is deterministic and synchronous where possible.
  - **`app`:** use cases such as "load profiles to compare", "transfer value", "bulk transfer to many targets", "save changes", and "list available presets". These coordinate `core` with the ports. The UI calls only this layer.
  - **`ui`:** React components and hooks. They get the `app` layer through context. The UI never calls a host API directly.
- **`core` owns the ports.** Define host-facing interfaces in `core/ports` in domain terms: for example a `ProfileRepository` (list presets, read a raw profile document, save one), a `SettingCatalog` (labels, units, groups), and a `SettingsStore` (user preferences). Adapters implement them. Never shape a port after one host's API.
- **Let hosts declare their capabilities.** Each adapter reports what it supports (for example `canSave`, `canBrowseFiles`, `canWatchForChanges`). The `app` and `ui` layers adapt to those capabilities, such as making the view read-only when saving isn't supported, instead of checking which host they're in. Never branch on "am I in Tauri or OrcaSlicer?" outside the composition root.
- **Translate at the boundary.** Adapters convert host data (Tauri paths, `orca` `Preset` objects, JSON messages) into core types and back. Host types must never leak past an adapter.
- **Validate everything crossing a boundary.** Parse plugin messages and profile files with schemas (zod) before they reach `core`. Treat host data as untrusted.
- **Have the core resolve inheritance itself, from raw profile documents.** Some hosts hand over already-resolved values (the OrcaSlicer plugin API does), but only the raw document says which keys a profile owns, and saving depends on that. Treat host-resolved values as a cross-check at most.
- **Use one composition root per app.** Each entry point (desktop, plugin, playground) is the only place that picks and wires an adapter.
- **Treat a single transfer as a bulk transfer with one target.** Use one code path in `core` and `app` for both, so the same rules apply either way: skip targets that are already equal, check type and key compatibility, decide array lengths, and handle system targets. A batch is one undo step made of per-target change sets, and `saveChanges` returns a result for each target instead of all-or-nothing.
- **Don't reinvent the wheel.** Before building a shared UI component or a general-purpose utility (tooltips, popovers, dialogs, menus, virtualized lists, date handling, ...), look for a vetted, mature package: actively maintained, widely used, accessible, typed, and compatible with our targets (React 19, all three OS web views, a single-file plugin build).
  - **Add the dependency only when its behavior clearly matches what we need.** It's fine if the package does more than we need.
  - **Prefer our own implementation when the package would need patching,** monkey-patching, or fighting its intended behavior (e.g. a tooltip library that deliberately refuses to open on click, when we need click). Forcing a package against its design costs more than writing the thing ourselves.
  - **Record the choice:** the package, why it fits, and the alternatives rejected and why. Use an ADR for significant choices, or a comment in the component that wraps the package.
  - **Wrap third-party UI behind our own component** (e.g. `InfoTip` over Floating UI), so the rest of the UI doesn't depend on the package directly and replacing it touches one file.
- **Enforce the layering with tooling, not convention.** Make each layer a workspace package and add ESLint (`no-restricted-imports`) and dependency-cruiser rules that fail the build on forbidden imports. See "Dependency rules".

## Directory structure

Folders marked `(planned)` don't exist yet.

```
orca-slicer-profile-comparer/
├── AGENTS.md
├── TASKS.md                    # open work, by area and priority
├── README.md
├── package.json                # private root: scripts and repo-wide dev tools only
├── pnpm-workspace.yaml         # workspace globs + catalog of shared dependency versions
├── tsconfig.base.json          # strict compiler settings every package extends
├── tsconfig.json               # root config files and scripts/
├── eslint.config.js            # includes the import rules that enforce the layers
├── .dependency-cruiser.cjs     # dependency graph rules, checked in CI
├── vitest.config.ts            # test projects: "node" (*.test.ts) and "dom" (*.test.tsx, jsdom)
├── scripts/run-python.mjs      # runs the right Python interpreter name on each OS
├── .github/workflows/ci.yml    # checks on Windows, macOS, and Linux + desktop build
├── .github/workflows/upstream-drift.yml # weekly: is the setting catalog still in step with OrcaSlicer's main?
│
├── packages/
│   ├── core/                   # pure domain logic: no I/O, DOM, React, or host code
│   │   ├── src/
│   │   │   ├── model/          # PresetRef, ProfileDocument, METADATA_KEYS
│   │   │   ├── normalize/      # string/array normalization, equality
│   │   │   ├── resolve/        # inheritance chain resolution + where each value came from
│   │   │   ├── diff/           # resolved profiles → diff rows
│   │   │   ├── edit/           # transfer rules (planTransfer, 1..n targets), edit history, undo/redo
│   │   │   ├── serialize/      # writes a profile in the format it was read in (OrcaSlicer canonical)
│   │   │   ├── errors/         # ComparerError with a typed kind (access-denied, not-found, ...)
│   │   │   ├── ports/          # ProfileRepository, SettingCatalog, SettingsStore, HostCapabilities
│   │   │   └── index.ts        # the package's public API
│   │   └── test/
│   │       ├── fixtures/       # real OrcaSlicer profiles (tools/sync-fixtures) + user presets in OrcaSlicer's saved format
│   │       └── load-fixtures.ts
│   │
│   ├── app/                    # use cases, built on core + ports
│   │   └── src/
│   │       ├── comparer-app.ts # createComparerApp: the API the UI calls
│   │       ├── comparer-app.ts # also the editing use cases: openSession, addPresets, removePresets, compareTargets, previewCopy, copy, saveChanges
│   │       ├── preferences.ts  # Preferences over the SettingsStore port
│   │       ├── use-cases/      # loadChain, loadTemplates, loadResolved
│   │       └── session/        # EditSession: opened presets, edit history, pending edits, undo/redo
│   │
│   ├── ui/                     # React; receives the app layer through a provider
│   │   ├── vitest.setup.ts     # jest-dom matchers + cleanup for the "dom" test project
│   │   └── src/
│   │       ├── ComparerRoot.tsx    # the whole UI; composition roots render this
│   │       ├── ComparerScreen.tsx
│   │       ├── features/       # preset-picker/ (the base and target picker dialog), diff-view/, editing/, save-flow/; (planned) settings/
│   │       ├── components/     # shared building blocks: InfoTip, IconButton, Tooltip, PinToggle, Dialog, ErrorMessage
│   │       ├── hooks/          # useComparerApp, useAsync, usePreference
│   │       ├── providers/      # AppProvider + its context
│   │       └── theme/          # base.css (components), desktop.css and orca.css (token values)
│   │
│   ├── setting-catalog/        # data/settings.json (generated) + SettingCatalog implementation
│   ├── bridge-protocol/        # plugin message schemas (zod), protocol version, samples/exchanges.json
│   ├── host-contract-tests/    # describeProfileRepositoryContract(name, factory) + seed documents
│   ├── host-memory/            # in-memory adapter (tests, browser playground)
│   ├── host-tauri/             # desktop adapter over a HostFileSystem (Tauri fs plugin in production)
│   └── host-orca/              # plugin adapter: bridge client over window.orca
│
├── apps/
│   ├── desktop/                # Tauri app
│   │   ├── src/main.tsx        # composition root: host-tauri → app → ui
│   │   ├── icon-source.svg     # source for src-tauri/icons (regenerate with `pnpm tauri icon icon-source.svg`)
│   │   └── src-tauri/          # tauri.conf.json, capabilities/, Cargo.toml; Rust only for OrcaSlicer's preset lock
│   ├── orca-plugin/
│   │   ├── web/                # composition root (host-orca → app → ui), single-file Vite build
│   │   ├── python/
│   │   │   ├── comparer_plugin.py  # all orca.* glue: Pages capability + OrcaPresetHost
│   │   │   ├── comparer_bridge.py  # protocol handling, stdlib only, no orca imports
│   │   │   └── tests/          # unittest: replays bridge-protocol samples
│   │   └── scripts/build-plugin.ts # inlines the bridge and page into dist/orca_profile_comparer.py
│   └── playground/             # Vite app in a plain browser: host-memory + core's fixtures
│
├── tools/
│   ├── extract-settings/       # OrcaSlicer's PrintConfig.cpp + Preset.cpp + Tab.cpp (from GitHub, or a clone) → labels, defaults, enum labels, tab sections, type and per-variant key lists, legacy keys
│   └── sync-fixtures/          # copies profiles listed in fixtures.json into core's fixtures
│
└── docs/
    ├── architecture.md         # diagram of layers, hosts, and data flow
    └── adr/                    # architecture decision records
```

### Dependency rules

Enforce these with ESLint and dependency-cruiser so CI fails on a violation. Don't rely on code review to catch them.

| Package                     | May depend on                                                |
| --------------------------- | ------------------------------------------------------------ |
| `core`                      | nothing in the workspace; no React, Tauri, DOM, or Node APIs |
| `app`                       | `core`                                                       |
| `ui`                        | `app`, `core` (types only)                                   |
| `setting-catalog`           | `core`                                                       |
| `bridge-protocol`           | nothing in the workspace except `core` types                 |
| `host-contract-tests`       | `core`                                                       |
| `host-memory`, `host-tauri` | `core`                                                       |
| `host-orca`                 | `core`, `bridge-protocol`                                    |
| `apps/*`                    | anything; these are the composition roots                    |
| `tools/*`                   | anything; never imported by packages or apps                 |

- **Only composition roots in `apps/*` import a host adapter.** `ui` and `app` never import a `host-*` package, `@tauri-apps/*`, or anything plugin-specific.
- **Import other packages only through their `index.ts`.** Never import a path deeper inside another package. The one exception is `@comparer/ui/theme/*.css`, which the composition roots import to pick a theme.
- **Tests may also use `host-memory` and `host-contract-tests`**, declared as devDependencies. That's how `app` and `ui` are tested without a real host.
- **Declare every import in `package.json`.** pnpm won't resolve undeclared packages, and dependency-cruiser's `not-to-unresolvable` rule reports them.
- **When you add a package,** add its rules to both `eslint.config.js` (a `restrict(...)` line) and `.dependency-cruiser.cjs`, and update the table above.

### Why it's structured this way

- **Each layer is a package** so the dependency rules can be checked mechanically, and pnpm's strict installs stop a package from importing anything it doesn't declare.
- **`bridge-protocol` is separate from `host-orca`.** The message format is the contract between TypeScript and Python. Both sides test against its sample messages, because the Python layer is stdlib-only and can't share the zod schemas.
- **`host-contract-tests` keeps adapters interchangeable.** Every adapter must pass the same suite. That's what makes testing `app` and `ui` against `host-memory` trustworthy.
- **`setting-catalog` is generated data behind the `SettingCatalog` port.** Both hosts use the same data. Tests can substitute a small fake.
- **`playground` is where most UI work happens.** Run the Tauri app only when real file-system behavior matters.

## Conventions

- **Package names:** `@comparer/<name>`, all `private: true`.
- **Workspace dependencies:** use `workspace:*` for packages in this repo, and `catalog:` for shared third-party versions (React, TypeScript, Vite, zod, Vitest) defined in `pnpm-workspace.yaml`.
- **Tests:** put `*.test.ts` / `*.test.tsx` next to the code they test. Shared fixtures go in the owning package's `test/fixtures/`.
- **Generated files:** never edit them by hand. Regenerate `packages/setting-catalog/data/settings.json` with `pnpm extract-settings`, the system-profile fixtures with `pnpm sync-fixtures`, and the plugin with `pnpm build:plugin`.
- **Source imports use explicit `.ts`/`.tsx` extensions** (`allowImportingTsExtensions`). Packages export their TypeScript source directly; there's no per-package build step.
- **Formatting:** Prettier (`pnpm format`). CI runs `pnpm format:check`.

## Testing

- **Unit-test `core` thoroughly** with fixtures copied from real OrcaSlicer profiles (OrcaSlicer's `resources/profiles/`), including multi-level inheritance, array values, percentages, and G-code.
- **Run the shared contract suite (`host-contract-tests`) against every adapter** (memory, Tauri, plugin) so they behave the same.
- **Test the `app` and `ui` layers against `host-memory`.** They should never need a real file system or OrcaSlicer to be tested.
- **Make sure `ui` runs in a plain browser with `host-memory`** (the `playground` app) for fast development and previews.
- **Keep everything from automated test runs in `.test-artifacts/`** at the repo root (git-ignored). Never leave it in temp folders or commit it.
  - Screenshots and other output go in a folder per run (e.g. `.test-artifacts/2026-10-10-e5-real-folder/`).
  - Temporary test scripts (bash, PowerShell, Node, Python) go in `.test-artifacts/scripts/`, with a comment at the top saying what each one does and how to run it. Check there before writing a new one, and reuse or update what's there.

## Commands

```bash
pnpm install
pnpm dev:playground     # UI in a browser against host-memory + core's fixtures
pnpm dev:desktop        # Tauri dev build (needs Rust)
pnpm test               # Vitest across all packages
pnpm test:python        # plugin Python tests (unittest)
pnpm lint               # ESLint + dependency-cruiser
pnpm typecheck          # tsc --noEmit in every package
pnpm format             # Prettier
pnpm build:desktop      # Tauri release build
pnpm build:plugin       # single-file plugin: apps/orca-plugin/dist/orca_profile_comparer.py
pnpm extract-settings   # regenerate the setting catalog from OrcaSlicer on GitHub (--ref <branch|tag|commit>, default main; --orca <path> for a local clone; --check compares instead of writing; --verbose lists skipped defaults)
pnpm sync-fixtures      # refresh system-profile fixtures from ../OrcaSlicer (or --orca <path>)
```

Before finishing a change, run `pnpm lint`, `pnpm typecheck`, and `pnpm test`, plus `pnpm test:python` if you touched the plugin or the bridge protocol. Update `TASKS.md` too.

## Development environment

- **pnpm 12:** install it with `npm install -g pnpm@12`. Corepack 0.34 can't run pnpm 12 (it looks for a `pnpm.cjs` that pnpm 12 no longer ships).
- **WSL with the repo on a Windows drive (`/mnt/...`) is too slow for tests.** Each file lookup takes milliseconds, so jsdom takes over a minute to load and Vitest's "dom" project times out starting its worker. Either run commands from Windows itself (PowerShell with Windows Node), or work from a clone on the Linux filesystem (e.g. `~/src/...`). Don't treat that timeout as a code bug.
- **Desktop builds need Rust** and [Tauri's system prerequisites](https://tauri.app/start/prerequisites/). Everything else only needs Node and Python. A first build takes about 3 minutes; later builds take seconds.
- **On Windows, `pnpm` may be Corepack's shim** (`C:\Program Files\nodejs\pnpm.ps1`), which fails on pnpm 12 the same way. Run `corepack disable pnpm`, then `npm install -g pnpm@12`, or use `npx pnpm@12.9.1`. In PowerShell scripts, call `npx.cmd`, not `npx`: the `npx.ps1` shim drops arguments passed with `@args`.
- **Don't share one checkout's `node_modules` between WSL and Windows.** pnpm installs only the current platform's native binaries (Vite's bundler, the Tauri CLI), so installing from one side breaks the other. Use one side per checkout.
- **To drive the desktop app from a script,** enable WebView2's DevTools port in a local, uncommitted copy of `tauri.conf.json`: set `app.windows[0].additionalBrowserArgs` to `"--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=9333"`. The `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable is ignored, because Tauri passes its own browser arguments. Then connect to `http://127.0.0.1:9333/json` with the Chrome DevTools Protocol.

## Host adapters as built

- **Desktop (`host-tauri`):**
  - Reads OrcaSlicer's data folder (`configDir()/OrcaSlicer`):
    - `system/<Vendor>/<type>/*.json` for system presets, including subfolders: vendors may group them (OrcaFilamentLibrary keeps its parents in `filament/base/` and most presets in a folder per brand). Only the vendors the user installed are there.
    - `user/<user_id>/<type>/*.json` for user presets.
    - `user/<user_id>/<type>/base/*.json` for user root presets (`inherits: ""`, every setting spelled out).
    - `<user_id>` is `default` when signed out, or the account id when signed in. Both folders can exist, often with copies of the same presets.
  - Preset ids are absolute file paths. Names come from file names, which OrcaSlicer keeps equal to preset names. User presets carry their user folder's name (`folder`).
  - Parents resolve in the child's own user folder first, then among system presets of the same vendor, then any system preset. Real user presets often inherit from other user presets, usually `base` ones.
  - A preset can name a parent that no longer exists. That's a real state of user data, so report it as `not-found`; it's not a bug.
  - Every file call goes through the `HostFileSystem` interface, so the contract tests run against an in-memory file system. The production implementation wraps Tauri's fs plugin.
  - File access is limited to `$CONFIG/OrcaSlicer` by `src-tauri/capabilities/default.json`. Widen that scope deliberately, never with a blanket permission.
  - Returns each file's exact text, and reports CRLF as the platform newline when the path separator is `\` (Windows), LF otherwise.
  - **Saving** (`saveDocument`) writes user presets only; system presets are refused. For each file:
    1. It takes OrcaSlicer's preset lock (see below).
    2. It re-reads the file and refuses with `conflict` if it no longer holds `previousText`.
    3. It backs up the `.json` and its `.info` to the app's own folder: `appDataDir()/backups/<batch>/<path relative to the OrcaSlicer data folder>`. One save's files share a folder through `SaveRequest.batch`.
    4. It writes the new text through a temporary `.tmp` file in the same folder and renames it over the original. Windows refuses the rename while another program holds the file open, so it retries for about 2 s. If the rename still fails, it writes in place, as OrcaSlicer does in that situation; the backup was taken first.
    5. It marks the `.info` for cloud sync (`markPresetInfoForSync`), and never creates an `.info` that wasn't there.
    6. It reports `reloadRequired: 'restart'`, because OrcaSlicer keeps presets in memory and doesn't watch the files.
  - **OrcaSlicer's preset lock:** OrcaSlicer guards every user-preset read and write with an OS file lock on `<data folder>/user.lock` (`InstanceLock`: `LockFileEx` on Windows, `flock` elsewhere), held only for each operation, with a 1 s timeout. The app takes the same lock through two Rust commands in `src-tauri/src/lib.rs` (`lock_user_presets` / `unlock_user_presets`, exposed to TypeScript as `tauriPresetLock()`). They use Rust's standard `File::lock`, which makes the same OS calls, and can lock only that one file. If OrcaSlicer holds the lock for over 2 s, the command fails with exactly `"busy"`, which `tauriPresetLock()` turns into a `busy` error, so the save fails (nothing written) instead of proceeding unlocked.
  - **Creating presets** (`createPreset`), the way OrcaSlicer saves a new one:
    - It goes in the user folder OrcaSlicer saves new presets to: `app.preset_folder` in `OrcaSlicer.conf` (the signed-in account's id), or `default` when that's empty or the file can't be read. `OrcaSlicer.conf` is JSON followed by an `# MD5 checksum` line; the host only reads it.
    - The file is written in OrcaSlicer's format for new files, with `version` set from the parent: for a system preset, its vendor bundle's version (`system/<Vendor>.json`), formatted as OrcaSlicer writes it (`orcaPresetVersion`: "02.08.00.12" → "2.8.0.12").
    - A new `.info` goes next to it (`newPresetInfo`): `sync_info = create` (so OrcaSlicer uploads it), `user_id` (the account id, or empty when signed out), no `setting_id` yet, `base_id` from the parent's `setting_id`, and `updated_time = 0`.
    - Under OrcaSlicer's lock, and never over an existing file: a name used by any preset of the type is refused with `name-taken`. It reports `reloadRequired: 'restart'`.
  - **Write permissions** (`src-tauri/capabilities/default.json`): write, rename, and create folders only under `$CONFIG/OrcaSlicer/user/**`, remove only `*.tmp` files there, write/mkdir under `$APPDATA/backups/**`, and read/write the preferences file `$APPDATA/settings.json`. Never anything under `system/`.
  - **Preferences:** `fileSettingsStore` implements core's `SettingsStore` port as one JSON file, `appDataDir()/settings.json` (`defaultSettingsPath()`). A missing or broken file reads as no preferences. The playground keeps them in `localStorage`; the plugin has no store yet, so its preferences last the session.
  - **Closing the window:** `tauriCloseGuard()` implements core's `CloseGuard` port over the window's close-requested event, and `core:window:allow-destroy` lets it close after the UI asked about unsaved changes. The app layer passes it to the UI (`ComparerApp.closeGuard`).
- **Plugin (`host-orca` + `apps/orca-plugin/python/`):**
  - The Python side reads files with `newline=""`; Python's text mode would turn CRLF into LF and lose the original bytes. It reports `os.name == "nt"` as CRLF for new files.
  - Preset ids are `"<type>:<name>"`, unique within a preset collection. A system preset's vendor is the folder two levels above its file.
  - The plugin builds to a single `.py` file with a PEP 723 header, the bridge code, and the page inlined.
  - `get_icon()` isn't implemented yet. It needs a path to an icon file, which a single-file plugin doesn't ship.
  - The plugin has only been exercised against a stand-in `orca` module, not inside OrcaSlicer. Test it in an OrcaSlicer nightly before relying on it.

## OrcaSlicer source reference

Paths are relative to the OrcaSlicer repo root.

| Path                                           | What it holds                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `resources/profiles/<Vendor>.json`             | Vendor index: `version`, plus `machine_model_list`, `machine_list`, `filament_list`, `process_list` mapping preset names to `sub_path` files |
| `resources/profiles/<Vendor>/filament/*.json`  | Filament presets                                                                                                                             |
| `resources/profiles/<Vendor>/process/*.json`   | Process (print settings) presets                                                                                                             |
| `resources/profiles/<Vendor>/machine/*.json`   | Printer presets                                                                                                                              |
| `src/libslic3r/PrintConfig.cpp`                | Definitions of every setting: key, label, tooltip, category, type, default, units                                                            |
| `src/libslic3r/Preset.cpp`, `PresetBundle.cpp` | Preset loading, inheritance resolution, and which keys belong to filament, process, and printer presets                                      |
| `src/slic3r/plugin/`                           | Plugin system: loader, Python bindings (`host/`), capability types (`pluginTypes/`), file-access audit (`PluginAuditManager`)                |
| `sandboxes/*.py`                               | Example plugins                                                                                                                              |

## OrcaSlicer profile format

- Profiles are JSON objects that mix settings with **metadata keys**. The metadata keys are listed in `METADATA_KEYS` (`core/src/model/profile.ts`). They come from the `BBL_JSON_KEY_*` / `ORCA_JSON_KEY_*` constants in OrcaSlicer's `Preset.hpp`, plus the `*_settings_id` options that only repeat the preset's name: `type` (`filament` / `process` / `machine`), `name`, `inherits`, `include`, `from` (`system` / `User`), `setting_id`, `base_id`, `user_id`, `filament_id`, `instantiation`, `version`, `is_custom_defined`, `description`, `renamed_from`, `created_time`, `updated_time`, `filament_settings_id`, `print_settings_id`, and `printer_settings_id`. Metadata is never inherited, compared, or copied. `compatible_printers` is a real setting, not metadata.
- **Inheritance:** a profile usually lists only the keys it overrides and points to a parent through `inherits` (by preset name, e.g. `"Bambu ABS @base"` or `"fdm_process_single_0.06_nozzle_0.2"`). Parents can chain several levels deep. A meaningful comparison needs the **fully resolved** profile: walk the `inherits` chain and let child keys override parent keys. The UI shows where each value came from (hover), and marks built-in defaults.
- **Built-in defaults (implemented):** a root preset (no `inherits`) starts from OrcaSlicer's built-in default of every setting its type owns, and `resolveChain` does the same:
  - The defaults come from `set_default_value` in `PrintConfig.cpp`, serialized exactly as OrcaSlicer writes them to profiles (`%g`-style numbers, `"1"`/`"0"` booleans, enum keys, `"0x0"` points).
  - Which settings a type owns comes from `s_Preset_print_options` (process) and `s_Preset_filament_options` (filament) in `Preset.cpp`.
  - The setting catalog serves both through `SettingCatalog.defaultsFor(type)`.
  - Filament overrides of printer settings (`filament_retraction_length`, ...) are defined in a loop that copies the printer setting's label and default; the extractor follows it.
- **Legacy keys and values (implemented):** OrcaSlicer's `PrintConfigDef::handle_legacy` runs on every setting it loads. It discards obsolete keys (the `ignore` set, e.g. `adaptive_layer_height`), renames old ones (`enable_wipe_tower` → `enable_prime_tower`), and rewrites old values (`wall_direction: auto` → `ccw`, `zig-zag` patterns → `rectilinear`, `wall_filament: "1"` → `outer_wall_filament_id: "0"`, old percentages of now-absolute speeds dropped, ...). `resolveChain` applies all of it, the same as OrcaSlicer; when a file has an old key and its replacement, the replacement wins.
  - Obsolete keys and plain renames are data, extracted into the catalog (`SettingCatalog.legacyKeys()`).
  - The value rules are code, ported by hand to core (`migrateLegacyValue` in `core/src/resolve/legacy-values.ts`). OrcaSlicer runs them on the value as text: a plain string as is, an array as its elements joined with commas (string lists quoted and joined with semicolons, so only rules that edit each element reach them).
  - **Keep the port in step:** the extractor records a fingerprint of `handle_legacy` (`legacy.sourceHash` in the catalog), and a setting-catalog test fails when it differs from `LEGACY_VALUE_RULES_SOURCE_HASH`. Then review OrcaSlicer's change, update the rules, and the hash.
  - **Upstream drift:** the "OrcaSlicer drift" workflow (`.github/workflows/upstream-drift.yml`, weekly and on demand) runs `pnpm extract-settings --check` against OrcaSlicer's `main` on GitHub and fails with a summary of what changed (settings, owned keys, legacy keys, `handle_legacy`). Regenerating the catalog and reviewing the change is what clears it; the regular CI stays offline.
  - Copies write the current key and remove the old one, for value-rule renames too (`planTransfer`).
- **Unknown keys:** OrcaSlicer ignores keys it doesn't define, and Bambu's bundled profiles carry dozens of them (Bambu Studio leftovers such as `counter_coef_1`). The diff view hides keys the catalog doesn't know behind a "Hide unused" toggle (on by default). The catalog must therefore cover every real setting; see `tools/extract-settings` for the definition forms it understands.
- **`include` templates (implemented):** about 1,500 of Bambu's bundled filament profiles also list `include`, an array of template preset names (or one bare name). `resolveChain` follows OrcaSlicer's `PresetBundle::resolve_vendor_preset`. For each preset in the chain, root first:
  1. Start from the parent's resolved settings. A preset with no `inherits` starts from OrcaSlicer's built-in defaults instead (`set_default_value` in `PrintConfig.cpp`).
  2. Layer each included template on top, in the order listed. What gets layered is the template's resolved settings (its own parents and includes applied) that differ from the defaults, not just the keys in its own file. A template that sets a default value therefore doesn't override the parent.
  3. Apply the preset's own keys.
  4. Resize the per-variant settings to the preset's number of variants (`extend_default_config_length`; see "Fit per-variant settings" below). Each level is resized in turn; a template's settings are taken before it's resized.

  More rules:
  - OrcaSlicer reads `include` only in bundled vendor profiles; user presets' `include` is ignored (`includesOf`).
  - A template that can't be found is skipped, as OrcaSlicer does (it logs an error and loads the preset without it).
  - `loadTemplates` (app) looks templates up through `resolveParent` and passes them to `resolveChain` as `options.templates`. Editing sessions keep them per preset.
  - Not applied: replacing `nil` values with the parent's when resizing. In bundled profiles `nil` only appears on the filament overrides of printer settings, which OrcaSlicer keeps as `nil`.
  - The fixtures include `Bambu ABS @BBL H2C` and the template it includes.

- `instantiation: "true"` marks a preset users can pick. `"false"` (or a missing key on `@base` / `fdm_*` templates) marks an abstract parent.
- **Values are strings.** Numbers and booleans are stored as strings (`"0.4"`, `"1"`). Per-extruder or per-filament settings are arrays of strings (e.g. `"hot_plate_temp": ["100"]`). Some values are percentages (`"50%"`) or multi-line G-code. Normalize before comparing so that, say, `"16"` and `["16"]` don't show up as a false difference.
- Parent names are resolved within the same vendor directory. Filaments and processes also inherit from shared bases such as `fdm_filament_common` and `fdm_process_common`, found in the vendor folder or in `resources/profiles/OrcaFilamentLibrary/`.
- User-created presets live in the OrcaSlicer config directory under `user/<user_id>/{filament,process,machine}/` (`%APPDATA%\OrcaSlicer` on Windows, `~/.config/OrcaSlicer` on Linux, `~/Library/Application Support/OrcaSlicer` on macOS). Each is a `.json` with a sibling `.info` file. They often inherit from a system preset by name.
- Human-readable labels, units, and categories for each key come from `PrintConfig.cpp`. Commented-out definitions there are retired options; the extractor strips comments before parsing so they don't become settings.

## Writing profiles back (transfer and save)

`core/edit/` implements the transfer rules below (`planTransfer`), and the edit history (batches, undo/redo, and `pendingEdits`, the net edits per target that saving writes through `core/serialize/`). The app layer builds each target's state: its own document, its resolved settings, and what it would inherit without its own overrides (its parent's resolved settings, or the built-in defaults for a root). When planning a new batch on top of pending edits, it must build that state from the edited documents.

**The editing session (`app/session/`).** `ComparerApp.openSession` loads presets for editing, with their parent chains. The session is an immutable value; the app's use cases (`previewCopy`, `copy`, `saveChanges`) and the session functions (`undoSession`, `redoSession`, `pending`, ...) return new ones.

- **Each preset keeps two versions of its file:** as the session opened it (`opened`), and as it is now (`chain[0]`, which changes on save). The history applies to the opened file, which gives the content the user wants. Pending edits are the difference between that and the file as it is now. Saved changes therefore drop out, and undoing a saved change makes reverting it pending, like undo after save in a text editor.
- **Everything resolves in the edited state.** A preset's chain uses the edited document of every preset open in the session, so a copy into an open parent reaches its open children. Copies are planned against the edited state too, so they build on earlier, unsaved ones.
- **`saveChanges` goes target by target.** For each preset with pending edits, it applies the edits to the file's original text (`applyEdits`, with the host's `newline` as the fallback for new files), then asks the host to write that text with `previousText`. Results:
  - `saved`: includes the host's `reloadRequired` and whether the file had to be `reformatted`.
  - `created`: a system preset's changes, saved as a new user preset (see below). Its file is never written.
  - `needs-user-preset`: a system preset with no name given for its new preset (`SaveOptions.newPresetNames`), so nothing was saved.
  - `failed`: carries a typed error, e.g. `conflict` when the file changed since it was read, `busy` when OrcaSlicer holds its preset lock too long, or `unsupported` on a read-only host. Failed targets keep their pending edits.
- **System presets save as new user presets** (`saveChanges` with `newPresetNames`, by the system preset's id). `newUserPresetContent` (core) builds what OrcaSlicer's "Save as" writes (`save_current_preset` and `Preset::save`): every setting whose value differs from the system preset's, plus the variant list, plus `inherits`, `name`, `from: "User"`, `is_custom_defined: "0"`, and the `*_settings_id` option. The host's `createPreset` writes it. Then `savedAsNewPreset` takes the system preset's changes out of the history (the new file exists either way, so undo can't take them back) and opens the new preset in the session, and the UI shows it in the system preset's place. Names follow OrcaSlicer's rules (`presetNameProblem`), refuse any name already in use, and default to OrcaSlicer's suggestion, "<name> - Copy".
- **`reloadPresets` recovers from a conflict** by re-reading presets and rebasing the session onto them (`reloadPreset`): what changed on disk is folded into the opened file as well, so the history replays on top of the new content. Where both changed a setting, the user's copy wins, and undo still reverses copies saved before the reload.

**Hosts write text, never content.** `ProfileRepository.readDocument` returns the file's exact text (`ProfileDocument.text`) along with the parsed content. `saveDocument({ ref, text, previousText })` writes the text exactly and refuses with `conflict` if the file no longer holds `previousText`. Hosts also report the platform's `newline`, used only for new files. The one exception is `createPreset`: a brand-new file has no format to keep, so the host serializes the content in OrcaSlicer's format for new files, after adding what only it knows (`version`). The shared contract tests check all of this for every host.

- **Write to the profile's own file, not the resolved view.** Copying a value into a profile that inherits means adding or updating that key as an override in its own JSON. Don't flatten the whole inheritance chain into the file.
- **Let the user decide about redundant overrides ("Pin override").** When the target overrides a setting and the copied value equals what it would inherit, the override is redundant today, but it still pins the value: later changes to the parent won't reach it. Both choices are valid, so the user decides per setting:
  - Keeping the override ("Pin override" pinned) writes the value as an override.
  - Dropping it (not pinned) removes the override, re-linking the setting to the parent.
  - The defaults change no more than the copy requires. An override that already holds the value stays (pinned), so the file is untouched. One with a different value is dropped (not pinned), since the copy changes that setting anyway.
  - Where the target has no override of its own, there's no choice to make.
  - `planTransfer` lists these settings in each target plan's `redundantOverrides`, with the current choice. It takes the user's choices through `options.pinOverrides`: a map from target preset id to setting key to keep-or-not (`PinOverrides`). Settings without an entry get the default, so the UI only stores what the user changed, and re-plans when a checkbox changes.
- **System profiles are effectively read-only.** Files under `resources/profiles/` (and OrcaSlicer's installed or cached copies) get replaced on app updates. Saving targets user presets: a system preset's changes are saved as a new user preset that `inherits` from it (see "System presets save as new user presets" above).
- **Keep OrcaSlicer's value format.** Write values back as strings or string arrays, in the shape the target already uses for that key (or the source's, if the target has none). A value with several elements is always written as an array, even if the target stored a plain string. Never write native JSON numbers or booleans.
- **Fit per-variant settings to the target's variants.** OrcaSlicer stores some settings once per extruder variant (e.g. `nozzle_temperature`, `filament_flow_ratio`, `fan_max_speed`). The catalog's `keyRules(type).perVariant` lists them, from `filament_options_with_variant` / `print_options_with_variant` in `PrintConfig.cpp`. A preset's variants are listed in `filament_extruder_variant` / `print_extruder_variant` (e.g. "Direct Drive Standard", "Direct Drive High Flow"); without that list, or with an empty one, a preset has one variant.
  - **A process variant is identified by its extruder and its name.** Processes also have `print_extruder_id`, which OrcaSlicer pairs with the names (`Preset::get_extruder_names_and_keysets`). On dual-extruder printers the names repeat once per extruder (Bambu's H2D: ids `1,1,1,2,2,2,2`, names Standard, High Flow, ... once per extruder), so a name alone is ambiguous. Filaments have no extruder ids (`filament_extruder_id` is commented out in OrcaSlicer), so a filament variant is identified by name. `variantIdentities()` in `core/edit/` implements this.

  When copying:
  - If both presets list their variants and the source has every one the target has, match values by identity, so a "High Flow" value never lands in a "Standard" slot and one extruder's values never land on the other.
  - Otherwise resize the way OrcaSlicer does when it loads a preset (`extend_default_config_length` → `ConfigOptionVector::resize`): truncate, or pad by repeating the **first** value (`resizeValue`). (OrcaSlicer's code comment says "last", but the code uses `front()`.) `resolveChain` resizes resolved values the same way.
  - Other arrays (G-code lists, `compatible_printers`, ...) are copied as they are.
  - Never copy the settings that define the variants (`VARIANT_KEYS`): the variant names, and for processes the extruder ids. They define the shape of every per-variant array.

- **Keep the metadata consistent.** Leave the target's metadata keys (`METADATA_KEYS`) alone. A transfer should never copy them across.
- **Mark saved user presets for cloud sync in their `.info`.** Every user preset has a sibling `.info` (`Preset::save_info`): INI-style `key = value` lines for `sync_info`, `user_id`, `setting_id`, `base_id`, and `updated_time`, written with the platform's line endings.
  - `sync_info` tells OrcaSlicer's sync service what to do next. OrcaSlicer's editor sets it to `update` after saving an edited preset (`create` for a new one), which queues the change for upload to Orca Cloud.
  - When pulling, a cloud copy with a newer `updated_time` overwrites the local file. So a `.json` edited without updating its `.info` would never be uploaded, and could later be overwritten by the cloud copy.
  - `markPresetInfoForSync` (in `core/serialize/`) sets `sync_info = update`, except for `create` (not uploaded yet) and `delete`, and keeps every other byte. Don't touch `updated_time`; the sync service sets it after uploading.
  - An `.info` without its `.json` reads as a cloud deletion request, so never delete or create `.info` files on their own.
- **Avoid spurious diffs.** Save a file in the format it was read in, so it differs only in the keys that changed. `core/serialize/` does this: it detects each file's format and re-serializes in it.
  - **User presets** are written by OrcaSlicer's `ConfigBase::save_to_json` as canonical sorted-key JSON (nlohmann's sorted map), with a final newline and indentation that depends on the OrcaSlicer version that last saved the file.
  - **Line endings depend on the platform that saved the file:** CRLF on Windows, LF on macOS and Linux. OrcaSlicer only ever writes `\n`, and the file is opened in text mode (`write_whole_file` in `utils.cpp` uses `fopen(path, "w")`; before #15861, `boost::nowide::ofstream` without `std::ios::binary`). The C runtime turns `\n` into `\r\n` in text mode on Windows only. The serializer keeps each file's own line endings, so a file saved on one platform and edited on another stays as it was.
  - **New files** (nothing to detect from) use `orcaSlicerFormat(newline)`: tab indentation, sorted keys, a final newline, and the line endings of the platform the comparer runs on. `core` is platform-free, so the host supplies the newline. It's a required argument, so it can't be forgotten. Current versions use one tab per level (`dump(1, '\t')`); older ones used 4 spaces. A survey of 197 real user presets saved on Windows (versions 1.7–2.3) found exactly these two styles, all sorted, all CRLF. Built-in `JSON.stringify` with sorted keys reproduced every file byte for byte.
  - **Bundled profiles** use 4-space indentation and aren't necessarily sorted. The comparer never writes them (see above).
  - **String values** such as G-code contain real newlines, which JSON writes as `\n` escapes. Non-ASCII text (`℃`) is written as is, not `\u`-escaped. Vector options are arrays of each element's serialized form.
  - **Files that don't round-trip.** If a file doesn't re-serialize unchanged before any edit (e.g. someone edited it by hand), saving would reformat it. The serializer reports that, and the UI must warn before saving.
- **Make saves safe.** Take OrcaSlicer's preset lock, check for a conflict, back up the file first (see below), and write atomically (temp file, then rename). Warn that a running OrcaSlicer won't see the change until it restarts, and may overwrite the file if the user saves the same preset there.
- **Back up to a folder the app owns, never next to the original.** OrcaSlicer scans its preset folders, so stray files there (e.g. `My ABS.json.bak`) could show up as presets or confuse it.
  - Desktop: under Tauri's `appDataDir()` (e.g. `backups/<timestamp>/<path relative to the OrcaSlicer data folder>`), so every backup of one save sits together and is easy to restore.
  - The UI should tell users where backups are and offer to open the folder. Decide on pruning old backups when saving is built.
  - Plugin: back up the same way under the plugin's own storage, once plugin saving exists.
- **Only copy compatible keys.** Filament keys can only go into filament profiles and process keys into process profiles. The catalog's `keyRules(type).owned` lists them (from `Preset.cpp`). Keys OrcaSlicer doesn't define at all (Bambu Studio leftovers) are skipped as `not-owned` too.
- **Plan changes against the keys the file really holds.** A target may still store a setting under an old name that OrcaSlicer renames on load (e.g. `enable_wipe_tower`). `planTransfer` takes the legacy renames and writes the current key while removing the old one, or removes the old key when dropping a redundant override. Each `KeyChange.key` is a key as it appears in the file, so `pendingEdits` and the serializer need no legacy knowledge.
- **Explain every skipped key.** `planTransfer` returns a reason for each key it doesn't change: `metadata`, `variant-list`, `not-owned`, `missing-in-source`, or `already-equal`. The UI uses these in previews and results.
- **Apply every rule per target in a bulk copy.** Each target has its own inheritance chain, so the same copied value can be a new override in one target, redundant in another, and a different array length in a third. Resolve and validate each target on its own. Never assume what's true for one target holds for the rest.
- **Save bulk changes file by file, not all or nothing.** Each target is written atomically, but a batch can't be atomic across files. Save the targets one by one, collect a result for each, and keep failed targets' edits pending so the user can retry them. When the batch includes system presets, ask once whether to create user presets for them, and show which ones it affects.

## OrcaSlicer plugin target

What OrcaSlicer's plugin system offers today (in OrcaSlicer's `src/slic3r/plugin/`, with examples in `sandboxes/`):

- Plugins are Python 3.12 files with a `[tool.orcaslicer.plugin]` metadata header and an `@orca.plugin` class that registers capabilities.
- Plugin UI is HTML shown in OrcaSlicer's web view. There are two ways to show it:
  - **A Pages capability** (`PagesPluginCapability`) adds a **tab with an icon to OrcaSlicer's main window**. It implements `get_ui()` (returns the HTML), `get_icon()`, and `on_message(message)`, and sends to the page with `post_message(...)`. The tab appears while the plugin is enabled and disappears when it's unloaded.
  - **Windows and dock panels:** `orca.host.ui.create_window(html=...)` or `create_dock_panel(html=..., dock=...)`, opened from a script capability run from the Plugins dialog.
  - Either way, the page and Python exchange JSON through `orca.postMessage` / `orca.onMessage`, and theme colors come in as CSS variables (`--orca-fg`, `--orca-muted`, `--orca-border`, ...).
- **Plugin config storage** (PR #14746): each capability can store JSON settings with `get_config()` / `save_config(config)`. Settings are stored globally, with an optional override per preset. Users can edit them in the Plugins dialog through a JSON editor or a custom HTML page.
- `orca.host.preset_bundle()` gives read-only access to presets (`prints`, `filaments`, `printers`). Each preset has `name`, `file`, `is_system`, `is_user()`, `config_keys()`, and `config_value()` (resolved values). **There is no API to modify, save, or reload presets.**
- **Plugins are sandboxed on file access** (`PluginAuditManager`, from PR #14989). A CPython audit hook checks every file operation a plugin makes:
  - OrcaSlicer's data folder (`data_dir()`) is readable and writable. Its bundled resources folder is read-only. Any other path requires a permission the user grants.
  - Some files are always denied, even inside allowed folders: the app config (`OrcaSlicer.conf`/`.ini`), the user-secret file, and **any path where some component contains `secret`, `cert`, or `conf`** (case-insensitive).
  - The keyword match is a plain substring test on every folder and file name in the path. Issue [#15944](https://github.com/OrcaSlicer/OrcaSlicer/issues/15944) (open) reports that it blocks numpy, stdlib modules such as `configparser.py`, `certifi/cacert.pem`, and user folders like `Concert`. The only workaround is to import everything when the plugin loads, because only capability calls are checked.
  - **Probable Linux blocker (found by reading the code, not tested, and not yet reported upstream):** on Linux, `data_dir()` defaults to `~/.config/OrcaSlicer`, and `.config` contains `conf`. As written, every file access a plugin makes inside a checked call would be denied on Linux, presets included. A preset file whose name contains one of those keywords (e.g. "…Certified…") would also be denied on every OS.
  - The audit only covers calls into capabilities (`execute`, a Pages capability's `get_ui` and `on_message`, and so on). The `on_message` callbacks passed to `create_window`/`create_dock_panel` currently run without an audit scope. Treat that as a gap that will probably be closed, not as a feature.
- **Status** (from [discussion #14878](https://github.com/OrcaSlicer/OrcaSlicer/discussions/14878), the maintainers' feedback thread):
  - Plugins are nightly-only and "experimental and subject to change". The APIs and capability types "may change significantly".
  - There's no release date and no versioning promise.
  - Maintainers have nothing against plugins that read and write, but they haven't committed to a preset write API.
- **How a third-party plugin saves presets today** (FilamentHub, a community plugin described in the discussion):
  - It writes the preset `.json` and `.info` files directly under `data_dir`, finding the folder from `preset.file` rather than from the app config.
  - It then either does an experimental targeted refresh or asks the user to restart OrcaSlicer.
  - The host can't reload a single preset, and the plugin has to handle name collisions itself.
  - Community members have requested a preset write API, targeted refresh, and preset change events, but nothing has been committed.
- **Related issue:** [#14832](https://github.com/OrcaSlicer/OrcaSlicer/issues/14832) (closed) was a crash when transferring changed settings between printer presets while a Python plugin was loaded. It's worth retesting the comparer's save flow against that scenario.
- **Further reading:**
  - [Plugin system (developer reference)](https://www.orcaslicer.com/wiki/developer_reference/plugin_development/plugin_system.html)
  - [Getting started with plugins](https://www.orcaslicer.com/wiki/plugins/plugins_getting_started.html)
  - [Plugin types](https://github.com/OrcaSlicer/OrcaSlicer/wiki/plugins_types)
  - PRs [#14530](https://github.com/OrcaSlicer/OrcaSlicer/pull/14530) (Python plugins), [#14746](https://github.com/OrcaSlicer/OrcaSlicer/pull/14746) (plugin config; discussion #14878 mislabels it "isolated preset refresh"), and [#14989](https://github.com/OrcaSlicer/OrcaSlicer/pull/14989) (auditing). All three were merged into OrcaSlicer `main` as of October 2026.

Directives:

- **Ship the plugin as a Pages capability.** A main-window tab is the most discoverable entry point, and its message calls run inside the audit scope, the same as a future, tighter sandbox would require. Add a script capability that opens it in a window only if a pop-out view turns out to be needed.
- **Build the UI as one self-contained HTML file** (Vite + `vite-plugin-singlefile`), so the plugin can return it from `get_ui()` (or pass it to `create_window`). Don't rely on loading extra assets at runtime.
- **Design the plugin's file I/O for the strictest sandbox.** Assume every read and write is checked, even the ones that currently aren't. Use the Python standard library only (no third-party packages). Import everything when the plugin loads, so lazy imports don't trip the keyword filter.
- **Keep comparer settings behind the `SettingsStore` port.** Store user preferences (such as default filters or recent comparisons) through it. The plugin adapter implements it with `get_config`/`save_config` and the desktop adapter with a local file. The UI never knows which.
- **Keep the Python layer thin.** It may only translate bridge messages into `orca.host` calls and file I/O, and back. No diffing, resolution, or business logic belongs in Python.
- **Keep every `orca.*` reference** in the Python files and every bridge detail in `host-orca`. A plugin API change should touch only those two.
- **Version the bridge protocol.** Define the message types once in `bridge-protocol`, include a protocol version in a handshake, and validate every message on both sides.
- **Style through design tokens.** The plugin build maps the UI's tokens onto `--orca-*` (see "UI/UX rules").
- **Keep to features all three OS web views support.** Set the build's browser targets to match WebView2, WebKit, and WebKitGTK, and test on all three.
- **Treat plugin saving as unresolved.** Without a preset write API, saving means writing files directly while OrcaSlicer holds presets in memory and may overwrite them or not reload them.
  - Report `canSave: false` from the plugin adapter until saving has been tested on all three OSes. Linux is blocked until the `conf` keyword problem above is fixed upstream (follow #15944).
  - When saving is enabled, model what the user must do after a save as part of the save result (for example `reloadRequired: "restart"`). The UI should tell the user what to do instead of assuming the change took effect.
  - Recheck discussion #14878 and the wiki for a write, reload, or change-event API before building this. If one appears, implement it only in the plugin adapter and the Python layer.
- **Expect file-access denials.** The audit hook can refuse a read or write, or prompt the user for permission. The plugin adapter must turn those refusals into typed errors in `core` (for example `AccessDenied` with the path), and the UI must explain them. Never let them surface as raw Python exceptions or crash the plugin.
- **Expect the plugin API to change.** It's new. Pin the OrcaSlicer version range the plugin is tested against, and detect missing APIs at startup instead of failing partway through.

## Open questions

- **Plugin packaging format.** The build currently produces one `.py` file, like OrcaSlicer's sample plugins. Issue #15944 mentions plugins packaged as wheels, which would allow shipping the page and an icon as separate files. Check the plugin wiki before changing `apps/orca-plugin/scripts/build-plugin.ts`.
