# Environment Variables

## Host-level (`.env`)

These are read by Docker Compose itself, not by any container entrypoint. The `.env` file is git-ignored.

| Variable | Default | Where used | Purpose |
|----------|---------|------------|---------|
| `HOST_IP` | none (required) | `mediamtx`, `stun` | LAN IP of the host machine. Used in STUN `--external-ip` and in `mediamtx-base.yml` ICE config. |
| `STUN_PORT` | `3478` | `mediamtx`, `stun` | UDP/TCP port for coturn. Change if 3478 conflicts with something else on the host. |

If `HOST_IP` is missing, the STUN server will not advertise a usable IP and WebRTC ICE will fail — streams will not play.

## MediaMTX container (`mediamtx` service)

Passed from compose into the container environment. Consumed by `generate-config.sh` via `envsubst`.

| Variable | Source | Purpose |
|----------|--------|---------|
| `HOST_IP` | `.env` | Substituted into `mediamtx-base.yml` → `webrtcICEServers2` URL and `webrtcAdditionalHosts` |
| `STUN_PORT` | `.env` | Substituted into the STUN server URL in `mediamtx-base.yml` |

## Nginx container (`nginx` service)

Injected into `index.html` by `envsubst` at container startup. All five variables are substituted at once; the variable list in the entrypoint command is explicit, so only these five are touched.

| Variable | Default in compose | Effect when empty/unset |
|----------|--------------------|------------------------|
| `FORCE_LAYOUT` | `""` | Layout picker is shown on load |
| `FULLSCREEN_TIMEOUT` | `"30"` | Auto-exit fullscreen after 30 seconds |
| `STREAM_REFRESH` | `""` | Disabled globally; per-stream `refreshInterval` still applies |
| `ENABLE_MODALS` | `"true"` | L and D keyboard shortcuts are active |
| `ENABLE_PRELOAD` | `""` | Preload lead time setting is hidden in the views editor |

### Detailed behaviour

**`FORCE_LAYOUT`**

Accepts any layout ID string: `single`, `two-col`, `two-row`, `primary-right`, `primary-left`, `primary-bottom`, `primary-top`, `quad`, `six`, `eight`. When set, all browser sessions start directly in that layout without showing the picker. Useful for kiosk installs where the layout is fixed.

**`FULLSCREEN_TIMEOUT`**

Number of seconds. Set to `"0"` to disable auto-exit entirely. The timer resets on user interaction.

**`STREAM_REFRESH`**

Controls the global reconnect interval for WebRTC streams.
- `""` (empty) — no global interval; per-stream `refreshInterval` in `streams.json` is honoured if set.
- `"0"` — completely disables refresh; per-stream `refreshInterval` is also ignored.
- `"30"` (or any positive number) — all streams reconnect every 30 seconds; per-stream values can still override.

**`ENABLE_MODALS`**

Set to `"false"` to hide the L/D keyboard shortcut hints and prevent access to the layout picker and stream info modal via keyboard. Intended for locked-down kiosk displays where operator control should be limited.

**`ENABLE_PRELOAD`**

Set to `"1"`, `"on"`, or `"true"` to expose the preload lead time field in the views editor modal. Off by default because the feature is experimental and the UI option clutters the editor for most users.

## Dev mode note

In `docker-compose.dev.yml`, the nginx entrypoint skips `envsubst`. All `$VAR` placeholders remain literally in `index.html`. The JS treats them as empty/falsy strings, so the app runs with all defaults. There is no way to test env var behaviour without the prod entrypoint.
