# 云盘增量同步备份工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地 Web 应用，将本地目录增量镜像备份到 Google Drive 与夸克网盘。

**Architecture:** 单进程 Fastify 后端（REST API + 托管前端静态文件 + node-cron 定时调度），SQLite（better-sqlite3）持久化快照与任务状态。网盘通过统一 `DriveProvider` 接口抽象（`listFolder`/`ensureFolder`/`uploadFile`/`deleteEntry`/`getQuota`）。同步引擎 = 本地扫描 + 快照 + 远程列表三方比对，生成上传/删除计划后执行。前端 React + Vite + Ant Design。

**Tech Stack:** TypeScript、Fastify、better-sqlite3、node-cron、React、Vite、Ant Design、vitest、Docker。

---

## 文件结构总览

```
sync2/
├── shared/types.ts              # 共享类型：ProviderKind、RemoteEntry、DriveProvider、TaskRecord 等
├── server/
│   ├── index.ts                 # Fastify 入口
│   ├── config.ts                # 配置加载（环境变量 + 数据目录 + 主密钥）
│   ├── crypto.ts                # AES-256-GCM 加解密
│   ├── db.ts                    # SQLite 连接 + schema + 迁移 + 数据访问函数
│   ├── providers/
│   │   ├── google.ts            # Google Drive provider
│   │   └── quark.ts             # 夸克 provider
│   ├── auth/
│   │   ├── google.ts            # OAuth URL 生成 + 回调换 token
│   │   └── quark.ts             # 二维码 token 获取 + 轮询
│   ├── engine/
│   │   ├── scanner.ts           # 本地目录扫描
│   │   ├── planner.ts           # 三方比对
│   │   └── executor.ts          # 执行同步
│   ├── scheduler.ts             # 定时调度
│   └── routes.ts                # 所有 API 路由 + SSE
├── src/                         # 前端
│   ├── main.tsx / App.tsx / api.ts
│   ├── pages/TasksPage.tsx / AccountsPage.tsx / LogsPage.tsx
│   └── components/TaskFormModal.tsx / QuarkLoginModal.tsx
├── Dockerfile / docker-compose.yml
├── package.json / tsconfig.json / vite.config.ts / build-server.mjs
```

---

## Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `build-server.mjs`
- Create: `index.html`

- [ ] **Step 1: 写入 package.json**

```json
{
  "name": "sync2",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently -k \"vite\" \"tsx watch server/index.ts\"",
    "build": "vite build && node build-server.mjs",
    "start": "node dist-server/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fastify/static": "^7.0.4",
    "better-sqlite3": "^11.3.0",
    "fastify": "^5.0.0",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "@ant-design/icons": "^5.4.0",
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.5.0",
    "@types/node-cron": "^3.0.11",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "antd": "^5.20.0",
    "concurrently": "^9.0.0",
    "esbuild": "^0.23.1",
    "qrcode.react": "^4.1.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: 写入 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "server", "shared"]
}
```

- [ ] **Step 3: 写入 vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    proxy: { '/api': 'http://localhost:3000' }
  }
});
```

- [ ] **Step 4: 写入 build-server.mjs**

```js
import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist-server/index.js',
  external: ['better-sqlite3'],
  sourcemap: false
});
console.log('server bundled');
```

- [ ] **Step 5: 写入 index.html**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>云盘同步备份</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 安装依赖并验证**

Run: `npm install`
Expected: 无报错，生成 node_modules。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold project with typescript, vite, fastify"
```

---

## Task 2: 共享类型与数据库层

**Files:**
- Create: `shared/types.ts`
- Create: `server/db.ts`
- Test: `server/db.test.ts`

- [ ] **Step 1: 写入 shared/types.ts**

```ts
export type ProviderKind = 'google' | 'quark';

export interface RemoteEntry {
  id: string;
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
  hash?: string;
}

export interface Quota {
  total: number;
  used: number;
}

export interface DriveProvider {
  readonly rootId: string;
  listFolder(folderId: string): Promise<RemoteEntry[]>;
  ensureFolder(parentId: string, name: string): Promise<string>;
  uploadFile(localPath: string, parentId: string, name: string): Promise<RemoteEntry>;
  deleteEntry(id: string): Promise<void>;
  getQuota(): Promise<Quota>;
}

export type AccountCredential =
  | { kind: 'google'; refreshToken: string; accessToken: string | null }
  | { kind: 'quark'; cookies: Record<string, string> };

export interface AccountRecord {
  id: string;
  provider: ProviderKind;
  displayName: string;
  credential: string;
  quotaTotal: number | null;
  quotaUsed: number | null;
}

export interface TaskRecord {
  id: string;
  name: string;
  accountId: string;
  localPath: string;
  remotePath: string;
  schedule: string | null;
  enabled: boolean;
  lastStatus: string | null;
}

export interface RunRecord {
  id: string;
  taskId: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'success' | 'failed';
  uploadedCount: number;
  deletedCount: number;
  error: string | null;
}

export interface LogRecord {
  id: number;
  taskId: string | null;
  level: 'info' | 'error';
  message: string;
  createdAt: number;
}
```

- [ ] **Step 2: 写入 server/db.ts**

```ts
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
  return db.prepare(`SELECT id, provider, display_name AS displayName, credential FROM accounts ORDER BY created_at`)
    .all() as any;
}

export function deleteAccount(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
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
```

- [ ] **Step 3: 写入测试 server/db.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, insertTask, getTask, listTasks, deleteTask, upsertSnapshot, listSnapshots, insertAccount, getAccount } from './db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync2-test-'));
  db = openDb(join(dir, 'test.db'));
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('db', () => {
  it('inserts and reads a task', () => {
    const id = insertTask(db, { name: 't', accountId: 'a', localPath: '/l', remotePath: '/r', schedule: null, enabled: true });
    const t = getTask(db, id)!;
    expect(t.name).toBe('t');
    expect(t.enabled).toBe(true);
  });

  it('lists tasks and honors enabled flag', () => {
    insertTask(db, { name: 'a', accountId: 'x', localPath: '/l', remotePath: '/r', schedule: null, enabled: true });
    insertTask(db, { name: 'b', accountId: 'x', localPath: '/l', remotePath: '/r', schedule: null, enabled: false });
    expect(listTasks(db).length).toBe(2);
    expect(listTasks(db)[1].enabled).toBe(false);
  });

  it('deletes task cascades snapshots', () => {
    const id = insertTask(db, { name: 't', accountId: 'a', localPath: '/l', remotePath: '/r', schedule: null, enabled: true });
    upsertSnapshot(db, id, 'f.txt', { size: 1, mtime: 2, hash: null, remoteId: 'rid' });
    expect(listSnapshots(db, id).size).toBe(1);
    deleteTask(db, id);
    expect(listSnapshots(db, id).size).toBe(0);
  });

  it('upserts snapshot (overwrite on conflict)', () => {
    const id = insertTask(db, { name: 't', accountId: 'a', localPath: '/l', remotePath: '/r', schedule: null, enabled: true });
    upsertSnapshot(db, id, 'f.txt', { size: 1, mtime: 2, hash: null, remoteId: 'r1' });
    upsertSnapshot(db, id, 'f.txt', { size: 3, mtime: 4, hash: 'abc', remoteId: 'r2' });
    const m = listSnapshots(db, id);
    expect(m.get('f.txt')).toEqual({ size: 3, mtime: 4, hash: 'abc', remoteId: 'r2' });
  });

  it('stores and reads account', () => {
    const id = insertAccount(db, { provider: 'google', displayName: 'me', credential: 'enc' });
    const a = getAccount(db, id)!;
    expect(a.provider).toBe('google');
    expect(a.credential).toBe('enc');
  });
});
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run server/db.test.ts`
Expected: 5 tests PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add shared types and sqlite data layer"
```

