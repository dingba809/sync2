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
    const tasks = listTasks(db);
    expect(tasks.length).toBe(2);
    expect(tasks.find(t => t.name === 'b')!.enabled).toBe(false);
    expect(tasks.find(t => t.name === 'a')!.enabled).toBe(true);
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
