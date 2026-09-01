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
  for (const [rel, e] of remoteEntries) {
    remoteRefs.set(rel, { id: e.id, size: e.size, hash: e.hash });
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
