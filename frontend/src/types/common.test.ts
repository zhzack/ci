import { describe, expect, it } from 'vitest';

import { isStatusValue, STATUS_VALUES } from './common';

describe('isStatusValue guard', () => {
  it('accepts every declared lifecycle status', () => {
    for (const status of STATUS_VALUES) {
      expect(isStatusValue(status)).toBe(true);
    }
  });

  it('rejects unknown spellings, non-strings and emptiness', () => {
    expect(isStatusValue('success')).toBe(false); // case-sensitive
    expect(isStatusValue('SUCCEEDED')).toBe(false);
    expect(isStatusValue('')).toBe(false);
    expect(isStatusValue(42)).toBe(false);
    expect(isStatusValue(null)).toBe(false);
    expect(isStatusValue(undefined)).toBe(false);
    expect(isStatusValue({ status: 'SUCCESS' })).toBe(false);
  });

  it('narrows the type for TS when true (runtime probe)', () => {
    const value: unknown = 'RUNNING';
    if (isStatusValue(value)) {
      // Compile-time proof: value is usable as a StatusValue here.
      const status: typeof STATUS_VALUES[number] = value;
      expect(status).toBe('RUNNING');
    } else {
      throw new Error('guard rejected a known status');
    }
  });
});
