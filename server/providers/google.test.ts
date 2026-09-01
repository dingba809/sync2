import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoogleDriveProvider } from './google.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function mockAuth(token = 'tok'): any {
  return { getAccessToken: vi.fn().mockResolvedValue(token) };
}

afterEach(() => vi.restoreAllMocks());

describe('GoogleDriveProvider', () => {
  it('lists folder entries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      files: [
        { id: '1', name: 'a.txt', mimeType: 'text/plain', size: '5', modifiedTime: '2024-01-01T00:00:00.000Z', md5Checksum: 'h' },
        { id: '2', name: 'sub', mimeType: 'application/vnd.google-apps.folder', size: '0', modifiedTime: '2024-01-01T00:00:00.000Z' }
      ]
    }), { status: 200 }));
    const p = new GoogleDriveProvider(mockAuth());
    const list = await p.listFolder('root');
    expect(list).toHaveLength(2);
    expect(list[0].isDir).toBe(false);
    expect(list[1].isDir).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('root');
  });

  it('ensureFolder returns existing folder id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      files: [{ id: 'fid', name: 'sub', mimeType: 'application/vnd.google-apps.folder', size: '0', modifiedTime: '2024-01-01T00:00:00.000Z' }]
    }), { status: 200 }));
    const p = new GoogleDriveProvider(mockAuth());
    expect(await p.ensureFolder('parent', 'sub')).toBe('fid');
  });

  it('ensureFolder creates when missing', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'newid' }), { status: 200 }));
    const p = new GoogleDriveProvider(mockAuth());
    expect(await p.ensureFolder('parent', 'sub')).toBe('newid');
  });

  it('uploadFile returns entry with name and hash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gup-'));
    const filePath = join(dir, 'a.txt');
    writeFileSync(filePath, 'hello');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'nid', name: 'a.txt', size: '5', modifiedTime: '2024-01-01T00:00:00.000Z', md5Checksum: 'abc'
      }), { status: 200 }));
    const p = new GoogleDriveProvider(mockAuth());
    const entry = await p.uploadFile(filePath, 'parent', 'a.txt');
    expect(entry.name).toBe('a.txt');
    expect(entry.hash).toBe('abc');
    expect(entry.isDir).toBe(false);
    expect(entry.mtime).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
