/**
 * Targeted browser test for TRACING / PREDICTION — the two kinds not reached
 * by the composed session flow. Injects a task into an existing session.
 */
import { chromium } from "playwright";
import { WEB, psql } from "./_helpers.mjs";

let failures = 0;
const check = (label, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

console.log("── login as existing UI user ──");
const email = psql(`select email from users where email like 'ui-%@test.dev' order by created_at desc limit 1`);
check("found prior UI user", !!email, email);

await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
await page.fill("#login-email", email);
await page.fill("#login-password", "Sup3rSecret!");
await page.click('button[type="submit"]');
await page.waitForURL("**/dashboard", { timeout: 15000 });
check("login -> /dashboard", page.url().includes("/dashboard"));

const userId = psql(`select id from users where email='${email}'`);
const sessionId = psql(`select id from daily_sessions where user_id='${userId}' order by created_at desc limit 1`);
check("found session", !!sessionId, sessionId);

for (const kind of ["TRACING", "PREDICTION"]) {
  console.log(`\n── inject + complete ${kind} task ──`);
  const ci = psql(
    `select id from content_items where payload->>'kind'='${kind}' order by random() limit 1`
  );
  check(`${kind}: content item exists`, !!ci, ci);
  const title = psql(`select payload->>'title' from content_items where id='${ci}'`) || `${kind} task`;
  const taskId = psql(
    `insert into daily_tasks (session_id, position, kind, content_item_id, title, est_minutes)
     values ('${sessionId}', 99, 'PRACTICE', '${ci}', '${title.replace(/'/g, "''")}', 5)
     returning id`
  );

  await page.goto(`${WEB}/tasks/${taskId}`, { waitUntil: "domcontentloaded" });
  const ck = psql(`select payload->>'kind' from content_items where id='${ci}'`);

  // networkidle races React's post-hydration fetch — wait for the real element.
  try {
    await page.locator("#task-answer").waitFor({ state: "visible", timeout: 20000 });
    check(`${kind}: page renders answer input`, true, `ck=${ck}`);
  } catch (e) {
    check(`${kind}: page renders answer input`, false, `url=${page.url()}`);
    console.log("    BODY:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400));
    throw e;
  }

  // code snippet must render
  const pre = await page.locator("pre").first().innerText().catch(() => "");
  check(`${kind}: code snippet rendered`, pre.trim().length > 0, `${pre.length} chars`);

  const accepted = JSON.parse(psql(`select payload->'acceptedAnswers'::text from content_items where id='${ci}'`));
  await page.fill("#task-answer", accepted[0]);
  await page.click('button:has-text("Submit")');

  const alert = page.locator('[role="alert"]');
  await alert.waitFor({ state: "visible", timeout: 10000 });
  const cls = (await alert.getAttribute("class")) ?? "";
  const text = (await alert.innerText()).trim();
  check(`${kind}: green pass banner`, cls.includes("bg-green-50") && text.length > 0, JSON.stringify(text));
  const done = await page.locator('button:has-text("Completed")').count();
  check(`${kind}: button reads Completed`, done > 0);
}

const realErrors = pageErrors.filter((e) => !/favicon|404|net::ERR_/.test(e));
check("no browser errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n══ TRACING/PREDICTION: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} ══`);
process.exit(failures === 0 ? 0 : 1);