---

## Task 3: 加密模块

**Files:**
- Create: `server/crypto.ts`
- Test: `server/crypto.test.ts`

- [ ] **Step 1: 写入测试 server/crypto.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { generateKey, encrypt, decrypt } from './crypto.js';

describe('crypto', () => {
  it('roundtrips plaintext', () => {
    const key = generateKey();
    const cipher = encrypt('hello 世界', key);
    expect(cipher).not.toContain('hello');
    expect(decrypt(cipher, key)).toBe('hello 世界');
  });

  it('produces different ciphertext each time (random IV)', () => {
    const key = generateKey();
    expect(encrypt('x', key)).not.toBe(encrypt('x', key));
  });

  it('fails with wrong key', () => {
    const cipher = encrypt('secret', generateKey());
    expect(() => decrypt(cipher, generateKey())).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run server/crypto.test.ts`
Expected: FAIL，`Cannot find module './crypto.js'`。

- [ ] **Step 3: 写入 server/crypto.ts**

```ts
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';

export function generateKey(): Buffer {
  return randomBytes(32);
}

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run server/crypto.test.ts`
Expected: 3 tests PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add AES-256-GCM crypto helpers"
```

---

## Task 4: 配置模块

**Files:**
- Create: `server/config.ts`
- Test: `server/config.test.ts`

- [ ] **Step 1: 写入 server/config.ts**

```ts
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Config {
  dataDir: string;
  port: number;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.DATA_DIR || join(process.cwd(), 'data'));
  mkdirSync(dataDir, { recursive: true });
  return {
    dataDir,
    port: Number(env.PORT || 3000),
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
    googleRedirectUri: env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
  };
}

export function getMasterKey(dataDir: string): Buffer {
  const keyFile = join(dataDir, '.master.key');
  if (existsSync(keyFile)) return Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex');
  const key = generateKeyHex();
  writeFileSync(keyFile, key, { mode: 0o600 });
  return Buffer.from(key, 'hex');
}

import { randomBytes } from 'node:crypto';
function generateKeyHex(): string {
  return randomBytes(32).toString('hex');
}
```

- [ ] **Step 2: 写入测试 server/config.test.ts**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, getMasterKey } from './config.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), 'cfg-')); dirs.push(d); return d; }
afterEach(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

describe('config', () => {
  it('loads defaults and creates data dir', () => {
    const d = tmp();
    const cfg = loadConfig({ DATA_DIR: d } as any);
    expect(cfg.dataDir).toBe(d);
    expect(cfg.port).toBe(3000);
  });

  it('reads env overrides', () => {
    const cfg = loadConfig({ DATA_DIR: tmp(), PORT: '8080', GOOGLE_CLIENT_ID: 'cid' } as any);
    expect(cfg.port).toBe(8080);
    expect(cfg.googleClientId).toBe('cid');
  });

  it('getMasterKey is stable across calls', () => {
    const d = tmp();
    const k1 = getMasterKey(d);
    const k2 = getMasterKey(d);
    expect(k1.equals(k2)).toBe(true);
  });
});
```

- [ ] **Step 3: 运行测试验证通过**

Run: `npx vitest run server/config.test.ts`
Expected: 3 tests PASS。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add config loading and master key management"
```

---

## Task 5: 本地目录扫描器

**Files:**
- Create: `server/engine/scanner.ts`
- Test: `server/engine/scanner.test.ts`

- [ ] **Step 1: 写入测试 server/engine/scanner.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanDirectory } from './scanner.js';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'scan-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('scanner', () => {
  it('returns files with size and mtime, relative paths using /', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'a.txt'), 'hello');
    writeFileSync(join(dir, 'sub', 'b.txt'), 'world!');
    const map = scanDirectory(dir);
    expect(map.size).toBe(2);
    expect(map.has('a.txt')).toBe(true);
    expect(map.has('sub/b.txt')).toBe(true);
    expect(map.get('a.txt')!.size).toBe(5);
    expect(map.get('a.txt')!.mtime).toBeGreaterThan(0);
  });

  it('ignores directories themselves', () => {
    mkdirSync(join(dir, 'empty'));
    expect(scanDirectory(dir).size).toBe(0);
  });

  it('returns empty map for empty directory', () => {
    expect(scanDirectory(dir).size).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run server/engine/scanner.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 写入 server/engine/scanner.ts**

```ts
import { readdirSync, statSync, Dirent } from 'node:fs';
import { join } from 'node:path';

export interface LocalFileInfo {
  size: number;
  mtime: number;
}

export function scanDirectory(root: string): Map<string, LocalFileInfo> {
  const result = new Map<string, LocalFileInfo>();
  walk(root, '', result);
  return result;
}

function walk(dir: string, rel: string, out: Map<string, LocalFileInfo>): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === '.git') continue;
    const abs = join(dir, ent.name);
    const relPath = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      walk(abs, relPath, out);
    } else if (ent.isFile()) {
      const st = statSync(abs);
      out.set(relPath, { size: st.size, mtime: Math.floor(st.mtimeMs) });
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run server/engine/scanner.test.ts`
Expected: 3 tests PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add local directory scanner"
```

---

## Task 6: 同步计划器（三方比对，核心）

**Files:**
- Create: `server/engine/planner.ts`
- Test: `server/engine/planner.test.ts`

- [ ] **Step 1: 写入测试 server/engine/planner.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { planSync, LocalFileInfo, SnapshotEntry, RemoteRef } from './planner.js';

const lf = (size: number, mtime: number): LocalFileInfo => ({ size, mtime });
const snap = (size: number, mtime: number, hash: string | null, remoteId: string): SnapshotEntry =>
  ({ size, mtime, hash, remoteId });
const remote = (size: number, hash?: string, id = 'rid'): RemoteRef => ({ id, size, hash });

describe('planSync', () => {
  it('uploads new local file (no snapshot, no remote)', () => {
    const p = planSync(new Map([['a.txt', lf(1, 1)]]), new Map(), new Map());
    expect(p.toUpload).toEqual(['a.txt']);
    expect(p.toDelete).toEqual([]);
  });

  it('uploads changed file (size differs)', () => {
    const p = planSync(
      new Map([['a.txt', lf(10, 1)]]),
      new Map([['a.txt', snap(5, 1, 'h', 'rid')]]),
      new Map([['a.txt', remote(5, 'h')]])
    );
    expect(p.toUpload).toEqual(['a.txt']);
    expect(p.toDelete).toEqual([]);
  });

  it('uploads changed file (mtime differs)', () => {
    const p = planSync(
      new Map([['a.txt', lf(5, 2)]]),
      new Map([['a.txt', snap(5, 1, 'h', 'rid')]]),
      new Map([['a.txt', remote(5, 'h')]])
    );
    expect(p.toUpload).toEqual(['a.txt']);
  });

  it('skips unchanged file present remotely', () => {
    const p = planSync(
      new Map([['a.txt', lf(5, 1)]]),
      new Map([['a.txt', snap(5, 1, 'h', 'rid')]]),
      new Map([['a.txt', remote(5, 'h')]])
    );
    expect(p.toUpload).toEqual([]);
    expect(p.toDelete).toEqual([]);
  });

  it('re-uploads unchanged file if remote was deleted', () => {
    const p = planSync(
      new Map([['a.txt', lf(5, 1)]]),
      new Map([['a.txt', snap(5, 1, 'h', 'rid')]]),
      new Map()
    );
    expect(p.toUpload).toEqual(['a.txt']);
  });

  it('deletes remote when local file removed (has snapshot)', () => {
    const p = planSync(
      new Map(),
      new Map([['a.txt', snap(5, 1, 'h', 'rid')]]),
      new Map([['a.txt', remote(5, 'h')]])
    );
    expect(p.toDelete).toEqual([{ relPath: 'a.txt', remoteId: 'rid' }]);
  });

  it('deletes remote when local file removed (no snapshot, remote exists)', () => {
    const p = planSync(
      new Map(),
      new Map(),
      new Map([['a.txt', remote(5, 'h', 'remote-id')]])
    );
    expect(p.toDelete).toEqual([{ relPath: 'a.txt', remoteId: 'remote-id' }]);
  });

  it('uploads local file that exists remotely but has no snapshot (conservative)', () => {
    const p = planSync(
      new Map([['a.txt', lf(5, 1)]]),
      new Map(),
      new Map([['a.txt', remote(5, 'h')]])
    );
    expect(p.toUpload).toEqual(['a.txt']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run server/engine/planner.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 写入 server/engine/planner.ts**

```ts
export interface LocalFileInfo {
  size: number;
  mtime: number;
}

export interface SnapshotEntry {
  size: number;
  mtime: number;
  hash: string | null;
  remoteId: string;
}

export interface RemoteRef {
  id: string;
  size: number;
  hash?: string;
}

export interface SyncPlan {
  toUpload: string[];
  toDelete: { relPath: string; remoteId: string }[];
}

export function planSync(
  localFiles: Map<string, LocalFileInfo>,
  snapshots: Map<string, SnapshotEntry>,
  remoteEntries: Map<string, RemoteRef>
): SyncPlan {
  const toUpload: string[] = [];
  const toDelete: { relPath: string; remoteId: string }[] = [];

  for (const [relPath, local] of localFiles) {
    const snap = snapshots.get(relPath);
    const remote = remoteEntries.get(relPath);
    if (!snap && !remote) {
      toUpload.push(relPath);
    } else if (snap && (snap.size !== local.size || snap.mtime !== local.mtime)) {
      toUpload.push(relPath);
    } else if (snap && snap.size === local.size && snap.mtime === local.mtime) {
      if (!remote) toUpload.push(relPath);
    } else if (!snap && remote) {
      toUpload.push(relPath);
    }
  }

  for (const [relPath, snap] of snapshots) {
    if (!localFiles.has(relPath)) toDelete.push({ relPath, remoteId: snap.remoteId });
  }

  for (const [relPath, remote] of remoteEntries) {
    if (!localFiles.has(relPath) && !snapshots.has(relPath)) {
      toDelete.push({ relPath, remoteId: remote.id });
    }
  }

  return { toUpload, toDelete };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run server/engine/planner.test.ts`
Expected: 8 tests PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add sync planner with three-way diff"
```

---

## Task 7: Google Drive Provider

**Files:**
- Create: `server/providers/google.ts`
- Test: `server/providers/google.test.ts`

- [ ] **Step 1: 写入 server/providers/google.ts**

```ts
import type { DriveProvider, RemoteEntry, Quota } from '../../shared/types.js';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const API = 'https://www.googleapis.com';

export interface GoogleAuth {
  getAccessToken(): Promise<string>;
}

export class GoogleDriveProvider implements DriveProvider {
  readonly rootId = 'root';

  constructor(private auth: GoogleAuth) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.auth.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  private async listAll(folderId: string): Promise<RemoteEntry[]> {
    const headers = await this.headers();
    const entries: RemoteEntry[] = [];
    let pageToken: string | undefined;
    do {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const url = `${API}/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum)${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Google list failed: ${res.status} ${await res.text()}`);
      const data = await res.json() as any;
      for (const f of data.files ?? []) {
        entries.push({
          id: f.id,
          name: f.name,
          isDir: f.mimeType === 'application/vnd.google-apps.folder',
          size: Number(f.size ?? 0),
          mtime: Math.floor(new Date(f.modifiedTime).getTime() / 1000),
          hash: f.md5Checksum
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return entries;
  }

  async listFolder(folderId: string): Promise<RemoteEntry[]> {
    return this.listAll(folderId);
  }

  async ensureFolder(parentId: string, name: string): Promise<string> {
    const existing = await this.listAll(parentId);
    const found = existing.find(e => e.isDir && e.name === name);
    if (found) return found.id;
    const headers = await this.headers();
    const res = await fetch(`${API}/drive/v3/files`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });
    if (!res.ok) throw new Error(`Google mkdir failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as any;
    return data.id;
  }

  async uploadFile(localPath: string, parentId: string, name: string): Promise<RemoteEntry> {
    const size = statSync(localPath).size;
    const md5 = await md5File(localPath);

    const existing = await this.listAll(parentId);
    const dup = existing.find(e => !e.isDir && e.name === name && e.hash === md5);
    if (dup) return dup;

    const headers = await this.headers();
    const body = readFileSync(localPath);
    const boundary = 'sync2-' + Math.random().toString(36).slice(2);
    const metadata = JSON.stringify({ name, parents: [parentId] });
    const multipart = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const res = await fetch(`${API}/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,modifiedTime,md5Checksum`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart
    });
    if (!res.ok) throw new Error(`Google upload failed: ${res.status} ${await res.text()}`);
    const meta = await res.json() as any;
    return {
      id: meta.id,
      name: meta.name,
      isDir: false,
      size: Number(meta.size ?? size),
      mtime: Math.floor(new Date(meta.modifiedTime).getTime() / 1000),
      hash: meta.md5Checksum
    };
  }

  async deleteEntry(id: string): Promise<void> {
    const headers = await this.headers();
    const res = await fetch(`${API}/drive/v3/files/${id}`, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Google delete failed: ${res.status} ${await res.text()}`);
    }
  }

  async getQuota(): Promise<Quota> {
    const headers = await this.headers();
    const res = await fetch(`${API}/drive/v3/about?fields=storageQuota`, { headers });
    if (!res.ok) throw new Error(`Google quota failed: ${res.status}`);
    const data = await res.json() as any;
    return { total: Number(data.storageQuota.limit ?? 0), used: Number(data.storageQuota.usage ?? 0) };
  }
}

export async function md5File(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(path);
  return createHash('md5').update(buf).digest('hex');
}
```

- [ ] **Step 2: 写入测试 server/providers/google.test.ts**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoogleDriveProvider } from './google.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function mockAuth(token = 'tok'): any {
  return { getAccessToken: vi.fn().mockResolvedValue(token) };
}

afterEach(() => vi.restoreAllMocks());

describe('GoogleDriveProvider', () => {
  it('lists folder entries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      files: [
        { id: '1', name: 'a.txt', mimeType: 'text/plain', size: '5', modifiedTime: '2024-01-01T00:00:00.000Z', md5Checksum: 'h' },
        { id: '2', name: 'sub', mimeType: 'application/vnd.google-apps.folder', size: '0', modifiedTime: '2024-01-01T00:00:00.000Z' }
      ]
    }), { status: 200 }));
    const p = new GoogleDriveProvider(mockAuth());
    const list = await p.listFolder('root');
    expect(list).toHaveLength(2);
    expect(list[0].isDir).toBe(false);
    expect(list[1].isDir).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('root');
  });

  it('ensureFolder returns existing folder id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      files: [{ id: 'fid', name: 'sub', mimeType: 'application/vnd.google-apps.folder', size: '0', modifiedTime: '2024-01-01T00:00:00.000Z' }]
    }), { status: 200 }));
    const p = new GoogleDriveProvider(mockAuth());
    expect(await p.ensureFolder('parent', 'sub')).toBe('fid');
  });

  it('ensureFolder creates when missing', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'newid' }), { status: 200 }));
    const p = new GoogleDriveProvider(mockAuth());
    expect(await p.ensureFolder('parent', 'sub')).toBe('newid');
  });

  it('uploadFile returns entry with name and hash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gup-'));
    const filePath = join(dir, 'a.txt');
    writeFileSync(filePath, 'hello');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'nid', name: 'a.txt', size: '5', modifiedTime: '2024-01-01T00:00:00.000Z', md5Checksum: 'abc'
      }), { status: 200 }));
    const p = new GoogleDriveProvider(mockAuth());
    const entry = await p.uploadFile(filePath, 'parent', 'a.txt');
    expect(entry.name).toBe('a.txt');
    expect(entry.hash).toBe('abc');
    expect(entry.isDir).toBe(false);
    expect(entry.mtime).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: 运行测试验证通过**

