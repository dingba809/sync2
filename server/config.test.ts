import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, getMasterKey } from './config.js';
import { mkdtempSync, rmSync } from 'node:fs';
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
    const cfg = loadConfig({ DATA_DIR: tmp(), PORT: '8080', GOOGLE_CLIENT_ID: 'cid' } as any);
    expect(cfg.port).toBe(8080);
    expect(cfg.googleClientId).toBe('cid');
  });

  it('getMasterKey is stable across calls', () => {
    const d = tmp();
    const k1 = getMasterKey(d);
    const k2 = getMasterKey(d);
    expect(k1.equals(k2)).toBe(true);
  });
});
