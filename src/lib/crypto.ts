import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Field encryption for the most sensitive registration data (NI number, health, convictions, bank details).
 * AES-256-GCM with a key that only the app knows (FIELD_ENCRYPTION_KEY, 32 random bytes in base64).
 * The database only ever sees ciphertext. Never change or lose the key: data encrypted with it can't be read without it.
 */

function key(): Buffer {
  const k = process.env.FIELD_ENCRYPTION_KEY || '';
  const b = Buffer.from(k, 'base64');
  if (b.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY is missing or not 32 bytes of base64');
  return b;
}

export function encryptionReady(): boolean {
  try { key(); return true; } catch { return false; }
}

export function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

export function decrypt<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  if (!s.startsWith('v1:')) throw new Error('Unknown encryption format');
  const raw = Buffer.from(s.slice(3), 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')) as T;
}
