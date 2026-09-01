import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoogleDriveProvider } from './google.js';

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
});
