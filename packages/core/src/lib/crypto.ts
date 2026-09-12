/**
 * AES-256-GCM encryption for sensitive data (API keys, tokens).
 * Key is derived from the application secret using scrypt.
 */

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LEN, SCRYPT_OPTS);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns base64-encoded: salt(16) + iv(12) + tag(16) + ciphertext
 */
export function encrypt(plaintext: string, secret: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(secret, salt);

  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const result = Buffer.concat([salt, iv, tag, encrypted]);
  return result.toString("base64");
}

/**
 * Decrypt a base64-encoded ciphertext produced by `encrypt`.
 */
export function decrypt(ciphertext: string, secret: string): string {
  const buf = Buffer.from(ciphertext, "base64");

  if (buf.length < 16 + IV_LEN + TAG_LEN + 1) {
    throw new Error("Invalid ciphertext: too short");
  }

  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 16 + IV_LEN);
  const tag = buf.subarray(16 + IV_LEN, 16 + IV_LEN + TAG_LEN);
  const data = buf.subarray(16 + IV_LEN + TAG_LEN);

  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Mask an API key for display: show first 4 and last 4 characters.
 */
export function maskKey(key: string): string {
  if (key.length <= 10) return "****";
  return `${key.slice(0, 4)}${"*".repeat(key.length - 8)}${key.slice(-4)}`;
}
