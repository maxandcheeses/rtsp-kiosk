# app.js — Modular Structure

`www/js/app.js` was split into 10 files in `www/js/`. No build step, no ES modules — all files share the same global scope via `<script>` tags loaded in order from `index.html`.

---

## File Map

| File | Contents |
|------|----------|
| `config.js` | `MEDIAMTX_HOST/PORT`, `MQTT_DEFAULTS`, `STREAMS`/`STREAMS_STATIC`/`MQTT_CONFIG` globals, `loadStreams()`, `VIEWS`/`VIEWS_DEFAULT`/`VIEWS_CYCLE`/`activeView`/`cycleTimer`/`cycleIndex` globals, `loadViews()`, `getView()` |
| `layouts.js` | `LAYOUTS` const, `bestLayout()`, `activePCs`/`stopAll()`, `applyLayout()`, `LAYOUT_RECTS`, `LAYOUT_CELLS`, `_svgUid`, `layoutSvgWithNumbers()` |
| `webrtc.js` | `retryDelay`/`retryPending`/`RETRY_MIN`/`RETRY_MAX`, `scheduleRetry()`, `resetRetry()`, `scheduleRefresh()`, `clearRefresh()`, `streamPCs`/`refreshTimers`/`refreshTimerStarted` globals, `attachExistingPC()`, `startWhep()` |
| `views.js` | `activateView()`, `scheduleCycle()`, `clearCycle()`, `startCycling()`, cycle pause/resume globals, `showIndicator()`, `pauseCycle()`, `resumeCycle()`, `navigateView()`, `PRELOAD_DEFAULT`/`preloadPCs`, `PERF_DEFAULTS`/`PERF`/perf functions, storage clear functions, `preloadVideos`/`preloadTimer`, preload functions |
| `ui.js` | `fsTimer`/`clearFsTimer()`/`toggleFS()`, `fullscreenchange` listener, `_activeSettingsTab`, `closeAllModals()`, `activateSettingsTab()`, `openSettingsModal(tab?)`, `renderViewsTab()`, `openViewsModal()` (shim), `renderStreamsTab()`, `openStreamsModal()` (shim), keydown listener, cursor hide/settings button |
| `mqtt.js` | `_mqttConnected`, `_mqttConnecting`, `_mqttReconnDelay/Timer`, `_mqttPublishQueue`, `_MQTT_QUEUE_MAX/DELAY_MAX`, `_mqttScheduleReconnect()`, `startMQTT()`, `mqttConnect()`, `mqttSubscribe()`, `mqttPublish()` (queues when disconnected), `applyStreamUpdates()`, `_updateMqttStatusIndicator()` (3-state: green/yellow/red), `mqttForceReconnect()` |
| `camera-editor.js` | `CAM_*` globals, `renderCamerasTab()`, `openCamerasModal()` (shim), `loadCamStreams()`, all `cam*` functions |
| `debug.js` | `globalMuted`/`userInteracted`, `markInteracted()`, `applyMute()`, `toggleMute()`, `loadMuteState()`, `debugInterval`/`cycleStartedAt`/`cycleDuration`, `startDebugTimer()`, `updateDebugOverlay()` |
| `views-editor.js` | `_persistViews()`, views CRUD functions, drag-to-reorder for views table, view edit form functions, per-slot stream dropdowns (`_renderVeStreamPicker`, `_veSlotChange`), `cancelViewEdit()`, `toggleVePreload()`, `saveViewForm()` |
| `boot.js` | `boot()`, `markInteracted` event listeners, backdrop-click forEach, `startMQTT()` call, `boot()` call |

### Load order in index.html
`config.js` → `layouts.js` → `webrtc.js` → `views.js` → `ui.js` → `mqtt.js` → `camera-editor.js` → `debug.js` → `views-editor.js` → `boot.js`

---

## Key Functions

### `loadStreams()` / `loadViews()` — config.js
Both are async, called in parallel at boot. `loadViews()` checks `localStorage('viewsConfig')` first — user-edited views override the server file.

### `activateView(name, skipCycleReset?)` — views.js
Core view switch function. Sequence:
1. Promote `preloadPCs[path]` → `streamPCs[path]` for streams in the view
2. Temporarily replace global `STREAMS` with the view's ordered subset
3. Call `applyLayout()` — which calls `startWhep()` per cell
4. Restore `STREAMS` to full list
5. Clean up unused preload connections
6. Optionally close off-screen connections (`PERF.destroyOffscreen`)
7. Call `scheduleCycle()` unless `skipCycleReset` is true

### `applyLayout(name)` — layouts.js
Tears down the current wall DOM and rebuilds it. Before clearing `innerHTML`, it filters `activePCs` to close connections for streams not in the incoming layout. Streams that remain get reused via `attachExistingPC()`.

### `startWhep(index)` / `attachExistingPC(path, index)` — webrtc.js
See `webrtc.md` for full lifecycle. The key point: index is ephemeral (DOM position); path is stable (stream identity). All connection tracking uses path as the key.

### `scheduleRetry(index)` — webrtc.js
Re-resolves stream index at fire time (`STREAMS.findIndex`) — the view may have changed between scheduling and firing. If the stream is no longer in the active layout, the retry is silently dropped.

### `closeAllModals()` and `anyOpen` — ui.js
Both must include every modal ID: `picker`, `streams-modal`, `views-modal`, `settings-modal`, `performance-modal`, `cameras-modal`. If a new modal is added, update both the `classList.remove` block inside `closeAllModals` and the `anyOpen` array in the keydown handler — omitting either will break Escape-to-close for that modal.

### `bestLayout(count)` — layouts.js
Simple lookup: 1→single, 2→two-col, 3→primary-right, 4→quad, 5–6→six, 7–8→eight.

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
New video elements always start `muted = true` (required for browser autoplay). `applyMute()` unmutes if `globalMuted === false && userInteracted === true`. The `userInteracted` flag is set on the first user gesture. `markInteracted` is in `debug.js`; the `addEventListener` calls that register it are in `boot.js` (after `debug.js` loads).

### Forward reference: updateDebugOverlay
`updateDebugOverlay()` is defined in `debug.js` but called from `views.js`, `layouts.js`, and `webrtc.js` — all of which load before `debug.js`. This is safe because `updateDebugOverlay` is only ever called at runtime, never at parse time.

### localStorage usage
- `'layout'` — last chosen layout (restored on reload if no default view)
- `'lastView'` — last active view name
- `'viewsConfig'` — user-edited views config (overrides `/views.json`)
- `'perfSettings'` — PERF flags
- `'fsTimeout'` — user-set fullscreen timeout (overrides env default)

### views.json persistence
Views edited in the UI are saved to `localStorage('viewsConfig')`, not posted to a server. There is no write-back API. `loadViews()` prefers localStorage over the server file.
