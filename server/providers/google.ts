import type { DriveProvider, RemoteEntry, Quota } from '../../shared/types.js';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const API = 'https://www.googleapis.com';

export interface GoogleAuth {
  getAccessToken(): Promise<string>;
}

export class GoogleDriveProvider implements DriveProvider {
  readonly rootId = 'root';

  constructor(private auth: GoogleAuth) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.auth.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  private async listAll(folderId: string): Promise<RemoteEntry[]> {
    const headers = await this.headers();
    const entries: RemoteEntry[] = [];
    let pageToken: string | undefined;
    do {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const url = `${API}/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum)${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Google list failed: ${res.status} ${await res.text()}`);
      const data = await res.json() as any;
      for (const f of data.files ?? []) {
        entries.push({
          id: f.id,
          name: f.name,
          isDir: f.mimeType === 'application/vnd.google-apps.folder',
          size: Number(f.size ?? 0),
          mtime: Math.floor(new Date(f.modifiedTime).getTime() / 1000),
          hash: f.md5Checksum
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return entries;
  }

  async listFolder(folderId: string): Promise<RemoteEntry[]> {
    return this.listAll(folderId);
  }

  async ensureFolder(parentId: string, name: string): Promise<string> {
    const existing = await this.listAll(parentId);
    const found = existing.find(e => e.isDir && e.name === name);
    if (found) return found.id;
    const headers = await this.headers();
    const res = await fetch(`${API}/drive/v3/files`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });
    if (!res.ok) throw new Error(`Google mkdir failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as any;
    return data.id;
  }

  async uploadFile(localPath: string, parentId: string, name: string): Promise<RemoteEntry> {
    const size = statSync(localPath).size;
    const md5 = await md5File(localPath);

    const existing = await this.listAll(parentId);
    const dup = existing.find(e => !e.isDir && e.name === name && e.hash === md5);
    if (dup) return dup;

    const headers = await this.headers();
    const body = readFileSync(localPath);
    const res = await fetch(`${API}/upload/drive/v3/files?uploadType=media`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(size)
      },
      body
    });
    if (!res.ok) throw new Error(`Google upload failed: ${res.status} ${await res.text()}`);
    const uploaded = await res.json() as any;

    const metaRes = await fetch(
      `${API}/drive/v3/files/${uploaded.id}?addParents=${parentId}&removeParents=root&fields=id,name,size,modifiedTime,md5Checksum`,
      { method: 'PATCH', headers }
    );
    if (!metaRes.ok) throw new Error(`Google move failed: ${metaRes.status} ${await metaRes.text()}`);
    const meta = await metaRes.json() as any;
    return {
      id: meta.id,
      name: meta.name,
      isDir: false,
      size: Number(meta.size ?? size),
      mtime: Math.floor(new Date(meta.modifiedTime).getTime() / 1000),
      hash: meta.md5Checksum
    };
  }

  async deleteEntry(id: string): Promise<void> {
    const headers = await this.headers();
    const res = await fetch(`${API}/drive/v3/files/${id}`, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Google delete failed: ${res.status} ${await res.text()}`);
    }
  }

  async getQuota(): Promise<Quota> {
    const headers = await this.headers();
    const res = await fetch(`${API}/drive/v3/about?fields=storageQuota`, { headers });
    if (!res.ok) throw new Error(`Google quota failed: ${res.status}`);
    const data = await res.json() as any;
    return { total: Number(data.storageQuota.limit ?? 0), used: Number(data.storageQuota.usage ?? 0) };
  }
}

export async function md5File(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(path);
  return createHash('md5').update(buf).digest('hex');
}
