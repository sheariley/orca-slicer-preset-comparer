# Changelog

All notable changes to the Preset Comparer are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

The first release: a desktop app for Windows, macOS, and Linux. The macOS and Linux builds haven't been tested on those systems yet, so treat them as experimental.

### Added

- **Compare presets:** pick a filament or process preset as the base and any number of others as targets. The table shows the settings that differ, by OrcaSlicer's labels and values, grouped under OrcaSlicer's settings-tab sections, and says where each value comes from (the preset itself, a parent, or OrcaSlicer's default). Old settings and values are read the way OrcaSlicer reads them.
- **Copy settings:** select settings and copy them from the base to every target in one step, after a preview of each target. Undo and redo. A copy that makes an override redundant asks whether to keep it ("Pin override").
- **Save:** writes only what changed, in OrcaSlicer's own format, under OrcaSlicer's preset lock, with a backup of every file first and a result for each preset. Changes to a system preset are saved as a new user preset that inherits from it. Saved presets are marked for Orca Cloud sync.
- **Choose presets:** filter by name, vendor, and printer; system presets and templates are hidden until asked for.
- **Settings:** use another OrcaSlicer data folder, e.g. a portable install.
- **OrcaSlicer plugin (experimental):** `orca_preset_comparer.py` compares presets inside OrcaSlicer's plugin system (nightly builds only). It's read-only and hasn't been tested inside OrcaSlicer yet.

[0.1.0]: https://github.com/sheariley/orca-slicer-preset-comparer/releases/tag/v0.1.0
