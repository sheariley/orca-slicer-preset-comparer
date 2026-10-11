import { createComparerApp } from '@comparer/app';
import {
  ComparerError,
  type CloseGuard,
  type ProfileDocument,
  type ProfileRepository,
  type SettingCatalog,
} from '@comparer/core';
import { createMemoryHost } from '@comparer/host-memory';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ComparerRoot } from '../../ComparerRoot.tsx';

const filament = (
  name: string,
  content: Record<string, unknown>,
  origin: 'user' | 'system' = 'user',
): ProfileDocument => ({
  ref: {
    id: name,
    name,
    type: 'filament',
    origin,
    ...(origin === 'system' ? { vendor: 'V' } : {}),
  },
  content: { name, ...content },
});

const documents = [
  filament('Generic PETG', { nozzle_temperature: ['230'], fan_max_speed: ['60'] }, 'system'),
  filament('PLA', {
    nozzle_temperature: ['210'],
    fan_max_speed: ['100'],
    fan_min_speed: ['20'],
    print_speed: ['50'],
  }),
  filament('PETG', {
    inherits: 'Generic PETG',
    nozzle_temperature: ['240'],
    fan_min_speed: ['30'],
    print_speed: ['60'],
  }),
  filament('ASA', { nozzle_temperature: ['230'], fan_max_speed: ['60'] }),
  // More targets: one already matches PLA, one gets left out.
  filament('TPU', { nozzle_temperature: ['210'], fan_max_speed: ['100'] }),
  filament('Nylon', { nozzle_temperature: ['260'], fan_max_speed: ['40'] }),
];

const LABELS: Record<string, string> = {
  nozzle_temperature: 'Nozzle temperature',
  // OrcaSlicer reuses short labels like this one.
  fan_max_speed: 'Fan speed',
  fan_min_speed: 'Fan speed',
};

const catalog: SettingCatalog = {
  describe: (key) => ({ key, label: LABELS[key] ?? key }),
  defaultsFor: () => new Map(),
  legacyKeys: () => ({ obsolete: new Set<string>(), renamed: new Map<string, string>() }),
  // print_speed is a process setting: copying it into a filament is skipped.
  keyRules: () => ({ owned: new Set(Object.keys(LABELS)), perVariant: new Set<string>() }),
};

function setup(
  wrap: (host: ProfileRepository) => ProfileRepository = (host) => host,
  closeGuard?: CloseGuard,
) {
  const host = createMemoryHost({ documents });
  const app = createComparerApp({
    repository: wrap(host),
    catalog,
    ...(closeGuard ? { closeGuard } : {}),
  });
  render(<ComparerRoot app={app} />);
  const refOf = async (name: string) =>
    (await host.listPresets()).find((preset) => preset.name === name)!;
  const fileText = async (name: string) => (await host.readDocument(await refOf(name))).text!;
  /** Changes a preset's file the way another program (e.g. OrcaSlicer) would. */
  const editElsewhere = async (name: string, from: string, to: string) => {
    const text = await fileText(name);
    await host.saveDocument({
      ref: await refOf(name),
      text: text.replace(from, to),
      previousText: text,
    });
  };
  return { user: userEvent.setup(), fileText, editElsewhere };
}

/** A stand-in for the host's window close hook. */
function fakeCloseGuard() {
  const guard = {
    mayClose: (): boolean => true,
    closed: false,
    onCloseRequested(mayClose: () => boolean) {
      guard.mayClose = mayClose;
      return () => undefined;
    },
    close() {
      guard.closed = true;
    },
  };
  return guard;
}

type User = ReturnType<typeof userEvent.setup>;

/** The button that opens the target picker: "Choose targets", the target, or how many. */
const TARGETS_BUTTON = /^(Choose targets|Target: .+|\d+ targets chosen)$/;

/** The button that opens the base picker: "Choose base", or the base's name. */
const BASE_BUTTON = /^(Choose base|Base: .+)$/;

