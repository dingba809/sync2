import { describe, expect, it } from 'vitest';
import { isWithinRunWindow, millisecondsUntilRunWindow } from './run-window.js';

describe('run window', () => {
  it('allows only the configured daytime range', () => {
    expect(isWithinRunWindow(true, '09:00', '18:00', new Date('2026-09-03T02:00:00Z'), 'Asia/Shanghai')).toBe(true);
    expect(isWithinRunWindow(true, '09:00', '18:00', new Date('2026-09-03T10:00:00Z'), 'Asia/Shanghai')).toBe(false);
  });

  it('supports a window that crosses midnight', () => {
    expect(isWithinRunWindow(true, '22:00', '02:00', new Date('2026-09-03T15:00:00Z'), 'Asia/Shanghai')).toBe(true);
    expect(isWithinRunWindow(true, '22:00', '02:00', new Date('2026-09-03T19:00:00Z'), 'Asia/Shanghai')).toBe(false);
  });

  it('calculates the next permitted start time', () => {
    expect(millisecondsUntilRunWindow('09:00', new Date('2026-09-03T00:30:00Z'), 'Asia/Shanghai')).toBe(30 * 60 * 1000);
  });

  it('uses the requested timezone instead of the server timezone', () => {
    expect(isWithinRunWindow(true, '09:00', '10:00', new Date('2026-09-03T09:30:00Z'), 'America/New_York')).toBe(false);
    expect(isWithinRunWindow(true, '09:00', '10:00', new Date('2026-09-03T13:30:00Z'), 'America/New_York')).toBe(true);
  });
});