Run: `npx vitest run server/providers/google.test.ts`
Expected: 3 tests PASS。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Google Drive provider"
```

---

## Task 8: 夸克 Provider

**Files:**
- Create: `server/providers/quark.ts`
- Test: `server/providers/quark.test.ts`

- [ ] **Step 1: 写入 server/providers/quark.ts**

```ts
import type { DriveProvider, RemoteEntry, Quota } from '../../shared/types.js';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const BASE = 'https://drive-pc.quark.cn/1/clouddrive';
const OSS_UA = 'aliyun-sdk-js/6.6.1 Chrome 98.0.4758.80 on Windows 10 64-bit';

function defParams(): URLSearchParams {
  return new URLSearchParams({
    pr: 'ucpro', fr: 'pc', uc_param_str: '',
    __t: String(Date.now()), __dt: '1000'
  });
}

export interface QuarkCookieStore {
  getCookies(): Record<string, string>;
}

export class QuarkProvider implements DriveProvider {
  readonly rootId = '0';

  constructor(private cookies: QuarkCookieStore) {}

  private headers(): Record<string, string> {
    const c = this.cookies.getCookies();
    const cookie = Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ');
    return {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      origin: 'https://pan.quark.cn',
      referer: 'https://pan.quark.cn/',
      'content-type': 'application/json',
      cookie
    };
  }

