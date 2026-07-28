import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * AES-256-GCM envelope for anything we persist that a user would be upset to
 * see in a database dump: platform tokens and BYO model API keys.
 *
 * Format: v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
 */
const VERSION = 'v1';

function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY must be set to a random string of at least 32 characters. ' +
      'Generate one with: openssl rand -base64 48',
    );
  }
  return scryptSync(secret, 'pressbox.v1.salt', 32);
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function decrypt(payload: string): string {
  const [v, ivB64, tagB64, ctB64] = payload.split('.');
  if (v !== VERSION) throw new Error(`Unsupported ciphertext version: ${v}`);
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function encryptJson(value: unknown): string { return encrypt(JSON.stringify(value)); }
export function decryptJson<T>(payload: string): T { return JSON.parse(decrypt(payload)) as T; }

/** Show the user enough of a key to recognize it, never enough to use it. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 4)}${'•'.repeat(12)}${secret.slice(-4)}`;
}
