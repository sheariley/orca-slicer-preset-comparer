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

function renderComparer(canSave = false, settings?: SettingsStore) {
  const app = createComparerApp({
    ...(settings ? { settings } : {}),
    repository: createMemoryHost({ documents, capabilities: { canSave } }),
    catalog: {
      describe: (key) =>
        key === 'nozzle_temperature'
          ? {
              key,
              label: 'Nozzle temperature',
              unit: '℃',
              tooltip: 'Temperature after the first layer.',
            }
          : key === 'bambu_only'
            ? undefined
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
    const rows = within(table).getAllByRole('row').slice(1);
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

    await user.click(screen.getByLabelText(/Hide settings OrcaSlicer doesn't use \(1\)/));
    expect(within(table).getByText('bambu_only')).toBeInTheDocument();
  });

  it('marks a host that cannot save as read-only', async () => {
    renderComparer(false);
    expect(await screen.findByText('Read-only')).toBeInTheDocument();
  });

  describe('hiding the presets', () => {
    it('folds the pickers into a summary line, and back', async () => {
      const user = userEvent.setup();
      const settings = memorySettings();
      renderComparer(false, settings);

      // Nothing to fold away until there's a comparison.
      expect(screen.queryByRole('button', { name: 'Hide presets' })).not.toBeInTheDocument();
      await compare(user, 'PLA', 'PETG');

      const hide = screen.getByRole('button', { name: 'Hide presets' });
      expect(hide).toHaveAttribute('aria-expanded', 'true');
      await user.click(hide);

      expect(screen.getByRole('button', { name: BASE_BUTTON, hidden: true })).not.toBeVisible();
      // The type tabs share the title's row, so they stay.
      expect(screen.getByRole('tab', { name: 'Filament' })).toBeVisible();
      expect(document.querySelector('.selection-summary')).toHaveTextContent('PLA vs PETG');
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(settings.saved).toEqual({ 'layout.hidePresets': true });

      const show = screen.getByRole('button', { name: 'Show presets' });
      expect(show).toHaveAttribute('aria-expanded', 'false');
      await user.click(show);

      expect(screen.getByRole('button', { name: BASE_BUTTON })).toBeVisible();
      expect(settings.saved).toEqual({ 'layout.hidePresets': false });
    });

    it('remembers the choice for the next comparison', async () => {
      const user = userEvent.setup();
      renderComparer(false, memorySettings({ 'layout.hidePresets': true }));

      // The pickers stay while nothing is compared, then fold away.
      await compare(user, 'PLA', 'PETG');

      expect(await screen.findByRole('button', { name: 'Show presets' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: BASE_BUTTON, hidden: true })).not.toBeVisible();
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

    it('waits for a base preset before targets can be chosen', async () => {
      const user = userEvent.setup();
      renderComparer();

      expect(await screen.findByRole('button', { name: TARGETS_BUTTON })).toBeDisabled();
      expect(screen.getByText('Choose a base preset first')).toBeInTheDocument();
      await chooseBase(user, 'PLA');
      expect(screen.getByRole('button', { name: TARGETS_BUTTON })).toBeEnabled();
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
  });
});
