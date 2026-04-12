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
<<<<<<< Updated upstream
| `mqtt.js` | `_mqttConnected`, `_mqttConnecting`, `_mqttReconnDelay/Timer`, `_mqttPublishQueue`, `_MQTT_QUEUE_MAX/DELAY_MAX`, `_mqttScheduleReconnect()`, `startMQTT()`, `mqttConnect()`, `mqttSubscribe()` (returns unsubscribe fn), `mqttPublish()` (queues when disconnected), `applyStreamUpdates()`, `_updateMqttStatusIndicator()` (3-state), `mqttForceReconnect()`. **Multi-server pool**: `_mqttClients` Map, `getOrCreateMqttClient(serverId, cfg)`, `disconnectMqttClient(serverId)`. |
| `camera-editor.js` | `CAM_*` globals, `renderCamerasTab()`, `openCamerasModal()` (shim), `loadCamStreams()`, all `cam*` functions |
| `debug.js` | `globalMuted`/`userInteracted`, `markInteracted()`, `applyMute()`, `toggleMute()`, `loadMuteState()`, `debugInterval`/`cycleStartedAt`/`cycleDuration`, `startDebugTimer()`, `updateDebugOverlay()` |
| `views-editor.js` | `_persistViews()`, views CRUD functions, drag-to-reorder for views table, view edit form functions, per-slot stream + action-or-group dropdowns (`_renderVeStreamPicker` — each slot has a stream select and an action/group select with `<optgroup>` separators for Actions and Groups), `cancelViewEdit()`, `toggleVePreload()`, `saveViewForm()` |
| `actions-editor.js` | `AE_FULL/AE_LOCAL/AE_UNSAVED/AE_TAB/AE_OPEN_DRAWER/AE_DRAWER_DIRTY` globals — `AE_DRAWER_DIRTY` tracks whether any field in the currently-open drawer has been changed; prevents toggle-to-close when a form is modified (clicking the same row again only collapses if `!AE_DRAWER_DIRTY`), `loadActionsEditorData()`, `renderActionsEditor()`, `_renderAeTabsInto()`, `switchAeTab()`. **MQTT tab**: `_buildAeMqttTab()` (CRUD table of `mqtt.servers`), `_buildAeSrvDrawerForm()`, `openAeSrvDrawer()`, `saveAeSrvDrawer()` (cascades id rename to `action.mqttServer`), `deleteAeSrv()`/`confirmDeleteAeSrv()`, `addAeSrv()`, `_initAeSrvDrag()` + handlers. **Actions tab**: `_buildAeActionsTab()` (renders read-only built-in actions section at top using `BUILTIN_ACTIONS`, then user-defined actions with CRUD table), `_buildAeActionDrawerForm()` (type dropdown is first field; `mqtt`/`focus-panel`; MQTT fields wrapped in `#ae-mqtt-fields`; focus-panel close behaviour in `#ae-focus-fields` — two radios: "Keep open until closed" (timeout=0) and "Auto-close after N seconds" with inline number input; `_aeTypeChanged(type)` shows/hides sections and calls `_aeFocusRadioChanged()` to sync disabled state; `_aeFocusRadioChanged()` enables/disables `#ae-focus-timeout` based on which radio is checked), `saveAeActionDrawer()` (validates `description` field; validates MQTT fields only for type=mqtt; reads radio for focus-panel timeout — 0 if "keep" selected, N if "auto" selected), `_initAeActionDrag()` + handlers. **Groups tab**: `_buildAeGroupsTab()`, `_buildAeGroupDrawerForm()` (slot selects include `BUILTIN_ACTIONS` entries), `_aeAddSlot()` (also includes builtins), `saveAeGroupDrawer()`, `_initAeGroupDrag()` + handlers. `markAeUnsaved()`, `applyAeChanges()`, `discardAeChanges()`. |
=======
| `mqtt.js` | `_mqttConnected`, `_mqttConnecting`, `_mqttReconnDelay/Timer`, `_mqttPublishQueue`, `_MQTT_QUEUE_MAX/DELAY_MAX`, `_mqttScheduleReconnect()`, `startMQTT()`, `mqttConnect()`, `mqttSubscribe()` (returns unsubscribe fn), `mqttPublish()` (queues when disconnected), `applyStreamUpdates()`, `getMqttStatusBadgeHtml()` (returns inline HTML span in green/yellow/red based on `_mqttConnected`/`_mqttConnecting`), `_updateMqttStatusIndicator()` (3-state; also updates `#ae-mqtt-status-badge` if present), `mqttForceReconnect()`. **Multi-server pool**: `_mqttClients` Map, `getOrCreateMqttClient(serverId, cfg)` (attaches `connect`/`error`/`close` handlers with exponential backoff via `_namedClientBackoff` Map; calls `_updateNamedClientStatus(serverId)` on each state change), `disconnectMqttClient(serverId)`, `_namedScheduleReconnect(serverId, client)` (mirrors `_mqttScheduleReconnect` but per-server, backoff 1s→30s), `_updateNamedClientStatus(serverId)` (finds `#ae-srv-status-{serverId}` in the MQTT tab server table and writes green/yellow/gray badge HTML). |
| `camera-editor.js` | `CAM_*` globals, `renderCamerasTab()`, `openCamerasModal()` (shim), `loadCamStreams()`, all `cam*` functions. `saveCamDrawer()` and `confirmDeleteCamStream()` call `applyCamChanges()` directly (no manual Apply step); drag-to-reorder is not present in the cam editor so `markCamUnsaved()` is only used internally by the banner display. |
| `debug.js` | `globalMuted`/`userInteracted`, `markInteracted()`, `applyMute()`, `toggleMute()`, `loadMuteState()`, `debugInterval`/`cycleStartedAt`/`cycleDuration`, `startDebugTimer()`, `updateDebugOverlay()` (sections: Streams → MQTT → View) |
| `views-editor.js` | `_persistViews()`, views CRUD functions, drag-to-reorder for views table, view edit form functions, per-slot stream + action-or-group dropdowns (`_renderVeStreamPicker` — each slot has a stream select and an action/group select with `<optgroup>` separators for Actions and Groups), `cancelViewEdit()`, `toggleVePreload()`, `saveViewForm()` |
| `actions-editor.js` | `AE_FULL/AE_LOCAL/AE_UNSAVED/AE_TAB/AE_OPEN_DRAWER/AE_DRAWER_DIRTY` globals — `AE_DRAWER_DIRTY` tracks whether any field in the currently-open drawer has been changed; prevents toggle-to-close when a form is modified (clicking the same row again only collapses if `!AE_DRAWER_DIRTY`), `loadActionsEditorData()`, `renderActionsEditor()`, `_renderAeTabsInto()` (tab nav row includes `#ae-mqtt-status-badge` right-aligned, pre-populated via `getMqttStatusBadgeHtml()`), `switchAeTab()`. **MQTT tab**: `_buildAeMqttTab()` (CRUD table of `mqtt.servers` — columns: drag handle, ID, Broker, Status, actions; each status cell has `id="ae-srv-status-{id}"` and shows green/yellow/gray badge based on `_mqttClients` map state; drawer rows use `colspan="5"`), `_buildAeSrvDrawerForm()` (form includes ID, Broker URL, Username, Password, and Auto-connect checkbox; `autoConnect` defaults to `true` if not set on the server object; footer has Cancel / Disconnect (shown only when `_mqttClients.get(id)?.connected` is true; red tint; calls `disconnectAeSrv(id)`) / Test / `<span id="ae-srv-test-status">` / Save), `openAeSrvDrawer()`, `saveAeSrvDrawer()` (cascades id rename to `action.mqttServer`; persists `autoConnect` boolean; calls `getOrCreateMqttClient(newId, updated)` if `newAutoConnect` is true, else calls `disconnectMqttClient(newId)` to disconnect any existing client), `testAeSrvConnection()` (opens a one-off `mqtt.connect()` with `reconnectPeriod:0`; shows yellow/green/red inline status in `#ae-srv-test-status`; disconnects after result; fully local client — not persisted), `disconnectAeSrv(id)` (calls `disconnectMqttClient(id)` + `_updateNamedClientStatus(id)` then hides `#ae-srv-disconnect-btn`; invoked from the drawer footer Disconnect button), `deleteAeSrv()`/`confirmDeleteAeSrv()`, `addAeSrv()`, `_initAeSrvDrag()` + handlers. **Actions tab**: `_buildAeActionsTab()` (renders built-in actions section at top — each builtin row is clickable and has a collapsible trigger-only drawer; `AE_LOCAL.actions` entries whose `id` matches a builtin are filtered out of the user-actions table — they are trigger-override stubs, shown only in the builtin section; user-defined actions follow with full CRUD table), `_aeDomId(id)` (sanitizes ID for DOM `id=""` attributes — spaces → hyphens; needed because builtin IDs like "Next View" contain spaces), `_buildAeBuiltinTriggerDrawer(builtinAction, cfgEntry)` (simplified drawer for builtins — shows only MQTT Trigger section: server select, topic input, payload input; footer has Cancel / Save; `saveAeBuiltinTrigger(id)` adds/updates or removes a trigger-only entry in `AE_LOCAL.actions` for the builtin ID), `openAeActionDrawer(id)` (checks `BUILTIN_ACTIONS[id]` first — routes to builtin trigger drawer using `_aeDomId` for element lookups; falls through to regular action drawer otherwise), `closeAeDrawer()` (uses `_aeDomId(AE_OPEN_DRAWER)` for action drawer element lookups to handle builtin IDs with spaces), `_buildAeActionDrawerForm()` (type dropdown is first field; `mqtt`/`focus-panel`; MQTT fields wrapped in `#ae-mqtt-fields`; focus-panel close behaviour in `#ae-focus-fields` — two radios: "Keep open until closed" (timeout=0) and "Auto-close after N seconds" with inline number input; `_aeTypeChanged(type)` shows/hides sections and calls `_aeFocusRadioChanged()` to sync disabled state and toggles Test button visibility; `_aeFocusRadioChanged()` enables/disables `#ae-focus-timeout` based on which radio is checked; footer has Cancel / **Test** (mqtt only; `id="ae-action-test-btn"`) / `<span id="ae-action-test-status">` / Save), `testAeActionPublish()` (reads `#ae-field-publish-topic`, `#ae-field-publish-payload`, calls `mqttPublish()`; on success shows green "sent · state: <value>" using `ACTION_STATES[stateTopic]`; on failure shows red "not connected"; auto-clears after 2s), `saveAeActionDrawer()` (validates `description` field; validates MQTT fields only for type=mqtt; reads radio for focus-panel timeout — 0 if "keep" selected, N if "auto" selected), `_initAeActionDrag()` + handlers. **Groups tab**: `_buildAeGroupsTab()`, `_buildAeGroupDrawerForm()` (slot selects include `BUILTIN_ACTIONS` entries), `_aeAddSlot()` (also includes builtins), `saveAeGroupDrawer()`, `_initAeGroupDrag()` + handlers. `markAeUnsaved()` (called only by drag-to-reorder handlers — servers, actions, groups), `applyAeChanges()` (called immediately by all explicit Save/Delete actions: `saveAeSrvDrawer`, `confirmDeleteAeSrv`, `saveAeBuiltinTrigger`, `saveAeActionDrawer`, `confirmDeleteAeAction`, `saveAeGroupDrawer`, `confirmDeleteAeGroup`; drag-reorder still uses `markAeUnsaved()` requiring manual Apply), `discardAeChanges()`. |
>>>>>>> Stashed changes
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
State topics are subscribed on the correct MQTT client per action. Actions without `mqttServer` use the global client via `mqttSubscribe()`. Actions with `mqttServer` set use the named client from the pool — `getOrCreateMqttClient(serverId, srvCfg)` is called to get/create the client, topics are subscribed directly via `client.subscribe()`, and a `message` listener filters by topic before updating `ACTION_STATES`. A `connect` listener re-subscribes topics after reconnects. Cleanup functions pushed into `_actionUnsubscribers` remove both listeners and call `client.unsubscribe()` on each topic.

