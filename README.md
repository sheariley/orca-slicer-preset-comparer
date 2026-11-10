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

## Using the comparer

The comparer reads your presets from OrcaSlicer's data folder, which it finds on its own: `%APPDATA%\OrcaSlicer` on Windows, `~/Library/Application Support/OrcaSlicer` on macOS, and `~/.config/OrcaSlicer` on Linux. For a portable install or a second OrcaSlicer build, open **Settings** (the gear at the top right) and choose that build's data folder.

### Compare presets

1. Choose **Filament** or **Process** at the top.
2. **Choose base:** pick the preset to compare the others with, and to copy settings from.
3. **Choose targets:** pick one or more presets to compare with the base. Each one gets its own column in the table.

In both pickers you can filter by name, vendor, and printer, and turn on **Show system presets** to include OrcaSlicer's built-in presets. Each picker remembers its filters. If the same preset name appears more than once, a badge tells them apart: "default" for the folder OrcaSlicer uses while you're signed out, and "account" for your Orca Cloud account's folder.

The table lists settings by OrcaSlicer's names, grouped under the same sections as OrcaSlicer's settings tabs. Above it:

- **Only differences** (on by default) shows only the settings where a target differs from the base. Turn it off to see every setting.
- **Group by section** turns the section headings on or off.
- **Hide unused** hides keys that OrcaSlicer ignores, such as leftovers from Bambu Studio.
- **Filter settings** finds a setting by its name or its key.

Hover over a setting's info icon, or tap it, for OrcaSlicer's description and where each value comes from: the preset itself, one of its parents, or OrcaSlicer's default (shown in italics). If a target can't be opened, for example because its parent preset no longer exists, it's left out of the table with a message saying why.

### Copy settings

Settings only ever copy from the base to the targets. To copy the other way, choose the other preset as the base.

1. Tick the settings to copy in the table's first column. Each section has its own select-all.
2. Choose **Copy selected to** (it names the target, or says how many there are).
3. Check the preview, which shows each target's current and new value, and the targets that already match. You can leave out a target here.
4. Sometimes a target sets a value that equals what it would get from its parent anyway. The preview then shows a **Pin override** toggle for that setting. Keep it pinned to keep the value fixed in that preset, or unpin it to drop the override so the preset follows its parent again.
5. Apply the copy.

Changed values are marked in the table until you save, and **Undo** and **Redo** (Ctrl+Z and Ctrl+Y, or ⌘ on macOS) step through your copies. The comparer asks before you lose unsaved changes, for example when you choose another base or close the window.

### Save

Choose **Save** and check the list of changes. Each preset is saved on its own, and the results say which were saved and which failed. A failed preset keeps its changes so you can try again. If a preset changed on disk while you were working (for example, you saved it in OrcaSlicer), choose **Reload from disk and keep my changes**.

- **User presets** are saved in place, with only the changed settings written, in OrcaSlicer's own format. They're also marked so Orca Cloud uploads the change on its next sync.
- **System presets** are never changed. Their changes are saved as a new user preset that inherits from the system preset. You name it in the save dialog; the default is "<name> - Copy".

**Restart OrcaSlicer to see saved changes.** OrcaSlicer reads presets when it starts. It's best to close OrcaSlicer before saving: if you edit and save the same preset in a running OrcaSlicer, it overwrites the comparer's changes.

### Backups

Before saving, the comparer copies every file it's about to change into its own folder. It never puts backups next to your presets, where OrcaSlicer would find them. Each save gets a folder named after its date and time, holding the files at the same paths they have under OrcaSlicer's data folder:

- Windows: `%APPDATA%\io.github.sheariley.orca-preset-comparer\backups`
- macOS: `~/Library/Application Support/io.github.sheariley.orca-preset-comparer/backups`
- Linux: `~/.local/share/io.github.sheariley.orca-preset-comparer/backups`

To undo a save by hand, close OrcaSlicer and copy the files from a backup folder back into OrcaSlicer's data folder.

### Limits

- Only filament and process presets can be compared, not printer presets.
- Presets come from OrcaSlicer's data folder; opening a preset file from somewhere else isn't supported yet.
- Old backups aren't deleted automatically yet.
- The macOS and Linux builds haven't been tested on those systems yet.
- The OrcaSlicer plugin is experimental and read-only. It needs an OrcaSlicer nightly build, and it hasn't been tested inside OrcaSlicer yet.

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
