# Task Status Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the task-list status tag from “未运行” to “同步中”, then to its final result, whenever a manual sync runs.

**Architecture:** Keep the server's existing `lastStatus` persistence unchanged. Add a small client-side polling helper that calls an injected reload function at a fixed interval only while the most recently loaded task set contains a running task. `TasksPage` invokes it after manual runs and after every normal reload.

**Tech Stack:** React 18, TypeScript, Vitest, Ant Design.

---

## File structure

- Create `src/taskStatusPolling.ts`: owns the interval lifecycle and exposes an explicit `observe(tasks)` method.
- Create `src/taskStatusPolling.test.ts`: verifies polling starts, refreshes, and stops using Vitest fake timers.
- Modify `src/pages/TasksPage.tsx`: creates the helper once, supplies refreshed tasks to it, starts a refresh after the manual-run API resolves, and disposes it on unmount.

### Task 1: Define the polling behavior with a failing test

**Files:**
- Create: `src/taskStatusPolling.test.ts`
- Create: `src/taskStatusPolling.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `rtk npm test -- src/taskStatusPolling.test.ts`

Expected: FAIL because `src/taskStatusPolling.ts` does not exist.

- [ ] **Step 3: Add the minimal polling helper**

```ts
export class TaskStatusPolling {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly reload: () => Promise<void>,
    private readonly intervalMs = 1000
  ) {}

  observe(tasks: Array<{ lastStatus: string | null }>): void {
    const hasRunningTask = tasks.some(task => task.lastStatus === 'running');
    if (hasRunningTask && !this.timer) {
      this.timer = setInterval(() => { void this.reload(); }, this.intervalMs);
    }
    if (!hasRunningTask && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `rtk npm test -- src/taskStatusPolling.test.ts`

Expected: PASS, one test.

- [ ] **Step 5: Commit the helper and test**

```bash
rtk git add src/taskStatusPolling.ts src/taskStatusPolling.test.ts
rtk git commit -m "test: cover task status polling"
```

### Task 2: Add the manual-run refresh operation

**Files:**
- Modify: `src/taskStatusPolling.ts:1-28`
- Test: `src/taskStatusPolling.test.ts`

- [ ] **Step 1: Write the failing test for an immediate refresh**

Extend `src/taskStatusPolling.test.ts` with this test, which exercises the helper API used by the page after a manual run:

```ts
it('reloads immediately when requested after a manual run', async () => {
  const reload = vi.fn().mockResolvedValue(undefined);
  const polling = new TaskStatusPolling(reload, 1000);

  await polling.refreshNow();

  expect(reload).toHaveBeenCalledTimes(1);
  polling.dispose();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `rtk npm test -- src/taskStatusPolling.test.ts`

Expected: FAIL because `refreshNow` does not exist.

- [ ] **Step 3: Add the minimal operation**

Add this method to `TaskStatusPolling`:

```ts
async refreshNow(): Promise<void> {
  await this.reload();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `rtk npm test -- src/taskStatusPolling.test.ts`

Expected: PASS, two tests.

- [ ] **Step 5: Commit the immediate-refresh operation**

```bash
rtk git add src/taskStatusPolling.ts src/taskStatusPolling.test.ts
rtk git commit -m "feat: add immediate task status refresh"
```

### Task 3: Connect task-list reloads to the polling helper

**Files:**
- Modify: `src/pages/TasksPage.tsx:1-32`

- [ ] **Step 1: Wire the page to the helper**

Update the imports and lifecycle in `src/pages/TasksPage.tsx` as follows:

```ts
import { useEffect, useRef, useState } from 'react';
import { TaskStatusPolling } from '../taskStatusPolling.js';

const poller = useRef<TaskStatusPolling | null>(null);
const load = async () => {
  const nextTasks = await api.listTasks();
  setTasks(nextTasks);
  poller.current?.observe(nextTasks);
  setAccounts(await api.listAccounts());
};

useEffect(() => {
  poller.current = new TaskStatusPolling(load);
  void load();
  return () => poller.current?.dispose();
}, []);

const run = async (id: string) => {
  await api.runTask(id);
  await poller.current?.refreshNow();
  message.success('已触发同步');
};
```

Remove the prior `useEffect(() => { load(); }, [])` so the helper is initialized before the initial reload. Keep the existing status-tag rendering unchanged.

- [ ] **Step 2: Run focused tests and static verification**

Run: `rtk npm test -- src/taskStatusPolling.test.ts; rtk npm run typecheck; rtk npm run build`

Expected: all commands exit successfully.

- [ ] **Step 3: Commit the page connection**

```bash
rtk git add src/pages/TasksPage.tsx src/taskStatusPolling.test.ts
rtk git commit -m "fix: refresh task status after manual sync"
```

### Task 4: Browser verification

**Files:**
- Modify: none

- [ ] **Step 1: Run the application**

Run: `rtk npm run dev`

Expected: Vite serves the client and the Fastify server starts on port 3000.

- [ ] **Step 2: Verify the user flow**

1. Open the task list.
2. Click “立即同步” for a valid task.
3. Confirm the status tag changes from its previous state to “同步中”.
4. Wait for completion and confirm it becomes “成功” or “失败”, not “未运行”.

- [ ] **Step 3: Confirm repository state**

Run: `rtk git status --short`

Expected: no uncommitted implementation files remain.
