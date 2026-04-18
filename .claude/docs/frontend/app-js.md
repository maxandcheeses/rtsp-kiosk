# app.js — Modular Structure

`www/js/app.js` was split into 10 files in `www/js/`. No build step, no ES modules — all files share the same global scope via `<script>` tags loaded in order from `index.html`.

---

## File Map

| File | Contents |
|------|----------|
| `config.js` | `MEDIAMTX_HOST/PORT`, `MQTT_DEFAULTS`, `STREAMS`/`STREAMS_STATIC`/`MQTT_CONFIG` globals, `loadStreams()`, `VIEWS`/`VIEWS_DEFAULT`/`VIEWS_CYCLE`/`activeView`/`cycleTimer`/`cycleIndex` globals, `loadViews()`, `getView()` |
| `layouts.js` | `LAYOUTS` const, `bestLayout()`, `activePCs`/`stopAll()`, `applyLayout()`, `LAYOUT_RECTS`, `LAYOUT_CELLS`, `_svgUid`, `layoutSvgWithNumbers()` |
| `webrtc.js` | `retryDelay`/`retryPending`/`RETRY_MIN`/`RETRY_MAX`, `scheduleRetry()`, `resetRetry()`, `scheduleRefresh()`, `clearRefresh()`, `streamPCs`/`refreshTimers`/`refreshTimerStarted` globals, `attachExistingPC()`, `startWhep()` |
| `views.js` | `activateView()`, `getCycleViews()`, `scheduleCycle()`, `clearCycle()`, `startCycling()`, cycle pause/resume globals, `showIndicator()`, `pauseCycle()`, `resumeCycle()`, `navigateView()`, `PRELOAD_DEFAULT`/`preloadPCs`, `PERF_DEFAULTS`/`PERF`/perf functions, storage clear functions, `preloadVideos`/`preloadTimer`, preload functions |
| `ui.js` | `fsTimer`/`clearFsTimer()`/`toggleFS()`, `fullscreenchange` listener, `_activeSettingsTab`, `closeAllModals()`, `activateSettingsTab()`, `openSettingsModal(tab?)`, `renderViewsTab()`, `openViewsModal()` (shim), `renderStreamsTab()`, `openStreamsModal()` (shim), keydown listener, touch swipe listener (`touchStartX`/`touchStartY` → `navigateView(±1)`), cursor hide/settings button |
| `mqtt.js` | `_mqttConnected`, `_mqttConnecting`, `_mqttReconnDelay/Timer`, `_mqttPublishQueue`, `_MQTT_QUEUE_MAX/DELAY_MAX`, `_mqttScheduleReconnect()`, `startMQTT()`, `mqttConnect()`, `mqttSubscribe()` (returns unsubscribe fn), `mqttPublish()` (queues when disconnected), `applyStreamUpdates()`, `_updateMqttStatusIndicator()` (checks named clients for the current modal's required servers; falls back to legacy globals when no named servers are needed; red state is clickable and reconnects only the disconnected named servers), `mqttForceReconnect()`. **Multi-server pool**: `_mqttClients` Map, `getOrCreateMqttClient(serverId, cfg)` (reads TLS cert PEMs from `localStorage['mqtt_certs']` when `serverCfg.tls` is set; passes `ca`/`cert`/`key` opts to `mqtt.connect()`; appends `/mqtt` path to `ws`/`wss` broker URLs at connect time if not already present — broker stored without path), `disconnectMqttClient(serverId)`. |
| `camera-editor.js` | `CAM_*` globals, `renderCamerasTab()`, `openCamerasModal()` (shim), `loadCamStreams()`, all `cam*` functions |
| `debug.js` | `globalMuted`/`userInteracted`, `markInteracted()`, `applyMute()`, `toggleMute()`, `loadMuteState()`, `debugInterval`/`cycleStartedAt`/`cycleDuration`, `startDebugTimer()`, `updateDebugOverlay()` |
| `views-editor.js` | `_persistViews()`, views CRUD functions, drag-to-reorder for views table, view edit form functions, per-slot stream + action-or-group dropdowns (`_renderVeStreamPicker` — each slot has a stream select and an action/group select with `<optgroup>` separators for Actions and Groups), `cancelViewEdit()`, `toggleVePreload()`, `saveViewForm()` (validates name/layout/streams via inline error spans `ve-err-name`/`ve-err-layout`/`ve-err-streams`; no alert() calls), `_showViewForm()` (clears all error spans on open), `toggleViewCycle(name)` |
| `actions-editor.js` | `AE_FULL/AE_LOCAL/AE_UNSAVED/AE_TAB/AE_OPEN_DRAWER/AE_DRAWER_DIRTY` globals, `loadActionsEditorData()`, `renderActionsEditor()`, `_renderAeTabsInto()`, `switchAeTab()`. **TLS cert helpers**: `_AE_CERTS_KEY`/`_AE_MQTT_PORT_DEFAULTS` consts; `_aeCertsLoad/Save/List/Get/Add/Delete()` — read/write `localStorage['mqtt_certs']` as a `{ filename: pemString }` JSON map. **Broker URL parser**: `_aeParsesBrokerUrl(broker)` — parses a legacy `ws://host:port` URL into `{ connectionType, host, port }` for backward compat. **MQTT tab**: `_buildAeMqttTab()` (CRUD table of `mqtt.servers`; each row has Connect (`aeConnectServer(id)`) and Disconnect (`aeDisconnectServer(id)`) buttons), `_buildAeSrvDrawerForm()` (structured fields: Connection Type dropdown `ws/wss/mqtt/mqtts` + Host input + Port number input; replaces former single Broker URL field; on type change `aeOnConnTypeChange()` auto-updates port if it matches a known default and shows/hides `#ae-tls-section`; TLS section shows CA/Client Cert/Client Key dropdowns populated from localStorage + file upload widget for cert storage; TLS section visible only for `wss`/`mqtts`; cert helpers: `_aeBuildCertList()`, `aeUploadCert()`, `aeDeleteCert(name)`, `_aeRefreshCertUI()`), `openAeSrvDrawer()`, `saveAeSrvDrawer()` (validates host non-empty and port 1–65535; derives `broker` URL from structured fields; saves `connectionType`, `host`, `port`, `broker` (no `/mqtt` path — appended dynamically in `getOrCreateMqttClient`), `autoConnect` bool (default true), optional `tls: { caFile, certFile, keyFile }` to server object; cascades id rename to `action.mqttServer`), `_aeServerStatusHtml(serverId)` (reads live connection state from `_mqttClients` global Map; returns a coloured dot span — green=connected, yellow=connecting, red=disconnected, grey=unknown; rendered inline in each server row under the Connect/Disconnect buttons), `aeConnectServer(id)` (calls `getOrCreateMqttClient` with the server config from `AE_LOCAL`; re-renders the tab after 300 ms to reflect updated status), `aeDisconnectServer(id)` (calls `disconnectMqttClient(id)` and re-renders tab), `deleteAeSrv()`/`confirmDeleteAeSrv()`, `addAeSrv()`, `_initAeSrvDrag()` + handlers. **Tab nav layout**: `_renderAeTabsInto()` renders `.ae-tab-nav` (non-sticky flex row) with the active tab's add button (`+ Add Action` / `+ Add Server` / `+ Add Group`) pushed to the right via `margin-left:auto`. Tab body renders in `#ae-tab-content.ae-tab-body` which is the scroll container (overflow-y:auto, fixed max-height) — content clips at the tab nav, not behind it. The unsaved-changes banner `${bannerHtml}` sits outside the scroll container. **Actions tab**: `_buildAeActionsTab()` (renders built-in actions section at top, then user-defined actions with CRUD table; no add button at top — moved to tab nav), `_buildAeActionDrawerForm()`, `saveAeActionDrawer()`, `_initAeActionDrag()` + handlers. **Groups tab**: `_buildAeGroupsTab()`, `_buildAeGroupDrawerForm()` (each slot row includes a `≡` drag handle span), `_aeAddSlot()`, `saveAeGroupDrawer()`, `_initAeGroupDrag()` + handlers, `_initAeSlotDrag()` + `_onAeSlotDragDown/Move/End` — drag-to-reorder slot rows within `#ae-slots-container`; on drop, renumbers all `ae-slot-row-{i}` / `ae-slot-{i}` ids and label text sequentially from 0; called from `openAeGroupDrawer()` and `_aeAddSlot()`. `markAeUnsaved()`, `applyAeChanges()`, `discardAeChanges()`. |
| `boot.js` | `boot()`, `markInteracted` event listeners, backdrop-click forEach, `startMQTT()` call, `boot()` call |

### Load order in index.html
`config.js` → `layouts.js` → `webrtc.js` → `views.js` → `ui.js` → `mqtt.js` → `camera-editor.js` → `debug.js` → `views-editor.js` → `actions-editor.js` → `boot.js`

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

### `BUILTIN_ACTIONS` — actions.js
Module-level const defining always-available actions (`__next-view`, `__prev-view`). These are merged into `ACTIONS` after each `loadActionsConfig()` call. They are never editable or deletable via the editor. `pressAction` handles them by calling `navigateView(±1)` then `closeActionsModal()`. Actions use `description` (not `label`) as the display text field.

### `loadActionsConfig()` — state topic subscription routing — actions.js
**Auto-connect on page load**: after parsing `cfg`, iterates `cfg.mqtt.servers` and calls `getOrCreateMqttClient(srv.id, srv)` for each server where `autoConnect !== false`, adding them to `_connectedServerIds`. Servers with `autoConnect: false` are only connected on-demand (via `_connectServersForGroup` when the actions modal opens).

State topics are subscribed on the correct MQTT client per action. Actions without `mqttServer` use the global client via `mqttSubscribe()`. Actions with `mqttServer` set use the named client from the pool — `getOrCreateMqttClient(serverId, srvCfg)` is called to get/create the client, topics are subscribed directly via `client.subscribe()`, and a `message` listener filters by topic before updating `ACTION_STATES`. A `connect` listener re-subscribes topics after reconnects. Cleanup functions pushed into `_actionUnsubscribers` remove both listeners and call `client.unsubscribe()` on each topic.

### MQTT trigger subscriptions — `loadActionsConfig()` — actions.js
After state topics are subscribed, trigger topics are grouped the same way: actions with `trigger.topic` set are grouped by `trigger.mqttServer` (null = global client). On message, `_triggerAction(actionId)` is called if `trigger.payload` matches (or is absent). Cleanup follows the same pattern as state subscriptions.

### `_triggerAction(actionId)` / `openFocusPanelByStream(streamPath, timeout)` — actions.js
`_triggerAction` dispatches to `pressAction()` for `builtin` and `mqtt` types. For `focus-panel` it calls `openFocusPanelByStream(action.stream, ...)` instead of using `_actionsSlotIndex` (which is null for MQTT-triggered actions). `openFocusPanelByStream` finds the slot index by searching `STREAMS` for a matching `.path`, then checks that the video element exists in the current DOM before calling `openFocusPanel()`.

### `openFocusPanel(slotIndex, timeout)` / `closeFocusPanel()` — actions.js
`openFocusPanel` pauses view cycling, copies the `srcObject` (WebRTC MediaStream) from the source cell video element (`#v{slotIndex}`) to `#focus-panel-video`, shows `#focus-panel-overlay`, and starts an optional countdown timer. `closeFocusPanel` clears the timer, hides the overlay, nulls the video source, and resumes cycling. ESC key handling in `ui.js` checks the overlay first (highest z-index, must close before other modals).

### `pressAction(actionId)` — actions.js
Dispatches to three branches in order: `builtin` type → navigate view + close modal; `focus-panel` type → close modal + open focus overlay; `mqtt` type → publish via MQTT client with visual feedback. Unknown actions or mqtt actions without `publish` are silently ignored.

**Cell-level feedback (direct-action path):** When a `slotGroups` entry references a single action ID (not a group), `openActionsModal` executes it immediately without opening the modal. In this case no `[data-action-id]` button exists in the DOM. `pressAction` falls back to flashing the cell element (`#cell{_actionsSlotIndex}`) — white outline on success (150 ms), red outline on MQTT disconnect failure (1 s).

### `closeAllModals()` and `anyOpen` — ui.js
Only `settings-modal` is tracked. All editor tabs (cameras, views, actions) are panels inside the unified settings modal — there is no standalone actions-settings-modal. If a new modal is added, update both the `classList.remove` block inside `closeAllModals` and the `anyOpen` array in the keydown handler.

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
