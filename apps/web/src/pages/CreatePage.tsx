import { useEffect, useMemo, useState } from "react";
import type { BoardDefinition, GameSetup, Pattern, PieceInstance, PieceTypeDefinition } from "@cv/shared";
import { Link, useLocation } from "react-router-dom";
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

function squareColor(x: number, y: number): "light" | "dark" {
  return (x + y) % 2 === 0 ? "light" : "dark";
}

const defaultPiece: PieceTypeDefinition = {
  id: "",
  name: "",
  asset: "/assets/placeholders/rook.svg",
  assetBySide: {
    white: "/assets/placeholders/rook_white.svg",
    black: "/assets/placeholders/rook.svg",
  },
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
  price: 1,
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
  budgetMode: { enabled: true, startingBudget: 40 },
};

const EDITOR_SIZE = 9;
const EDITOR_CENTER = 4;

type MovementMode = "step" | "slide" | "jump";

type PieceTemplate = {
  id: string;
  name: string;
  mode: MovementMode;
  vectors: Array<{ dx: number; dy: number }>;
  whiteImage: string;
  blackImage: string;
  tags?: string[];
  relativeToSide?: boolean;
  hooks?: string[];
  price: number;
  behavior?: PieceTypeDefinition["behavior"];
  displayRepresentation?: string;
  defaultState?: Record<string, unknown>;
};

const ORTHO = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];
const DIAG = [
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];

const templates: PieceTemplate[] = [
  { id: "king", name: "King", mode: "step", vectors: [...ORTHO, ...DIAG], whiteImage: "/assets/placeholders/king_white.svg", blackImage: "/assets/placeholders/king.svg", tags: ["king"], hooks: ["castleLike"], price: 12 },
  { id: "queen", name: "Queen", mode: "slide", vectors: [...ORTHO, ...DIAG], whiteImage: "/assets/placeholders/queen_white.svg", blackImage: "/assets/placeholders/queen.svg", price: 9 },
  { id: "rook", name: "Rook", mode: "slide", vectors: ORTHO, whiteImage: "/assets/placeholders/rook_white.svg", blackImage: "/assets/placeholders/rook.svg", price: 6 },
  { id: "bishop", name: "Bishop", mode: "slide", vectors: DIAG, whiteImage: "/assets/placeholders/bishop_white.svg", blackImage: "/assets/placeholders/bishop.svg", price: 4 },
  { id: "knight", name: "Knight", mode: "jump", vectors: [{ dx: 1, dy: 2 }, { dx: 2, dy: 1 }, { dx: -1, dy: 2 }, { dx: -2, dy: 1 }, { dx: 1, dy: -2 }, { dx: 2, dy: -1 }, { dx: -1, dy: -2 }, { dx: -2, dy: -1 }], whiteImage: "/assets/placeholders/knight_white.svg", blackImage: "/assets/placeholders/knight.svg", price: 3 },
  { id: "pawn", name: "Pawn", mode: "step", vectors: [{ dx: 0, dy: 1 }], whiteImage: "/assets/placeholders/pawn_white.svg", blackImage: "/assets/placeholders/pawn.svg", tags: ["pawn"], relativeToSide: true, price: 1 },
  { id: "wiggler", name: "Wiggler", mode: "step", vectors: ORTHO, whiteImage: "/assets/placeholders/wiggler_white.svg", blackImage: "/assets/placeholders/wiggler.svg", hooks: ["noRepeatDirection"], price: 5 },
  { id: "hegel", name: "Hegel", mode: "slide", vectors: [...ORTHO, ...DIAG], whiteImage: "/assets/placeholders/queen_white.svg", blackImage: "/assets/placeholders/queen.svg", hooks: ["hegelDialectic"], defaultState: { lastDirectionClass: null }, price: 11 },
  { id: "nietzsche", name: "Nietzsche", mode: "slide", vectors: [...ORTHO, ...DIAG], whiteImage: "/assets/placeholders/king_white.svg", blackImage: "/assets/placeholders/king.svg", hooks: ["nietzscheStatic"], tags: ["untargetable"], price: 7 },
  { id: "vygotsky", name: "Vygotsky", mode: "slide", vectors: [...ORTHO, ...DIAG], whiteImage: "/assets/placeholders/pawn_white.svg", blackImage: "/assets/placeholders/pawn.svg", hooks: ["vygotskyEvolution"], behavior: { stageSequence: ["pawn", "knight", "bishop", "rook", "queen"] }, defaultState: { stageIndex: 0 }, price: 8 },
  { id: "skinner", name: "Skinner", mode: "slide", vectors: [...ORTHO, ...DIAG], whiteImage: "/assets/placeholders/rook_white.svg", blackImage: "/assets/placeholders/rook.svg", hooks: ["skinnerReinforce"], defaultState: { mustRepeatAfterReward: false, lastMoveVector: null }, price: 8 },
  { id: "freud", name: "Freud", mode: "slide", vectors: [...ORTHO, ...DIAG], whiteImage: "/assets/placeholders/bishop_white.svg", blackImage: "/assets/placeholders/bishop.svg", hooks: ["freudSlip"], behavior: { slipProbability: 0.25 }, price: 7 },
  { id: "attention_span", name: "Attention Span", mode: "slide", vectors: [...ORTHO, ...DIAG], whiteImage: "/assets/placeholders/knight_white.svg", blackImage: "/assets/placeholders/knight.svg", hooks: ["attentionSpanLocal"], behavior: { attentionRadius: 1, attentionIdleLimit: 4 }, defaultState: { turnsSinceMoved: 0 }, price: 6 },
  { id: "placebo", name: "Placebo", mode: "slide", vectors: DIAG, whiteImage: "/assets/placeholders/queen_white.svg", blackImage: "/assets/placeholders/queen.svg", displayRepresentation: "queen", price: 5 },
  { id: "causal_loop", name: "Causal Loop", mode: "step", vectors: [{ dx: 1, dy: 0 }], whiteImage: "/assets/placeholders/wiggler_white.svg", blackImage: "/assets/placeholders/wiggler.svg", price: 10 },
];

