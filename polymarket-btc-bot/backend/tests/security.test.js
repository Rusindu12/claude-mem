import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, redactSecret } from '../src/security/crypto.js';

describe('AES-256-GCM Secret Encryption', () => {
  it('encrypts and decrypts secrets cleanly without leaking plaintext', () => {
    const secret = '0xdeadbeef1234567890abcdef';
    const enc = encryptSecret(secret);
    expect(enc.ciphertext).not.toContain('deadbeef');
    expect(decryptSecret(enc)).toBe(secret);
    expect(redactSecret(secret)).toBe('[REDACTED:26chars]');
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptSecret('my-api-key');
    enc.ciphertext = 'AAAA' + enc.ciphertext.slice(4);
    expect(() => decryptSecret(enc)).toThrow();
  });
});
