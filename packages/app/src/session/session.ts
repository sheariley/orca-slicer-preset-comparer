import {
  applyContentEdits,
  canRedo,
  canUndo,
  editsBetween,
  emptyHistory,
  hasEdits,
  pendingEdits,
  record,
  redo,
  resolveChain,
  undo,
  VARIANT_KEYS,
  type EditBatch,
  type EditHistory,
  type IncludedTemplates,
  type PendingEdits,
  type PresetRef,
  type ProfileDocument,
  type ResolvedProfile,
  type ResolveOptions,
  withoutTarget,
} from '@comparer/core';

/**
 * A preset opened for editing, with the raw documents of its inheritance chain and the templates
 * they include.
 */
export interface LoadedPreset {
  readonly ref: PresetRef;
  /** The preset's own file as it was when the session opened it. The history applies to this. */
  readonly opened: ProfileDocument;
  /** Leaf first. The leaf is the preset's own file as it is now (after any saves). */
  readonly chain: readonly ProfileDocument[];
  /** System templates, never edited (see loadTemplates). */
  readonly templates: IncludedTemplates;
}

/** What opening or reloading a preset reads: its chain (leaf first) and included templates. */
export interface PresetFiles {
  readonly chain: readonly ProfileDocument[];
  readonly templates?: IncludedTemplates;
}

/**
 * The state of an editing session: the presets opened for editing and the edit history.
 * Immutable; every operation returns a new session. Edits stay pending until saved.
 */
export interface EditSession {
  readonly presets: ReadonlyMap<string, LoadedPreset>;
  readonly history: EditHistory;
}

const toLoaded = ({
  ref,
  chain,
  templates = new Map(),
}: PresetFiles & { readonly ref: PresetRef }) =>
  [ref.id, { ref, chain, templates, opened: chain[0]! }] as const;

export function createSession(
  presets: readonly (PresetFiles & { readonly ref: PresetRef })[],
): EditSession {
  return { presets: new Map(presets.map(toLoaded)), history: emptyHistory };
}

/**
 * Opens more presets in a session (e.g. the targets of a bulk copy), keeping its history.
 * Presets that are already open keep their state.
 */
export function addToSession(
  session: EditSession,
  presets: readonly (PresetFiles & { readonly ref: PresetRef })[],
): EditSession {
  const added = presets.filter(({ ref }) => !session.presets.has(ref.id)).map(toLoaded);
  if (added.length === 0) return session;
  return { ...session, presets: new Map([...session.presets, ...added]) };
}

/**
 * Closes presets in a session (e.g. targets taken out of the comparison). Their pending edits
 * are dropped: their steps leave the history, and a step that changed only them goes with them.
 */
export function removeFromSession(session: EditSession, ids: readonly string[]): EditSession {
  const open = ids.filter((id) => session.presets.has(id));
  if (open.length === 0) return session;
  return {
    presets: new Map([...session.presets].filter(([id]) => !open.includes(id))),
    history: open.reduce(withoutTarget, session.history),
  };
}

export function presetIn(session: EditSession, id: string): LoadedPreset {
  const preset = session.presets.get(id);
  if (!preset) throw new Error(`Preset ${id} isn't open in this session.`);
  return preset;
}

/**
 * A preset's own content as the edit history wants it: the file as opened, with every applied
 * batch on top. Saving and undoing don't change this; they change what the file holds.
 */
function desiredContent(session: EditSession, id: string): Record<string, unknown> {
  const { opened } = presetIn(session, id);
  const edits = pendingEdits(session.history, new Map([[id, opened]])).find(
    (entry) => entry.target.id === id,
  )?.edits;
  return edits ? applyContentEdits(opened.content, edits) : { ...opened.content };
}

/**
 * The net edits each preset's file needs to match what the history wants: what saving would
 * write. Measured against the file as it is now, so saved changes drop out, and undoing a saved
 * change makes reverting it pending (like undo after save in a text editor).
 */
export function pending(session: EditSession): PendingEdits[] {
  return [...session.presets.values()].flatMap(({ ref, chain }) => {
    const edits = editsBetween(chain[0]!.content, desiredContent(session, ref.id));
    return hasEdits(edits) ? [{ target: ref, edits }] : [];
  });
}

export const hasPendingEdits = (session: EditSession) => pending(session).length > 0;

/** A preset's own document with its pending edits applied. Has no `text` until it's saved. */
export function editedDocument(session: EditSession, id: string): ProfileDocument {
  return { ref: presetIn(session, id).ref, content: desiredContent(session, id) };
}

