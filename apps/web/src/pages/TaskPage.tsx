import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import PageHeader from "../components/PageHeader.js";
import LoadingState from "../components/LoadingState.js";

interface TaskDetail {
  id: string;
  kind: string;
  title: string;
  content: {
    prompt?: string;
    description?: string;
    starterCode?: string;
    hints?: { text: string; threshold: number }[];
    testCases?: { input: string; expected: string }[];
    options?: string[];
    acceptedAnswers?: string[];
  } | null;
  attempt: number;
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [code, setCode] = useState("");
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ passed: boolean; message: string } | null>(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      if (!id) {
        navigate("/dashboard", { replace: true });
        return;
      }
      try {
        const data = await api.task(id, controller.signal);
        if (!mountedRef.current) return;
        setTask(data as TaskDetail);
        const content = data.content as TaskDetail["content"];
        setCode(content?.starterCode ?? "");
      } catch (err) {
        if (controller.signal.aborted) return;
        if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load task");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [id, navigate]);

  const handleSubmit = async () => {
    if (!task) return;
    setSubmitting(true);
    try {
      const payload = task.kind === "CODING"
        ? { code, language: "cpp", hintsUsed }
        : task.kind === "CONCEPTUAL"
          ? { answer: Number(answer), hintsUsed }
          : { answer, hintsUsed };
      const res = await api.submit(task.id, payload) as { passed: boolean; message: string };
      if (mountedRef.current) setResult(res);
    } catch (err) {
      if (mountedRef.current) {
        setResult({ passed: false, message: err instanceof Error ? err.message : "Submit failed" });
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

  const hints = task.content?.hints ?? [];
  const visibleHints = hints.filter((h) => h.threshold <= hintsUsed);

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title={task.title}
        backTo="/dashboard"
        backLabel="&larr; Back"
        right={<span className="text-sm text-gray-500">Attempt #{task.attempt + 1}</span>}
      />

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {(task.content?.prompt || task.content?.description) && (
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="whitespace-pre-wrap text-sm">{task.content.prompt ?? task.content.description}</p>
          </div>
        )}

        {task.kind === "CODING" && (
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

        {task.kind === "CONCEPTUAL" && task.content?.options && (
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

        {(task.kind === "TRACING" || task.kind === "PREDICTION") && (
          <div>
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

        {!["CODING", "CONCEPTUAL", "TRACING", "PREDICTION"].includes(task.kind) && (
          <div className="bg-white rounded-lg shadow-sm p-4 text-center text-gray-500 text-sm">
            This task type is not yet supported in the web interface.
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
              result.passed
                ? "bg-green-50 border border-green-200 text-green-700"
                : "bg-red-50 border border-red-200 text-red-700"
            }`}
          >
            {result.passed ? "Passed!" : result.message}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || result?.passed}
          className="w-full bg-primary-600 text-white py-3 rounded-md hover:bg-primary-700 disabled:opacity-50 font-medium"
        >
          {submitting ? "Submitting..." : result?.passed ? "Completed" : "Submit"}
        </button>
      </main>
    </div>
  );
}
