import { createComparerApp } from '@comparer/app';
import type { DataFolder, ProfileDocument } from '@comparer/core';
import { createMemoryHost } from '@comparer/host-memory';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ComparerRoot } from '../../ComparerRoot.tsx';

const documents: ProfileDocument[] = [
  { ref: { id: 'PLA', name: 'PLA', type: 'filament', origin: 'user' }, content: { name: 'PLA' } },
];

/** A data folder that records what the dialog asks of it. */
function fakeDataFolder(overrides: Partial<DataFolder> = {}) {
  const calls: (string | null)[] = [];
  const folder: DataFolder = {
    path: 'C:\\Users\\me\\AppData\\Roaming\\OrcaSlicer',
    isDefault: true,
    choose: async () => 'D:\\Portable\\OrcaSlicer\\data',
    use: async (path) => {
      calls.push(path);
    },
    ...overrides,
  };
  return { folder, calls };
}

function setup(dataFolder?: DataFolder) {
  const app = createComparerApp({
    repository: createMemoryHost({ documents }),
    catalog: {
      describe: (key) => ({ key, label: key }),
      defaultsFor: () => new Map(),
      legacyKeys: () => ({ obsolete: new Set<string>(), renamed: new Map<string, string>() }),
      keyRules: () => ({ owned: new Set<string>(), perVariant: new Set<string>() }),
    },
    ...(dataFolder ? { dataFolder } : {}),
  });
  render(<ComparerRoot app={app} />);
  return userEvent.setup();
}

describe('settings', () => {
  it("has no settings button on hosts that can't change the data folder", async () => {
    setup();
    await screen.findByRole('button', { name: 'Choose base' });
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('shows the folder in use, and switches to a chosen one', async () => {
    const { folder, calls } = fakeDataFolder();
    const user = setup(folder);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveTextContent('C:\\Users\\me\\AppData\\Roaming\\OrcaSlicer');
    expect(within(dialog).getByText('Default')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Use default' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Choose folder' }));
    expect(calls).toEqual(['D:\\Portable\\OrcaSlicer\\data']);
  });

  it("says why a folder can't be used, and goes back to the default", async () => {
    const { folder, calls } = fakeDataFolder({
      path: 'D:\\Old',
      isDefault: false,
      problem: undefined,
      use: async (path) => {
        calls.push(path);
        if (path !== null)
          throw new Error("D:\\Downloads doesn't look like OrcaSlicer's data folder.");
      },
      choose: async () => 'D:\\Downloads',
    });
    const user = setup(folder);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });

    await user.click(within(dialog).getByRole('button', { name: 'Choose folder' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      "D:\\Downloads doesn't look like OrcaSlicer's data folder.",
    );
    await user.click(within(dialog).getByRole('button', { name: 'Use default' }));
    expect(calls).toEqual(['D:\\Downloads', null]);
  });

  it('cancelling the folder picker changes nothing', async () => {
    const { folder, calls } = fakeDataFolder({ choose: async () => undefined });
    const user = setup(folder);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    expect(calls).toEqual([]);
  });

  it('reports a chosen folder that failed at startup', async () => {
    const { folder } = fakeDataFolder({ problem: "Couldn't use D:\\Gone: it no longer exists." });
    const user = setup(folder);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't use D:\\Gone");
  });
});
