# OpenClaw Local API (VPS)

Runs a lightweight API on your Ubuntu VPS that reads local OpenClaw files and proxies gateway calls.

## Setup (Ubuntu)

1. Install dependencies:
   - Node.js 18+ recommended
   - Uses root `express` dependency from this repo

2. Create a systemd user service:

   Create `~/.config/systemd/user/openclaw-local-api.service`:

   ```ini
   [Unit]
   Description=OpenClaw Local API
   After=network.target

   [Service]
   WorkingDirectory=/home/ubuntu/aws
   ExecStart=/usr/bin/node /home/ubuntu/aws/server/local-api/index.js
   Restart=always
   RestartSec=3
   Environment=OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
   Environment=OPENCLAW_GATEWAY_TOKEN=YOUR_GATEWAY_TOKEN
   Environment=OPENCLAW_DIR=/home/ubuntu/.openclaw
   Environment=OPENCLAW_CONFIG_PATH=/home/ubuntu/.openclaw/openclaw.json
   Environment=OPENCLAW_WORKSPACE=/home/ubuntu/.openclaw/workspace
   Environment=LOCAL_API_PORT=3333

   [Install]
   WantedBy=default.target
   ```

3. Enable and start:

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now openclaw-local-api.service
   systemctl --user status openclaw-local-api.service
   ```

4. Expose via Cloudflare Tunnel or reverse proxy:
   - Example: map `https://api.magicteams.ai` to `http://127.0.0.1:3333`

5. Update Vercel env:
   - `VITE_API_BASE=https://api.magicteams.ai`

## Endpoints used by the web app

- `GET /api/health`
- `GET /api/agents`
- `GET /api/agents?action=status`
- `GET /api/agents?action=models`
- `POST /api/chat`
- `GET /api/chat?action=history`
- `GET /api/tasks`
- `POST /api/tasks`
- `POST /api/tasks/:id/run`
- `POST /api/tasks/:id/pickup`
- `POST /api/tasks/:id/complete`
- `GET /api/models`
- `POST /api/model`
- `GET /api/soul`
- `PUT /api/soul`
- `GET /api/workspace-file?name=...`
- `PUT /api/workspace-file?name=...`