function vectorKey(dx: number, dy: number): string {
  return `${dx},${dy}`;
}

function keyToVector(key: string): { dx: number; dy: number } {
  const [dx, dy] = key.split(",").map(Number);
  return { dx, dy };
}

function patternFromVisual(selected: string[], mode: MovementMode, relativeToSide: boolean): Pattern {
  const vectors = selected.map(keyToVector);
  return {
    kind: mode,
    vectors,
    blockers: mode === "jump" ? "none" : "all",
    range: mode === "step" ? 1 : undefined,
    relativeToSide: relativeToSide || undefined,
  };
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function CreatePage() {
  const { user } = useAuth();
  const location = useLocation();
  const [pieces, setPieces] = useState<PieceTypeDefinition[]>([]);
  const [boards, setBoards] = useState<BoardDefinition[]>([]);
  const [setups, setSetups] = useState<GameSetup[]>([]);
  const [pieceDraft, setPieceDraft] = useState<PieceTypeDefinition>(defaultPiece);
  const [boardDraft, setBoardDraft] = useState<BoardDefinition>(defaultBoard);
  const [setupDraft, setSetupDraft] = useState<GameSetup>(defaultSetup);
  const [placementText, setPlacementText] = useState("[]");
  const [status, setStatus] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedVectorKeys, setSelectedVectorKeys] = useState<string[]>([]);
  const [movementMode, setMovementMode] = useState<MovementMode>("step");
  const [relativeToSide, setRelativeToSide] = useState(false);

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
  const mode = useMemo<"piece" | "board" | null>(() => {
    if (location.pathname.endsWith("/piece")) return "piece";
    if (location.pathname.endsWith("/board")) return "board";
    return null;
  }, [location.pathname]);

  function loadVisualFromPiece(piece: PieceTypeDefinition) {
    const firstPattern = piece.movementRules[0] ?? piece.captureRules[0];
    if (firstPattern) {
      setSelectedVectorKeys(firstPattern.vectors.map((v) => vectorKey(v.dx, v.dy)));
      setMovementMode(firstPattern.kind);
      setRelativeToSide(Boolean(firstPattern.relativeToSide));
    } else {
      setSelectedVectorKeys([]);
      setMovementMode("step");
      setRelativeToSide(false);
    }
  }

  function applyTemplate(templateId: string) {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    const nextDraft: PieceTypeDefinition = {
      ...pieceDraft,
      id: tpl.id,
      name: tpl.name,
      asset: tpl.blackImage,
      assetBySide: {
        white: tpl.whiteImage,
        black: tpl.blackImage,
      },
      tags: tpl.tags ?? [],
      pieceHooks: tpl.hooks ?? [],
      price: tpl.price,
      behavior: tpl.behavior,
      displayRepresentation: tpl.displayRepresentation,
      defaultState: tpl.defaultState ?? {},
    };
    setPieceDraft(nextDraft);
    setMovementMode(tpl.mode);
    setSelectedVectorKeys(tpl.vectors.map((v) => vectorKey(v.dx, v.dy)));
    setRelativeToSide(Boolean(tpl.relativeToSide));
  }

  async function setSideImage(side: "white" | "black", file: File) {
    const data = await fileToDataUrl(file);
    setPieceDraft((prev) => ({
      ...prev,
      asset: side === "black" ? data : prev.asset,
      assetBySide: {
        ...(prev.assetBySide ?? {}),
        [side]: data,
      },
    }));
  }

  async function savePiece() {
    if (!user) return;
    const movement = patternFromVisual(selectedVectorKeys, movementMode, relativeToSide);
    const body: PieceTypeDefinition = {
      ...pieceDraft,
      tags: pieceDraft.tags ?? [],
      price: typeof pieceDraft.price === "number" ? pieceDraft.price : 1,
      movementRules: selectedVectorKeys.length > 0 ? [movement] : [],
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
        <div className="row">
          <Link to="/create/piece"><button type="button">Create Piece</button></Link>
          <Link to="/create/board"><button type="button">Create Board</button></Link>
          <Link to="/">Back to menu</Link>
        </div>
      </div>
      {status ? <p>{status}</p> : null}
      {mode === null ? <p>Choose an endpoint: Create Piece or Create Board.</p> : null}

      <div className="row" style={{ alignItems: "stretch" }}>
        {mode === "piece" ? (
          <section className="card" style={{ flex: 1, minWidth: 360 }}>
            <h2>Piece Creator</h2>
            <label>
              Quick template
              <select style={{ width: "100%" }} value={selectedTemplate} onChange={(e) => { setSelectedTemplate(e.target.value); applyTemplate(e.target.value); }}>
                <option value="">Select template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <div className="row">
              <label>ID<input value={pieceDraft.id} onChange={(e) => setPieceDraft({ ...pieceDraft, id: e.target.value })} /></label>
              <label>Name<input value={pieceDraft.name} onChange={(e) => setPieceDraft({ ...pieceDraft, name: e.target.value })} /></label>
              <label>Price<input type="number" value={pieceDraft.price ?? 1} onChange={(e) => setPieceDraft({ ...pieceDraft, price: Math.max(0, Number(e.target.value) || 0) })} /></label>
            </div>

            <div className="row">
              <label style={{ flex: 1 }}>
                White image (drop png/svg)
                <div className="card" style={{ minHeight: 74, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) void setSideImage("white", file); }}>
                  <img className="piece-img" src={pieceDraft.assetBySide?.white || pieceDraft.asset} />
                  <input type="file" accept=".png,.svg,image/png,image/svg+xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) void setSideImage("white", f); }} />
                </div>
              </label>
              <label style={{ flex: 1 }}>
                Black image (drop png/svg)
                <div className="card" style={{ minHeight: 74, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) void setSideImage("black", file); }}>
                  <img className="piece-img" src={pieceDraft.assetBySide?.black || pieceDraft.asset} />
                  <input type="file" accept=".png,.svg,image/png,image/svg+xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) void setSideImage("black", f); }} />
                </div>
              </label>
            </div>

            <div className="row">
              <label>
                Display representation
                <input value={pieceDraft.displayRepresentation ?? ""} onChange={(e) => setPieceDraft({ ...pieceDraft, displayRepresentation: e.target.value || undefined })} placeholder="optional e.g. queen" />
              </label>
              <label>
                Hooks (comma-separated)
                <input value={(pieceDraft.pieceHooks ?? []).join(",")} onChange={(e) => setPieceDraft({ ...pieceDraft, pieceHooks: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} />
              </label>
            </div>

            <div className="row">
              <label>
                Freud slip probability
                <input type="number" step="0.05" min={0} max={1} value={pieceDraft.behavior?.slipProbability ?? 0} onChange={(e) => setPieceDraft({ ...pieceDraft, behavior: { ...(pieceDraft.behavior ?? {}), slipProbability: Math.max(0, Math.min(1, Number(e.target.value) || 0)) } })} />
              </label>
              <label>
                Attention radius
                <input type="number" min={1} value={pieceDraft.behavior?.attentionRadius ?? 1} onChange={(e) => setPieceDraft({ ...pieceDraft, behavior: { ...(pieceDraft.behavior ?? {}), attentionRadius: Math.max(1, Number(e.target.value) || 1) } })} />
              </label>
              <label>
                Attention idle limit
                <input type="number" min={1} value={pieceDraft.behavior?.attentionIdleLimit ?? 4} onChange={(e) => setPieceDraft({ ...pieceDraft, behavior: { ...(pieceDraft.behavior ?? {}), attentionIdleLimit: Math.max(1, Number(e.target.value) || 1) } })} />
              </label>
            </div>

            <div className="card" style={{ marginTop: 10 }}>
              <h3 style={{ marginTop: 0 }}>Visual move editor (9x9)</h3>
              <p style={{ marginTop: 0 }}>Center is your piece. Click squares it can see/move to.</p>
              <div className="row">
                <label><input type="checkbox" checked={movementMode === "jump"} onChange={(e) => setMovementMode(e.target.checked ? "jump" : "step")} /> Jumping</label>
                <label><input type="checkbox" checked={movementMode === "slide"} onChange={(e) => setMovementMode(e.target.checked ? "slide" : "step")} /> Sliding</label>
                <label><input type="checkbox" checked={relativeToSide} onChange={(e) => setRelativeToSide(e.target.checked)} /> Relative to side</label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: `repeat(${EDITOR_SIZE}, 34px)`, width: EDITOR_SIZE * 34, marginTop: 8 }}>
                {Array.from({ length: EDITOR_SIZE }).flatMap((_, y) =>
                  Array.from({ length: EDITOR_SIZE }).map((__, x) => {
                    const dx = x - EDITOR_CENTER;
                    const dy = y - EDITOR_CENTER;
                    const isCenter = dx === 0 && dy === 0;
                    const key = vectorKey(dx, dy);
                    const active = selectedVectorKeys.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`square ${squareColor(x, y)} ${isCenter ? "selected" : ""} ${active ? "legal" : ""}`}
                        style={{ width: 34, height: 34, fontSize: 10, padding: 0 }}
                        onClick={() => {
                          if (isCenter) return;
                          setSelectedVectorKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
                        }}
                      >
                        {isCenter ? <img className="piece-img" style={{ width: 20, height: 20 }} src={pieceDraft.assetBySide?.white || pieceDraft.asset} /> : ""}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <button onClick={() => void savePiece()}>Save Piece</button>
            <hr />
            <h3>Piece Library</h3>
            {pieces.map((p) => (
              <div key={p.id} className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                <span>{p.name} <code>{p.id}</code> (price {p.price ?? 1})</span>
                <button onClick={() => { setPieceDraft(p); loadVisualFromPiece(p); }}>Edit</button>
              </div>
            ))}
          </section>
        ) : null}

        {mode === "board" ? (
          <section className="card" style={{ flex: 1, minWidth: 360 }}>
            <h2>Board / Setup Creator</h2>
            <h3>Board</h3>
            <div className="row">
              <label>Board ID<input value={boardDraft.id} onChange={(e) => setBoardDraft({ ...boardDraft, id: e.target.value })} /></label>
              <label>Name<input value={boardDraft.name} onChange={(e) => setBoardDraft({ ...boardDraft, name: e.target.value })} /></label>
              <label>Width<input type="number" value={boardDraft.width} onChange={(e) => setBoardDraft({ ...boardDraft, width: Number(e.target.value) || 1 })} /></label>
              <label>Height<input type="number" value={boardDraft.height} onChange={(e) => setBoardDraft({ ...boardDraft, height: Number(e.target.value) || 1 })} /></label>
            </div>
            <button onClick={() => void saveBoard()}>Save Board</button>
            <hr />
            <h3>Setup</h3>
            <div className="row">
              <label>Setup ID<input value={setupDraft.id} onChange={(e) => setSetupDraft({ ...setupDraft, id: e.target.value })} /></label>
              <label>Name<input value={setupDraft.name} onChange={(e) => setSetupDraft({ ...setupDraft, name: e.target.value })} /></label>
            </div>
            <div className="row">
              <label>
                Budget enabled
                <input type="checkbox" checked={Boolean(setupDraft.budgetMode?.enabled)} onChange={(e) => setSetupDraft({ ...setupDraft, budgetMode: { enabled: e.target.checked, startingBudget: setupDraft.budgetMode?.startingBudget ?? 40 } })} />
              </label>
              <label>
                Starting budget
                <input type="number" min={0} value={setupDraft.budgetMode?.startingBudget ?? 40} onChange={(e) => setSetupDraft({ ...setupDraft, budgetMode: { enabled: setupDraft.budgetMode?.enabled ?? true, startingBudget: Math.max(0, Number(e.target.value) || 0) } })} />
              </label>
            </div>
            <label>
              Board
              <select value={setupDraft.boardId} onChange={(e) => setSetupDraft({ ...setupDraft, boardId: e.target.value })}>
                <option value="">Select board</option>
                {boards.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.width}x{b.height})</option>)}
              </select>
            </label>
            <label>
              Include piece types (comma-separated IDs)
              <input style={{ width: "100%" }} value={setupDraft.pieceTypes.map((p) => p.id).join(",")} onChange={(e) => {
                const ids = e.target.value.split(",").map((v) => v.trim()).filter(Boolean);
                setSetupDraft({ ...setupDraft, pieceTypes: ids.map((id) => pieceTypesById.get(id)).filter(Boolean) as PieceTypeDefinition[] });
              }} />
            </label>
            <label>
              Placed pieces JSON
              <textarea style={{ width: "100%", minHeight: 180 }} value={placementText} onChange={(e) => setPlacementText(e.target.value)} />
            </label>
            <button onClick={() => void saveSetup()}>Save Setup</button>
            <hr />
            <h3>Saved Boards</h3>
            {boards.map((b) => <div key={b.id} className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}><span>{b.name} <code>{b.id}</code></span><button onClick={() => setBoardDraft(b)}>Edit</button></div>)}
            <h3>Saved Setups</h3>
            {setups.map((s) => (
              <div key={s.id} className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                <span>{s.name} <code>{s.id}</code></span>
                <button onClick={() => { setSetupDraft(s); setPlacementText(jsonText(s.placedPieces)); }}>Edit</button>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}
