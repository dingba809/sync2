import { describe, it, expect, vi, afterEach } from 'vitest';
import { getQrcodeToken, pollQrcode } from './quark.js';

afterEach(() => vi.restoreAllMocks());

describe('quark auth', () => {
  it('gets qrcode token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 2000000, data: { members: { token: 'tk' } }
    }), { status: 200 }));
    const r = await getQrcodeToken();
    expect(r.token).toBe('tk');
    expect(r.url).toContain('tk');
  });

  it('polls pending when waiting scan', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 50004001, data: {}
    }), { status: 200 }));
    expect((await pollQrcode('tk')).state).toBe('pending');
  });

  it('polls success with service ticket', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 2000000, data: { members: { service_ticket: 'st' } }
    }), { status: 200 }));
    const r = await pollQrcode('tk');
    expect(r.state).toBe('success');
    expect(r.serviceTicket).toBe('st');
  });
});
