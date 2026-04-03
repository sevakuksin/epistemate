import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CompactMove, GameState } from "@cv/engine";
import { deserializeGame, generatePseudoLegalMoves } from "@cv/engine";
import type { GameSetup, PieceInstance, PieceTypeDefinition } from "@cv/shared";
import { api, type GameRecord, type OnlineDraftState } from "../api";
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

function typeAssetForSide(typeDef: PieceTypeDefinition, side: "white" | "black"): string {
  return typeDef.assetBySide?.[side] ?? typeDef.asset;
}

function piecePrice(piece: PieceTypeDefinition): number {
  if (piece.tags?.includes("king")) return 0;
  return typeof piece.price === "number" ? piece.price : 1;
}

function isPlacementRow(side: "white" | "black", y: number, boardHeight: number): boolean {
  return side === "white" ? y >= boardHeight - 2 : y <= 1;
}

export function OnlineGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { user } = useAuth();
  const [game, setGame] = useState<GameRecord | null>(null);
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [draft, setDraft] = useState<OnlineDraftState | null>(null);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<CompactMove[]>([]);
  const [placementSelectedPieceId, setPlacementSelectedPieceId] = useState<string | null>(null);
  const [poolSelectedTypeId, setPoolSelectedTypeId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const mySide = useMemo(() => {
    if (!game || !user) return null;
    if (game.white_user_id === user.id) return "white" as const;
    if (game.black_user_id === user.id) return "black" as const;
    return null;
  }, [game, user]);

  const boardFlipped = useMemo(() => {
    if (game?.status === "draft" && draft) return draft.activeSide === "black";
    return mySide === "black";
  }, [game?.status, draft, mySide]);

  const boardSize = useMemo(() => {
    if (!game) return { width: 8, height: 8 };
    try {
      const board = JSON.parse(game.board_json) as { width: number; height: number };
      return { width: board.width, height: board.height };
    } catch {
      return { width: 8, height: 8 };
    }
  }, [game]);

  const draftAllPieces = useMemo(() => {
    if (!draft) return [] as PieceInstance[];
    return [...draft.placements.white, ...draft.placements.black];
  }, [draft]);

  const draftVisiblePieces = useMemo(() => {
    if (!draft) return [] as PieceInstance[];
    if (mySide && draft.stage === "place" && draft.activeSide === mySide) {
      return [...draft.placements[mySide]];
    }
    return [...draft.placements.white, ...draft.placements.black];
  }, [draft, mySide]);

  async function refresh() {
    if (!gameId) return;
    const g = await api.getGame(gameId);
    const parsedSetup = JSON.parse(g.game.setup_json) as GameSetup;
    const stateRes = await api.gameState(gameId);
    setGame(g.game);
    setSetup(parsedSetup);

    if (g.game.status === "draft") {
      setDraft(stateRes.state as OnlineDraftState);
      setState(null);
      return;
    }

    setDraft(null);
    setState(deserializeGame(stateRes.state));
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
        const nextGame = event.game as GameRecord;
        setGame(nextGame);
        setSetup(JSON.parse(nextGame.setup_json) as GameSetup);
        if (nextGame.status === "draft") {
          setDraft(event.state as OnlineDraftState);
          setState(null);
        } else {
          setDraft(null);
          setState(deserializeGame(event.state));
        }
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

  async function onDraftAdjust(typeId: string, delta: number) {
    if (!gameId) return;
    try {
      await api.draftAdjustBuy(gameId, typeId, delta);
      wsClient.requestGameSync(gameId);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Draft update failed");
    }
  }

  async function onDraftConfirm() {
    if (!gameId) return;
    try {
      await api.draftConfirm(gameId);
      setPoolSelectedTypeId(null);
      setPlacementSelectedPieceId(null);
      wsClient.requestGameSync(gameId);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Draft confirm failed");
    }
  }

  async function onDraftSquareClick(displayX: number, displayY: number) {
    if (!gameId || !game || !setup || !draft || !mySide) return;
    if (game.status !== "draft") return;
    if (draft.activeSide !== mySide || draft.stage !== "place") return;

    const real = coordFromDisplay(displayX, displayY, boardSize.width, boardSize.height, boardFlipped);
    const x = real.x;
    const y = real.y;

    const occupant = draftAllPieces.find((p) => p.x === x && p.y === y);
    if (occupant && occupant.side === mySide) {
      if (placementSelectedPieceId === occupant.instanceId) {
        try {
          await api.draftTakeback(gameId, occupant.instanceId);
          setPlacementSelectedPieceId(null);
          wsClient.requestGameSync(gameId);
        } catch (e) {
          setStatus(e instanceof Error ? e.message : "Takeback failed");
        }
        return;
      }
      setPlacementSelectedPieceId(occupant.instanceId);
      setPoolSelectedTypeId(null);
      return;
    }

    if (occupant) return;
    if (!isPlacementRow(mySide, y, boardSize.height)) return;

    if (placementSelectedPieceId) {
      try {
        await api.draftMove(gameId, placementSelectedPieceId, x, y);
        setPlacementSelectedPieceId(null);
        wsClient.requestGameSync(gameId);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Move failed");
      }
      return;
    }

    if (poolSelectedTypeId) {
      try {
        await api.draftPlace(gameId, poolSelectedTypeId, x, y);
        wsClient.requestGameSync(gameId);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Place failed");
      }
    }
  }

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

  const myDraftBudget = useMemo(() => {
    if (!setup || !draft || !mySide) return { spent: 0, remaining: 0, max: 0 };
    const max = draft.startingBudget;
    let spent = 0;
    for (const t of setup.pieceTypes) {
      const count = draft.buyCounts[t.id]?.[mySide] ?? 0;
      spent += count * piecePrice(t);
    }
    return { spent, remaining: max - spent, max };
  }, [setup, draft, mySide]);

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

      {game && setup && game.status === "draft" && draft ? (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>Game: <code>{game.id}</code> ({game.mode})</span>
              <span>Status: <strong>{game.status}</strong></span>
              <span>You: <strong>{mySide ?? "spectator"}</strong></span>
            </div>
            <p>Draft turn: <strong>{draft.activeSide}</strong> ({draft.stage})</p>
            {mySide ? <p>Your budget: <strong>{myDraftBudget.remaining}</strong> / {myDraftBudget.max}</p> : null}
          </div>

          {mySide && draft.activeSide === mySide && draft.stage === "buy" ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <h3>Buy Pieces</h3>
              {setup.pieceTypes.map((piece) => {
                const count = draft.buyCounts[piece.id]?.[mySide] ?? 0;
                const price = piecePrice(piece);
                const isKing = piece.tags?.includes("king");
                return (
                  <div key={piece.id} className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                    <span>{piece.name} - cost {price}{isKing ? " (auto)" : ""}</span>
                    <div className="row">
                      <button disabled={isKing} onClick={() => void onDraftAdjust(piece.id, -1)}>-</button>
                      <span>{count}</span>
                      <button disabled={isKing} onClick={() => void onDraftAdjust(piece.id, 1)}>+</button>
                    </div>
                  </div>
                );
              })}
              <button onClick={() => void onDraftConfirm()}>Confirm Buy Phase</button>
            </div>
          ) : null}

          {draft.stage === "place" ? (
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 300 }}>
                <div className="card">
                  <h3>Pool</h3>
                  {mySide && draft.activeSide === mySide ? (
                    setup.pieceTypes.map((piece) => {
                      const required = draft.buyCounts[piece.id]?.[mySide] ?? 0;
                      const placed = draft.placements[mySide].filter((p) => p.typeId === piece.id).length;
                      const remain = Math.max(0, required - placed);
                      if (remain <= 0) return null;
                      const selected = poolSelectedTypeId === piece.id;
                      return (
                        <button
                          key={piece.id}
                          type="button"
                          className="row"
                          style={{ width: "100%", justifyContent: "space-between", marginBottom: 6, border: selected ? "2px solid #2f6fed" : undefined }}
                          onClick={() => {
                            setPoolSelectedTypeId(piece.id);
                            setPlacementSelectedPieceId(null);
                          }}
                        >
                          <span>{piece.name} x{remain}</span>
                          <img className="piece-img" src={typeAssetForSide(piece, mySide)} />
                        </button>
                      );
                    })
                  ) : (
                    <p>Waiting for {draft.activeSide} to place pieces...</p>
                  )}
                </div>
                {mySide && draft.activeSide === mySide ? (
                  <button style={{ marginTop: 8 }} onClick={() => void onDraftConfirm()}>Confirm Placement</button>
                ) : null}
              </div>

              <div
                className="board"
                style={{
                  gridTemplateColumns: `repeat(${boardSize.width}, 56px)`,
                  width: boardSize.width * 56,
                }}
              >
                {Array.from({ length: boardSize.height }).flatMap((_, rowIndex) => {
                  const displayY = rowIndex;
                  return Array.from({ length: boardSize.width }).map((__, displayX) => {
                    const real = coordFromDisplay(displayX, displayY, boardSize.width, boardSize.height, boardFlipped);
                    const x = real.x;
                    const y = real.y;
                    const piece = draftVisiblePieces.find((p) => p.x === x && p.y === y);
                    const selected = piece && placementSelectedPieceId === piece.instanceId;
                    return (
                      <button
                        key={`${x},${y}`}
                        type="button"
                        className={`square ${squareColor(x, y)} ${selected ? "selected" : ""}`}
                        onClick={() => void onDraftSquareClick(displayX, displayY)}
                      >
                        {piece ? <img className="piece-img" src={pieceAssetForSide(setup, piece)} /> : null}
                      </button>
                    );
                  });
                })}
              </div>
            </div>
          ) : null}

          {!mySide || draft.activeSide !== mySide ? (
            <p>Waiting for {draft.activeSide} to finish {draft.stage} phase...</p>
          ) : null}
        </>
      ) : null}

      {game && state && game.status !== "draft" ? (
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
      ) : null}

      {game && game.status !== "draft" && !state ? <p>Game not found.</p> : null}
    </div>
  );
}
