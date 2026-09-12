import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, makeSessionCookie, cleanupTestUsers } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  await cleanupTestUsers();
  app = await setupTestApp();
});
afterAll(async () => { await teardownTestApp(app); });

describe("POST /api/auth/register", () => {
  beforeAll(async () => {
    // Ensure the user exists before testing duplicate detection
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "test-register@example.com", name: "Tester", password: "securepass123" },
    });
  });

  it("registers a new user and returns user + sets cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "test-register2@example.com", name: "Tester", password: "securepass123" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe("test-register2@example.com");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("returns 409 for duplicate email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "test-register@example.com", name: "Tester2", password: "securepass123" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already registered/);
  });

  it("returns 400 for invalid email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "not-an-email", name: "T", password: "123" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeAll(async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "test-login@example.com", name: "LoginTester", password: "securepass123" },
    });
  });

  it("logs in with correct credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "test-login@example.com", password: "securepass123" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe("test-login@example.com");
  });

  it("returns 401 for wrong password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "test-login@example.com", password: "wrongpassword" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for nonexistent email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "noone@example.com", password: "securepass123" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears session cookie", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});

describe("GET /api/me", () => {
  let userId: string;

  beforeAll(async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "test-me@example.com", name: "MeTester", password: "securepass123" },
    });
    userId = reg.json().user.id;
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns user profile with auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: `cpd_session=${makeSessionCookie(userId)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe("test-me@example.com");
    expect(body.preferences).toBeDefined();
  });
});
