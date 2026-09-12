import { useEffect, useState } from "react";
import { api, type GraphNode, type GraphEdge } from "../lib/api.js";
import PageHeader from "../components/PageHeader.js";
import LoadingState from "../components/LoadingState.js";

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export default function GraphPage() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const data = await api.graph(controller.signal);
        setGraph(data);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load graph");
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  if (loading) return <LoadingState label="Loading knowledge graph..." />;
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4" role="alert">{error}</p>
          <button onClick={() => window.location.reload()} className="text-primary-600 hover:underline text-sm">
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!graph) return null;

  const stateColor = (state?: string) => {
    switch (state) {
      case "MASTERED": return "bg-green-100 text-green-800 border-green-300";
      case "PROFICIENT": return "bg-blue-100 text-blue-800 border-blue-300";
      case "PRACTICING": return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "LEARNING": return "bg-orange-100 text-orange-800 border-orange-300";
      case "WEAK": case "REVIEW_REQUIRED": case "DECAYING":
        return "bg-red-100 text-red-800 border-red-300";
      default: return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="Knowledge Graph" backTo="/dashboard" />

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {graph.nodes.map((node) => (
            <div
              key={node.id}
              className={`rounded-lg border p-3 ${stateColor(node.state)}`}
            >
              <p className="font-medium text-sm">{node.label}</p>
              <p className="text-xs opacity-70 mt-1">
                {node.languageKey} &middot; depth {node.depth} &middot; ~{node.estMinutes}min
              </p>
              {node.mastery != null && (
                <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-current h-1.5 rounded-full transition-all"
                    style={{ width: `${Math.round(node.mastery * 100)}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {graph.nodes.length === 0 && (
          <div className="text-center text-gray-500 py-12">
            <p>No concepts loaded yet. Complete some sessions to build your knowledge graph.</p>
          </div>
        )}
      </main>
    </div>
  );
}
