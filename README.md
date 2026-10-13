# OrcaSlicer Preset Comparer

Compare an OrcaSlicer filament or process preset with any number of others, see exactly which settings differ, copy settings from one preset to the rest, and save them back to OrcaSlicer's folder. Runs as a desktop app on Windows, macOS, and Linux, and later as an OrcaSlicer plugin.

## Status

In development, with no release yet: build it from source (below). The desktop app is complete enough for daily use and has been tested against a real OrcaSlicer folder on Windows.

What works in the desktop app:

- **Comparing:** pick a base preset and any number of targets; the table shows every setting that differs, by OrcaSlicer's labels and values, grouped under OrcaSlicer's settings-tab sections, and says where each value comes from. Old settings and values are read the way OrcaSlicer reads them.
- **Copying:** select settings and copy them from the base to every target, after a preview of each, as one undoable step. A copy that makes an override redundant asks whether to keep it ("Pin override").
- **Saving:** writes only what changed, in OrcaSlicer's own format, under its preset lock, with a backup first and a result per preset. Changes to a system preset are saved as a new user preset that inherits from it. OrcaSlicer picks up saved presets after a restart.
- **Choosing presets:** filter by name, vendor, and printer; system presets and templates are hidden until asked for.
- **Settings:** another OrcaSlicer data folder (portable installs, a second build) can be chosen.

Not yet:

- Installers: only builds from source for now.
- The OrcaSlicer plugin: it builds and compares (read-only), but hasn't been tested inside OrcaSlicer, whose plugin system is still nightly-only.
- Opening a preset file from outside OrcaSlicer's folder.

See [TASKS.md](TASKS.md) for everything planned.

## Prerequisites

- Node.js 22 or later, and pnpm 12 (`npm install -g pnpm@12`)
- Python 3.12 or later, for the plugin's Python tests
- For the desktop app: Rust and [Tauri's system prerequisites](https://tauri.app/start/prerequisites/)

## Commands

```bash
pnpm install
pnpm dev:playground   # the UI in a browser, using sample presets
pnpm dev:desktop      # the Tauri desktop app, reading your OrcaSlicer presets
pnpm test             # TypeScript tests
pnpm test:python      # plugin Python tests
pnpm lint             # ESLint + dependency rules
pnpm typecheck
pnpm build:desktop
pnpm build:plugin     # writes apps/orca-plugin/dist/orca_preset_comparer.py
```

## Contributing

Read [AGENTS.md](AGENTS.md) first. It covers the architecture, the package dependency rules, and the OrcaSlicer details the code relies on. [docs/architecture.md](docs/architecture.md) has a diagram of how the pieces fit, and [TASKS.md](TASKS.md) lists open work.

## License

[GNU Affero General Public License, version 3](LICENSE) (AGPL-3.0-only), the same as OrcaSlicer, whose setting definitions and profiles the comparer builds on.
