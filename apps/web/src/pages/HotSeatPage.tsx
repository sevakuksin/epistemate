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

function pieceAssetForSide(setup: GameSetup, piece: PieceInstance): string | undefined {
  const typeDef = setup.pieceTypes.find((t) => t.id === piece.typeId);
  if (!typeDef) return undefined;
  if (piece.side === "white" || piece.side === "black") {
    return typeDef.assetBySide?.[piece.side] ?? typeDef.asset;
  }
  return typeDef.asset;
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

function buildBudgetSetup(baseSetup: GameSetup, board: BoardDefinition, counts: BuyCounts): GameSetup {
  const pieceTypes = baseSetup.pieceTypes;
  const placements: PieceInstance[] = [];

  function positionsForSide(side: "white" | "black"): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    const rows = Array.from({ length: board.height }).map((_, i) => i);
    const orderedRows = side === "white" ? [...rows].reverse() : rows;
    for (const y of orderedRows) {
      for (let x = 0; x < board.width; x++) out.push({ x, y });
    }
    return out;
  }

  for (const side of ["white", "black"] as const) {
    const pos = positionsForSide(side);
    let idx = 0;

    const kingType = pieceTypes.find((p) => p.tags?.includes("king"));
    if (kingType) {
      const kPos = pos[idx++];
      placements.push({
        instanceId: `${side}_king_auto`,
        typeId: kingType.id,
        side,
        x: kPos.x,
        y: kPos.y,
        state: {},
      });
    }

    for (const piece of pieceTypes) {
      const amount = counts[piece.id]?.[side] ?? 0;
      for (let n = 0; n < amount; n++) {
        if (idx >= pos.length) break;
        const at = pos[idx++];
        placements.push({
          instanceId: `${side}_${piece.id}_${n + 1}`,
          typeId: piece.id,
          side,
          x: at.x,
          y: at.y,
          state: {},
        });
      }
    }
  }

  return {
    ...baseSetup,
    id: `${baseSetup.id}_budget_runtime`,
    name: `${baseSetup.name} (Budget Buy)` ,
    placedPieces: placements,
  };
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
  const [budgetPhase, setBudgetPhase] = useState(false);
  const [buyCounts, setBuyCounts] = useState<BuyCounts>({});
  const [soundEnabled, setSoundEnabled] = useState(true);

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

  const currentBudget = useMemo(() => {
    if (!bundle) return { white: 0, black: 0, max: 0 };
    const max = setupStartingBudget(bundle.setup);
    let spentWhite = 0;
    let spentBlack = 0;
    for (const p of bundle.setup.pieceTypes) {
      const counts = buyCounts[p.id] ?? { white: 0, black: 0 };
      const price = piecePrice(p);
      spentWhite += counts.white * price;
      spentBlack += counts.black * price;
    }
    return { white: max - spentWhite, black: max - spentBlack, max };
  }, [bundle, buyCounts]);

  async function loadSetup() {
    if (!user || !selectedSetupId) return;
    const data = await api.getSetupBundle(user.id, selectedSetupId);
    const nextBundle: Bundle = { board: data.board, setup: data.setup };
    setBundle(nextBundle);
    setState(null);
    setActiveSetup(null);
    setSelectedPieceId(null);
    setLegalMoves([]);
    setError("");

    if (nextBundle.setup.budgetMode?.enabled) {
      setBudgetPhase(true);
      const initial: BuyCounts = {};
      for (const piece of nextBundle.setup.pieceTypes) {
        initial[piece.id] = { white: 0, black: 0 };
      }
      setBuyCounts(initial);
    } else {
      const game = createGameFromSetup(nextBundle.setup, nextBundle.board);
      setState(game);
      setActiveSetup(nextBundle.setup);
      setBudgetPhase(false);
    }
  }

  function adjustBuy(pieceId: string, side: "white" | "black", delta: number) {
    setBuyCounts((prev) => {
      const current = prev[pieceId] ?? { white: 0, black: 0 };
      const nextVal = Math.max(0, (current[side] ?? 0) + delta);
      const next = {
        ...prev,
        [pieceId]: {
          ...current,
          [side]: nextVal,
        },
      };
      return next;
    });
  }

  function startBudgetGame() {
    if (!bundle) return;
    if (currentBudget.white < 0 || currentBudget.black < 0) {
      setError("Budget exceeded. Reduce selected pieces.");
      return;
    }
    const setup = buildBudgetSetup(bundle.setup, bundle.board, buyCounts);
    setActiveSetup(setup);
    setState(createGameFromSetup(setup, bundle.board));
    setBudgetPhase(false);
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

    if (hit.side !== turnSide) {
      return;
    }
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

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row">
          <label>
            Setup
            <select value={selectedSetupId} onChange={(e) => setSelectedSetupId(e.target.value)}>
              <option value="">Select setup</option>
              {setups.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void loadSetup()}>Load Setup</button>
          <button onClick={restart} disabled={!state}>
            Restart
          </button>
          <button onClick={() => setSoundEnabled((v) => !v)}>
            Sound: {soundEnabled ? "On" : "Off"}
          </button>
        </div>
      </div>

      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}

      {budgetPhase && bundle ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Budget Buy Phase</h3>
          <p>
            Starting budget per side: <strong>{currentBudget.max}</strong>
          </p>
          <p>
            White remaining: <strong>{currentBudget.white}</strong> | Black remaining: <strong>{currentBudget.black}</strong>
          </p>
          {bundle.setup.pieceTypes.map((piece) => {
            const count = buyCounts[piece.id] ?? { white: 0, black: 0 };
            const price = piecePrice(piece);
            return (
              <div key={piece.id} className="row" style={{ marginBottom: 6, justifyContent: "space-between" }}>
                <span>
                  {piece.name} (<code>{piece.id}</code>) - cost {price}
                </span>
                <div className="row">
                  <span>W:</span>
                  <button onClick={() => adjustBuy(piece.id, "white", -1)}>-</button>
                  <span>{count.white}</span>
                  <button onClick={() => adjustBuy(piece.id, "white", 1)}>+</button>
                  <span>B:</span>
                  <button onClick={() => adjustBuy(piece.id, "black", -1)}>-</button>
                  <span>{count.black}</span>
                  <button onClick={() => adjustBuy(piece.id, "black", 1)}>+</button>
                </div>
              </div>
            );
          })}
          <button onClick={startBudgetGame}>Start Match</button>
        </div>
      ) : null}

      {state?.status === "finished" ? (
        <div className="card" style={{ marginBottom: 12, borderColor: "#4caf50" }}>
          <strong>Game Over.</strong> Winner: <strong>{state.winnerSide}</strong>
        </div>
      ) : null}

      {state && bundle && activeSetup ? (
        <div className="row" style={{ alignItems: "flex-start" }}>
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
                    {piece ? (
                      <img className="piece-img" src={pieceAssetForSide(activeSetup, piece)} />
                    ) : null}
                  </button>
                );
              });
            })}
          </div>

          <div style={{ minWidth: 320 }}>
            <div className="card">
              <h3>Turn</h3>
              <p>
                Side to move: <strong>{state.sides[state.currentTurnIndex]}</strong>
              </p>
              {state.status === "finished" ? (
                <p>
                  Winner: <strong>{state.winnerSide}</strong>
                </p>
              ) : null}
            </div>
            <div className="card" style={{ marginTop: 12 }}>
              <h3>Selection</h3>
              {selectedPiece ? (
                <p>
                  {selectedPiece.instanceId} ({selectedPiece.typeId}) at ({selectedPiece.x},{selectedPiece.y})
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
                    <li key={p.instanceId}>
                      {p.instanceId} ({p.side})
                    </li>
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
      ) : (
        <p>Load a setup to start playing.</p>
      )}
    </div>
  );
}