/** Picks `name` as the base in the base picker (showing system presets if it needs to). */
async function chooseBase(user: User, name: string) {
  await user.click(await screen.findByRole('button', { name: BASE_BUTTON }));
  const dialog = screen.getByRole('dialog', { name: 'Choose the base preset' });
  const radio = () => within(dialog).queryByRole('radio', { name: `Choose ${name}` });
  if (!radio()) await user.click(within(dialog).getByLabelText('Show system presets'));
  await user.click(radio()!);
  await user.click(within(dialog).getByRole('button', { name: 'Choose' }));
}

/** Ticks `names` in the target picker (showing system presets if one is needed). */
async function chooseTargets(user: User, names: readonly string[]) {
  await user.click(await screen.findByRole('button', { name: TARGETS_BUTTON }));
  const dialog = screen.getByRole('dialog', { name: 'Choose targets' });
  for (const name of names) {
    const box = () => within(dialog).queryByRole('checkbox', { name: `Choose ${name}` });
    if (!box()) await user.click(within(dialog).getByLabelText('Show system presets'));
    await user.click(box()!);
  }
  await user.click(within(dialog).getByRole('button', { name: 'Compare' }));
}

async function compare(user: User, base: string, ...targets: string[]) {
  await chooseBase(user, base);
  await chooseTargets(user, targets);
  return screen.findByRole('table');
}

const rowOf = (label: string) => within(screen.getByRole('table')).getByText(label).closest('tr')!;

/** Selects `labels` in the table and opens the preview of copying them to the targets. */
async function previewCopy(user: User, ...labels: string[]) {
  for (const label of labels) {
    await user.click(screen.getByRole('checkbox', { name: `Select ${label}` }));
  }
  await user.click(screen.getByRole('button', { name: /^Copy selected to / }));
  return screen.getByRole('dialog');
}

/** Copies `labels` from the base to every target, through the preview. */
async function copy(user: User, ...labels: string[]) {
  const dialog = await previewCopy(user, ...labels);
  await user.click(within(dialog).getByRole('button', { name: /^Copy( to \d+ presets?)?$/ }));
}

