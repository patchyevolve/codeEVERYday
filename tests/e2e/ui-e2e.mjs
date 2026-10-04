/**
 * E2E through the UI path.
 * Replicates EXACTLY what apps/web/src/pages/TaskPage.tsx now sends, so a green
 * run here means the browser contract is correct.
 */
import { API, psql } from "./_helpers.mjs";

const SELF_MARK = ["LESSON", "REAL_WORLD", "PROJECT"];
let cookie = "";
let failures = 0;

async function call(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {})
    }
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) if (c.startsWith("cpd_session=")) cookie = c.split(";")[0];
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

function check(label, cond, extra = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${mark}] ${label}${extra ? ` — ${extra}` : ""}`);
}

function rawPayload(taskId) {
  const row = psql(
    `select ci.payload::text from daily_tasks dt join content_items ci on ci.id = dt.content_item_id where dt.id = '${taskId}'`
  );
  return row ? JSON.parse(row) : null;
}

/** Mirror of TaskPage.handleSubmit */
function buildPayload(ck, content, ref, hintsUsed = 0) {
  if (ck === "CODING" || ck === "DEBUGGING") {
    return { code: ref.code, language: content.harness?.language ?? "cpp", hintsUsed };
  }
  if (ck === "CONCEPTUAL") {
    return { answer: Number(ref.answerIndex), hintsUsed };
  }
  if (ck === "ASSESSMENT") {
    const answer = (ref.questions ?? []).map((q, i) => ({
      i,
      answer: q.kind === "MCQ" ? q.answerIndex : "I learned how this API behaves in practice."
    }));
    return { answer, hintsUsed };
  }
  if (SELF_MARK.includes(ck)) return { completed: true, hintsUsed };
  // TRACING / PREDICTION
  return { answer: (ref.acceptedAnswers ?? [""])[0], hintsUsed };
}

function referenceFor(ck, ref) {
  if (ck === "CODING" || ck === "DEBUGGING") return { code: ref.referenceSolution };
  if (ck === "CONCEPTUAL") return { answerIndex: ref.answerIndex };
  if (ck === "ASSESSMENT") return { questions: ref.questions };
  if (SELF_MARK.includes(ck)) return {};
  return { acceptedAnswers: ref.acceptedAnswers };
}

async function doSession(label) {
  const today = await call("/api/today");
  if (today.status !== 200) {
    check(`${label}: GET /api/today`, false, `status ${today.status} ${JSON.stringify(today.body)}`);
    return false;
  }
  const sessionId = today.body.session.id;
  const session = await call(`/api/sessions/${sessionId}`);
  check(`${label}: GET /api/sessions/:id`, session.status === 200, `status ${session.status}`);
  if (session.status !== 200) return false;

  let allPassed = true;
  for (const t of session.body.tasks) {
    const detail = await call(`/api/tasks/${t.id}`);
    if (detail.status !== 200) {
      check(`${label}: GET /api/tasks/:id (${t.title})`, false, `status ${detail.status}`);
      allPassed = false;
      continue;
    }
    const content = detail.body.content;
    const ck = content?.kind;
    const ref = rawPayload(t.id);
    const payload = buildPayload(ck, content, referenceFor(ck, ref ?? {}));
    const res = await call(`/api/tasks/${t.id}/submit`, { method: "POST", body: JSON.stringify(payload) });
    const ok = res.status === 200 && res.body?.verdict === "PASS";
    allPassed = allPassed && ok;
    check(
      `${label}: submit "${t.title}" [${ck}] -> verdict`,
      ok,
      `status ${res.status} verdict=${res.body?.verdict} feedback=${JSON.stringify(res.body?.feedback)}`
    );
    if (!ok) break;
  }
  return allPassed;
}

console.log("── register + onboarding ──");
const email = `e2e-${Date.now()}@test.dev`;
const reg = await call("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ email, password: "Sup3rSecret!", name: "E2E Tester", languageKey: "cpp", timezone: "UTC" })
});
check("POST /api/auth/register", reg.status === 200, `status ${reg.status} ${JSON.stringify(reg.body)}`);

const ob = await call("/api/onboarding", {
  method: "POST",
  body: JSON.stringify({
    languageKey: "cpp",
    timezone: "UTC",
    dailyMinutes: 45,
    goals: [{ domain: "WEBDEV", title: "Learn web development", horizonDays: 180, milestones: ["HTML basics"] }]
  })
});
check("POST /api/onboarding", ob.status === 200, `status ${ob.status} ${JSON.stringify(ob.body)}`);

const dash = await call("/api/dashboard");
check("GET /api/dashboard", dash.status === 200, `status ${dash.status}`);

console.log("\n── session 1 (UI task flow) ──");
const s1 = await doSession("S1");

console.log("\n── session 2 ──");
const s2 = await doSession("S2");

console.log("\n── session 3 ──");
const s3 = await doSession("S3");

console.log("\n── session 4 ──");
const s4 = await doSession("S4");

console.log("\n── session 5 (expect domain expansion) ──");
const today5 = await call("/api/today");
if (today5.status === 200) {
  const kinds = psql(
    `select ci.payload->>'kind' from daily_tasks dt join content_items ci on ci.id=dt.content_item_id where dt.session_id='${today5.body.session.id}'`
  );
  console.log("  session 5 task kinds:", kinds || "(none)");
  const titles = psql(`select string_agg(dt.title, ' | ') from daily_tasks dt where dt.session_id='${today5.body.session.id}'`);
  console.log("  session 5 titles:", titles);
}
const s5 = await doSession("S5");

console.log(`\n══ RESULT: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} ══`);
process.exit(failures === 0 ? 0 : 1);
