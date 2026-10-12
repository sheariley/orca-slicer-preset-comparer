# /// script
# requires-python = ">=3.12"
#
# [tool.orcaslicer.plugin]
# name = "Preset Comparer"
# description = "Compare filament and process presets side by side."
# author = "sheariley"
# version = "0.1.0"
# ///
"""OrcaSlicer glue for the Preset Comparer: a main-window tab (Pages capability).

Every `orca.*` reference lives in this file. The protocol handling is in comparer_bridge.py;
`pnpm build:plugin` inlines it and the built page into one plugin file.
"""

import os
from pathlib import Path

import orca

# build:begin-bridge
from comparer_bridge import BridgeError, handle_message
# build:end-bridge

# build:begin-page
PAGE_HTML = (Path(__file__).parent.parent / "dist" / "web" / "index.html").read_text("utf-8")
# build:end-page

_COLLECTIONS = {"filament": "filaments", "process": "prints"}


class OrcaPresetHost:
    """Answers bridge requests from orca.host.preset_bundle(). Read-only for now."""

    def capabilities(self):
        return {"canSave": False, "canBrowseFiles": False, "canWatchForChanges": False}

    def list_presets(self, type_name):
        types = [type_name] if type_name else list(_COLLECTIONS)
        return [_ref(preset, t) for t in types for preset in self._presets(t)]

    def newline(self):
        # OrcaSlicer writes files in text mode: CRLF on Windows, LF elsewhere.
        return "\r\n" if os.name == "nt" else "\n"

    def read_text(self, ref):
        preset = self._find(ref["type"], ref["name"])
        if preset is None:
            raise BridgeError("not-found", f'No preset "{ref["name"]}".', ref["id"])
        # newline="" keeps the file's line endings; text mode would turn CRLF into LF.
        with open(preset.file, encoding="utf-8", newline="") as file:
            return file.read()

    def resolve_parent(self, child, parent_name):
        preset = self._find(child["type"], parent_name)
        return _ref(preset, child["type"]) if preset is not None else None

    def save_text(self, ref, text, previous_text):
        raise BridgeError("unsupported", "Saving isn't supported in the plugin yet.")

    def _collection(self, type_name):
        if type_name not in _COLLECTIONS:
            raise BridgeError("unsupported", f"Unsupported preset type {type_name!r}.")
        return getattr(orca.host.preset_bundle(), _COLLECTIONS[type_name])

    def _presets(self, type_name):
        collection = self._collection(type_name)
        for name in collection.preset_names():
            preset = collection.find_preset(name)
            if preset is not None and not preset.is_default and preset.file:
                yield preset

    def _find(self, type_name, name):
        preset = self._collection(type_name).find_preset(name)
        return preset if preset is not None and preset.file else None


def _ref(preset, type_name):
    ref = {
        "id": f"{type_name}:{preset.name}",
        "name": preset.name,
        "type": type_name,
        "origin": "system" if preset.is_system else "user",
    }
    if preset.is_system:
        # System preset files sit in <vendor>/<type>/<name>.json.
        ref["vendor"] = Path(preset.file).parent.parent.name
    return ref


_HOST = OrcaPresetHost()


class ComparerPage(orca.pages.PagesPluginCapabilityBase):
    def get_name(self):
        return "Preset Comparer"

    def get_ui(self):
        return PAGE_HTML

    def on_message(self, message):
        self.post_message(handle_message(message, _HOST))


@orca.plugin
class PresetComparerPlugin(orca.base):
    def register_capabilities(self):
        orca.register_capability(ComparerPage)
