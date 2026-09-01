import { describe, it, expect, vi, afterEach } from 'vitest';
import { QuarkProvider } from './quark.js';

function mockCookies(): any { return { getCookies: () => ({ __uid: 'u' }) }; }

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
    const p = new QuarkProvider(mockCookies());
    const list = await p.listFolder('0');
    expect(list).toHaveLength(2);
    expect(list[0].isDir).toBe(false);
    expect(list[1].isDir).toBe(true);
  });

  it('ensureFolder returns existing dir fid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({
      list: [{ fid: 'd1', file_name: 'sub', dir: true, size: '0', updated_at: 1 }]
    }));
    const p = new QuarkProvider(mockCookies());
    expect(await p.ensureFolder('0', 'sub')).toBe('d1');
  });

  it('deleteEntry posts action_type 2', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ task_id: 't' }));
    const p = new QuarkProvider(mockCookies());
    await p.deleteEntry('fid');
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.action_type).toBe(2);
    expect(body.filelist).toEqual(['fid']);
  });
});
