# OrcaSlicer Preset Comparer

Compare an OrcaSlicer filament or process preset with any number of others, see exactly which settings differ, copy settings from one preset to the rest, and save them back to OrcaSlicer's folder. Runs as a desktop app on Windows, macOS, and Linux, and later as an OrcaSlicer plugin.

**Status:** early development. Comparing, copying, and saving work in the desktop app; the plugin is read-only for now.

## Prerequisites

- Node.js 22 or later, and pnpm 12 (`npm install -g pnpm@12`)
- Python 3.12 or later, for the plugin's Python tests
- For the desktop app: Rust and [Tauri's system prerequisites](https://tauri.app/start/prerequisites/)

## Commands

```bash
pnpm install
pnpm dev:playground   # the UI in a browser, using sample profiles
pnpm dev:desktop      # the Tauri desktop app, reading your OrcaSlicer profiles
pnpm test             # TypeScript tests
pnpm test:python      # plugin Python tests
pnpm lint             # ESLint + dependency rules
pnpm typecheck
pnpm build:desktop
pnpm build:plugin     # writes apps/orca-plugin/dist/orca_profile_comparer.py
```

## Contributing

Read [AGENTS.md](AGENTS.md) first. It covers the architecture, the package dependency rules, and the OrcaSlicer details the code relies on. [docs/architecture.md](docs/architecture.md) has a diagram of how the pieces fit, and [TASKS.md](TASKS.md) lists open work.
