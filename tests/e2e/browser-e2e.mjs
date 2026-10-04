/**
 * Real-browser E2E through the actual UI (Chrome headless via Playwright).
 * Drives: register -> onboarding -> dashboard -> session -> task -> submit.
 * Asserts the learner SEES a green pass banner, not the old red/empty one.
 */
import { chromium } from "playwright";
import { API, WEB, psql, ensureArtifactsDir } from "./_helpers.mjs";

const payloadFor = (taskId) =>
  JSON.parse(
    psql(
      `select payload::text from content_items ci join daily_tasks dt on dt.content_item_id=ci.id where dt.id='${taskId}'`
    )
  );

let failures = 0;
const check = (label, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });

/** Assert a green pass banner is visible with real feedback text. */
async function expectPass(want) {
  const alert = page.locator('[role="alert"]');
  await alert.waitFor({ state: "visible", timeout: 10000 });
  const cls = (await alert.getAttribute("class")) ?? "";
  const text = (await alert.innerText()).trim();
  const green = cls.includes("bg-green-50");
  const hasText = text.length > 0;
  check(`green banner with feedback`, green && hasText, `green=${green} text=${JSON.stringify(text.slice(0, 120))}`);
  if (want) check(`feedback contains "${want}"`, text.includes(want), `got ${JSON.stringify(text)}`);
  const completed = await page.locator('button:has-text("Completed")').count();
  check(`submit button now reads "Completed"`, completed > 0);
  return text;
}

console.log("── register ──");
await page.goto(`${WEB}/register`, { waitUntil: "networkidle" });
const email = `ui-${Date.now()}@test.dev`;
await page.fill("#reg-name", "UI Tester");
await page.fill("#reg-email", email);
await page.fill("#reg-password", "Sup3rSecret!");
await page.click('button[type="submit"]');
await page.waitForURL("**/onboarding", { timeout: 15000 });
check("register -> /onboarding", page.url().includes("/onboarding"));

console.log("── onboarding ──");
for (let i = 0; i < 3; i++) await page.click('button:has-text("Next")');
await page.click('button:has-text("Start Practicing")');
await page.waitForURL("**/dashboard", { timeout: 15000 });
check("onboarding -> /dashboard", page.url().includes("/dashboard"));

console.log("── dashboard -> session ──");
const sessionLink = page.locator('a:has-text("Today\'s Session")');
await sessionLink.waitFor({ state: "visible", timeout: 15000 });
await sessionLink.click();
await page.waitForURL("**/session/**", { timeout: 15000 });
const sessionId = page.url().split("/session/")[1];
check("dashboard -> session", !!sessionId, sessionId);

// Wait for the task list to actually render.
await page.locator('main >> button >> nth=0').first().waitFor({ state: "visible", timeout: 15000 });
const taskButtons = page.locator("main > div > button");
const taskCount = await taskButtons.count();
check("session lists tasks", taskCount > 0, `${taskCount} tasks`);

for (let i = 0; i < taskCount; i++) {
  const rows = page.locator("main > div > button");
  const title = (await rows.nth(i).locator("p").first().innerText()).trim();
  const status = await rows.nth(i).innerText();
  if (status.includes("Done")) continue;

  await rows.nth(i).click();
  await page.waitForURL("**/tasks/**", { timeout: 15000 });
  const taskId = page.url().split("/tasks/")[1];
  const raw = payloadFor(taskId);
  const ck = raw.kind;
  console.log(`\n── task ${i + 1}: "${title}" [${ck}] ──`);

  const attempt = await page.locator('header span:has-text("Attempt")').innerText().catch(() => "(none)");
  check(`attempt counter rendered`, /Attempt #\d+/.test(attempt), attempt);

  if (ck === "CODING" || ck === "DEBUGGING") {
    const seeded = await page.locator("#task-code").inputValue();
    check(`editor seeded from scaffold`, seeded.trim().length > 0 && seeded === raw.scaffold,
      `len=${seeded.length} matchesScaffold=${seeded === raw.scaffold}`);
    check(`harness signature shown`, (await page.locator("text=" + (raw.harness?.entryFn ?? "~~~")).count()) > 0,
      raw.harness?.entryFn);
    await page.fill("#task-code", raw.referenceSolution);
    await page.click('button:has-text("Submit")');
    await expectPass();
  } else if (ck === "CONCEPTUAL") {
    await page.locator(`input[name="conceptual-answer"][value="${raw.answerIndex}"]`).check();
    await page.click('button:has-text("Submit")');
    await expectPass("Correct.");
  } else if (ck === "ASSESSMENT") {
    let explainIdx = 0;
    for (let qi = 0; qi < raw.questions.length; qi++) {
      const q = raw.questions[qi];
      if (q.kind === "MCQ") {
        await page.locator(`input[name="q-${qi}"][value="${q.answerIndex}"]`).check();
      } else {
        await page.locator(`textarea[placeholder="Explain your understanding..."]`).nth(explainIdx++).fill("I learned the core idea behind this API.");
      }
    }
    await page.click('button:has-text("Submit")');
    await expectPass("Assessment passed");
  } else if (ck === "LESSON" || ck === "REAL_WORLD" || ck === "PROJECT") {
    // no prompt field exists for LESSON — sections render instead
    if (ck === "LESSON") {
      const sections = await page.locator("main h3").count();
      check(`lesson sections rendered`, sections > 0, `${sections} headings`);
    }
    await page.click('button:has-text("Mark as done")');
    await expectPass();
  } else {
    const snippet = await page.locator("pre").first().innerText().catch(() => "");
    check(`${ck}: content rendered`, snippet.length > 0 || (await page.locator("#task-answer").count()) > 0);
    if (ck === "TRACING" || ck === "PREDICTION") {
      await page.fill("#task-answer", raw.acceptedAnswers[0]);
      await page.click('button:has-text("Submit")');
      await expectPass();
    } else {
      await page.click('button:has-text("Mark as done")');
      await expectPass();
    }
  }

  // back to session
  await page.goBack({ waitUntil: "networkidle" });
}

console.log("\n── back to dashboard ──");
await page.goto(`${WEB}/dashboard`, { waitUntil: "networkidle" });
const complete = await page.locator('text=/Session complete|Completed|session/i').first().innerText().catch(() => "");
check("dashboard reachable after session", page.url().includes("/dashboard"), complete.replace(/\s+/g, " ").slice(0, 80));

const realErrors = pageErrors.filter(
  (e) => !/favicon|Failed to load resource.*404|net::ERR_/.test(e) && !e.includes("the server responded with a status")
);
check("no unexpected browser errors", realErrors.length === 0, realErrors.slice(0, 5).join(" | "));

await page.screenshot({ path: `${ensureArtifactsDir()}final.png`, fullPage: true });
await browser.close();

console.log(`\n══ BROWSER E2E: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} ══`);
process.exit(failures === 0 ? 0 : 1);
