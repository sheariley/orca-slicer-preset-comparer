import {
  ComparerError,
  applyEdits,
  diffAgainstBase,
  diffProfiles,
  isComparerError,
  newUserPresetContent,
  orcaSlicerFormat,
  planTransfer,
  resolveChain,
  serializeProfile,
  suggestedPresetName,
  type BaseDiffRow,
  type DiffRow,
  type HostCapabilities,
  type PresetQuery,
  type PresetRef,
  type ProfileRepository,
  type ProfileType,
  type ResolvedProfile,
  type ResolveOptions,
  type SaveResult,
  type SettingCatalog,
  type SettingInfo,
  type PinOverrides,
  type ProfileEdits,
  type CloseGuard,
  type SettingsStore,
  type TransferPlan,
} from '@comparer/core';
import {
  addToSession,
  createSession,
  editedDocument,
  inheritedEdited,
  markSaved,
  pending,
  presetIn,
  recordBatch,
  reloadPreset,
  removeFromSession,
  resolveEdited,
  savedAsNewPreset,
  type EditSession,
} from './session/session.ts';
import { createPreferences, type Preferences } from './preferences.ts';
import { loadPresetDocuments, loadResolved } from './use-cases/load-resolved.ts';

export interface ComparerDependencies {
  readonly repository: ProfileRepository;
  readonly catalog: SettingCatalog;
  /** The host's window close hook, where it has one. */
  readonly closeGuard?: CloseGuard;
  /** Where the host keeps the comparer's preferences. Without one, they last the session. */
  readonly settings?: SettingsStore;
}

export interface Comparison {
  readonly left: ResolvedProfile;
  readonly right: ResolvedProfile;
  readonly rows: readonly DiffRow[];
}

/** A base preset compared with each of several targets (see core's diffAgainstBase). */
export interface BaseComparison {
  readonly base: ResolvedProfile;
  /** In the order asked for. */
  readonly targets: readonly ResolvedProfile[];
  readonly rows: readonly BaseDiffRow[];
}

/** Copy `keys` from one open preset to one or more others (all ids of presets in the session). */
export interface CopyRequest {
  readonly source: string;
  readonly targets: readonly string[];
  readonly keys: readonly string[];
  /** The user's "Pin override" choices (see core's RedundantOverride). */
  readonly pinOverrides?: PinOverrides;
}

/** What happened to one target when saving. */
export type TargetSaveResult =
  | {
      readonly status: 'saved';
      readonly target: PresetRef;
      readonly reloadRequired: SaveResult['reloadRequired'];
      /** The file wasn't in canonical form, so saving reformatted all of it. */
      readonly reformatted: boolean;
    }
  /** A system preset's changes, saved as a new user preset that inherits from it. */
  | {
      readonly status: 'created';
      /** The system preset, which is left as it was. */
      readonly target: PresetRef;
      readonly created: PresetRef;
      readonly reloadRequired: SaveResult['reloadRequired'];
    }
  /** A system preset with no name given for its new user preset: nothing was written. */
  | { readonly status: 'needs-user-preset'; readonly target: PresetRef }
  /** Nothing was written; the target's edits stay pending so the user can retry. */
  | { readonly status: 'failed'; readonly target: PresetRef; readonly error: ComparerError };

/** What saving would do to one preset with pending edits (for the confirmation before saving). */
export interface SavePreview {
  readonly target: PresetRef;
  /**
   * `ready`: will be written. `new-user-preset`: a system preset, which is never written; its
   * changes go into a new user preset that inherits from it, once the user names it.
   */
  readonly status: 'ready' | 'new-user-preset';
  /** For `new-user-preset`: OrcaSlicer's suggested name ("<name> - Copy"). */
  readonly suggestedName?: string;
  /** The keys the save sets or removes in the preset's file. */
  readonly keys: readonly string[];
  /** The file isn't in canonical form (e.g. edited by hand), so saving will reformat all of it. */
  readonly reformatted: boolean;
}

export interface SaveOptions {
  /**
   * The name of the new user preset for each system preset with pending changes (by the system
   * preset's id). A system preset without one is reported as `needs-user-preset`.
   */
  readonly newPresetNames?: ReadonlyMap<string, string>;
}

/** The use cases the UI calls. The UI never talks to a host directly. */
export interface ComparerApp {
  readonly capabilities: HostCapabilities;
  /** Set when the host can keep its window from closing (to ask about unsaved changes). */
  readonly closeGuard: CloseGuard | undefined;
  /** The user's preferences (layout, filters, ...). */
  readonly preferences: Preferences;
  listPresets(query?: PresetQuery): Promise<readonly PresetRef[]>;
  loadResolved(ref: PresetRef): Promise<ResolvedProfile>;
  compare(left: PresetRef, right: PresetRef): Promise<Comparison>;
  describeSetting(key: string): SettingInfo | undefined;

