import { useEffect, useMemo, useRef, useState } from "react";
import type { CompactMove, GameState } from "@cv/engine";
import { applyMove, createGameFromSetup, generatePseudoLegalMoves } from "@cv/engine";
import type { BoardDefinition, GameSetup, PieceInstance, PieceTypeDefinition } from "@cv/shared";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../state/auth";

type Bundle = {
  board: BoardDefinition;
  setup: GameSetup;
};

type BuyCounts = Record<string, { white: number; black: number }>;
type PlayMode = "chess" | "epistemate" | "custom";
type Side = "white" | "black";

type DraftState = {
  activeSide: Side;
  stage: "buy" | "place";
  buyCounts: BuyCounts;
  placements: Record<Side, PieceInstance[]>;
};

type DragPayload =
  | { kind: "pool"; typeId: string; side: Side }
  | { kind: "placed"; instanceId: string; side: Side };

const CLASSIC_SETUP_ID = "setup_classic_8x8";
const EPISTEMATE_SETUP_ID = "setup_epistemate";

function pieceAssetForSide(setup: GameSetup, piece: PieceInstance): string | undefined {
  const typeDef = setup.pieceTypes.find((t) => t.id === piece.typeId);
  if (!typeDef) return undefined;
  if (piece.side === "white" || piece.side === "black") {
    return typeDef.assetBySide?.[piece.side] ?? typeDef.asset;
  }
  return typeDef.asset;
}

function typeAssetForSide(typeDef: PieceTypeDefinition, side: Side): string {
  return typeDef.assetBySide?.[side] ?? typeDef.asset;
}

