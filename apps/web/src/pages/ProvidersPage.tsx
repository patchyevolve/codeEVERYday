import { useEffect, useState, useCallback } from "react";
import {
  api,
  type AIProvider,
  type AIProviderModel,
  type ConnectionTestResult,
} from "../lib/api.js";
import PageHeader from "../components/PageHeader.js";
import LoadingState from "../components/LoadingState.js";

const PROVIDER_TYPES = [
  { value: "openai", label: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", icon: "🤖" },
  { value: "anthropic", label: "Anthropic", defaultBaseUrl: "https://api.anthropic.com", icon: "🧠" },
  { value: "gemini", label: "Google Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com", icon: "✨" },
  { value: "ollama", label: "Ollama (Local)", defaultBaseUrl: "http://localhost:11434", icon: "🦙" },
  { value: "openai_compatible", label: "OpenAI Compatible", defaultBaseUrl: "", icon: "🔌" },
  { value: "custom", label: "Custom Provider", defaultBaseUrl: "", icon: "⚙️" },
] as const;

interface ProviderForm {
  providerType: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  priority: number;
}

const EMPTY_FORM: ProviderForm = {
  providerType: "openai",
  displayName: "",
  baseUrl: "",
  apiKey: "",
  priority: 0,
};

export default function ProvidersPage() {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [models, setModels] = useState<AIProviderModel[]>([]);

  const loadProviders = useCallback(async () => {
    try {
      const data = await api.listProviders();
      setProviders(data.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  const handleTypeChange = (type: string) => {
    const defaults = PROVIDER_TYPES.find((t) => t.value === type);
    setForm((f) => ({
      ...f,
      providerType: type,
      baseUrl: f.baseUrl || defaults?.defaultBaseUrl || "",
      displayName: f.displayName || defaults?.label || "",
    }));
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testProvider({
        providerType: form.providerType,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, latencyMs: 0, error: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await api.updateProvider(editingId, {
          displayName: form.displayName,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey || undefined,
          priority: form.priority,
        });
      } else {
        await api.createProvider({
          providerType: form.providerType,
          displayName: form.displayName,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey || undefined,
          priority: form.priority,
        });
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      setTestResult(null);
      await loadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (provider: AIProvider) => {
    setEditingId(provider.id);
    setForm({
      providerType: provider.providerType,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      apiKey: "",
      priority: provider.priority,
    });
    setShowForm(true);
    setTestResult(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this provider? This cannot be undone.")) return;
    try {
      await api.deleteProvider(id);
      await loadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete provider");
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await api.updateProvider(id, { enabled });
      await loadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle provider");
    }
  };

  const handleFetchModels = async (providerId: string) => {
    setFetchingModels(true);
    try {
      await api.fetchProviderModels(providerId);
      setSelectedProvider(providerId);
      // Reload models from DB
      const data = await api.listProviderModels(providerId);
      setModels(data.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setFetchingModels(false);
    }
  };

  const handleToggleModel = async (providerId: string, modelId: string, enabled: boolean) => {
    try {
      await api.toggleProviderModel(providerId, modelId, enabled);
      const data = await api.listProviderModels(providerId);
      setModels(data.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle model");
    }
  };

  if (loading) return <LoadingState label="Loading providers..." />;

  const selectedProviderData = providers.find((p) => p.id === selectedProvider);

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="AI Providers" backTo="/dashboard" />

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm" role="alert">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
          </div>
        )}

        {/* Provider Cards */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Configured Providers</h2>
          <button
            onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true); setTestResult(null); }}
            className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 text-sm font-medium"
          >
            + Add Provider
          </button>
        </div>

        {providers.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">No AI providers configured yet.</p>
            <p className="text-sm text-gray-400">Add a provider to start using the AI tutor system.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {providers.map((provider) => {
              const typeInfo = PROVIDER_TYPES.find((t) => t.value === provider.providerType);
              return (
                <div
                  key={provider.id}
                  className={`bg-white rounded-lg border p-5 transition-all ${
                    provider.enabled
                      ? "border-gray-200 hover:border-primary-300 hover:shadow-md"
                      : "border-gray-100 opacity-60"
                  } ${selectedProvider === provider.id ? "ring-2 ring-primary-500 border-primary-300" : ""}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{typeInfo?.icon ?? "⚙️"}</span>
                      <div>
                        <h3 className="font-semibold text-gray-900">{provider.displayName}</h3>
                        <p className="text-xs text-gray-500">{typeInfo?.label ?? provider.providerType}</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={provider.enabled}
                        onChange={(e) => handleToggle(provider.id, e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
                    </label>
                  </div>

                  <div className="space-y-1 text-xs text-gray-500 mb-4 overflow-hidden">
                    <p className="truncate" title={provider.baseUrl}>{provider.baseUrl}</p>
                    <p className="truncate" title={provider.apiKeyMasked ?? "Not set"}>API Key: {provider.hasApiKey ? `✓ ${provider.apiKeyMasked}` : "✗ Not set"}</p>
                    <p>Priority: {provider.priority}</p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(provider)}
                      className="flex-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-md"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleFetchModels(provider.id)}
                      disabled={fetchingModels}
                      className="flex-1 text-xs bg-primary-50 hover:bg-primary-100 text-primary-700 px-3 py-1.5 rounded-md disabled:opacity-50"
                    >
                      {fetchingModels ? "..." : "Fetch Models"}
                    </button>
                    <button
                      onClick={() => handleDelete(provider.id)}
                      className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-md"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Model List */}
        {selectedProvider && selectedProviderData && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">
                Models — {selectedProviderData.displayName}
              </h3>
              <button
                onClick={() => setSelectedProvider(null)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Close
              </button>
            </div>

            {models.length === 0 ? (
              <p className="text-sm text-gray-500">No models found. Click "Fetch Models" to discover available models.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 font-medium text-gray-600">Model</th>
                      <th className="text-left py-2 font-medium text-gray-600">Context</th>
                      <th className="text-left py-2 font-medium text-gray-600">Output</th>
                      <th className="text-left py-2 font-medium text-gray-600">Cost In</th>
                      <th className="text-left py-2 font-medium text-gray-600">Cost Out</th>
                      <th className="text-right py-2 font-medium text-gray-600">Enabled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((model) => (
                      <tr key={model.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2">
                          <span className="font-mono text-xs">{model.modelId}</span>
                          {model.displayName !== model.modelId && (
                            <span className="ml-2 text-gray-400 text-xs">{model.displayName}</span>
                          )}
                        </td>
                        <td className="py-2 text-gray-500">{model.contextWindow.toLocaleString()}</td>
                        <td className="py-2 text-gray-500">{model.outputLimit.toLocaleString()}</td>
                        <td className="py-2 text-gray-500">${model.costPer1kIn.toFixed(4)}</td>
                        <td className="py-2 text-gray-500">${model.costPer1kOut.toFixed(4)}</td>
                        <td className="py-2 text-right">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={model.enabled}
                              onChange={(e) => handleToggleModel(selectedProvider, model.modelId, e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-8 h-4 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary-600"></div>
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Add/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {editingId ? "Edit Provider" : "Add Provider"}
                </h3>

                <div className="space-y-4">
                  {/* Provider Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Provider Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {PROVIDER_TYPES.map((t) => (
                        <button
                          key={t.value}
                          onClick={() => handleTypeChange(t.value)}
                          disabled={!!editingId}
                          className={`p-2 rounded-lg border text-sm text-center transition-all ${
                            form.providerType === t.value
                              ? "border-primary-500 bg-primary-50 text-primary-700"
                              : "border-gray-200 hover:border-gray-300"
                          } disabled:opacity-50`}
                        >
                          <span className="block text-lg">{t.icon}</span>
                          <span className="block text-xs mt-1">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Display Name */}
                  <div>
                    <label htmlFor="provider-name" className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                    <input
                      id="provider-name"
                      type="text"
                      value={form.displayName}
                      onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                      autoComplete="off"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                      placeholder="My OpenAI Provider"
                    />
                  </div>

                  {/* Base URL */}
                  <div>
                    <label htmlFor="provider-url" className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
                    <input
                      id="provider-url"
                      type="url"
                      value={form.baseUrl}
                      onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                      autoComplete="off"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm font-mono"
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>

                  {/* API Key */}
                  <div>
                    <label htmlFor="provider-key" className="block text-sm font-medium text-gray-700 mb-1">
                      API Key {editingId && <span className="text-gray-400">(leave blank to keep existing)</span>}
                    </label>
                    <input
                      id="provider-key"
                      type="password"
                      value={form.apiKey}
                      onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                      autoComplete="new-password"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm font-mono"
                      placeholder={form.providerType === "ollama" ? "Not required for Ollama" : "sk-..."}
                      disabled={form.providerType === "ollama"}
                    />
                  </div>

                  {/* Priority */}
                  <div>
                    <label htmlFor="provider-priority" className="block text-sm font-medium text-gray-700 mb-1">
                      Priority <span className="text-gray-400">(lower = higher priority)</span>
                    </label>
                    <input
                      id="provider-priority"
                      type="number"
                      value={form.priority}
                      onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                      min={0}
                      max={100}
                    />
                  </div>

                  {/* Test Connection */}
                  <div className="border-t border-gray-200 pt-4">
                    <button
                      onClick={handleTest}
                      disabled={testing || !form.baseUrl || (form.providerType !== "ollama" && !form.apiKey)}
                      className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {testing ? "Testing connection..." : "Test Connection"}
                    </button>

                    {testResult && (
                      <div className={`mt-3 p-3 rounded-lg text-sm ${
                        testResult.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
                      }`}>
                        {testResult.ok ? (
                          <div>
                            <p className="font-medium">✓ Connection successful ({testResult.latencyMs}ms)</p>
                            {testResult.models && (
                              <p className="mt-1 text-xs">Found {testResult.models.length} models</p>
                            )}
                          </div>
                        ) : (
                          <p>✗ {testResult.error}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => { setShowForm(false); setEditingId(null); setTestResult(null); }}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !form.displayName || !form.baseUrl}
                    className="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {saving ? "Saving..." : editingId ? "Update" : "Create"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