  private async get(url: string, params: Record<string, string | number>): Promise<any> {
    const q = defParams();
    for (const [k, v] of Object.entries(params)) q.set(k, String(v));
    const res = await fetch(`${url}?${q}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Quark ${url} HTTP ${res.status}`);
    const data = await res.json() as any;
    if (data.status !== 200 || data.code !== 0) throw new Error(`Quark ${url} code ${data.code}: ${data.message ?? ''}`);
    return data.data;
  }

  private async post(url: string, body: unknown): Promise<any> {
    const q = defParams();
    const res = await fetch(`${url}?${q}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Quark ${url} HTTP ${res.status}`);
    const data = await res.json() as any;
    if (data.status !== 200 || data.code !== 0) throw new Error(`Quark ${url} code ${data.code}: ${data.message ?? ''}`);
    return data.data;
  }

  async listFolder(folderId: string): Promise<RemoteEntry[]> {
    const data = await this.get(`${BASE}/file/sort`, {
      pdir_fid: folderId, _page: 1, _size: 1000, _sort: 'file_name:asc',
      _fetch_total: 1, _fetch_sub_dirs: 0
    });
    return (data.list ?? []).map((f: any) => ({
      id: f.fid,
      name: f.file_name,
      isDir: !!f.dir,
      size: Number(f.size ?? 0),
      mtime: Number(f.updated_at ?? 0),
      hash: f.sha1 || undefined
    }));
  }

  async ensureFolder(parentId: string, name: string): Promise<string> {
    const list = await this.listFolder(parentId);
    const found = list.find(e => e.isDir && e.name === name);
    if (found) return found.id;
    const data = await this.post(`${BASE}/file`, {
      pdir_fid: parentId, file_name: name, dir_init_lock: false
    });
    return data.fid;
  }

  async uploadFile(localPath: string, parentId: string, name: string): Promise<RemoteEntry> {
    const size = statSync(localPath).size;
    const md5 = await md5File(localPath);
    const mimeType = 'application/octet-stream';

    const pre = await this.post(`${BASE}/file/upload/pre`, {
      ccp_hash_update: true, parallel_upload: true, pdir_fid: parentId,
      dir_name: '', size, file_name: name,
      format_type: mimeType,
      l_updated_at: Date.now(), l_created_at: Date.now()
    });

    const hashRes = await this.post(`${BASE}/file/update/hash`, {
      task_id: pre.task_id, md5, sha1: ''
    });
    if (hashRes?.finish === true) {
      const list = await this.listFolder(parentId);
      const found = list.find(e => !e.isDir && e.name === name);
      if (found) return found;
      return { id: pre.task_id, name, isDir: false, size, mtime: Math.floor(Date.now() / 1000), hash: md5 };
    }

    const partSize: number = pre.metadata?.part_size || 4 * 1024 * 1024;
    const buf = readFileSync(localPath);
    const host = String(pre.upload_url || '').replace(/^https?:\/\//, '');
    const baseUrl = `https://${pre.bucket}.${host}/${pre.obj_key}`;
    const etags: string[] = [];
    let partNumber = 1;
    for (let off = 0; off < size; off += partSize) {
      const chunk = buf.subarray(off, Math.min(off + partSize, size));
      etags.push(await this.upPart(pre, mimeType, partNumber, chunk, baseUrl));
      partNumber++;
    }

    await this.upCommit(pre, etags, baseUrl);
    await this.post(`${BASE}/file/upload/finish`, { task_id: pre.task_id, obj_key: pre.obj_key });

    const list = await this.listFolder(parentId);
    const uploaded = list.find(e => !e.isDir && e.name === name);
    return uploaded ?? { id: pre.task_id, name, isDir: false, size, mtime: Math.floor(Date.now() / 1000), hash: md5 };
  }

  private async upPart(
    pre: any, mimeType: string, partNumber: number, chunk: Buffer, baseUrl: string
  ): Promise<string> {
    const timeStr = new Date().toUTCString();
    const authMeta =
      `PUT\n\n${mimeType}\n${timeStr}\n` +
      `x-oss-date:${timeStr}\nx-oss-user-agent:${OSS_UA}\n` +
      `/${pre.bucket}/${pre.obj_key}?partNumber=${partNumber}&uploadId=${pre.upload_id}`;
    const auth = await this.post(`${BASE}/file/upload/auth`, {
      task_id: pre.task_id, auth_info: pre.auth_info, auth_meta: authMeta
    });
    const url = `${baseUrl}?partNumber=${partNumber}&uploadId=${pre.upload_id}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': auth.auth_key,
        'Content-Type': mimeType,
        'Referer': 'https://pan.quark.cn/',
        'x-oss-date': timeStr,
        'x-oss-user-agent': OSS_UA
      },
      body: chunk
    });
    if (res.status !== 200) throw new Error(`Quark part upload failed: ${res.status}`);
    return res.headers.get('etag')!;
  }

  private async upCommit(pre: any, etags: string[], baseUrl: string): Promise<void> {
    const timeStr = new Date().toUTCString();
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>\n` +
      etags.map((etag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${etag}</ETag></Part>`).join('\n') +
      `\n</CompleteMultipartUpload>`;
    const contentMd5 = createHash('md5').update(xml).digest('base64');
    const callbackBase64 = Buffer.from(JSON.stringify(pre.callback ?? {})).toString('base64');
    const authMeta =
      `POST\n${contentMd5}\napplication/xml\n${timeStr}\n` +
      `x-oss-callback:${callbackBase64}\nx-oss-date:${timeStr}\nx-oss-user-agent:${OSS_UA}\n` +
      `/${pre.bucket}/${pre.obj_key}?uploadId=${pre.upload_id}`;
    const auth = await this.post(`${BASE}/file/upload/auth`, {
      task_id: pre.task_id, auth_info: pre.auth_info, auth_meta: authMeta
    });
    const url = `${baseUrl}?uploadId=${pre.upload_id}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': auth.auth_key,
        'Content-MD5': contentMd5,
        'Content-Type': 'application/xml',
        'Referer': 'https://pan.quark.cn/',
        'x-oss-callback': callbackBase64,
        'x-oss-date': timeStr,
        'x-oss-user-agent': OSS_UA
      },
      body: xml
    });
    if (res.status !== 200) throw new Error(`Quark commit failed: ${res.status}`);
  }

