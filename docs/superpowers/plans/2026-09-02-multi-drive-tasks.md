# 多网盘任务与配置化改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 sync2 增加网盘配置文件、任务多备份目标、任务编辑与实时同步进度。

**Architecture:** 网盘 OAuth 配置迁移到 `drives.config.json`（环境变量回退）；数据模型新增 `task_targets` 表（任务一对多目标），快照与运行记录改按 `target_id`；同步时遍历目标逐个执行，进度经 SSE 推送，前端新增任务详情 Drawer 与编辑表单。

**Tech Stack:** TypeScript、Fastify、better-sqlite3、React、Ant Design。

---

## 文件结构总览

```
sync2/
├── server/drives.config.example.json   # 新增：配置模板
├── drives.config.json                  # 新增：实际配置（gitignore）
├── server/config.ts                    # 改：读配置文件
├── shared/types.ts                     # 改：TaskTarget / TaskRecord 去单账号 / 进度类型
├── server/db.ts                        # 改：迁移 + targets + 快照/run 按 target
├── server/engine/executor.ts           # 改：runSync 参数改 targetId + onProgress
├── server/routes.ts                    # 改：多目标同步 + 进度端点
├── src/api.ts                          # 改：targets 相关接口
├── src/pages/TasksPage.tsx             # 改：running 状态 + 详情按钮
├── src/components/TaskFormModal.tsx    # 改：编辑 + 多目标
├── src/components/TaskDetailDrawer.tsx # 新增：进度展示
└── .gitignore                          # 改：忽略 drives.config.json
```

---

## Task 1: 网盘配置文件

**Files:**
- Create: `server/drives.config.example.json`
- Modify: `server/config.ts`
- Modify: `.gitignore`
- Test: `server/config.test.ts`

- [ ] **Step 1: 写失败测试**

在 `server/config.test.ts` 末尾追加测试（用临时目录写配置文件）：

```ts
  it('reads google config from drives.config.json', () => {
    const d = tmp();
    writeFileSync(join(d, 'drives.config.json'), JSON.stringify({
      google: { clientId: 'cfg-id', clientSecret: 'cfg-secret', redirectUri: 'http://cb' }
    }));
    const cfg = loadConfig({ DATA_DIR: d } as any);
    expect(cfg.googleClientId).toBe('cfg-id');
    expect(cfg.googleClientSecret).toBe('cfg-secret');
    expect(cfg.googleRedirectUri).toBe('http://cb');
  });

  it('falls back to env when config file missing', () => {
    const cfg = loadConfig({ DATA_DIR: tmp(), GOOGLE_CLIENT_ID: 'env-id' } as any);
    expect(cfg.googleClientId).toBe('env-id');
  });
```

文件顶部 import 需要补 `writeFileSync`：

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/config.test.ts`
Expected: 新增 2 个测试 FAIL（`cfg-id` / `env-id` 断言失败，当前 loadConfig 不读配置文件）。

- [ ] **Step 3: 实现配置文件读取**

把 `server/config.ts` 改为（新增 `readDrivesConfig`，`loadConfig` 读取配置文件优先）：

```ts
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

export interface Config {
  dataDir: string;
  port: number;
  host: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
}

interface DriveConfigFile {
  google?: { clientId?: string; clientSecret?: string; redirectUri?: string };
  [key: string]: unknown;
}

function readDrivesConfig(dataDir: string): DriveConfigFile {
  const candidates = [join(process.cwd(), 'drives.config.json'), join(dataDir, 'drives.config.json')];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        // 忽略解析错误，回退环境变量
      }
    }
  }
  return {};
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.DATA_DIR || join(process.cwd(), 'data'));
  mkdirSync(dataDir, { recursive: true });
  const drives = readDrivesConfig(dataDir);
  const google = drives.google ?? {};
  return {
    dataDir,
    port: Number(env.PORT || 3000),
    host: env.HOST || '127.0.0.1',
    googleClientId: google.clientId || env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: google.clientSecret || env.GOOGLE_CLIENT_SECRET || '',
    googleRedirectUri: google.redirectUri || env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
  };
}

