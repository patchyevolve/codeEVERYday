import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";

const LANGUAGES = [
  { value: "cpp", label: "C++", desc: "Systems, algorithms, competitive programming" },
  { value: "python", label: "Python", desc: "Data science, AI, scripting" },
  { value: "rust", label: "Rust", desc: "Systems, safety, performance" },
  { value: "c", label: "C", desc: "Low-level, OS, embedded" },
  { value: "js", label: "JavaScript", desc: "Web, Node.js, full-stack" },
  { value: "bash", label: "Bash", desc: "Shell scripting, DevOps" },
  { value: "sql", label: "SQL", desc: "Databases, data analysis" },
  { value: "asm", label: "Assembly", desc: "Low-level, reverse engineering" },
];

const DOMAINS = [
  { value: "GENERAL", label: "General Programming", desc: "Broad programming skills" },
  { value: "SYSTEMS", label: "Systems Programming", desc: "OS, concurrency, memory" },
  { value: "NETWORKING", label: "Networking", desc: "Protocols, sockets, distributed" },
  { value: "CYBERSECURITY", label: "Cybersecurity", desc: "Crypto, vulnerabilities, security" },
  { value: "LOW_LEVEL", label: "Low-Level", desc: "Assembly, memory layout, ABI" },
  { value: "AI_ENGINEERING", label: "AI/ML Engineering", desc: "Models, training, inference" },
  { value: "WEBDEV", label: "Web Development", desc: "Frontend, backend, full-stack" },
];

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState("cpp");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  const [dailyMinutes, setDailyMinutes] = useState(45);
  const [domain, setDomain] = useState("GENERAL");
  const [goalTitle, setGoalTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const steps = ["Language", "Experience", "Schedule", "Goal"];

  const handleFinish = async () => {
    setError("");
    setLoading(true);
    try {
      await api.onboarding({
        languageKey: language,
        timezone,
        dailyMinutes,
        goals: [
          {
            domain,
            title: goalTitle || `Learn ${LANGUAGES.find((l) => l.value === language)?.label ?? language}`,
            milestones: ["Complete first week of practice", "Build 3 projects", "Master core concepts"],
          },
        ],
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preferences");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <main className="w-full max-w-lg bg-white rounded-xl shadow-lg p-8">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full ${i <= step ? "bg-primary-600" : "bg-gray-200"}`} />
              <p className={`text-xs mt-1 ${i === step ? "text-primary-600 font-medium" : "text-gray-400"}`}>{s}</p>
            </div>
          ))}
        </div>

        {/* Step 0: Language */}
        {step === 0 && (
          <div>
            <h2 className="text-xl font-bold mb-1">What language do you want to practice?</h2>
            <p className="text-sm text-gray-500 mb-6">This determines your practice sessions and exercises.</p>
            <div className="grid grid-cols-2 gap-3">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.value}
                  onClick={() => setLanguage(lang.value)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    language === lang.value
                      ? "border-primary-500 bg-primary-50 ring-2 ring-primary-200"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className="font-medium text-sm">{lang.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{lang.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Experience */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold mb-1">What do you want to focus on?</h2>
            <p className="text-sm text-gray-500 mb-6">Pick a domain. You can change this later.</p>
            <div className="space-y-3">
              {DOMAINS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDomain(d.value)}
                  className={`w-full p-3 rounded-lg border text-left transition-all ${
                    domain === d.value
                      ? "border-primary-500 bg-primary-50 ring-2 ring-primary-200"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className="font-medium text-sm">{d.label}</p>
                  <p className="text-xs text-gray-500">{d.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Schedule */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold mb-1">Set your schedule</h2>
              <p className="text-sm text-gray-500">How much time can you dedicate daily?</p>
            </div>
            <div>
              <label htmlFor="ob-minutes" className="block text-sm font-medium text-gray-700 mb-1">
                Daily practice: <span className="font-bold text-primary-600">{dailyMinutes} min</span>
              </label>
              <input
                id="ob-minutes"
                type="range"
                min={10}
                max={120}
                step={5}
                value={dailyMinutes}
                onChange={(e) => setDailyMinutes(Number(e.target.value))}
                className="w-full accent-primary-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>10 min</span>
                <span>120 min</span>
              </div>
            </div>
            <div>
              <label htmlFor="ob-tz" className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
              <select
                id="ob-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Step 3: Goal */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold mb-1">Set your first goal</h2>
              <p className="text-sm text-gray-500">What do you want to achieve? We'll create milestones for you.</p>
            </div>
            <div>
              <label htmlFor="ob-goal" className="block text-sm font-medium text-gray-700 mb-1">Goal</label>
              <input
                id="ob-goal"
                type="text"
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                placeholder={`e.g. Master ${LANGUAGES.find((l) => l.value === language)?.label ?? "programming"} fundamentals`}
              />
              <p className="text-xs text-gray-400 mt-1">Leave blank for a default goal based on your language.</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
              <p className="font-medium mb-2">Here's what you're setting up:</p>
              <ul className="space-y-1 text-xs">
                <li>Language: <span className="font-medium">{LANGUAGES.find((l) => l.value === language)?.label}</span></li>
                <li>Focus: <span className="font-medium">{DOMAINS.find((d) => d.value === domain)?.label}</span></li>
                <li>Daily: <span className="font-medium">{dailyMinutes} minutes</span></li>
                <li>Timezone: <span className="font-medium">{timezone}</span></li>
              </ul>
            </div>
          </div>
        )}

        {error && <p className="text-red-600 text-sm mt-4" role="alert">{error}</p>}

        {/* Navigation */}
        <div className="flex gap-3 mt-8">
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg hover:bg-gray-200 text-sm font-medium"
            >
              Back
            </button>
          )}
          {step < steps.length - 1 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="flex-1 bg-primary-600 text-white py-2.5 rounded-lg hover:bg-primary-700 text-sm font-medium"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={loading}
              className="flex-1 bg-primary-600 text-white py-2.5 rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium"
            >
              {loading ? "Setting up..." : "Start Practicing"}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
