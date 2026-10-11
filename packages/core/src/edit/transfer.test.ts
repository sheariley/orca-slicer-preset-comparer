import { describe, expect, it } from 'vitest';
import type { ProfileDocument, ProfileType } from '../model/profile.ts';
import type { KeyRules } from '../ports/ports.ts';
import { resolveChain, type LegacyKeys, type ResolvedProfile } from '../resolve/resolve-chain.ts';
import { fitToVariants, planTransfer, variantIdentities, type TransferTarget } from './transfer.ts';

const doc = (
  name: string,
  content: Record<string, unknown>,
  type: ProfileType = 'filament',
): ProfileDocument => ({
  ref: { id: name, name, type, origin: 'user' },
  content: { name, ...content },
});

const rules: KeyRules = {
  owned: new Set([
    'nozzle_temperature',
    'filament_flow_ratio',
    'filament_start_gcode',
    'fan_max_speed',
    'filament_type',
  ]),
  perVariant: new Set(['filament_flow_ratio', 'filament_extruder_variant']),
};

/** A target from its own document and (optionally) its parent, as the app layer builds it. */
function target(
  own: ProfileDocument,
  parent?: ProfileDocument,
  options: { rules?: KeyRules; legacyKeys?: LegacyKeys } = {},
): TransferTarget {
  const chain = parent ? [own, parent] : [own];
  const resolveOptions = options.legacyKeys ? { legacyKeys: options.legacyKeys } : {};
  return {
    document: own,
    resolved: resolveChain(chain, resolveOptions),
    inherited: parent ? resolveChain([parent], resolveOptions).settings : new Map(),
    rules: options.rules ?? rules,
  };
}

const processRules: KeyRules = {
  owned: new Set(),
  perVariant: new Set(['outer_wall_speed', 'print_extruder_id', 'print_extruder_variant']),
};

/** A process with per-extruder variants, like Bambu's dual-extruder H2D profiles. */
const process = (name: string, ids: string[], variants: string[], speeds: string[]) =>
  doc(
    name,
    { print_extruder_id: ids, print_extruder_variant: variants, outer_wall_speed: speeds },
    'process',
  );

const source: ResolvedProfile = resolveChain([
  doc('Source', {
    nozzle_temperature: ['215'],
    filament_flow_ratio: ['0.95'],
    filament_start_gcode: ['M104\nG28'],
    fan_max_speed: ['80'],
    layer_height: '0.2',
  }),
]);

