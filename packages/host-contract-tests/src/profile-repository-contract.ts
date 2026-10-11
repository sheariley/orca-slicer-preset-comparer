import { isComparerError, type ProfileRepository } from '@comparer/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { contractDocuments } from './contract-documents.ts';

export type RepositoryFactory = (
  documents: typeof contractDocuments,
) => ProfileRepository | Promise<ProfileRepository>;

/**
 * The behavior every ProfileRepository must share. Call it from each adapter's test file with
 * a factory that seeds the adapter with the given documents.
 */
export function describeProfileRepositoryContract(name: string, factory: RepositoryFactory): void {
  describe(`ProfileRepository contract: ${name}`, () => {
    let repository: ProfileRepository;

    beforeEach(async () => {
      repository = await factory(contractDocuments);
    });

    const find = async (presetName: string, vendor?: string) => {
      const presets = await repository.listPresets();
      const match = presets.find(
        (ref) => ref.name === presetName && (vendor === undefined || ref.vendor === vendor),
      );
      if (!match) throw new Error(`Seeded preset "${presetName}" wasn't listed.`);
      return match;
    };

    it('lists every seeded preset with its type and origin', async () => {
      const presets = await repository.listPresets();
      const summary = presets.map((ref) => `${ref.type}:${ref.origin}:${ref.name}`).sort();

      expect(summary).toEqual(
        contractDocuments.map(({ ref }) => `${ref.type}:${ref.origin}:${ref.name}`).sort(),
      );
    });

    it('filters presets by type', async () => {
      const processes = await repository.listPresets({ type: 'process' });

      expect(processes.map((ref) => ref.name)).toEqual(['0.20mm']);
    });

    it("reads a preset's own content without resolving inheritance", async () => {
      const document = await repository.readDocument(await find('PLA A'));

      expect(document.content['inherits']).toBe('common');
      expect(document.content['nozzle_temperature']).toEqual(['210']);
    });

    it("returns the file's text alongside the parsed content", async () => {
      const document = await repository.readDocument(await find('PLA A'));

      expect(typeof document.text).toBe('string');
      expect(JSON.parse(document.text!)).toEqual(document.content);
    });

    it('declares the line endings for new files', () => {
      expect(['\n', '\r\n']).toContain(repository.newline);
    });

    it("resolves a parent in the child's own vendor first", async () => {
      const parent = await repository.resolveParent(await find('PLA A'), 'common');

      expect(parent?.vendor).toBe('VendorA');
    });

    it('resolves a system parent for a user preset', async () => {
      const parent = await repository.resolveParent(await find('My PLA'), 'PLA A');

      expect(parent?.name).toBe('PLA A');
    });

    it('resolves a user parent for a user preset', async () => {
      const parent = await repository.resolveParent(await find('My Derived'), 'My Base');

      expect(parent).toMatchObject({ name: 'My Base', origin: 'user' });
    });

    it('returns undefined for an unknown parent', async () => {
      expect(await repository.resolveParent(await find('PLA A'), 'missing')).toBeUndefined();
    });

    it('rejects reading an unknown preset with not-found', async () => {
      const ghost = { ...(await find('PLA A')), id: 'no-such-id', name: 'ghost' };

      await expect(repository.readDocument(ghost)).rejects.toSatisfy(
        (error) => isComparerError(error) && error.kind === 'not-found',
      );
    });

    it('saves the exact text when it can, and refuses with unsupported when it cannot', async () => {
      const document = await repository.readDocument(await find('My PLA'));
      // Unusual but valid formatting: hosts must write the bytes as given, never re-serialize.
      const text = `{\r\n  "name": "My PLA",\r\n  "inherits": "PLA A",\r\n  "nozzle_temperature": ["220"]\r\n}\r\n`;
      const request = { ref: document.ref, text, previousText: document.text };

      if (repository.capabilities.canSave) {
        await repository.saveDocument(request);
        const reread = await repository.readDocument(document.ref);
        expect(reread.text).toBe(text);
        expect(reread.content['nozzle_temperature']).toEqual(['220']);
      } else {
        await expect(repository.saveDocument(request)).rejects.toSatisfy(
          (error) => isComparerError(error) && error.kind === 'unsupported',
        );
      }
    });

    it('refuses to overwrite a file that changed since it was read', async () => {
      if (!repository.capabilities.canSave) return;
      const document = await repository.readDocument(await find('My PLA'));

      await expect(
        repository.saveDocument({ ref: document.ref, text: '{}\n', previousText: 'stale text' }),
      ).rejects.toSatisfy((error) => isComparerError(error) && error.kind === 'conflict');
      expect((await repository.readDocument(document.ref)).text).toBe(document.text);
    });

    it('creates a user preset that lists, reads, and resolves its parent like any other', async () => {
      const parent = await find('PLA A');
      const request = {
        type: 'filament' as const,
        name: 'PLA A - Copy',
        content: { name: 'PLA A - Copy', inherits: 'PLA A', from: 'User', fan_max_speed: ['80'] },
        parent,
      };
      if (!repository.capabilities.canSave) {
        await expect(repository.createPreset(request)).rejects.toSatisfy(
          (error) => isComparerError(error) && error.kind === 'unsupported',
        );
        return;
      }

      const { ref } = await repository.createPreset(request);

      expect(ref).toMatchObject({ name: 'PLA A - Copy', type: 'filament', origin: 'user' });
      expect((await repository.listPresets()).map((preset) => preset.id)).toContain(ref.id);
      const created = await repository.readDocument(ref);
      expect(created.content).toMatchObject(request.content);
      // OrcaSlicer's format for new files: sorted keys, one tab per level, a final newline.
      expect(created.text).toMatch(new RegExp(`^\\{${repository.newline}\\t"fan_max_speed"`));
      expect(created.text!.endsWith(`}${repository.newline}`)).toBe(true);
      expect((await repository.resolveParent(ref, 'PLA A'))?.id).toBe(parent.id);
    });

    it('refuses to create a preset with a name already in use, with name-taken', async () => {
      if (!repository.capabilities.canSave) return;
      const parent = await find('PLA A');

      await expect(
        repository.createPreset({ type: 'filament', name: 'My PLA', content: {}, parent }),
      ).rejects.toSatisfy((error) => isComparerError(error) && error.kind === 'name-taken');
      // System preset names count too.
      await expect(
        repository.createPreset({ type: 'filament', name: 'PLA A', content: {}, parent }),
      ).rejects.toSatisfy((error) => isComparerError(error) && error.kind === 'name-taken');
    });
  });
}
