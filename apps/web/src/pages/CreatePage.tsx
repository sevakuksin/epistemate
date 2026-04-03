import { useEffect, useMemo, useState } from "react";
import type { BoardDefinition, GameSetup, PieceInstance, PieceTypeDefinition } from "@cv/shared";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../state/auth";

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const defaultPiece: PieceTypeDefinition = {
  id: "",
  name: "",
  asset: "/assets/placeholders/rook.svg",
  movementRules: [
    {
      kind: "step",
      vectors: [{ dx: 1, dy: 0 }],
      range: 1,
      blockers: "all",
    },
  ],
  captureRules: [],
  constraints: {},
  stateSchema: [],
  tags: [],
  defaultState: {},
  pieceHooks: [],
};

const defaultBoard: BoardDefinition = {
  id: "",
  name: "",
  width: 8,
  height: 8,
  squareMeta: {},
};

const defaultSetup: GameSetup = {
  id: "",
  name: "",
  boardId: "",
  sides: ["white", "black"],
  pieceTypes: [],
  placedPieces: [],
  winCondition: { type: "captureTag", tag: "king" },
};

export function CreatePage() {
  const { user } = useAuth();
  const [pieces, setPieces] = useState<PieceTypeDefinition[]>([]);
  const [boards, setBoards] = useState<BoardDefinition[]>([]);
  const [setups, setSetups] = useState<GameSetup[]>([]);
  const [pieceDraft, setPieceDraft] = useState<PieceTypeDefinition>(defaultPiece);
  const [boardDraft, setBoardDraft] = useState<BoardDefinition>(defaultBoard);
  const [setupDraft, setSetupDraft] = useState<GameSetup>(defaultSetup);
  const [placementText, setPlacementText] = useState("[]");
  const [status, setStatus] = useState("");

  async function refresh() {
    if (!user) return;
    const [p, b, s] = await Promise.all([
      api.listPieceTypes(user.id),
      api.listBoards(user.id),
      api.listSetups(user.id),
    ]);
    setPieces(p);
    setBoards(b);
    setSetups(s);
  }

  useEffect(() => {
    refresh().catch(() => setStatus("Failed to load create data."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const pieceTypesById = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);

  async function savePiece() {
    if (!user) return;
    const body: PieceTypeDefinition = {
      ...pieceDraft,
      tags: pieceDraft.tags ?? [],
      movementRules: pieceDraft.movementRules ?? [],
      captureRules: pieceDraft.captureRules ?? [],
      pieceHooks: pieceDraft.pieceHooks ?? [],
    };
    await api.savePieceType(user.id, body);
    setStatus(`Saved piece: ${body.id}`);
    await refresh();
  }

  async function saveBoard() {
    if (!user) return;
    await api.saveBoard(user.id, boardDraft);
    setStatus(`Saved board: ${boardDraft.id}`);
    await refresh();
  }

  async function saveSetup() {
    if (!user) return;
    const placed = parseJson<PieceInstance[]>(placementText, []);
    const embedded = setupDraft.pieceTypes.length
      ? setupDraft.pieceTypes
      : pieces.filter((p) => placed.some((pp) => pp.typeId === p.id));
    const body: GameSetup = {
      ...setupDraft,
      placedPieces: placed,
      pieceTypes: embedded,
    };
    await api.saveSetup(user.id, body);
    setStatus(`Saved setup: ${body.id}`);
    await refresh();
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Create</h1>
        <Link to="/">Back to menu</Link>
      </div>
      {status ? <p>{status}</p> : null}

      <div className="row" style={{ alignItems: "stretch" }}>
        <section className="card" style={{ flex: 1, minWidth: 360 }}>
          <h2>Piece Creator</h2>
          <div className="row">
            <label>
              ID
              <input
                value={pieceDraft.id}
                onChange={(e) => setPieceDraft({ ...pieceDraft, id: e.target.value })}
                placeholder="unique_piece_id"
              />
            </label>
            <label>
              Name
              <input value={pieceDraft.name} onChange={(e) => setPieceDraft({ ...pieceDraft, name: e.target.value })} />
            </label>
          </div>
          <label>
            Asset (svg/png path)
            <input
              style={{ width: "100%" }}
              value={pieceDraft.asset}
              onChange={(e) => setPieceDraft({ ...pieceDraft, asset: e.target.value })}
            />
          </label>
          <label>
            Tags (comma-separated)
            <input
              style={{ width: "100%" }}
              value={(pieceDraft.tags ?? []).join(",")}
              onChange={(e) =>
                setPieceDraft({
                  ...pieceDraft,
                  tags: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label>
            Piece hooks (comma-separated)
            <input
              style={{ width: "100%" }}
              value={(pieceDraft.pieceHooks ?? []).join(",")}
              onChange={(e) =>
                setPieceDraft({
                  ...pieceDraft,
                  pieceHooks: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label>
            Movement rules JSON
            <textarea
              style={{ width: "100%", minHeight: 120 }}
              value={jsonText(pieceDraft.movementRules)}
              onChange={(e) =>
                setPieceDraft({
                  ...pieceDraft,
                  movementRules: parseJson(e.target.value, pieceDraft.movementRules),
                })
              }
            />
          </label>
          <label>
            Capture rules JSON
            <textarea
              style={{ width: "100%", minHeight: 120 }}
              value={jsonText(pieceDraft.captureRules)}
              onChange={(e) =>
                setPieceDraft({
                  ...pieceDraft,
                  captureRules: parseJson(e.target.value, pieceDraft.captureRules),
                })
              }
            />
          </label>
          <button onClick={() => void savePiece()}>Save Piece</button>
          <hr />
          <h3>Piece Library</h3>
          {pieces.map((p) => (
            <div key={p.id} className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
              <span>
                {p.name} <code>{p.id}</code>
              </span>
              <button onClick={() => setPieceDraft(p)}>Edit</button>
            </div>
          ))}
        </section>

        <section className="card" style={{ flex: 1, minWidth: 360 }}>
          <h2>Board / Setup Creator</h2>
          <h3>Board</h3>
          <div className="row">
            <label>
              Board ID
              <input value={boardDraft.id} onChange={(e) => setBoardDraft({ ...boardDraft, id: e.target.value })} />
            </label>
            <label>
              Name
              <input value={boardDraft.name} onChange={(e) => setBoardDraft({ ...boardDraft, name: e.target.value })} />
            </label>
            <label>
              Width
              <input
                type="number"
                value={boardDraft.width}
                onChange={(e) => setBoardDraft({ ...boardDraft, width: Number(e.target.value) || 1 })}
              />
            </label>
            <label>
              Height
              <input
                type="number"
                value={boardDraft.height}
                onChange={(e) => setBoardDraft({ ...boardDraft, height: Number(e.target.value) || 1 })}
              />
            </label>
          </div>
          <button onClick={() => void saveBoard()}>Save Board</button>
          <hr />
          <h3>Setup</h3>
          <div className="row">
            <label>
              Setup ID
              <input value={setupDraft.id} onChange={(e) => setSetupDraft({ ...setupDraft, id: e.target.value })} />
            </label>
            <label>
              Name
              <input value={setupDraft.name} onChange={(e) => setSetupDraft({ ...setupDraft, name: e.target.value })} />
            </label>
          </div>
          <label>
            Board
            <select
              value={setupDraft.boardId}
              onChange={(e) => setSetupDraft({ ...setupDraft, boardId: e.target.value })}
            >
              <option value="">Select board</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.width}x{b.height})
                </option>
              ))}
            </select>
          </label>
          <label>
            Sides (comma-separated)
            <input
              style={{ width: "100%" }}
              value={setupDraft.sides.join(",")}
              onChange={(e) =>
                setSetupDraft({
                  ...setupDraft,
                  sides: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label>
            Include piece types (comma-separated IDs)
            <input
              style={{ width: "100%" }}
              value={setupDraft.pieceTypes.map((p) => p.id).join(",")}
              onChange={(e) => {
                const ids = e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean);
                setSetupDraft({
                  ...setupDraft,
                  pieceTypes: ids.map((id) => pieceTypesById.get(id)).filter(Boolean) as PieceTypeDefinition[],
                });
              }}
            />
          </label>
          <label>
            Placed pieces JSON
            <textarea
              style={{ width: "100%", minHeight: 180 }}
              value={placementText}
              onChange={(e) => setPlacementText(e.target.value)}
            />
          </label>
          <button onClick={() => void saveSetup()}>Save Setup</button>
          <hr />
          <h3>Saved Boards</h3>
          {boards.map((b) => (
            <div key={b.id} className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
              <span>
                {b.name} <code>{b.id}</code>
              </span>
              <button onClick={() => setBoardDraft(b)}>Edit</button>
            </div>
          ))}
          <h3>Saved Setups</h3>
          {setups.map((s) => (
            <div key={s.id} className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
              <span>
                {s.name} <code>{s.id}</code>
              </span>
              <button
                onClick={() => {
                  setSetupDraft(s);
                  setPlacementText(jsonText(s.placedPieces));
                }}
              >
                Edit
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
