/**
 * AES-256-GCM encryption at rest for wallet private keys and exchange API keys.
 * Secrets are never logged and never returned to the browser.
 */
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getMasterKey() {
  const raw = process.env.ENCRYPTION_MASTER_KEY || 'dev-only-32-byte-master-key-change-me!!';
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Secret plaintext must be a non-empty string');
  }
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');
  return {
    ciphertext,
    iv: iv.toString('base64'),
    authTag,
  };
}

export function decryptSecret({ ciphertext, iv, authTag }) {
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

export function redactSecret(value) {
  if (!value || typeof value !== 'string') return '[REDACTED]';
  return `[REDACTED:${value.length}chars]`;
}
