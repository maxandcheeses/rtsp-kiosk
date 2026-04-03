# rtsp-kiosk — Tooling Reference

> **Audience**: `tooling-dev` subagent and operators running diagnostic or dev utilities.
> Scripts live in `scripts/` (container startup or quick CLI tasks) and `tools/` (standalone developer utilities).

---

## Dependencies

All scripts require standard POSIX tools. Additional dependencies per script are noted inline.

| Tool | Used by |
|------|---------|
| `jq` | Schema validators, config inspection |
| `curl` | WHEP endpoint probes, RTSP reachability checks |
| `docker` / `docker compose` | Service health checks, fake-streams tool |
| `ffmpeg` | Inside the fake-streams container only |

---

## `scripts/`

### `scripts/generate-config.sh`

Runs automatically at MediaMTX container startup (via `CMD` in the mediamtx Dockerfile). Do not invoke manually unless reproducing the container startup sequence.

**What it does:**
1. Reads `data/streams.json` and `data/mediamtx-base.yml`
2. Generates `data/mediamtx.yml` (MediaMTX path config with RTSP sources)
3. Generates `data/streams-public.json` (RTSP credentials replaced with `***`)
4. Generates `data/views-public.json` (copy of `data/views.json`)

**Do not modify** unless the task explicitly requires it — this script is critical to container startup.

---

## `tools/`

### `tools/fake-streams/`

A standalone Docker container that runs its own MediaMTX RTSP server and uses FFmpeg to publish 8 synthetic test streams. Intended for local development and testing when real IP cameras are unavailable.

**Files:**

| File | Purpose |
|------|---------|
| `Dockerfile` | Alpine 3.19 image; installs ffmpeg; downloads MediaMTX v1.9.3 |
| `docker-compose.yml` | Single `fake-streams` service; exposes host port **8555** → container port 8554 |
| `mediamtx.yml` | Minimal MediaMTX config; RTSP only; auth disabled; paths test-1 through test-8 |
| `fake-streams.sh` | Starts 8 ffmpeg processes, each publishing a 1280x720 @30fps colored stream |

**Streams published:**

| Path | Color |
|------|-------|
| `rtsp://localhost:8554/test-1` | Navy `#1a1a2e` |
| `rtsp://localhost:8554/test-2` | Dark blue `#16213e` |
| `rtsp://localhost:8554/test-3` | Ocean `#0f3460` |
| `rtsp://localhost:8554/test-4` | Purple `#533483` |
| `rtsp://localhost:8554/test-5` | Crimson `#e94560` |
| `rtsp://localhost:8554/test-6` | Forest green `#1b4332` |
| `rtsp://localhost:8554/test-7` | Brown `#7b3f00` |
| `rtsp://localhost:8554/test-8` | Teal `#2d6a4f` |

**How to run:**

```sh
cd tools/fake-streams
docker compose up --build
```

**How to consume from the main kiosk stack:**

Add entries to `data/streams.json` pointing to host port 8555:

```json
{
  "path": "test-1",
  "label": "Test Stream 1",
  "source": "rtsp://<HOST_IP>:8555/test-1"
}
```

**Port note:** Host port 8555 is used to avoid conflict with the main kiosk stack's MediaMTX on port 8554.

**Exit codes:** The container exits 0 on clean shutdown (SIGTERM/SIGINT), non-zero on startup failure.

**Dependencies (inside container):** `ffmpeg`, MediaMTX v1.9.3 (downloaded at build time from GitHub releases). No host dependencies beyond Docker.

---

## Planned / future scripts

The following tooling is defined in the subagent spec and may be added:

- **Schema validator** — validate `data/streams.json` and `data/views.json` against required fields; emit per-field errors.
- **WHEP health check** — iterate `data/streams.json`, probe each `http://<HOST_IP>:8889/<path>/whep` with GET; expect 405 for live streams.
- **RTSP reachability check** — `curl --max-time 5 rtsp://...` per stream source.
- **Docker service health** — `docker compose ps` wrapper with pass/fail per service.
- **End-to-end smoke test** — verify nginx serves `/streams.json` and `/views.json`, and WHEP endpoints respond.
