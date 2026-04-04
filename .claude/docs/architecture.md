# rtsp-kiosk — Architecture Reference

> **Audience**: All subagents (`/frontend-dev`, `/backend-dev`, `/design`).
> This document is the authoritative reference for how the system is built.
> Read the relevant section before making any change.

---

## 1. System Overview

rtsp-kiosk is a self-hosted, fullscreen IP camera video wall. It ingests RTSP streams, transcodes them to WebRTC, and delivers them to a browser kiosk over a local network — no cloud, no CDN.

```
┌─────────────────────────────────────────────────────────────┐
│                        Host Machine                         │
│                                                             │
│  ┌──────────┐   RTSP    ┌────────────┐   WHEP/WebRTC        │
│  │ IP Cams  │ ────────► │  MediaMTX  │ ◄─────────────────┐  │
│  └──────────┘           │  :8889     │                   │  │
│                         │  :8554     │                   │  │
│                         │  :9997 API │                   │  │
│                         └────────────┘                   │  │
│                                ▲                          │  │
│                         ICE/STUN                          │  │
│                                │                          │  │
│                         ┌──────────┐                      │  │
│                         │  coturn  │                      │  │
│                         │  :3478   │                      │  │
│                         └──────────┘                      │  │
│                                                           │  │
│  ┌──────────────────────────────────────────────────────┐ │  │
│  │                  Nginx  :80                          │ │  │
│  │  serves: index.html, css/app.css, js/app.js,        │ │  │
│  │          streams.json (sanitised), views.json        │ │  │
│  └──────────────────────┬───────────────────────────────┘ │  │
│                         │ HTTP                            │  │
│                         ▼                                 │  │
│  ┌──────────────────────────────────────────────────────┐ │  │
│  │               Browser (Kiosk Display)                │─┘  │
│  │  Vanilla JS SPA — renders video grid via CSS Grid    │    │
│  │  Opens WebRTC connections directly to MediaMTX       │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Docker Services

Three services defined in `docker-compose.yml`:

| Service | Image | Ports | Purpose |
|---------|-------|-------|---------|
| `stun` | `coturn/coturn` | `3478/udp+tcp` | STUN for WebRTC ICE — keeps traffic on LAN |
| `mediamtx` | `rtsp-kiosk-mediamtx` | `8554 8000 8001 8889 8189 9997` | RTSP ingest → WebRTC/WHEP transcode |
| `nginx` | `rtsp-kiosk-ui` | `80` | Serves the SPA + sanitised config JSON |
| `streams-api` *(planned)* | TBD | `9998` | Read/write `streams.json`; proxied by Nginx at `/api/streams` |

### Startup sequence

```
docker-compose up
        │
        ├─► stun starts (coturn)
        │
        ├─► mediamtx build
        │       └─► generate-config.sh runs BEFORE mediamtx
        │               ├─ reads  data/streams.json
        │               ├─ reads  data/mediamtx-base.yml
        │               ├─ writes data/mediamtx.yml      (RTSP path config)
        │               ├─ writes data/streams-public.json (credentials stripped)
        │               └─ writes data/views-public.json
        │           then exec /mediamtx data/mediamtx.yml
        │
        └─► nginx build
                └─► envsubst injects env vars into index.html
                    then nginx -g 'daemon off;'
```

### Dev compose (`docker-compose.dev.yml`)

Nginx only (no MediaMTX, no STUN). Live-mounts frontend files — no rebuild on change.

```yaml
volumes:
  - ./www/index.html        → /usr/share/nginx/html/index.html
  - ./www/css/app.css       → /usr/share/nginx/html/css/app.css
  - ./www/js/app.js         → /usr/share/nginx/html/js/app.js
  - ./data/streams-public.json → /usr/share/nginx/html/streams.json
  - ./data/views-public.json   → /usr/share/nginx/html/views.json
