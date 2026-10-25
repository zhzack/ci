import { describe, expect, it } from 'vitest';

import { formatBytes, formatSize } from './format';

describe('formatSize (KiB family: uploads & storage surfaces)', () => {
  it('renders zero and negative as 0 B', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(-5)).toBe('0 B');
  });

  it('keeps whole bytes below 1 KiB', () => {
    expect(formatSize(1)).toBe('1 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1023)).toBe('1023 B');
  });

  it('uses one decimal for KiB', () => {
    expect(formatSize(1024)).toBe('1.0 KiB');
    expect(formatSize(2048)).toBe('2.0 KiB');
    expect(formatSize(1536)).toBe('1.5 KiB');
  });

  it('uses two decimals for MiB and GiB', () => {
    expect(formatSize(1024 * 1024)).toBe('1.00 MiB');
    expect(formatSize(1.5 * 1024 * 1024)).toBe('1.50 MiB');
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe('2.00 GiB');
  });

  it('stays at GiB for very large values (no TB tier)', () => {
    expect(formatSize(5 * 1024 * 1024 * 1024 * 1024)).toBe('5120.00 GiB');
  });
});

describe('formatBytes (KB family: machine console surfaces)', () => {
  it('renders zero and negative as 0 B', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });

  it('renders sub-KiB values as whole bytes', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('trims trailing zeros in KB/MB', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('reaches the GB and TB tiers', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2 GB');
    expect(formatBytes(3 * 1024 * 1024 * 1024 * 1024)).toBe('3 TB');
  });
});
