import { PROTOCOL_VERSION } from '@comparer/bridge-protocol';
import { ComparerError, type ProfileRepository } from '@comparer/core';
import { createBridgeClient } from './bridge-client.ts';
import type { BridgeTransport } from './transport.ts';

export interface OrcaHostOptions {
  readonly timeoutMs?: number;
}

/**
 * Connects to the plugin's Python layer and returns a repository backed by it. Performs the
 * protocol handshake first, so a version mismatch fails at startup, not mid-session.
 */
export async function createOrcaHost(
  transport: BridgeTransport,
  options: OrcaHostOptions = {},
): Promise<ProfileRepository> {
  const client = createBridgeClient(transport, options.timeoutMs);
  const hello = await client.call('hello', { protocolVersion: PROTOCOL_VERSION });
  if (hello.protocolVersion !== PROTOCOL_VERSION) {
    throw new ComparerError(
      'unsupported',
      `The plugin speaks bridge protocol ${hello.protocolVersion}; this UI needs ${PROTOCOL_VERSION}.`,
    );
  }

  return {
    capabilities: hello.capabilities,
    newline: hello.newline,
    async listPresets(query) {
      const { presets } = await client.call('listPresets', query?.type ? { type: query.type } : {});
      return presets;
    },
    async readDocument(ref) {
      const { content, text } = await client.call('readDocument', { ref });
      return { ref, content, text };
    },
    async resolveParent(child, parentName) {
      const { ref } = await client.call('resolveParent', { child, parentName });
      return ref ?? undefined;
    },
    async saveDocument({ ref, text, previousText }) {
      const { reloadRequired } = await client.call('saveDocument', {
        ref,
        text,
        ...(previousText !== undefined ? { previousText } : {}),
      });
      return { ref, reloadRequired };
    },

    async createPreset() {
      // The plugin can't save yet (canSave: false), so the UI never gets here.
      throw new ComparerError('unsupported', "Creating presets isn't supported in the plugin yet.");
    },
  };
}
