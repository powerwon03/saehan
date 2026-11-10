import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const KEYLEN = 64;
const SALT_BYTES = 16;

function derive(secret: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, KEYLEN, { N: n, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** `scrypt$N$salt(b64)$hash(b64)` with a fresh 16-byte salt. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(secret, salt, N);
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Constant-time comparison; malformed hashes verify as false. */
export async function verifySecret(secret: string, hash: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  if (!Number.isInteger(n) || n < 2 || n > 1 << 20) return false;
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  if (salt.length === 0 || expected.length !== KEYLEN) return false;
  const actual = await derive(secret, salt, n);
  return timingSafeEqual(actual, expected);
}
