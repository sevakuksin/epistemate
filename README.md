# Chess Variant Platform Pilot

Local browser-based pilot for building and playing custom chess-like variants.

## Features

- Local login stub (username only)
- Main menu with:
  - `Hot Seat` (playable)
  - `Create` (piece/board/setup tools)
  - `Rulebook` (in-app rules and prices)
  - `Vs Player` and `Vs NPC` placeholders
- Flexible rules engine (pattern-based movement + hook system)
- Capture-the-king default win condition
- Side-specific piece images (white/black)
- Sound effects for move and win
- Budget mode pre-game buy phase in Hot Seat

## New Piece Catalog (Default)

Implemented custom behavior now includes:

- `hegel`: queen movement, cannot repeat direction class on consecutive moves
- `nietzsche`: immobile and untargetable
- `vygotsky`: upgrades after captures (`pawn -> knight -> bishop -> rook -> queen`)
- `skinner`: after a capture, next move must repeat same vector if legal
- `freud`: slip probability can reroute chosen move to another legal move
- `attention_span`: limited movement radius + despawn after idle owner turns
- `placebo`: bishop-like real movement, stronger display metadata support
- `causal_loop`: seeded placeholder for future logic (behavior not implemented)

## Relative Prices (Default)

- king: 12
- queen: 9
- rook: 6
- bishop: 4
- knight: 3
- pawn: 1
- wiggler: 5
- hegel: 11
- nietzsche: 7
- vygotsky: 8
- skinner: 8
- freud: 7
- attention_span: 6
- placebo: 5
- causal_loop: 10

## Budget Mode

- Setup may define `budgetMode.enabled` and `budgetMode.startingBudget`
- In Hot Seat, players buy pieces before move one
- Spend is validated per side
- Kings are auto-placed so games remain playable

## Sound Files

Drop these files in `apps/web/public/assets/sfx/`:

- `move.mp3`
- `win.mp3`

If files are missing, the game still works (no sound output).

## Run Locally

Use WSL/Linux Node when working in `~/chess`.

```bash
cd ~/chess
rm -rf node_modules package-lock.json packages/*/node_modules apps/*/node_modules
npm install
npm run bootstrap
npm run dev
```

Open:

- Web: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:3001/api/health](http://localhost:3001/api/health)

## Project Structure

- `packages/shared`: shared schemas/types
- `packages/engine`: deterministic customizable move engine
- `apps/server`: Express + SQLite docs persistence
- `apps/web`: React + Vite frontend

## Notes About WSL vs Windows Node

If output mentions `CMD.EXE`, `\wsl.localhost`, or paths under `C:\Windows` while running scripts, your shell is invoking Windows Node/npm. Use Linux Node in WSL (`which node` should be `/usr/bin/node` or under `~/.nvm`).

## Documentation

See `ARCHITECTURE.md` for engine internals and data model details.
