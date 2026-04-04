import { useEffect, useMemo, useRef, useState } from "react";
import type { CompactMove, GameState } from "@cv/engine";
import { applyMove, createGameFromSetup, generatePseudoLegalMoves } from "@cv/engine";
import type { BoardDefinition, GameSetup, PieceInstance, PieceTypeDefinition } from "@cv/shared";
import { Link } from "react-router-dom";
import { api } from "../api";
import { BoardShell } from "../components/BoardShell";
import { PieceImage } from "../components/PieceImage";
import { DraftPieceMarket } from "../components/DraftPieceMarket";
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

const CLASSIC_SETUP_ID = "setup_classic_8x8";
const EPISTEMATE_SETUP_ID = "setup_epistemate";
const TURN_FLIP_DELAY_MS = 900;

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

/** Draft / shop: real names including Placebo. */
function draftPieceDisplayName(typeDef: PieceTypeDefinition | undefined): string {
  return typeDef?.name ?? "Piece";
}

/** Hot Seat gameplay only: never surface “Placebo” in text — show as Queen. */
function hotSeatGameplayPieceName(typeDef: PieceTypeDefinition | undefined): string {
  if (!typeDef) return "Piece";
  return typeDef.id === "placebo" ? "Queen" : typeDef.name;
}

function coordText(x: number, y: number): string {
  return `${String.fromCharCode(97 + x)}${y + 1}`;
}

