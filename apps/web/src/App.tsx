import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { MenuPage } from "./pages/MenuPage";
import { HotSeatPage } from "./pages/HotSeatPage";
import { VsNpcPage } from "./pages/VsNpcPage";
import { CreatePage } from "./pages/CreatePage";
import { VsPlayerPage } from "./pages/VsPlayerPage";
import { OnlineGamePage } from "./pages/OnlineGamePage";
import { RulebookPage } from "./pages/RulebookPage";
import { useAuth } from "./state/auth";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page"><p>Loading session...</p></div>;
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
        path="/rulebook"
        element={
          <Protected>
            <RulebookPage />
          </Protected>
        }
      />
      <Route
        path="/play/vs-player/game/:gameId"
        element={
          <Protected>
            <OnlineGamePage />
          </Protected>
        }
      />
      <Route
        path="/play/vs-player"
        element={
          <Protected>
            <VsPlayerPage />
          </Protected>
        }
      />
      <Route
        path="/play/vs-npc"
        element={
          <Protected>
            <VsNpcPage />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
