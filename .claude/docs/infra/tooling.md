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
