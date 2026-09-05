import { describe, it, expect } from 'vitest';
import { planSync, type LocalFileInfo, type SnapshotEntry } from './planner.js';

const local = (size: number, mtime: number): LocalFileInfo => ({ size, mtime });
const snapshot = (size: number, mtime: number, remoteId = 'rid'): SnapshotEntry =>
  ({ size, mtime, contentMd5: 'md5', contentSha1: 'sha1', remoteId });

describe('planSync', () => {
  it('does not process unchanged snapshot files', () => {
    const plan = planSync(new Map([['a.txt', local(5, 1)]]), new Map([['a.txt', snapshot(5, 1)]]));
    expect(plan.toProcess).toEqual([]);
  });

  it('processes new and metadata-changed local files', () => {
    const plan = planSync(
      new Map([['new.txt', local(1, 1)], ['changed.txt', local(5, 2)]]),
      new Map([['changed.txt', snapshot(5, 1)]])
    );
    expect(plan.toProcess).toEqual(['new.txt', 'changed.txt']);
  });

  it('deletes only files managed by the snapshot', () => {
    const plan = planSync(new Map(), new Map([['old.txt', snapshot(1, 1, 'old-id')]]));
    expect(plan.toDelete).toEqual([{ relPath: 'old.txt', remoteId: 'old-id' }]);
  });
});
