import { RemoteFileNotFoundError, type DriveProvider, type RemoteEntry, type Quota, type UploadOptions } from '../../shared/types.js';
import { createReadStream, statSync } from 'node:fs';

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
          hash: f.md5Checksum,
          hashAlgorithm: 'md5'
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

  async uploadFile(localPath: string, parentId: string, name: string, _options?: UploadOptions): Promise<RemoteEntry> {
    return this.resumableUpload(localPath, name, { name, parents: [parentId] });
  }

  async replaceFile(fileId: string, localPath: string, name: string, _options?: UploadOptions): Promise<RemoteEntry> {
    return this.resumableUpload(localPath, name, { name }, fileId);
  }

  private async resumableUpload(localPath: string, name: string, metadata: object, fileId?: string): Promise<RemoteEntry> {
    const size = statSync(localPath).size;
    const headers = await this.headers();
    const method = fileId ? 'PATCH' : 'POST';
    const resource = fileId ? `/files/${encodeURIComponent(fileId)}` : '/files';
    const metadataBody = JSON.stringify(metadata);

    if (size === 0) {
      const res = await fetch(`${API}/drive/v3${resource}?fields=id,name,size,modifiedTime,md5Checksum`, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: metadataBody
      });
      if (res.status === 404 && fileId) throw new RemoteFileNotFoundError(fileId);
      if (!res.ok) throw new Error(`Google create failed: ${res.status} ${await res.text()}`);
      const meta = await res.json() as any;
      return {
        id: meta.id, name: meta.name, isDir: false, size: 0,
        mtime: Math.floor(new Date(meta.modifiedTime).getTime() / 1000), hash: meta.md5Checksum, hashAlgorithm: 'md5'
      };
    }

    const initRes = await fetch(`${API}/upload/drive/v3${resource}?uploadType=resumable&fields=id,name,size,modifiedTime,md5Checksum`, {
      method,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'application/octet-stream',
        'X-Upload-Content-Length': String(size)
      },
      body: metadataBody
    });
    if (initRes.status === 404 && fileId) throw new RemoteFileNotFoundError(fileId);
    if (initRes.status !== 200) throw new Error(`Google resumable init failed: ${initRes.status} ${await initRes.text()}`);
    const sessionUri = initRes.headers.get('location');
    if (!sessionUri) throw new Error('Google resumable init missing location');

    const CHUNK = 5 * 1024 * 1024;
    const stream = createReadStream(localPath, { highWaterMark: CHUNK });
    let start = 0;
    let fileMeta: any = null;
    for await (const chunk of stream) {
      const buf = chunk as Buffer<ArrayBuffer>;
      const end = start + buf.length - 1;
      const res = await fetch(sessionUri, {
        method: 'PUT',
        headers: {
          'Content-Length': String(buf.length),
          'Content-Range': `bytes ${start}-${end}/${size}`
        },
        body: buf
      });
      if (res.status === 200 || res.status === 201) {
        fileMeta = await res.json();
        break;
      } else if (res.status === 308) {
        start = end + 1;
      } else {
        throw new Error(`Google resumable upload failed: ${res.status} ${await res.text()}`);
      }
    }

    if (!fileMeta) throw new Error('Google resumable upload incomplete');

    return {
      id: fileMeta.id,
      name: fileMeta.name,
      isDir: false,
      size: Number(fileMeta.size ?? size),
      mtime: Math.floor(new Date(fileMeta.modifiedTime).getTime() / 1000),
      hash: fileMeta.md5Checksum,
      hashAlgorithm: 'md5'
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
