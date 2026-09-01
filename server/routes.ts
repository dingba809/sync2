import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import type { Scheduler } from './scheduler.js';
import { encrypt, decrypt } from './crypto.js';
import {
  insertAccount, updateAccountCredential, listAccounts, deleteAccount,
  insertTask, updateTask, listTasks, deleteTask,
  insertRun, finishRun, listRuns, insertLog, listLogs, latestLogId,
  listSnapshots, upsertSnapshot, deleteSnapshot
} from './db.js';
import { runSync } from './engine/executor.js';
import { createProvider } from './provider-factory.js';
import { googleAuthUrl, exchangeCodeForToken } from './auth/google.js';
import { getQrcodeToken, pollQrcode, getCookiesFromServiceTicket } from './auth/quark.js';

export function registerRoutes(app: FastifyInstance, db: Database.Database, cfg: Config, masterKey: Buffer, scheduler: Scheduler): void {
  const encodeCred = (c: unknown) => encrypt(JSON.stringify(c), masterKey);
  const decodeCred = (s: string) => JSON.parse(decrypt(s, masterKey));

  app.get('/api/tasks', async () => listTasks(db));

  app.post('/api/tasks', async (req) => {
    const body = req.body as any;
    const id = insertTask(db, {
      name: body.name, accountId: body.accountId, localPath: body.localPath,
      remotePath: body.remotePath, schedule: body.schedule ?? null, enabled: body.enabled ?? true
    });
    reschedule(id);
    return { id };
  });

  app.put('/api/tasks/:id', async (req) => {
    const { id } = req.params as any;
    const body = req.body as any;
    updateTask(db, id, body);
    reschedule(id);
    return { ok: true };
  });

  app.delete('/api/tasks/:id', async (req) => {
    const { id } = req.params as any;
    scheduler.unregister(id);
    deleteTask(db, id);
    return { ok: true };
  });

  app.post('/api/tasks/:id/run', async (req) => {
    const { id } = req.params as any;
    void runTaskById(id);
    return { ok: true };
  });

  app.get('/api/tasks/:id/runs', async (req) => {
    const { id } = req.params as any;
    return listRuns(db, id);
  });

  app.get('/api/accounts', async () => listAccounts(db).map(a => ({
    id: a.id, provider: a.provider, displayName: a.displayName
  })));

  app.delete('/api/accounts/:id', async (req) => {
    const { id } = req.params as any;
    const tasks = db.prepare(`SELECT id FROM tasks WHERE account_id = ?`).all(id) as any[];
    for (const t of tasks) scheduler.unregister(t.id);
    deleteAccount(db, id);
    return { ok: true };
  });

  app.get('/api/auth/google/url', async () => {
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
    return listLogs(db, taskId, since);
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

  const running = new Set<string>();

  function reschedule(taskId: string): void {
    const t = db.prepare(`SELECT id, schedule, enabled FROM tasks WHERE id = ?`).get(taskId) as any;
    if (!t) return;
    scheduler.register(t.id, t.schedule, !!t.enabled, () => { void runTaskById(t.id); });
  }

  async function runTaskById(taskId: string): Promise<void> {
    if (running.has(taskId)) return;
    running.add(taskId);
    try {
      const t = db.prepare(
        `SELECT id, account_id AS accountId, local_path AS localPath, remote_path AS remotePath FROM tasks WHERE id = ?`
      ).get(taskId) as any;
      if (!t) return;
      const acc = db.prepare(`SELECT provider, credential FROM accounts WHERE id = ?`).get(t.accountId) as any;
      if (!acc) { insertLog(db, taskId, 'error', '账号不存在'); return; }
      const runId = insertRun(db, taskId);
      try {
        const cred = decodeCred(acc.credential);
        const provider = createProvider(acc.provider, cred, cfg);
        const quota = await provider.getQuota().catch(() => null);
        if (quota && quota.total > 0 && quota.used >= quota.total) {
          insertLog(db, taskId, 'error', '网盘容量已满，中止同步');
          finishRun(db, runId, { status: 'failed', uploadedCount: 0, deletedCount: 0, error: 'quota exceeded' });
          updateTask(db, taskId, { lastStatus: 'failed' });
          return;
        }
        const snapshots = {
          list: (tid: string) => listSnapshots(db, tid),
          upsert: (tid: string, rel: string, s: any) => upsertSnapshot(db, tid, rel, s),
          remove: (tid: string, rel: string) => deleteSnapshot(db, tid, rel)
        };
        const result = await runSync({
          taskId, localPath: t.localPath, remotePath: t.remotePath, provider, snapshots,
          onLog: (level, msg) => insertLog(db, taskId, level, msg)
        });
        finishRun(db, runId, { status: result.error ? 'failed' : 'success', uploadedCount: result.uploadedCount, deletedCount: result.deletedCount, error: result.error });
        updateTask(db, taskId, { lastStatus: result.error ? 'failed' : 'success' });
      } catch (e) {
        const msg = (e as Error).message;
        insertLog(db, taskId, 'error', `同步异常: ${msg}`);
        finishRun(db, runId, { status: 'failed', uploadedCount: 0, deletedCount: 0, error: msg });
        updateTask(db, taskId, { lastStatus: 'failed' });
      }
    } finally {
      running.delete(taskId);
    }
  }

  for (const t of listTasks(db)) {
    reschedule(t.id);
  }
}