export function getMasterKey(dataDir: string): Buffer {
  const keyFile = join(dataDir, '.master.key');
  if (existsSync(keyFile)) return Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex');
  const key = randomBytes(32).toString('hex');
  writeFileSync(keyFile, key, { mode: 0o600 });
  return Buffer.from(key, 'hex');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/config.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 写模板文件与 gitignore**

创建 `server/drives.config.example.json`：

```json
{
  "google": {
    "clientId": "",
    "clientSecret": "",
    "redirectUri": "http://localhost:3000/api/auth/google/callback"
  },
  "quark": {}
}
```

在 `.gitignore` 末尾加一行：

```
drives.config.json
```

- [ ] **Step 6: Commit**

```bash
git add server/config.ts server/config.test.ts server/drives.config.example.json .gitignore
git commit -m "feat: read drive config from drives.config.json"
```

---

## Task 2: 共享类型改动

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: 改 shared/types.ts**

把 `TaskRecord` 和 `RunRecord` 改为多目标结构，并新增进度类型。将文件里 `TaskRecord` 和 `RunRecord` 两段替换为：

```ts
export interface TaskRecord {
  id: string;
  name: string;
  localPath: string;
  schedule: string | null;
  enabled: boolean;
  lastStatus: string | null;
}

export interface TaskTarget {
  id: string;
  accountId: string;
  remotePath: string;
}

export interface TaskWithTargets extends TaskRecord {
  targets: TaskTarget[];
}

export interface RunRecord {
  id: string;
  taskId: string;
  targetId: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'success' | 'failed';
  uploadedCount: number;
  deletedCount: number;
  error: string | null;
}

export interface TargetProgress {
  targetId: string;
  accountName: string;
  remotePath: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  currentFile: string | null;
  uploadedCount: number;
  totalUpload: number;
  deletedCount: number;
  totalDelete: number;
}

export interface TaskProgress {
  taskId: string;
  status: 'running' | 'success' | 'failed';
  targets: TargetProgress[];
}
```

其余类型（`ProviderKind`、`RemoteEntry`、`Quota`、`DriveProvider`、`AccountCredential`、`AccountRecord`、`LogRecord`）保持不变。

- [ ] **Step 2: 类型检查会暂时失败（预期）**

Run: `npx tsc --noEmit`
Expected: 报多处错误（`db.ts`、`routes.ts`、`src/api.ts`、`src/pages/TasksPage.tsx`、`src/components/TaskFormModal.tsx` 引用了已删除的 `accountId`/`remotePath` 字段）。这是预期，后续 Task 逐一修复。

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "refactor: multi-target task types and progress types"
```

---

## Task 3: 数据模型迁移与数据层

**Files:**
- Modify: `server/db.ts`
- Test: `server/db.test.ts`

- [ ] **Step 1: 写失败测试**

在 `server/db.test.ts` 追加（覆盖 targets、快照按 target、run 带 targetId）。先看现有测试 import 了哪些函数，需补充 `insertTarget`、`listTargets`：

```ts
import { openDb, insertTask, getTask, listTasks, deleteTask, upsertSnapshot, listSnapshots, insertAccount, getAccount, insertTarget, listTargets, insertRun, listRuns } from './db.js';
```

追加测试：

```ts
  it('inserts and lists targets', () => {
    const id = insertTask(db, { name: 't', localPath: '/l', schedule: null, enabled: true });
    const tid = insertTarget(db, { taskId: id, accountId: 'a', remotePath: '/r' });
    const targets = listTargets(db, id);
    expect(targets.length).toBe(1);
    expect(targets[0].id).toBe(tid);
    expect(targets[0].remotePath).toBe('/r');
  });

  it('snapshots keyed by target', () => {
    const id = insertTask(db, { name: 't', localPath: '/l', schedule: null, enabled: true });
    const tid = insertTarget(db, { taskId: id, accountId: 'a', remotePath: '/r' });
    upsertSnapshot(db, tid, 'f.txt', { size: 1, mtime: 2, hash: null, remoteId: 'rid' });
    expect(listSnapshots(db, tid).has('f.txt')).toBe(true);
  });

  it('run history carries target id', () => {
    const id = insertTask(db, { name: 't', localPath: '/l', schedule: null, enabled: true });
    const tid = insertTarget(db, { taskId: id, accountId: 'a', remotePath: '/r' });
    const rid = insertRun(db, id, tid);
    const runs = listRuns(db, id);
    expect(runs.length).toBe(1);
    expect(runs[0].targetId).toBe(tid);
  });
```

现有测试中的 `insertTask` 调用都传了 `accountId`/`remotePath`，需要全部改为新签名（去掉这两个字段）。例如把：

```ts
insertTask(db, { name: 't', accountId: 'a', localPath: '/l', remotePath: '/r', schedule: null, enabled: true })
```

改为：

```ts
insertTask(db, { name: 't', localPath: '/l', schedule: null, enabled: true })
```

（现有测试里所有 `insertTask` 都如此改。）

另外，现有两个涉及快照的测试（`deletes task cascades snapshots`、`upserts snapshot (overwrite on conflict)`）原先用 task id 作为快照 key，现在快照按 target 存，需改为先 `insertTarget` 拿 targetId 再操作快照。把这两个测试改为：

```ts
  it('deletes task cascades snapshots', () => {
    const id = insertTask(db, { name: 't', localPath: '/l', schedule: null, enabled: true });
    const tid = insertTarget(db, { taskId: id, accountId: 'a', remotePath: '/r' });
    upsertSnapshot(db, tid, 'f.txt', { size: 1, mtime: 2, hash: null, remoteId: 'rid' });
    expect(listSnapshots(db, tid).size).toBe(1);
    deleteTask(db, id);
    expect(listSnapshots(db, tid).size).toBe(0);
  });

  it('upserts snapshot (overwrite on conflict)', () => {
    const id = insertTask(db, { name: 't', localPath: '/l', schedule: null, enabled: true });
    const tid = insertTarget(db, { taskId: id, accountId: 'a', remotePath: '/r' });
    upsertSnapshot(db, tid, 'f.txt', { size: 1, mtime: 2, hash: null, remoteId: 'r1' });
    upsertSnapshot(db, tid, 'f.txt', { size: 3, mtime: 4, hash: 'abc', remoteId: 'r2' });
    const m = listSnapshots(db, tid);
    expect(m.get('f.txt')).toEqual({ size: 3, mtime: 4, hash: 'abc', remoteId: 'r2' });
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/db.test.ts`
Expected: FAIL（`insertTarget`/`listTargets` 不存在，`insertTask` 签名不匹配）。

- [ ] **Step 3: 重写 server/db.ts**

把 `server/db.ts` 整体替换为多目标版本（含迁移）：

```ts
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  AccountRecord, TaskRecord, RunRecord, LogRecord, ProviderKind, TaskTarget
} from '../shared/types.js';

export function openDb(file: string): Database.Database {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

function columns(db: Database.Database, name: string): string[] {
  return (db.prepare(`PRAGMA table_info(${name})`).all() as any[]).map(c => c.name);
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
    CREATE TABLE IF NOT EXISTS task_targets (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      remote_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  if (!tableExists(db, 'tasks')) {
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        local_path TEXT NOT NULL,
        schedule TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_status TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  } else if (columns(db, 'tasks').includes('account_id')) {
    migrateOldTasks(db);
  }

  if (tableExists(db, 'file_snapshots') && columns(db, 'file_snapshots').includes('task_id')) {
    db.exec(`DROP TABLE file_snapshots`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_snapshots (
      target_id TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      hash TEXT,
      remote_id TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (target_id, rel_path)
    );
  `);

  if (tableExists(db, 'run_history') && !columns(db, 'run_history').includes('target_id')) {
    db.exec(`DROP TABLE run_history`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_history (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      target_id TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      uploaded_count INTEGER NOT NULL DEFAULT 0,
      deleted_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
  `);
}

function migrateOldTasks(db: Database.Database): void {
  const old = db.prepare(`SELECT id, account_id, remote_path FROM tasks`).all() as any[];
  const ins = db.prepare(
    `INSERT INTO task_targets (id, task_id, account_id, remote_path, created_at) VALUES (?, ?, ?, ?, ?)`
  );
  for (const t of old) {
    ins.run(randomUUID(), t.id, t.account_id, t.remote_path, Date.now());
  }
  db.exec(`
    ALTER TABLE tasks RENAME TO tasks_old;
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      local_path TEXT NOT NULL,
      schedule TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_status TEXT,
      created_at INTEGER NOT NULL
    );
    INSERT INTO tasks (id, name, local_path, schedule, enabled, last_status, created_at)
      SELECT id, name, local_path, schedule, enabled, last_status, created_at FROM tasks_old;
    DROP TABLE tasks_old;
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
    const targetIds = db.prepare(`SELECT id FROM task_targets WHERE account_id = ?`).all(id)
      .map((r: any) => r.id) as string[];
    for (const tid of targetIds) {
      db.prepare(`DELETE FROM file_snapshots WHERE target_id = ?`).run(tid);
      db.prepare(`DELETE FROM run_history WHERE target_id = ?`).run(tid);
    }
    const taskIds = db.prepare(`SELECT task_id AS id FROM task_targets WHERE account_id = ?`).all(id)
      .map((r: any) => r.id) as string[];
    db.prepare(`DELETE FROM task_targets WHERE account_id = ?`).run(id);
    for (const tid of taskIds) {
      db.prepare(`DELETE FROM logs WHERE task_id = ?`).run(tid);
      db.prepare(`DELETE FROM run_history WHERE task_id = ? AND target_id IS NULL`).run(tid);
    }
    db.prepare(`DELETE FROM tasks WHERE id NOT IN (SELECT DISTINCT task_id FROM task_targets)`).run();
    db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
  })();
}

export function insertTask(
  db: Database.Database,
  t: Omit<TaskRecord, 'id' | 'lastStatus'>
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tasks (id, name, local_path, schedule, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, t.name, t.localPath, t.schedule, t.enabled ? 1 : 0, Date.now());
  return id;
}

export function updateTask(db: Database.Database, id: string, t: Partial<TaskRecord>): void {
  const fields: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string, string> = {
    name: 'name', localPath: 'local_path', schedule: 'schedule', lastStatus: 'last_status'
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
    `SELECT id, name, local_path AS localPath, schedule, enabled, last_status AS lastStatus
     FROM tasks WHERE id = ?`
  ).get(id);
  if (!row) return undefined;
  return { ...row, enabled: !!row.enabled };
}

export function listTasks(db: Database.Database): TaskRecord[] {
  return db.prepare(
    `SELECT id, name, local_path AS localPath, schedule, enabled, last_status AS lastStatus
     FROM tasks ORDER BY created_at`
  ).all().map((r: any) => ({ ...r, enabled: !!r.enabled }));
}

export function insertTarget(
  db: Database.Database,
  t: { taskId: string; accountId: string; remotePath: string }
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO task_targets (id, task_id, account_id, remote_path, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, t.taskId, t.accountId, t.remotePath, Date.now());
  return id;
}

export function listTargets(db: Database.Database, taskId: string): TaskTarget[] {
  return db.prepare(
    `SELECT id, account_id AS accountId, remote_path AS remotePath
     FROM task_targets WHERE task_id = ? ORDER BY created_at`
  ).all(taskId) as any;
}

export function deleteTargetsByTask(db: Database.Database, taskId: string): void {
  const ids = db.prepare(`SELECT id FROM task_targets WHERE task_id = ?`).all(taskId)
    .map((r: any) => r.id) as string[];
  for (const tid of ids) {
    db.prepare(`DELETE FROM file_snapshots WHERE target_id = ?`).run(tid);
    db.prepare(`DELETE FROM run_history WHERE target_id = ?`).run(tid);
  }
  db.prepare(`DELETE FROM task_targets WHERE task_id = ?`).run(taskId);
}

export function deleteTask(db: Database.Database, id: string): void {
  db.transaction(() => {
    deleteTargetsByTask(db, id);
    db.prepare(`DELETE FROM run_history WHERE task_id = ? AND target_id IS NULL`).run(id);
    db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  })();
}

export function upsertSnapshot(
  db: Database.Database,
  targetId: string, relPath: string,
  s: { size: number; mtime: number; hash: string | null; remoteId: string }
): void {
  db.prepare(
    `INSERT INTO file_snapshots (target_id, rel_path, size, mtime, hash, remote_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(target_id, rel_path) DO UPDATE SET
       size = excluded.size, mtime = excluded.mtime, hash = excluded.hash,
       remote_id = excluded.remote_id, updated_at = excluded.updated_at`
  ).run(targetId, relPath, s.size, s.mtime, s.hash, s.remoteId, Date.now());
}

export function listSnapshots(db: Database.Database, targetId: string):
  Map<string, { size: number; mtime: number; hash: string | null; remoteId: string }> {
  const rows = db.prepare(
    `SELECT rel_path AS relPath, size, mtime, hash, remote_id AS remoteId
     FROM file_snapshots WHERE target_id = ?`
  ).all(targetId) as any[];
  const map = new Map();
  for (const r of rows) map.set(r.relPath, { size: r.size, mtime: r.mtime, hash: r.hash, remoteId: r.remoteId });
  return map;
}

export function deleteSnapshot(db: Database.Database, targetId: string, relPath: string): void {
  db.prepare(`DELETE FROM file_snapshots WHERE target_id = ? AND rel_path = ?`).run(targetId, relPath);
}

export function clearSnapshots(db: Database.Database, targetId: string): void {
  db.prepare(`DELETE FROM file_snapshots WHERE target_id = ?`).run(targetId);
}

export function insertRun(db: Database.Database, taskId: string, targetId: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO run_history (id, task_id, target_id, started_at, status) VALUES (?, ?, ?, ?, 'running')`
  ).run(id, taskId, targetId, Date.now());
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
    `SELECT id, task_id AS taskId, target_id AS targetId, started_at AS startedAt, finished_at AS finishedAt,
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/db.test.ts`
Expected: 全部 PASS（含旧测试改写 + 新增 3 个）。

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/db.test.ts
git commit -m "feat: multi-target data model with migration"
```

---

## Task 4: runSync 改造（targetId + onProgress）

**Files:**
- Modify: `server/engine/executor.ts`
- Test: `server/engine/executor.test.ts`

- [ ] **Step 1: 改 executor.ts**

把 `SnapshotStore` 参数名 `taskId` 改为 `targetId`，`runSync` 的 `taskId` 改为 `targetId`，并新增 `onProgress`。将文件顶部到 `runSync` 签名部分改为：

```ts
import type { DriveProvider, RemoteEntry } from '../../shared/types.js';
import { scanDirectory } from './scanner.js';
import { planSync } from './planner.js';
import { join, posix } from 'node:path';

export interface SnapshotStore {
  list(targetId: string): Map<string, { size: number; mtime: number; hash: string | null; remoteId: string }>;
  upsert(targetId: string, relPath: string, s: { size: number; mtime: number; hash: string | null; remoteId: string }): void;
  remove(targetId: string, relPath: string): void;
}

export interface RunResult {
  uploadedCount: number;
  deletedCount: number;
  error: string | null;
}

export interface ProgressInfo {
  currentFile: string | null;
  uploadedCount: number;
  totalUpload: number;
  deletedCount: number;
  totalDelete: number;
}

export async function runSync(opts: {
  targetId: string;
  localPath: string;
  remotePath: string;
  provider: DriveProvider;
  snapshots: SnapshotStore;
  onLog: (level: 'info' | 'error', msg: string) => void;
  onProgress?: (p: ProgressInfo) => void;
}): Promise<RunResult> {
  const { targetId, localPath, remotePath, provider, snapshots, onLog, onProgress } = opts;

  const localFiles = scanDirectory(localPath);
  const snapshotMap = snapshots.list(targetId);

  const rootId = await resolveRemoteRoot(provider, remotePath);
  const remoteEntries = await listRemoteRecursive(provider, rootId);
  const remoteRefs = new Map<string, { id: string; size: number; hash?: string }>();
  for (const [rel, e] of remoteEntries) {
    remoteRefs.set(rel, { id: e.id, size: e.size, hash: e.hash });
  }

  const plan = planSync(localFiles, snapshotMap, remoteRefs);

  let uploadedCount = 0;
  let deletedCount = 0;
  let error: string | null = null;
  let currentFile: string | null = null;

  const totalUpload = plan.toUpload.length;
  const totalDelete = plan.toDelete.length;
  const report = () => onProgress?.({ currentFile, uploadedCount, totalUpload, deletedCount, totalDelete });
  report();

  const folderCache = new Map<string, string>();
  folderCache.set('', rootId);

  async function parentFor(relPath: string): Promise<string> {
    const dir = posix.dirname(relPath);
    if (dir === '.') return rootId;
    if (folderCache.has(dir)) return folderCache.get(dir)!;
    const parts = dir.split('/');
    let cur = rootId;
    for (const p of parts) {
      cur = await provider.ensureFolder(cur, p);
    }
    folderCache.set(dir, cur);
    return cur;
  }

  for (const relPath of plan.toUpload) {
    currentFile = relPath;
    try {
      const local = localFiles.get(relPath)!;
      const parentId = await parentFor(relPath);
      const name = posix.basename(relPath);
      const oldSnapshot = snapshotMap.get(relPath);
      const entry = await withRetry(() => provider.uploadFile(join(localPath, relPath), parentId, name));
      snapshots.upsert(targetId, relPath, {
        size: local.size, mtime: local.mtime, hash: entry.hash ?? null, remoteId: entry.id
      });
      if (oldSnapshot && oldSnapshot.remoteId && oldSnapshot.remoteId !== entry.id) {
        await withRetry(() => provider.deleteEntry(oldSnapshot.remoteId));
      }
      uploadedCount++;
      onLog('info', `上传 ${relPath}`);
      report();
    } catch (e) {
      error = (e as Error).message;
      onLog('error', `上传失败 ${relPath}: ${error}`);
      report();
    }
  }

  for (const del of plan.toDelete) {
    currentFile = del.relPath;
    try {
      await withRetry(() => provider.deleteEntry(del.remoteId));
      snapshots.remove(targetId, del.relPath);
      deletedCount++;
      onLog('info', `删除 ${del.relPath}`);
      report();
    } catch (e) {
      error = (e as Error).message;
      onLog('error', `删除失败 ${del.relPath}: ${error}`);
      report();
    }
  }

  return { uploadedCount, deletedCount, error };
}
```

其余函数（`withRetry`、`resolveRemoteRoot`、`listRemoteRecursive`）不变。

- [ ] **Step 2: 改 executor.test.ts**

现有测试调用 `runSync({ taskId: 't', ... })`，改为 `runSync({ targetId: 't', ... })`。把测试里的：

```ts
      taskId: 't', localPath: dir, remotePath: '/r',
```
改为：
```ts
      targetId: 't', localPath: dir, remotePath: '/r',
```

- [ ] **Step 3: 运行确认通过**

Run: `npx vitest run server/engine/executor.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add server/engine/executor.ts server/engine/executor.test.ts
git commit -m "feat: runSync keyed by target with progress callback"
```

---

## Task 5: 多目标同步与进度端点

**Files:**
- Modify: `server/routes.ts`

- [ ] **Step 1: 改 import**

把 `server/routes.ts` 顶部 import 改为：

```ts
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import type { Scheduler } from './scheduler.js';
import type { TaskProgress, TargetProgress } from '../shared/types.js';
import { encrypt, decrypt } from './crypto.js';
import {
  insertAccount, updateAccountCredential, listAccounts, deleteAccount,
  insertTask, updateTask, listTasks, deleteTask, getAccount,
  insertTarget, listTargets, deleteTargetsByTask,
  insertRun, finishRun, listRuns, insertLog, listLogs, latestLogId,
  listSnapshots, upsertSnapshot, deleteSnapshot
} from './db.js';
import { runSync } from './engine/executor.js';
import { createProvider } from './provider-factory.js';
import { googleAuthUrl, exchangeCodeForToken } from './auth/google.js';
import { getQrcodeToken, pollQrcode, getCookiesFromServiceTicket } from './auth/quark.js';
```

- [ ] **Step 2: 改任务 CRUD 端点**

把任务相关端点改为（带 targets 返回 + 重建 targets）：

```ts
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
      deleteTargetsByTask(db, id);
      for (const tg of body.targets) {
        insertTarget(db, { taskId: id, accountId: tg.accountId, remotePath: tg.remotePath });
      }
    }
    reschedule(id);
    return { ok: true };
  });

  app.post('/api/tasks/:id/toggle', async (req) => {
    const { id } = req.params as any;
    const body = req.body as any;
    updateTask(db, id, { enabled: !!body.enabled });
    reschedule(id);
    return { ok: true };
  });
```

- [ ] **Step 3: 删账号时 unregister 关联任务 cron**

把 DELETE `/api/accounts/:id` 改为（先查关联 task 再 unregister）：

```ts
  app.delete('/api/accounts/:id', async (req) => {
    const { id } = req.params as any;
    const tasks = db.prepare(`SELECT task_id AS id FROM task_targets WHERE account_id = ?`).all(id) as any[];
    for (const t of tasks) scheduler.unregister(t.id);
    deleteAccount(db, id);
    return { ok: true };
  });
```

- [ ] **Step 4: 进度 store 与端点**

在 `registerRoutes` 内、`reschedule` 函数之前，加入进度 store 与端点：

```ts
  const progressStore = new Map<string, TaskProgress>();
  const progressListeners = new Map<string, Set<(p: TaskProgress) => void>>();

  function publishProgress(taskId: string, p: TaskProgress): void {
    progressStore.set(taskId, p);
    const set = progressListeners.get(taskId);
    if (set) for (const fn of set) fn(p);
  }

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
```

- [ ] **Step 5: 重写 runTaskById 为多目标版本**

把 `runTaskById` 整体替换为：

```ts
  async function runTaskById(taskId: string): Promise<void> {
    if (running.has(taskId)) return;
    running.add(taskId);
    try {
      const t = db.prepare(`SELECT id, local_path AS localPath FROM tasks WHERE id = ?`).get(taskId) as any;
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
          const p: TargetProgress = {
            targetId: tg.id, accountName: acc?.displayName ?? '未知', remotePath: tg.remotePath,
            status: 'pending', currentFile: null, uploadedCount: 0, totalUpload: 0, deletedCount: 0, totalDelete: 0
          };
          return p;
        })
      };
      publishProgress(taskId, progress);

      let anyFailed = false;
      for (const tg of targets) {
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

        const runId = insertRun(db, taskId, tg.id);
        try {
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
            targetId: tg.id, localPath: t.localPath, remotePath: tg.remotePath, provider, snapshots,
            onLog: (level, msg) => insertLog(db, taskId, level, msg),
            onProgress: (p) => {
              tp.currentFile = p.currentFile;
              tp.uploadedCount = p.uploadedCount;
              tp.totalUpload = p.totalUpload;
              tp.deletedCount = p.deletedCount;
              tp.totalDelete = p.totalDelete;
              publishProgress(taskId, progress);
            }
          });
          tp.status = result.error ? 'failed' : 'success';
          if (result.error) anyFailed = true;
          finishRun(db, runId, { status: result.error ? 'failed' : 'success', uploadedCount: result.uploadedCount, deletedCount: result.deletedCount, error: result.error });
          publishProgress(taskId, progress);
        } catch (e) {
          const msg = (e as Error).message;
          tp.status = 'failed';
          anyFailed = true;
          insertLog(db, taskId, 'error', `目标 ${tg.remotePath} 同步异常: ${msg}`);
          finishRun(db, runId, { status: 'failed', uploadedCount: 0, deletedCount: 0, error: msg });
          publishProgress(taskId, progress);
        }
      }

      progress.status = anyFailed ? 'failed' : 'success';
      publishProgress(taskId, progress);
      updateTask(db, taskId, { lastStatus: anyFailed ? 'failed' : 'success' });
    } finally {
      running.delete(taskId);
    }
  }
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 后端 0 error（前端仍可能有 error，属后续 Task 修复范围；如 `src/` 报错可忽略，专注 `server/` 无错）。

