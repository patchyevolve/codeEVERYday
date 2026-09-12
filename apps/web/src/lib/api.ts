const API = "/api";

export interface User {
  id: string;
  email: string;
  name: string;
  level: number;
  totalXp: number;
}

export interface Preferences {
  languageKey: string;
  timezone: string;
  dailyMinutes: number;
  startTimeLocal: string;
  difficultyPref: number;
}

export interface Streak {
  currentLength: number;
  longestLength: number;
  lastCompletedDate: string | null;
}

export interface Task {
  id: string;
  kind: string;
  position: number;
  title: string;
  estMinutes: number;
  required: boolean;
  status: string;
  completedAt: string | null;
  content: unknown;
}

export interface Session {
  id: string;
  kind: string;
  status: string;
  plannedMinutes: number;
  completedAt: string | null;
}

export interface WeakConcept {
  nodeKey: string;
  label: string;
  state: string;
  mastery: number;
}

export interface GoalMilestone {
  id: string;
  title: string;
  status: string;
  position: number;
}

export interface Goal {
  id: string;
  domain: string;
  title: string;
  status: string;
  position: number;
  milestones: GoalMilestone[];
}

export interface GraphNode {
  id: string;
  nodeKey: string;
  label: string;
  difficulty: number;
  estMinutes: number;
  depth: number;
  languageKey: string;
  state?: string;
  mastery?: number;
  nextReviewAt?: string;
}

export interface GraphEdge {
  fromId: string;
  toId: string;
  kind: string;
}

export interface Notification {
  kind: string;
  message: string;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function safeRequest<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  }
  const text = await res.text();
  return JSON.parse(text) as T;
}

export const api = {
  register: (data: { email: string; name: string; password: string }) =>
    safeRequest<{ user: User }>("/auth/register", { method: "POST", body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    safeRequest<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify(data) }),

  logout: () => safeRequest<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: (signal?: AbortSignal) =>
    safeRequest<{ user: User; preferences: Preferences; streak: Streak | null }>("/me", { signal }),

  dashboard: (signal?: AbortSignal) =>
    safeRequest<{
      streak: Streak | null;
      weak: WeakConcept[];
      goals: Goal[];
      today: { id: string; kind: string; status: string; plannedMinutes: number } | null;
    }>("/dashboard", { signal }),

  today: (signal?: AbortSignal) =>
    safeRequest<{ session: Session; tasks: Task[] }>("/today", { signal }),

  task: (id: string, signal?: AbortSignal) =>
    safeRequest<{ id: string; kind: string; title: string; content: unknown; attempt: number }>(`/tasks/${id}`, { signal }),

  submit: (taskId: string, data: { answer?: unknown; code?: string; language?: string; hintsUsed?: number }) =>
    safeRequest<unknown>(`/tasks/${taskId}/submit`, { method: "POST", body: JSON.stringify(data) }),

  settings: (signal?: AbortSignal) =>
    safeRequest<{ preferences: Preferences }>("/settings", { signal }),

  updateSettings: (data: Partial<Preferences>) =>
    safeRequest<{ ok: true }>("/settings", { method: "PUT", body: JSON.stringify(data) }),

  graph: (signal?: AbortSignal) =>
    safeRequest<{ nodes: GraphNode[]; edges: GraphEdge[] }>("/graph", { signal }),

  notifications: (signal?: AbortSignal) =>
    safeRequest<{ notifications: Notification[] }>("/notifications", { signal }),
};