function moveLabel(state: GameState, setup: GameSetup, m: CompactMove): string {
  const movedPiece = state.pieces.get(m.pieceId) ?? state.capturedPieces.find((p) => p.instanceId === m.pieceId);
  const movedType = setup.pieceTypes.find((t) => t.id === movedPiece?.typeId);
  const movedName = hotSeatGameplayPieceName(movedType);
  const captureName = m.captureId
    ? (() => {
        const captured = state.capturedPieces.find((p) => p.instanceId === m.captureId) ?? state.pieces.get(m.captureId);
        const capturedType = setup.pieceTypes.find((t) => t.id === captured?.typeId);
        return hotSeatGameplayPieceName(capturedType);
      })()
    : null;
  const castlePart = m.companionMove
    ? ` + castle ${coordText(m.companionMove.from.x, m.companionMove.from.y)}-${coordText(m.companionMove.to.x, m.companionMove.to.y)}`
    : "";
  return `${movedName} ${coordText(m.from.x, m.from.y)}-${coordText(m.to.x, m.to.y)}${captureName ? ` x ${captureName}` : ""}${castlePart}`;
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
  const [poolSelectedTypeId, setPoolSelectedTypeId] = useState<string | null>(null);
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [deferTurnFlipUntil, setDeferTurnFlipUntil] = useState(0);

  const moveAudioRef = useRef<HTMLAudioElement | null>(null);
  const captureAudioRef = useRef<HTMLAudioElement | null>(null);
  const drawAudioRef = useRef<HTMLAudioElement | null>(null);

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
    moveAudioRef.current = new Audio("/assets/sfx/move-self.mp3");
    moveAudioRef.current.volume = 0.5;
    captureAudioRef.current = new Audio("/assets/sfx/capture.mp3");
    captureAudioRef.current.volume = 0.56;
    drawAudioRef.current = new Audio("/assets/sfx/draw.mp3");
    drawAudioRef.current.volume = 0.62;
    return () => {
      moveAudioRef.current = null;
      captureAudioRef.current = null;
      drawAudioRef.current = null;
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

  const currentTurnSide = state ? state.sides[state.currentTurnIndex] : null;

  useEffect(() => {
    if (!draft || draft.stage !== "place") return;
    setBoardFlipped(draft.activeSide === "black");
  }, [draft?.activeSide, draft?.stage]);

  useEffect(() => {
    if (draft) return;
    if (!currentTurnSide) return;

    const desiredFlip = currentTurnSide === "black";
    const waitMs = Math.max(0, deferTurnFlipUntil - Date.now());
    if (waitMs === 0) {
      setBoardFlipped(desiredFlip);
      return;
    }

    const timer = window.setTimeout(() => {
      setBoardFlipped(desiredFlip);
    }, waitMs);
    return () => window.clearTimeout(timer);
  }, [draft, currentTurnSide, deferTurnFlipUntil]);

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
    setPoolSelectedTypeId(null);
    setBoardFlipped(false);
    setDeferTurnFlipUntil(0);
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
      setPoolSelectedTypeId(null);
      setBoardFlipped(false);
      setDeferTurnFlipUntil(0);
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
    setPoolSelectedTypeId(null);
    setBoardFlipped(false);
    setDeferTurnFlipUntil(0);
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
    setPoolSelectedTypeId(null);
    setBoardFlipped(false);
    setDeferTurnFlipUntil(0);
    setError("");
  }

  function backToBuy() {
    setDraft((prev) => (prev ? { ...prev, stage: "buy" } : prev));
    setPlacementSelectedPieceId(null);
    setPoolSelectedTypeId(null);
  }

  function onPlacementSquareClick(x: number, y: number) {
    if (!draft || !bundle || draft.stage !== "place") return;

    const side = draft.activeSide;
    const occupant = draftAllPiecesOnBoard.find((p) => p.x === x && p.y === y);

    if (occupant && occupant.side === side) {
      setPoolSelectedTypeId(null);
      if (placementSelectedPieceId === occupant.instanceId) {
        setDraft((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            placements: {
              ...prev.placements,
              [side]: prev.placements[side].filter((p) => p.instanceId !== occupant.instanceId),
            },
          };
        });
        setPlacementSelectedPieceId(null);
      } else {
        setPlacementSelectedPieceId(occupant.instanceId);
      }
      return;
    }

    if (occupant) return;
    if (!isPlacementRow(side, y, bundle.board.height)) return;

    if (placementSelectedPieceId) {
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
      return;
    }

    if (poolSelectedTypeId) {
      const remain = remainingToPlace(side, poolSelectedTypeId);
      if (remain <= 0) return;
      const index = placedCount(side, poolSelectedTypeId) + 1;
      const instanceId = `${side}_${poolSelectedTypeId}_${index}`;
      const newPiece: PieceInstance = {
        instanceId,
        typeId: poolSelectedTypeId,
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
      setError("");
    }
  }

  function confirmPlacementAndAdvance() {
    if (!draft || !bundle) return;
    const side = draft.activeSide;

    for (const piece of bundle.setup.pieceTypes) {
      const need = requiredCount(side, piece.id);
      const have = placedCount(side, piece.id);
      if (have !== need) {
        setError(`Place all selected ${draftPieceDisplayName(piece)} pieces for ${side}.`);
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
      setPoolSelectedTypeId(null);
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
    setPoolSelectedTypeId(null);
    setBoardFlipped(false);
    setDeferTurnFlipUntil(0);
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
        const turnChanged = next.currentTurnIndex !== state.currentTurnIndex;
        if (next.status === "ongoing" && turnChanged) {
          setDeferTurnFlipUntil(Date.now() + TURN_FLIP_DELAY_MS);
        } else {
          setDeferTurnFlipUntil(0);
        }
        setState(next);
        const appliedMove = next.moveHistory[next.moveHistory.length - 1];
        if (next.status === "finished") {
          // Hot seat is shared-device, so draw SFX is used for end state.
          playSound(drawAudioRef.current);
        } else if (appliedMove?.captureId) {
          playSound(captureAudioRef.current);
        } else {
          playSound(moveAudioRef.current);
        }
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
    setDeferTurnFlipUntil(0);
    setSelectedPieceId(null);
    setLegalMoves([]);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Hot Seat</h1><p className="subtitle">Local pass-and-play with Epistemate draft support.</p></div>
        <Link to="/">Back to menu</Link>
      </div>

      {!playMode ? (
        <div className="card card-elevated" style={{ marginBottom: 12 }}>
          <h3>Choose Mode</h3>
          <div className="row">
            <button onClick={() => void chooseMode("chess")}>Chess</button>
            <button onClick={() => void chooseMode("epistemate")}>Epistemate</button>
            <button onClick={() => void chooseMode("custom")}>Custom</button>
          </div>
        </div>
      ) : (
        <div className="card card-elevated" style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Mode: {playMode === "epistemate" ? "Epistemate" : playMode === "chess" ? "Chess" : "Custom"}</strong>
            <div className="row">
              <button onClick={resetToModePicker}>Change mode</button>
              <button onClick={() => setBoardFlipped((v) => !v)}>Flip board</button>
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

      {error ? <p className="error-text">{error}</p> : null}

      {isDrafting && bundle && draft ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Epistemate Draft: {draft.activeSide.toUpperCase()} - {draft.stage === "buy" ? "Buy" : "Place"}</h3>
          <p>Budget: <strong>{sideBudget.remaining}</strong> / {sideBudget.max} remaining for {draft.activeSide}.</p>
          <p>Placement rule: only your first two rows are allowed.</p>

          {draft.stage === "buy" ? (
            <DraftPieceMarket
              pieces={bundle.setup.pieceTypes}
              side={draft.activeSide}
              budgetRemaining={sideBudget.remaining}
              budgetMax={sideBudget.max}
              getCount={(pieceId) => draft.buyCounts[pieceId]?.[draft.activeSide] ?? 0}
              onAdjust={(pieceId, delta) => adjustBuy(draft.activeSide, pieceId, delta)}
              onConfirm={proceedToPlacement}
              confirmLabel="Proceed to Placement"
            />
          ) : (
            <>
              <p className="subtitle" style={{ marginBottom: 8 }}>
                Select a piece type in the pool, then tap an empty square on your first two ranks. Tap one of your placed pieces to select it for moving; tap the same piece again to remove it from the board.
              </p>
              <div className="row game-layout" style={{ alignItems: "flex-start" }}>
                <div className="game-sidebar card" style={{ minWidth: 280 }}>
                  <h4 style={{ marginTop: 0 }}>Pool</h4>
                  {bundle.setup.pieceTypes.map((piece) => {
                    const remaining = remainingToPlace(draft.activeSide, piece.id);
                    if (remaining <= 0) return null;
                    const selected = poolSelectedTypeId === piece.id;
                    return (
                      <button
                        key={piece.id}
                        type="button"
                        className="row"
                        style={{
                          width: "100%",
                          justifyContent: "space-between",
                          marginBottom: 6,
                          border: selected ? "2px solid #2f6fed" : undefined,
                        }}
                        onClick={() => {
                          setPoolSelectedTypeId(piece.id);
                          setPlacementSelectedPieceId(null);
                        }}
                      >
                        <span>{draftPieceDisplayName(piece)} ×{remaining}</span>
                        <PieceImage className="piece-img" src={typeAssetForSide(piece, draft.activeSide)} />
                      </button>
                    );
                  })}
                </div>
                <BoardShell cols={bundle.board.width} rows={bundle.board.height}>
                  {Array.from({ length: bundle.board.height }).flatMap((_, rowIndex) => {
                    const displayY = rowIndex;
                    return Array.from({ length: bundle.board.width }).map((__, displayX) => {
                      const real = coordFromDisplay(displayX, displayY, bundle.board.width, bundle.board.height, boardFlipped);
                      const x = real.x;
                      const y = real.y;
                      const piece = draftVisiblePiecesOnBoard.find((p) => p.x === x && p.y === y);
                      return (
                        <button
                          key={`draft-${x},${y}`}
                          type="button"
                          className={`square ${squareColor(x, y)}`}
                          onClick={() => onPlacementSquareClick(x, y)}
                        >
                          {piece ? (
                            <PieceImage
                              className="piece-img"
                              style={{ outline: placementSelectedPieceId === piece.instanceId ? "2px solid #2f6fed" : undefined }}
                              src={pieceAssetForSide(bundle.setup, piece)}
                            />
                          ) : null}
                        </button>
                      );
                    });
                  })}
                </BoardShell>
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
        <div className="card card-status" style={{ marginBottom: 12 }}>
          <strong>Game Over.</strong> {state.winnerSide ? <>Winner: <strong>{state.winnerSide}</strong></> : <>Draw by stalemate.</>}
        </div>
      ) : null}

      {state && bundle && activeSetup ? (
        <div className="row game-layout" style={{ alignItems: "flex-start" }}>
          <BoardShell cols={bundle.board.width} rows={bundle.board.height}>
            {Array.from({ length: bundle.board.height }).flatMap((_, rowIndex) => {
              const displayY = rowIndex;
              return Array.from({ length: bundle.board.width }).map((__, displayX) => {
                const real = coordFromDisplay(displayX, displayY, bundle.board.width, bundle.board.height, boardFlipped);
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
                    onClick={() => onSquareClick(x, y)}
                    title={`${x},${y}`}
                  >
                    {piece ? <PieceImage className="piece-img" src={pieceAssetForSide(activeSetup, piece)} /> : null}
                  </button>
                );
              });
            })}
          </BoardShell>

          <div className="game-sidebar" style={{ minWidth: 280 }}>
            <div className="card">
              <h3>Turn</h3>
              <p>Side to move: <strong>{state.sides[state.currentTurnIndex]}</strong></p>
              {state.status === "finished" ? <p>{state.winnerSide ? <>Winner: <strong>{state.winnerSide}</strong></> : <>Result: <strong>draw</strong></>}</p> : null}
            </div>
            <div className="card" style={{ marginTop: 12 }}>
              <h3>Selection</h3>
              {selectedPiece ? (
                <p>
                  {selectedPiece.instanceId} (
                  {hotSeatGameplayPieceName(activeSetup.pieceTypes.find((t) => t.id === selectedPiece.typeId))}
                  ) at ({selectedPiece.x},{selectedPiece.y})
                </p>
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
              <div className="move-history-compact">
                {state.moveHistory.map((m, idx) => (
                  <div className="move-history-row" key={`${m.pieceId}_${idx}`}>
                    <span>{idx + 1}.</span>
                    <span>{moveLabel(state, activeSetup, m)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : playMode && !isDrafting ? (
        <p>{playMode === "custom" ? "Load a custom setup to start playing." : "Loading selected mode..."}</p>
      ) : null}
    </div>
  );
}
