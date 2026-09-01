import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanDirectory } from './scanner.js';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'scan-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('scanner', () => {
  it('returns files with size and mtime, relative paths using /', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'a.txt'), 'hello');
    writeFileSync(join(dir, 'sub', 'b.txt'), 'world!');
    const map = scanDirectory(dir);
    expect(map.size).toBe(2);
    expect(map.has('a.txt')).toBe(true);
    expect(map.has('sub/b.txt')).toBe(true);
    expect(map.get('a.txt')!.size).toBe(5);
    expect(map.get('a.txt')!.mtime).toBeGreaterThan(0);
  });

  it('ignores directories themselves', () => {
    mkdirSync(join(dir, 'empty'));
    expect(scanDirectory(dir).size).toBe(0);
  });

  it('returns empty map for empty directory', () => {
    expect(scanDirectory(dir).size).toBe(0);
  });
});
