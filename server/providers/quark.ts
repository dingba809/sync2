import type { DriveProvider, RemoteEntry, Quota } from '../../shared/types.js';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const BASE = 'https://drive-pc.quark.cn/1/clouddrive';
const OSS_UA = 'aliyun-sdk-js/6.6.1 Chrome 98.0.4758.80 on Windows 10 64-bit';

function defParams(): URLSearchParams {
  return new URLSearchParams({
    pr: 'ucpro', fr: 'pc', uc_param_str: '',
    __t: String(Date.now()), __dt: '1000'
  });
}

export interface QuarkCookieStore {
  getCookies(): Record<string, string>;
}

export class QuarkProvider implements DriveProvider {
  readonly rootId = '0';

  constructor(private cookies: QuarkCookieStore) {}

  private headers(): Record<string, string> {
    const c = this.cookies.getCookies();
    const cookie = Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ');
    return {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      origin: 'https://pan.quark.cn',
      referer: 'https://pan.quark.cn/',
      'content-type': 'application/json',
      cookie
    };
  }

  private async get(url: string, params: Record<string, string | number>): Promise<any> {
    const q = defParams();
    for (const [k, v] of Object.entries(params)) q.set(k, String(v));
    const res = await fetch(`${url}?${q}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Quark ${url} HTTP ${res.status}`);
    const data = await res.json() as any;
    if (data.status !== 200 || data.code !== 0) throw new Error(`Quark ${url} code ${data.code}: ${data.message ?? ''}`);
    return data.data;
  }

  private async post(url: string, body: unknown): Promise<any> {
    const q = defParams();
    const res = await fetch(`${url}?${q}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Quark ${url} HTTP ${res.status}`);
    const data = await res.json() as any;
    if (data.status !== 200 || data.code !== 0) throw new Error(`Quark ${url} code ${data.code}: ${data.message ?? ''}`);
    return data.data;
  }

  async listFolder(folderId: string): Promise<RemoteEntry[]> {
    const data = await this.get(`${BASE}/file/sort`, {
      pdir_fid: folderId, _page: 1, _size: 1000, _sort: 'file_name:asc',
      _fetch_total: 1, _fetch_sub_dirs: 0
    });
    return (data.list ?? []).map((f: any) => ({
      id: f.fid,
      name: f.file_name,
      isDir: !!f.dir,
      size: Number(f.size ?? 0),
      mtime: Number(f.updated_at ?? 0),
      hash: f.sha1 || undefined
    }));
  }

  async ensureFolder(parentId: string, name: string): Promise<string> {
    const list = await this.listFolder(parentId);
    const found = list.find(e => e.isDir && e.name === name);
    if (found) return found.id;
    const data = await this.post(`${BASE}/file`, {
      pdir_fid: parentId, file_name: name, dir_init_lock: false
    });
    return data.fid;
  }