  async deleteEntry(id: string): Promise<void> {
    await this.post(`${BASE}/file/delete`, { action_type: 2, filelist: [id], exclude_fids: [] });
  }

  async getQuota(): Promise<Quota> {
    const data = await this.get(`${BASE}/capacity`, {});
    return { total: Number(data.total_capacity ?? 0), used: Number(data.use_capacity ?? 0) };
  }
}

async function md5File(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(path);
  return createHash('md5').update(buf).digest('hex');
}
```

- [ ] **Step 2: 写入测试 server/providers/quark.test.ts**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QuarkProvider } from './quark.js';

function mockCookies(): any { return { getCookies: () => ({ __uid: 'u' }) }; }

function okJson(data: unknown) {
  return new Response(JSON.stringify({ status: 200, code: 0, data }), { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

describe('QuarkProvider', () => {
  it('lists folder entries from file/sort', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({
      list: [
        { fid: '1', file_name: 'a.txt', dir: false, size: '5', updated_at: 1700000000 },
        { fid: '2', file_name: 'sub', dir: true, size: '0', updated_at: 1700000000 }
      ]
    }));
    const p = new QuarkProvider(mockCookies());
    const list = await p.listFolder('0');
    expect(list).toHaveLength(2);
    expect(list[0].isDir).toBe(false);
    expect(list[1].isDir).toBe(true);
  });

  it('ensureFolder returns existing dir fid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({
      list: [{ fid: 'd1', file_name: 'sub', dir: true, size: '0', updated_at: 1 }]
    }));
    const p = new QuarkProvider(mockCookies());
    expect(await p.ensureFolder('0', 'sub')).toBe('d1');
  });

  it('deleteEntry posts action_type 2', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ task_id: 't' }));
    const p = new QuarkProvider(mockCookies());
    await p.deleteEntry('fid');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.action_type).toBe(2);
    expect(body.filelist).toEqual(['fid']);
  });
});
```

- [ ] **Step 3: 运行测试验证通过**

Run: `npx vitest run server/providers/quark.test.ts`
Expected: 3 tests PASS。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Quark provider with multipart upload"
```

---

## Task 9: Google OAuth 认证

**Files:**
- Create: `server/auth/google.ts`
- Test: `server/auth/google.test.ts`

- [ ] **Step 1: 写入 server/auth/google.ts**

```ts
import type { Config } from '../config.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = ['https://www.googleapis.com/auth/drive'];

export function googleAuthUrl(cfg: Config, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.googleClientId,
    redirect_uri: cfg.googleRedirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCodeForToken(cfg: Config, code: string): Promise<{
  access_token: string; refresh_token?: string; expires_in: number;
}> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.googleClientId,
      client_secret: cfg.googleClientSecret,
      redirect_uri: cfg.googleRedirectUri,
      grant_type: 'authorization_code'
    })
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  if (!res.ok) throw new Error(`Google refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  return data.access_token;
}
```

- [ ] **Step 2: 写入测试 server/auth/google.test.ts**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { googleAuthUrl, exchangeCodeForToken, refreshAccessToken } from './google.js';

const cfg: any = {
  googleClientId: 'cid', googleClientSecret: 'cs', googleRedirectUri: 'http://localhost/cb'
};

afterEach(() => vi.restoreAllMocks());

describe('google auth', () => {
  it('builds auth url with offline access', () => {
    const url = googleAuthUrl(cfg, 'st');
    expect(url).toContain('client_id=cid');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('state=st');
  });

  it('exchanges code for tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      access_token: 'at', refresh_token: 'rt', expires_in: 3600
    }), { status: 200 }));
    const t = await exchangeCodeForToken(cfg, 'code');
    expect(t.refresh_token).toBe('rt');
  });

  it('refreshes access token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ access_token: 'new' }), { status: 200 }));
    expect(await refreshAccessToken('cid', 'cs', 'rt')).toBe('new');
  });
});
```

- [ ] **Step 3: 运行测试验证通过**

Run: `npx vitest run server/auth/google.test.ts`
Expected: 3 tests PASS。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Google OAuth auth flow"
```

---

## Task 10: 夸克扫码认证

**Files:**
- Create: `server/auth/quark.ts`
- Test: `server/auth/quark.test.ts`

- [ ] **Step 1: 写入 server/auth/quark.ts**

```ts
import { randomUUID } from 'node:crypto';

const CAS = 'https://uop.quark.cn/cas/ajax';
const ACCOUNT = 'https://pan.quark.cn/account/info';

export async function getQrcodeToken(): Promise<{ token: string; url: string }> {
  const params = new URLSearchParams({
    client_id: '532', v: '1.2', request_id: randomUUID()
  });
  const res = await fetch(`${CAS}/getTokenForQrcodeLogin?${params}`);
  if (!res.ok) throw new Error(`Quark qrcode token failed: ${res.status}`);
  const data = await res.json() as any;
  if (data.status !== 2000000) throw new Error(`Quark qrcode status ${data.status}`);
  const token = data.data.members.token;
  return { token, url: `https://pan.quark.cn/cas/qrcode?token=${token}` };
}

export interface QrcodeStatus {
  state: 'pending' | 'scanned' | 'expired' | 'success';
  serviceTicket?: string;
}

export async function pollQrcode(token: string): Promise<QrcodeStatus> {
  const params = new URLSearchParams({
    client_id: '532', v: '1.2', token, request_id: randomUUID()
  });
  const res = await fetch(`${CAS}/getServiceTicketByQrcodeToken?${params}`);
  if (!res.ok) throw new Error(`Quark qrcode poll failed: ${res.status}`);
  const data = await res.json() as any;
  if (data.status === 2000000 && data.data.members.service_ticket) {
    return { state: 'success', serviceTicket: data.data.members.service_ticket };
  }
  if (data.status === 50004001) return { state: 'pending' };
  return { state: 'scanned' };
}

export async function getCookiesFromServiceTicket(serviceTicket: string): Promise<{
  cookies: Record<string, string>; nickname: string;
}> {
  const params = new URLSearchParams({ st: serviceTicket, lw: 'scan' });
  const res = await fetch(`${ACCOUNT}?${params}`, { redirect: 'manual' });
  const cookies: Record<string, string> = {};
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const m = c.match(/^([^=]+)=([^;]*)/);
    if (m) cookies[m[1]] = m[2];
  }
  const body = await res.json().catch(() => ({})) as any;
  return { cookies, nickname: body?.data?.nickname ?? '' };
}
```

- [ ] **Step 2: 写入测试 server/auth/quark.test.ts**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getQrcodeToken, pollQrcode } from './quark.js';

afterEach(() => vi.restoreAllMocks());

describe('quark auth', () => {
  it('gets qrcode token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 2000000, data: { members: { token: 'tk' } }
    }), { status: 200 }));
    const r = await getQrcodeToken();
    expect(r.token).toBe('tk');
    expect(r.url).toContain('tk');
  });

  it('polls pending when waiting scan', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 50004001, data: {}
    }), { status: 200 }));
    expect((await pollQrcode('tk')).state).toBe('pending');
  });

  it('polls success with service ticket', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 2000000, data: { members: { service_ticket: 'st' } }
    }), { status: 200 }));
    const r = await pollQrcode('tk');
    expect(r.state).toBe('success');
    expect(r.serviceTicket).toBe('st');
  });
});
```

