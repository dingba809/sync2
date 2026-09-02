import { describe, it, expect, vi, afterEach } from 'vitest';
import { QuarkProvider } from './quark.js';

function mockCookies(): any { return { getCookies: () => ({ __uid: 'u' }) }; }

function provider() { return new QuarkProvider(mockCookies(), 0); }

function okJson(data: unknown) {
  return new Response(JSON.stringify({ status: 200, code: 0, data }), { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

describe('QuarkProvider', () => {
  it('lists folder entries from file/sort', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({
      list: [
        { fid: '1', file_name: 'a.txt', dir: false, size: '5', updated_at: 1700000000 },
        { fid: '2', file_name: 'sub', dir: true, size: '0', updated_at: 1700000000 }
      ]
    }));
    const p = provider();
    const list = await p.listFolder('0');
    expect(list).toHaveLength(2);
    expect(list[0].isDir).toBe(false);
    expect(list[1].isDir).toBe(true);
  });

  it('ensureFolder returns existing dir fid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({
      list: [{ fid: 'd1', file_name: 'sub', dir: true, size: '0', updated_at: 1 }]
    }));
    const p = provider();
    expect(await p.ensureFolder('0', 'sub')).toBe('d1');
  });

  it('deleteEntry posts action_type 2', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ task_id: 't' }));
    const p = provider();
    await p.deleteEntry('fid');
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.action_type).toBe(2);
    expect(body.filelist).toEqual(['fid']);
  });

  it('loads every page when a folder has more than 1000 entries', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({ fid: String(i), file_name: `f-${i}`, dir: false }));
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ list: firstPage, total: 1001 }))
      .mockResolvedValueOnce(okJson({ list: [{ fid: '1000', file_name: 'last', dir: false }], total: 1001 }));

    const entries = await provider().listFolder('folder');

    expect(entries).toHaveLength(1001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('_page=2');
  });

  it('includes the OSS error code in a failed part upload', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ auth_key: 'signature' }))
      .mockResolvedValueOnce(new Response('<Error><Code>RequestTimeTooSkewed</Code><Message>clock skew</Message></Error>', { status: 400 }));

    await expect((provider() as any).upPart({
      bucket: 'bucket', obj_key: 'key', upload_id: 'upload', task_id: 'task', auth_info: 'auth'
    }, 'application/octet-stream', 1, Buffer.from('x'), 'https://bucket.example.com/key'))
      .rejects.toThrow('RequestTimeTooSkewed: clock skew');
  });

  it('retries a part while Quark creates its hash context', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ auth_key: 'first-signature' }))
      .mockResolvedValueOnce(new Response('<Error><Code>NoHashContext</Code></Error>', { status: 400 }))
      .mockResolvedValueOnce(okJson({ auth_key: 'second-signature' }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { etag: 'etag-1' } }));

    const etag = await (provider() as any).upPart({
      bucket: 'bucket', obj_key: 'key', upload_id: 'upload', task_id: 'task', auth_info: 'auth'
    }, 'application/octet-stream', 1, Buffer.from('x'), 'https://bucket.example.com/key');

    expect(etag).toBe('etag-1');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
