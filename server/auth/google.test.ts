import { describe, it, expect, vi, afterEach } from 'vitest';
import { googleAuthUrl, exchangeCodeForToken, refreshAccessToken } from './google.js';

const cfg: any = {
  googleClientId: 'cid', googleClientSecret: 'cs', googleRedirectUri: 'http://localhost/cb'
};

afterEach(() => vi.restoreAllMocks());

describe('google auth', () => {
  it('builds auth url with offline access', () => {
    const url = googleAuthUrl(cfg, 'st');
    expect(url).toContain('client_id=cid');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('state=st');
  });

  it('exchanges code for tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      access_token: 'at', refresh_token: 'rt', expires_in: 3600
    }), { status: 200 }));
    const t = await exchangeCodeForToken(cfg, 'code');
    expect(t.refresh_token).toBe('rt');
  });

  it('refreshes access token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ access_token: 'new' }), { status: 200 }));
    expect(await refreshAccessToken('cid', 'cs', 'rt')).toBe('new');
  });
});
