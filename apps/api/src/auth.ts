/**
 * Stateless HMAC-signed session cookies.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const COOKIE = "cpd_session";
const MAX_AGE_S = 30 * 24 * 3600;

function secret(): string {
  const s = process.env.API_SESSION_SECRET;
  if (!s) throw new Error("API_SESSION_SECRET env var is required");
  return s;
}

export interface SessionPayload {
  uid: string;
  exp: number; // epoch seconds
}

export function signSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verifySession(token: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  let ok = false;
  try {
    ok = timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(): { path: string; httpOnly: boolean; sameSite: "lax"; secure: boolean; maxAge: number } {
  const secure = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
  return { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: MAX_AGE_S };
}

export function setSessionCookie(reply: FastifyReply, uid: string) {
  reply.setCookie(COOKIE, signSession({ uid, exp: Math.floor(Date.now() / 1000) + MAX_AGE_S }), sessionCookieOptions());
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(COOKIE, sessionCookieOptions());
}

export function currentUserId(req: FastifyRequest): string | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  const payload = verifySession(token);
  return payload?.uid ?? null;
}
