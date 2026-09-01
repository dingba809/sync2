import type { TaskRecord } from '../shared/types.js';

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export const api = {
  listTasks: () => fetch('/api/tasks').then(r => j<TaskRecord[]>(r)),
  createTask: (t: any) => fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }).then(r => j<{ id: string }>(r)),
  updateTask: (id: string, t: any) => fetch(`/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }).then(r => j<any>(r)),
  deleteTask: (id: string) => fetch(`/api/tasks/${id}`, { method: 'DELETE' }).then(r => j<any>(r)),
  runTask: (id: string) => fetch(`/api/tasks/${id}/run`, { method: 'POST' }).then(r => j<any>(r)),
  listRuns: (id: string) => fetch(`/api/tasks/${id}/runs`).then(r => j<any[]>(r)),
  listAccounts: () => fetch('/api/accounts').then(r => j<any[]>(r)),
  deleteAccount: (id: string) => fetch(`/api/accounts/${id}`, { method: 'DELETE' }).then(r => j<any>(r)),
  googleAuthUrl: () => fetch('/api/auth/google/url').then(r => j<{ url: string }>(r)),
  quarkStart: () => fetch('/api/auth/quark/start', { method: 'POST' }).then(r => j<{ token: string; url: string }>(r)),
  quarkPoll: (token: string) => fetch(`/api/auth/quark/poll?token=${token}`).then(r => j<any>(r)),
  listLogs: (since: number, taskId?: string) => fetch(`/api/logs?since=${since}${taskId ? `&taskId=${taskId}` : ''}`).then(r => j<any[]>(r))
};