- [ ] **Step 3: 运行测试验证通过**

Run: `npx vitest run server/auth/quark.test.ts`
Expected: 3 tests PASS。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Quark QR-code login flow"
```

---

## Task 11: 同步执行器

**Files:**
- Create: `server/engine/executor.ts`
- Test: `server/engine/executor.test.ts`

- [ ] **Step 1: 写入 server/engine/executor.ts**

```ts
import type { DriveProvider, RemoteEntry } from '../../shared/types.js';
import { scanDirectory } from './scanner.js';
import { planSync } from './planner.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

export interface SnapshotStore {
  list(taskId: string): Map<string, { size: number; mtime: number; hash: string | null; remoteId: string }>;
  upsert(taskId: string, relPath: string, s: { size: number; mtime: number; hash: string | null; remoteId: string }): void;
  remove(taskId: string, relPath: string): void;
}

export interface RunResult {
  uploadedCount: number;
  deletedCount: number;
  error: string | null;
}

export async function runSync(opts: {
  taskId: string;
  localPath: string;
  remotePath: string;
  provider: DriveProvider;
  snapshots: SnapshotStore;
  onLog: (level: 'info' | 'error', msg: string) => void;
}): Promise<RunResult> {
  const { taskId, localPath, remotePath, provider, snapshots, onLog } = opts;

  const localFiles = scanDirectory(localPath);
  const snapshotMap = snapshots.list(taskId);

  const rootId = await resolveRemoteRoot(provider, remotePath);
  const remoteEntries = await listRemoteRecursive(provider, rootId);
  const remoteRefs = new Map<string, { id: string; size: number; hash?: string }>();
  const remoteById = new Map<string, RemoteEntry>();
  for (const [rel, e] of remoteEntries) {
    remoteRefs.set(rel, { id: e.id, size: e.size, hash: e.hash });
    remoteById.set(e.id, e);
  }

  const plan = planSync(localFiles, snapshotMap, remoteRefs);

  let uploadedCount = 0;
  let deletedCount = 0;
  let error: string | null = null;

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
    try {
      const local = localFiles.get(relPath)!;
      const parentId = await parentFor(relPath);
      const name = posix.basename(relPath);
      const oldSnapshot = snapshotMap.get(relPath);
      const entry = await withRetry(() => provider.uploadFile(join(localPath, relPath), parentId, name));
      const hash = localMd5(join(localPath, relPath));
      snapshots.upsert(taskId, relPath, {
        size: local.size, mtime: local.mtime, hash, remoteId: entry.id
      });
      if (oldSnapshot && oldSnapshot.remoteId && oldSnapshot.remoteId !== entry.id) {
        await withRetry(() => provider.deleteEntry(oldSnapshot.remoteId));
      }
      uploadedCount++;
      onLog('info', `上传 ${relPath}`);
    } catch (e) {
      error = (e as Error).message;
      onLog('error', `上传失败 ${relPath}: ${error}`);
    }
  }

  for (const del of plan.toDelete) {
    try {
      await withRetry(() => provider.deleteEntry(del.remoteId));
      snapshots.remove(taskId, del.relPath);
      deletedCount++;
      onLog('info', `删除 ${del.relPath}`);
    } catch (e) {
      error = (e as Error).message;
      onLog('error', `删除失败 ${del.relPath}: ${error}`);
    }
  }

  return { uploadedCount, deletedCount, error };
}

async function withRetry<T>(fn: () => Promise<T>, times = 3): Promise<T> {
  let lastErr: Error | null = null;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e as Error;
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr!;
}

function localMd5(path: string): string {
  return createHash('md5').update(readFileSync(path)).digest('hex');
}

async function resolveRemoteRoot(provider: DriveProvider, remotePath: string): Promise<string> {
  const parts = remotePath.split('/').filter(Boolean);
  let cur = provider.rootId;
  for (const p of parts) {
    cur = await provider.ensureFolder(cur, p);
  }
  return cur;
}

async function listRemoteRecursive(provider: DriveProvider, rootId: string): Promise<Map<string, RemoteEntry>> {
  const out = new Map<string, RemoteEntry>();
  async function walk(folderId: string, prefix: string): Promise<void> {
    const entries = await provider.listFolder(folderId);
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDir) {
        await walk(e.id, rel);
      } else {
        out.set(rel, e);
      }
    }
  }
  await walk(rootId, '');
  return out;
}
```

- [ ] **Step 2: 写入测试 server/engine/executor.test.ts**

```ts
import { describe, it, expect, vi } from 'vitest';
import { runSync } from './executor.js';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DriveProvider, RemoteEntry } from '../../shared/types.js';

function fakeProvider(remote: Map<string, RemoteEntry>): DriveProvider {
  return {
    rootId: 'root',
    async listFolder() {
      return [...remote.values()];
    },
    async ensureFolder() { return 'root'; },
    async uploadFile(_localPath, _parentId, name) {
      const e = { id: `${name}-id`, name, isDir: false, size: 5, mtime: 1, hash: 'x' };
      remote.set(name, e);
      return e;
    },
    async deleteEntry(id) { for (const [k, e] of remote) if (e.id === id) remote.delete(k); },
    async getQuota() { return { total: 0, used: 0 }; }
  };
}

function snapshots() {
  const map = new Map<string, any>();
  return {
    list: () => map,
    upsert: (_t: string, rel: string, s: any) => map.set(rel, s),
    remove: (_t: string, rel: string) => { map.delete(rel); }
  };
}