describe('planTransfer', () => {
  it('sets a differing value, keeping the shape the target uses', () => {
    const plan = planTransfer(
      source,
      ['nozzle_temperature'],
      [target(doc('Target', { nozzle_temperature: ['240'] }))],
    );

    expect(plan.targets[0]).toEqual({
      target: expect.objectContaining({ name: 'Target' }),
      changes: [{ key: 'nozzle_temperature', change: { kind: 'set', value: ['215'] } }],
      skipped: [],
      redundantOverrides: [],
    });
  });

  it('skips a value the target already has', () => {
    const plan = planTransfer(
      source,
      ['fan_max_speed'],
      [target(doc('Target', { fan_max_speed: ['80'] }))],
    );

    expect(plan.targets[0]!.skipped).toEqual([{ key: 'fan_max_speed', reason: 'already-equal' }]);
    expect(plan.targets[0]!.changes).toEqual([]);
  });

  it('re-links to the parent by default when the copied value is what the target inherits', () => {
    const parent = doc('Parent', { nozzle_temperature: ['215'] });
    const own = doc('Child', { inherits: 'Parent', nozzle_temperature: ['240'] });

    const plan = planTransfer(source, ['nozzle_temperature'], [target(own, parent)]);

    expect(plan.targets[0]!.changes).toEqual([
      { key: 'nozzle_temperature', change: { kind: 'remove' } },
    ]);
    expect(plan.targets[0]!.redundantOverrides).toEqual([
      { key: 'nozzle_temperature', keep: false },
    ]);
  });

  it('keeps the override, pinning the value, when the user chooses "Pin override"', () => {
    const parent = doc('Parent', { nozzle_temperature: ['215'] });
    const own = doc('Child', { inherits: 'Parent', nozzle_temperature: ['240'] });

    const plan = planTransfer(source, ['nozzle_temperature'], [target(own, parent)], {
      pinOverrides: new Map([['Child', new Map([['nozzle_temperature', true]])]]),
    });

    expect(plan.targets[0]!.changes).toEqual([
      { key: 'nozzle_temperature', change: { kind: 'set', value: ['215'] } },
    ]);
    expect(plan.targets[0]!.redundantOverrides).toEqual([
      { key: 'nozzle_temperature', keep: true },
    ]);
  });

  it('leaves an existing redundant override alone by default, and drops it on request', () => {
    // The child already overrides with the value it would inherit (review finding #7).
    const parent = doc('Parent', { nozzle_temperature: ['215'] });
    const own = doc('Child', { inherits: 'Parent', nozzle_temperature: ['215'] });

    const byDefault = planTransfer(source, ['nozzle_temperature'], [target(own, parent)]);
    expect(byDefault.targets[0]).toMatchObject({
      changes: [],
      skipped: [{ key: 'nozzle_temperature', reason: 'already-equal' }],
      redundantOverrides: [{ key: 'nozzle_temperature', keep: true }],
    });

    const relinked = planTransfer(source, ['nozzle_temperature'], [target(own, parent)], {
      pinOverrides: new Map([['Child', new Map([['nozzle_temperature', false]])]]),
    });
    expect(relinked.targets[0]).toMatchObject({
      changes: [{ key: 'nozzle_temperature', change: { kind: 'remove' } }],
      redundantOverrides: [{ key: 'nozzle_temperature', keep: false }],
    });
  });

  it('applies a choice only to its own target and setting', () => {
    const parent = doc('Parent', { nozzle_temperature: ['215'], fan_max_speed: ['80'] });
    const child = doc('Child', {
      inherits: 'Parent',
      nozzle_temperature: ['240'],
      fan_max_speed: ['50'],
    });
    const sibling = doc('Sibling', { inherits: 'Parent', nozzle_temperature: ['240'] });

    const plan = planTransfer(
      source,
      ['nozzle_temperature', 'fan_max_speed'],
      [target(child, parent), target(sibling, parent)],
      { pinOverrides: new Map([['Child', new Map([['fan_max_speed', true]])]]) },
    );

    expect(plan.targets.map((t) => t.redundantOverrides)).toEqual([
      [
        { key: 'nozzle_temperature', keep: false },
        { key: 'fan_max_speed', keep: true },
      ],
      [{ key: 'nozzle_temperature', keep: false }],
    ]);
  });

  it('offers no choice when the target has no override of its own', () => {
    const parent = doc('Parent', { nozzle_temperature: ['215'] });
    const own = doc('Child', { inherits: 'Parent' });

    const plan = planTransfer(source, ['nozzle_temperature'], [target(own, parent)]);

    expect(plan.targets[0]!.redundantOverrides).toEqual([]);
    expect(plan.targets[0]!.skipped).toEqual([
      { key: 'nozzle_temperature', reason: 'already-equal' },
    ]);
  });

  it('sets an inherited key the target has never overridden', () => {
    const parent = doc('Parent', { nozzle_temperature: ['240'] });
    const own = doc('Child', { inherits: 'Parent' });

    const plan = planTransfer(source, ['nozzle_temperature'], [target(own, parent)]);

    expect(plan.targets[0]!.changes).toEqual([
      { key: 'nozzle_temperature', change: { kind: 'set', value: ['215'] } },
    ]);
  });

  it('never copies metadata, the variant list, keys the type does not own, or missing keys', () => {
    const withVariants = resolveChain([
      doc('Dual', { filament_extruder_variant: ['A', 'B'], filament_type: ['PLA'] }),
    ]);

    const plan = planTransfer(
      withVariants,
      ['name', 'filament_extruder_variant', 'layer_height', 'filament_type', 'nozzle_temperature'],
      [target(doc('Target', {}))],
    );

    expect(plan.targets[0]!.skipped).toEqual([
      { key: 'name', reason: 'metadata' },
      { key: 'filament_extruder_variant', reason: 'variant-list' },
      { key: 'layer_height', reason: 'not-owned' },
      { key: 'nozzle_temperature', reason: 'missing-in-source' },
    ]);
    expect(plan.targets[0]!.changes).toEqual([
      { key: 'filament_type', change: { kind: 'set', value: ['PLA'] } },
    ]);
  });

  it('allows any key when the target type has no known ownership list', () => {
    const open: TransferTarget = {
      ...target(doc('Target', {})),
      rules: { owned: new Set(), perVariant: new Set() },
    };

    const plan = planTransfer(source, ['layer_height'], [open]);

    expect(plan.targets[0]!.changes).toEqual([
      { key: 'layer_height', change: { kind: 'set', value: '0.2' } },
    ]);
  });

  it('fits per-variant settings to the target, matching variants by name', () => {
    const dual = resolveChain([
      doc('Dual', {
        filament_extruder_variant: ['Direct Drive Standard', 'Direct Drive High Flow'],
        filament_flow_ratio: ['0.95', '0.98'],
      }),
    ]);
    const highFlowOnly = doc('HF', {
      filament_extruder_variant: ['Direct Drive High Flow'],
      filament_flow_ratio: ['1'],
    });

    const plan = planTransfer(dual, ['filament_flow_ratio'], [target(highFlowOnly)]);

    expect(plan.targets[0]!.changes).toEqual([
      { key: 'filament_flow_ratio', change: { kind: 'set', value: ['0.98'] } },
    ]);
  });

  it('copies other arrays as they are and handles several targets independently', () => {
    const plan = planTransfer(
      source,
      ['filament_start_gcode', 'fan_max_speed'],
      [target(doc('A', { fan_max_speed: ['80'] })), target(doc('B', { fan_max_speed: ['100'] }))],
    );

    expect(plan.targets.map((t) => t.changes.map((c) => c.key))).toEqual([
      ['filament_start_gcode'],
      ['filament_start_gcode', 'fan_max_speed'],
    ]);
    expect(plan.targets[0]!.changes[0]!.change).toEqual({ kind: 'set', value: ['M104\nG28'] });
  });
});

