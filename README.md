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

## Installation

### Requirements

- Linux VPS (Ubuntu/Debian) for production deployment, or WSL/Linux for local dev
- Domain pointing to the server (**A record**) when using HTTPS
- **Node.js** ≥ 18 recommended
- **nginx** installed (production)
- **sudo** access on the VPS

### Monorepo: bootstrap (not plain `npm install`)

This repo does **not** use npm workspaces. Dependencies live in each package (`packages/shared`, `packages/engine`, `apps/server`, `apps/web`). A single `npm install` at the **repository root** only installs root devDependencies — it does **not** install per-package deps (e.g. `zod` in shared, `@cv/engine` in server).

**Always run `npm run bootstrap`** after clone and after `git pull` when dependencies change. It runs `npm install` in each package in order (see `scripts/bootstrap.mjs`). Without it, `npm run build` often fails with missing modules.

**Clean reinstall** (if installs are corrupted):

```bash
rm -rf node_modules package-lock.json packages/*/node_modules apps/*/node_modules
npm install
npm run bootstrap
```

If `apps/server` builds but cannot resolve `@cv/engine`, remove `packages/engine/node_modules` and reinstall after `packages/shared` is built, or run the clean reinstall above.

---

### Deploy on Linux VPS (Ubuntu/Debian)

#### 1. Clone repository

```bash
sudo mkdir -p /opt
cd /opt
sudo git clone https://github.com/YOUR_ORG/chess.git epistemate
sudo chown -R "$USER:$USER" /opt/epistemate
cd /opt/epistemate
```

#### 2. Install dependencies and build

This project uses **bootstrap** (monorepo), not a plain root `npm install`.

```bash
npm run bootstrap
npm run build
```

Build outputs:

- `apps/web/dist` — frontend static files
- `apps/server/dist` — backend

Run builds **as a normal user** with ownership of `/opt/epistemate` (not `sudo npm run …`).

#### 3. Prepare data directory

The SQLite database is created under `data/` relative to the process working directory.

```bash
sudo mkdir -p /opt/epistemate/data
sudo chown -R "$USER:$USER" /opt/epistemate/data
```

(Optional, if the rest of the tree should be owned by the deploy user: `sudo chown -R "$USER:$USER" /opt/epistemate`.)

#### 4. Configure backend (systemd)

Create `/etc/systemd/system/epistemate.service`:

```ini
[Unit]
Description=Epistemate Node API
After=network.target

[Service]
User=YOUR_USERNAME
Group=YOUR_USERNAME
WorkingDirectory=/opt/epistemate
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=HOST=127.0.0.1
Environment=REGISTRATION_CODE=your-secret
ExecStart=/usr/bin/node /opt/epistemate/apps/server/dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Replace `YOUR_USERNAME` and `REGISTRATION_CODE`. The server listens on **`127.0.0.1`** only by default; use **`Environment=HOST=0.0.0.0`** only if you need the API reachable without nginx.

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now epistemate
```

Check:

```bash
sudo systemctl status epistemate
journalctl -u epistemate -n 50 --no-pager
```

Verify the backend is bound locally:

```bash
ss -tulpn | grep 3001
```

Expected: `127.0.0.1:3001` (not `*:3001`).

#### 5. Configure nginx

Create `/etc/nginx/sites-available/epistemate`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name epistemate.yourdomain.com;

    root /opt/epistemate/apps/web/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

Enable the site:

```bash
sudo ln -sf /etc/nginx/sites-available/epistemate /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6. DNS and firewall

- Add an **A record**: `epistemate.yourdomain.com` → your VPS public IP.
- Allow HTTP and HTTPS; **do not** expose port **3001** publicly.

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

#### 7. HTTPS (Let’s Encrypt)

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d epistemate.yourdomain.com
```

Certbot will configure TLS, add HTTP→HTTPS redirect, and set up renewal.

#### 8. Test

Backend (from the server):

```bash
curl -sS http://127.0.0.1:3001/api/health
```

Frontend:

```bash
curl -I http://epistemate.yourdomain.com
curl -I https://epistemate.yourdomain.com
```

#### Architecture (production)

- **nginx** handles public traffic on ports **80** and **443**.
- **Frontend** is served from the static build: `apps/web/dist`.
- **Backend** runs under **systemd** on **`127.0.0.1:3001`**.
- **nginx** proxies **`/api`** and **`/ws`** to the backend.

#### After code changes

```bash
cd /opt/epistemate
git pull
npm run bootstrap
npm run build
sudo systemctl restart epistemate
```

If something breaks: `journalctl -u epistemate -f` and `sudo nginx -t`.

---

### Run locally (development)

Use WSL or Linux Node (see **Notes About WSL vs Windows Node** below).

```bash
cd /path/to/chess
npm install
npm run bootstrap
npm run dev
```

- Web: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:3001/api/health](http://localhost:3001/api/health)

Vite proxies `/api` and `/ws` to the backend on port 3001.

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

## Project Structure

- `packages/shared`: shared schemas/types
- `packages/engine`: deterministic customizable move engine
- `apps/server`: Express + SQLite docs persistence
- `apps/web`: React + Vite frontend

## Notes About WSL vs Windows Node

If output mentions `CMD.EXE`, `\wsl.localhost`, or paths under `C:\Windows` while running scripts, your shell is invoking Windows Node/npm. Use Linux Node in WSL (`which node` should be `/usr/bin/node` or under `~/.nvm`).

## Documentation

See `ARCHITECTURE.md` for engine internals and data model details.