  async uploadFile(localPath: string, parentId: string, name: string): Promise<RemoteEntry> {
    const size = statSync(localPath).size;
    const md5 = await md5File(localPath);
    const mimeType = 'application/octet-stream';

    const pre = await this.post(`${BASE}/file/upload/pre`, {
      ccp_hash_update: true, parallel_upload: true, pdir_fid: parentId,
      dir_name: '', size, file_name: name,
      format_type: mimeType,
      l_updated_at: Date.now(), l_created_at: Date.now()
    });

    const hashRes = await this.post(`${BASE}/file/update/hash`, {
      task_id: pre.task_id, md5, sha1: ''
    });
    if (hashRes?.finish === true) {
      return await this.findByName(parentId, name, size, md5);
    }

    const partSize: number = pre.metadata?.part_size || 4 * 1024 * 1024;
    const buf = readFileSync(localPath);
    const host = String(pre.upload_url || '').replace(/^https?:\/\//, '');
    const baseUrl = `https://${pre.bucket}.${host}/${pre.obj_key}`;
    const etags: string[] = [];
    let partNumber = 1;
    for (let off = 0; off < size; off += partSize) {
      const chunk = buf.subarray(off, Math.min(off + partSize, size));
      etags.push(await this.upPart(pre, mimeType, partNumber, chunk, baseUrl));
      partNumber++;
    }

    await this.upCommit(pre, etags, baseUrl);
    await this.post(`${BASE}/file/upload/finish`, { task_id: pre.task_id, obj_key: pre.obj_key });

    return await this.findByName(parentId, name, size, md5);
  }

  private async findByName(
    parentId: string, name: string, size: number, md5: string
  ): Promise<RemoteEntry> {
    for (let i = 0; i < 5; i++) {
      const list = await this.listFolder(parentId);
      const found = list.find(e => !e.isDir && e.name === name);
      if (found) return found;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Quark upload completed but file not found in listing: ${name}`);
  }

  private async upPart(
    pre: any, mimeType: string, partNumber: number, chunk: Buffer<ArrayBuffer>, baseUrl: string
  ): Promise<string> {
    const timeStr = new Date().toUTCString();
    const authMeta =
      `PUT\n\n${mimeType}\n${timeStr}\n` +
      `x-oss-date:${timeStr}\nx-oss-user-agent:${OSS_UA}\n` +
      `/${pre.bucket}/${pre.obj_key}?partNumber=${partNumber}&uploadId=${pre.upload_id}`;
    const auth = await this.post(`${BASE}/file/upload/auth`, {
      task_id: pre.task_id, auth_info: pre.auth_info, auth_meta: authMeta
    });
    const url = `${baseUrl}?partNumber=${partNumber}&uploadId=${pre.upload_id}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': auth.auth_key,
        'Content-Type': mimeType,
        'Referer': 'https://pan.quark.cn/',
        'x-oss-date': timeStr,
        'x-oss-user-agent': OSS_UA
      },
      body: chunk
    });
    if (res.status !== 200) throw new Error(`Quark part upload failed: ${res.status}`);
    const etag = res.headers.get('etag');
    if (!etag) throw new Error(`Quark part upload missing ETag (part ${partNumber})`);
    return etag;
  }

  private async upCommit(pre: any, etags: string[], baseUrl: string): Promise<void> {
    const timeStr = new Date().toUTCString();
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>\n` +
      etags.map((etag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${etag}</ETag></Part>`).join('\n') +
      `\n</CompleteMultipartUpload>`;
    const contentMd5 = createHash('md5').update(xml).digest('base64');
    const callbackBase64 = Buffer.from(JSON.stringify(pre.callback ?? {})).toString('base64');
    const authMeta =
      `POST\n${contentMd5}\napplication/xml\n${timeStr}\n` +
      `x-oss-callback:${callbackBase64}\nx-oss-date:${timeStr}\nx-oss-user-agent:${OSS_UA}\n` +
      `/${pre.bucket}/${pre.obj_key}?uploadId=${pre.upload_id}`;
    const auth = await this.post(`${BASE}/file/upload/auth`, {
      task_id: pre.task_id, auth_info: pre.auth_info, auth_meta: authMeta
    });
    const url = `${baseUrl}?uploadId=${pre.upload_id}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': auth.auth_key,
        'Content-MD5': contentMd5,
        'Content-Type': 'application/xml',
        'Referer': 'https://pan.quark.cn/',
        'x-oss-callback': callbackBase64,
        'x-oss-date': timeStr,
        'x-oss-user-agent': OSS_UA
      },
      body: xml
    });
    if (res.status !== 200) throw new Error(`Quark commit failed: ${res.status}`);
  }

  async deleteEntry(id: string): Promise<void> {
    await this.post(`${BASE}/file/delete`, { action_type: 2, filelist: [id], exclude_fids: [] });
  }

  async getQuota(): Promise<Quota> {
    const data = await this.get(`${BASE}/capacity`, {});
    return { total: Number(data.total_capacity ?? 0), used: Number(data.use_capacity ?? 0) };
  }
}

async function md5File(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(path);
  return createHash('md5').update(buf).digest('hex');
}
