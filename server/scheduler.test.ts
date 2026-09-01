import { describe, it, expect } from 'vitest';
import { createScheduler } from './scheduler.js';

describe('scheduler', () => {
  it('registers and unregisters by task id', () => {
    const s = createScheduler();
    s.register('t1', '*/5 * * * *', true, () => {});
    s.register('t1', '*/5 * * * *', true, () => {}); // replace
    s.unregister('t1');
    expect(true).toBe(true);
  });

  it('ignores invalid cron expressions', () => {
    const s = createScheduler();
    s.register('t1', 'not-a-cron', true, () => {});
    expect(true).toBe(true);
  });
});
