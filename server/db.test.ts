import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, insertTask, getTask, listTasks, deleteTask, upsertSnapshot, listSnapshots, insertAccount, getAccount, insertTarget, listTargets, insertRun, listRuns } from './db.js';
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
    const id = insertTask(db, { name: 't', localPath: '/l', schedule: null, enabled: true });
    const t = getTask(db, id)!;
    expect(t.name).toBe('t');
    expect(t.enabled).toBe(true);
  });

  it('lists tasks and honors enabled flag', () => {
    insertTask(db, { name: 'a', localPath: '/l', schedule: null, enabled: true });
    insertTask(db, { name: 'b', localPath: '/l', schedule: null, enabled: false });
    const tasks = listTasks(db);
    expect(tasks.length).toBe(2);
    expect(tasks.find(t => t.name === 'b')!.enabled).toBe(false);
    expect(tasks.find(t => t.name === 'a')!.enabled).toBe(true);
  });

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

  it('stores and reads account', () => {
    const id = insertAccount(db, { provider: 'google', displayName: 'me', credential: 'enc' });
    const a = getAccount(db, id)!;
    expect(a.provider).toBe('google');
    expect(a.credential).toBe('enc');
  });

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
    insertRun(db, id, tid);
    const runs = listRuns(db, id);
    expect(runs.length).toBe(1);
    expect(runs[0].targetId).toBe(tid);
  });
});