describe('editing', () => {
  it('copies one setting, marks it unsaved, and undoes and redoes it', async () => {
    const { user } = setup();
    await compare(user, 'PLA', 'PETG');
    // Copies go only from the base to the targets, through the selection: no per-cell buttons.
    expect(within(rowOf('Nozzle temperature')).queryAllByRole('button', { name: /^Copy/ })).toEqual(
      [],
    );

    await copy(user, 'Nozzle temperature');

    // Both sides now agree, but the row stays visible because it has unsaved changes.
    const cells = within(rowOf('Nozzle temperature')).getAllByRole('cell');
    expect(cells.at(-1)).toHaveTextContent('210');
    expect(cells.at(-1)).toHaveClass('is-edited');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Copy Nozzle temperature to PETG');

    await user.click(screen.getByRole('button', { name: 'Undo: Copy Nozzle temperature to PETG' }));
    expect(within(rowOf('Nozzle temperature')).getAllByRole('cell').at(-1)).toHaveTextContent(
      '240',
    );
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();

    await user.keyboard('{Control>}y{/Control}');
    expect(within(rowOf('Nozzle temperature')).getAllByRole('cell').at(-1)).toHaveTextContent(
      '210',
    );
    await user.keyboard('{Control>}z{/Control}');
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });

  it('copies the selected settings after showing what will change', async () => {
    const { user } = setup();
    await compare(user, 'PLA', 'PETG');

    await user.click(screen.getByRole('checkbox', { name: 'Select Nozzle temperature' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select print_speed' }));
    await user.click(screen.getByRole('button', { name: 'Copy selected to PETG (2)' }));

    const dialog = screen.getByRole('dialog', { name: 'Copy 2 settings to PETG' });
    const nozzle = within(dialog).getByText('Nozzle temperature').closest('tr')!;
    expect(nozzle).toHaveTextContent(/240.*210/);
    const speed = within(dialog).getByText('print_speed').closest('tr')!;
    expect(speed).toHaveTextContent("OrcaSlicer doesn't use this setting in this kind of preset");
    expect(dialog).toHaveTextContent('1 setting changes in PETG. 1 left as they are.');

    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Nozzle temperature' })).not.toBeChecked();
  });

  it('selects every shown setting at once', async () => {
    const { user } = setup();
    await compare(user, 'PLA', 'PETG');

    await user.click(screen.getByRole('checkbox', { name: 'Select all shown settings' }));

    expect(screen.getByRole('button', { name: /Copy selected to PETG \(4\)/ })).toBeEnabled();
  });

  it('asks whether to pin a redundant override, and saves the choice', async () => {
    const { user, fileText } = setup();
    await compare(user, 'ASA', 'PETG');

    // ASA's 230 is what PETG inherits from Generic PETG, so PETG's override would be redundant.
    const dialog = await previewCopy(user, 'Nozzle temperature');
    expect(dialog).toHaveAccessibleName('Copy 1 setting to PETG');
    const pin = within(dialog).getByRole('checkbox', {
      name: 'Pin override for Nozzle temperature',
    });
    expect(pin).not.toBeChecked();

    await user.click(
      within(dialog).getByRole('button', { name: 'About Pin override for Nozzle temperature' }),
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'later changes to "Generic PETG" no longer reach it',
    );
    await user.click(pin);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Save changes' })).getByRole('button', {
        name: 'Save',
      }),
    );
    expect(await fileText('PETG')).toContain('"nozzle_temperature": [\n\t\t"230"\n\t]');
  });

  it('re-links an unpinned redundant override to the parent', async () => {
    const { user, fileText } = setup();
    await compare(user, 'ASA', 'PETG');

    await copy(user, 'Nozzle temperature');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await fileText('PETG')).not.toContain('nozzle_temperature');
  });

  it('saves after a confirmation, and reports the result', async () => {
    const { user, fileText } = setup();
    await compare(user, 'PLA', 'PETG');
    await copy(user, 'Nozzle temperature');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = screen.getByRole('dialog', { name: 'Save changes' });
    expect(dialog).toHaveTextContent('PETG: Nozzle temperature');
    expect(dialog).not.toHaveTextContent('(nozzle_temperature)');
    expect(dialog).toHaveTextContent("A running OrcaSlicer won't see these changes");
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    const results = await screen.findByRole('region', { name: 'Save results' });
    expect(results).toHaveTextContent('Saved 1 of 1.');
    expect(await fileText('PETG')).toContain('"210"');
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('tells apart settings that share a label, in the controls and the save confirmation', async () => {
    const { user } = setup();
    await compare(user, 'PLA', 'PETG');

    await copy(user, 'Fan speed (fan_min_speed)');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('dialog', { name: 'Save changes' })).toHaveTextContent(
      'PETG: Fan speed (fan_min_speed)',
    );
  });

  it('keeps failed saves pending, and retries them', async () => {
    let failures = 1;
    const { user, fileText } = setup((host) => ({
      ...host,
      async saveDocument(request) {
        if (failures-- > 0) throw new ComparerError('host-error', 'The disk is full.');
        return { ...(await host.saveDocument(request)), reloadRequired: 'restart' };
      },
    }));
    await compare(user, 'PLA', 'PETG');
    await copy(user, 'Nozzle temperature');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const results = await screen.findByRole('region', { name: 'Save results' });
    expect(results).toHaveTextContent("Couldn't save PETG; its changes stay unsaved.");
    expect(results).toHaveTextContent('The disk is full.');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();

    await user.click(within(results).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Saved 1 of 1\./)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Save results' })).toHaveTextContent(
      'Restart OrcaSlicer to see the changes.',
    );
    expect(await fileText('PETG')).toContain('"210"');
  });

  it('offers to reload a preset that changed on disk, keeping the unsaved changes', async () => {
    const { user, fileText, editElsewhere } = setup();
    await compare(user, 'PLA', 'PETG');
    await copy(user, 'Nozzle temperature');
    // Meanwhile, OrcaSlicer saves PETG with another change.
    await editElsewhere('PETG', '"30"', '"35"');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const results = await screen.findByRole('region', { name: 'Save results' });
    expect(results).toHaveTextContent('The file changed after it was opened');
    expect(within(results).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

    await user.click(
      within(results).getByRole('button', { name: 'Reload from disk and keep my changes' }),
    );
    expect(await screen.findByText(/Reloaded PETG from disk/)).toBeInTheDocument();
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(within(rowOf('fan_min_speed')).getAllByRole('cell').at(-1)).toHaveTextContent('35');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Saved 1 of 1\./)).toBeInTheDocument();
    const text = await fileText('PETG');
    expect(text).toContain('"35"');
    expect(text).toContain('"210"');
  });

  it('explains that OrcaSlicer is busy, and offers to try again', async () => {
    let busy = true;
    const { user } = setup((host) => ({
      ...host,
      async saveDocument(request) {
        if (busy) throw new ComparerError('busy', 'OrcaSlicer is reading or saving its presets.');
        return host.saveDocument(request);
      },
    }));
    await compare(user, 'PLA', 'PETG');
    await copy(user, 'Nozzle temperature');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const results = await screen.findByRole('region', { name: 'Save results' });
    expect(results).toHaveTextContent('OrcaSlicer is busy with its presets. Wait a moment');
    busy = false;
    await user.click(within(results).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Saved 1 of 1\./)).toBeInTheDocument();
  });

  it('asks before the window closes with unsaved changes', async () => {
    const guard = fakeCloseGuard();
    const { user } = setup(undefined, guard);
    await compare(user, 'PLA', 'PETG');
    expect(guard.mayClose()).toBe(true);

    await copy(user, 'Nozzle temperature');
    let allowed = true;
    act(() => {
      allowed = guard.mayClose();
    });
    expect(allowed).toBe(false);
    const dialog = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
    expect(dialog).toHaveTextContent('Closing the window loses the unsaved changes.');
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(guard.closed).toBe(false);

    act(() => void guard.mayClose());
    await user.click(screen.getByRole('button', { name: 'Close without saving' }));
    expect(guard.closed).toBe(true);
  });

  it('confirms before discarding unsaved changes', async () => {
    const { user } = setup();
    await compare(user, 'PLA', 'PETG');
    await copy(user, 'Nozzle temperature');

    await chooseBase(user, 'ASA');
    const dialog = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
    expect(dialog).toHaveTextContent('Choosing another base preset or type closes this comparison');
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('button', { name: 'Base: PLA' })).toBeInTheDocument();
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();

    await chooseBase(user, 'ASA');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('button', { name: 'Base: ASA' })).toBeInTheDocument();
    expect(await screen.findByText('No unsaved changes')).toBeInTheDocument();
    // PETG is still a target.
    expect(
      within(await screen.findByRole('table')).getByRole('columnheader', { name: /^PETG/ }),
    ).toBeInTheDocument();
  });

  it('saves copies into a system preset as a new user preset, named when saving', async () => {
    const { user, fileText } = setup();
    await compare(user, 'PLA', 'Generic PETG');
    expect(within(screen.getByRole('table')).getByText('System')).toBeInTheDocument();

    await copy(user, 'Nozzle temperature');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = screen.getByRole('dialog', { name: 'Save changes' });
    const name = within(dialog).getByRole('textbox', { name: 'New preset name for Generic PETG' });
    expect(name).toHaveValue('Generic PETG - Copy');
    await user.clear(name);
    await user.type(name, 'PLA');
    expect(dialog).toHaveTextContent('A preset with this name already exists.');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(name);
    await user.type(name, 'My PETG');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    const results = await screen.findByRole('region', { name: 'Save results' });
    expect(results).toHaveTextContent(
      'Saved the changes to Generic PETG as a new user preset, "My PETG". Generic PETG itself is unchanged.',
    );
    // The new preset takes the system preset's place, with nothing left unsaved.
    expect(
      await within(screen.getByRole('table')).findByRole('columnheader', { name: /^My PETG/ }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).queryByRole('columnheader', { name: /^Generic PETG/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
    expect(await fileText('My PETG')).toContain('"inherits": "Generic PETG"');
    expect(await fileText('Generic PETG')).toContain('"230"');
  });

  describe('several targets', () => {
    it('shows a column per target, with each row shown when any target differs', async () => {
      const { user } = setup();
      const table = await compare(user, 'PLA', 'ASA', 'TPU');

      const headers = within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent);
      expect(headers).toEqual(expect.arrayContaining(['PLABase', 'ASA', 'TPU']));
      // TPU matches PLA, ASA doesn't: the row shows, and TPU's value is muted.
      const cells = within(rowOf('Nozzle temperature')).getAllByRole('cell');
      expect(cells.at(-1)).toHaveTextContent('210');
      expect(cells.at(-1)).toHaveClass('matches-base');
    });

    it('copies the selection to every target as one step, after a preview of each', async () => {
      const { user, fileText } = setup();
      await compare(user, 'PLA', 'PETG', 'ASA', 'TPU', 'Nylon');
      await user.click(screen.getByRole('checkbox', { name: 'Select Nozzle temperature' }));
      await user.click(screen.getByRole('checkbox', { name: 'Select Fan speed (fan_max_speed)' }));
      await user.click(screen.getByRole('button', { name: 'Copy selected to 4 targets (2)' }));

      const dialog = screen.getByRole('dialog', { name: 'Copy 2 settings from PLA' });
      const target = (name: string) =>
        within(dialog).getByRole('checkbox', { name }).closest('li')!;
      expect(target('ASA')).toHaveTextContent('2 settings change.');
      expect(target('TPU')).toHaveTextContent('Already matches, so it is skipped.');
      expect(within(target('TPU')).getByRole('checkbox', { name: 'TPU' })).toBeDisabled();

      // The details show each value now and after.
      await user.click(within(target('ASA')).getByText('Details'));
      const nozzle = within(target('ASA')).getByText('Nozzle temperature').closest('tr')!;
      expect(nozzle).toHaveTextContent(/230.*210/);

      // Leave Nylon out.
      await user.click(within(dialog).getByRole('checkbox', { name: 'Nylon' }));
      expect(dialog).toHaveTextContent('2 of 4 targets will change.');
      await user.click(within(dialog).getByRole('button', { name: 'Copy to 2 presets' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText('4 unsaved changes in 2 presets')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Copy 2 settings to 2 presets. Not saved yet.',
      );

      // One step: undo takes back every target.
      await user.click(screen.getByRole('button', { name: 'Undo: Copy 2 settings to 2 presets' }));
      expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Redo: Copy 2 settings to 2 presets' }));

      await user.click(screen.getByRole('button', { name: 'Save' }));
      const save = screen.getByRole('dialog', { name: 'Save changes' });
      expect(save).toHaveTextContent('ASA: Nozzle temperature, Fan speed (fan_max_speed)');
      await user.click(within(save).getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('region', { name: 'Save results' })).toHaveTextContent(
        'Saved 2 of 2.',
      );
      expect(await fileText('ASA')).toMatch(/"fan_max_speed": \[\s*"100"/);
      expect(await fileText('Nylon')).toContain('"260"');
    });

    it('says which targets are system presets before copying to them', async () => {
      const { user } = setup();
      await compare(user, 'PLA', 'ASA', 'Generic PETG');
      await user.click(screen.getByRole('checkbox', { name: 'Select Nozzle temperature' }));
      await user.click(screen.getByRole('button', { name: 'Copy selected to 2 targets (1)' }));

      expect(screen.getByRole('dialog', { name: 'Copy 1 setting from PLA' })).toHaveTextContent(
        "Generic PETG is a system preset, which can't be changed. When you save, its changes go into a new user preset",
      );
    });

    it('takes a target out of the comparison, asking first if it has unsaved changes', async () => {
      const { user } = setup();
      await compare(user, 'PLA', 'ASA', 'Nylon');
      await copy(user, 'Nozzle temperature');
      expect(screen.getByText('2 unsaved changes in 2 presets')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Remove ASA from the comparison' }));
      const dialog = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
      expect(dialog).toHaveTextContent(
        'Taking ASA out of the comparison loses its unsaved changes.',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
      expect(screen.getByRole('columnheader', { name: /^ASA/ })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Remove ASA from the comparison' }));
      await user.click(screen.getByRole('button', { name: 'Discard changes' }));
      expect(screen.queryByRole('columnheader', { name: /^ASA/ })).not.toBeInTheDocument();
      expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Target: Nylon' })).toBeInTheDocument();

      // Without unsaved changes, it goes at once; the base stays open on its own.
      await user.click(screen.getByRole('button', { name: 'Undo: Copy 1 setting to 2 presets' }));
      await user.click(screen.getByRole('button', { name: 'Remove Nylon from the comparison' }));
      expect(screen.getByText('Choose targets to compare with PLA.')).toBeInTheDocument();
    });

    it('clears every target at once, after asking', async () => {
      const { user } = setup();
      const clear = await screen.findByRole('button', { name: 'Clear targets' });
      expect(clear).toBeDisabled();
      await compare(user, 'PLA', 'ASA', 'Nylon');
      await copy(user, 'Nozzle temperature');

      await user.click(screen.getByRole('button', { name: 'Clear targets' }));
      let dialog = screen.getByRole('dialog', { name: 'Clear the targets?' });
      expect(dialog).toHaveTextContent(
        'This takes every target out of the comparison, and their unsaved changes are lost.',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('button', { name: '2 targets chosen' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Clear targets' }));
      dialog = screen.getByRole('dialog', { name: 'Clear the targets?' });
      await user.click(within(dialog).getByRole('button', { name: 'Clear' }));

      expect(screen.getByText('Choose targets to compare with PLA.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Choose targets' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Clear targets' })).toBeDisabled();
      expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
    });

    it('clears the base and the targets together, after asking', async () => {
      const { user } = setup();
      expect(await screen.findByRole('button', { name: 'Clear base' })).toBeDisabled();
      await compare(user, 'PLA', 'ASA');
      await copy(user, 'Nozzle temperature');

      await user.click(screen.getByRole('button', { name: 'Clear base' }));
      const dialog = screen.getByRole('dialog', { name: 'Clear the base preset?' });
      expect(dialog).toHaveTextContent(
        'Clearing the base also clears the targets, and the unsaved changes are lost.',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Clear' }));

      expect(screen.getByRole('button', { name: 'Choose base' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Choose targets' })).toHaveAccessibleDescription(
        'Choose a base preset first',
      );
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('opens targets added later, keeping the unsaved changes', async () => {
      const { user } = setup();
      await compare(user, 'PLA', 'ASA');
      await copy(user, 'Nozzle temperature');

      await chooseTargets(user, ['Nylon']);

      expect(await screen.findByRole('columnheader', { name: /^Nylon/ })).toBeInTheDocument();
      expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
      expect(within(rowOf('Nozzle temperature')).getAllByRole('cell').at(-1)).toHaveTextContent(
        '260',
      );
    });
  });
});
