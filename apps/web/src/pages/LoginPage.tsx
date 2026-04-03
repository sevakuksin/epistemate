import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../state/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const [username, setUsername] = useState(user?.username ?? "");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const next = await api.createSession(username.trim());
      login(next);
      navigate("/");
    } catch {
      setError("Failed to login. Is the API running?");
    }
  }

  return (
    <div className="page">
      <h1>Chess Variant Pilot</h1>
      <div className="card" style={{ maxWidth: 420 }}>
        <h2>Local Login</h2>
        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Player name"
                style={{ width: "100%", marginTop: 6 }}
              />
            </label>
          </div>
          <button type="submit">Enter</button>
          {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
