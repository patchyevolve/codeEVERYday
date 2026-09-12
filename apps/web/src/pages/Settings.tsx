import { useEffect, useState, useRef } from "react";
import { api, type Preferences } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.js";
import PageHeader from "../components/PageHeader.js";
import LoadingState from "../components/LoadingState.js";

export default function Settings() {
  const { preferences: authPrefs, refresh } = useAuth();
  const [prefs, setPrefs] = useState<Preferences | null>(authPrefs);
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
      await api.updateSettings({ dailyMinutes, timezone });
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
            <p className="text-sm font-medium text-gray-700 mb-1">Language</p>
            <p className="text-sm text-gray-500">{(prefs?.languageKey ?? "cpp").toUpperCase()}</p>
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
      </main>
    </div>
  );
}
