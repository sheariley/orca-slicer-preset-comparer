import type { NormalizedValue } from '@comparer/core';

/**
 * The unit to show after a value. Percentages carry their own unit, and OrcaSlicer's
 * "mm/s² or %" style units only need the first part for a plain number.
 */
export function unitFor(value: NormalizedValue, unit: string | undefined): string | undefined {
  if (!unit || value.some((item) => item.endsWith('%'))) return undefined;
  return unit.replace(/\s+or\s+%$/, '');
}

/**
 * A value's elements as OrcaSlicer shows them: an option's labels for its values ("Disabled",
 * not "disabled_fuzzy") where it has them, else as stored.
 */
export function labeledValue(
  value: NormalizedValue,
  valueLabels: ReadonlyMap<string, string> | undefined,
): string {
  return value.map((item) => valueLabels?.get(item) ?? item).join(', ');
}

/** A value as text, with its unit: array elements joined with commas, labeled where possible. */
export function formatValue(
  value: NormalizedValue | undefined,
  unit: string | undefined,
  valueLabels?: ReadonlyMap<string, string>,
): string {
  if (value === undefined) return '—';
  const shownUnit = unitFor(value, unit);
  const text = labeledValue(value, valueLabels);
  return shownUnit ? `${text} ${shownUnit}` : text;
}

/**
 * A name for each setting that tells it apart from the others: its label, plus the key when
 * another setting shares the label (OrcaSlicer reuses short labels, e.g. three "Fan speed"s).
 * For accessible names and messages.
 */
export function settingNames(
  keys: readonly string[],
  labelOf: (key: string) => string,
): ReadonlyMap<string, string> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(labelOf(key), (counts.get(labelOf(key)) ?? 0) + 1);
  return new Map(
    keys.map((key) => {
      const label = labelOf(key);
      return [key, (counts.get(label) ?? 0) > 1 && label !== key ? `${label} (${key})` : label];
    }),
  );
}
