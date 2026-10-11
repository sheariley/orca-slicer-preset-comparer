import { createComparerApp } from '@comparer/app';
import type { ProfileDocument, SettingsStore } from '@comparer/core';
import { createMemoryHost } from '@comparer/host-memory';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ComparerRoot } from './ComparerRoot.tsx';

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
  filament('PLA', { nozzle_temperature: ['210'], fan_max_speed: ['100'], bambu_only: ['1'] }),
  filament('PETG', { nozzle_temperature: ['240'], fan_max_speed: ['100'] }),
  filament('ABS', { nozzle_temperature: ['250'] }),
  filament('Generic PLA', { nozzle_temperature: ['215'] }, 'system'),
];

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

/** Compares `base` with `targets`, chosen in the target picker. */
async function compare(user: User, base: string, ...targets: string[]) {
  await chooseBase(user, base);
  await user.click(screen.getByRole('button', { name: TARGETS_BUTTON }));
  const dialog = screen.getByRole('dialog', { name: 'Choose targets' });
  for (const name of targets) {
    await user.click(within(dialog).getByRole('checkbox', { name: `Choose ${name}` }));
  }
  await user.click(within(dialog).getByRole('button', { name: 'Compare' }));
  return screen.findByRole('table');
}

/** A store that keeps what was saved, starting from `saved`. */
const memorySettings = (saved: Record<string, unknown> = {}) => {
  const store = {
    saved,
    load: async () => store.saved,
    save: async (settings: Readonly<Record<string, unknown>>) => {
      store.saved = { ...settings };
    },
  };
  return store;
};

function renderComparer(
  canSave = false,
  settings?: SettingsStore,
  extra: readonly ProfileDocument[] = [],
) {
  const app = createComparerApp({
    ...(settings ? { settings } : {}),
    repository: createMemoryHost({
      documents: [...documents, ...extra],
      capabilities: { canSave },
    }),
    catalog: {
      describe: (key) =>
        key === 'nozzle_temperature'
          ? {
              key,
              label: 'Nozzle temperature',
              unit: '℃',
              tooltip: 'Temperature after the first layer.',
              sections: { filament: { page: 'Filament', group: 'Print temperature', order: 3 } },
            }
          : key === 'bambu_only'
            ? undefined
            : key === 'fuzzy_skin'
              ? {
                  key,
                  label: 'Fuzzy skin',
                  valueLabels: new Map([
                    ['disabled_fuzzy', 'Disabled'],
                    ['all', 'Contour and hole'],
                  ]),
                }
              : { key, label: key },
      defaultsFor: () => new Map([['filament_density', ['1.24']]]),
      legacyKeys: () => ({ obsolete: new Set<string>(), renamed: new Map<string, string>() }),
      keyRules: () => ({ owned: new Set<string>(), perVariant: new Set<string>() }),
    },
  });
  return render(<ComparerRoot app={app} />);
}

