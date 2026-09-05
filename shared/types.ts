export type ProviderKind = 'google' | 'quark';

export interface RemoteEntry {
  id: string;
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
  hash?: string;
  hashAlgorithm?: 'md5' | 'sha1';
}

export interface FileDigests {
  md5: string;
  sha1: string;
}

export interface UploadOptions {
  digests?: FileDigests;
}

export class RemoteFileNotFoundError extends Error {
  constructor(fileId: string) {
    super(`Remote file not found: ${fileId}`);
    this.name = 'RemoteFileNotFoundError';
  }
}

export interface Quota {
  total: number;
  used: number;
}

export interface DriveProvider {
  readonly rootId: string;
  listFolder(folderId: string): Promise<RemoteEntry[]>;
  ensureFolder(parentId: string, name: string): Promise<string>;
  uploadFile(localPath: string, parentId: string, name: string, options?: UploadOptions): Promise<RemoteEntry>;
  replaceFile?(fileId: string, localPath: string, name: string, options?: UploadOptions): Promise<RemoteEntry>;
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
  localPath: string;
  schedule: string | null;
  enabled: boolean;
  runWindowEnabled: boolean;
  runWindowStart: string | null;
  runWindowEnd: string | null;
  lastStatus: string | null;
  lastCompletedAt: number | null;
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
  failedUploadCount: number;
  activeUploadCount: number;
  pendingUploadCount: number;
  totalUpload: number;
  deletedCount: number;
  totalDelete: number;
}

export interface TaskProgress {
  taskId: string;
  status: 'running' | 'success' | 'failed';
  targets: TargetProgress[];
}

export interface LogRecord {
  id: number;
  taskId: string | null;
  level: 'info' | 'error';
  message: string;
  createdAt: number;
}

export type AuditAction =
  | 'metadata_skipped' | 'hash_skipped' | 'claimed' | 'uploaded' | 'replaced'
  | 'deleted' | 'upload_failed' | 'delete_failed' | 'conflict' | 'cleanup_deleted' | 'cleanup_failed';

export interface AuditRecord {
  id: number;
  runId: string;
  taskId: string;
  targetId: string;
  relPath: string;
  action: AuditAction;
  detail: string | null;
  createdAt: number;
}
