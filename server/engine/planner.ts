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