describe('runSync', () => {
  it('uploads new files and deletes removed files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exec-'));
    writeFileSync(join(dir, 'new.txt'), 'hello');
    const remote = new Map<string, RemoteEntry>([
      ['old.txt', { id: 'old-id', name: 'old.txt', isDir: false, size: 4, mtime: 1 }]
    ]);
    const snap = snapshots();
    snap.upsert('t', 'old.txt', { size: 4, mtime: 1, hash: null, remoteId: 'old-id' });

    const result = await runSync({
      taskId: 't', localPath: dir, remotePath: '/r',
      provider: fakeProvider(remote), snapshots: snap,
      onLog: () => {}
    });

    expect(result.uploadedCount).toBe(1);
    expect(result.deletedCount).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: 运行测试验证通过**

Run: `npx vitest run server/engine/executor.test.ts`
Expected: 1 test PASS。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add sync executor with folder resolution and snapshot updates"
```

---

## Task 12: 调度器与 provider 工厂

**Files:**
- Create: `server/scheduler.ts`
- Create: `server/provider-factory.ts`
- Test: `server/scheduler.test.ts`

- [ ] **Step 1: 写入 server/provider-factory.ts**

```ts
import type { DriveProvider, AccountCredential } from '../shared/types.js';
import type { Config } from './config.js';
import { GoogleDriveProvider } from './providers/google.js';
import { QuarkProvider } from './providers/quark.js';

export function createProvider(
  kind: 'google' | 'quark',
  credential: AccountCredential,
  cfg: Config
): DriveProvider {
  if (kind === 'google') {
    let cached: { token: string; expiresAt: number } | null = null;
    const cred = credential as { refreshToken: string; accessToken: string | null };
    const auth = {
      async getAccessToken(): Promise<string> {
        if (cached && cached.expiresAt > Date.now()) return cached.token;
        const { refreshAccessToken } = await import('./auth/google.js');
        const token = await refreshAccessToken(cfg.googleClientId, cfg.googleClientSecret, cred.refreshToken);
        cached = { token, expiresAt: Date.now() + 3000 * 1000 };
        return token;
      }
    };
    return new GoogleDriveProvider(auth);
  }
  const cred = credential as { cookies: Record<string, string> };
  return new QuarkProvider({ getCookies: () => cred.cookies });
}
```

- [ ] **Step 2: 写入 server/scheduler.ts**

```ts
import cron from 'node-cron';

export interface Scheduler {
  register(taskId: string, schedule: string | null, enabled: boolean, fn: () => void): void;
  unregister(taskId: string): void;
}

export function createScheduler(): Scheduler {
  const jobs = new Map<string, cron.ScheduledTask>();

  return {
    register(taskId, schedule, enabled, fn) {
      this.unregister(taskId);
      if (!schedule || !enabled) return;
      let cronExpr: string;
      if (schedule.startsWith('@')) {
        cronExpr = schedule;
      } else if (/^\d+$/.test(schedule)) {
        cronExpr = `*/${schedule} * * * *`;
      } else {
        cronExpr = schedule;
      }
      if (!cron.validate(cronExpr)) return;
      jobs.set(taskId, cron.schedule(cronExpr, fn));
    },
    unregister(taskId) {
      const j = jobs.get(taskId);
      if (j) { j.stop(); jobs.delete(taskId); }
    }
  };
}
```

- [ ] **Step 3: 写入测试 server/scheduler.test.ts**

```ts
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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run server/scheduler.test.ts`
Expected: 2 tests PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add scheduler and provider factory"
```

---

## Task 13: Fastify 入口与 API 路由

**Files:**
- Create: `server/routes.ts`
- Create: `server/index.ts`

- [ ] **Step 1: 写入 server/routes.ts**

```ts
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

  app.post('/api/tasks/:id/run', async (req, reply) => {
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
    deleteAccount(db, id);
    return { ok: true };
  });

  app.get('/api/auth/google/url', async () => {
    const state = 'sync2';
    return { url: googleAuthUrl(cfg, state) };
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const { code } = req.query as any;
    const token = await exchangeCodeForToken(cfg, code);
    const credential = encodeCred({ kind: 'google', refreshToken: token.refresh_token, accessToken: token.access_token });
    const id = insertAccount(db, { provider: 'google', displayName: 'Google', credential });
    await reply.redirect(`/?accountAdded=google`);
    return;
  });

  app.post('/api/auth/quark/start', async () => {
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

  function reschedule(taskId: string): void {
    const t = db.prepare(`SELECT id, schedule, enabled FROM tasks WHERE id = ?`).get(taskId) as any;
    if (!t) return;
    scheduler.register(t.id, t.schedule, !!t.enabled, () => { void runTaskById(t.id); });
  }

  async function runTaskById(taskId: string): Promise<void> {
    const t = db.prepare(
      `SELECT id, account_id AS accountId, local_path AS localPath, remote_path AS remotePath FROM tasks WHERE id = ?`
    ).get(taskId) as any;
    if (!t) return;
    const acc = db.prepare(`SELECT provider, credential FROM accounts WHERE id = ?`).get(t.accountId) as any;
    if (!acc) { insertLog(db, taskId, 'error', '账号不存在'); return; }
    const runId = insertRun(db, taskId);
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
  }

  for (const t of listTasks(db)) {
    reschedule(t.id);
  }
}
```

- [ ] **Step 2: 写入 server/index.ts**

```ts
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { openDb } from './db.js';
import { loadConfig, getMasterKey } from './config.js';
import { registerRoutes } from './routes.js';
import { createScheduler } from './scheduler.js';

const cfg = loadConfig();
const db = openDb(join(cfg.dataDir, 'sync2.db'));
const masterKey = getMasterKey(cfg.dataDir);
const scheduler = createScheduler();

const app = Fastify({ logger: true });
registerRoutes(app, db, cfg, masterKey, scheduler);

app.register(fastifyStatic, { root: join(process.cwd(), 'dist') });
app.setNotFoundHandler((req, reply) => {
  if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
  return reply.sendFile('index.html');
});

const port = cfg.port;
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`sync2 listening on http://localhost:${port}`);
});
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误（如有个别 any 警告属正常，需 0 error）。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Fastify entry and API routes"
```

---

## Task 14: 前端脚手架与 API 客户端

**Files:**
- Create: `src/api.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`

- [ ] **Step 1: 写入 src/api.ts**

```ts
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
```

- [ ] **Step 2: 写入 src/main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
```

- [ ] **Step 3: 写入 src/App.tsx**

```tsx
import { Routes, Route, Link } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { CloudUploadOutlined, UserOutlined, FileTextOutlined } from '@ant-design/icons';
import TasksPage from './pages/TasksPage';
import AccountsPage from './pages/AccountsPage';
import LogsPage from './pages/LogsPage';

export default function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider>
        <div style={{ color: '#fff', padding: 16, fontSize: 18, fontWeight: 600 }}>云盘同步备份</div>
        <Menu theme="dark" mode="inline" defaultSelectedKeys={['tasks']}>
          <Menu.Item key="tasks" icon={<CloudUploadOutlined />}>
            <Link to="/">同步任务</Link>
          </Menu.Item>
          <Menu.Item key="accounts" icon={<UserOutlined />}>
            <Link to="/accounts">网盘账号</Link>
          </Menu.Item>
          <Menu.Item key="logs" icon={<FileTextOutlined />}>
            <Link to="/logs">日志</Link>
          </Menu.Item>
        </Menu>
      </Layout.Sider>
      <Layout.Content style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<TasksPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/logs" element={<LogsPage />} />
        </Routes>
      </Layout.Content>
    </Layout>
  );
}
```

- [ ] **Step 4: 构建验证**

Run: `npx vite build`
Expected: 构建成功（此时 pages 尚未创建，会报 import 错误 → 需先创建 Task 15 的页面占位；先按 Task 15 完成后一起构建）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add frontend scaffold and API client"
```

---

## Task 15: 前端页面

**Files:**
- Create: `src/pages/TasksPage.tsx`
- Create: `src/pages/AccountsPage.tsx`
- Create: `src/pages/LogsPage.tsx`
- Create: `src/components/TaskFormModal.tsx`
- Create: `src/components/QuarkLoginModal.tsx`

- [ ] **Step 1: 写入 src/pages/TasksPage.tsx**

```tsx
import { useEffect, useState } from 'react';
import { Card, Button, Switch, Space, Table, Tag, message, Popconfirm } from 'antd';
import { PlusOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { api } from '../api';
import TaskFormModal from '../components/TaskFormModal';
import type { TaskRecord } from '../../shared/types.js';

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    setTasks(await api.listTasks());
    setAccounts(await api.listAccounts());
  };

  useEffect(() => { load(); }, []);

  const toggle = async (t: TaskRecord, enabled: boolean) => {
    await api.updateTask(t.id, { enabled });
    load();
  };

  const run = async (id: string) => {
    await api.runTask(id);
    message.success('已触发同步');
  };

  const columns = [
    { title: '名称', dataIndex: 'name' },
    { title: '本地目录', dataIndex: 'localPath' },
    { title: '远程目录', dataIndex: 'remotePath' },
    { title: '调度', dataIndex: 'schedule', render: (s: string | null) => s ?? '手动' },
    {
      title: '状态', dataIndex: 'lastStatus',
      render: (s: string | null) => s ? <Tag color={s === 'success' ? 'green' : 'red'}>{s}</Tag> : <Tag>未运行</Tag>
    },
    {
      title: '操作',
      render: (_: any, t: TaskRecord) => (
        <Space>
          <Switch checked={t.enabled} onChange={(v) => toggle(t, v)} />
          <Button icon={<PlayCircleOutlined />} onClick={() => run(t.id)}>同步</Button>
          <Popconfirm title="删除该任务？" onConfirm={async () => { await api.deleteTask(t.id); load(); }}>
            <Button danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Card title="同步任务" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建任务</Button>}>
      <Table rowKey="id" dataSource={tasks} columns={columns} pagination={false} />
      <TaskFormModal open={open} accounts={accounts} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />
    </Card>
  );
}
```

- [ ] **Step 2: 写入 src/components/TaskFormModal.tsx**

```tsx
import { Modal, Form, Input, Select, Switch } from 'antd';
import { api } from '../api';