```

Port: `8080` (prod uses `80`).

---

## 3. Data Flow

### Boot sequence (browser)

```
Browser loads index.html
        │
        ├─ fetch /streams.json  ──► STREAMS[]  (global stream list)
        ├─ fetch /views.json    ──► VIEWS[], VIEWS_DEFAULT, VIEWS_CYCLE
        │
        ├─► if VIEWS_DEFAULT exists → activateView(VIEWS_DEFAULT)
        │           │
        │           ├─ filters STREAMS to view's subset (ordered)
        │           ├─ applyLayout(view.layout)
        │           │       ├─ sets CSS grid template on #wall
        │           │       ├─ builds cell DOM for each stream
        │           │       └─ calls startWhep(i) per cell
        │           └─ schedules next view (if cycling)
        │
        └─► else → show layout picker modal
```

### MQTT (optional)

If enabled in `streams.json`, the browser connects to an MQTT broker via WebSocket and subscribes to stream config updates. Fields already set in `streams.json` are locked (`STREAMS_STATIC`) — MQTT cannot override them.

---

## 4. Frontend File Structure

```
www/
├── index.html        HTML structure only — no inline styles or scripts
├── css/
│   └── app.css       All styles
├── js/
│   ├── app.js        Core SPA logic (~1100 lines)
│   ├── boot.js       Boot sequence, module initialization
│   ├── config.js     Env var and config loading
│   ├── layouts.js    Layout definitions and wall rendering
│   ├── webrtc.js     WebRTC/WHEP connection lifecycle
│   ├── views.js      View loading, activation, cycling
│   ├── mqtt.js       MQTT client and message handling
│   ├── ui.js         Keyboard shortcuts, modals, UI state
│   ├── debug.js      Debug overlay and performance monitoring
│   ├── camera-editor.js   Camera settings editor modal (planned)
│   ├── views-editor.js    Views editor modal
│   └── actions.js    Panel actions modal, MQTT action buttons (planned)
├── mqtt.min.js       Bundled at build time (from node_modules/mqtt)
└── favicon.svg
```

### `index.html`

Pure structure. Contains:
- `<link rel="stylesheet" href="/css/app.css">`
- `<script src="/mqtt.min.js">`
- All modal HTML (`#picker`, `#streams-modal`, `#views-modal`, `#settings-modal`, `#performance-modal`)
- The `#wall` grid container
- `<script src="/js/app.js?v=2">` at the bottom

### `www/css/app.css`

All styles, organised by component:

| Section | Classes/IDs |
|---------|-------------|
| Reset + base | `html`, `body` |
| Video wall | `#wall`, `.cell`, `.cell video` |
| Stream chrome | `.chrome`, `.live`, `.dot`, `.btn-fs` |
| Loading state | `.loading`, `.ring` |
| Error state | `.err-overlay`, `.err-inner` |
| Modals (shared) | `.modal`, `.modal-hint` |
| Layout picker | `#picker`, `.layout-grid`, `.layout-btn`, `.divider`, `.picker-footer` |
| Streams modal | `#streams-modal`, `.streams-table`, `.stream-status` |
| Settings button | `#settings-btn` |
| Shortcut hints | `.shortcut-list`, `.shortcut-key` |
| Performance modal | `.perf-section`, `.toggle`, `.perf-input`, `.perf-reset` |
| Views modal | `#views-modal`, `.views-toolbar`, `.views-input`, `.ve-layout-btn` |
| Stream picker | `.sp-list`, `.sp-item`, `.sp-btn`, `.sp-drag-handle`, `#sp-drag-ghost` |
| View drag | `.view-drag-handle`, `#view-drag-ghost` |
| Cycle indicator | `#cycle-indicator` |
| Debug overlay | `#debug-overlay`, `.dbg-*` |
| Camera editor modal | `#cameras-modal`, `.cam-toolbar`, `.cam-add-btn`, `.cam-drawer`, `.cam-drawer-inner`, `.cam-form-grid`, `.cam-advanced-toggle`, `.cam-save-btn`, `.cam-unsaved-banner`, `.cam-unsaved-dot`, `.cam-banner-actions`, `.cam-api-unavailable`, `.cam-api-unavailable-title`, `.cam-api-unavailable-body` |
| Actions modal (planned) | `#actions-modal`, `#actions-backdrop`, `.actions-grid`, `.action-btn`, `.action-btn.on`, `.action-btn-icon`, `.action-indicator` |

