import { useState } from "react";
import { Link } from "react-router-dom";

type PlayMode = "chess" | "epistemate" | "custom";

export function VsPlayerPage() {
  const [mode, setMode] = useState<PlayMode | null>(null);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Play Online</h1>
        <Link to="/">Back to menu</Link>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3>Choose Mode</h3>
        <div className="row">
          <button onClick={() => setMode("chess")}>Chess</button>
          <button onClick={() => setMode("epistemate")}>Epistemate</button>
          <button onClick={() => setMode("custom")}>Custom</button>
        </div>
      </div>

      {mode ? (
        <div className="card">
          <p>
            Selected mode: <strong>{mode === "epistemate" ? "Epistemate" : mode === "chess" ? "Chess" : "Custom"}</strong>
          </p>
          <p>Online multiplayer for this mode is coming next.</p>
        </div>
      ) : null}
    </div>
  );
}
