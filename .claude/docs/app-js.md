# app.js — Section Map and Key Patterns

`www/js/app.js` contains the entire SPA logic. No build step, no modules, no framework. All globals are declared with `let`/`const` at the top level of a plain `<script>` context.

---

## Section Map

| Lines | Section | Key identifiers |
|-------|---------|-----------------|
| 1–38 | Config constants | `MEDIAMTX_HOST`, `MEDIAMTX_PORT`, `MQTT_DEFAULTS` |
| 40–79 | Stream loading | `loadStreams()`, `STREAMS[]`, `STREAMS_STATIC`, `MQTT_CONFIG` |
| 80–119 | View loading | `loadViews()`, `VIEWS[]`, `VIEWS_DEFAULT`, `VIEWS_CYCLE` |
| 120–221 | View activation | `activateView(name, skipCycleReset)`, `getView(name)` |
| 223–341 | Cycle control | `scheduleCycle()`, `pauseCycle()`, `resumeCycle()`, `navigateView()` |
| 342–415 | Preloading | `schedulePreload()`, `preloadStream()`, `cleanupPreloads()`, `preloadPCs`, `preloadVideos` |
| 360–445 | Performance settings | `PERF`, `loadPerfSettings()`, `savePerfSettings()` |
| 446–570 | MQTT | `startMQTT()`, topic handlers |
| 572–612 | Layouts | `LAYOUTS{}`, `bestLayout()` |
| 614–701 | Wall rendering | `applyLayout(name)`, `stopAll()`, `activePCs[]` |
| 703–783 | Retry + refresh | `scheduleRetry()`, `resetRetry()`, `scheduleRefresh()`, `clearRefresh()` |
| 784–1012 | WebRTC/WHEP | `streamPCs{}`, `attachExistingPC()`, `startWhep()` |
| 1013–1100 | UI utilities | `toggleFS()`, `closeAllModals()`, `openSettingsModal()`, keyboard handler |

### `closeAllModals()` and `anyOpen`
Both must include every modal ID: `picker`, `streams-modal`, `views-modal`, `settings-modal`, `performance-modal`, `cameras-modal`. If a new modal is added, update both the `classList.remove` block inside `closeAllModals` and the `anyOpen` array in the keydown handler — omitting either will break Escape-to-close for that modal.
| 1100–1220 | Layout SVG icons | `LAYOUT_RECTS{}`, `LAYOUT_CELLS{}`, `layoutSvgWithNumbers()` |

---

## Key Functions

### `loadStreams()` / `loadViews()`
Both are async, called in parallel at boot. `loadViews()` checks `localStorage('viewsConfig')` first — user-edited views override the server file.

### `activateView(name, skipCycleReset?)`
Core view switch function. Sequence:
1. Promote `preloadPCs[path]` → `streamPCs[path]` for streams in the view
2. Temporarily replace global `STREAMS` with the view's ordered subset
3. Call `applyLayout()` — which calls `startWhep()` per cell
4. Restore `STREAMS` to full list
5. Clean up unused preload connections
6. Optionally close off-screen connections (`PERF.destroyOffscreen`)
7. Call `scheduleCycle()` unless `skipCycleReset` is true

### `applyLayout(name)`
Tears down the current wall DOM and rebuilds it. Before clearing `innerHTML`, it filters `activePCs` to close connections for streams not in the incoming layout. Streams that remain get reused via `attachExistingPC()`.

### `startWhep(index)` / `attachExistingPC(path, index)`
See `webrtc.md` for full lifecycle. The key point: index is ephemeral (DOM position); path is stable (stream identity). All connection tracking uses path as the key.

### `scheduleRetry(index)` 
Re-resolves stream index at fire time (`STREAMS.findIndex`) — the view may have changed between scheduling and firing. If the stream is no longer in the active layout, the retry is silently dropped.

### `bestLayout(count)`
Simple lookup: 1→single, 2→two-col, 3→primary-right, 4→quad, 5–6→six, 7–8→eight. Used when activating a view that doesn't specify a layout.

---

## Important Patterns

### Stream path vs DOM index
- DOM index (`i`) = position in the current layout grid. Changes on every view switch.
- Stream path (`stream.path`) = stable identity used as key in `streamPCs`, `retryDelay`, `retryPending`, `refreshTimers`.
- Never store a connection by index. Always look up `STREAMS[index].path` and key by that.

### STREAMS is temporarily mutated in activateView
`activateView` sets `STREAMS = ordered` (the view's subset), calls `applyLayout`, then restores `STREAMS = allStreams`. Code inside `applyLayout` and `startWhep` that reads `STREAMS[index]` works against the subset during this window.

### retried guard in startWhep
Each `RTCPeerConnection` instance has a local `retried` boolean. Multiple failure paths (`ICE failed`, stall watchdog, disconnect timeout) can fire in quick succession. The guard ensures only one retry is scheduled per PC lifecycle.

### noTrackTimer (20s fallback)
If `pc.ontrack` never fires, a 20s timeout calls `doRetry`. This handles cases where WHEP negotiation succeeds but MediaMTX never sends media (e.g. stream source not running).

### Mute behaviour
New video elements always start `muted = true` (required for browser autoplay). `applyMute()` unmutes if `globalMuted === false && userInteracted === true`. The `userInteracted` flag is set on the first user gesture.

### localStorage usage
- `'layout'` — last chosen layout (restored on reload if no default view)
- `'lastView'` — last active view name
- `'viewsConfig'` — user-edited views config (overrides `/views.json`)
- `'perfSettings'` — PERF flags

### views.json persistence
Views edited in the UI are saved to `localStorage('viewsConfig')`, not posted to a server. There is no write-back API. `loadViews()` prefers localStorage over the server file.
