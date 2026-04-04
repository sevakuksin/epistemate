import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CompactMove, GameState } from "@cv/engine";
import { deserializeGame, generatePseudoLegalMoves } from "@cv/engine";
import type { GameSetup, PieceInstance, PieceTypeDefinition } from "@cv/shared";
import { api, type GameRecord, type OnlineDraftState } from "../api";
import { PieceImage } from "../components/PieceImage";
import { DraftPieceMarket } from "../components/DraftPieceMarket";
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

/** Draft pool / buy UI: real names including Placebo. */
function draftPieceDisplayName(typeDef: PieceTypeDefinition | undefined): string {
  return typeDef?.name ?? "Piece";
}

/** Active online game: mask Placebo so the opponent cannot tell from labels. */
function onlineGameplayPieceName(typeDef: PieceTypeDefinition | undefined): string {
  if (!typeDef) return "Piece";
  return typeDef.id === "placebo" ? "Queen" : typeDef.name;
}

function coordText(x: number, y: number): string {
  return `${String.fromCharCode(97 + x)}${y + 1}`;
}

function moveLabel(state: GameState, setup: GameSetup, m: CompactMove): string {
  const movedPiece = state.pieces.get(m.pieceId) ?? state.capturedPieces.find((p) => p.instanceId === m.pieceId);
  const movedType = setup.pieceTypes.find((t) => t.id === movedPiece?.typeId);
  const movedName = onlineGameplayPieceName(movedType);
  const captureName = m.captureId
    ? (() => {
        const captured = state.capturedPieces.find((p) => p.instanceId === m.captureId) ?? state.pieces.get(m.captureId);
        const capturedType = setup.pieceTypes.find((t) => t.id === captured?.typeId);
        return onlineGameplayPieceName(capturedType);
      })()
    : null;
  return `${movedName} ${coordText(m.from.x, m.from.y)}-${coordText(m.to.x, m.to.y)}${captureName ? ` x ${captureName}` : ""}`;
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

function isPlacementRow(side: "white" | "black", y: number, boardHeight: number): boolean {
  return side === "white" ? y >= boardHeight - 2 : y <= 1;
}

function piecePrice(piece: PieceTypeDefinition): number {
  if (piece.tags?.includes("king")) return 0;
  return typeof piece.price === "number" ? piece.price : 1;
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
  const [resultToast, setResultToast] = useState<{ tone: "ok" | "danger" | "warn"; text: string } | null>(null);

  const moveAudioRef = useRef<HTMLAudioElement | null>(null);
  const captureAudioRef = useRef<HTMLAudioElement | null>(null);
  const winAudioRef = useRef<HTMLAudioElement | null>(null);
  const lossAudioRef = useRef<HTMLAudioElement | null>(null);
  const drawAudioRef = useRef<HTMLAudioElement | null>(null);
  const prevMoveCountRef = useRef<number | null>(null);
  const prevStatusRef = useRef<GameRecord["status"] | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const mySide = useMemo(() => {
    if (!game || !user) return null;
    if (game.white_user_id === user.id) return "white" as const;
    if (game.black_user_id === user.id) return "black" as const;
    return null;
  }, [game, user]);

  function playSound(audio: HTMLAudioElement | null): void {
    if (!audio) return;
    try {
      audio.currentTime = 0;
      void audio.play();
    } catch {
      // no-op
    }
  }

  useEffect(() => {
    moveAudioRef.current = new Audio("/assets/sfx/move-self.mp3");
    moveAudioRef.current.volume = 0.5;
    captureAudioRef.current = new Audio("/assets/sfx/capture.mp3");
    captureAudioRef.current.volume = 0.56;
    winAudioRef.current = new Audio("/assets/sfx/win.mp3");
    winAudioRef.current.volume = 0.64;
    lossAudioRef.current = new Audio("/assets/sfx/loss.mp3");
    lossAudioRef.current.volume = 0.64;
    drawAudioRef.current = new Audio("/assets/sfx/draw.mp3");
    drawAudioRef.current.volume = 0.62;

    return () => {
      moveAudioRef.current = null;
      captureAudioRef.current = null;
      winAudioRef.current = null;
      lossAudioRef.current = null;
      drawAudioRef.current = null;
      if (toastTimerRef.current != null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!game || !state) return;

    const currentMoveCount = state.moveHistory.length;
    if (prevMoveCountRef.current == null) {
      prevMoveCountRef.current = currentMoveCount;
    } else if (currentMoveCount > prevMoveCountRef.current) {
      const applied = state.moveHistory[currentMoveCount - 1];
      if (applied?.captureId) playSound(captureAudioRef.current);
      else playSound(moveAudioRef.current);
      prevMoveCountRef.current = currentMoveCount;
    }

    const prevStatus = prevStatusRef.current;
    if (prevStatus !== game.status && (game.status === "finished" || game.status === "draw")) {
      if (game.status === "draw") {
        setResultToast({ tone: "warn", text: "Game ended in a draw." });
        playSound(drawAudioRef.current);
      } else {
        const iWon = Boolean(user && game.winner_user_id === user.id);
        if (iWon) {
          setResultToast({ tone: "ok", text: "Victory!" });
          playSound(winAudioRef.current);
        } else {
          setResultToast({ tone: "danger", text: "Defeat." });
          playSound(lossAudioRef.current);
        }
      }

      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => {
        setResultToast(null);
        toastTimerRef.current = null;
      }, 2600);
    }

    prevStatusRef.current = game.status;
  }, [game, state, user]);

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
    prevMoveCountRef.current = null;
    prevStatusRef.current = null;
    setResultToast(null);
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

  const incomingDrawOffer = Boolean(
    game &&
      game.status === "active" &&
      game.draw_offered_by_user_id &&
      user &&
      game.draw_offered_by_user_id !== user.id
  );

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
      <div className="page-header">
        <div><h1 className="page-title">Online Game</h1><p className="subtitle">Live synchronized match with resilient reconnect.</p></div>
        <Link to="/play/vs-player">Back to online lobby</Link>
      </div>

      {status ? <p className="badge warn">{status}</p> : null}

      {resultToast ? (
        <div className={`result-toast ${resultToast.tone}`}>{resultToast.text}</div>
      ) : null}

      {incomingDrawOffer ? (
        <div className="card card-status" style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Opponent offered a draw</strong>
            <div className="row">
              <button onClick={() => void acceptDraw()}>Accept</button>
              <button onClick={() => void declineDraw()}>Decline</button>
            </div>
          </div>
        </div>
      ) : null}

      {game && setup && game.status === "draft" && draft ? (
        <>
          <div className="card card-elevated" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>Game: <code>{game.id}</code> ({game.mode})</span>
              <span>Status: <strong>{game.status}</strong></span>
              <span>You: <strong>{mySide ?? "spectator"}</strong></span>
            </div>
            <p>Draft turn: <strong>{draft.activeSide}</strong> ({draft.stage})</p>
            {mySide ? <p>Your budget: <strong>{myDraftBudget.remaining}</strong> / {myDraftBudget.max}</p> : null}
          </div>

          {mySide && draft.activeSide === mySide && draft.stage === "buy" ? (
            <DraftPieceMarket
              pieces={setup.pieceTypes}
              side={mySide}
              budgetRemaining={myDraftBudget.remaining}
              budgetMax={myDraftBudget.max}
              getCount={(pieceId) => draft.buyCounts[pieceId]?.[mySide] ?? 0}
              onAdjust={onDraftAdjust}
              onConfirm={onDraftConfirm}
              confirmLabel="Confirm Buy Phase"
            />
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
                          <span>{draftPieceDisplayName(piece)} x{remain}</span>
                          <PieceImage className="piece-img" src={typeAssetForSide(piece, mySide)} />
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
                        {piece ? <PieceImage className="piece-img" src={pieceAssetForSide(setup, piece)} /> : null}
                      </button>
                    );
                  });
                })}
              </div>
            </div>
          ) : null}

          {!mySide || draft.activeSide !== mySide ? (
            <p className="badge">Waiting for {draft.activeSide} to finish {draft.stage} phase...</p>
          ) : null}
        </>
      ) : null}

      {game && setup && state && game.status !== "draft" ? (
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
                        <PieceImage className="piece-img" src={pieceAssetForSide(setup, piece)} />
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
                  <p>{state.winnerSide ? <>Winner side: <strong>{state.winnerSide}</strong></> : <>Result: <strong>draw</strong></>}</p>
                ) : null}
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <h3>Move History</h3>
                <div className="move-history-compact">
                  {state.moveHistory.map((m, idx) => (
                    <div className="move-history-row" key={`${m.pieceId}_${idx}`}>
                      <span>{idx + 1}.</span>
                      <span>{moveLabel(state, setup, m)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {game && game.status !== "draft" && !state ? <p>Game not found.</p> : null}
    </div>
  );
}
