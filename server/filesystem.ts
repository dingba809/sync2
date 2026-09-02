import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export interface DirectoryListing { path: string | null; parent: string | null; directories: Array<{ name: string; path: string }>; roots?: string[]; }

export function listDirectories(path?: string): DirectoryListing {
  if (!path && process.platform === 'win32') {
    const roots = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => `${letter}:\\`).filter(existsSync);
    return { path: null, parent: null, directories: [], roots };
  }
  const current = path || '/';
  if (!statSync(current).isDirectory()) throw new Error('路径不是目录');
  const directories = readdirSync(current, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, path: current.endsWith('/') || current.endsWith('\\') ? `${current}${entry.name}` : `${current}${process.platform === 'win32' ? '\\' : '/'}${entry.name}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = dirname(current);
  return { path: current, parent: parent === current ? null : parent, directories };
}
