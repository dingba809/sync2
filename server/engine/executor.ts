import type { DriveProvider, RemoteEntry } from '../../shared/types.js';
import { scanDirectory } from './scanner.js';
import { planSync } from './planner.js';
import { statSync } from 'node:fs';
import { join, posix } from 'node:path';

export interface SnapshotStore {
  list(targetId: string): Map<string, { size: number; mtime: number; hash: string | null; remoteId: string }>;
  upsert(targetId: string, relPath: string, s: { size: number; mtime: number; hash: string | null; remoteId: string }): void;
  remove(targetId: string, relPath: string): void;
}

export interface RunResult {
  uploadedCount: number;
  failedUploadCount: number;
  deletedCount: number;
  error: string | null;
  stopped: boolean;
}

export interface ProgressInfo {
  currentFile: string | null;
  uploadedCount: number;
  failedUploadCount: number;
  activeUploadCount: number;
  pendingUploadCount: number;
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
  waitForResume?: () => Promise<boolean>;
  uploadConcurrency?: number;
}): Promise<RunResult> {
  const { targetId, localPath, remotePath, provider, snapshots, onLog, onProgress, waitForResume, uploadConcurrency = 1 } = opts;

  const st = statSync(localPath);
  if (!st.isDirectory()) throw new Error(`本地目录不存在或不是目录: ${localPath}`);

  const scanStartedAt = Date.now();
  const localFiles = scanDirectory(localPath);
  onLog('info', `本地扫描完成：${localFiles.size} 个文件，耗时 ${Date.now() - scanStartedAt}ms`);
  const snapshotMap = snapshots.list(targetId);

  const remoteStartedAt = Date.now();
  const rootId = await resolveRemoteRoot(provider, remotePath);
  const remoteEntries = snapshotMap.size === 0 ? await listRemoteRecursive(provider, rootId) : new Map<string, RemoteEntry>();
  onLog('info', snapshotMap.size === 0
    ? `远端核对完成：${remoteEntries.size} 个文件，耗时 ${Date.now() - remoteStartedAt}ms`
    : `使用本地快照增量同步，跳过远端完整核对`);
  const remoteRefs = new Map<string, { id: string; size: number; hash?: string }>();
  for (const [rel, e] of remoteEntries) {
    remoteRefs.set(rel, { id: e.id, size: e.size, hash: e.hash });
  }

  const plan = planSync(localFiles, snapshotMap, remoteRefs);

  let uploadedCount = 0;
  let failedUploadCount = 0;
  let deletedCount = 0;
  let error: string | null = null;
  let currentFile: string | null = null;
  let activeUploadCount = 0;
  let pendingUploadCount = 0;

  const totalUpload = plan.toUpload.length;
  const totalDelete = plan.toDelete.length;
  const report = () => onProgress?.({ currentFile, uploadedCount, failedUploadCount, activeUploadCount, pendingUploadCount, totalUpload, deletedCount, totalDelete });
  report();

  const folderCache = new Map<string, Promise<string>>();
  folderCache.set('', Promise.resolve(rootId));

  async function folderFor(dir: string): Promise<string> {
    if (!dir || dir === '.') return rootId;
    const cached = folderCache.get(dir);
    if (cached) return cached;
    const parentDir = posix.dirname(dir);
    const promise = folderFor(parentDir === '.' ? '' : parentDir)
      .then(parentId => provider.ensureFolder(parentId, posix.basename(dir)));
    folderCache.set(dir, promise);
    return promise;
  }

  function parentFor(relPath: string): Promise<string> {
    const dir = posix.dirname(relPath);
    return folderFor(dir === '.' ? '' : dir);
  }

  let stopped = false;
  pendingUploadCount = plan.toUpload.length;
  const uploadOne = async (relPath: string): Promise<void> => {
    currentFile = relPath;
    activeUploadCount++;
    pendingUploadCount--;
    report();
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
    } catch (e) {
      error = (e as Error).message;
      failedUploadCount++;
      onLog('error', `上传失败 ${relPath}: ${error}`);
    } finally {
      activeUploadCount--;
      report();
    }
  };

  let nextUpload = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(6, uploadConcurrency, plan.toUpload.length || 1)) }, async () => {
    while (!stopped) {
      if (waitForResume && !await waitForResume()) { stopped = true; return; }
      const relPath = plan.toUpload[nextUpload++];
      if (!relPath) return;
      await uploadOne(relPath);
    }
  });
  await Promise.all(workers);
  if (stopped) return { uploadedCount, failedUploadCount, deletedCount, error, stopped: true };

  for (const del of plan.toDelete) {
    if (waitForResume && !await waitForResume()) return { uploadedCount, failedUploadCount, deletedCount, error, stopped: true };
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

  return { uploadedCount, failedUploadCount, deletedCount, error, stopped: false };
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
