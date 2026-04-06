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

### `tools/mqtt-test/`

MQTT broker (Mosquitto) and dual test harnesses (browser UI + CLI) for testing the kiosk's MQTT action panel integration end-to-end without a real smart home device or external broker.

**Files:**

| File | Purpose |
|------|---------|
| `mosquitto.conf` | Eclipse Mosquitto 2.x config; enables anonymous connections, plain MQTT on 1883, WebSocket on 9001 |
| `index.html` | Browser-based test harness; connects to `ws://localhost:9001/mqtt`; discovers state topics and publish topics from `/actions.json`; renders state toggle switches, command log, and manual publish form |
| `index.js` | Node.js CLI tool for MQTT testing; reads `data/actions.json` dynamically; provides subscribe, publish, simulate, ping modes |
| `package.json` | Dependencies for CLI tool (mqtt@^5.10.1) |
| `README.md` | Usage guide for CLI tool with examples and troubleshooting |

#### Browser Test Harness (index.html)

**How to enable in dev:**

1. Ensure `docker-compose.dev.yml` includes the `mqtt` service and nginx volume mount (already configured as of 2026-04-05):
   ```yaml
   mqtt:
     image: eclipse-mosquitto:2
     ports:
       - "1883:1883"
       - "9001:9001"
     volumes:
       - ./tools/mqtt-test/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
   ```

2. Start the dev stack:
   ```sh
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
   ```

3. Enable MQTT in the kiosk by adding to `data/streams.json`:
   ```json
   "mqtt": { "enabled": true }
   ```

4. Open the kiosk at `http://localhost:8080`

5. Open the test harness at `http://localhost:8080/mqtt-test.html`

**Test Harness UI:**

- **State Switches**: One toggle button per unique `state.topic` value in `actions.json`. Clicking a toggle cycles through known `onValue` values. Button glows green when current value matches an `onValue`.
- **Command Log**: Subscribes to all `publish.topic` values from actions. Logs each message as `[HH:MM:SS] topic → payload` (max 100 rows, auto-scrolls).
- **Manual Publish**: Topic + payload inputs + Send button for edge case testing.
- **Status Badge**: Grey=disconnected, green=connected, red=error.

**How to test:**

1. Assign the `living-room` action group to a view in the views editor
2. Click the action panel (⚡ button) in the kiosk
3. Press "Lights On" → observe in test harness log: `[HH:MM:SS] home/living/lights/set → ON`
4. Click the state switch on the test harness → kiosk action button should glow green
5. Manual publish form allows arbitrary topic/payload testing for edge cases

#### CLI Tool (index.js)

A Node.js command-line utility for testing MQTT without a browser. Useful for CI/CD, debugging, and scripting.

**Subcommands:**

```sh
node tools/mqtt-test/index.js subscribe          # Listen to all state topics
node tools/mqtt-test/index.js publish <id>       # Publish one action
node tools/mqtt-test/index.js simulate           # Simulate device responses
node tools/mqtt-test/index.js ping               # Test broker connectivity
node tools/mqtt-test/index.js --help             # Show usage
```

**Examples:**

```bash
# Test broker reachability
node tools/mqtt-test/index.js ping
# Output: [14:32:15] Broker: ws://localhost:9001, latency: 45ms, connected: true

# Watch all state topic traffic
node tools/mqtt-test/index.js subscribe

# Publish a test action (useful for triggering kiosk responses)
node tools/mqtt-test/index.js publish lights-on

# Simulate device responses (echo state back) for testing without real devices
node tools/mqtt-test/index.js simulate
```

**Features:**

- Reads `data/actions.json` at runtime — no hardcoded topics
- Timestamps on every output `[HH:MM:SS]`
- Color output when running in a terminal (can be disabled by piping)
- Credentials automatically masked as `***`
- Graceful shutdown on SIGINT (Ctrl+C)

**Dependencies:** Node.js 14+, `mqtt@^5.10.1` (included in local `package.json`).

**Exit codes:** 0 on success, 1 on error (connection failed, action not found, etc.).

**Setup:**

```bash
# Install dependencies
npm install --prefix tools/mqtt-test

# Or from project root (uses root mqtt package)
npm install
```

**Common workflows:**

1. **Develop actions without devices:** Run `node tools/mqtt-test/index.js simulate` in one terminal, click action buttons in the kiosk in another. The simulator will log all state changes.
2. **Debug broker traffic:** Run `node tools/mqtt-test/index.js subscribe` to watch all state topics. In another terminal, trigger actions or manually publish with `node tools/mqtt-test/index.js publish <id>`.
3. **Validate config:** Run `node tools/mqtt-test/index.js ping` to ensure the broker URL in `data/actions.json` is correct.

**Mosquitto listener configuration:**

```
allow_anonymous true     # Dev only; auth disabled for simplicity

listener 1883            # Plain MQTT/TCP; useful for mosquitto_pub/mosquitto_sub CLI tools
listener 9001            # WebSocket MQTT; required for browser clients (MQTT.js)
protocol websockets
```

**Dependencies:** Docker for Mosquitto container. Node.js 14+ and npm for the CLI tool.

**Exit codes:** Mosquitto container exits 0 on clean shutdown, non-zero on startup failure. CLI tool exits 0 on success, 1 on error.

