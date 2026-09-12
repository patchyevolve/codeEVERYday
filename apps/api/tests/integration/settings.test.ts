import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, cleanupTestUsers, makeSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  await cleanupTestUsers();
  app = await setupTestApp();
});
afterAll(async () => { await teardownTestApp(app); });

describe("GET /api/settings", () => {
  let cookie: string;

  beforeAll(async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "test-settings@example.com", name: "SettingsTester", password: "securepass123" },
    });
    const body = reg.json();
    expect(body.user).toBeDefined();
    cookie = `cpd_session=${makeSessionCookie(body.user.id)}`;
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(401);
  });

  it("returns preferences", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().preferences).toBeDefined();
    expect(res.json().preferences.languageKey).toBe("cpp");
  });
});

describe("PUT /api/settings", () => {
  let cookie: string;

  beforeAll(async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "test-settings-update@example.com", name: "SettingsUpdater", password: "securepass123" },
    });
    const body = reg.json();
    expect(body.user).toBeDefined();
    cookie = `cpd_session=${makeSessionCookie(body.user.id)}`;
  });

  it("updates dailyMinutes", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { cookie },
      payload: { dailyMinutes: 60 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const check = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { cookie },
    });
    expect(check.json().preferences.dailyMinutes).toBe(60);
  });

  it("updates timezone", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { cookie },
      payload: { timezone: "Asia/Kolkata" },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/notifications", () => {
  let cookie: string;

  beforeAll(async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "test-notifs@example.com", name: "NotifTester", password: "securepass123" },
    });
    const body = reg.json();
    expect(body.user).toBeDefined();
    cookie = `cpd_session=${makeSessionCookie(body.user.id)}`;
  });

  it("returns notifications array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().notifications)).toBe(true);
  });
});
