import { RemoteFileNotFoundError, type AuditAction, type AuditRecord, type DriveProvider, type FileDigests, type RemoteEntry } from '../../shared/types.js';
import { scanDirectory } from './scanner.js';
import { planSync, type SnapshotEntry } from './planner.js';
import { fileDigests } from './hashes.js';
import { statSync } from 'node:fs';
import { join, posix } from 'node:path';

export interface SnapshotStore {
  list(targetId: string): Map<string, SnapshotEntry>;
  upsert(targetId: string, relPath: string, s: SnapshotEntry): void;
  remove(targetId: string, relPath: string): void;
  queueRemoteDelete(targetId: string, remoteId: string, relPath: string): void;
  listPendingRemoteDeletes(targetId: string): { remoteId: string; relPath: string }[];
  completeRemoteDelete(targetId: string, remoteId: string): void;
}

export interface RunResult {
  uploadedCount: number; failedUploadCount: number; deletedCount: number; error: string | null; stopped: boolean;
}

export interface ProgressInfo {
  currentFile: string | null; uploadedCount: number; failedUploadCount: number; activeUploadCount: number;
  pendingUploadCount: number; totalUpload: number; deletedCount: number; totalDelete: number;
}

interface RemoteInventory {
  files: Map<string, RemoteEntry[]>;
  directories: Set<string>;
}

export interface RetryPaths {
  uploadPaths: string[];
  deletePaths: string[];
}

