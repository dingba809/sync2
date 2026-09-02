import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import type { Scheduler } from './scheduler.js';
import type { TaskProgress, TargetProgress } from '../shared/types.js';
import { encrypt, decrypt } from './crypto.js';
import {
  insertAccount, updateAccountCredential, listAccounts, deleteAccount,
  insertTask, updateTask, listTasks, deleteTask, getAccount, getTask,
  insertTarget, listTargets, deleteTarget,
  insertRun, finishRun, listRuns, insertLog, listLogs, latestLogId, getSetting, setSetting,
  listSnapshots, upsertSnapshot, deleteSnapshot
} from './db.js';
import { runSync } from './engine/executor.js';
import { createProvider } from './provider-factory.js';
import { googleAuthUrl, exchangeCodeForToken } from './auth/google.js';
import { getQrcodeToken, pollQrcode, getCookiesFromServiceTicket } from './auth/quark.js';
import { sendSyncNotification, type NotificationConfig } from './notifications.js';
import { listDirectories } from './filesystem.js';

export function registerRoutes(app: FastifyInstance, db: Database.Database, cfg: Config, masterKey: Buffer, scheduler: Scheduler): void {
  const encodeCred = (c: unknown) => encrypt(JSON.stringify(c), masterKey);
  const decodeCred = (s: string) => JSON.parse(decrypt(s, masterKey));
  const notificationConfig = (): NotificationConfig => {
    const value = getSetting(db, 'notifications');
    return value ? JSON.parse(decrypt(value, masterKey)) : { telegramEnabled: false, barkEnabled: false };
  };

  const progressStore = new Map<string, TaskProgress>();
  const progressListeners = new Map<string, Set<(p: TaskProgress) => void>>();

  function publishProgress(taskId: string, p: TaskProgress): void {
    progressStore.set(taskId, p);
    const set = progressListeners.get(taskId);
    if (set) for (const fn of set) fn(p);
  }

  app.get('/api/tasks', async () => {
    return listTasks(db).map(t => ({ ...t, targets: listTargets(db, t.id) }));
  });

  app.get('/api/tasks/:id', async (req) => {
    const { id } = req.params as any;
    const t = getTask(db, id);
    if (!t) return { error: 'not found' };
    return { ...t, targets: listTargets(db, id) };
  });

  app.post('/api/tasks', async (req) => {
    const body = req.body as any;
    const id = insertTask(db, {
      name: body.name, localPath: body.localPath,
      schedule: body.schedule ?? null, enabled: body.enabled ?? true
    });
    for (const tg of body.targets ?? []) {
      insertTarget(db, { taskId: id, accountId: tg.accountId, remotePath: tg.remotePath });
    }
    reschedule(id);
    return { id };
  });

  app.put('/api/tasks/:id', async (req) => {
    const { id } = req.params as any;
    const body = req.body as any;
    updateTask(db, id, {
      name: body.name, localPath: body.localPath,
      schedule: body.schedule ?? null, enabled: body.enabled ?? true
    });
    if (Array.isArray(body.targets)) {
      const oldTargets = listTargets(db, id);
      const newKeys = new Set(body.targets.map((t: any) => `${t.accountId}|${t.remotePath}`));
      const oldKeys = new Set(oldTargets.map(t => `${t.accountId}|${t.remotePath}`));
      for (const ot of oldTargets) {
        if (!newKeys.has(`${ot.accountId}|${ot.remotePath}`)) {
          deleteTarget(db, ot.id);
        }
      }
      for (const tg of body.targets) {
        if (!oldKeys.has(`${tg.accountId}|${tg.remotePath}`)) {
          insertTarget(db, { taskId: id, accountId: tg.accountId, remotePath: tg.remotePath });
        }
      }
    }
    reschedule(id);
    progressStore.delete(id);
    return { ok: true };
  });

  app.post('/api/tasks/:id/toggle', async (req) => {
    const { id } = req.params as any;
    const body = req.body as any;
    updateTask(db, id, { enabled: !!body.enabled });
    reschedule(id);
    return { ok: true };
  });

  app.delete('/api/tasks/:id', async (req) => {
    const { id } = req.params as any;
    scheduler.unregister(id);
    deleteTask(db, id);
    progressStore.delete(id);
    return { ok: true };
  });

  app.post('/api/tasks/:id/run', async (req) => {
    const { id } = req.params as any;
    void runTaskById(id);
    return { ok: true };
  });

  app.post('/api/tasks/:id/pause', async (req) => {
    const control = controls.get((req.params as any).id);
    if (control) { control.paused = true; updateTask(db, (req.params as any).id, { lastStatus: 'paused' }); }
    return { ok: !!control };
  });
  app.post('/api/tasks/:id/resume', async (req) => {
    const control = controls.get((req.params as any).id);
    if (control) { control.paused = false; control.resolve(); updateTask(db, (req.params as any).id, { lastStatus: 'running' }); }
    return { ok: !!control };
  });
  app.post('/api/tasks/:id/stop', async (req) => {
    const control = controls.get((req.params as any).id);
    if (control) { control.stopped = true; control.resolve(); }
    return { ok: !!control };
  });

  app.get('/api/tasks/:id/runs', async (req) => {
    const { id } = req.params as any;
    return listRuns(db, id);
  });

  app.get('/api/filesystem/directories', async (req, reply) => {
    try {
      const path = (req.query as any).path as string | undefined;
      return listDirectories(path);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/api/accounts', async () => listAccounts(db).map(a => ({
    id: a.id, provider: a.provider, displayName: a.displayName
  })));

  app.get('/api/settings/notifications', async () => {
    const c = notificationConfig();
    return { telegramEnabled: c.telegramEnabled, telegramConfigured: !!(c.telegramBotToken && c.telegramChatId), barkEnabled: c.barkEnabled, barkConfigured: !!(c.barkServerUrl && c.barkDeviceKey), barkServerUrl: c.barkServerUrl ?? '' };
  });

  app.put('/api/settings/notifications', async (req) => {
    const body = req.body as any;
    const previous = notificationConfig();
    const next: NotificationConfig = {
      telegramEnabled: !!body.telegramEnabled,
      telegramBotToken: body.telegramBotToken || previous.telegramBotToken,
      telegramChatId: body.telegramChatId || previous.telegramChatId,
      barkEnabled: !!body.barkEnabled,
      barkServerUrl: body.barkServerUrl || previous.barkServerUrl,
      barkDeviceKey: body.barkDeviceKey || previous.barkDeviceKey
    };
    setSetting(db, 'notifications', encrypt(JSON.stringify(next), masterKey));
    return { ok: true };
  });

  app.delete('/api/accounts/:id', async (req) => {
    const { id } = req.params as any;
    const tasks = db.prepare(`SELECT task_id AS id FROM task_targets WHERE account_id = ?`).all(id) as any[];
    for (const t of tasks) scheduler.unregister(t.id);
    deleteAccount(db, id);
    return { ok: true };
  });

  app.get('/api/auth/google/url', async (req, reply) => {
    if (!cfg.googleClientId || !cfg.googleClientSecret) {
      return reply.code(400).send({ error: 'Google OAuth 未配置，请设置 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 环境变量后重启' });
    }
    const state = 'sync2';
    return { url: googleAuthUrl(cfg, state) };
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const { code } = req.query as any;
    try {
      const token = await exchangeCodeForToken(cfg, code);
      if (!token.refresh_token) {
        await reply.redirect('/?error=no_refresh_token');
        return;
      }
      const credential = encodeCred({ kind: 'google', refreshToken: token.refresh_token, accessToken: token.access_token });
      insertAccount(db, { provider: 'google', displayName: 'Google', credential });
      await reply.redirect('/?accountAdded=google');
      return;
    } catch {
      await reply.redirect('/?error=google_auth_failed');
      return;
    }
  });

  app.get('/api/auth/quark/start', async () => {
    const r = await getQrcodeToken();
    return { token: r.token, url: r.url };
  });

  app.get('/api/auth/quark/poll', async (req) => {
    const { token } = req.query as any;
    const status = await pollQrcode(token);
    if (status.state === 'success' && status.serviceTicket) {
      const { cookies, nickname } = await getCookiesFromServiceTicket(status.serviceTicket);
      const credential = encodeCred({ kind: 'quark', cookies });
      const id = insertAccount(db, { provider: 'quark', displayName: nickname || '夸克', credential });
      return { state: 'success', accountId: id };
    }
    return { state: status.state };
  });

  app.get('/api/logs', async (req) => {
    const since = Number((req.query as any).since ?? 0);
    const taskId = (req.query as any).taskId ?? null;
    const from = Number((req.query as any).from);
    const to = Number((req.query as any).to);
    return listLogs(db, taskId, since, Number.isFinite(from) ? from : undefined, Number.isFinite(to) ? to : undefined);
  });

  app.get('/api/logs/stream', (req, reply) => {
    const taskId = (req.query as any).taskId ?? null;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    reply.raw.flushHeaders();
    let lastId = latestLogId(db);
    const timer = setInterval(() => {
      const rows = listLogs(db, taskId, lastId);
      for (const r of rows) {
        lastId = r.id;
        reply.raw.write(`data: ${JSON.stringify(r)}\n\n`);
      }
    }, 1000);
    req.raw.on('close', () => clearInterval(timer));
  });

  app.get('/api/tasks/:id/progress', async (req) => {
    return progressStore.get((req.params as any).id) ?? null;
  });

  app.get('/api/tasks/:id/progress/stream', (req, reply) => {
    const { id } = req.params as any;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    reply.raw.flushHeaders();
    const send = (p: TaskProgress) => reply.raw.write(`data: ${JSON.stringify(p)}\n\n`);
    const cur = progressStore.get(id);
    if (cur) send(cur);
    if (!progressListeners.has(id)) progressListeners.set(id, new Set());
    progressListeners.get(id)!.add(send);
    req.raw.on('close', () => { progressListeners.get(id)?.delete(send); });
  });

  const running = new Set<string>();
  const controls = new Map<string, { paused: boolean; stopped: boolean; resolve: () => void; wait: () => Promise<boolean> }>();

  function reschedule(taskId: string): void {
    const t = db.prepare(`SELECT id, schedule, enabled FROM tasks WHERE id = ?`).get(taskId) as any;
    if (!t) return;
    scheduler.register(t.id, t.schedule, !!t.enabled, () => { void runTaskById(t.id); });
  }

  async function runTaskById(taskId: string): Promise<void> {
    if (running.has(taskId)) return;
    running.add(taskId);
    let release = () => {};
    const control = { paused: false, stopped: false, resolve: () => release(), wait: async () => {
      while (control.paused && !control.stopped) await new Promise<void>(resolve => { release = resolve; });
      return !control.stopped;
    }};
    controls.set(taskId, control);
    try {
      const t = db.prepare(`SELECT id, name, local_path AS localPath FROM tasks WHERE id = ?`).get(taskId) as any;
      if (!t) return;
      const targets = listTargets(db, taskId);
      if (targets.length === 0) {
        insertLog(db, taskId, 'error', '任务没有备份目标');
        updateTask(db, taskId, { lastStatus: 'failed' });
        return;
      }

      updateTask(db, taskId, { lastStatus: 'running' });

      const progress: TaskProgress = {
        taskId,
        status: 'running',
        targets: targets.map(tg => {
          const acc = getAccount(db, tg.accountId);
          return {
            targetId: tg.id,
            accountName: acc?.displayName ?? '未知',
            remotePath: tg.remotePath,
            status: 'pending',
            currentFile: null,
            uploadedCount: 0,
            totalUpload: 0,
            deletedCount: 0,
            totalDelete: 0
          } as TargetProgress;
        })
      };
      publishProgress(taskId, progress);

      let anyFailed = false;
      for (const tg of targets) {
        if (!await control.wait()) { updateTask(db, taskId, { lastStatus: 'stopped' }); return; }
        const tp = progress.targets.find(x => x.targetId === tg.id)!;
        tp.status = 'running';
        publishProgress(taskId, progress);

        const acc = getAccount(db, tg.accountId);
        if (!acc) {
          tp.status = 'failed';
          anyFailed = true;
          insertLog(db, taskId, 'error', `目标 ${tg.remotePath}: 账号不存在`);
          publishProgress(taskId, progress);
          continue;
        }

        let runId: string | null = null;
        try {
          runId = insertRun(db, taskId, tg.id);
          const cred = decodeCred(acc.credential);
          const provider = createProvider(acc.provider, cred, cfg);
          const quota = await provider.getQuota().catch(() => null);
          if (quota && quota.total > 0 && quota.used >= quota.total) {
            tp.status = 'failed';
            anyFailed = true;
            insertLog(db, taskId, 'error', `目标 ${tg.remotePath}: 容量已满`);
            finishRun(db, runId, { status: 'failed', uploadedCount: 0, deletedCount: 0, error: 'quota exceeded' });
            publishProgress(taskId, progress);
            continue;
          }
          const snapshots = {
            list: (tid: string) => listSnapshots(db, tid),
            upsert: (tid: string, rel: string, s: any) => upsertSnapshot(db, tid, rel, s),
            remove: (tid: string, rel: string) => deleteSnapshot(db, tid, rel)
          };
          const result = await runSync({
            targetId: tg.id,
            localPath: t.localPath,
            remotePath: tg.remotePath,
            provider,
            snapshots,
            onLog: (level, msg) => insertLog(db, taskId, level, msg),
            onProgress: (p) => {
              tp.currentFile = p.currentFile;
              tp.uploadedCount = p.uploadedCount;
              tp.totalUpload = p.totalUpload;
              tp.deletedCount = p.deletedCount;
              tp.totalDelete = p.totalDelete;
              publishProgress(taskId, progress);
            },
            waitForResume: control.wait
          });
          if (result.stopped) {
            tp.status = 'failed';
            finishRun(db, runId, { status: 'failed', uploadedCount: result.uploadedCount, deletedCount: result.deletedCount, error: 'stopped by user' });
            publishProgress(taskId, progress);
            updateTask(db, taskId, { lastStatus: 'stopped' });
            return;
          }
          tp.status = result.error ? 'failed' : 'success';
          if (result.error) anyFailed = true;
          finishRun(db, runId, { status: result.error ? 'failed' : 'success', uploadedCount: result.uploadedCount, deletedCount: result.deletedCount, error: result.error });
          publishProgress(taskId, progress);
        } catch (e) {
          const msg = (e as Error).message;
          tp.status = 'failed';
          anyFailed = true;
          insertLog(db, taskId, 'error', `目标 ${tg.remotePath} 同步异常: ${msg}`);
          if (runId) finishRun(db, runId, { status: 'failed', uploadedCount: 0, deletedCount: 0, error: msg });
          publishProgress(taskId, progress);
        }
      }

      progress.status = anyFailed ? 'failed' : 'success';
      publishProgress(taskId, progress);
      updateTask(db, taskId, { lastStatus: anyFailed ? 'failed' : 'success' });
      await sendSyncNotification(notificationConfig(), {
        taskName: t.name, status: anyFailed ? 'failed' : 'success',
        uploadedCount: progress.targets.reduce((n, target) => n + target.uploadedCount, 0),
        deletedCount: progress.targets.reduce((n, target) => n + target.deletedCount, 0)
      }).catch(e => insertLog(db, taskId, 'error', `通知发送失败: ${(e as Error).message}`));
    } catch (e) {
      const msg = (e as Error).message;
      insertLog(db, taskId, 'error', `同步异常: ${msg}`);
      updateTask(db, taskId, { lastStatus: 'failed' });
    } finally {
      running.delete(taskId);
      controls.delete(taskId);
    }
  }

  for (const t of listTasks(db)) {
    reschedule(t.id);
  }
}