**Design tokens** (not CSS variables — used inline as rgba/hex):
- Background: `#000`
- Primary text: `rgba(255,255,255,0.7–0.9)`
- Muted text: `rgba(255,255,255,0.35–0.4)`
- Green accent: `#4ade80` / `rgba(74,222,128,x)`
- Red error: `#f87171` / `rgba(248,113,113,x)`
- Yellow: `#facc15`
- Borders: `rgba(255,255,255,0.12–0.2)`
- Font: `'Courier New', monospace` everywhere

---

## 5. `app.js` — Section Map

| Lines | Section | Key exports/functions |
|-------|---------|-----------------------|
| 1–38 | Config constants | `MEDIAMTX_HOST`, `MEDIAMTX_PORT`, `MQTT_DEFAULTS` |
| 40–79 | Stream loading | `loadStreams()`, `STREAMS[]`, `STREAMS_STATIC` |
| 80–119 | View loading | `loadViews()`, `VIEWS[]`, `VIEWS_DEFAULT`, `VIEWS_CYCLE` |
| 120–221 | View activation | `activateView(name)`, `getView(name)` |
| 223–341 | Cycle control | `scheduleCycle()`, `pauseCycle()`, `resumeCycle()`, `navigateView()` |
| 342–415 | Preloading | `schedulePreload()`, `preloadStream()`, `cleanupPreloads()` |
| 360–445 | Performance settings | `PERF`, `loadPerfSettings()`, `savePerfSettings()` |
| 446–570 | MQTT | `startMQTT()`, topic handlers |
| 572–612 | **Layouts** | `LAYOUTS{}`, `bestLayout()` |
| 614–701 | **Wall rendering** | `applyLayout(name)`, `stopAll()` |
| 703–783 | Retry + refresh | `scheduleRetry()`, `scheduleRefresh()` |
| 784–1012 | **WebRTC/WHEP** | `streamPCs{}`, `attachExistingPC()`, `startWhep()` |
| 1013–1100 | UI utilities | `toggleFS()`, keyboard shortcuts, modal management |
| 1100–1220 | Layout SVG icons | `LAYOUT_RECTS{}`, `LAYOUT_CELLS{}`, `layoutSvgWithNumbers()` |

---

## 6. Layout System

### Definition (`LAYOUTS`, ~line 579)

```js
const LAYOUTS = {
  'single':         { streams: 1, css: { cols: '1fr',             rows: '1fr' } },
  'two-col':        { streams: 2, css: { cols: '1fr 1fr',         rows: '1fr' } },
  'two-row':        { streams: 2, css: { cols: '1fr',             rows: '1fr 1fr' } },
  'primary-right':  { streams: 3, css: { cols: '2fr 1fr',         rows: '1fr 1fr' },
                      spans: [{ col: '1', row: '1 / 3' }] },
  'primary-left':   { streams: 3, css: { cols: '1fr 2fr',         rows: '1fr 1fr' },
                      spans: [null, null, { col: '2 / 3', row: '1 / 3' }] },
  'primary-bottom': { streams: 3, css: { cols: '1fr 1fr',         rows: '2fr 1fr' },
                      spans: [{ col: '1 / 3', row: '1 / 2' }] },
  'primary-top':    { streams: 3, css: { cols: '1fr 1fr',         rows: '1fr 2fr' },
                      spans: [null, null, { col: '1 / 3', row: '2 / 3' }] },
  'quad':           { streams: 4, css: { cols: '1fr 1fr',         rows: '1fr 1fr' } },
  'six':            { streams: 6, css: { cols: '1fr 1fr 1fr',     rows: '1fr 1fr' } },
  'eight':          { streams: 8, css: { cols: '1fr 1fr 1fr 1fr', rows: '1fr 1fr' } },
};
```

