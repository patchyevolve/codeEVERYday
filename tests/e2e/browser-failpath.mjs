/**
 * Regression: a FAIL submit must NOT wipe the learner's editor content,
 * and must render a red banner with real feedback (the old UI showed an
 * empty red box because it read result.passed/message).
 */
import { chromium } from "playwright";
import { WEB, psql } from "./_helpers.mjs";

let failures = 0;
const check = (label, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext()).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

const email = psql(`select email from users where email like 'ui-%@test.dev' order by created_at desc limit 1`);
check("found UI user", !!email, email);

await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
await page.fill("#login-email", email);
await page.fill("#login-password", "Sup3rSecret!");
await page.click('button[type="submit"]');
await page.waitForURL("**/dashboard", { timeout: 15000 });

const userId = psql(`select id from users where email='${email}'`);
const sessionId = psql(`select id from daily_sessions where user_id='${userId}' order by created_at desc limit 1`);
const ci = psql(`select id from content_items where payload->>'kind'='CODING' order by random() limit 1`);
const taskId = psql(
  `insert into daily_tasks (session_id, position, kind, content_item_id, title, est_minutes)
   values ('${sessionId}', 98, 'PRACTICE', '${ci}', 'FAIL-path coding task', 5) returning id`
);

console.log("── FAIL submit preserves editor + shows real feedback ──");
await page.goto(`${WEB}/tasks/${taskId}`, { waitUntil: "domcontentloaded" });
await page.locator("#task-code").waitFor({ state: "visible", timeout: 20000 });

const WRONG = "// my attempt at a solution\nint broken() { return 0; }\n";
await page.fill("#task-code", WRONG);
await page.click('button:has-text("Submit")');

const alert = page.locator('[role="alert"]');
await alert.waitFor({ state: "visible", timeout: 20000 });
const cls = (await alert.getAttribute("class")) ?? "";
const text = (await alert.innerText()).trim();

check("red (not green) banner", cls.includes("bg-red-50") && !cls.includes("bg-green-50"), cls.slice(0, 80));
check("non-empty feedback text", text.length > 0, JSON.stringify(text.slice(0, 160)));
check("editor still holds learner's code", (await page.locator("#task-code").inputValue()) === WRONG,
  `len=${(await page.locator("#task-code").inputValue()).length}`);
const btn = await page.locator("main > button").last().innerText();
check("button still says Submit (retry allowed)", btn.includes("Submit") && !btn.includes("Completed"), btn);
check("attempt counter advanced", /Attempt #\d+/.test(await page.locator('span:has-text("Attempt")').first().innerText()));

const realErrors = pageErrors.filter((e) => !/favicon|404|net::ERR_/.test(e));
check("no browser errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n══ FAIL-PATH REGRESSION: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} ══`);
process.exit(failures === 0 ? 0 : 1);
