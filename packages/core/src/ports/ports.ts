import type { PresetRef, ProfileDocument, ProfileType, RawValue } from '../model/profile.ts';
import type { LegacyKeys } from '../resolve/resolve-chain.ts';
import type { TextFormat } from '../serialize/serialize-profile.ts';

/**
 * What a host can do. The app and UI adapt to these flags instead of checking which host
 * they're running in.
 */
export interface HostCapabilities {
  readonly canSave: boolean;
  readonly canBrowseFiles: boolean;
  readonly canWatchForChanges: boolean;
}

export interface PresetQuery {
  readonly type?: ProfileType;
}

/** The result of saving one document. Hosts report what the user must do next. */
/** A request to write one profile file. */
export interface SaveRequest {
  readonly ref: PresetRef;
  /** The complete new file text. Hosts write it exactly; they never re-serialize. */
  readonly text: string;
  /**
   * What the file held when it was read. If it holds something else now (e.g. OrcaSlicer saved
   * it meanwhile), the host refuses with a `conflict` error instead of overwriting.
   */
  readonly previousText: string | undefined;
  /**
   * Saves that share a batch id belong to one user action. Hosts can use it to group work, e.g.
   * putting every backup from one save in the same folder.
   */
  readonly batch?: string;
}

/** A new user preset to create (see ProfileRepository.createPreset). */
export interface CreatePresetRequest {
  readonly type: ProfileType;
  readonly name: string;
  /**
   * The preset's content, without `version`: the host adds that from the parent's vendor bundle,
   * as OrcaSlicer does, and writes the file in OrcaSlicer's format for new files.
   */
  readonly content: Readonly<Record<string, unknown>>;
  /** The preset it inherits from. Hosts use it for cloud-sync bookkeeping (`base_id`). */
  readonly parent: PresetRef;
  /** See SaveRequest.batch. */
  readonly batch?: string;
}

export interface SaveResult {
  readonly ref: PresetRef;
  /** What the user must do before OrcaSlicer sees the change. */
  readonly reloadRequired: 'none' | 'reselect-preset' | 'restart';
}

/** Access to profile documents. Every host implements this. */
export interface ProfileRepository {
  readonly capabilities: HostCapabilities;
  listPresets(query?: PresetQuery): Promise<readonly PresetRef[]>;
  readDocument(ref: PresetRef): Promise<ProfileDocument>;
  /**
   * Finds a preset that `child` refers to by name: the parent it inherits from, or a template it
   * includes. The host decides the lookup scope (same vendor folder, shared libraries, ...).
   * Resolves to undefined when there's no match.
   */
  resolveParent(child: PresetRef, parentName: string): Promise<PresetRef | undefined>;
  saveDocument(request: SaveRequest): Promise<SaveResult>;
  /**
   * Creates a user preset in the folder OrcaSlicer saves new presets to, with whatever else the
   * host keeps next to it (the desktop's `.info`). Refuses with `name-taken` when a preset of the
   * same type already has the name. `SaveResult.ref` is the new preset.
   */
  createPreset(request: CreatePresetRequest): Promise<SaveResult>;
  /**
   * The platform's line endings, for brand-new files only: OrcaSlicer writes "\r\n" on Windows
   * and "\n" elsewhere. Existing files keep their own (see core/serialize).
   */
  readonly newline: TextFormat['newline'];
}

/** Human-readable metadata for one setting key. */
export interface SettingInfo {
  readonly key: string;
  readonly label: string;
  /** Group used to organize the diff view (OrcaSlicer's category). */
  readonly group?: string;
  readonly tooltip?: string;
  /** Unit text shown after the value (e.g. "mm³/s"). */
  readonly unit?: string;
}

export interface SettingCatalog {
  describe(key: string): SettingInfo | undefined;
  /**
   * OrcaSlicer's built-in default for every setting a preset of this type owns. Root presets
   * (no `inherits`) start from these. Empty for types the catalog doesn't cover.
   */
  defaultsFor(type: ProfileType): ReadonlyMap<string, RawValue>;
  /** The obsolete and renamed keys OrcaSlicer migrates when it loads a profile. */
  legacyKeys(): LegacyKeys;
  /** Which settings a preset of this type owns, and which of those are stored per variant. */
  keyRules(type: ProfileType): KeyRules;
}

export interface KeyRules {
  /** Settings this preset type owns (OrcaSlicer's Preset.cpp option lists). Empty = unknown. */
  readonly owned: ReadonlySet<string>;
  /**
   * Settings stored once per extruder variant, whose arrays OrcaSlicer resizes to the length of
   * the preset's variant list (`*_options_with_variant` in PrintConfig.cpp).
   */
  readonly perVariant: ReadonlySet<string>;
}

/** Persistent user preferences (default filters, recent comparisons, ...). */
/**
 * Lets the UI keep the host's window or page from closing, e.g. to ask about unsaved changes
 * first. Hosts that can't intercept closing don't provide one.
 */
export interface CloseGuard {
  /**
   * Calls `mayClose` each time the user asks to close. Returning false keeps it open (the UI
   * then asks, and calls `close` if the user agrees). Returns a function that unsubscribes.
   */
  onCloseRequested(mayClose: () => boolean): () => void;
  /** Closes for real, without asking `mayClose` again. */
  close(): void;
}

/**
 * The comparer's own preferences (layout, filters, ...), kept by the host: a local file on the
 * desktop, the plugin config inside OrcaSlicer. Values must survive a JSON round trip.
 */
export interface SettingsStore {
  /** Everything saved so far; {} when nothing is. */
  load(): Promise<Readonly<Record<string, unknown>>>;
  /** Replaces everything saved with `settings`. */
  save(settings: Readonly<Record<string, unknown>>): Promise<void>;
}