Each layout specifies:
- `streams` — how many stream slots
- `css.cols` / `css.rows` — set directly on `#wall` as `gridTemplateColumns` / `gridTemplateRows`
- `spans[]` — optional per-stream CSS grid overrides (`gridColumn`, `gridRow`)

Adding a new layout requires:
1. Entry in `LAYOUTS`
2. Entry in `LAYOUT_RECTS` (SVG picker icon geometry, ~line 1119)
3. Button in `#picker` HTML in `index.html`
4. Button in the views editor's layout picker (in `index.html`, the `#views-modal`)

### Cell DOM structure (per stream)

```html
<div class="cell" id="cell{i}">
  <div class="loading" id="load{i}">
    <div class="ring"></div>
  </div>
  <div class="err-overlay" id="err{i}">
    <div class="err-inner">
      <div class="err-code">No Signal</div>
      <div class="err-sub">{stream.label}</div>
    </div>
  </div>
  <video id="v{i}" autoplay muted playsinline style="object-fit:{stream.objectFit}"></video>
  <div class="chrome">
    <div class="live">
      <div class="live-row">
        <span id="lbl{i}">LIVE</span>
        <span class="dot" id="dot{i}"></span>
      </div>
      <div class="lbl">{stream.label}</div>
    </div>
    <button class="btn-fs" onclick="toggleFS({i})">…</button>
  </div>
</div>
```

Cell state is communicated via:
- `.loading` / `.loading.gone` — loading spinner visibility
- `.err-overlay` / `.err-overlay.show` — no-signal error state
- `.dot` / `.dot.err` — green (live) vs red (error) indicator
- `#lbl{i}` text — `'LIVE'` or `'ERR'`

---

## 7. WebRTC / WHEP Connection Lifecycle

```
startWhep(index)
    │
    ├─► attachExistingPC(path, index)  — reuse live connection?
    │       ├─ yes → attach video srcObject, return
    │       └─ no  → continue
    │
    ├─► close stale PC if exists
    ├─► new RTCPeerConnection({ iceServers: [STUN] })
    ├─► addTransceiver('video', recvonly)
    ├─► addTransceiver('audio', recvonly|inactive)
    ├─► createOffer → setLocalDescription
    ├─► wait for ICE gathering (or 5s timeout)
    ├─► POST /mediamtx:8889/{path}/whep  (SDP offer)
    ├─► setRemoteDescription (SDP answer)
    │
    ├─► pc.ontrack → video.srcObject = stream → video.play()
    │       └─► setLive() → hide spinner, show LIVE indicator
    │           scheduleRefresh()
    │
    ├─► stall watchdog (8s interval)
    │       checks getVideoPlaybackQuality().totalVideoFrames
    │       if frozen → doRetry()
    │
    └─► ICE state monitoring
            'failed'       → doRetry()
            'disconnected' → wait 8s → doRetry()
            'closed'       → doRetry() (if track was received)

doRetry()
    └─► setError() → scheduleRetry(index) → exponential backoff (2s→30s)
```

**Connection reuse across view switches** (`streamPCs` keyed by path, not index):
- Same stream in two consecutive views: connection is attached to new DOM cell without reconnecting
- Preloaded connections (`preloadPCs`) are promoted to `streamPCs` before `applyLayout()` runs

---

## 8. View Cycling

