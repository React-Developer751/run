import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

const PREFIX = 'enc:v1:';

/**
 * AES-256-GCM for secrets stored on disk (project env vars, webhook secrets).
 * A leaked db.json or backup is useless without the HostX secret; values stay plain in memory only.
 */
export class Vault {
  private static key: Buffer | null = null;

  static init(derivedKey: Buffer): void {
    this.key = derivedKey;
  }

  static encrypt(plain: string): string {
    if (!this.key || plain.startsWith(PREFIX)) return plain;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
  }

  /** Plain (legacy) values pass through unchanged, so existing databases migrate on their next save. */
  static decrypt(stored: string): string {
    if (!this.key || !stored.startsWith(PREFIX)) return stored;
    try {
      const [iv, tag, data] = stored.slice(PREFIX.length).split(':') as [string, string, string];
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      // Never continue with empty secrets: an empty webhook secret would let anyone forge webhooks, and saving the
      // project again would overwrite the real (still recoverable) ciphertext.
      logger.error('Could not decrypt a stored secret. Was HOSTX_SECRET / data/secret.key changed?');
      throw new Error('Stored secrets cannot be decrypted with the current HOSTX_SECRET / data/secret.key. Restore the original key; nothing was changed.');
    }
  }
}
