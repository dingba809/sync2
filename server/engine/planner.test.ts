import { describe, it, expect } from 'vitest';
import { planSync, LocalFileInfo, SnapshotEntry, RemoteRef } from './planner.js';

const lf = (size: number, mtime: number): LocalFileInfo => ({ size, mtime });
const snap = (size: number, mtime: number, hash: string | null, remoteId: string): SnapshotEntry =>
  ({ size, mtime, hash, remoteId });
const remote = (size: number, hash?: string, id = 'rid'): RemoteRef => ({ id, size, hash });

describe('planSync', () => {
  it('uploads new local file (no snapshot, no remote)', () => {
    const p = planSync(new Map([['a.txt', lf(1, 1)]]), new Map(), new Map());
    expect(p.toUpload).toEqual(['a.txt']);
    expect(p.toDelete).toEqual([]);
  });

  it('uploads changed file (size differs)', () => {
    const p = planSync(
      new Map([['a.txt', lf(10, 1)]]),
      new Map([['a.txt', snap(5, 1, 'h', 'rid')]]),
      new Map([['a.txt', remote(5, 'h')]])
    );
    expect(p.toUpload).toEqual(['a.txt']);
    expect(p.toDelete).toEqual([]);
  });

  it('uploads changed file (mtime differs)', () => {
    const p = planSync(
      new Map([['a.txt', lf(5, 2)]]),
      new Map([['a.txt', snap(5, 1, 'h', 'rid')]]),
      new Map([['a.txt', remote(5, 'h')]])
    );
    expect(p.toUpload).toEqual(['a.txt']);
  });

  it('skips unchanged file present remotely', () => {
    const p = planSync(
      new Map([['a.txt', lf(5, 1)]]),
      new Map([['a.txt', snap(5, 1, 'h', 'rid')]]),
      new Map([['a.txt', remote(5, 'h')]])
    );
    expect(p.toUpload).toEqual([]);
    expect(p.toDelete).toEqual([]);
  });

  it('re-uploads unchanged file if remote was deleted', () => {
    const p = planSync(
      new Map([['a.txt', lf(5, 1)]]),
      new Map([['a.txt', snap(5, 1, 'h', 'rid')]]),
      new Map()
    );
    expect(p.toUpload).toEqual(['a.txt']);
  });

  it('deletes remote when local file removed (has snapshot)', () => {
    const p = planSync(
      new Map(),
      new Map([['a.txt', snap(5, 1, 'h', 'rid')]]),
      new Map([['a.txt', remote(5, 'h')]])
    );
    expect(p.toDelete).toEqual([{ relPath: 'a.txt', remoteId: 'rid' }]);
  });

  it('deletes remote when local file removed (no snapshot, remote exists)', () => {
    const p = planSync(
      new Map(),
      new Map(),
      new Map([['a.txt', remote(5, 'h', 'remote-id')]])
    );
    expect(p.toDelete).toEqual([{ relPath: 'a.txt', remoteId: 'remote-id' }]);
  });

  it('uploads local file that exists remotely but has no snapshot (conservative)', () => {
    const p = planSync(
      new Map([['a.txt', lf(5, 1)]]),
      new Map(),
      new Map([['a.txt', remote(5, 'h')]])
    );
    expect(p.toUpload).toEqual(['a.txt']);
  });
});
