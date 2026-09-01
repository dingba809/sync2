import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  AccountRecord, TaskRecord, RunRecord, LogRecord, ProviderKind
} from '../shared/types.js';

export function openDb(file: string): Database.Database {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      credential TEXT NOT NULL,
      quota_total INTEGER,
      quota_used INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      account_id TEXT NOT NULL,
      local_path TEXT NOT NULL,
      remote_path TEXT NOT NULL,
      schedule TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_status TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS file_snapshots (
      task_id TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      hash TEXT,
      remote_id TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (task_id, rel_path)
    );
    CREATE TABLE IF NOT EXISTS run_history (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      uploaded_count INTEGER NOT NULL DEFAULT 0,
      deleted_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export function insertAccount(
  db: Database.Database,
  acc: { provider: ProviderKind; displayName: string; credential: string }
): string {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id, provider, display_name, credential, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, acc.provider, acc.displayName, acc.credential, now, now);
  return id;
}

export function updateAccountCredential(
  db: Database.Database, id: string, credential: string, displayName?: string
): void {
  const now = Date.now();
  if (displayName !== undefined) {
    db.prepare(`UPDATE accounts SET credential = ?, display_name = ?, updated_at = ? WHERE id = ?`)
      .run(credential, displayName, now, id);
  } else {
    db.prepare(`UPDATE accounts SET credential = ?, updated_at = ? WHERE id = ?`)
      .run(credential, now, id);
  }
}

export function getAccount(db: Database.Database, id: string):
  { id: string; provider: ProviderKind; displayName: string; credential: string } | undefined {
  return db.prepare(`SELECT id, provider, display_name AS displayName, credential FROM accounts WHERE id = ?`)
    .get(id) as any;
}

export function listAccounts(db: Database.Database): AccountRecord[] {
  return db.prepare(
    `SELECT id, provider, display_name AS displayName, credential,
            quota_total AS quotaTotal, quota_used AS quotaUsed
     FROM accounts ORDER BY created_at`
  ).all() as any;
}

export function deleteAccount(db: Database.Database, id: string): void {
  db.transaction(() => {
    const taskIds = db.prepare(`SELECT id FROM tasks WHERE account_id = ?`).all(id)
      .map((r: any) => r.id) as string[];
    for (const tid of taskIds) {
      db.prepare(`DELETE FROM file_snapshots WHERE task_id = ?`).run(tid);
      db.prepare(`DELETE FROM run_history WHERE task_id = ?`).run(tid);
      db.prepare(`DELETE FROM logs WHERE task_id = ?`).run(tid);
    }
    db.prepare(`DELETE FROM tasks WHERE account_id = ?`).run(id);
    db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
  })();
}

export function insertTask(
  db: Database.Database,
  t: Omit<TaskRecord, 'id' | 'lastStatus'>
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tasks (id, name, account_id, local_path, remote_path, schedule, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, t.name, t.accountId, t.localPath, t.remotePath, t.schedule, t.enabled ? 1 : 0, Date.now());
  return id;
}

export function updateTask(db: Database.Database, id: string, t: Partial<TaskRecord>): void {
  const fields: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string, string> = {
    name: 'name', accountId: 'account_id', localPath: 'local_path',
    remotePath: 'remote_path', schedule: 'schedule', lastStatus: 'last_status'
  };
  for (const [k, v] of Object.entries(t)) {
    if (k === 'enabled') { fields.push('enabled = ?'); vals.push(v ? 1 : 0); }
    else if (map[k] && v !== undefined) { fields.push(`${map[k]} = ?`); vals.push(v); }
  }
  if (fields.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
}

export function getTask(db: Database.Database, id: string): TaskRecord | undefined {
  const row: any = db.prepare(
    `SELECT id, name, account_id AS accountId, local_path AS localPath,
            remote_path AS remotePath, schedule, enabled, last_status AS lastStatus
     FROM tasks WHERE id = ?`
  ).get(id);
  if (!row) return undefined;
  return { ...row, enabled: !!row.enabled };
}

export function listTasks(db: Database.Database): TaskRecord[] {
  return db.prepare(
    `SELECT id, name, account_id AS accountId, local_path AS localPath,
            remote_path AS remotePath, schedule, enabled, last_status AS lastStatus
     FROM tasks ORDER BY created_at`
  ).all().map((r: any) => ({ ...r, enabled: !!r.enabled }));
}

export function deleteTask(db: Database.Database, id: string): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM file_snapshots WHERE task_id = ?`).run(id);
    db.prepare(`DELETE FROM run_history WHERE task_id = ?`).run(id);
  })();
}

export function upsertSnapshot(
  db: Database.Database,
  taskId: string, relPath: string,
  s: { size: number; mtime: number; hash: string | null; remoteId: string }
): void {
  db.prepare(
    `INSERT INTO file_snapshots (task_id, rel_path, size, mtime, hash, remote_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id, rel_path) DO UPDATE SET
       size = excluded.size, mtime = excluded.mtime, hash = excluded.hash,
       remote_id = excluded.remote_id, updated_at = excluded.updated_at`
  ).run(taskId, relPath, s.size, s.mtime, s.hash, s.remoteId, Date.now());
}

export function listSnapshots(db: Database.Database, taskId: string):
  Map<string, { size: number; mtime: number; hash: string | null; remoteId: string }> {
  const rows = db.prepare(
    `SELECT rel_path AS relPath, size, mtime, hash, remote_id AS remoteId
     FROM file_snapshots WHERE task_id = ?`
  ).all(taskId) as any[];
  const map = new Map();
  for (const r of rows) map.set(r.relPath, { size: r.size, mtime: r.mtime, hash: r.hash, remoteId: r.remoteId });
  return map;
}

export function deleteSnapshot(db: Database.Database, taskId: string, relPath: string): void {
  db.prepare(`DELETE FROM file_snapshots WHERE task_id = ? AND rel_path = ?`).run(taskId, relPath);
}

export function clearSnapshots(db: Database.Database, taskId: string): void {
  db.prepare(`DELETE FROM file_snapshots WHERE task_id = ?`).run(taskId);
}

export function insertRun(db: Database.Database, taskId: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO run_history (id, task_id, started_at, status) VALUES (?, ?, ?, 'running')`
  ).run(id, taskId, Date.now());
  return id;
}