  /** Loads presets (with their parent chains and included templates) for editing. */
  openSession(refs: readonly PresetRef[]): Promise<EditSession>;
  /**
   * Opens more presets in a session, e.g. the targets of a bulk copy. Presets already open
   * keep their state, and so does the history.
   */
  addPresets(session: EditSession, refs: readonly PresetRef[]): Promise<EditSession>;
  /** Closes presets in a session, dropping their pending edits (see removeFromSession). */
  removePresets(session: EditSession, ids: readonly string[]): EditSession;
  /** Compares two open presets as they currently stand, pending edits included. */
  compareEdited(session: EditSession, left: string, right: string): Comparison;
  /** Compares an open base preset with open targets, as they currently stand. */
  compareTargets(session: EditSession, base: string, targets: readonly string[]): BaseComparison;
  /** What a copy would do, without recording it (for previews and "Pin override" choices). */
  previewCopy(session: EditSession, request: CopyRequest): TransferPlan;
  /** Plans a copy and records it as one undoable step. */
  copy(
    session: EditSession,
    request: CopyRequest,
    label?: string,
  ): { session: EditSession; plan: TransferPlan };
  /**
   * Re-reads presets from the host (e.g. after a `conflict`), keeping the edit history: pending
   * copies are replayed on top of what's on disk now (see reloadPreset).
   */
  reloadPresets(session: EditSession, ids: readonly string[]): Promise<EditSession>;
  /** What `saveChanges` would write, without writing anything. */
  previewSave(session: EditSession): SavePreview[];
  /**
   * Saves every preset with pending edits, one file at a time. One failure doesn't stop the
   * others; failed targets keep their pending edits.
   */
  saveChanges(
    session: EditSession,
    options?: SaveOptions,
  ): Promise<{ session: EditSession; results: TargetSaveResult[] }>;
}