**Notes:**
- Both test harnesses (browser + CLI) connect to the same broker at `ws://localhost:9001` (WebSocket) or `mqtt://localhost:1883` (raw MQTT)
- Topics are discovered dynamically from `/actions.json` on each run — no configuration needed
- Credentials (if any) are handled by the kiosk's MQTT_DEFAULTS in `www/js/config.js` (`host: window.location.hostname, port: 9001`)
- For production use, switch to a real broker and set credentials in `data/actions.json` and configure Mosquitto with `password_file`
- The `simulate` mode is useful for testing UI state updates without real devices — it automatically echoes back the configured `onValue` when a SET command is published

---

## `.claude/hooks/` — Claude Code lifecycle hooks

All hook scripts are Python `uv` inline scripts with `# /// script` headers. They require `uv` on the host. All are registered in `.claude/settings.json` and run automatically by Claude Code.

| Script | Event | What it does |
|--------|-------|--------------|
| `pre_tool_use.py` | `PreToolUse` | Blocks dangerous bash commands; logs all events to `.claude/logs/pre_tool_use.json` |
| `post_tool_use.py` | `PostToolUse` | Logs tool use events to `.claude/logs/post_tool_use.json` |
| `user_prompt_submit.py` | `UserPromptSubmit` | Logs prompts to `.claude/logs/prompts.json`; writes `.claude/data/last_prompt.txt` |
| `notification.py` | `Notification` | Logs notifications to `logs/notification.json`; speaks "your agent needs input" via TTS when `--notify` is set |
| `subagent_stop.py` | `SubagentStop` | Shows macOS notification on subagent completion; speaks a completion message via TTS when `--notify` is set |
| `stop.py` | `Stop` | Logs stop events to `logs/stop.json`; optionally copies transcript to `logs/chat.json` (`--chat`); speaks completion via TTS when `--notify` is set |
| `session_start.py` | `SessionStart` | Creates `.claude/data/sessions/{session_id}.json` |
| `session_end.py` | `SessionEnd` | Adds `ended_at` timestamp to the session file |

**Blocked commands (PreToolUse):**
- `rm -rf /` and `rm -rf ~`
- `git push --force` to `main` or `master`
- `DROP TABLE`
- `chmod -R 777 /`

**TTS system (`utils/tts/`):**

Three TTS backends are available. `notification.py`, `stop.py`, and `subagent_stop.py` all select the best available backend at runtime based on env vars:

| Script | Requires | Priority |
|--------|----------|----------|
| `utils/tts/elevenlabs_tts.py` | `ELEVENLABS_API_KEY` in env | 1 (highest) |
| `utils/tts/openai_tts.py` | `OPENAI_API_KEY` in env | 2 |
| `utils/tts/pyttsx3_tts.py` | nothing (offline) | 3 (fallback) |

Set `ENGINEER_NAME` in `.env` to have `notification.py` occasionally address you by name (30% probability).

**Exit codes:** `pre_tool_use.py` exits 2 on block; all other hooks exit 0.

**Log files written:**

| File | Written by |
|------|-----------|
| `.claude/logs/pre_tool_use.json` | `pre_tool_use.py` |
| `.claude/logs/post_tool_use.json` | `post_tool_use.py` |
| `.claude/logs/prompts.json` | `user_prompt_submit.py` |
| `.claude/logs/notifications.json` | `notification.py` |
| `.claude/logs/status_line.json` | `status_line.py` |
| `.claude/data/last_prompt.txt` | `user_prompt_submit.py` |
| `.claude/data/sessions/{id}.json` | `session_start.py`, `session_end.py` |

**Dependency:** `uv` must be installed on the host (`brew install uv` or `pip install uv`).

---

## `.claude/status_lines/status_line.py` — Status line

A `uv` inline Python script that outputs a single ANSI-coloured line for Claude Code's status bar:

```
[branch-name] | last-prompt-preview
```

Branch is shown in cyan; prompt preview (truncated to 60 chars) is shown in dim white. Writes a log entry to `.claude/logs/status_line.json`.

**Invoke:** `uv run .claude/status_lines/status_line.py`

---

## `.claude/commands/` — Slash commands

Custom slash commands available in Claude Code sessions (`/command-name`):

| Command | File | What it does |
|---------|------|--------------|
| `/prime` | `prime.md` | Bootstraps session context: lists tracked files, reads README and CLAUDE.md, summarises structure |
| `/git_status` | `git_status.md` | Reports current branch, uncommitted changes, and last 10 commits |
| `/question` | `question.md` | Answers a codebase question without modifying files; usage: `/question <your question>` |
| `/plan` | `plan.md` | Creates a spec file in `specs/` for a task; usage: `/plan <task description>` |

Spec files created by `/plan` are written to `specs/<kebab-case-name>.md` with sections: Task Description, Objective, Problem Statement, Solution Approach, Relevant Files, Step by Step Tasks, Acceptance Criteria.

---

## Planned / future scripts

The following tooling is defined in the subagent spec and may be added:

- **Schema validator** — validate `data/streams.json` and `data/views.json` against required fields; emit per-field errors.
- **WHEP health check** — iterate `data/streams.json`, probe each `http://<HOST_IP>:8889/<path>/whep` with GET; expect 405 for live streams.
- **RTSP reachability check** — `curl --max-time 5 rtsp://...` per stream source.
- **Docker service health** — `docker compose ps` wrapper with pass/fail per service.
- **End-to-end smoke test** — verify nginx serves `/streams.json` and `/views.json`, and WHEP endpoints respond.