export function finishRun(
  db: Database.Database, id: string,
  r: { status: 'success' | 'failed'; uploadedCount: number; deletedCount: number; error: string | null }
): void {
  db.prepare(
    `UPDATE run_history SET finished_at = ?, status = ?, uploaded_count = ?, deleted_count = ?, error = ? WHERE id = ?`
  ).run(Date.now(), r.status, r.uploadedCount, r.deletedCount, r.error, id);
}

export function listRuns(db: Database.Database, taskId: string, limit = 20): RunRecord[] {
  return db.prepare(
    `SELECT id, task_id AS taskId, started_at AS startedAt, finished_at AS finishedAt,
            status, uploaded_count AS uploadedCount, deleted_count AS deletedCount, error
     FROM run_history WHERE task_id = ? ORDER BY started_at DESC LIMIT ?`
  ).all(taskId, limit) as any;
}

export function insertLog(
  db: Database.Database, taskId: string | null, level: 'info' | 'error', message: string
): void {
  db.prepare(`INSERT INTO logs (task_id, level, message, created_at) VALUES (?, ?, ?, ?)`)
    .run(taskId, level, message, Date.now());
}

export function listLogs(db: Database.Database, taskId: string | null, since: number): LogRecord[] {
  if (taskId) {
    return db.prepare(
      `SELECT id, task_id AS taskId, level, message, created_at AS createdAt
       FROM logs WHERE task_id = ? AND id > ? ORDER BY id LIMIT 500`
    ).all(taskId, since) as any;
  }
  return db.prepare(
    `SELECT id, task_id AS taskId, level, message, created_at AS createdAt
     FROM logs WHERE id > ? ORDER BY id LIMIT 500`
  ).all(since) as any;
}

export function latestLogId(db: Database.Database): number {
  const row = db.prepare(`SELECT MAX(id) AS id FROM logs`).get() as any;
  return row.id ?? 0;
}
