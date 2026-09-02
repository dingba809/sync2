import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskStatusPolling } from './taskStatusPolling.js';

afterEach(() => vi.useRealTimers());

describe('TaskStatusPolling', () => {
  it('refreshes while a task is running and stops after the final status', async () => {
    vi.useFakeTimers();
    const reload = vi.fn().mockResolvedValue(undefined);
    const polling = new TaskStatusPolling(reload, 1000);

    polling.observe([{ lastStatus: 'running' }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(reload).toHaveBeenCalledTimes(3);

    polling.observe([{ lastStatus: 'success' }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(reload).toHaveBeenCalledTimes(3);
    polling.dispose();
  });

  it('reloads immediately when requested after a manual run', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const polling = new TaskStatusPolling(reload, 1000);

    await polling.refreshNow();

    expect(reload).toHaveBeenCalledTimes(1);
    polling.dispose();
  });
});
