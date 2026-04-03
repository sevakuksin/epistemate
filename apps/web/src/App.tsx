import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { MenuPage } from "./pages/MenuPage";
import { HotSeatPage } from "./pages/HotSeatPage";
import { CreatePage } from "./pages/CreatePage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { useAuth } from "./state/auth";

function Protected({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <MenuPage />
          </Protected>
        }
      />
      <Route
        path="/play/hot-seat"
        element={
          <Protected>
            <HotSeatPage />
          </Protected>
        }
      />
      <Route
        path="/create/*"
        element={
          <Protected>
            <CreatePage />
          </Protected>
        }
      />
      <Route
        path="/play/vs-player"
        element={<PlaceholderPage title="Vs Player" message="Coming next (online/multiplayer)." />}
      />
      <Route
        path="/play/vs-npc"
        element={<PlaceholderPage title="Vs NPC" message="Coming next (NPC/AI)." />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
