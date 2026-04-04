import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { GameSetup } from "@cv/shared";
import { api, type Friend, type FriendRequest, type GameInvite, type User } from "../api";
import { wsClient } from "../realtime/wsClient";
import { useAuth } from "../state/auth";

type PlayMode = "chess" | "epistemate" | "custom";

export function VsPlayerPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<PlayMode>("chess");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incomingReqs, setIncomingReqs] = useState<FriendRequest[]>([]);
  const [outgoingReqs, setOutgoingReqs] = useState<FriendRequest[]>([]);
  const [incomingInvites, setIncomingInvites] = useState<GameInvite[]>([]);
  const [outgoingInvites, setOutgoingInvites] = useState<GameInvite[]>([]);
  const [games, setGames] = useState<any[]>([]);
  const [setups, setSetups] = useState<GameSetup[]>([]);
  const [customSetupId, setCustomSetupId] = useState("");
  const [status, setStatus] = useState("");
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  async function refresh() {
    if (!user) return;
    const [f, inReq, outReq, inInv, outInv, g, s] = await Promise.all([
      api.listFriends(),
      api.incomingFriendRequests(),
      api.outgoingFriendRequests(),
      api.incomingInvites(),
      api.outgoingInvites(),
      api.listGames("active"),
      api.listSetups(user.id),
    ]);
    setFriends(f.friends);
    setIncomingReqs(inReq.requests);
    setOutgoingReqs(outReq.requests);
    setIncomingInvites(inInv.invites);
    setOutgoingInvites(outInv.invites);
    setGames(g.games);
    setSetups(s);
    if (!customSetupId && s.length > 0) setCustomSetupId(s[0].id);
  }

  useEffect(() => {
    void refresh().catch((e) => setStatus(e instanceof Error ? e.message : "Failed to load online lobby"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const unsub = wsClient.addListener((event) => {
      if (event.type === "presence") {
        setOnlineUserIds(new Set(event.onlineUserIds));
        return;
      }
      if (event.type === "welcome" || event.type === "ws_connected") {
        void refresh().catch(() => {
          // noop
        });
        return;
      }
      if (event.type === "lobby_updated" || event.type === "game_updated") {
        void refresh().catch(() => {
          // noop
        });
      }
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, customSetupId]);

  async function doSearch() {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const out = await api.searchUsers(query.trim());
      setSearchResults(out.users);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Search failed");
    }
  }

  async function sendFriendRequest(toUserId: string) {
    try {
      await api.sendFriendRequest(toUserId);
      setStatus("Friend request sent");
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Friend request failed");
    }
  }

  async function inviteFriend(friendId: string) {
    try {
      await api.sendGameInvite(friendId, mode, mode === "custom" ? customSetupId : undefined);
      setStatus(`Invite sent (${mode})`);
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Invite failed");
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Play Online</h1><p className="subtitle">Friends, invites, and active games in one lobby.</p></div>
        <Link to="/">Back to menu</Link>
      </div>

      {status ? <p className="badge warn">{status}</p> : null}

      <div className="card card-elevated" style={{ marginBottom: 12 }}>
        <h3>Invite Mode</h3>
        <div className="row">
          <button onClick={() => setMode("chess")} disabled={mode === "chess"}>Chess</button>
          <button onClick={() => setMode("epistemate")} disabled={mode === "epistemate"}>Epistemate</button>
          <button onClick={() => setMode("custom")} disabled={mode === "custom"}>Custom</button>
        </div>
        {mode === "custom" ? (
          <label>
            Custom setup
            <select value={customSetupId} onChange={(e) => setCustomSetupId(e.target.value)}>
              {setups.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3>Find Players</h3>
        <div className="row">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="username prefix" />
          <button onClick={() => void doSearch()}>Search</button>
        </div>
        <ul>
          {searchResults.map((u) => (
            <li key={u.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>{u.username}</span>
              <button onClick={() => void sendFriendRequest(u.id)}>Add friend</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid-2" style={{ alignItems: "stretch" }}>
        <div className="card" style={{ flex: 1 }}>
          <h3>Friends</h3>
          <ul>
            {friends.map((f) => {
              const online = onlineUserIds.has(f.id);
              return (
                <li key={f.id} className="row" style={{ justifyContent: "space-between" }}>
                  <span>{f.username} <span className={`badge ${online ? "ok" : "warn"}`}>{online ? "online" : "offline"}</span></span>
                  <button onClick={() => void inviteFriend(f.id)}>Invite ({mode})</button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card" style={{ flex: 1 }}>
          <h3>Friend Requests</h3>
          <h4>Incoming</h4>
          <ul>
            {incomingReqs.map((r) => (
              <li key={r.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>{r.from_username ?? r.from_user_id}</span>
                <span>
                  <button onClick={() => void api.acceptFriendRequest(r.id).then(refresh)}>Accept</button>
                  <button onClick={() => void api.declineFriendRequest(r.id).then(refresh)}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
          <h4>Outgoing</h4>
          <ul>
            {outgoingReqs.map((r) => (
              <li key={r.id}>{r.to_username ?? r.to_user_id}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: "stretch" }}>
        <div className="card" style={{ flex: 1 }}>
          <h3>Incoming Game Invites</h3>
          <ul>
            {incomingInvites.map((inv) => (
              <li key={inv.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>{inv.from_username ?? inv.from_user_id} ({inv.mode})</span>
                <span>
                  <button onClick={() => void api.acceptInvite(inv.id).then((r) => navigate(`/play/vs-player/game/${r.game.id}`))}>Accept</button>
                  <button onClick={() => void api.declineInvite(inv.id).then(refresh)}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card" style={{ flex: 1 }}>
          <h3>Outgoing Game Invites</h3>
          <ul>
            {outgoingInvites.map((inv) => (
              <li key={inv.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>{inv.to_username ?? inv.to_user_id} ({inv.mode})</span>
                <button onClick={() => void api.cancelInvite(inv.id).then(refresh)}>Cancel</button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <h3>Active Games</h3>
        <ul>
          {games.map((g) => (
            <li key={g.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>{g.id} - {g.mode} - turn: {g.current_turn_side}</span>
              <button onClick={() => navigate(`/play/vs-player/game/${g.id}`)}>Open</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
