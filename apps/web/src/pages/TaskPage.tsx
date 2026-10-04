import { useCallback, useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, type SubmitResult } from "../lib/api.js";
import PageHeader from "../components/PageHeader.js";
import LoadingState from "../components/LoadingState.js";

/**
 * Mirror of what apps/api/src/sanitize.ts actually sends for each payload kind.
 * Fields that are stripped server-side (prompt, referenceSolution, testCases,
 * answerIndex, ...) are deliberately absent so they can never be depended on.
 */
interface TaskContent {
  kind?: string;
  // LESSON
  sections?: { type: string; title: string; content: string; language?: string; calloutKind?: string }[];
  // CODING / DEBUGGING
  scaffold?: string;
  hints?: { text: string; threshold: number }[];
  explanationMd?: string;
  harness?: { language?: string; entryFn?: string; argTypes?: string[]; returnType?: string } | null;
  // CONCEPTUAL
  options?: string[];
  // TRACING / PREDICTION
  codeSnippet?: string;
  // ASSESSMENT
  promptMd?: string;
  questions?: { kind: string; prompt: string; options?: string[]; explanation?: string }[];
  // REAL_WORLD
  contextMd?: string;
  reflectionQuestions?: string[];
  // PROJECT
  briefMd?: string;
  requirements?: string[];
  checklist?: string[];
  rubric?: { criterion: string; maxPoints: number }[];
}

interface TaskDetail {
  id: string;
  kind: string;
  title: string;
  content: TaskContent | null;
  attempt: number;
}

