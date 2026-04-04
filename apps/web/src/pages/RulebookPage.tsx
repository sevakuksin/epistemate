import { Link } from "react-router-dom";

const prices: Array<{ id: string; name: string; price: number }> = [
  { id: "king", name: "King", price: 12 },
  { id: "queen", name: "Queen", price: 9 },
  { id: "rook", name: "Rook", price: 5 },
  { id: "bishop", name: "Bishop", price: 3 },
  { id: "knight", name: "Knight", price: 3 },
  { id: "pawn", name: "Pawn", price: 1 },
    { id: "hegel", name: "Hegel", price: 7 },
  { id: "nietzsche", name: "Nietzsche", price: 6 },
  { id: "vygotsky", name: "Vygotsky", price: 2 },
  { id: "skinner", name: "Skinner", price: 8 },
  { id: "freud", name: "Freud", price: 7 },
  { id: "attention_span", name: "Attention Span", price: 1 },
  { id: "placebo", name: "Placebo", price: 4 },
  { id: "causal_loop", name: "Causal Loop", price: 10 },
];

export function RulebookPage() {
  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Rulebook</h1><p className="subtitle">Core rules, special pieces, and economy guide.</p></div>
        <Link to="/">Back to menu</Link>
      </div>

      <section className="card card-elevated" style={{ marginBottom: 12 }}>
        <h3>Win Conditions and Draws</h3>
        <p><span className="badge ok">Capture-the-king</span> Capturing a king-tagged piece ends the game immediately.</p>
        <p><span className="badge warn">Stalemate draw</span> If the side to move has zero legal moves, the game ends as a draw.</p>
        <p>There is no check/checkmate legality gate: legal moves are generated directly by piece rules and hooks.</p>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3>Epistemate Draft Mechanics</h3>
        <ul>
          <li>Two-phase flow per side: buy pieces within budget, then place them.</li>
          <li>Kings are auto-included and free to guarantee a playable game.</li>
          <li>Placement is restricted to each side's first two rows.</li>
          <li>During online draft, state is server-authoritative and synchronized live.</li>
        </ul>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3>Special Pieces (Detailed)</h3>
        <ul>
          <li>Hegel: queen movement, but cannot repeat the same direction class (horizontal/vertical/diagonal) on consecutive moves.</li>
          <li>Nietzsche: cannot move, cannot be captured, and blocks like an untargetable monument.</li>
          <li>Vygotsky: stage-based growth system (pawn -&gt; knight -&gt; bishop -&gt; rook -&gt; queen). Stage increases on capture, and also from pawn stage when reaching the last row.</li>
          <li>Skinner: reinforcement behavior. After a capture, its next move is forced to repeat the reward vector if that vector is still legal.</li>
          <li>Freud: slip chance can replace your intended move with a random legal move.</li>
          <li>Attention Span: local movement radius plus idle decay; if not moved for enough owner turns, it disappears.</li>
          <li>Placebo: visual mind-game piece; displayed as strong, but real movement is bishop-like.</li>
          <li>Causal Loop: reserved placeholder for future custom logic/hook expansion.</li>
        </ul>
      </section>

      <section className="card">
        <h3>Default Prices</h3>
        <ul>
          {prices.map((p) => (
            <li key={p.id}>
              {p.name} (<code>{p.id}</code>): {p.price}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