export function createComparerApp({
  repository,
  catalog,
  closeGuard,
  settings,
}: ComparerDependencies): ComparerApp {
  const resolveOptions = (type: ProfileType): ResolveOptions => ({
    defaults: catalog.defaultsFor(type),
    legacyKeys: catalog.legacyKeys(),
    perVariant: catalog.keyRules(type).perVariant,
  });
  const resolve = (ref: PresetRef) => loadResolved(repository, ref, resolveOptions(ref.type));
  /** An open preset in its current, edited state. */
  const resolveOpen = (session: EditSession, id: string) =>
    resolveEdited(session, id, resolveOptions(presetIn(session, id).ref.type));

  const plan = (session: EditSession, request: CopyRequest): TransferPlan => {
    const source = presetIn(session, request.source).ref;
    const targets = request.targets.map((id) => {
      const { ref } = presetIn(session, id);
      const options = resolveOptions(ref.type);
      return {
        // Planned against the edited state, so a copy builds on earlier, unsaved ones.
        document: editedDocument(session, id),
        resolved: resolveEdited(session, id, options),
        inherited: inheritedEdited(session, id, options),
        rules: catalog.keyRules(ref.type),
      };
    });
    return planTransfer(
      resolveEdited(session, request.source, resolveOptions(source.type)),
      request.keys,
      targets,
      {
        legacyKeys: catalog.legacyKeys(),
        ...(request.pinOverrides ? { pinOverrides: request.pinOverrides } : {}),
      },
    );
  };

  /** A preset's file as saving would write it: its current text with `edits` applied. */
  const prepareSave = (session: EditSession, target: PresetRef, edits: ProfileEdits) => {
    const original = presetIn(session, target.id).chain[0]!;
    const fallback = orcaSlicerFormat(repository.newline);
    // Hosts always provide the text; documents built in memory may not.
    const originalText = original.text ?? serializeProfile(original.content, fallback);
    return { previousText: original.text, ...applyEdits(originalText, edits, fallback) };
  };

  /**
   * Writes a system preset's pending changes into a new user preset named `name` that inherits
   * from it (see core's newUserPresetContent), and reads it back for the session.
   */
  const createFromSystemPreset = async (
    session: EditSession,
    target: PresetRef,
    name: string,
    batch: string,
  ) => {
    const options = resolveOptions(target.type);
    const { chain, templates } = presetIn(session, target.id);
    const content = newUserPresetContent({
      name,
      parent: resolveChain(chain, { ...options, templates }),
      edited: resolveEdited(session, target.id, options),
    });
    const saved = await repository.createPreset({
      type: target.type,
      name,
      content,
      parent: target,
      batch,
    });
    const files = await loadPresetDocuments(repository, saved.ref);
    return { files: { ref: saved.ref, ...files }, reloadRequired: saved.reloadRequired };
  };

  return {
    capabilities: repository.capabilities,
    closeGuard,
    preferences: createPreferences(settings),
    listPresets: (query) => repository.listPresets(query),
    loadResolved: resolve,
    async compare(leftRef, rightRef) {
      const [left, right] = await Promise.all([resolve(leftRef), resolve(rightRef)]);
      return { left, right, rows: diffProfiles(left, right) };
    },
    describeSetting: (key) => catalog.describe(key),

    async openSession(refs) {
      const loaded = await Promise.all(refs.map((ref) => loadPresetDocuments(repository, ref)));
      return createSession(loaded.map((files, index) => ({ ref: refs[index]!, ...files })));
    },

    async addPresets(session, refs) {
      const missing = refs.filter((ref) => !session.presets.has(ref.id));
      const loaded = await Promise.all(missing.map((ref) => loadPresetDocuments(repository, ref)));
      return addToSession(
        session,
        loaded.map((files, index) => ({ ref: missing[index]!, ...files })),
      );
    },

    removePresets: removeFromSession,

    compareEdited(session, leftId, rightId) {
      const left = resolveOpen(session, leftId);
      const right = resolveOpen(session, rightId);
      return { left, right, rows: diffProfiles(left, right) };
    },

    compareTargets(session, baseId, targetIds) {
      const base = resolveOpen(session, baseId);
      const targets = targetIds.map((id) => resolveOpen(session, id));
      return { base, targets, rows: diffAgainstBase(base, targets) };
    },

    previewCopy: plan,

    copy(session, request, label) {
      const transfer = plan(session, request);
      const names = request.targets.map((id) => presetIn(session, id).ref.name).join(', ');
      const count = request.keys.length;
      const batchLabel = label ?? `Copy ${count} setting${count === 1 ? '' : 's'} to ${names}`;
      return {
        session: recordBatch(session, { label: batchLabel, plan: transfer }),
        plan: transfer,
      };
    },

    async reloadPresets(session, ids) {
      const loaded = await Promise.all(
        ids.map((id) => loadPresetDocuments(repository, presetIn(session, id).ref)),
      );
      return loaded.reduce(reloadPreset, session);
    },

    previewSave(session) {
      return pending(session).map(({ target, edits }) => {
        const keys = [...Object.keys(edits.set ?? {}), ...(edits.remove ?? [])];
        if (target.origin === 'system') {
          return {
            target,
            status: 'new-user-preset',
            suggestedName: suggestedPresetName(target.name),
            keys,
            reformatted: false,
          };
        }
        return {
          target,
          status: 'ready',
          keys,
          reformatted: prepareSave(session, target, edits).reformatted,
        };
      });
    },

    async saveChanges(session, options = {}) {
      let current = session;
      const results: TargetSaveResult[] = [];
      // One id for the whole save, e.g. so the host keeps its backups together.
      const batch = new Date().toISOString();
      for (const { target, edits } of pending(session)) {
        if (target.origin === 'system') {
          const name = options.newPresetNames?.get(target.id);
          if (name === undefined) {
            results.push({ status: 'needs-user-preset', target });
            continue;
          }
          try {
            const created = await createFromSystemPreset(current, target, name, batch);
            current = savedAsNewPreset(current, target.id, created.files);
            results.push({
              status: 'created',
              target,
              created: created.files.ref,
              reloadRequired: created.reloadRequired,
            });
          } catch (error) {
            results.push({ status: 'failed', target, error: asComparerError(error, target) });
          }
          continue;
        }
        try {
          const { text, previousText, reformatted } = prepareSave(current, target, edits);
          const saved = await repository.saveDocument({ ref: target, text, previousText, batch });
          current = markSaved(current, {
            ref: target,
            content: JSON.parse(text) as Record<string, unknown>,
            text,
          });
          results.push({
            status: 'saved',
            target,
            reloadRequired: saved.reloadRequired,
            reformatted,
          });
        } catch (error) {
          results.push({ status: 'failed', target, error: asComparerError(error, target) });
        }
      }
      return { session: current, results };
    },
  };
}

function asComparerError(error: unknown, target: PresetRef): ComparerError {
  if (isComparerError(error)) return error;
  return new ComparerError(
    'host-error',
    error instanceof Error ? error.message : String(error),
    target.id,
  );
}
