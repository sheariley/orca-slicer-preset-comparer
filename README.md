# OrcaSlicer Preset Comparer

Compare an OrcaSlicer filament or process preset with any number of others, see exactly which settings differ, copy settings from one preset to the rest, and save them back to OrcaSlicer's folder. Runs as a desktop app on Windows, macOS, and Linux, and later as an OrcaSlicer plugin.

## Status

In development, heading for a first release (0.1.0). The desktop app is complete enough for daily use and has been tested against a real OrcaSlicer folder on Windows; the macOS and Linux builds haven't been tested on those systems yet.

What works in the desktop app:

- **Comparing:** pick a base preset and any number of targets; the table shows every setting that differs, by OrcaSlicer's labels and values, grouped under OrcaSlicer's settings-tab sections, and says where each value comes from. Old settings and values are read the way OrcaSlicer reads them.
- **Copying:** select settings and copy them from the base to every target, after a preview of each, as one undoable step. A copy that makes an override redundant asks whether to keep it ("Pin override").
- **Saving:** writes only what changed, in OrcaSlicer's own format, under its preset lock, with a backup first and a result per preset. Changes to a system preset are saved as a new user preset that inherits from it. OrcaSlicer picks up saved presets after a restart.
- **Choosing presets:** filter by name, vendor, and printer; system presets and templates are hidden until asked for.
- **Settings:** another OrcaSlicer data folder (portable installs, a second build) can be chosen.

Not yet:

- The OrcaSlicer plugin: it builds and compares (read-only), but hasn't been tested inside OrcaSlicer, whose plugin system is still nightly-only.
- Opening a preset file from outside OrcaSlicer's folder.

See [TASKS.md](TASKS.md) for everything planned.

## Installing

Download the installer for your system from the [latest release](https://github.com/sheariley/orca-slicer-preset-comparer/releases/latest). The installers aren't signed yet, so Windows and macOS warn the first time you open them.

- **Windows 10 or 11:** run `OrcaSlicer-Preset-Comparer_<version>_x64-setup.exe` (or the `.msi`). If SmartScreen says "Windows protected your PC", choose **More info**, then **Run anyway**.
- **macOS:** open the `.dmg` for your Mac (`aarch64` for Apple Silicon, `x64` for Intel) and drag the app to Applications. The first time you open it, macOS says it can't verify the app: open **System Settings › Privacy & Security**, scroll down, and choose **Open Anyway**.
- **Linux:** install the `.deb` (`sudo apt install ./OrcaSlicer-Preset-Comparer_<version>_amd64.deb`), or make the `.AppImage` executable (`chmod +x`) and run it. AppImages need FUSE 2 (`libfuse2`, or `libfuse2t64` on Ubuntu 24.04 and later).

Close OrcaSlicer before saving presets with the comparer, and restart it afterwards to see the changes.

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
