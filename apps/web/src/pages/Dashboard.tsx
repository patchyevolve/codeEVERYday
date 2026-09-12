import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { api, type WeakConcept } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.js";
import PageHeader from "../components/PageHeader.js";
import LoadingState from "../components/LoadingState.js";

export default function Dashboard() {
  const { user, streak, logout } = useAuth();
  const [weak, setWeak] = useState<WeakConcept[]>([]);
  const [today, setToday] = useState<{ id: string; kind: string; status: string; plannedMinutes: number } | null>(null);
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
      try {
        const dash = await api.dashboard(controller.signal);
        if (!mountedRef.current) return;
        setWeak(dash.weak);
        setToday(dash.today);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        if (mountedRef.current && !controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  if (loading) return <LoadingState label="Loading dashboard..." />;
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="text-primary-600 hover:underline text-sm">
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!user) return null;

  const handleLogout = () => {
    if (!window.confirm("Are you sure you want to log out?")) return;
    logout();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="Code Practice Daily"
        right={
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{user.name}</span>
            <span className="text-sm text-gray-500">Lv.{user.level} &middot; {user.totalXp} XP</span>
            <button onClick={handleLogout} className="text-sm text-red-600 hover:underline">
              Logout
            </button>
          </div>
        }
      />

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {streak && (
          <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-primary-600">{streak.currentLength}</p>
              <p className="text-xs text-gray-500">Day Streak</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-400">{streak.longestLength}</p>
              <p className="text-xs text-gray-500">Best</p>
            </div>
          </div>
        )}

        {today ? (
          <Link
            to={`/session/${today.id}`}
            className="block bg-primary-600 text-white rounded-lg shadow-sm p-6 hover:bg-primary-700 transition"
          >
            <p className="text-sm opacity-80">Today's Session</p>
            <p className="text-lg font-semibold mt-1">
              {today.kind} &middot; {today.plannedMinutes} min
            </p>
            <p className="text-sm mt-2 opacity-90">
              {today.status === "COMPLETED" ? "Completed!" : "Tap to start"}
            </p>
          </Link>
        ) : (
          <div className="bg-white rounded-lg shadow-sm p-6 text-center">
            <p className="text-gray-500 mb-2">No session today</p>
            <p className="text-xs text-gray-400">Come back tomorrow for your next practice session.</p>
          </div>
        )}

        {weak.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h2 className="font-semibold mb-3">Weak Concepts</h2>
            <div className="space-y-2">
              {weak.map((w) => (
                <div key={w.nodeKey} className="flex items-center justify-between text-sm">
                  <span>{w.label}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      w.state === "WEAK" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {w.state}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <nav className="flex flex-col sm:flex-row gap-3" aria-label="Quick links">
          <Link
            to="/settings"
            className="flex-1 bg-white rounded-lg shadow-sm p-4 text-center text-sm text-gray-700 hover:bg-gray-50"
          >
            Settings
          </Link>
          <Link
            to="/graph"
            className="flex-1 bg-white rounded-lg shadow-sm p-4 text-center text-sm text-gray-700 hover:bg-gray-50"
          >
            Knowledge Graph
          </Link>
        </nav>
      </main>
    </div>
  );
}
