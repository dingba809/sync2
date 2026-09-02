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
      targetId: 't', localPath: dir, remotePath: '/r',
      provider: fakeProvider(remote), snapshots: snap,
      onLog: () => {}
    });

    expect(result.uploadedCount).toBe(1);
    expect(result.deletedCount).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