describe('ComparerRoot', () => {
  it('shows only the differing settings between two presets, by label', async () => {
    const user = userEvent.setup();
    renderComparer();

    const table = await compare(user, 'PLA', 'PETG');
    // Setting rows only: not the header row or section headers.
    const rows = within(table)
      .getAllByRole('row')
      .filter((row) => row.hasAttribute('data-status'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Nozzle temperature');
    expect(rows[0]).toHaveTextContent('210');
    expect(rows[0]).toHaveTextContent('240');
  });

  it('can show identical settings too', async () => {
    const user = userEvent.setup();
    renderComparer();

    await compare(user, 'PLA', 'PETG');
    await user.click(await screen.findByLabelText(/Only differences/));

    expect(within(screen.getByRole('table')).getByText('fan_max_speed')).toBeInTheDocument();
  });

  it("marks built-in defaults, and tells where each value came from in the row's info tip", async () => {
    const user = userEvent.setup();
    renderComparer();

    await compare(user, 'PLA', 'PETG');
    await user.click(await screen.findByLabelText(/Only differences/));

    const row = within(screen.getByRole('table')).getByText('filament_density').closest('tr')!;
    expect(within(row).getAllByRole('cell')[0]).toHaveClass('is-default');

    await user.click(within(row).getByRole('button', { name: 'About filament_density' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent("PLA: OrcaSlicer's built-in default");

    await user.click(within(row).getByRole('button', { name: 'About filament_density' }));
    await user.click(screen.getByRole('button', { name: 'About fan_max_speed' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('PLA: set in "PLA"');
    expect(screen.getByRole('tooltip')).toHaveTextContent('PETG: set in "PETG"');
  });

  it("shows values by OrcaSlicer's labels, and the stored value in the row's tip", async () => {
    const user = userEvent.setup();
    renderComparer(false, undefined, [
      filament('Fuzzy A', { fuzzy_skin: 'disabled_fuzzy' }),
      filament('Fuzzy B', { fuzzy_skin: 'all' }),
    ]);
    await compare(user, 'Fuzzy A', 'Fuzzy B');

    const row = within(screen.getByRole('table')).getByText('Fuzzy skin').closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Disabled');
    expect(cells[1]).toHaveTextContent('Contour and hole');
    await user.click(within(row).getByRole('button', { name: 'About Fuzzy skin' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Fuzzy A: Disabled (disabled_fuzzy), set in "Fuzzy A"',
    );
  });

  it('shows the setting description in the info tip', async () => {
    const user = userEvent.setup();
    renderComparer();

    await compare(user, 'PLA', 'PETG');
    await user.click(await screen.findByRole('button', { name: 'About Nozzle temperature' }));

    expect(screen.getByRole('tooltip')).toHaveTextContent('Temperature after the first layer');
  });

  it("hides settings OrcaSlicer doesn't use until asked", async () => {
    const user = userEvent.setup();
    renderComparer();

    const table = await compare(user, 'PLA', 'PETG');
    expect(within(table).queryByText('bambu_only')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/Hide unused \(1\)/));
    expect(within(table).getByText('bambu_only')).toBeInTheDocument();
  });

  it('marks a host that cannot save as read-only', async () => {
    renderComparer(false);
    expect(await screen.findByText('Read-only')).toBeInTheDocument();
  });

  describe('sorting and grouping', () => {
    const settingRows = () =>
      within(screen.getByRole('table'))
        .getAllByRole('row')
        .filter((row) => row.hasAttribute('data-status'))
        .map(
          (row) => within(row).getByRole('rowheader').querySelector('.setting-label')!.textContent,
        );

    it('sorts by the Setting column, A to Z by label, and the other way from its header', async () => {
      const user = userEvent.setup();
      renderComparer();
      await compare(user, 'PLA', 'PETG');
      await user.click(screen.getByLabelText(/Only differences/));
      // One list, not sections, to see the whole order.
      await user.click(screen.getByLabelText('Group by section'));

      expect(settingRows()).toEqual(['fan_max_speed', 'filament_density', 'Nozzle temperature']);
      const header = screen.getByRole('columnheader', { name: /Setting/ });
      expect(header).toHaveAttribute('aria-sort', 'ascending');
      await user.click(within(header).getByRole('button'));
      expect(header).toHaveAttribute('aria-sort', 'descending');
      expect(settingRows()).toEqual(['Nozzle temperature', 'filament_density', 'fan_max_speed']);
    });

    it("groups settings under OrcaSlicer's sections, in its order, and remembers the choice", async () => {
      const user = userEvent.setup();
      const settings = memorySettings();
      renderComparer(false, settings);
      await compare(user, 'PLA', 'PETG');
      await user.click(screen.getByLabelText(/Only differences/));

      const sectionTitles = () =>
        [...screen.getByRole('table').querySelectorAll('.section-title')].map(
          (el) => el.textContent,
        );
      // The test catalog places only the nozzle temperature; the rest are "Other", last.
      expect(sectionTitles()).toEqual(['Filament › Print temperature', 'Other']);

      await user.click(screen.getByLabelText('Group by section'));
      expect(sectionTitles()).toEqual([]);
      expect(settings.saved).toEqual({
        'table.onlyDifferences': false,
        'table.groupBySection': false,
      });
    });
  });

  describe('remembering choices', () => {
    it('remembers the preset type, but not the presets compared', async () => {
      const user = userEvent.setup();
      const settings = memorySettings({ 'comparer.presetType': 'process' });
      renderComparer(false, settings);

      expect(await screen.findByRole('tab', { name: 'Process' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await user.click(screen.getByRole('tab', { name: 'Filament' }));
      expect(settings.saved).toEqual({ 'comparer.presetType': 'filament' });

      await compare(user, 'PLA', 'PETG');
      expect(Object.keys(settings.saved)).toEqual(['comparer.presetType']);
    });

    it("remembers the table's toggles", async () => {
      const user = userEvent.setup();
      const settings = memorySettings({
        'table.onlyDifferences': false,
        'table.hideUnused': false,
      });
      renderComparer(false, settings);
      await compare(user, 'PLA', 'PETG');

      expect(screen.getByLabelText(/Only differences/)).not.toBeChecked();
      expect(screen.getByLabelText(/Hide unused/)).not.toBeChecked();
      expect(within(screen.getByRole('table')).getByText('bambu_only')).toBeInTheDocument();

      await user.click(screen.getByLabelText(/Only differences/));
      await user.click(screen.getByLabelText(/Hide unused/));
      expect(settings.saved).toEqual({ 'table.onlyDifferences': true, 'table.hideUnused': true });
    });
  });

  describe('choosing the base', () => {
    it('picks one preset from the same kind of table, without multi-select', async () => {
      const user = userEvent.setup();
      const settings = memorySettings();
      renderComparer(false, settings);
      await user.click(await screen.findByRole('button', { name: 'Choose base' }));
      const dialog = screen.getByRole('dialog', { name: 'Choose the base preset' });

      expect(within(dialog).queryByRole('checkbox', { name: /^Choose / })).not.toBeInTheDocument();
      expect(
        within(dialog)
          .getAllByRole('radio')
          .map((radio) => radio.getAttribute('aria-label')),
      ).toEqual(['Choose ABS', 'Choose PETG', 'Choose PLA']);
      expect(within(dialog).getByRole('button', { name: 'Choose' })).toBeDisabled();
      await user.click(within(dialog).getByLabelText('Show system presets'));
      expect(settings.saved).toEqual({ 'basePicker.showSystem': true });
      await user.type(within(dialog).getByRole('searchbox'), 'generic');
      await user.click(within(dialog).getByRole('radio', { name: 'Choose Generic PLA' }));
      expect(dialog).toHaveTextContent('Chosen: Generic PLA');
      await user.click(within(dialog).getByRole('button', { name: 'Choose' }));

      // The name may be cut short, so its info tip shows it in full.
      expect(screen.getByRole('button', { name: 'Base: Generic PLA' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'About the base preset' }));
      expect(screen.getByRole('tooltip')).toHaveTextContent('Generic PLA');
    });
  });

  describe('choosing targets', () => {
    async function openPicker(user: User) {
      await chooseBase(user, 'PLA');
      await user.click(screen.getByRole('button', { name: TARGETS_BUTTON }));
      return screen.getByRole('dialog', { name: 'Choose targets' });
    }
    const names = (dialog: HTMLElement) =>
      within(dialog)
        .getAllByRole('checkbox', { name: /^Choose (?!all)/ })
        .map((box) => box.getAttribute('aria-label')!.replace('Choose ', ''));

    it('waits for a base preset before targets can be chosen, and says so', async () => {
      const user = userEvent.setup();
      renderComparer();
      const button = await screen.findByRole('button', { name: 'Choose targets' });

      // The reason is the button's description, and a click shows it as a tooltip.
      expect(button).toHaveAccessibleDescription('Choose a base preset first');
      await user.click(button);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(
        screen.getByText('Choose a base preset first', { selector: '.info-tip' }),
      ).toBeVisible();

      await chooseBase(user, 'PLA');
      expect(
        screen.getByRole('button', { name: 'Choose targets' }),
      ).not.toHaveAccessibleDescription();
      await user.click(screen.getByRole('button', { name: 'Choose targets' }));
      expect(screen.getByRole('dialog', { name: 'Choose targets' })).toBeInTheDocument();
    });

    it('lists the user presets by name, without the base, and sorts them from the header', async () => {
      const user = userEvent.setup();
      renderComparer();
      const dialog = await openPicker(user);

      expect(names(dialog)).toEqual(['ABS', 'PETG']);
      await user.click(within(dialog).getByLabelText('Show system presets'));
      expect(names(dialog)).toEqual(['ABS', 'Generic PLA', 'PETG']);
      await user.click(within(dialog).getByLabelText('Show system presets'));
      const header = within(dialog).getByRole('columnheader', { name: /Name/ });
      expect(header).toHaveAttribute('aria-sort', 'ascending');
      await user.click(within(header).getByRole('button'));
      expect(header).toHaveAttribute('aria-sort', 'descending');
      expect(names(dialog)).toEqual(['PETG', 'ABS']);
    });

    it('filters by name, keeping hidden choices, and chooses all shown at once', async () => {
      const user = userEvent.setup();
      renderComparer();
      const dialog = await openPicker(user);

      await user.click(within(dialog).getByRole('checkbox', { name: 'Choose ABS' }));
      await user.type(
        within(dialog).getByRole('searchbox', { name: 'Filter presets by name' }),
        'pe',
      );
      expect(names(dialog)).toEqual(['PETG']);
      expect(dialog).toHaveTextContent('1 preset chosen (1 not shown)');
      await user.click(within(dialog).getByRole('checkbox', { name: 'Choose all shown presets' }));
      expect(dialog).toHaveTextContent('2 presets chosen');
      await user.click(within(dialog).getByRole('button', { name: 'Compare' }));

      expect(screen.getByRole('button', { name: '2 targets chosen' })).toBeInTheDocument();
      expect(await screen.findByRole('columnheader', { name: /^PETG/ })).toBeInTheDocument();
    });

    it('shows system presets on request, and remembers the choice', async () => {
      const user = userEvent.setup();
      const settings = memorySettings();
      renderComparer(false, settings);
      let dialog = await openPicker(user);

      expect(names(dialog)).not.toContain('Generic PLA');
      await user.click(within(dialog).getByLabelText('Show system presets'));
      expect(names(dialog)).toContain('Generic PLA');
      expect(settings.saved).toEqual({ 'targetPicker.showSystem': true });

      // Cancel changes nothing, and the next time the choice holds.
      await user.click(within(dialog).getByRole('checkbox', { name: 'Choose Generic PLA' }));
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('button', { name: 'Choose targets' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: TARGETS_BUTTON }));
      dialog = screen.getByRole('dialog', { name: 'Choose targets' });
      expect(within(dialog).getByLabelText('Show system presets')).toBeChecked();
      expect(
        within(dialog).getByRole('checkbox', { name: 'Choose Generic PLA' }),
      ).not.toBeChecked();
    });

    it('hides templates until asked, and filters by vendor and printer', async () => {
      const user = userEvent.setup();
      renderComparer(false, undefined, [
        filament('PLA @base', { instantiation: 'false' }, 'system'),
        {
          ref: {
            id: 'W/PETG HF',
            name: 'PETG HF',
            type: 'filament',
            origin: 'system',
            vendor: 'W',
          },
          content: { name: 'PETG HF', compatible_printers: ['Printer W 0.4 nozzle'] },
        },
        filament('My PLA HF', {
          inherits: 'Generic PLA',
          compatible_printers: ['Printer V 0.6 nozzle'],
        }),
      ]);
      const dialog = await openPicker(user);
      await user.click(within(dialog).getByLabelText('Show system presets'));
      expect(names(dialog)).not.toContain('PLA @base');

      await user.click(within(dialog).getByLabelText('Show templates'));
      expect(names(dialog)).toContain('PLA @base');
      expect(within(dialog).getByText('Template')).toBeInTheDocument();

      // A user preset belongs to its system parent's vendor.
      await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Vendor' }), 'V');
      expect(names(dialog)).toEqual(['Generic PLA', 'My PLA HF', 'PLA @base']);
      await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Vendor' }), '');
      // Presets that list no printers are for any printer.
      await user.selectOptions(
        within(dialog).getByRole('combobox', { name: 'Printer' }),
        'Printer W 0.4 nozzle',
      );
      expect(names(dialog)).toEqual(['ABS', 'Generic PLA', 'PETG', 'PETG HF', 'PLA @base']);
    });

    it('tells apart presets with the same name by their user folder ("account" for an account\'s)', async () => {
      const user = userEvent.setup();
      renderComparer(false, undefined, [
        {
          ref: { id: '1234/PETG', name: 'PETG', type: 'filament', origin: 'user', folder: '1234' },
          content: { name: 'PETG' },
        },
      ]);
      const dialog = await openPicker(user);

      expect(
        within(dialog).getByRole('checkbox', { name: 'Choose PETG (account)' }),
      ).toBeInTheDocument();
      expect(within(dialog).getByText('account')).toBeInTheDocument();
      // The fixture's own PETG has no folder of its own.
      expect(
        within(dialog).getByRole('checkbox', { name: 'Choose PETG (user)' }),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole('checkbox', { name: 'Choose ABS' })).toBeInTheDocument();
    });

    it('names each account by the start of its id when there are several, and "default"', async () => {
      const user = userEvent.setup();
      const copy = (folder: string) => ({
        ref: {
          id: `${folder}/ABS`,
          name: 'ABS',
          type: 'filament' as const,
          origin: 'user' as const,
          folder,
        },
        content: { name: 'ABS' },
      });
      renderComparer(false, undefined, [
        copy('default'),
        copy('1234abcd-0000'),
        copy('5678efgh-0000'),
      ]);
      const dialog = await openPicker(user);

      expect(
        names(dialog)
          .filter((name) => name.startsWith('ABS'))
          .sort(),
      ).toEqual([
        'ABS (account 1234abcd)',
        'ABS (account 5678efgh)',
        'ABS (default)',
        'ABS (user)',
      ]);
    });
  });
});