```
VIEWS_CYCLE = true
        │
        activateView(name)
            │
            └─► scheduleCycle(view)
                    │
                    ├─ if view.duration < 0 → no timer (stay forever)
                    ├─ schedulePreload() fires at (duration - leadTime)
                    │       opens hidden WebRTC connections for next view's streams
                    └─ cycleTimer fires at duration
                            └─► activateView(nextView)
```

Pause/resume preserves `remainingOnPause` — resumes exact remaining time, not full duration.

---

## 9. Data Schemas

### `data/streams.json`

```jsonc
[                          // or { "streams": [...], "mqtt": {...} }
  {
    "path": "cam1",                          // REQUIRED — MediaMTX path key + URL segment
    "label": "Front Door",                   // display name in UI
    "source": "rtsp://user:pass@host/token", // REQUIRED — RTSP source URL (credentials stripped for public)
    "rtspTransport": "tcp",                  // optional: "tcp" | "udp"
    "aspectRatio": "16:9",                   // optional — informational only (not used for sizing)
    "objectFit": "contain",                  // optional: "contain" | "cover" (CSS object-fit on <video>)
    "audio": false,                          // optional — enable audio transceiver
    "sourceOnDemand": true,                  // optional — only connect RTSP when a viewer is watching
    "sourceOnDemandStartTimeout": "10s",     // optional
    "sourceOnDemandCloseAfter": "10s",       // optional — disconnect RTSP N seconds after last viewer
    "refreshInterval": 30,                   // optional — force reconnect every N seconds
    "preloadLeadTime": 20                    // optional — per-stream preload lead time (overrides view's)
  }
]
```

### `data/views.json`

```jsonc
{
  "default": "all-cams",   // view name to activate on load
  "cycle": false,           // enable automatic cycling
  "views": [
    {
      "name": "all-cams",       // unique identifier
      "label": "All Cameras",   // display name
      "layout": "primary-right",// must match a key in LAYOUTS
      "streams": ["cam1","cam2","cam3"], // ordered list of stream paths
      "duration": 20,           // seconds per view (cycle); -1 = stay forever
      "preloadLeadTime": 20,    // seconds before switch to start preloading next view
      "slotGroups": ["living-room", null, "bedroom"]  // optional — action group IDs per slot (planned)
    }
  ]
}
```

### `data/actions.json` (planned)

Global actions registry for panel action buttons. See `.claude/docs/specs/planned/panel-actions-modal.md` for full spec.

```jsonc
{
  "mqtt": {
    "broker": "ws://192.168.1.x:9001",
    "username": "user",
    "password": "pass"
  },
  "actions": [
    {
      "id": "lights-on",
      "label": "Lights On",
      "icon": "mdi:lightbulb",          // MDI icon or emoji
      "publish": {
        "topic": "home/living/lights/set",
        "payload": "ON"
      },
      "state": {                        // optional — subscribe to state topic for visual feedback
        "topic": "home/living/lights/state",
        "onValue": "ON"
      }
    }
  ],
  "groups": [
    {
      "id": "living-room",
      "name": "Living Room",
      "actions": ["lights-on", "lights-off", "fan-toggle"]  // max 6
    }
  ]
}
```

### Sanitised public files (served by Nginx)

`generate-config.sh` produces:
- `streams-public.json` — credentials in `source` replaced with `***`
- `views-public.json` — copy of `views.json` (no sensitive data)

---

## 10. Nginx Routing

```
GET /              → index.html
GET /streams.json  → streams-public.json  (no-cache)
GET /views.json    → views-public.json    (no-cache)
GET /actions.json  → actions.json         (no-cache) (planned)
GET /*.json        → 403 (all other JSON blocked)
GET /*.js          → cache 1yr immutable
GET /*             → try_files $uri =404
/api/streams       → proxy_pass http://streams-api:9998  (planned — requires streams-api service)
```

---

## 11. Environment Variables (Nginx / docker-compose)