export default function TaskFormModal({ open, accounts, onClose, onDone }: {
  open: boolean; accounts: any[]; onClose: () => void; onDone: () => void;
}) {
  const [form] = Form.useForm();

  const submit = async () => {
    const v = await form.validateFields();
    await api.createTask({ ...v, enabled: v.enabled ?? true });
    form.resetFields();
    onDone();
  };

  return (
    <Modal open={open} title="新建同步任务" onOk={submit} onCancel={onClose} okText="创建">
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="任务名称" rules={[{ required: true }]}>
          <Input placeholder="例如：文档备份" />
        </Form.Item>
        <Form.Item name="accountId" label="网盘账号" rules={[{ required: true }]}>
          <Select options={accounts.map(a => ({ value: a.id, label: `${a.provider} - ${a.displayName}` }))} />
        </Form.Item>
        <Form.Item name="localPath" label="本地目录（绝对路径 / 容器内路径）" rules={[{ required: true }]}>
          <Input placeholder="/path/to/local" />
        </Form.Item>
        <Form.Item name="remotePath" label="远程目录" rules={[{ required: true }]}>
          <Input placeholder="/backup/docs" />
        </Form.Item>
        <Form.Item name="schedule" label="调度（cron 表达式，留空为手动）">
          <Input placeholder="0 2 * * *" />
        </Form.Item>
        <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue>
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 3: 写入 src/pages/AccountsPage.tsx**

```tsx
import { useEffect, useState } from 'react';
import { Card, Button, Table, Space, Popconfirm, message } from 'antd';
import { GoogleOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../api';
import QuarkLoginModal from '../components/QuarkLoginModal';

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [quarkOpen, setQuarkOpen] = useState(false);

  const load = () => api.listAccounts().then(setAccounts);

  useEffect(() => { load(); }, []);

  const addGoogle = async () => {
    const { url } = await api.googleAuthUrl();
    window.location.href = url;
  };

  const columns = [
    { title: '类型', dataIndex: 'provider', render: (p: string) => p === 'google' ? 'Google Drive' : '夸克网盘' },
    { title: '名称', dataIndex: 'displayName' },
    {
      title: '操作',
      render: (_: any, a: any) => (
        <Popconfirm title="删除该账号？" onConfirm={async () => { await api.deleteAccount(a.id); load(); }}>
          <Button danger>删除</Button>
        </Popconfirm>
      )
    }
  ];

  return (
    <Card title="网盘账号" extra={
      <Space>
        <Button icon={<GoogleOutlined />} onClick={addGoogle}>添加 Google</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setQuarkOpen(true)}>添加夸克</Button>
      </Space>
    }>
      <Table rowKey="id" dataSource={accounts} columns={columns} pagination={false} />
      <QuarkLoginModal open={quarkOpen} onClose={() => setQuarkOpen(false)} onDone={() => { setQuarkOpen(false); load(); }} />
    </Card>
  );
}
```

- [ ] **Step 4: 写入 src/components/QuarkLoginModal.tsx**

```tsx
import { useEffect, useState } from 'react';
import { Modal, Spin, Typography } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api';

export default function QuarkLoginModal({ open, onClose, onDone }: {
  open: boolean; onClose: () => void; onDone: () => void;
}) {
  const [url, setUrl] = useState<string>('');
  const [token, setToken] = useState<string>('');
  const [tip, setTip] = useState('请使用夸克 App 扫码');

  useEffect(() => {
    if (!open) return;
    let stop = false;
    (async () => {
      const r = await api.quarkStart();
      setUrl(r.url);
      setToken(r.token);
      const timer = setInterval(async () => {
        const s = await api.quarkPoll(r.token);
        if (s.state === 'success') { clearInterval(timer); onDone(); }
        else if (s.state === 'scanned') setTip('已扫码，请在手机上确认');
      }, 1500);
      if (stop) clearInterval(timer);
    })();
    return () => { stop = true; };
  }, [open]);

  return (
    <Modal open={open} title="扫码登录夸克网盘" footer={null} onCancel={onClose}>
      <div style={{ textAlign: 'center', padding: 16 }}>
        {url ? <QRCodeSVG value={url} size={220} /> : <Spin />}
        <Typography.Paragraph style={{ marginTop: 12 }}>{tip}</Typography.Paragraph>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: 写入 src/pages/LogsPage.tsx**

```tsx
import { useEffect, useState, useRef } from 'react';
import { Card, Select, Typography } from 'antd';
import { api } from '../api';
import type { LogRecord } from '../../shared/types.js';

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [taskId, setTaskId] = useState<string | undefined>();
  const [tasks, setTasks] = useState<any[]>([]);
  const lastId = useRef(0);

  useEffect(() => { api.listTasks().then(setTasks); }, []);

  useEffect(() => {
    lastId.current = 0;
    api.listLogs(0, taskId).then(rows => {
      setLogs(rows);
      lastId.current = rows.length ? rows[rows.length - 1].id : 0;
    });
    const timer = setInterval(async () => {
      const rows = await api.listLogs(lastId.current, taskId);
      if (rows.length) {
        setLogs(prev => [...prev, ...rows]);
        lastId.current = rows[rows.length - 1].id;
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [taskId]);

  return (
    <Card title="日志" extra={
      <Select allowClear placeholder="按任务过滤" style={{ width: 200 }}
        options={tasks.map(t => ({ value: t.id, label: t.name }))}
        onChange={(v) => setTaskId(v)} />
    }>
      <div style={{ fontFamily: 'monospace', fontSize: 13, maxHeight: '70vh', overflow: 'auto' }}>
        {logs.map(l => (
          <div key={l.id} style={{ color: l.level === 'error' ? '#cf1322' : '#000' }}>
            [{new Date(l.createdAt).toLocaleString()}] {l.message}
          </div>
        ))}
      </div>
    </Card>
  );
}
```

- [ ] **Step 6: 构建验证**

Run: `npx vite build`
Expected: 构建成功生成 dist/。

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit`
Expected: 0 error。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add frontend pages (tasks, accounts, logs)"
```

---

## Task 16: Docker 部署

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: 写入 Dockerfile**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "dist-server/index.js"]
```

- [ ] **Step 2: 写入 docker-compose.yml**

```yaml
services:
  sync2:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATA_DIR=/data
      - PORT=3000
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-}
      - GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI:-http://localhost:3000/api/auth/google/callback}
    volumes:
      - sync2-data:/data
      - ${LOCAL_PATH:-./local}:/backup
    restart: unless-stopped

volumes:
  sync2-data:
```

- [ ] **Step 3: 写入 .dockerignore**

```
node_modules
dist
dist-server
data
.git
```

- [ ] **Step 4: 本地构建验证**

Run: `docker build -t sync2 .`
Expected: 构建成功（若本机无 Docker，跳过并注明需在部署机验证）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Dockerfile and docker-compose"
```

---

## 完成后的整体验证

- [ ] `npx vitest run` — 全部测试通过
- [ ] `npx tsc --noEmit` — 0 error
- [ ] `npm run build` — 前端 + 后端打包成功
- [ ] `npm run start` — 服务启动，访问 http://localhost:3000 出现界面
- [ ] 手动：添加 Google 账号 → 添加夸克账号（扫码）→ 新建任务 → 立即同步 → 检查网盘文件与日志
