import { describe, expect, it } from 'vitest';
import { normalizeValue, resizeValue, valuesEqual } from './normalize-value.ts';

describe('normalizeValue', () => {
  it('wraps a scalar string', () => {
    expect(normalizeValue('0.4')).toEqual(['0.4']);
  });

  it('keeps string arrays', () => {
    expect(normalizeValue(['100', '105'])).toEqual(['100', '105']);
  });

  it('stringifies numbers and booleans defensively', () => {
    expect(normalizeValue(16)).toEqual(['16']);
    expect(normalizeValue([true, 2])).toEqual(['true', '2']);
  });
});

describe('valuesEqual', () => {
  it('treats a scalar and a one-element array as equal', () => {
    expect(valuesEqual(normalizeValue('16'), normalizeValue(['16']))).toBe(true);
  });

  it('distinguishes different lengths', () => {
    expect(valuesEqual(normalizeValue('16'), normalizeValue(['16', '16']))).toBe(false);
  });
});

describe('resizeValue', () => {
  it('truncates, or pads by repeating the first value, like OrcaSlicer', () => {
    expect(resizeValue(['1', '2', '3'], 2)).toEqual(['1', '2']);
    expect(resizeValue(['1', '2'], 4)).toEqual(['1', '2', '1', '1']);
    expect(resizeValue([], 3)).toEqual([]);
  });
});
