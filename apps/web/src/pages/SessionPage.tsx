import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, type Session, type Task } from "../lib/api.js";
import PageHeader from "../components/PageHeader.js";
import LoadingState from "../components/LoadingState.js";

function ckLabel(kind: string): string {
  const map: Record<string, string> = {
    LESSON: "Learn", CODING: "Coding", DEBUGGING: "Debug",
    CONCEPTUAL: "Concepts", TRACING: "Trace", PREDICTION: "Predict",
    ASSESSMENT: "Assess", REAL_WORLD: "Apply", PROJECT: "Project",
  };
  return map[kind] ?? kind;
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        if (!id) {
          navigate("/dashboard", { replace: true });
          return;
        }
        const data = await api.session(id, controller.signal);
        setSession(data.session);
        setTasks(data.tasks);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [id, navigate]);

  if (loading) return <LoadingState label="Loading session..." />;
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
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-500 mb-4">No session found</p>
          <button onClick={() => navigate("/dashboard")} className="text-primary-600 hover:underline text-sm">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title={`${session.kind} Session`}
        backTo="/dashboard"
        right={<span className="text-sm text-gray-500">{session.plannedMinutes} min</span>}
      />

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="space-y-3">
          {tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => navigate(`/tasks/${task.id}`)}
              className={`w-full text-left bg-white rounded-lg shadow-sm p-4 hover:bg-gray-50 transition flex items-center justify-between ${
                task.status === "DONE" ? "opacity-60" : ""
              }`}
            >
              <div>
                <p className="font-medium">{task.title}</p>
                <p className="text-sm text-gray-500">
                  {ckLabel((task.content as Record<string, unknown>)?.kind as string ?? task.kind)} &middot; ~{task.estMinutes} min
                </p>
              </div>
              <div className="text-right">
                {task.status === "DONE" ? (
                  <span className="text-green-600 text-sm">Done</span>
                ) : (
                  <span className="text-primary-600 text-sm">Start &rarr;</span>
                )}
              </div>
            </button>
          ))}
        </div>

        {tasks.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            <p>No tasks in this session yet.</p>
          </div>
        )}

        {session.status === "COMPLETED" && (
          <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4 text-center text-green-700">
            Session complete! Great work.
          </div>
        )}
      </main>
    </div>
  );
}
