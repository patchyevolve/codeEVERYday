import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { users, userPreferences, hashPassword, dailyTasks, dailySessions, dailyCompletions, streaks, submissions, userConceptState, contentItems } from "@cpd/core";
import { createContainer, buildLearnerProfile, evaluateSubmission } from "@cpd/ai";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const container = createContainer(db as never);

async function main() {
  const email = `eval-${Date.now()}@test.dev`;
  const [user] = await db
    .insert(users)
    .values({ email, name: "Eval User", passwordHash: await hashPassword("pass1234"), timezone: "UTC", primaryLanguage: "cpp", dailyGoalMinutes: 30, status: "ACTIVE" })
    .returning({ id: users.id });
  await db.insert(userPreferences).values({ userId: user.id, timezone: "UTC", quietHoursEnabled: false });

  const profile = await buildLearnerProfile(container.learnerDeps, user.id);
  const obj = await container.tutorEngine.decideObjective(user.id, profile);
  console.log("decision:", obj.decision, "objective node:", obj.objectiveNodeId);

  const session = await container.tutorEngine.composeSession(user.id, profile, obj);
  console.log("session:", session.sessionId, "task count:", session.tasks);
  const tasks = await db.select().from(dailyTasks).where(eq(dailyTasks.sessionId, session.sessionId));
  console.log("tasks:", tasks.map((t) => `${t.kind}:${t.contentItemId ? "resolved" : "?"}`).join(", "));
  const task = tasks[0]!;
  console.log("first task:", task.id);

  const evaluatorDeps = { submissions: container.submissionRepo, streaks: container.streakRepo };

  async function solve(t: { id: string; contentItemId: string | null }, wrongFirst: boolean) {
    const [item] = await db.select().from(contentItems).where(eq(contentItems.id, t.contentItemId!));
    const kind = (item.payload as { kind: string }).kind;
    if (kind === "LESSON" || kind === "REAL_WORLD" || kind === "PROJECT") {
      const r = await evaluateSubmission(evaluatorDeps, { userId: user.id, taskId: t.id, completed: true, durationMs: 5000 });
      console.log(`task ${kind} ->`, r.verdict, "| sessionCompleted:", r.sessionCompleted, "| xp:", r.xpEarned);
      return r;
    }
    if (kind === "CONCEPTUAL") {
      const payload = item.payload as { answerIndex: number };
      if (wrongFirst) {
        const f = await evaluateSubmission(evaluatorDeps, { userId: user.id, taskId: t.id, answer: (payload.answerIndex + 1) % 2, hintsUsed: 0, durationMs: 20000 });
        console.log(`WRONG ${kind} ->`, f.verdict, f.score, "| state:", f.nodeState);
      }
      const r = await evaluateSubmission(evaluatorDeps, { userId: user.id, taskId: t.id, answer: payload.answerIndex, hintsUsed: 1, durationMs: 15000 });
      console.log(`RIGHT ${kind} ->`, r.verdict, r.score, "| xp:", r.xpEarned, "| state:", r.nodeState, "| sessionCompleted:", r.sessionCompleted);
      return r;
    }
    if (kind === "ASSESSMENT") {
      const payload = item.payload as { questions: { kind: string; answerIndex?: number }[] };
      const answers = payload.questions.map((q, i) => ({ i, answer: q.kind === "MCQ" ? (q.answerIndex ?? 0) : "works" }));
      if (wrongFirst) {
        const bad = payload.questions.map((q, i) => ({ i, answer: q.kind === "MCQ" ? 0 : "no" }));
        const f = await evaluateSubmission(evaluatorDeps, { userId: user.id, taskId: t.id, answer: bad, hintsUsed: 0, durationMs: 20000 });
        console.log(`WRONG ${kind} ->`, f.verdict, f.score, "| state:", f.nodeState);
      }
      const r = await evaluateSubmission(evaluatorDeps, { userId: user.id, taskId: t.id, answer: answers, hintsUsed: 1, durationMs: 15000 });
      console.log(`RIGHT ${kind} ->`, r.verdict, r.score, "| xp:", r.xpEarned, "| state:", r.nodeState, "| sessionCompleted:", r.sessionCompleted);
      return r;
    }
    if (kind === "CODING" || kind === "DEBUGGING") {
      const payload = item.payload as { harness: { language: string }; referenceSolution: string };
      if (wrongFirst) {
        const f = await evaluateSubmission(evaluatorDeps, { userId: user.id, taskId: t.id, code: payload.referenceSolution.replace(/return/, "return 42 >"), language: payload.harness.language, hintsUsed: 0, durationMs: 20000 });
        console.log(`WRONG ${kind} ->`, f.verdict, f.score, "| state:", f.nodeState);
      }
      const r = await evaluateSubmission(evaluatorDeps, { userId: user.id, taskId: t.id, code: payload.referenceSolution, language: payload.harness.language, hintsUsed: 1, durationMs: 15000 });
      console.log(`RIGHT ${kind} ->`, r.verdict, r.score, "| xp:", r.xpEarned, "| state:", r.nodeState, "| sessionCompleted:", r.sessionCompleted);
      return r;
    }
    if (wrongFirst) {
      const f = await evaluateSubmission(evaluatorDeps, { userId: user.id, taskId: t.id, answer: 9999, hintsUsed: 0, durationMs: 20000 });
      console.log(`WRONG ${kind} ->`, f.verdict, f.score, "| state:", f.nodeState);
    }
    const r = await evaluateSubmission(evaluatorDeps, { userId: user.id, taskId: t.id, answer: 0, hintsUsed: 1, durationMs: 15000 });
    console.log(`RIGHT ${kind} ->`, r.verdict, r.score, "| xp:", r.xpEarned, "| state:", r.nodeState, "| sessionCompleted:", r.sessionCompleted);
    return r;
  }

  for (const t of tasks) {
    await solve(t, t === tasks[0]);
    const sess = await db.select().from(dailySessions).where(eq(dailySessions.id, session.sessionId)).then((r) => r[0]);
    if (sess.status === "COMPLETED") break;
  }

  const streakRow = await db.select().from(streaks).where(eq(streaks.userId, user.id)).then((r) => r[0]);
  console.log("streak:", streakRow?.currentLength, "longest:", streakRow?.longestLength);
  const subs = await db.select().from(submissions).where(eq(submissions.userId, user.id));
  const states = await db.select().from(userConceptState).where(eq(userConceptState.userId, user.id));
  console.log("submissions:", subs.length, "| concept states:", states.length, JSON.stringify(states.map((s) => s.state)));
  const sess = await db.select().from(dailySessions).where(eq(dailySessions.id, session.sessionId)).then((r) => r[0]);
  const comp = await db.select().from(dailyCompletions).where(eq(dailyCompletions.sessionId, session.sessionId));
  console.log("session status:", sess.status, "| completedAt:", sess.completedAt ? "set" : "null", "| completions row:", comp.length);
  console.log("E2E_DONE");
}

main().catch((e) => {
  console.error("E2E_FAIL", e);
  process.exit(1);
});
