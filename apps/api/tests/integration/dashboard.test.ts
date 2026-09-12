import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, cleanupTestUsers, makeSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  await cleanupTestUsers();
  app = await setupTestApp();
});
afterAll(async () => { await teardownTestApp(app); });

describe("GET /api/graph", () => {
  let cookie: string;

  beforeAll(async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "test-graph@example.com", name: "GraphTester", password: "securepass123" },
    });
    const body = reg.json();
    expect(body.user).toBeDefined();
    cookie = `cpd_session=${makeSessionCookie(body.user.id)}`;
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/graph" });
    expect(res.statusCode).toBe(401);
  });

  it("returns nodes and edges", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/graph",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
  });
});

describe("GET /api/dashboard", () => {
  let cookie: string;

  beforeAll(async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "test-dashboard@example.com", name: "DashTester", password: "securepass123" },
    });
    const body = reg.json();
    expect(body.user).toBeDefined();
    cookie = `cpd_session=${makeSessionCookie(body.user.id)}`;
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboard" });
    expect(res.statusCode).toBe(401);
  });

  it("returns dashboard data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.weak).toBeDefined();
    expect(body.goals).toBeDefined();
  });
});
