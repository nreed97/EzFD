import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function getKey(): Buffer | null {
  const hex = process.env.EZFD_ENCRYPTION_KEY ?? '';
  if (!hex) return null;
  if (hex.length !== 64) throw new Error('EZFD_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  return Buffer.from(hex, 'hex');
}

const ENC_PATTERN = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;

export function encryptField(text: string): string {
  const key = getKey();
  if (!key) return text;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptField(stored: string): string {
  if (!ENC_PATTERN.test(stored)) return stored;
  const key = getKey();
  if (!key) return stored;
  const [ivHex, tagHex, encHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