describe('planTransfer: variants, shapes, and legacy keys', () => {
  it("never copies a process's extruder ids, which pair with its variant names", () => {
    const dual = resolveChain([process('Dual', ['1', '2'], ['Std', 'Std'], ['100', '80'])]);

    const plan = planTransfer(
      dual,
      ['print_extruder_id', 'print_extruder_variant'],
      [target(process('Single', ['1'], ['Std'], ['90']), undefined, { rules: processRules })],
    );

    expect(plan.targets[0]!.skipped).toEqual([
      { key: 'print_extruder_id', reason: 'variant-list' },
      { key: 'print_extruder_variant', reason: 'variant-list' },
    ]);
  });

  it('matches process variants by extruder and name, so extruders never swap values', () => {
    const source = resolveChain([
      process('H2D', ['1', '1', '2', '2'], ['Std', 'HF', 'Std', 'HF'], ['100', '120', '80', '90']),
    ]);
    const sameLayout = process(
      'A',
      ['1', '1', '2', '2'],
      ['Std', 'HF', 'Std', 'HF'],
      ['1', '1', '1', '1'],
    );
    const reordered = process(
      'B',
      ['2', '2', '1', '1'],
      ['HF', 'Std', 'HF', 'Std'],
      ['1', '1', '1', '1'],
    );

    const plan = planTransfer(
      source,
      ['outer_wall_speed'],
      [
        target(sameLayout, undefined, { rules: processRules }),
        target(reordered, undefined, { rules: processRules }),
      ],
    );

    expect(plan.targets.map((t) => t.changes[0]!.change)).toEqual([
      { kind: 'set', value: ['100', '120', '80', '90'] },
      { kind: 'set', value: ['90', '80', '120', '100'] },
    ]);
  });

  it('identifies variants by name alone for filaments, which have no extruder ids', () => {
    const filament = resolveChain([doc('F', { filament_extruder_variant: ['Std', 'HF'] })]);
    expect(variantIdentities(filament)).toEqual(['Std', 'HF']);
  });

  it('treats an empty variant list as no list (one variant), never emptying arrays', () => {
    const empty = doc('Empty', { filament_extruder_variant: [], filament_flow_ratio: ['1'] });
    const twoVariants = resolveChain([
      doc('Two', { filament_extruder_variant: ['A', 'B'], filament_flow_ratio: ['0.9', '0.8'] }),
    ]);

    const plan = planTransfer(twoVariants, ['filament_flow_ratio'], [target(empty)]);

    expect(plan.targets[0]!.changes).toEqual([
      { key: 'filament_flow_ratio', change: { kind: 'set', value: ['0.9'] } },
    ]);
  });

  it('writes an array when a multi-element value meets a target that stores a plain string', () => {
    const dual = resolveChain([
      doc('Dual', { filament_extruder_variant: ['Std', 'HF'], nozzle_temperature: ['215', '230'] }),
    ]);
    const scalarTarget = doc('Old', {
      filament_extruder_variant: ['Std', 'HF'],
      nozzle_temperature: '220',
    });

    const plan = planTransfer(dual, ['nozzle_temperature'], [target(scalarTarget)]);

    expect(plan.targets[0]!.changes).toEqual([
      { key: 'nozzle_temperature', change: { kind: 'set', value: ['215', '230'] } },
    ]);
  });

  it('plans against the keys the file really holds, including old (renamed) names', () => {
    const legacyKeys: LegacyKeys = {
      obsolete: new Set(),
      renamed: new Map([['old_temperature', 'nozzle_temperature']]),
    };
    const parent = doc('Parent', { nozzle_temperature: ['215'] });
    const own = doc('Child', { inherits: 'Parent', old_temperature: ['240'] });
    const withLegacy = target(own, parent, { legacyKeys });

    const redundant = planTransfer(source, ['nozzle_temperature'], [withLegacy], { legacyKeys });
    expect(redundant.targets[0]!.changes).toEqual([
      { key: 'old_temperature', change: { kind: 'remove' } },
    ]);

    const hotter = resolveChain([doc('Hot', { nozzle_temperature: ['250'] })]);
    const changed = planTransfer(hotter, ['nozzle_temperature'], [withLegacy], { legacyKeys });
    expect(changed.targets[0]!.changes).toEqual([
      { key: 'nozzle_temperature', change: { kind: 'set', value: ['250'] } },
      { key: 'old_temperature', change: { kind: 'remove' } },
    ]);
  });

  it('replaces a key an old value rule renames, the way OrcaSlicer reads the file', () => {
    const legacyKeys: LegacyKeys = { obsolete: new Set(), renamed: new Map() };
    const processTarget = target(doc('Old', { wall_filament: '2' }, 'process'), undefined, {
      rules: { owned: new Set(['outer_wall_filament_id']), perVariant: new Set() },
      legacyKeys,
    });
    const third = resolveChain([doc('New', { outer_wall_filament_id: '3' }, 'process')], {
      legacyKeys,
    });

    const plan = planTransfer(third, ['outer_wall_filament_id'], [processTarget], { legacyKeys });
    expect(plan.targets[0]!.changes).toEqual([
      { key: 'outer_wall_filament_id', change: { kind: 'set', value: '3' } },
      { key: 'wall_filament', change: { kind: 'remove' } },
    ]);
  });
});

describe('fitToVariants', () => {
  it('matches values by variant name when both presets name their variants', () => {
    expect(fitToVariants(['1', '2', '3'], ['A', 'B', 'C'], ['C', 'A'])).toEqual(['3', '1']);
  });

  it("resizes like OrcaSlicer when names don't match: truncate, or pad with the first value", () => {
    expect(fitToVariants(['1', '2'], ['A', 'B'], ['X'])).toEqual(['1']);
    expect(fitToVariants(['1', '2'], undefined, ['X', 'Y', 'Z'])).toEqual(['1', '2', '1']);
    expect(fitToVariants(['1', '2'], ['A', 'B'], undefined)).toEqual(['1']);
  });

  it('leaves an empty array alone', () => {
    expect(fitToVariants([], undefined, ['X', 'Y'])).toEqual([]);
  });
});