function coordMatch(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function squareColor(x: number, y: number): "light" | "dark" {
  return (x + y) % 2 === 0 ? "light" : "dark";
}

function moveLabel(m: CompactMove): string {
  const castlePart = m.companionMove
    ? ` + ${m.companionMove.pieceId}: (${m.companionMove.from.x},${m.companionMove.from.y}) -> (${m.companionMove.to.x},${m.companionMove.to.y})`
    : "";
  return `${m.pieceId}: (${m.from.x},${m.from.y}) -> (${m.to.x},${m.to.y})${m.captureId ? ` x ${m.captureId}` : ""}${castlePart}`;
}

function piecePrice(piece: PieceTypeDefinition): number {
  return typeof piece.price === "number" ? piece.price : 1;
}

function setupStartingBudget(setup: GameSetup): number {
  return setup.budgetMode?.startingBudget ?? 40;
}

function isPlacementRow(side: Side, y: number, boardHeight: number): boolean {
  return side === "white" ? y >= boardHeight - 2 : y <= 1;
}

function readDragPayload(raw: string): DragPayload | null {
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (parsed.kind !== "pool" && parsed.kind !== "placed") return null;
    if (parsed.side !== "white" && parsed.side !== "black") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function HotSeatPage() {
  const { user } = useAuth();
  const [setups, setSetups] = useState<GameSetup[]>([]);
  const [selectedSetupId, setSelectedSetupId] = useState("");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [activeSetup, setActiveSetup] = useState<GameSetup | null>(null);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<CompactMove[]>([]);
  const [error, setError] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [playMode, setPlayMode] = useState<PlayMode | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [placementSelectedPieceId, setPlacementSelectedPieceId] = useState<string | null>(null);

  const moveAudioRef = useRef<HTMLAudioElement | null>(null);
  const winAudioRef = useRef<HTMLAudioElement | null>(null);

  function playSound(audio: HTMLAudioElement | null) {
    if (!soundEnabled || !audio) return;
    try {
      audio.currentTime = 0;
      void audio.play();
    } catch {
      // no-op
    }
  }

  useEffect(() => {
    moveAudioRef.current = new Audio("/assets/sfx/move.mp3");
    moveAudioRef.current.volume = 0.5;
    winAudioRef.current = new Audio("/assets/sfx/win.mp3");
    winAudioRef.current.volume = 0.65;
    return () => {
      moveAudioRef.current = null;
      winAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    api
      .listSetups(user.id)
      .then((list) => {
        setSetups(list);
        if (list.length > 0) setSelectedSetupId((prev) => prev || list[0].id);
      })
      .catch(() => setError("Failed to load setups."));
  }, [user]);

  const isDrafting = Boolean(draft && bundle);

  const sideBudget = useMemo(() => {
    if (!bundle || !draft) return { max: 0, remaining: 0, spent: 0, side: "white" as Side };
    const side = draft.activeSide;
    const max = setupStartingBudget(bundle.setup);
    let spent = 0;
    for (const piece of bundle.setup.pieceTypes) {
      const isKing = piece.tags?.includes("king");
      const price = isKing ? 0 : piecePrice(piece);
      const count = draft.buyCounts[piece.id]?.[side] ?? 0;
      spent += count * price;
    }
    return { max, spent, remaining: max - spent, side };
  }, [bundle, draft]);

  const draftAllPiecesOnBoard = useMemo(() => {
    if (!draft) return [] as PieceInstance[];
    return [...draft.placements.white, ...draft.placements.black];
  }, [draft]);

  const draftVisiblePiecesOnBoard = useMemo(() => {
    if (!draft) return [] as PieceInstance[];
    if (draft.activeSide === "black") return [...draft.placements.black];
    return [...draft.placements.white, ...draft.placements.black];
  }, [draft]);

  function requiredCount(side: Side, typeId: string): number {
    if (!draft) return 0;
    return draft.buyCounts[typeId]?.[side] ?? 0;
  }

  function placedCount(side: Side, typeId: string): number {
    if (!draft) return 0;
    return draft.placements[side].filter((p) => p.typeId === typeId).length;
  }

  function remainingToPlace(side: Side, typeId: string): number {
    return Math.max(0, requiredCount(side, typeId) - placedCount(side, typeId));
  }

  function initializeDraft(nextBundle: Bundle) {
    const counts: BuyCounts = {};
    for (const piece of nextBundle.setup.pieceTypes) {
      const isKing = piece.tags?.includes("king");
      counts[piece.id] = { white: isKing ? 1 : 0, black: isKing ? 1 : 0 };
    }
    setDraft({
      activeSide: "white",
      stage: "buy",
      buyCounts: counts,
      placements: { white: [], black: [] },
    });
  }

  async function loadSetupById(setupId: string, forceBudget?: boolean) {
    if (!user || !setupId) return;
    const data = await api.getSetupBundle(user.id, setupId);
    const nextBundle: Bundle = { board: data.board, setup: data.setup };
    setBundle(nextBundle);
    setState(null);
    setActiveSetup(null);
    setSelectedPieceId(null);
    setLegalMoves([]);
    setPlacementSelectedPieceId(null);
    setError("");

    const useBudget = forceBudget ?? Boolean(nextBundle.setup.budgetMode?.enabled);
    if (useBudget) {
      initializeDraft(nextBundle);
    } else {
      setDraft(null);
      const game = createGameFromSetup(nextBundle.setup, nextBundle.board);
      setState(game);
      setActiveSetup(nextBundle.setup);
    }
  }

  async function chooseMode(mode: PlayMode) {
    setPlayMode(mode);
    setError("");
    try {
      if (mode === "chess") {
        await loadSetupById(CLASSIC_SETUP_ID, false);
        return;
      }
      if (mode === "epistemate") {
        await loadSetupById(EPISTEMATE_SETUP_ID, true);
        return;
      }
      setBundle(null);
      setState(null);
      setActiveSetup(null);
      setDraft(null);
      setPlacementSelectedPieceId(null);
    } catch {
      setError("Failed to load this mode. If you are on a new account, create/import setups first.");
    }
  }

  async function loadCustomSetup() {
    try {
      await loadSetupById(selectedSetupId);
    } catch {
      setError("Failed to load custom setup.");
    }
  }

  function resetToModePicker() {
    setPlayMode(null);
    setBundle(null);
    setState(null);
    setActiveSetup(null);
    setDraft(null);
    setSelectedPieceId(null);
    setLegalMoves([]);
    setPlacementSelectedPieceId(null);
    setError("");
  }

  function adjustBuy(side: Side, pieceId: string, delta: number) {
    if (!draft || !bundle) return;
    const typeDef = bundle.setup.pieceTypes.find((p) => p.id === pieceId);
    if (typeDef?.tags?.includes("king")) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const current = prev.buyCounts[pieceId] ?? { white: 0, black: 0 };
      const nextVal = Math.max(0, (current[side] ?? 0) + delta);
      return {
        ...prev,
        buyCounts: {
          ...prev.buyCounts,
          [pieceId]: {
            ...current,
            [side]: nextVal,
          },
        },
      };
    });
  }

  function proceedToPlacement() {
    if (!draft) return;
    if (sideBudget.remaining < 0) {
      setError("Budget exceeded. Reduce selected pieces.");
      return;
    }
    setDraft((prev) => (prev ? { ...prev, stage: "place" } : prev));
    setPlacementSelectedPieceId(null);
    setError("");
  }

  function backToBuy() {
    setDraft((prev) => (prev ? { ...prev, stage: "buy" } : prev));
    setPlacementSelectedPieceId(null);
  }

  function onSquareDrop(x: number, y: number, rawPayload: string) {
    if (!draft || !bundle || draft.stage !== "place") return;
    const payload = readDragPayload(rawPayload);
    if (!payload) return;

    const side = draft.activeSide;
    if (payload.side !== side) return;
    if (!isPlacementRow(side, y, bundle.board.height)) return;

    const occupant = draftAllPiecesOnBoard.find((p) => p.x === x && p.y === y);
    if (payload.kind === "pool") {
      if (occupant) return;
      const remain = remainingToPlace(side, payload.typeId);
      if (remain <= 0) return;
      const index = placedCount(side, payload.typeId) + 1;
      const instanceId = `${side}_${payload.typeId}_${index}`;
      const newPiece: PieceInstance = {
        instanceId,
        typeId: payload.typeId,
        side,
        x,
        y,
        state: {},
      };
      setDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          placements: {
            ...prev.placements,
            [side]: [...prev.placements[side], newPiece],
          },
        };
      });
      return;
    }

    if (payload.kind === "placed") {
      const current = draft.placements[side].find((p) => p.instanceId === payload.instanceId);
      if (!current) return;
      if (occupant && occupant.instanceId !== current.instanceId) return;
      setDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          placements: {
            ...prev.placements,
            [side]: prev.placements[side].map((p) =>
              p.instanceId === payload.instanceId ? { ...p, x, y } : p
            ),
          },
        };
      });
      setPlacementSelectedPieceId(null);
    }
  }

  function onPlacementPieceClick(piece: PieceInstance) {
    if (!draft || draft.stage !== "place") return;
    if (piece.side !== draft.activeSide) return;

    if (placementSelectedPieceId === piece.instanceId) {
      setDraft((prev) => {
        if (!prev) return prev;
        const side = prev.activeSide;
        return {
          ...prev,
          placements: {
            ...prev.placements,
            [side]: prev.placements[side].filter((p) => p.instanceId !== piece.instanceId),
          },
        };
      });
      setPlacementSelectedPieceId(null);
      return;
    }

    setPlacementSelectedPieceId(piece.instanceId);
    setError("");
  }

  function onPlacementSquareClick(x: number, y: number) {
    if (!draft || !bundle || draft.stage !== "place") return;
    if (!placementSelectedPieceId) return;

    const side = draft.activeSide;
    if (!isPlacementRow(side, y, bundle.board.height)) return;

    const occupant = draftAllPiecesOnBoard.find((p) => p.x === x && p.y === y);
    if (occupant && occupant.instanceId !== placementSelectedPieceId) return;

    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        placements: {
          ...prev.placements,
          [side]: prev.placements[side].map((p) =>
            p.instanceId === placementSelectedPieceId ? { ...p, x, y } : p
          ),
        },
      };
    });
    setPlacementSelectedPieceId(null);
    setError("");
  }

  function confirmPlacementAndAdvance() {
    if (!draft || !bundle) return;
    const side = draft.activeSide;

    for (const piece of bundle.setup.pieceTypes) {
      const need = requiredCount(side, piece.id);
      const have = placedCount(side, piece.id);
      if (have !== need) {
        setError(`Place all selected ${piece.name} pieces for ${side}.`);
        return;
      }
    }

    if (side === "white") {
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              activeSide: "black",
              stage: "buy",
            }
          : prev
      );
      setPlacementSelectedPieceId(null);
      setError("");
      return;
    }

    const finalPieces = [...draft.placements.white, ...draft.placements.black];
    const runtimeSetup: GameSetup = {
      ...bundle.setup,
      id: `${bundle.setup.id}_epistemate_runtime`,
      name: `${bundle.setup.name} (Drafted)` ,
      placedPieces: finalPieces,
    };
    setActiveSetup(runtimeSetup);
    setState(createGameFromSetup(runtimeSetup, bundle.board));
    setDraft(null);
    setPlacementSelectedPieceId(null);
    setError("");
  }

  const selectedPiece = useMemo(() => {
    if (!state || !selectedPieceId) return null;
    return state.pieces.get(selectedPieceId) ?? null;
  }, [state, selectedPieceId]);

  function onSquareClick(x: number, y: number) {
    if (!state || state.status !== "ongoing") return;

    const hit = [...state.pieces.values()].find((p) => p.x === x && p.y === y);
    const turnSide = state.sides[state.currentTurnIndex];

    const clickedMove = legalMoves.find((m) => coordMatch(m.to, { x, y }));
    if (clickedMove) {
      try {
        const next = applyMove(state, clickedMove);
        setState(next);
        if (next.status === "finished") playSound(winAudioRef.current);
        else playSound(moveAudioRef.current);
        setSelectedPieceId(null);
        setLegalMoves([]);
      } catch {
        setError("Illegal move.");
      }
      return;
    }

    if (!hit) {
      setSelectedPieceId(null);
      setLegalMoves([]);
      return;
    }

    if (hit.side !== turnSide) return;
    setSelectedPieceId(hit.instanceId);
    setLegalMoves(generatePseudoLegalMoves(state, hit.instanceId));
  }

  function restart() {
    if (!bundle || !activeSetup) return;
    setState(createGameFromSetup(activeSetup, bundle.board));
    setSelectedPieceId(null);
    setLegalMoves([]);
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Hot Seat</h1>
        <Link to="/">Back to menu</Link>
      </div>

      {!playMode ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Choose Mode</h3>
          <div className="row">
            <button onClick={() => void chooseMode("chess")}>Chess</button>
            <button onClick={() => void chooseMode("epistemate")}>Epistemate</button>
            <button onClick={() => void chooseMode("custom")}>Custom</button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Mode: {playMode === "epistemate" ? "Epistemate" : playMode === "chess" ? "Chess" : "Custom"}</strong>
            <div className="row">
              <button onClick={resetToModePicker}>Change mode</button>
              <button onClick={() => setSoundEnabled((v) => !v)}>Sound: {soundEnabled ? "On" : "Off"}</button>
            </div>
          </div>

          {playMode === "custom" ? (
            <div className="row" style={{ marginTop: 8 }}>
              <label>
                Setup
                <select value={selectedSetupId} onChange={(e) => setSelectedSetupId(e.target.value)}>
                  <option value="">Select setup</option>
                  {setups.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <button onClick={() => void loadCustomSetup()}>Load Custom Setup</button>
              <button onClick={restart} disabled={!state}>Restart</button>
            </div>
          ) : (
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={restart} disabled={!state}>Restart</button>
            </div>
          )}
        </div>
      )}

      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}

      {isDrafting && bundle && draft ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Epistemate Draft: {draft.activeSide.toUpperCase()} - {draft.stage === "buy" ? "Buy" : "Place"}</h3>
          <p>Budget: <strong>{sideBudget.remaining}</strong> / {sideBudget.max} remaining for {draft.activeSide}.</p>
          <p>Placement rule: only your first two rows are allowed.</p>

          {draft.stage === "buy" ? (
            <>
              {bundle.setup.pieceTypes.map((piece) => {
                const isKing = piece.tags?.includes("king");
                const price = isKing ? 0 : piecePrice(piece);
                const count = draft.buyCounts[piece.id]?.[draft.activeSide] ?? 0;
                return (
                  <div key={piece.id} className="row" style={{ marginBottom: 6, justifyContent: "space-between" }}>
                    <span>{piece.name} (<code>{piece.id}</code>) - cost {price}{isKing ? " (auto included)" : ""}</span>
                    <div className="row">
                      <button disabled={isKing} onClick={() => adjustBuy(draft.activeSide, piece.id, -1)}>-</button>
                      <span>{count}</span>
                      <button disabled={isKing} onClick={() => adjustBuy(draft.activeSide, piece.id, 1)}>+</button>
                    </div>
                  </div>
                );
              })}
              <button onClick={proceedToPlacement}>Proceed to Placement</button>
            </>
          ) : (
            <>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div style={{ minWidth: 320 }}>
                  <h4>Pieces to place</h4>
                  {bundle.setup.pieceTypes.map((piece) => {
                    const remaining = remainingToPlace(draft.activeSide, piece.id);
                    if (remaining <= 0) return null;
                    return (
                      <div key={piece.id} className="card" style={{ marginBottom: 6, padding: 8 }} draggable onDragStart={(e) => {
                        const payload: DragPayload = { kind: "pool", typeId: piece.id, side: draft.activeSide };
                        e.dataTransfer.setData("text/plain", JSON.stringify(payload));
                      }}>
                        <div className="row" style={{ justifyContent: "space-between" }}>
                          <span>{piece.name} x{remaining}</span>
                          <img className="piece-img" src={typeAssetForSide(piece, draft.activeSide)} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div
                  className="board"
                  style={{
                    gridTemplateColumns: `repeat(${bundle.board.width}, 56px)`,
                    width: bundle.board.width * 56,
                  }}
                >
                  {Array.from({ length: bundle.board.height }).flatMap((_, rowIndex) => {
                    const y = rowIndex;
                    return Array.from({ length: bundle.board.width }).map((__, x) => {
                      const piece = draftVisiblePiecesOnBoard.find((p) => p.x === x && p.y === y);
                      return (
                        <button
                          key={`draft-${x},${y}`}
                          type="button"
                          className={`square ${squareColor(x, y)} ${isPlacementRow(draft.activeSide, y, bundle.board.height) ? "" : ""}`}
                          onClick={() => onPlacementSquareClick(x, y)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            onSquareDrop(x, y, e.dataTransfer.getData("text/plain"));
                          }}
                        >
                          {piece ? (
                            <img
                              className="piece-img"
                              style={{ outline: placementSelectedPieceId === piece.instanceId ? "2px solid #2f6fed" : undefined }}
                              src={pieceAssetForSide(bundle.setup, piece)}
                              draggable={piece.side === draft.activeSide}
                              onClick={(e) => {
                                e.stopPropagation();
                                onPlacementPieceClick(piece);
                              }}
                              onDragStart={(e) => {
                                if (piece.side !== draft.activeSide) return;
                                const payload: DragPayload = { kind: "placed", instanceId: piece.instanceId, side: draft.activeSide };
                                e.dataTransfer.setData("text/plain", JSON.stringify(payload));
                              }}
                            />
                          ) : null}
                        </button>
                      );
                    });
                  })}
                </div>
              </div>

              <div className="row" style={{ marginTop: 8 }}>
                <button onClick={backToBuy}>Back to Buy</button>
                <button onClick={confirmPlacementAndAdvance}>
                  {draft.activeSide === "white" ? "Confirm White Placement" : "Confirm Black Placement & Start"}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {state?.status === "finished" ? (
        <div className="card" style={{ marginBottom: 12, borderColor: "#4caf50" }}>
          <strong>Game Over.</strong> Winner: <strong>{state.winnerSide}</strong>
        </div>
      ) : null}

      {state && bundle && activeSetup ? (
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="board" style={{ gridTemplateColumns: `repeat(${bundle.board.width}, 56px)`, width: bundle.board.width * 56 }}>
            {Array.from({ length: bundle.board.height }).flatMap((_, rowIndex) => {
              const y = rowIndex;
              return Array.from({ length: bundle.board.width }).map((__, x) => {
                const piece = [...state.pieces.values()].find((p) => p.x === x && p.y === y);
                const isSelected = selectedPieceId != null && piece?.instanceId === selectedPieceId;
                const isLegal = legalMoves.some((m) => coordMatch(m.to, { x, y }));
                return (
                  <button
                    key={`${x},${y}`}
                    type="button"
                    className={`square ${squareColor(x, y)} ${isSelected ? "selected" : ""} ${isLegal ? "legal" : ""}`}
                    onClick={() => onSquareClick(x, y)}
                    title={`${x},${y}`}
                  >
                    {piece ? <img className="piece-img" src={pieceAssetForSide(activeSetup, piece)} /> : null}
                  </button>
                );
              });
            })}
          </div>

          <div style={{ minWidth: 320 }}>
            <div className="card">
              <h3>Turn</h3>
              <p>Side to move: <strong>{state.sides[state.currentTurnIndex]}</strong></p>
              {state.status === "finished" ? <p>Winner: <strong>{state.winnerSide}</strong></p> : null}
            </div>
            <div className="card" style={{ marginTop: 12 }}>
              <h3>Selection</h3>
              {selectedPiece ? (
                <p>{selectedPiece.instanceId} ({selectedPiece.typeId}) at ({selectedPiece.x},{selectedPiece.y})</p>
              ) : (
                <p>No selection</p>
              )}
              <p>Legal moves: {legalMoves.length}</p>
            </div>
            <div className="card" style={{ marginTop: 12 }}>
              <h3>Captured</h3>
              {state.capturedPieces.length === 0 ? (
                <p>None</p>
              ) : (
                <ul>
                  {state.capturedPieces.map((p) => (
                    <li key={p.instanceId}>{p.instanceId} ({p.side})</li>
                  ))}
                </ul>
              )}
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
      ) : playMode && !isDrafting ? (
        <p>{playMode === "custom" ? "Load a custom setup to start playing." : "Loading selected mode..."}</p>
      ) : null}
    </div>
  );
}
