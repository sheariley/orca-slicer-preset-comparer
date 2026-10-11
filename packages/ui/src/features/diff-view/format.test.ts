import { describe, expect, it } from 'vitest';
import { formatValue, labeledValue, settingNames, unitFor } from './format.ts';

describe('unitFor', () => {
  it('shows the unit after plain numbers', () => {
    expect(unitFor(['0.2'], 'mm')).toBe('mm');
  });

  it('drops the unit when the value is already a percentage', () => {
    expect(unitFor(['50%'], '%')).toBeUndefined();
    expect(unitFor(['50%'], 'mm/s² or %')).toBeUndefined();
  });

  it('keeps only the first unit of an "or %" unit for plain numbers', () => {
    expect(unitFor(['500'], 'mm/s² or %')).toBe('mm/s²');
  });

  it('shows nothing without a unit', () => {
    expect(unitFor(['1'], undefined)).toBeUndefined();
  });
});

describe('formatValue', () => {
  it('joins elements with commas and adds the unit', () => {
    expect(formatValue(['210', '215'], '℃')).toBe('210, 215 ℃');
    expect(formatValue(['50%'], 'mm/s² or %')).toBe('50%');
  });

  it('shows a dash for a missing value', () => {
    expect(formatValue(undefined, 'mm')).toBe('—');
  });
});

describe('settingNames', () => {
  it('adds the key only to labels that more than one setting shares', () => {
    const labels: Record<string, string> = { a: 'Fan speed', b: 'Fan speed', c: 'Density' };
    const names = settingNames(['a', 'b', 'c', 'd'], (key) => labels[key] ?? key);
    expect([...names.values()]).toEqual(['Fan speed (a)', 'Fan speed (b)', 'Density', 'd']);
  });
});

describe('labeledValue', () => {
  const labels = new Map([
    ['disabled_fuzzy', 'Disabled'],
    ['all', 'Contour and hole'],
  ]);

  it("shows each element by the option's label for it, else as stored", () => {
    expect(labeledValue(['disabled_fuzzy'], labels)).toBe('Disabled');
    expect(labeledValue(['all', 'custom'], labels)).toBe('Contour and hole, custom');
    expect(labeledValue(['all'], undefined)).toBe('all');
  });

  it('labels values in formatValue too', () => {
    expect(formatValue(['disabled_fuzzy'], undefined, labels)).toBe('Disabled');
  });
});
