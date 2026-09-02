import type { TaskWithTargets, TaskProgress } from '../shared/types.js';

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let msg = text || `HTTP ${res.status}`;
    try {
      const data = JSON.parse(text);
      if (data?.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface TaskInput {
  name: string;
  localPath: string;
  schedule: string | null;
  enabled: boolean;
  targets: { accountId: string; remotePath: string }[];
}

export const api = {
  listTasks: () => fetch('/api/tasks').then(r => j<TaskWithTargets[]>(r)),
  getTask: (id: string) => fetch(`/api/tasks/${id}`).then(r => j<TaskWithTargets>(r)),
  createTask: (t: TaskInput) => fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }).then(r => j<{ id: string }>(r)),
  updateTask: (id: string, t: TaskInput) => fetch(`/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }).then(r => j<any>(r)),
  toggleTask: (id: string, enabled: boolean) => fetch(`/api/tasks/${id}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }).then(r => j<any>(r)),
  deleteTask: (id: string) => fetch(`/api/tasks/${id}`, { method: 'DELETE' }).then(r => j<any>(r)),
  runTask: (id: string) => fetch(`/api/tasks/${id}/run`, { method: 'POST' }).then(r => j<any>(r)),
  listRuns: (id: string) => fetch(`/api/tasks/${id}/runs`).then(r => j<any[]>(r)),
  listAccounts: () => fetch('/api/accounts').then(r => j<any[]>(r)),
  deleteAccount: (id: string) => fetch(`/api/accounts/${id}`, { method: 'DELETE' }).then(r => j<any>(r)),
  googleAuthUrl: () => fetch('/api/auth/google/url').then(r => j<{ url: string }>(r)),
  quarkStart: () => fetch('/api/auth/quark/start').then(r => j<{ token: string; url: string }>(r)),
  quarkPoll: (token: string) => fetch(`/api/auth/quark/poll?token=${token}`).then(r => j<any>(r)),
  listLogs: (since: number, taskId?: string) => fetch(`/api/logs?since=${since}${taskId ? `&taskId=${taskId}` : ''}`).then(r => j<any[]>(r)),
  getProgress: (id: string) => fetch(`/api/tasks/${id}/progress`).then(r => j<TaskProgress | null>(r)),
  progressStreamUrl: (id: string) => `/api/tasks/${id}/progress/stream`
};
