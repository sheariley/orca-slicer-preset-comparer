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
  // Bulk-copy targets: one already matches PLA, one gets left out.
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

async function compare(user: ReturnType<typeof userEvent.setup>, left: string, right: string) {
  await user.selectOptions(await screen.findByLabelText('Left'), left);
  await user.selectOptions(screen.getByLabelText('Right'), right);
  return screen.findByRole('table');
}

const rowOf = (label: string) => within(screen.getByRole('table')).getByText(label).closest('tr')!;

describe('editing', () => {
  it('copies one setting with one click, marks it unsaved, and undoes and redoes it', async () => {
    const { user } = setup();
    await compare(user, 'PLA', 'PETG');

    await user.click(screen.getByRole('button', { name: 'Copy Nozzle temperature to PETG' }));

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

  it('explains a one-click copy that changes nothing', async () => {
    const { user } = setup();
    await compare(user, 'PLA', 'PETG');

    await user.click(screen.getByRole('button', { name: 'Copy print_speed to PETG' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      "Didn't copy print_speed: OrcaSlicer doesn't use this setting in this kind of preset.",
    );
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });

  it('asks whether to pin a redundant override, and saves the choice', async () => {
    const { user, fileText } = setup();
    await compare(user, 'ASA', 'PETG');

    // ASA's 230 is what PETG inherits from Generic PETG, so PETG's override would be redundant.
    await user.click(screen.getByRole('button', { name: 'Copy Nozzle temperature to PETG' }));
    const dialog = screen.getByRole('dialog', { name: 'Copy 1 setting to PETG' });
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

    await user.click(screen.getByRole('button', { name: 'Save…' }));
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

    await user.click(screen.getByRole('button', { name: 'Copy Nozzle temperature to PETG' }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await user.click(screen.getByRole('button', { name: 'Save…' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await fileText('PETG')).not.toContain('nozzle_temperature');
  });

  it('saves after a confirmation, and reports the result', async () => {
    const { user, fileText } = setup();
    await compare(user, 'PLA', 'PETG');
    await user.click(screen.getByRole('button', { name: 'Copy Nozzle temperature to PETG' }));

    await user.click(screen.getByRole('button', { name: 'Save…' }));
    const dialog = screen.getByRole('dialog', { name: 'Save changes' });
    expect(dialog).toHaveTextContent('PETG: Nozzle temperature');
    expect(dialog).not.toHaveTextContent('(nozzle_temperature)');
    expect(dialog).toHaveTextContent("A running OrcaSlicer won't see these changes");
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    const results = await screen.findByRole('region', { name: 'Save results' });
    expect(results).toHaveTextContent('Saved 1 of 1.');
    expect(await fileText('PETG')).toContain('"210"');
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save…' })).toBeDisabled();
  });

  it('tells apart settings that share a label, in the controls and the save confirmation', async () => {
    const { user } = setup();
    await compare(user, 'PLA', 'PETG');

    await user.click(
      screen.getByRole('button', { name: 'Copy Fan speed (fan_min_speed) to PETG' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save…' }));

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
    await user.click(screen.getByRole('button', { name: 'Copy Nozzle temperature to PETG' }));
    await user.click(screen.getByRole('button', { name: 'Save…' }));
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
    await user.click(screen.getByRole('button', { name: 'Copy Nozzle temperature to PETG' }));
    // Meanwhile, OrcaSlicer saves PETG with another change.
    await editElsewhere('PETG', '"30"', '"35"');

    await user.click(screen.getByRole('button', { name: 'Save…' }));
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

    await user.click(screen.getByRole('button', { name: 'Save…' }));
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
    await user.click(screen.getByRole('button', { name: 'Copy Nozzle temperature to PETG' }));
    await user.click(screen.getByRole('button', { name: 'Save…' }));
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

    await user.click(screen.getByRole('button', { name: 'Copy Nozzle temperature to PETG' }));
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
    await user.click(screen.getByRole('button', { name: 'Copy Nozzle temperature to PETG' }));

    await user.selectOptions(screen.getByLabelText('Left'), 'ASA');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', {
        name: 'Keep editing',
      }),
    );
    expect(screen.getByLabelText('Left')).toHaveValue('PLA');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Left'), 'ASA');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Left')).toHaveValue('ASA');
    expect(await screen.findByText('No unsaved changes')).toBeInTheDocument();
  });

  it("doesn't offer copying into a system preset, and says why", async () => {
    const { user } = setup();
    await compare(user, 'PLA', 'Generic PETG');

    expect(
      screen.queryByRole('button', { name: 'Copy Nozzle temperature to Generic PETG' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy Nozzle temperature to PLA' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy selected to Generic PETG/ })).toBeDisabled();
    expect(within(screen.getByRole('table')).getByText('System')).toBeInTheDocument();
  });

  describe('copying to other presets', () => {
    async function openBulkCopy(user: ReturnType<typeof userEvent.setup>) {
      await compare(user, 'PLA', 'PETG');
      await user.click(screen.getByRole('checkbox', { name: 'Select Nozzle temperature' }));
      await user.click(screen.getByRole('checkbox', { name: 'Select Fan speed (fan_max_speed)' }));
      await user.click(screen.getByRole('button', { name: 'Copy selected to other presets…' }));
      return screen.getByRole('dialog', { name: 'Copy 2 settings to other presets' });
    }

    it('copies to many presets as one step, after a preview of each', async () => {
      const { user, fileText } = setup();
      let dialog = await openBulkCopy(user);

      expect(within(dialog).getByRole('radio', { name: 'Left: PLA' })).toBeChecked();
      // The source isn't offered as a target.
      expect(within(dialog).queryByRole('checkbox', { name: /^PLA/ })).not.toBeInTheDocument();
      await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Origin' }), 'user');
      await user.click(within(dialog).getByRole('checkbox', { name: 'Select all shown (4)' }));
      expect(within(dialog).getByRole('checkbox', { name: 'ASA (User)' })).toBeChecked();
      expect(
        within(dialog).queryByRole('checkbox', { name: /Generic PETG/ }),
      ).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Preview…' }));

      dialog = await screen.findByRole('dialog', { name: 'Copy 2 settings to other presets' });
      await within(dialog).findByRole('button', { name: 'Back' });
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
      expect(dialog).toHaveTextContent('From PLA: 2 of 4 presets will change.');
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

      await user.click(screen.getByRole('button', { name: 'Save…' }));
      const save = screen.getByRole('dialog', { name: 'Save changes' });
      expect(save).toHaveTextContent('ASA: Nozzle temperature, Fan speed (fan_max_speed)');
      await user.click(within(save).getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('region', { name: 'Save results' })).toHaveTextContent(
        'Saved 2 of 2.',
      );
      expect(await fileText('ASA')).toMatch(/"fan_max_speed": \[\s*"100"/);
      expect(await fileText('Nylon')).toContain('"260"');
    });

    it('lets users pick the source, drop settings, and filter targets; leaves system presets out', async () => {
      const { user } = setup();
      const dialog = await openBulkCopy(user);

      await user.click(within(dialog).getByRole('radio', { name: 'Right: PETG' }));
      await user.click(within(dialog).getByRole('checkbox', { name: 'Fan speed (fan_max_speed)' }));
      expect(dialog).toHaveTextContent('Settings (1 of 2)');
      await user.type(within(dialog).getByRole('searchbox', { name: 'Filter presets' }), 'generic');
      expect(within(dialog).getAllByRole('checkbox', { name: / \((User|V)\)$/ })).toHaveLength(1);
      await user.click(within(dialog).getByRole('checkbox', { name: 'Generic PETG (V)' }));
      await user.click(within(dialog).getByRole('button', { name: 'Preview…' }));

      const preview = await screen.findByRole('dialog', {
        name: 'Copy 1 setting to other presets',
      });
      await within(preview).findByRole('button', { name: 'Back' });
      expect(preview).toHaveTextContent("A system preset, which can't be changed.");
      expect(within(preview).getByRole('button', { name: 'Copy to 0 presets' })).toBeDisabled();

      // Back keeps the choices.
      await user.click(within(preview).getByRole('button', { name: 'Back' }));
      expect(screen.getByRole('radio', { name: 'Right: PETG' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Generic PETG (V)' })).toBeChecked();
    });
  });
});