- [ ] **Step 7: Commit**

```bash
git add server/routes.ts
git commit -m "feat: multi-target sync with SSE progress"
```

---

## Task 6: 前端 API 客户端

**Files:**
- Modify: `src/api.ts`

- [ ] **Step 1: 改 src/api.ts**

把 `src/api.ts` 整体替换为：

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/api.ts
git commit -m "feat: frontend api client for multi-target tasks"
```

---

## Task 7: 任务表单（编辑 + 多目标）

**Files:**
- Modify: `src/components/TaskFormModal.tsx`

- [ ] **Step 1: 重写 TaskFormModal.tsx**

把 `src/components/TaskFormModal.tsx` 整体替换为支持新建/编辑 + 多目标的版本：

```tsx
import { useEffect } from 'react';
import { Modal, Form, Input, Select, Switch, Button, Space, Divider } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { api, TaskInput } from '../api';
import type { TaskWithTargets } from '../../shared/types.js';

export default function TaskFormModal({ open, accounts, task, onClose, onDone }: {
  open: boolean;
  accounts: any[];
  task: TaskWithTargets | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    if (task) {
      form.setFieldsValue({
        name: task.name,
        localPath: task.localPath,
        schedule: task.schedule,
        enabled: task.enabled,
        targets: task.targets.map(t => ({ accountId: t.accountId, remotePath: t.remotePath }))
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ enabled: true, targets: [] });
    }
  }, [open, task, form]);

  const submit = async () => {
    const v = await form.validateFields();
    const input: TaskInput = {
      name: v.name,
      localPath: v.localPath,
      schedule: v.schedule ?? null,
      enabled: v.enabled ?? true,
      targets: (v.targets ?? []).map((t: any) => ({ accountId: t.accountId, remotePath: t.remotePath }))
    };
    if (task) await api.updateTask(task.id, input);
    else await api.createTask(input);
    onDone();
  };

  return (
    <Modal open={open} title={task ? '编辑同步任务' : '新建同步任务'} onOk={submit} onCancel={onClose} okText="保存" width={640}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="任务名称" rules={[{ required: true }]}>
          <Input placeholder="例如：文档备份" />
        </Form.Item>
        <Form.Item name="localPath" label="本地目录（绝对路径 / 容器内路径）" rules={[{ required: true }]}>
          <Input placeholder="/path/to/local" />
        </Form.Item>
        <Form.Item name="schedule" label="调度（cron 表达式，留空为手动）">
          <Input placeholder="0 2 * * *" />
        </Form.Item>
        <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
          <Switch />
        </Form.Item>

        <Divider>备份目标</Divider>
        <Form.List name="targets" rules={[{ validator: async (_, targets) => { if (!targets || targets.length < 1) throw new Error('至少添加一个备份目标'); } }]}>
          {(fields, { add, remove }, { errors }) => (
            <>
              {fields.map(({ key, name }) => (
                <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                  <Form.Item name={[name, 'accountId']} rules={[{ required: true, message: '选择账号' }]} style={{ marginBottom: 0 }}>
                    <Select placeholder="网盘账号" style={{ width: 220 }}
                      options={accounts.map(a => ({ value: a.id, label: `${a.provider} - ${a.displayName}` }))} />
                  </Form.Item>
                  <Form.Item name={[name, 'remotePath']} rules={[{ required: true, message: '填写远程目录' }]} style={{ marginBottom: 0 }}>
                    <Input placeholder="/backup/docs" style={{ width: 260 }} />
                  </Form.Item>
                  <MinusCircleOutlined onClick={() => remove(name)} />
                </Space>
              ))}
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>添加目标</Button>
                <Form.ErrorList errors={errors} />
              </Form.Item>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TaskFormModal.tsx
git commit -m "feat: editable task form with multiple targets"
```

---

## Task 8: 任务列表（running 状态 + 详情按钮）

**Files:**
- Modify: `src/pages/TasksPage.tsx`
- Create: `src/components/TaskDetailDrawer.tsx`

- [ ] **Step 1: 重写 TasksPage.tsx**

把 `src/pages/TasksPage.tsx` 整体替换为：

```tsx
import { useEffect, useState } from 'react';
import { Card, Button, Switch, Space, Table, Tag, message, Popconfirm, Tooltip } from 'antd';
import { PlusOutlined, PlayCircleOutlined, EditOutlined, EyeOutlined, SyncOutlined } from '@ant-design/icons';
import { api } from '../api';
import TaskFormModal from '../components/TaskFormModal';
import TaskDetailDrawer from '../components/TaskDetailDrawer';
import type { TaskWithTargets } from '../../shared/types.js';

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskWithTargets[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaskWithTargets | null>(null);
  const [detail, setDetail] = useState<TaskWithTargets | null>(null);

  const load = async () => {
    setTasks(await api.listTasks());
    setAccounts(await api.listAccounts());
  };

  useEffect(() => { load(); }, []);

  const toggle = async (t: TaskWithTargets, enabled: boolean) => {
    await api.toggleTask(t.id, enabled);
    load();
  };

  const run = async (id: string) => {
    await api.runTask(id);
    message.success('已触发同步');
  };

  const columns = [
    { title: '名称', dataIndex: 'name' },
    { title: '本地目录', dataIndex: 'localPath' },
    { title: '目标数', render: (_: any, t: TaskWithTargets) => t.targets.length },
    { title: '调度', dataIndex: 'schedule', render: (s: string | null) => s ?? '手动' },
    {
      title: '状态', dataIndex: 'lastStatus',
      render: (s: string | null) => {
        if (s === 'running') return <Tag icon={<SyncOutlined spin />} color="processing">同步中</Tag>;
        if (s === 'success') return <Tag color="green">成功</Tag>;
        if (s === 'failed') return <Tag color="red">失败</Tag>;
        return <Tag>未运行</Tag>;
      }
    },
    {
      title: '操作',
      render: (_: any, t: TaskWithTargets) => (
        <Space>
          <Switch checked={t.enabled} onChange={(v) => toggle(t, v)} />
          <Tooltip title="立即同步"><Button icon={<PlayCircleOutlined />} onClick={() => run(t.id)} /></Tooltip>
          <Tooltip title="详情"><Button icon={<EyeOutlined />} onClick={() => setDetail(t)} /></Tooltip>
          <Tooltip title="编辑"><Button icon={<EditOutlined />} onClick={() => { setEditing(t); setOpen(true); }} /></Tooltip>
          <Popconfirm title="删除该任务？" onConfirm={async () => { await api.deleteTask(t.id); load(); }}>
            <Button danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Card title="同步任务" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setOpen(true); }}>新建任务</Button>}>
      <Table rowKey="id" dataSource={tasks} columns={columns} pagination={false} />
      <TaskFormModal open={open} accounts={accounts} task={editing}
        onClose={() => setOpen(false)}
        onDone={() => { setOpen(false); setEditing(null); load(); }} />
      <TaskDetailDrawer task={detail} onClose={() => setDetail(null)} />
    </Card>
  );
}
```

- [ ] **Step 2: 写 TaskDetailDrawer.tsx**

创建 `src/components/TaskDetailDrawer.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { Drawer, Descriptions, Tag, Progress, Empty } from 'antd';
import { api } from '../api';
import type { TaskWithTargets, TaskProgress } from '../../shared/types.js';

function statusTag(status: string) {
  if (status === 'running') return <Tag color="processing">同步中</Tag>;
  if (status === 'success') return <Tag color="green">成功</Tag>;
  if (status === 'failed') return <Tag color="red">失败</Tag>;
  return <Tag>等待</Tag>;
}

export default function TaskDetailDrawer({ task, onClose }: {
  task: TaskWithTargets | null;
  onClose: () => void;
}) {
  const [progress, setProgress] = useState<TaskProgress | null>(null);

  useEffect(() => {
    if (!task) return;
    setProgress(null);
    api.getProgress(task.id).then(setProgress).catch(() => {});
    const es = new EventSource(api.progressStreamUrl(task.id));
    es.onmessage = (ev) => {
      try { setProgress(JSON.parse(ev.data)); } catch {}
    };
    return () => es.close();
  }, [task?.id]);

  return (
    <Drawer open={!!task} onClose={onClose} title={task ? `任务详情：${task.name}` : ''} width={560}>
      {task && (
        <>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="本地目录">{task.localPath}</Descriptions.Item>
            <Descriptions.Item label="调度">{task.schedule ?? '手动'}</Descriptions.Item>
            <Descriptions.Item label="状态">{statusTag(task.lastStatus ?? '')}</Descriptions.Item>
          </Descriptions>

          <h4>备份目标</h4>
          {progress ? (
            progress.targets.map(tp => {
              const total = tp.totalUpload + tp.totalDelete;
              const done = tp.uploadedCount + tp.deletedCount;
              const percent = total > 0 ? Math.round(done / total * 100) : (tp.status === 'success' ? 100 : 0);
              return (
                <div key={tp.targetId} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 12, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{tp.accountName} → {tp.remotePath}</span>
                    {statusTag(tp.status)}
                  </div>
                  <Progress percent={percent} size="small" style={{ marginTop: 8 }} />
                  {tp.currentFile && <div style={{ fontSize: 12, color: '#888' }}>当前：{tp.currentFile}</div>}
                  <div style={{ fontSize: 12, color: '#888' }}>
                    上传 {tp.uploadedCount}/{tp.totalUpload} · 删除 {tp.deletedCount}/{tp.totalDelete}
                  </div>
                </div>
              );
            })
          ) : (
            task.targets.map(t => (
              <div key={t.id} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 12, marginBottom: 12 }}>
                {t.accountId} → {t.remotePath}
              </div>
            ))
          )}
          {task.targets.length === 0 && <Empty description="暂无备份目标" />}
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 3: 构建验证**

Run: `npx tsc --noEmit`
Expected: 0 error。

Run: `npx vite build`
Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add src/pages/TasksPage.tsx src/components/TaskDetailDrawer.tsx
git commit -m "feat: task running status and progress drawer"
```

---

## 完成后的整体验证

- [ ] `npx vitest run` — 全部测试通过
- [ ] `npx tsc --noEmit` — 0 error
- [ ] `npm run build` — 前端 + 后端打包成功
- [ ] 手动：配置 drives.config.json → 添加账号 → 新建含多目标的任务 → 立即同步 → 详情查看进度 → 编辑任务增删目标
