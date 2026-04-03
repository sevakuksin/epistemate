import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CompactMove, GameState } from "@cv/engine";
import { deserializeGame, generatePseudoLegalMoves } from "@cv/engine";
import type { GameSetup, PieceInstance } from "@cv/shared";
import { api, type GameRecord } from "../api";
import { wsClient } from "../realtime/wsClient";
import { useAuth } from "../state/auth";

function squareColor(x: number, y: number): "light" | "dark" {
  return (x + y) % 2 === 0 ? "light" : "dark";
}

function coordMatch(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function coordFromDisplay(
  displayX: number,
  displayY: number,
  width: number,
  height: number,
  flipped: boolean
): { x: number; y: number } {
  if (!flipped) return { x: displayX, y: displayY };
  return { x: width - 1 - displayX, y: height - 1 - displayY };
}

function moveLabel(m: CompactMove): string {
  return `${m.pieceId}: (${m.from.x},${m.from.y}) -> (${m.to.x},${m.to.y})${m.captureId ? ` x ${m.captureId}` : ""}`;
}

function pieceAssetForSide(setup: GameSetup, piece: PieceInstance): string | undefined {
  const typeDef = setup.pieceTypes.find((t) => t.id === piece.typeId);
  if (!typeDef) return undefined;
  if (piece.side === "white" || piece.side === "black") {
    return typeDef.assetBySide?.[piece.side] ?? typeDef.asset;
  }
  return typeDef.asset;
}

export function OnlineGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { user } = useAuth();
  const [game, setGame] = useState<GameRecord | null>(null);
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<CompactMove[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const mySide = useMemo(() => {
    if (!game || !user) return null;
    if (game.white_user_id === user.id) return "white";
    if (game.black_user_id === user.id) return "black";
    return null;
  }, [game, user]);

  const boardFlipped = mySide === "black";

  async function refresh() {
    if (!gameId) return;
    const g = await api.getGame(gameId);
    const parsedSetup = JSON.parse(g.game.setup_json) as GameSetup;
    const stateRes = await api.gameState(gameId);
    const parsedState = deserializeGame(stateRes.state);
    setGame(g.game);
    setSetup(parsedSetup);
    setState(parsedState);
  }

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    refresh()
      .catch((e) => setStatus(e instanceof Error ? e.message : "Failed to load game"))
      .finally(() => setLoading(false));

    const unsubscribeGame = wsClient.subscribeGame(gameId);
    const unsubscribeListener = wsClient.addListener((event) => {
      if (event.type === "ws_connected") {
        wsClient.requestGameSync(gameId);
        return;
      }
      if (event.type === "game_updated" && event.gameId === gameId) {
        wsClient.requestGameSync(gameId);
        return;
      }
      if (event.type === "game_snapshot" && event.gameId === gameId) {
        setGame(event.game as GameRecord);
        setSetup(JSON.parse((event.game as GameRecord).setup_json) as GameSetup);
        setState(deserializeGame(event.state));
      }
    });

    const fallbackId = window.setInterval(() => {
      void refresh().catch(() => {
        // keep last state
      });
    }, 30000);

    return () => {
      unsubscribeGame();
      unsubscribeListener();
      window.clearInterval(fallbackId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  function onSquareClick(displayX: number, displayY: number) {
    if (!state || !game || !mySide) return;
    if (game.status !== "active") return;

    const real = coordFromDisplay(
      displayX,
      displayY,
      state.board.width,
      state.board.height,
      boardFlipped
    );
    const x = real.x;
    const y = real.y;

    const turnSide = state.sides[state.currentTurnIndex];
    const clickedMove = legalMoves.find((m) => coordMatch(m.to, { x, y }));
    if (clickedMove) {
      void api
        .playMove(game.id, clickedMove)
        .then(() => {
          setSelectedPieceId(null);
          setLegalMoves([]);
          if (gameId) wsClient.requestGameSync(gameId);
        })
        .catch((e) => setStatus(e instanceof Error ? e.message : "Move failed"));
      return;
    }

    const hit = [...state.pieces.values()].find((p) => p.x === x && p.y === y);
    if (!hit) {
      setSelectedPieceId(null);
      setLegalMoves([]);
      return;
    }

    if (turnSide !== mySide || hit.side !== mySide) {
      return;
    }

    setSelectedPieceId(hit.instanceId);
    setLegalMoves(generatePseudoLegalMoves(state, hit.instanceId));
  }

  async function offerDraw() {
    if (!gameId) return;
    try {
      await api.offerDraw(gameId);
      wsClient.requestGameSync(gameId);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Draw offer failed");
    }
  }

  async function acceptDraw() {
    if (!gameId) return;
    try {
      await api.acceptDraw(gameId);
      wsClient.requestGameSync(gameId);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Draw accept failed");
    }
  }

  async function declineDraw() {
    if (!gameId) return;
    try {
      await api.declineDraw(gameId);
      wsClient.requestGameSync(gameId);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Draw decline failed");
    }
  }

  async function resign() {
    if (!gameId) return;
    try {
      await api.resign(gameId);
      wsClient.requestGameSync(gameId);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Resign failed");
    }
  }

  if (loading) {
    return <div className="page"><p>Loading game...</p></div>;
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Online Game</h1>
        <Link to="/play/vs-player">Back to online lobby</Link>
      </div>

      {status ? <p>{status}</p> : null}

      {game && state ? (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>Game: <code>{game.id}</code> ({game.mode})</span>
              <span>Status: <strong>{game.status}</strong></span>
              <span>You: <strong>{mySide ?? "spectator"}</strong></span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={() => void refresh()}>Refresh now</button>
              <button onClick={() => void offerDraw()}>Offer draw</button>
              <button onClick={() => void acceptDraw()}>Accept draw</button>
              <button onClick={() => void declineDraw()}>Decline draw</button>
              <button onClick={() => void resign()}>Resign</button>
            </div>
          </div>

          <div className="row" style={{ alignItems: "flex-start" }}>
            <div
              className="board"
              style={{
                gridTemplateColumns: `repeat(${state.board.width}, 56px)`,
                width: state.board.width * 56,
              }}
            >
              {Array.from({ length: state.board.height }).flatMap((_, rowIndex) => {
                const displayY = rowIndex;
                return Array.from({ length: state.board.width }).map((__, displayX) => {
                  const real = coordFromDisplay(
                    displayX,
                    displayY,
                    state.board.width,
                    state.board.height,
                    boardFlipped
                  );
                  const x = real.x;
                  const y = real.y;
                  const piece = [...state.pieces.values()].find((p) => p.x === x && p.y === y);
                  const isSelected = selectedPieceId != null && piece?.instanceId === selectedPieceId;
                  const isLegal = legalMoves.some((m) => coordMatch(m.to, { x, y }));
                  return (
                    <button
                      key={`${x},${y}`}
                      type="button"
                      className={`square ${squareColor(x, y)} ${isSelected ? "selected" : ""} ${isLegal ? "legal" : ""}`}
                      onClick={() => onSquareClick(displayX, displayY)}
                      title={`${x},${y}`}
                    >
                      {piece && setup ? (
                        <img className="piece-img" src={pieceAssetForSide(setup, piece)} />
                      ) : null}
                    </button>
                  );
                });
              })}
            </div>

            <div style={{ minWidth: 320 }}>
              <div className="card">
                <h3>Turn</h3>
                <p>Side to move: <strong>{state.sides[state.currentTurnIndex]}</strong></p>
                {state.status !== "ongoing" ? (
                  <p>Winner side: <strong>{state.winnerSide ?? "n/a"}</strong></p>
                ) : null}
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <h3>Move History</h3>
                <ol>
                  {state.moveHistory.map((m, idx) => (
                    <li key={`${m.pieceId}_${idx}`}>{moveLabel(m)}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </>
      ) : (
        <p>Game not found.</p>
      )}
    </div>
  );
}
