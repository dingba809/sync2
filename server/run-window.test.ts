import { describe, expect, it } from 'vitest';
import { isWithinRunWindow, millisecondsUntilRunWindow } from './run-window.js';

describe('run window', () => {
  it('allows only the configured daytime range', () => {
    expect(isWithinRunWindow(true, '09:00', '18:00', new Date('2026-09-03T10:00:00'))).toBe(true);
    expect(isWithinRunWindow(true, '09:00', '18:00', new Date('2026-09-03T18:00:00'))).toBe(false);
  });

  it('supports a window that crosses midnight', () => {
    expect(isWithinRunWindow(true, '22:00', '02:00', new Date('2026-09-03T23:00:00'))).toBe(true);
    expect(isWithinRunWindow(true, '22:00', '02:00', new Date('2026-09-03T03:00:00'))).toBe(false);
  });

  it('calculates the next permitted start time', () => {
    expect(millisecondsUntilRunWindow('09:00', new Date('2026-09-03T08:30:00'))).toBe(30 * 60 * 1000);
  });
});
