import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class CryptoService {
  private readonly encryptionKey: Buffer;

  constructor() {
    const rawSecret =
      process.env.MASTER_ENCRYPTION_KEY ||
      'nexora-dev-master-encryption-key-change-in-production-32b!';
    this.encryptionKey = crypto.createHash('sha256').update(rawSecret).digest();
  }

  /**
   * Encrypts sensitive strings (provider API keys, gateway secrets) using AES-256-GCM.
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  /**
   * Decrypts AES-256-GCM payload stored in PostgreSQL.
   */
  decrypt(ciphertextPayload: string): string {
    const parts = ciphertextPayload.split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted secret payload');
    }
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  /**
   * Masks an API key for safe display in Owner Dashboard (never returns plaintext secret).
   */
  maskSecret(secret: string): string {
    if (!secret || secret.length < 8) return '••••••••';
    return `${secret.slice(0, 4)}••••••••••••${secret.slice(-4)}`;
  }

  /**
   * Deterministic SHA-256 hash for refresh tokens, reset tokens, and API keys.
   */
  sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  /**
   * Cryptographically random URL-safe token.
   */
  randomToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  /**
   * Generates a short uppercase alphanumeric referral code.
   */
  generateReferralCode(): string {
    return 'NXR' + crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  /**
   * Constant-time string digest comparison to prevent timing side-channel attacks.
   */
  timingSafeEqualStr(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * Returns YYYY-MM-DD in Sri Lanka time (Asia/Colombo, UTC+05:30).
   */
  getColomboDateString(date: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Colombo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  /**
   * Returns YYYY-MM in Sri Lanka time (Asia/Colombo) for monthly budget tracking.
   */
  getColomboMonthString(date: Date = new Date()): string {
    return this.getColomboDateString(date).slice(0, 7);
  }
}
