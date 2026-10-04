import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth.js";
import Login from "./pages/Login.js";
import Register from "./pages/Register.js";
import Onboarding from "./pages/Onboarding.js";
import Dashboard from "./pages/Dashboard.js";
import SessionPage from "./pages/SessionPage.js";
import TaskPage from "./pages/TaskPage.js";
import Settings from "./pages/Settings.js";
import GraphPage from "./pages/GraphPage.js";
import ProvidersPage from "./pages/ProvidersPage.js";
import LoadingState from "./components/LoadingState.js";

function ProtectedLayout() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState label="Loading..." />;
  if (!user && location.pathname !== "/login" && location.pathname !== "/register" && location.pathname !== "/onboarding") {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/session/:id" element={<SessionPage />} />
        <Route path="/tasks/:id" element={<TaskPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/providers" element={<ProvidersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
