import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

export interface Config {
  dataDir: string;
  port: number;
  host: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.DATA_DIR || join(process.cwd(), 'data'));
  mkdirSync(dataDir, { recursive: true });
  return {
    dataDir,
    port: Number(env.PORT || 3000),
    host: env.HOST || '127.0.0.1',
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
    googleRedirectUri: env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
  };
}

export function getMasterKey(dataDir: string): Buffer {
  const keyFile = join(dataDir, '.master.key');
  if (existsSync(keyFile)) return Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex');
  const key = randomBytes(32).toString('hex');
  writeFileSync(keyFile, key, { mode: 0o600 });
  return Buffer.from(key, 'hex');
}
