import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Preferences } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.js";
import PageHeader from "../components/PageHeader.js";
import LoadingState from "../components/LoadingState.js";

export default function Settings() {
  const navigate = useNavigate();
  const { preferences: authPrefs, refresh } = useAuth();
  const [, setPrefs] = useState<Preferences | null>(authPrefs);
  const [languageKey, setLanguageKey] = useState(authPrefs?.languageKey ?? "cpp");
  const [dailyMinutes, setDailyMinutes] = useState(authPrefs?.dailyMinutes ?? 45);
  const [timezone, setTimezone] = useState(authPrefs?.timezone ?? "UTC");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!authPrefs);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (authPrefs) {
      setPrefs(authPrefs);
      setLanguageKey(authPrefs.languageKey);
      setDailyMinutes(authPrefs.dailyMinutes);
      setTimezone(authPrefs.timezone);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const data = await api.settings(controller.signal);
        setPrefs(data.preferences);
        setLanguageKey(data.preferences.languageKey);
        setDailyMinutes(data.preferences.dailyMinutes);
        setTimezone(data.preferences.timezone);
      } catch {
        if (!controller.signal.aborted) {
          setError("Failed to load settings");
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [authPrefs]);

  const handleSave = async () => {
    setError(null);
    try {
      await api.updateSettings({ languageKey, dailyMinutes, timezone });
      setSaved(true);
      await refresh();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    }
  };

  if (loading) return <LoadingState label="Loading settings..." />;

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="Settings" backTo="/dashboard" />

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
          <div>
            <label htmlFor="settings-language" className="block text-sm font-medium text-gray-700 mb-1">Language</label>
            <select
              id="settings-language"
              value={languageKey}
              onChange={(e) => setLanguageKey(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="cpp">C++</option>
              <option value="python">Python</option>
              <option value="rust">Rust</option>
              <option value="c">C</option>
              <option value="js">JavaScript</option>
              <option value="bash">Bash</option>
              <option value="sql">SQL</option>
              <option value="asm">Assembly</option>
            </select>
          </div>
          <div>
            <label htmlFor="settings-minutes" className="block text-sm font-medium text-gray-700 mb-1">
              Daily Practice (minutes)
            </label>
            <input
              id="settings-minutes"
              type="number"
              value={dailyMinutes}
              onChange={(e) => setDailyMinutes(Number(e.target.value))}
              min={10}
              max={240}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="settings-timezone" className="block text-sm font-medium text-gray-700 mb-1">
              Timezone
            </label>
            <select
              id="settings-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="UTC">UTC</option>
              <option value="America/New_York">Eastern (US)</option>
              <option value="America/Chicago">Central (US)</option>
              <option value="America/Denver">Mountain (US)</option>
              <option value="America/Los_Angeles">Pacific (US)</option>
              <option value="Europe/London">London</option>
              <option value="Europe/Berlin">Berlin</option>
              <option value="Asia/Kolkata">India</option>
              <option value="Asia/Tokyo">Tokyo</option>
            </select>
          </div>
          {error && (
            <p className="text-red-600 text-sm" role="alert" aria-live="assertive">
              {error}
            </p>
          )}
          <button
            onClick={handleSave}
            className="bg-primary-600 text-white px-6 py-2 rounded-md hover:bg-primary-700"
          >
            {saved ? "Saved!" : "Save Changes"}
          </button>
        </div>

        {/* Danger Zone */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-red-200">
          <h3 className="text-sm font-semibold text-red-700 mb-2">Danger Zone</h3>
          <p className="text-sm text-gray-500 mb-4">Permanently delete your account and all data. This cannot be undone.</p>
          <button
            onClick={async () => {
              if (!window.confirm("Are you sure? This will delete ALL your data permanently.")) return;
              if (!window.confirm("Last chance — type nothing, just confirm again.")) return;
              try {
                await api.deleteAccount();
                navigate("/login", { replace: true });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to delete account");
              }
            }}
            className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 text-sm"
          >
            Delete Account
          </button>
        </div>
      </main>
    </div>
  );
}
