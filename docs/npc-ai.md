# NPC AI (in-browser minimax)

The Vs NPC mode runs a **minimax** search with **alpha–beta pruning** inside a **Web Worker** so the UI stays responsive. This document describes evaluation, search, Freud handling, and known limitations.

## Deterministic search vs live play

- **Search** calls `applyMove(state, move, { skipRandomSlip: true })` at every node so the lookahead tree is **deterministic** (Freud slip is not simulated).
- **When the AI commits a move** on the real board, the app uses normal `applyMove(state, move)` so **Freud slip can still change** the executed move, same as for humans.

## Evaluation (`npcEval.ts`)

All terms are combined into a score **from the root player’s perspective** (`evaluateForRoot(state, rootSide)`): **positive** favors the NPC’s side (in Vs NPC, the AI is **Black**, so `rootSide` is `"black"` when it is Black’s turn).

### Material

- For each piece: `price × 100` centipawns from the piece type definition.
- Pieces whose type `tags` include `"king"` are scored at **100_000** cp (draft `price` is ignored for kings).
- **Freud** uses its own draft **price** for material (same rule as other pieces), not a separate queen-equivalent weight.

### Mobility

- For each side, sum pseudo-legal move counts per piece, weighted by **0.12** per move (each piece’s contribution capped at 36 moves before weighting).
- The total mobility term is **capped** at **72** cp so it stays small relative to material.
- For **Freud**, the **positive** mobility slice for that piece is multiplied by **`1 - slipProbability`** (from `behavior.slipProbability`, default **0.2** if missing).

### Center control

- Only pieces with **price &lt; 3** get a small bonus based on **Manhattan distance** to the board center (closer is better), scaled by **2** cp per step up to **4** steps, then capped so the center term does not dominate.
- **Freud** center bonus (when it qualifies by price) uses the same **`1 - slipProbability`** multiplier on the **positive** portion.

### Tropism

- For each side, **non-king** pieces get a small bonus for being **closer** to the **enemy king** (Manhattan distance), scaled by **0.28** cp per “step” of closeness (relative to max board distance), **capped** at **56** cp per side. The **king** is excluded so we do not reward marching the king toward the opponent. **Freud** uses the same **`1 - slipProbability`** multiplier on the positive tropism slice.

### King in danger (pseudo-legal)

- Because moves are **pseudo-legal**, the king can stand on an attacked square. When **`isKingSquareAttacked(state, rootSide)`** is true, **`evaluateForRoot` subtracts `KING_IN_ATTACK_PENALTY` (85_000 cp)** — strong but below **`MATE_SCORE`** so terminal wins still dominate. This is **not** a chess rule; it steers search away from obvious king blunders.

### Terminal positions

- If `status === "finished"` and there is a winner: **±1_000_000** cp (`MATE_SCORE`) from the root side’s perspective; draws score **0**.

## Search (`npcSearch.ts`)

- **Legal moves** at each node: same idea as Hot Seat — all pieces for `state.sides[state.currentTurnIndex]`, `generatePseudoLegalMoves` each, merged.
- **Move ordering**: `orderMovesForSearch` sorts **all captures before any non-capture** (stable tie-break). There is **no** MVV-LVA (most-valuable-victim / least-valuable-attacker) ordering among captures.
- **Minimax** with **alpha–beta**; scores use **`evaluateForRoot`** everywhere so finished-game `currentTurnIndex` quirks (winner stored as last mover) do not flip mate scores incorrectly.
- **Iterative deepening**: depths `1 .. maxDepth` (default **8**) until the **time budget** (ms) is exceeded; the last **completed** depth’s best move is kept.
- **Extensions**: if a move is a **capture** (`move.captureId`) or gives **check** to the opponent (king square attacked after the move), the child search gets **+1** extra ply of depth, up to **2** total extra plies along a single root line (`MAX_EXTENSION_PLIES`).
- **Quiescence** when the main depth reaches **0**: continue along **checks** (opponent king attacked after the move) **and** **captures**, up to **5** plies (`QUIESCENCE_DEPTH`). Moves are ordered **checks first**, then **non-check captures**; within checks, **capturing checks** before **quiet checks** (better alpha–beta pruning). There is **no** huge static penalty for “being in check” by itself — tactics are resolved by search through to king loss (`MATE_SCORE`) when lines terminate.

### Inputs

`findBestMove(state, { timeMs, maxDepth? })` assumes the **side to move** in `state` is the NPC; it uses `rootSide = state.sides[state.currentTurnIndex]`.

### Time budget and “how many moves”

- **Time cap**: `deadline = Date.now() + timeMs`. Whenever search enters `minimax` / `quiescence` and `Date.now() > deadline`, the node returns **static** `evaluateForRoot` instead of expanding further. So the cap is **soft** at the tree level (many shallow returns) but **hard** in the sense that no branch keeps searching past the deadline.
- **Depth**: **Iterative deepening** runs **root depth** `d = 1 … maxDepth` (default **8** in the engine if omitted). Here **d** is **plies from the root**: depth **1** = consider your move only; depth **2** = you + one opponent reply; and so on. **Capture/check extensions** add up to **+2** extra plies along a line (`MAX_EXTENSION_PLIES`). **Quiescence** (when the main line hits depth **0**) can follow up to **5** more **check/capture** plies (`QUIESCENCE_DEPTH`).
- **Vs NPC web defaults** (see `VsNpcPage` → worker): **`timeMs: 2500`**, **`maxDepth: 8`**. Lower values finish faster but can miss tactics if the tree is large (e.g. Epistemate).
- **Root moves**: Legal moves are ordered **captures first**. Every root move is still **scored**; when time is exhausted, deeper nodes collapse to static eval quickly so the AI does not skip entire candidate moves at the root.

## Known limitations

- **Hooks** with long-term or hidden effects (attention span decay, dialectic rules, etc.) are only partially reflected; static eval does not model future hook outcomes.
- **Quiescence** explores **checks and captures**, not arbitrary quiet moves.
- **Small board / variant** piece sets: evaluation weights are tuned to be small next to material, not to be “engine-perfect” on arbitrary setups.
