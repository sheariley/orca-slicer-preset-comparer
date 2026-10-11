// The message format between the plugin UI (host-orca) and the plugin's Python layer.
//
// The page sends a request; Python answers with a response carrying the same id. Every
// message names the protocol version, and the first request is always `hello`. Python can't
// use these zod schemas, so samples/ holds example messages both sides test against.
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

export const profileTypeSchema = z.enum(['filament', 'process', 'machine']);

export const presetRefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: profileTypeSchema,
  origin: z.enum(['system', 'user', 'file']),
  vendor: z.string().optional(),
});

const contentSchema = z.record(z.string(), z.unknown());

const capabilitiesSchema = z.object({
  canSave: z.boolean(),
  canBrowseFiles: z.boolean(),
  canWatchForChanges: z.boolean(),
});

/** Each method's params and result. */
export const methods = {
  hello: {
    params: z.object({ protocolVersion: z.number().int() }),
    result: z.object({
      protocolVersion: z.number().int(),
      capabilities: capabilitiesSchema,
      /** The platform's line endings, for new files ("\r\n" on Windows). */
      newline: z.enum(['\n', '\r\n']),
    }),
  },
  listPresets: {
    params: z.object({ type: profileTypeSchema.optional() }),
    result: z.object({ presets: z.array(presetRefSchema) }),
  },
  readDocument: {
    params: z.object({ ref: presetRefSchema }),
    /** `text` is the file exactly as read; `content` is it parsed. */
    result: z.object({ content: contentSchema, text: z.string() }),
  },
  resolveParent: {
    params: z.object({ child: presetRefSchema, parentName: z.string() }),
    result: z.object({ ref: presetRefSchema.nullable() }),
  },
  saveDocument: {
    /** Writes `text` exactly; refuses with `conflict` if the file no longer holds previousText. */
    params: z.object({
      ref: presetRefSchema,
      text: z.string(),
      previousText: z.string().optional(),
    }),
    result: z.object({ reloadRequired: z.enum(['none', 'reselect-preset', 'restart']) }),
  },
} as const;

export type Method = keyof typeof methods;
export type Params<M extends Method> = z.infer<(typeof methods)[M]['params']>;
export type Result<M extends Method> = z.infer<(typeof methods)[M]['result']>;

const methodNames = Object.keys(methods) as [Method, ...Method[]];

export const requestSchema = z.object({
  protocol: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  method: z.enum(methodNames),
  params: z.unknown(),
});

export const errorSchema = z.object({
  kind: z.enum([
    'access-denied',
    'not-found',
    'invalid-profile',
    'inheritance-cycle',
    'unsupported',
    'conflict',
    'busy',
    'name-taken',
    'host-error',
  ]),
  message: z.string(),
  subject: z.string().optional(),
});

export const responseSchema = z.discriminatedUnion('ok', [
  z.object({
    protocol: z.literal(PROTOCOL_VERSION),
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    protocol: z.literal(PROTOCOL_VERSION),
    id: z.string(),
    ok: z.literal(false),
    error: errorSchema,
  }),
]);

export type BridgeRequest = z.infer<typeof requestSchema>;
export type BridgeResponse = z.infer<typeof responseSchema>;
export type BridgeError = z.infer<typeof errorSchema>;
