import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, getMasterKey } from './config.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), 'cfg-')); dirs.push(d); return d; }
afterEach(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

describe('config', () => {
  it('loads defaults and creates data dir', () => {
    const d = tmp();
    const cfg = loadConfig({ DATA_DIR: d } as any);
    expect(cfg.dataDir).toBe(d);
    expect(cfg.port).toBe(3000);
  });

  it('reads env overrides', () => {
    const cfg = loadConfig({ DATA_DIR: tmp(), PORT: '8080', TZ: 'America/New_York', GOOGLE_CLIENT_ID: 'cid' } as any);
    expect(cfg.port).toBe(8080);
    expect(cfg.timezone).toBe('America/New_York');
    expect(cfg.googleClientId).toBe('cid');
  });

  it('uses China Standard Time when TZ is missing or invalid', () => {
    expect(loadConfig({ DATA_DIR: tmp() } as any).timezone).toBe('Asia/Shanghai');
    expect(loadConfig({ DATA_DIR: tmp(), TZ: 'not/a-timezone' } as any).timezone).toBe('Asia/Shanghai');
  });

  it('getMasterKey is stable across calls', () => {
    const d = tmp();
    const k1 = getMasterKey(d);
    const k2 = getMasterKey(d);
    expect(k1.equals(k2)).toBe(true);
  });

  it('reads google config from drives.config.json', () => {
    const d = tmp();
    writeFileSync(join(d, 'drives.config.json'), JSON.stringify({
      google: { clientId: 'cfg-id', clientSecret: 'cfg-secret', redirectUri: 'http://cb' }
    }));
    const cfg = loadConfig({ DATA_DIR: d } as any);
    expect(cfg.googleClientId).toBe('cfg-id');
    expect(cfg.googleClientSecret).toBe('cfg-secret');
    expect(cfg.googleRedirectUri).toBe('http://cb');
  });

  it('falls back to env when config file missing', () => {
    const cfg = loadConfig({ DATA_DIR: tmp(), GOOGLE_CLIENT_ID: 'env-id' } as any);
    expect(cfg.googleClientId).toBe('env-id');
  });
});
