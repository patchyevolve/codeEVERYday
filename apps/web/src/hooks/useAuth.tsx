import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, type User, type Preferences, type Streak, ApiError } from "../lib/api.js";

interface AuthState {
  user: User | null;
  preferences: Preferences | null;
  streak: Streak | null;
  loading: boolean;
  error: string | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  preferences: null,
  streak: null,
  loading: true,
  error: null,
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAuth = useCallback(async (signal?: AbortSignal) => {
    try {
      setError(null);
      const data = await api.me(signal);
      setUser(data.user);
      setPreferences(data.preferences);
      setStreak(data.streak);
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ApiError && err.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load user");
    }
  }, [navigate]);

  useEffect(() => {
    const controller = new AbortController();
    fetchAuth(controller.signal).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [fetchAuth]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setPreferences(null);
      setStreak(null);
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const refresh = useCallback(async () => {
    await fetchAuth();
  }, [fetchAuth]);

  return (
    <AuthContext.Provider value={{ user, preferences, streak, loading, error, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
