import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../state/auth";

function MenuCard({
  title,
  path,
  description,
  comingSoon,
}: {
  title: string;
  path: string;
  description: string;
  comingSoon?: boolean;
}) {
  return (
    <Link to={path} style={{ textDecoration: "none" }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p>{description}</p>
        {comingSoon ? <strong>Coming next</strong> : <strong>Open</strong>}
      </div>
    </Link>
  );
}

export function MenuPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Main Menu</h1>
        <div className="row">
          <span>Logged in as: {user?.username}</span>
          <button
            onClick={() => {
              void logout().then(() => navigate("/login"));
            }}
          >
            Logout
          </button>
        </div>
      </div>
      <div className="menu-grid">
        <MenuCard title="Hot Seat" path="/play/hot-seat" description="Local two-player same-device mode." />
        <MenuCard
          title="Vs Player"
          path="/play/vs-player"
          description="Network multiplayer (placeholder for now)."
          comingSoon
        />
        <MenuCard title="Vs NPC" path="/play/vs-npc" description="Play against AI (placeholder)." comingSoon />
        <MenuCard title="Create" path="/create" description="Define piece types, boards, and setups." />
        <MenuCard title="Rulebook" path="/rulebook" description="Piece rules, prices, and budget mode." />
      </div>
    </div>
  );
}
