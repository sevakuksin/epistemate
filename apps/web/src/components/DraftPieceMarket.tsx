import { useMemo, useState } from "react";
import type { PieceTypeDefinition } from "@cv/shared";
import { PieceImage } from "./PieceImage";

type Side = "white" | "black";

type DraftPieceMarketProps = {
  pieces: PieceTypeDefinition[];
  side: Side;
  budgetRemaining: number;
  budgetMax: number;
  getCount: (pieceId: string) => number;
  onAdjust: (pieceId: string, delta: number) => void | Promise<void>;
  onConfirm: () => void | Promise<void>;
  confirmLabel: string;
};

function pieceInfo(piece: PieceTypeDefinition): string {
  const slipPct = Math.round(((piece.behavior?.slipProbability ?? 0.25) * 100) * 100) / 100;
  const byId: Record<string, string> = {
    king: "The VIP. Keep it breathing.",
    queen: "Power piece. Goes where it wants.",
    rook: "Straight lines, no poetry.",
    bishop: "Diagonals only. Stylish and efficient.",
    knight: "Jumps over traffic like it owns the place.",
    pawn: "Cheap, brave, and occasionally glorious.",
    hegel: "Moves not not... not like a rook but a bishop (and also a rook). Contradiction accepted.",
    nietzsche: "Refuses to move, refuses to die, refuses to explain.",
    vygotsky: "Learns in the nearest development zone: reward or the last row unlocks the knight stage.",
    skinner: "Learns with reward: after a capture, it repeats what got the treat.",
    freud: `Moves like a queen except when it doesn't (${slipPct}%). Blame your subconscious.`,
    attention_span: "What was it doing again? Move it or it may forget itself out of existence.",
    placebo: "Looks scary, acts humble: bishop moves in queen clothing.",
    causal_loop: "Prototype paradox machine. Future patch notes fear this one.",
  };
  return byId[piece.id] ?? "Custom piece. Configure behavior and movement in the editor.";
}


function piecePrice(piece: PieceTypeDefinition): number {
  if (piece.tags?.includes("king")) return 0;
  return typeof piece.price === "number" ? piece.price : 1;
}

function pieceAssetForSide(piece: PieceTypeDefinition, side: Side): string {
  return piece.assetBySide?.[side] ?? piece.asset;
}

export function DraftPieceMarket({
  pieces,
  side,
  budgetRemaining,
  budgetMax,
  getCount,
  onAdjust,
  onConfirm,
  confirmLabel,
}: DraftPieceMarketProps) {
  const [focusedPieceId, setFocusedPieceId] = useState<string | null>(null);

  const focusedPiece = useMemo(
    () => pieces.find((p) => p.id === focusedPieceId) ?? null,
    [pieces, focusedPieceId]
  );

  return (
    <div className="card card-elevated" style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h3>Build Your Army</h3>
        <span className={`badge ${budgetRemaining < 0 ? "danger" : "ok"}`}>
          Budget: {budgetRemaining} / {budgetMax}
        </span>
      </div>

      <div className="draft-shop-grid">
        {pieces.map((piece) => {
          const isKing = piece.tags?.includes("king");
          const count = getCount(piece.id);
          const price = piecePrice(piece);
          const selected = focusedPieceId === piece.id;
          return (
            <div
              key={piece.id}
              className={`piece-shop-card ${selected ? "selected" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault();
                setFocusedPieceId(piece.id);
              }}
            >
              <button
                type="button"
                className="piece-shop-info"
                onClick={() => setFocusedPieceId(piece.id)}
                title="Piece details"
              >
                i
              </button>
              <PieceImage className="piece-img" src={pieceAssetForSide(piece, side)} />
              <div className="piece-shop-name">{piece.name}</div>
              <div className="piece-shop-price">{isKing ? "Auto" : `${price} gold`}</div>
              <div className="piece-shop-controls">
                <button type="button" disabled={isKing} onClick={() => void onAdjust(piece.id, -1)}>-</button>
                <span className="piece-shop-count">{count}</span>
                <button type="button" disabled={isKing} onClick={() => void onAdjust(piece.id, 1)}>+</button>
              </div>
            </div>
          );
        })}
      </div>

      {focusedPiece ? (
        <div className="piece-info-panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{focusedPiece.name}</strong>
            <span className="badge">{focusedPiece.id}</span>
          </div>
          <p>{pieceInfo(focusedPiece)}</p>
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => void onConfirm()}>{confirmLabel}</button>
      </div>
    </div>
  );
}
