import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../state/auth";

type Mode = "login" | "register";

export function LoginPage() {
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [registrationCode, setRegistrationCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "login") {
        const next = await api.login(username.trim(), password);
        login(next.user);
      } else {
        const created = await api.register(username.trim(), password, registrationCode.trim());
        login(created.user);
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Chess Variant Pilot</h1>
          <p className="subtitle">Design your rules. Play local or online.</p>
        </div>
      </div>
      <div className="card card-elevated" style={{ maxWidth: 520 }}>
        <h2>{mode === "login" ? "Sign In" : "Register"}</h2>

        <div className="row" style={{ marginBottom: 12 }}>
          <button type="button" onClick={() => setMode("login")} disabled={mode === "login"}>
            Login
          </button>
          <button type="button" onClick={() => setMode("register")} disabled={mode === "register"}>
            Register
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label>
              Username (3-20, A-Z a-z 0-9 _-)
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="player_name"
                style={{ width: "100%", marginTop: 6 }}
              />
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="your private password"
                style={{ width: "100%", marginTop: 6 }}
              />
            </label>
          </div>

          {mode === "register" ? (
            <div style={{ marginBottom: 12 }}>
              <label>
                Registration code
                <input
                  value={registrationCode}
                  onChange={(e) => setRegistrationCode(e.target.value)}
                  placeholder="invite code"
                  style={{ width: "100%", marginTop: 6 }}
                />
              </label>
            </div>
          ) : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
