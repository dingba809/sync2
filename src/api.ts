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
  runWindowEnabled: boolean;
  runWindowStart: string | null;
  runWindowEnd: string | null;
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
  pauseTask: (id: string) => fetch(`/api/tasks/${id}/pause`, { method: 'POST' }).then(r => j<any>(r)),
  resumeTask: (id: string) => fetch(`/api/tasks/${id}/resume`, { method: 'POST' }).then(r => j<any>(r)),
  stopTask: (id: string) => fetch(`/api/tasks/${id}/stop`, { method: 'POST' }).then(r => j<any>(r)),
  listRuns: (id: string) => fetch(`/api/tasks/${id}/runs`).then(r => j<any[]>(r)),
  retryFailedRun: (taskId: string, runId: string) => fetch(`/api/tasks/${taskId}/runs/${runId}/retry-failed`, { method: 'POST' }).then(r => j<{ ok: true; uploadCount: number; deleteCount: number }>(r)),
  listDirectories: (path?: string) => fetch(`/api/filesystem/directories${path ? `?path=${encodeURIComponent(path)}` : ''}`).then(r => j<{ path: string | null; parent: string | null; roots?: string[]; directories: { name: string; path: string }[] }>(r)),
  listAccounts: () => fetch('/api/accounts').then(r => j<any[]>(r)),
  deleteAccount: (id: string) => fetch(`/api/accounts/${id}`, { method: 'DELETE' }).then(r => j<any>(r)),
  getNotificationSettings: () => fetch('/api/settings/notifications').then(r => j<any>(r)),
  saveNotificationSettings: (settings: any) => fetch('/api/settings/notifications', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }).then(r => j<any>(r)),
  getSyncSettings: () => fetch('/api/settings/sync').then(r => j<{ quarkUploadConcurrency: number }>(r)),
  saveSyncSettings: (settings: { quarkUploadConcurrency: number }) => fetch('/api/settings/sync', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }).then(r => j<any>(r)),
  googleAuthUrl: () => fetch('/api/auth/google/url').then(r => j<{ url: string }>(r)),
  quarkStart: () => fetch('/api/auth/quark/start').then(r => j<{ token: string; url: string }>(r)),
  quarkPoll: (token: string) => fetch(`/api/auth/quark/poll?token=${token}`).then(r => j<any>(r)),
  listLogs: (since: number, taskId?: string, from?: number, to?: number) => fetch(`/api/logs?since=${since}${taskId ? `&taskId=${taskId}` : ''}${from !== undefined ? `&from=${from}` : ''}${to !== undefined ? `&to=${to}` : ''}`).then(r => j<any[]>(r)),
  listAudit: (taskId: string, runId: string, afterId = 0) => fetch(`/api/tasks/${taskId}/audit?runId=${encodeURIComponent(runId)}&afterId=${afterId}`).then(r => j<any[]>(r)),
  getProgress: (id: string) => fetch(`/api/tasks/${id}/progress`).then(r => j<TaskProgress | null>(r)),
  progressStreamUrl: (id: string) => `/api/tasks/${id}/progress/stream`
};
