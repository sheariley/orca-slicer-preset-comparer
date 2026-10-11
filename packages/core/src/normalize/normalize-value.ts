/** A setting value in comparable form: always an array of strings. */
export type NormalizedValue = readonly string[];

/**
 * Converts a raw profile value to its comparable form, so `"16"` and `["16"]` compare equal.
 * Profiles store everything as strings; numbers and booleans are accepted defensively.
 */
export function normalizeValue(raw: unknown): NormalizedValue {
  if (Array.isArray(raw)) return raw.map(scalarToString);
  return [scalarToString(raw)];
}

function scalarToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? '';
}

export function valuesEqual(a: NormalizedValue, b: NormalizedValue): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * Resizes an array value the way OrcaSlicer resizes per-variant settings
 * (`ConfigOptionVector::resize`): truncates, or pads by repeating the **first** value. (Its code
 * comment says "last", but the code uses `front()`.) An empty value stays empty.
 */
export function resizeValue(value: NormalizedValue, length: number): NormalizedValue {
  const first = value[0];
  if (first === undefined || value.length === length) return value;
  return value.length > length
    ? value.slice(0, length)
    : [...value, ...Array<string>(length - value.length).fill(first)];
}
