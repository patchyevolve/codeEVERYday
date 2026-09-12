/**
 * Password hashing using Node's built-in scrypt — no native deps,
 * constant-time comparison, per-user random salt.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LEN, SCRYPT_OPTS);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");
  const derived = scryptSync(password, salt, expected.length, SCRYPT_OPTS);
  return timingSafeEqual(derived, expected);
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}