| Variable | Default | Purpose |
|----------|---------|---------|
| `FORCE_LAYOUT` | `""` | Force all sessions to one layout, skip picker |
| `FULLSCREEN_TIMEOUT` | `"30"` | Auto-exit fullscreen after N seconds (0 = off) |
| `STREAM_REFRESH` | `""` | Global stream reconnect interval in seconds |
| `ENABLE_MODALS` | `"true"` | Show L/D keyboard shortcuts for modals |
| `ENABLE_PRELOAD` | `""` | Expose preload lead time in views editor |
| `HOST_IP` | — | Host machine IP, injected into MediaMTX STUN config |
| `STUN_PORT` | `3478` | coturn STUN port |

These are injected by `envsubst` at container startup into `index.html` as JS variables.

---

## 12. Performance Settings (localStorage)

Stored per-device in `localStorage('perfSettings')`. Configurable via the performance modal.

| Key | Default | Effect |
|-----|---------|--------|
| `lowPower` | `false` | `powerPreference: 'low-power'` on RTCPeerConnection |
| `noPreload` | `false` | Disables hidden preload connections |
| `destroyOffscreen` | `false` | Closes WebRTC connections for off-screen streams |
| `maxStreams` | `0` | Cap simultaneous streams (0 = unlimited) |
| `maxKeepAlive` | `0` | Max kept-alive connections across view switches |
| `maxRetryDelay` | `30` | Caps exponential backoff in seconds |
| `debugOverlay` | `false` | Shows live debug info on screen |

---

## 13. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `L` | Toggle layout picker |
| `D` | Toggle streams debug modal |
| `V` | Toggle views editor |
| `Escape` | Close any open modal (including actions modal) |
| `Space` | Pause/resume view cycling |
| `←` / `→` | Manual view navigation |
| `M` | Mute/unmute |
| `C` | Open/close camera settings editor *(planned)* |

---

## 14. Adding a New Layout — Checklist

1. **`www/js/app.js` — `LAYOUTS`** (~line 579): add entry with `streams`, `css`, optional `spans`
2. **`www/js/app.js` — `LAYOUT_RECTS`** (~line 1119): add SVG rect geometry for picker icon
3. **`www/index.html` — `#picker`**: add `<button class="layout-btn" onclick="applyLayout('...')">` with inline SVG
4. **`www/index.html` — `#views-modal` layout grid**: add matching `<button class="ve-layout-btn">` for views editor
5. **`www/js/app.js` — `bestLayout()`** (~line 605): update if the layout should be auto-selected

---

## 15. Adding a New Stream Field — Checklist

1. **`data/streams.json`**: add field to stream objects
2. **`scripts/generate-config.sh`**: if it maps to a MediaMTX config key, add a jq line in section 1
3. **`scripts/generate-config.sh`**: if it should be visible in the browser, add to the `jq` whitelist in section 2
4. **`www/js/app.js`**: consume the field where needed (e.g., `stream.myField`)
5. **`www/js/camera-editor.js` — `CAM_FIELD_SCHEMA`** (planned): add field descriptor to the schema array — see `.claude/docs/specs/planned/camera-field-schema.md` for the descriptor shape and renderer contract

---

## 16. Planned Features

Feature specs in `.claude/docs/specs/planned/`:

| Feature | Status | Spec | Summary |
|---------|--------|------|---------|
| **Panel Actions Modal** | `planned` | [panel-actions-modal.md](./specs/planned/panel-actions-modal.md) | Click a camera panel to open an action button grid. Publish MQTT messages (unlock door, toggle lights) with visual state feedback. Actions defined in `data/actions.json`, assigned per-view slot via `slotGroups[]`. |
| **Camera Settings Editor** | `planned` | [camera-settings-editor.md](./camera-settings-editor.md) | In-browser editor for `streams.json`. Add/edit/delete cameras, configure RTSP source, object-fit, refresh interval, etc. Requires `streams-api` service (read/write endpoint). |

When a planned feature is implemented, move its spec to `.claude/docs/specs/active/` and update this table.