export async function runSync(opts: {
  runId?: string; taskId?: string; targetId: string; localPath: string; remotePath: string; provider: DriveProvider; snapshots: SnapshotStore;
  onLog: (level: 'info' | 'error', msg: string) => void; onProgress?: (p: ProgressInfo) => void;
  onAudit?: (records: Omit<AuditRecord, 'id' | 'createdAt'>[]) => void; retryPaths?: RetryPaths; waitForResume?: () => Promise<boolean>; uploadConcurrency?: number;
}): Promise<RunResult> {
  const { runId: suppliedRunId, taskId: suppliedTaskId, targetId, localPath, remotePath, provider, snapshots, onLog, onProgress, onAudit, retryPaths, waitForResume, uploadConcurrency = 1 } = opts;
  const runId = suppliedRunId ?? targetId;
  const taskId = suppliedTaskId ?? targetId;
  if (!statSync(localPath).isDirectory()) throw new Error(`本地目录不存在或不是目录: ${localPath}`);

  const scanStartedAt = Date.now();
  const localFiles = scanDirectory(localPath);
  onLog('info', `本地扫描完成：${localFiles.size} 个文件，耗时 ${Date.now() - scanStartedAt}ms`);
  const snapshotMap = snapshots.list(targetId);
  const isInitialSync = snapshotMap.size === 0 && !retryPaths;
  const rootId = await resolveRemoteRoot(provider, remotePath);
  const remoteStartedAt = Date.now();
  const remoteInventory = isInitialSync ? await listRemoteRecursive(provider, rootId) : { files: new Map(), directories: new Set() };
  onLog('info', isInitialSync
    ? `首次安全核对远端完成：${[...remoteInventory.files.values()].flat().length} 个文件，耗时 ${Date.now() - remoteStartedAt}ms`
    : '使用本地快照增量同步，跳过远端完整核对');

  const defaultPlan = planSync(localFiles, snapshotMap);
  const plan = retryPaths ? {
    toProcess: [...new Set(retryPaths.uploadPaths)].filter(path => localFiles.has(path)),
    toDelete: [...new Set(retryPaths.deletePaths)].flatMap(relPath => {
      const snapshot = snapshotMap.get(relPath);
      return snapshot ? [{ relPath, remoteId: snapshot.remoteId }] : [];
    })
  } : defaultPlan;
  const auditBuffer: Omit<AuditRecord, 'id' | 'createdAt'>[] = [];
  const audit = (relPath: string, action: AuditAction, detail: string | null = null) => {
    auditBuffer.push({ runId, taskId, targetId, relPath, action, detail });
    if (auditBuffer.length >= 100) flushAudit();
  };
  const flushAudit = () => {
    if (auditBuffer.length === 0) return;
    onAudit?.(auditBuffer.splice(0));
  };
  const metadataSkipped = localFiles.size - plan.toProcess.length;
  if (!retryPaths) {
    if (metadataSkipped > 0) onLog('info', `元数据跳过 ${metadataSkipped} 个未变化文件`);
    for (const [relPath, local] of localFiles) {
      const snapshot = snapshotMap.get(relPath);
      if (snapshot && snapshot.size === local.size && snapshot.mtime === local.mtime) audit(relPath, 'metadata_skipped');
    }
  } else {
    onLog('info', `仅重试失败文件：上传 ${plan.toProcess.length} 个，删除 ${plan.toDelete.length} 个`);
  }
  let uploadedCount = 0;
  let failedUploadCount = 0;
  let deletedCount = 0;
  let error: string | null = null;
  let currentFile: string | null = null;
  let activeUploadCount = 0;
  let pendingUploadCount = plan.toProcess.length;
  const totalUpload = plan.toProcess.length;
  const totalDelete = plan.toDelete.length;
  const report = () => onProgress?.({ currentFile, uploadedCount, failedUploadCount, activeUploadCount, pendingUploadCount, totalUpload, deletedCount, totalDelete });
  report();

  const folderCache = new Map<string, Promise<string>>([['', Promise.resolve(rootId)]]);
  const folderFor = (dir: string): Promise<string> => {
    if (!dir || dir === '.') return Promise.resolve(rootId);
    const cached = folderCache.get(dir);
    if (cached) return cached;
    const parentDir = posix.dirname(dir);
    const promise = folderFor(parentDir === '.' ? '' : parentDir).then(parentId => provider.ensureFolder(parentId, posix.basename(dir)));
    folderCache.set(dir, promise);
    return promise;
  };
  const parentFor = (relPath: string) => {
    const dir = posix.dirname(relPath);
    return folderFor(dir === '.' ? '' : dir);
  };

  for (const pending of snapshots.listPendingRemoteDeletes(targetId)) {
    try {
      await withRetry(() => provider.deleteEntry(pending.remoteId));
      snapshots.completeRemoteDelete(targetId, pending.remoteId);
      onLog('info', `已清理旧远端文件：${pending.relPath}`);
      audit(pending.relPath, 'cleanup_deleted');
    } catch (e) {
      error = (e as Error).message;
      onLog('error', `清理旧远端文件失败 ${pending.relPath}: ${error}`);
      audit(pending.relPath, 'cleanup_failed', error);
    }
  }

  const writeSnapshot = (relPath: string, local: { size: number; mtime: number }, digests: FileDigests, remoteId: string) => {
    snapshots.upsert(targetId, relPath, {
      size: local.size, mtime: local.mtime, contentMd5: digests.md5, contentSha1: digests.sha1, remoteId
    });
  };
  const replace = async (relPath: string, local: { size: number; mtime: number }, digests: FileDigests, oldRemoteId?: string) => {
    const parentId = await parentFor(relPath);
    const name = posix.basename(relPath);
    let entry: RemoteEntry;
    if (oldRemoteId && provider.replaceFile) {
      try {
        entry = await withRetry(() => provider.replaceFile!(oldRemoteId, join(localPath, relPath), name, { digests }));
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundError)) throw e;
        onLog('info', `远端旧文件不存在，改为新建上传 ${relPath}`);
        entry = await withRetry(() => provider.uploadFile(join(localPath, relPath), parentId, name, { digests }));
      }
    } else {
      entry = await withRetry(() => provider.uploadFile(join(localPath, relPath), parentId, name, { digests }));
    }
    writeSnapshot(relPath, local, digests, entry.id);
    if (oldRemoteId && oldRemoteId !== entry.id && !provider.replaceFile) {
      snapshots.queueRemoteDelete(targetId, oldRemoteId, relPath);
      try {
        await withRetry(() => provider.deleteEntry(oldRemoteId));
        snapshots.completeRemoteDelete(targetId, oldRemoteId);
      } catch (e) {
        error = (e as Error).message;
        onLog('error', `新版本已上传，旧文件待后续清理 ${relPath}: ${error}`);
      }
    }
  };

  let stopped = false;
  const processOne = async (relPath: string): Promise<void> => {
    currentFile = relPath;
    activeUploadCount++;
    pendingUploadCount--;
    report();
    try {
      const local = localFiles.get(relPath)!;
      const snapshot = snapshotMap.get(relPath);
      const remoteMatches = isInitialSync ? remoteInventory.files.get(relPath) ?? [] : [];
      if (isInitialSync && (remoteInventory.directories.has(relPath) || hasRemoteFileAncestor(relPath, remoteInventory.files))) {
        error = `远端文件与目录层级不兼容: ${relPath}`;
        failedUploadCount++;
        onLog('error', `冲突跳过 ${relPath}：${error}，请先手动处理`);
        audit(relPath, 'conflict', error);
        return;
      }
      if (remoteMatches.length > 1) {
        error = `远端存在多个同路径文件: ${relPath}`;
        failedUploadCount++;
        onLog('error', `冲突跳过 ${relPath}：${error}，请先手动处理`);
        audit(relPath, 'conflict', error);
        return;
      }
      const digests = await fileDigests(join(localPath, relPath));
      if (snapshot && snapshot.contentSha1 === digests.sha1) {
        writeSnapshot(relPath, local, digests, snapshot.remoteId);
        onLog('info', `哈希验证跳过 ${relPath}`);
        audit(relPath, 'hash_skipped');
        return;
      }
      const existing = remoteMatches[0];
      if (!snapshot && existing && remoteHashMatches(existing, digests)) {
        writeSnapshot(relPath, local, digests, existing.id);
        onLog('info', `认领已有远端文件 ${relPath}`);
        audit(relPath, 'claimed');
        return;
      }
      await replace(relPath, local, digests, snapshot?.remoteId ?? existing?.id);
      uploadedCount++;
      onLog('info', `${snapshot || existing ? '上传替换' : '上传'} ${relPath}`);
      audit(relPath, snapshot || existing ? 'replaced' : 'uploaded');
    } catch (e) {
      error = (e as Error).message;
      failedUploadCount++;
      onLog('error', `上传失败 ${relPath}: ${error}`);
      audit(relPath, 'upload_failed', error);
    } finally {
      activeUploadCount--;
      report();
    }
  };

  let nextUpload = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(6, uploadConcurrency, plan.toProcess.length || 1)) }, async () => {
    while (!stopped) {
      if (waitForResume && !await waitForResume()) { stopped = true; return; }
      const relPath = plan.toProcess[nextUpload++];
      if (!relPath) return;
      await processOne(relPath);
    }
  });
  await Promise.all(workers);
  if (stopped) {
    flushAudit();
    return { uploadedCount, failedUploadCount, deletedCount, error, stopped: true };
  }

  for (const del of plan.toDelete) {
    if (waitForResume && !await waitForResume()) return { uploadedCount, failedUploadCount, deletedCount, error, stopped: true };
    currentFile = del.relPath;
    try {
      await withRetry(() => provider.deleteEntry(del.remoteId));
      snapshots.remove(targetId, del.relPath);
      deletedCount++;
      onLog('info', `删除 ${del.relPath}`);
      audit(del.relPath, 'deleted');
    } catch (e) {
      error = (e as Error).message;
      onLog('error', `删除失败 ${del.relPath}: ${error}`);
      audit(del.relPath, 'delete_failed', error);
    }
    report();
  }
  flushAudit();
  return { uploadedCount, failedUploadCount, deletedCount, error, stopped: false };
}

