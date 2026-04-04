# Docker Operations Guide

Operations for the rtsp-kiosk project: a self-hosted IP camera video wall using MediaMTX, WebRTC, and Nginx.

## Project Stack

Three core services defined in `docker-compose.yml`:

| Service | Role | Port(s) | Notes |
|---------|------|---------|-------|
| **stun** | STUN server for WebRTC ICE | 3478 UDP/TCP | Uses `HOST_IP` and `STUN_PORT` env vars |
| **mediamtx** | RTSP/WebRTC media server | 8554, 8000-8001 (UDP), 8189 (UDP), 8889, 9997 | Rebuilt on Dockerfile changes; depends on stun |
| **nginx** | Frontend server (vanilla JS SPA) | 80 | Serves from `www/` or `data/` JSON configs; depends on mediamtx |

## Common Commands

All commands run from project root.

### Start / Stop

```bash
# Start all services in background
docker compose up -d

# Stop all services
docker compose down

# Restart a single service
docker compose restart <service>
```

### Build & Rebuild

```bash
# Full rebuild (clean rebuild, all services)
docker compose build --no-cache && docker compose up -d

# Rebuild a single service and bring it up
docker compose build mediamtx && docker compose up -d mediamtx
docker compose build nginx && docker compose up -d nginx
```

### Logs & Status

```bash
# View live logs for a service
docker compose logs -f <service>

# View last N lines of logs
docker compose logs --tail=50 <service>

# Show container status
docker compose ps
```

## Dev vs Prod Startup

### Production (default)

```bash
docker compose up -d
```

- nginx runs on **port 80**
- All frontend assets baked into image at build time
- Environment variables substituted via `envsubst` during container startup
- `www/` not mounted; changes require rebuild

### Development

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

- nginx runs on **port 8080**
- `www/index.html` and `www/js/app.js` bind-mounted (live reload, no rebuild needed)
- `envsubst` skipped — unsubstituted `$VAR` literals handled gracefully by JS
- mediamtx and stun unchanged from prod

## What Requires What?

| Change | Action needed |
|--------|--------------|
| Frontend JS/HTML (dev mode) | Nothing — bind-mounted |
| Frontend JS/HTML (prod) | Rebuild nginx |
| `data/streams-public.json`, `data/views-public.json` | Nothing — bind-mounted |
| `data/streams.json` or `data/mediamtx-base.yml` | Restart mediamtx |
| `Dockerfile.ui` or `nginx.conf` | Rebuild nginx |
| `Dockerfile.mediamtx` | Rebuild mediamtx |
| Environment variable changes | Restart affected service |

## Service Dependencies

Startup order: **stun → mediamtx → nginx**

Each service has a `depends_on` health check for the service before it.

## Environment Variables

Defined in `.env` (git-ignored):

| Variable | Default | Used by |
|----------|---------|---------|
| `HOST_IP` | (required) | stun, mediamtx |
| `STUN_PORT` | `3478` | stun, mediamtx |
| `FORCE_LAYOUT` | `""` | nginx (envsubst) |
| `FULLSCREEN_TIMEOUT` | `"30"` | nginx (envsubst) |
| `STREAM_REFRESH` | `""` | nginx (envsubst) |
| `ENABLE_MODALS` | `"true"` | nginx (envsubst) |
| `ENABLE_PRELOAD` | `""` | nginx (envsubst) |

## Troubleshooting

```bash
# Check service health
docker compose ps

# View recent errors
docker compose logs --tail=100 <service>

# Full clean restart
docker compose down && docker compose up -d
```
