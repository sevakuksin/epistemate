# Chess Variant Platform Pilot

Local browser-based pilot for a customizable chess-like game engine with:

- Login/identity stub
- Main menu (`Hot Seat`, `Vs Player` stub, `Vs NPC` stub, `Create`)
- Hot Seat local play with legal move highlighting and move history
- Create mode for piece definitions, boards, and setups
- Capture-the-king win condition
- Seeded demo preset including a stateful custom rule (`noRepeatDirection`)

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

## What You Should See

1. `http://localhost:5173/login` local username login.
2. Main menu with 4 options.
3. In `Hot Seat`, load a setup and play turns locally.
4. In `Create`, edit/save piece types, boards, and setups.

## Current Placeholder Areas

- `Vs Player`: placeholder route only
- `Vs NPC`: placeholder route only

## Project Structure

- `packages/shared`: shared schemas/types
- `packages/engine`: customizable deterministic rules engine
- `apps/server`: Express + SQLite local API and persistence
- `apps/web`: Vite + React frontend

## Notes About WSL vs Windows Node

If output mentions `CMD.EXE`, `\\wsl.localhost`, or paths under `C:\Windows` while running scripts, your shell is invoking Windows Node/npm. Use a Linux Node install in WSL (`which node` should be `/usr/bin/node` or under `~/.nvm`).

## Documentation

See `ARCHITECTURE.md` for architecture, data model, rules design, and next steps.