function remoteHashMatches(remote: RemoteEntry, digests: FileDigests): boolean {
  if (!remote.hash) return false;
  return remote.hashAlgorithm === 'md5' ? remote.hash === digests.md5 : remote.hashAlgorithm === 'sha1' && remote.hash === digests.sha1;
}

async function withRetry<T>(fn: () => Promise<T>, times = 3): Promise<T> {
  let lastErr: Error | null = null;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e as Error;
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr!;
}

async function resolveRemoteRoot(provider: DriveProvider, remotePath: string): Promise<string> {
  let cur = provider.rootId;
  for (const part of remotePath.split('/').filter(Boolean)) cur = await provider.ensureFolder(cur, part);
  return cur;
}

function hasRemoteFileAncestor(relPath: string, files: Map<string, RemoteEntry[]>): boolean {
  let dir = posix.dirname(relPath);
  while (dir && dir !== '.') {
    if (files.has(dir)) return true;
    dir = posix.dirname(dir);
  }
  return false;
}

async function listRemoteRecursive(provider: DriveProvider, rootId: string): Promise<RemoteInventory> {
  const out: RemoteInventory = { files: new Map(), directories: new Set() };
  const walk = async (folderId: string, prefix: string): Promise<void> => {
    for (const entry of await provider.listFolder(folderId)) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDir) {
        out.directories.add(relPath);
        await walk(entry.id, relPath);
      } else out.files.set(relPath, [...(out.files.get(relPath) ?? []), entry]);
    }
  };
  await walk(rootId, '');
  return out;
}
