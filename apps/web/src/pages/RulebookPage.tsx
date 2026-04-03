import { Link } from "react-router-dom";

const prices: Array<{ id: string; name: string; price: number }> = [
  { id: "king", name: "King", price: 12 },
  { id: "queen", name: "Queen", price: 9 },
  { id: "rook", name: "Rook", price: 6 },
  { id: "bishop", name: "Bishop", price: 4 },
  { id: "knight", name: "Knight", price: 3 },
  { id: "pawn", name: "Pawn", price: 1 },
  { id: "wiggler", name: "Wiggler", price: 5 },
  { id: "hegel", name: "Hegel", price: 11 },
  { id: "nietzsche", name: "Nietzsche", price: 7 },
  { id: "vygotsky", name: "Vygotsky", price: 8 },
  { id: "skinner", name: "Skinner", price: 8 },
  { id: "freud", name: "Freud", price: 7 },
  { id: "attention_span", name: "Attention Span", price: 6 },
  { id: "placebo", name: "Placebo", price: 5 },
  { id: "causal_loop", name: "Causal Loop", price: 10 },
];

export function RulebookPage() {
  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Rulebook</h1>
        <Link to="/">Back to menu</Link>
      </div>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3>Win Condition</h3>
        <p>Default victory condition is capture-the-king. There is no check/checkmate legality filter.</p>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3>Budget Mode</h3>
        <p>When enabled on a setup, each side gets a starting budget and buys pieces before move one.</p>
        <p>Kings are auto-placed so the match is always playable.</p>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3>Special Pieces</h3>
        <ul>
          <li>Hegel: queen movement, cannot repeat direction class (horizontal/vertical/diagonal) on consecutive moves.</li>
          <li>Nietzsche: cannot move and cannot be captured.</li>
          <li>Vygotsky: upgrades after each capture across stages pawn -&gt; knight -&gt; bishop -&gt; rook -&gt; queen.</li>
          <li>Skinner: after a capture, next move must repeat the same vector if a legal repeat exists.</li>
          <li>Freud: with configured slip probability, chosen move can be replaced by a random legal move.</li>
          <li>Attention Span: local radius movement; despawns after idle owner-turn threshold.</li>
          <li>Placebo: real movement is bishop-like, may be displayed as a stronger piece in UI metadata.</li>
          <li>Causal Loop: placeholder piece for future custom logic.</li>
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