/** Kinds the evaluator completes by marking them done (evaluator.ts:251-256). */
const SELF_MARK_KINDS = ["LESSON", "REAL_WORLD", "PROJECT"];

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [code, setCode] = useState("");
  const [answer, setAnswer] = useState("");
  /** ASSESSMENT answers keyed by question index: number for MCQ, string for EXPLAIN. */
  const [answers, setAnswers] = useState<Record<number, string | number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadTask = useCallback(async (signal?: AbortSignal, opts?: { seedEditor?: boolean }) => {
    if (!id) {
      navigate("/dashboard", { replace: true });
      return;
    }
    try {
      const data = await api.task(id, signal);
      if (!mountedRef.current || signal?.aborted) return;
      const detail = data as TaskDetail;
      setTask(detail);
      // scaffold is the starter code the server actually sends (sanitize.ts).
      // Seed ONLY on first load — re-seeding after a submit would wipe the
      // learner's work (especially painful when the verdict is FAIL).
      if (opts?.seedEditor) setCode(detail.content?.scaffold ?? "");
    } catch (err) {
      if (signal?.aborted) return;
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load task");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTask(controller.signal, { seedEditor: true });
    return () => controller.abort();
  }, [loadTask]);

  const handleSubmit = async () => {
    if (!task) return;
    setSubmitting(true);
    try {
      const cKind = task.content?.kind;
      let payload:
        | { code: string; language: string; hintsUsed: number }
        | { answer: unknown; hintsUsed: number }
        | { completed: true; hintsUsed: number };

      if (cKind === "CODING" || cKind === "DEBUGGING") {
        payload = { code, language: task.content?.harness?.language ?? "cpp", hintsUsed };
      } else if (cKind === "CONCEPTUAL") {
        if (answer === "") throw new Error("Select an answer first.");
        payload = { answer: Number(answer), hintsUsed };
      } else if (cKind === "ASSESSMENT") {
        payload = {
          answer: Object.entries(answers).map(([i, a]) => ({ i: Number(i), answer: a })),
          hintsUsed
        };
      } else if (SELF_MARK_KINDS.includes(cKind ?? "")) {
        payload = { completed: true, hintsUsed };
      } else {
        // TRACING / PREDICTION: plain text
        payload = { answer, hintsUsed };
      }

      const res = await api.submit(task.id, payload);
      if (!mountedRef.current) return;
      setResult(res);
      // Refresh attempt counter / DONE status without touching the editor.
      void loadTask();
    } catch (err) {
      if (mountedRef.current) {
        setResult({
          verdict: "FAIL",
          score: 0,
          feedback: [err instanceof Error ? err.message : "Submit failed"],
          attempt: 0
        });
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  if (loading) return <LoadingState label="Loading task..." />;
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4" role="alert">{error}</p>
          <button onClick={() => navigate("/dashboard")} className="text-primary-600 hover:underline text-sm">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }
  if (!task) return null;

  const ck = task.content?.kind;
  const hints = task.content?.hints ?? [];
  const visibleHints = hints.filter((h) => h.threshold <= hintsUsed);
  const passed = result?.verdict === "PASS";
  const feedback = result?.feedback.join("\n") ?? "";
  const harness = task.content?.harness ?? null;
  const isSelfMark = SELF_MARK_KINDS.includes(ck ?? "");
  const canSubmit =
    ck === "CODING" || ck === "DEBUGGING"
      ? code.trim().length > 0
      : ck === "CONCEPTUAL"
        ? answer !== ""
        : ck === "TRACING" || ck === "PREDICTION"
          ? answer.trim().length > 0
          : ck === "ASSESSMENT"
            ? Object.keys(answers).length > 0
            : true;

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title={task.title}
        backTo="/dashboard"
        backLabel="&larr; Back"
        right={
          <span className="text-sm text-gray-500">
            {passed ? "Completed" : `Attempt #${task.attempt + 1}`}
          </span>
        }
      />

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Problem statement: built from fields the server actually sends. */}
        {(ck === "CODING" || ck === "DEBUGGING") && (
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-800 mb-2">{task.title}</h2>
            <p className="text-sm text-gray-600 mb-2">
              {ck === "DEBUGGING"
                ? "The code below is broken. Find and fix the bug so all test cases pass."
                : "Implement the function below so all test cases pass."}
            </p>
            {harness && (
              <p className="font-mono text-sm text-primary-700 bg-primary-50 rounded px-2 py-1 inline-block">
                {harness.returnType ?? "auto"} {harness.entryFn ?? "solution"}
                ({(harness.argTypes ?? []).join(", ")})
              </p>
            )}
          </div>
        )}

        {/* CODING tasks */}
        {ck === "CODING" && (
          <div>
            <label htmlFor="task-code" className="block text-sm font-medium text-gray-700 mb-1">
              Your Code
            </label>
            <textarea
              id="task-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={12}
              className="w-full font-mono text-sm p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 sm:rows-16"
              placeholder="Write your solution..."
            />
          </div>
        )}

        {ck === "CONCEPTUAL" && task.content?.options && (
          <div className="bg-white rounded-lg shadow-sm p-4">
            <fieldset>
              <legend className="text-sm font-medium text-gray-700 mb-2">Select your answer</legend>
              <div className="space-y-2">
                {task.content.options.map((opt, i) => (
                  <label key={i} className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer">
                    <input
                      type="radio"
                      name="conceptual-answer"
                      value={i}
                      checked={answer === String(i)}
                      onChange={(e) => setAnswer(e.target.value)}
                      className="text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm">{opt}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        {ck === "CONCEPTUAL" && result && task.content?.explanationMd && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-3">
            <h4 className="text-sm font-medium text-blue-800 mb-1">Explanation</h4>
            <p className="whitespace-pre-wrap text-sm text-blue-700">{task.content.explanationMd}</p>
          </div>
        )}

        {(ck === "TRACING" || ck === "PREDICTION") && (
          <div>
            {task.content?.codeSnippet && (
              <div className="bg-white rounded-lg shadow-sm p-4 mb-3">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Code</h4>
                <pre className="bg-gray-900 text-green-400 rounded-md p-4 text-sm overflow-x-auto">
                  <code>{task.content.codeSnippet}</code>
                </pre>
              </div>
            )}
            <label htmlFor="task-answer" className="block text-sm font-medium text-gray-700 mb-1">
              Your Answer
            </label>
            <input
              id="task-answer"
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Type your answer..."
            />
          </div>
        )}

        {(ck === "TRACING" || ck === "PREDICTION") && result && task.content?.explanationMd && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-blue-800 mb-1">Explanation</h4>
            <p className="whitespace-pre-wrap text-sm text-blue-700">{task.content.explanationMd}</p>
          </div>
        )}

        {ck === "LESSON" && (
          <div className="space-y-4">
            {task.content?.sections && task.content.sections.length > 0 ? (
              task.content.sections.map((section, i) => (
                <div key={i} className="bg-white rounded-lg shadow-sm p-4">
                  {section.title && <h3 className="text-sm font-semibold text-gray-700 mb-2">{section.title}</h3>}
                  {section.type === "code" ? (
                    <pre className="bg-gray-900 text-green-400 rounded-md p-4 text-sm overflow-x-auto">
                      <code>{section.content}</code>
                    </pre>
                  ) : section.type === "callout" ? (
                    <div className={`rounded-md p-3 text-sm ${
                      section.calloutKind === "warning" ? "bg-yellow-50 text-yellow-800 border border-yellow-200" :
                      section.calloutKind === "common-mistake" ? "bg-red-50 text-red-800 border border-red-200" :
                      section.calloutKind === "real-world" ? "bg-blue-50 text-blue-800 border border-blue-200" :
                      "bg-gray-50 text-gray-700 border border-gray-200"
                    }`}>
                      <p className="whitespace-pre-wrap">{section.content}</p>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm text-gray-600">{section.content}</p>
                  )}
                </div>
              ))
            ) : (
              /* Fallback when no sections were generated */
              <>
                {task.content?.explanationMd && (
                  <div className="bg-white rounded-lg shadow-sm p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Explanation</h3>
                    <p className="whitespace-pre-wrap text-sm">{task.content.explanationMd}</p>
                  </div>
                )}
                {task.content?.codeSnippet && (
                  <div className="bg-white rounded-lg shadow-sm p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Code</h3>
                    <pre className="bg-gray-900 text-green-400 rounded-md p-4 text-sm overflow-x-auto">
                      <code>{task.content.codeSnippet}</code>
                    </pre>
                  </div>
                )}
              </>
            )}
            <div>
              <label htmlFor="task-answer" className="block text-sm font-medium text-gray-700 mb-1">
                What did you learn? (optional)
              </label>
              <textarea
                id="task-answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                placeholder="Summarize what you learned..."
              />
            </div>
          </div>
        )}

        {ck === "DEBUGGING" && (
          <div>
            <label htmlFor="task-code" className="block text-sm font-medium text-gray-700 mb-1">
              Your Fix
            </label>
            <textarea
              id="task-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={12}
              className="w-full font-mono text-sm p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Write the corrected code..."
            />
          </div>
        )}

        {ck === "ASSESSMENT" && task.content?.questions && (
          <div className="space-y-4">
            {task.content.promptMd && (
              <div className="bg-white rounded-lg shadow-sm p-4 text-sm text-gray-700 whitespace-pre-wrap">
                {task.content.promptMd}
              </div>
            )}
            {task.content.questions.map((q, i) => (
              <div key={i} className="bg-white rounded-lg shadow-sm p-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Q{i + 1}: {q.prompt}</p>
                {q.kind === "MCQ" && q.options && (
                  <div className="space-y-2">
                    {q.options.map((opt, j) => (
                      <label key={j} className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer">
                        <input
                          type="radio"
                          name={`q-${i}`}
                          value={j}
                          checked={answers[i] === j}
                          onChange={() => setAnswers((a) => ({ ...a, [i]: j }))}
                          className="text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-sm">{opt}</span>
                      </label>
                    ))}
                  </div>
                )}
                {q.kind === "EXPLAIN" && (
                  <textarea
                    rows={3}
                    value={typeof answers[i] === "string" ? (answers[i] as string) : ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Explain your understanding..."
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {ck === "REAL_WORLD" && (
          <div className="space-y-4">
            {task.content?.contextMd && (
              <div className="bg-white rounded-lg shadow-sm p-4 text-sm text-gray-700 whitespace-pre-wrap">
                {task.content.contextMd}
              </div>
            )}
            {task.content?.reflectionQuestions && task.content.reflectionQuestions.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Reflection</h3>
                <ul className="space-y-2 text-sm text-gray-600">
                  {task.content.reflectionQuestions.map((q, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-gray-400">{i + 1}.</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {ck === "PROJECT" && (
          <div className="space-y-4">
            {task.content?.briefMd && (
              <div className="bg-white rounded-lg shadow-sm p-4 text-sm text-gray-700 whitespace-pre-wrap">
                {task.content.briefMd}
              </div>
            )}
            {task.content?.requirements && task.content.requirements.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Requirements</h3>
                <ul className="space-y-1 text-sm text-gray-600 list-disc list-inside">
                  {task.content.requirements.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
            {task.content?.checklist && task.content.checklist.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Checklist</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  {task.content.checklist.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-gray-400">[ ]</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {task.content?.rubric && task.content.rubric.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Rubric</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {task.content.rubric.map((r, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="py-1.5 text-gray-600">{r.criterion}</td>
                        <td className="py-1.5 text-right text-gray-400">{r.maxPoints} pts</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* True catch-all for any kind without a dedicated renderer above. */}
        {!["CODING", "CONCEPTUAL", "TRACING", "PREDICTION", "LESSON", "DEBUGGING", "ASSESSMENT", "REAL_WORLD", "PROJECT"].includes(ck ?? "") && (
          <div>
            <label htmlFor="task-answer" className="block text-sm font-medium text-gray-700 mb-1">
              Your Answer
            </label>
            <textarea
              id="task-answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
              placeholder="Type your answer..."
            />
          </div>
        )}

        {(ck === "CODING" || ck === "DEBUGGING") && result && task.content?.explanationMd && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-blue-800 mb-1">Explanation</h4>
            <p className="whitespace-pre-wrap text-sm text-blue-700">{task.content.explanationMd}</p>
          </div>
        )}

        {visibleHints.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-yellow-800 mb-2">Hints</h3>
            {visibleHints.map((h, i) => (
              <p key={i} className="text-sm text-yellow-700 mb-1">{h.text}</p>
            ))}
          </div>
        )}

        {hints.length > 0 && (
          <button
            onClick={() => setHintsUsed((h) => h + 1)}
            className="text-sm text-primary-600 hover:underline"
          >
            Use a hint ({visibleHints.length}/{hints.length})
          </button>
        )}

        {result && (
          <div
            role="alert"
            className={`rounded-lg p-4 ${
              passed
                ? "bg-green-50 border border-green-200 text-green-700"
                : "bg-red-50 border border-red-200 text-red-700"
            }`}
          >
            <p className="whitespace-pre-wrap text-sm">
              {passed ? result.feedback[0] ?? "Passed!" : feedback || "Not quite right."}
            </p>
            {passed && (result.xpEarned || result.sessionCompleted) && (
              <p className="mt-1 text-sm opacity-80">
                {result.xpEarned ? `+${result.xpEarned} XP` : ""}
                {result.sessionCompleted ? "  Session complete!" : ""}
              </p>
            )}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || passed || !canSubmit}
          className="w-full bg-primary-600 text-white py-3 rounded-md hover:bg-primary-700 disabled:opacity-50 font-medium"
        >
          {submitting ? "Submitting..." : passed ? "Completed" : isSelfMark ? "Mark as done" : "Submit"}
        </button>
      </main>
    </div>
  );
}
