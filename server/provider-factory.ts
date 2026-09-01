import type { DriveProvider, AccountCredential } from '../shared/types.js';
import type { Config } from './config.js';
import { GoogleDriveProvider } from './providers/google.js';
import { QuarkProvider } from './providers/quark.js';

export function createProvider(
  kind: 'google' | 'quark',
  credential: AccountCredential,
  cfg: Config
): DriveProvider {
  if (kind === 'google') {
    let cached: { token: string; expiresAt: number } | null = null;
    const cred = credential as { refreshToken: string; accessToken: string | null };
    const auth = {
      async getAccessToken(): Promise<string> {
        if (cached && cached.expiresAt > Date.now()) return cached.token;
        const { refreshAccessToken } = await import('./auth/google.js');
        const token = await refreshAccessToken(cfg.googleClientId, cfg.googleClientSecret, cred.refreshToken);
        cached = { token, expiresAt: Date.now() + 3000 * 1000 };
        return token;
      }
    };
    return new GoogleDriveProvider(auth);
  }
  const quarkCred = credential as { cookies: Record<string, string> };
  return new QuarkProvider({ getCookies: () => quarkCred.cookies });
}
