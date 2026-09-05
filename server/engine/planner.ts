export interface LocalFileInfo {
  size: number;
  mtime: number;
}

export interface SnapshotEntry {
  size: number;
  mtime: number;
  contentMd5: string | null;
  contentSha1: string | null;
  remoteId: string;
}

export interface SyncPlan {
  toProcess: string[];
  toDelete: { relPath: string; remoteId: string }[];
}

/**
 * The local snapshot is authoritative for incremental runs. A remote listing is
 * deliberately not part of this planner: treating an absent listing as a
 * missing remote file causes every unchanged file to be uploaded again.
 */
export function planSync(
  localFiles: Map<string, LocalFileInfo>,
  snapshots: Map<string, SnapshotEntry>
): SyncPlan {
  const toProcess: string[] = [];
  const toDelete: { relPath: string; remoteId: string }[] = [];

  for (const [relPath, local] of localFiles) {
    const snap = snapshots.get(relPath);
    if (!snap || snap.size !== local.size || snap.mtime !== local.mtime) toProcess.push(relPath);
  }

  for (const [relPath, snap] of snapshots) {
    if (!localFiles.has(relPath)) toDelete.push({ relPath, remoteId: snap.remoteId });
  }

  return { toProcess, toDelete };
}