### MQTT trigger subscriptions — `loadActionsConfig()` — actions.js
After state topics are subscribed, trigger topics are grouped the same way: actions with `trigger.topic` set are grouped by `trigger.mqttServer` (null = global client). On message, `_triggerAction(actionId)` is called if `trigger.payload` matches (or is absent). Cleanup follows the same pattern as state subscriptions.

### `_triggerAction(actionId)` / `openFocusPanelByStream(streamPath, timeout)` — actions.js
`_triggerAction` dispatches to `pressAction()` for `builtin` and `mqtt` types. For `focus-panel` it calls `openFocusPanelByStream(action.stream, ...)` instead of using `_actionsSlotIndex` (which is null for MQTT-triggered actions). `openFocusPanelByStream` finds the slot index by searching `STREAMS` for a matching `.path`, then checks that the video element exists in the current DOM before calling `openFocusPanel()`.

### `openFocusPanel(slotIndex, timeout)` / `closeFocusPanel()` — actions.js
`openFocusPanel` pauses view cycling, copies the `srcObject` (WebRTC MediaStream) from the source cell video element (`#v{slotIndex}`) to `#focus-panel-video`, shows `#focus-panel-overlay`, and starts an optional countdown timer. `closeFocusPanel` clears the timer, hides the overlay, nulls the video source, and resumes cycling. ESC key handling in `ui.js` checks the overlay first (highest z-index, must close before other modals).

### `pressAction(actionId)` — actions.js
Dispatches to three branches in order: `builtin` type → navigate view + close modal; `focus-panel` type → close modal + open focus overlay; `mqtt` type → publish via MQTT client with visual feedback. Unknown actions or mqtt actions without `publish` are silently ignored.

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
