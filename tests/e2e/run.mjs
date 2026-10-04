#!/usr/bin/env node
/**
 * E2E runner for tests/e2e.
 *
 *   npm run test:e2e              # API suite + browser suites (if available)
 *   npm run test:e2e -- --api-only  # API contract suite only, no browser
 *   E2E_REQUIRE_BROWSER=1 npm run test:e2e   # fail instead of skipping browsers
 *
 * Suites run sequentially against the stack you already have up (start it with
 * ./start.sh). The browser suites need Playwright plus a local Chrome; when
 * either is missing they are skipped with a warning rather than failing the
 * whole run, unless E2E_REQUIRE_BROWSER=1 says the environment must have them.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const API_ONLY = process.argv.includes("--api-only");
const REQUIRE_BROWSER = process.env.E2E_REQUIRE_BROWSER === "1";

const SUITES = [
  { name: "api contract (register → onboarding → 5 sessions → submit)", file: "ui-e2e.mjs", browser: false },
  { name: "browser: happy path", file: "browser-e2e.mjs", browser: true },
  { name: "browser: fail path preserves editor", file: "browser-failpath.mjs", browser: true },
  { name: "browser: tracing/prediction", file: "browser-tracing.mjs", browser: true },
];

const playwrightAvailable = existsSync(
  fileURLToPath(new URL("../../node_modules/playwright/package.json", import.meta.url))
);
const chromeAvailable = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].some(existsSync);

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`${REPO_ROOT}tests/e2e/${file}`], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const results = [];
for (const suite of SUITES) {
  if (API_ONLY && suite.browser) continue;

  if (suite.browser && (!playwrightAvailable || !chromeAvailable)) {
    const missing = [
      !playwrightAvailable && "playwright (npm i -D playwright)",
      !chromeAvailable && "a Chrome/Chromium binary",
    ].filter(Boolean);
    const message = `missing ${missing.join(" + ")}`;
    if (REQUIRE_BROWSER) {
      console.log(`\n── ${suite.name} ──\n  [FAIL] skipped: ${message}`);
      results.push({ name: suite.name, ok: false });
    } else {
      console.log(`\n── ${suite.name} ──\n  [SKIP] ${message}`);
      results.push({ name: suite.name, ok: true, skipped: true });
    }
    continue;
  }

  console.log(`\n════ ${suite.name} ════`);
  const code = await run(suite.file);
  results.push({ name: suite.name, ok: code === 0, exitCode: code });
}

console.log("\n════ E2E SUMMARY ════");
for (const r of results) {
  const status = r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL";
  console.log(`  [${status}] ${r.name}`);
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "\nRESULT: ALL PASS" : `\nRESULT: ${failed.length} SUITE(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
