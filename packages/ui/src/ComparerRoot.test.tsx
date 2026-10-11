import { createComparerApp } from '@comparer/app';
import type { ProfileDocument, SettingsStore } from '@comparer/core';
import { createMemoryHost } from '@comparer/host-memory';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ComparerRoot } from './ComparerRoot.tsx';

const filament = (name: string, content: Record<string, unknown>): ProfileDocument => ({
  ref: { id: name, name, type: 'filament', origin: 'user' },
  content: { name, ...content },
});

const documents = [
  filament('PLA', { nozzle_temperature: ['210'], fan_max_speed: ['100'], bambu_only: ['1'] }),
  filament('PETG', { nozzle_temperature: ['240'], fan_max_speed: ['100'] }),
];

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

    await user.selectOptions(await screen.findByLabelText('Left'), 'PLA');
    await user.selectOptions(screen.getByLabelText('Right'), 'PETG');

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Nozzle temperature');
    expect(rows[0]).toHaveTextContent('210');
    expect(rows[0]).toHaveTextContent('240');
  });

  it('can show identical settings too', async () => {
    const user = userEvent.setup();
    renderComparer();

    await user.selectOptions(await screen.findByLabelText('Left'), 'PLA');
    await user.selectOptions(screen.getByLabelText('Right'), 'PETG');
    await user.click(await screen.findByLabelText(/Only differences/));

    expect(within(screen.getByRole('table')).getByText('fan_max_speed')).toBeInTheDocument();
  });

  it("marks built-in defaults, and tells where each value came from in the row's info tip", async () => {
    const user = userEvent.setup();
    renderComparer();

    await user.selectOptions(await screen.findByLabelText('Left'), 'PLA');
    await user.selectOptions(screen.getByLabelText('Right'), 'PETG');
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

    await user.selectOptions(await screen.findByLabelText('Left'), 'PLA');
    await user.selectOptions(screen.getByLabelText('Right'), 'PETG');
    await user.click(await screen.findByRole('button', { name: 'About Nozzle temperature' }));

    expect(screen.getByRole('tooltip')).toHaveTextContent('Temperature after the first layer');
  });

  it("hides settings OrcaSlicer doesn't use until asked", async () => {
    const user = userEvent.setup();
    renderComparer();

    await user.selectOptions(await screen.findByLabelText('Left'), 'PLA');
    await user.selectOptions(screen.getByLabelText('Right'), 'PETG');
    const table = await screen.findByRole('table');
    expect(within(table).queryByText('bambu_only')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/Hide settings OrcaSlicer doesn't use \(1\)/));
    expect(within(table).getByText('bambu_only')).toBeInTheDocument();
  });

  it('marks a host that cannot save as read-only', async () => {
    renderComparer(false);
    expect(await screen.findByText('Read-only')).toBeInTheDocument();
  });

  describe('hiding the presets', () => {
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

    async function compare(user: ReturnType<typeof userEvent.setup>) {
      await user.selectOptions(await screen.findByLabelText('Left'), 'PLA');
      await user.selectOptions(screen.getByLabelText('Right'), 'PETG');
      await screen.findByRole('table');
    }

    it('folds the type tabs and pickers into a summary line, and back', async () => {
      const user = userEvent.setup();
      const settings = memorySettings();
      renderComparer(false, settings);

      // Nothing to fold away until two presets are chosen.
      expect(screen.queryByRole('button', { name: 'Hide presets' })).not.toBeInTheDocument();
      await compare(user);

      const hide = screen.getByRole('button', { name: 'Hide presets' });
      expect(hide).toHaveAttribute('aria-expanded', 'true');
      await user.click(hide);

      expect(screen.getByLabelText('Left')).not.toBeVisible();
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
      expect(screen.getByText(/Filament:/)).toHaveTextContent('Filament: PLA vs PETG');
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(settings.saved).toEqual({ 'layout.hidePresets': true });

      const show = screen.getByRole('button', { name: 'Show presets' });
      expect(show).toHaveAttribute('aria-expanded', 'false');
      await user.click(show);

      expect(screen.getByLabelText('Left')).toBeVisible();
      expect(settings.saved).toEqual({ 'layout.hidePresets': false });
    });

    it('remembers the choice for the next comparison', async () => {
      const user = userEvent.setup();
      renderComparer(false, memorySettings({ 'layout.hidePresets': true }));

      // The pickers stay while nothing is compared, then fold away.
      await compare(user);

      expect(await screen.findByRole('button', { name: 'Show presets' })).toBeInTheDocument();
      expect(screen.getByLabelText('Left')).not.toBeVisible();
    });
  });
});
