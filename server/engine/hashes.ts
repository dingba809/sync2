import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { FileDigests } from '../../shared/types.js';

/** Computes both provider-compatible digests in one streaming pass. */
export async function fileDigests(path: string): Promise<FileDigests> {
  const md5 = createHash('md5');
  const sha1 = createHash('sha1');
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    md5.update(chunk as Buffer);
    sha1.update(chunk as Buffer);
  }
  return { md5: md5.digest('hex'), sha1: sha1.digest('hex') };
}
