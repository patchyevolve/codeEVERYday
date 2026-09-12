import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth.js";
import Login from "./pages/Login.js";
import Register from "./pages/Register.js";
import Dashboard from "./pages/Dashboard.js";
import SessionPage from "./pages/SessionPage.js";
import TaskPage from "./pages/TaskPage.js";
import Settings from "./pages/Settings.js";
import GraphPage from "./pages/GraphPage.js";

function ProtectedLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/session/:id" element={<SessionPage />} />
        <Route path="/tasks/:id" element={<TaskPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/graph" element={<GraphPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
