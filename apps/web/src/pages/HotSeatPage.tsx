import { useEffect, useMemo, useState } from "react";
import type { CompactMove, GameState } from "@cv/engine";
import { applyMove, createGameFromSetup, generatePseudoLegalMoves } from "@cv/engine";
import type { BoardDefinition, GameSetup, PieceInstance } from "@cv/shared";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../state/auth";

type Bundle = {
  board: BoardDefinition;
  setup: GameSetup;
};

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

export function HotSeatPage() {
  const { user } = useAuth();
  const [setups, setSetups] = useState<GameSetup[]>([]);
  const [selectedSetupId, setSelectedSetupId] = useState("");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<CompactMove[]>([]);
  const [error, setError] = useState("");

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

  async function loadSetup() {
    if (!user || !selectedSetupId) return;
    const data = await api.getSetupBundle(user.id, selectedSetupId);
    const nextBundle: Bundle = { board: data.board, setup: data.setup };
    setBundle(nextBundle);
    const game = createGameFromSetup(data.setup, data.board);
    setState(game);
    setSelectedPieceId(null);
    setLegalMoves([]);
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
    if (!bundle) return;
    setState(createGameFromSetup(bundle.setup, bundle.board));
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
        </div>
      </div>

      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}

      {state && bundle ? (
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
                      <img className="piece-img" src={pieceAssetForSide(bundle.setup, piece)} />
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
