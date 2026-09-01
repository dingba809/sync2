import { readdirSync, statSync, Dirent } from 'node:fs';
import { join } from 'node:path';

export interface LocalFileInfo {
  size: number;
  mtime: number;
}

export function scanDirectory(root: string): Map<string, LocalFileInfo> {
  const result = new Map<string, LocalFileInfo>();
  walk(root, '', result);
  return result;
}

function walk(dir: string, rel: string, out: Map<string, LocalFileInfo>): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === '.git') continue;
    const abs = join(dir, ent.name);
    const relPath = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      walk(abs, relPath, out);
    } else if (ent.isFile()) {
      const st = statSync(abs);
      out.set(relPath, { size: st.size, mtime: Math.floor(st.mtimeMs) });
    }
  }
}