/**
 * A preset's chain as it currently stands: any document that belongs to a preset open in the
 * session (the preset itself, or a parent that's also open) carries its pending edits.
 */
export function editedChain(session: EditSession, id: string): ProfileDocument[] {
  return presetIn(session, id).chain.map((document) =>
    session.presets.has(document.ref.id) ? editedDocument(session, document.ref.id) : document,
  );
}

/** Resolves a preset in its current, edited state. */
export function resolveEdited(
  session: EditSession,
  id: string,
  options: ResolveOptions,
): ResolvedProfile {
  return resolveChain(editedChain(session, id), {
    ...options,
    templates: presetIn(session, id).templates,
  });
}

/**
 * What a preset would have without its own overrides, in its current, edited state: its parent's
 * resolved settings (or just the built-in defaults for a root preset), with the templates it
 * includes on top.
 */
export function inheritedEdited(
  session: EditSession,
  id: string,
  options: ResolveOptions,
): ResolvedProfile['settings'] {
  const [leaf, ...parents] = editedChain(session, id);
  // Resolve a stand-in for its own file that keeps only what isn't an override: the templates
  // it includes, and its variant list, which sets the length of per-variant values.
  const variantKeys = VARIANT_KEYS[leaf!.ref.type];
  const kept = ['include', variantKeys?.names, variantKeys?.extruderIds];
  const content = Object.fromEntries(
    Object.entries(leaf!.content).filter(([key]) => kept.includes(key)),
  );
  return resolveChain([{ ref: leaf!.ref, content }, ...parents], {
    ...options,
    templates: presetIn(session, id).templates,
  }).settings;
}

export function recordBatch(session: EditSession, batch: EditBatch): EditSession {
  return { ...session, history: record(session.history, batch) };
}

export const undoSession = (session: EditSession): EditSession => ({
  ...session,
  history: undo(session.history),
});

export const redoSession = (session: EditSession): EditSession => ({
  ...session,
  history: redo(session.history),
});

export const canUndoSession = (session: EditSession) => canUndo(session.history);
export const canRedoSession = (session: EditSession) => canRedo(session.history);

/** The label of the step undo would reverse (e.g. "Copy 2 settings to PETG"), if any. */
export const undoLabel = (session: EditSession) => session.history.done.at(-1)?.label;
/** The label of the step redo would reapply, if any. */
export const redoLabel = (session: EditSession) => session.history.undone[0]?.label;

/**
 * Replaces an open preset's files with fresh copies, keeping the history:
 * e.g. after a save conflict, when OrcaSlicer changed the file. The changes found on disk are
 * folded into the opened file too, so the history replays on top of them. Where both changed a
 * key, the user's copy wins, and undo still reverses copies that were saved before.
 */
export function reloadPreset(session: EditSession, { chain, templates }: PresetFiles): EditSession {
  const leaf = chain[0]!;
  const preset = presetIn(session, leaf.ref.id);
  const external = editsBetween(preset.chain[0]!.content, leaf.content);
  const opened = { ref: preset.ref, content: applyContentEdits(preset.opened.content, external) };
  const presets = new Map(
    [...session.presets].map(([id, other]) => [
      id,
      id === leaf.ref.id
        ? { ...other, opened, chain, templates: templates ?? other.templates }
        : {
            ...other,
            // Another open preset may inherit from this one.
            chain: other.chain.map((document) =>
              document.ref.id === leaf.ref.id ? leaf : document,
            ),
          },
    ]),
  );
  return { ...session, presets };
}

/**
 * Records that a system preset's pending changes were saved as a new user preset (`created`).
 * They leave the history, so the system preset is back to what its file holds (and undo no
 * longer reaches them: the new file exists either way), and the new preset opens in the session.
 */
export function savedAsNewPreset(
  session: EditSession,
  systemId: string,
  created: PresetFiles & { readonly ref: PresetRef },
): EditSession {
  return addToSession({ ...session, history: withoutTarget(session.history, systemId) }, [created]);
}

/**
 * Records that a preset's file now holds `saved`. Pending edits are measured against it, so the
 * saved ones drop out. The history and the opened file are kept, so undo can still reverse a
 * saved change (which makes reverting it pending).
 */
export function markSaved(session: EditSession, saved: ProfileDocument): EditSession {
  const presets = new Map(
    [...session.presets].map(([id, preset]) => [
      id,
      {
        ...preset,
        chain: preset.chain.map((document) =>
          document.ref.id === saved.ref.id ? saved : document,
        ),
      },
    ]),
  );
  return { ...session, presets };
}
