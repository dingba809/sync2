import { describe, it, expect, vi } from 'vitest';
import { runSync } from './executor.js';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
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
  const pending = new Map<string, { remoteId: string; relPath: string }>();
  return {
    list: () => map,
    upsert: (_t: string, rel: string, s: any) => map.set(rel, s),
    remove: (_t: string, rel: string) => { map.delete(rel); },
    queueRemoteDelete: (_t: string, remoteId: string, relPath: string) => pending.set(remoteId, { remoteId, relPath }),
    listPendingRemoteDeletes: () => [...pending.values()],
    completeRemoteDelete: (_t: string, remoteId: string) => { pending.delete(remoteId); }
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
    snap.upsert('t', 'old.txt', { size: 4, mtime: 1, contentMd5: null, contentSha1: null, remoteId: 'old-id' });

    const result = await runSync({
      targetId: 't', localPath: dir, remotePath: '/r',
      provider: fakeProvider(remote), snapshots: snap,
      onLog: () => {}
    });

    expect(result.uploadedCount).toBe(1);
    expect(result.deletedCount).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('stops before starting the next file operation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exec-'));
    writeFileSync(join(dir, 'new.txt'), 'hello');
    const remote = new Map<string, RemoteEntry>();

    const result = await runSync({
      targetId: 't', localPath: dir, remotePath: '/r',
      provider: fakeProvider(remote), snapshots: snapshots(),
      onLog: () => {},
      waitForResume: async () => false
    });

    expect(result).toMatchObject({ uploadedCount: 0, deletedCount: 0, stopped: true });
    expect(remote.size).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('limits concurrent file uploads to the configured worker count', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exec-'));
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `file-${i}.txt`), 'hello');
    let active = 0;
    let maxActive = 0;
    const provider = fakeProvider(new Map());
    provider.uploadFile = async (_local, _parent, name) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active--;
      return { id: name, name, isDir: false, size: 5, mtime: 1 };
    };

    const result = await runSync({
      targetId: 't', localPath: dir, remotePath: '/r', provider, snapshots: snapshots(), onLog: () => {}, uploadConcurrency: 3
    });

    expect(result.uploadedCount).toBe(5);
    expect(maxActive).toBe(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips the remote inventory when snapshots already exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exec-'));
    writeFileSync(join(dir, 'unchanged.txt'), 'hello');
    const snap = snapshots();
    snap.upsert('t', 'unchanged.txt', { size: 5, mtime: Math.floor(statSync(join(dir, 'unchanged.txt')).mtimeMs), contentMd5: null, contentSha1: null, remoteId: 'id' });
    const provider = fakeProvider(new Map());
    const listFolder = vi.spyOn(provider, 'listFolder');

    const result = await runSync({ targetId: 't', localPath: dir, remotePath: '/r', provider, snapshots: snap, onLog: () => {} });

    expect(listFolder).not.toHaveBeenCalled();
    expect(result.uploadedCount).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('claims same-content remote files during the first safe merge', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exec-'));
    writeFileSync(join(dir, 'same.txt'), 'hello');
    const remote = new Map<string, RemoteEntry>([
      ['same.txt', { id: 'remote-id', name: 'same.txt', isDir: false, size: 5, mtime: 1, hash: 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d', hashAlgorithm: 'sha1' }]
    ]);
    const provider = fakeProvider(remote);
    const upload = vi.spyOn(provider, 'uploadFile');
    const snap = snapshots();

    const result = await runSync({ targetId: 't', localPath: dir, remotePath: '/r', provider, snapshots: snap, onLog: () => {} });

    expect(result.uploadedCount).toBe(0);
    expect(upload).not.toHaveBeenCalled();
    expect(snap.list().get('same.txt')).toMatchObject({ remoteId: 'remote-id' });
    rmSync(dir, { recursive: true, force: true });
  });
});
