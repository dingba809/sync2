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

interface DriveConfigFile {
  google?: { clientId?: string; clientSecret?: string; redirectUri?: string };
  [key: string]: unknown;
}

function readDrivesConfig(dataDir: string): DriveConfigFile {
  const candidates = [join(process.cwd(), 'drives.config.json'), join(dataDir, 'drives.config.json')];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        // 忽略解析错误，回退环境变量
      }
    }
  }
  return {};
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.DATA_DIR || join(process.cwd(), 'data'));
  mkdirSync(dataDir, { recursive: true });
  const drives = readDrivesConfig(dataDir);
  const google = drives.google ?? {};
  return {
    dataDir,
    port: Number(env.PORT || 3000),
    host: env.HOST || '127.0.0.1',
    googleClientId: google.clientId || env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: google.clientSecret || env.GOOGLE_CLIENT_SECRET || '',
    googleRedirectUri: google.redirectUri || env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
  };
}

export function getMasterKey(dataDir: string): Buffer {
  const keyFile = join(dataDir, '.master.key');
  if (existsSync(keyFile)) return Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex');
  const key = randomBytes(32).toString('hex');
  writeFileSync(keyFile, key, { mode: 0o600 });
  return Buffer.from(key, 'hex');
}
