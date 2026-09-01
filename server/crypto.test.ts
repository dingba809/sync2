import { describe, it, expect } from 'vitest';
import { generateKey, encrypt, decrypt } from './crypto.js';

describe('crypto', () => {
  it('roundtrips plaintext', () => {
    const key = generateKey();
    const cipher = encrypt('hello 世界', key);
    expect(cipher).not.toContain('hello');
    expect(decrypt(cipher, key)).toBe('hello 世界');
  });

  it('produces different ciphertext each time (random IV)', () => {
    const key = generateKey();
    expect(encrypt('x', key)).not.toBe(encrypt('x', key));
  });

  it('fails with wrong key', () => {
    const cipher = encrypt('secret', generateKey());
    expect(() => decrypt(cipher, generateKey())).toThrow();
  });
});
