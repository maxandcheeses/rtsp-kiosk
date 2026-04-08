# app-js.md — JS Module Map

The SPA JavaScript is split across multiple files, all loaded as plain `<script>` tags (global scope, no modules).

## File Map

| File | Owns |
|------|------|
| `config.js` | `STREAMS`, `VIEWS`, `MQTT_CONFIG`, `MQTT_DEFAULTS`, global constants |
| `layouts.js` | `LAYOUTS`, `applyLayout()`, `bestLayout()`, `stopAll()`, layout SVG helpers |
| `webrtc.js` | `startWhep()`, `attachExistingPC()`, `streamPCs`, retry logic |
| `views.js` | `activateView()`, `scheduleCycle()`, `navigateView()`, preload logic, PERF settings |
| `ui.js` | `closeAllModals()`, `openSettingsModal()`, `openViewsModal()`, `openStreamsModal()`, `openFromSettings()`, keyboard handler, fullscreen, cursor hide |
| `mqtt.js` | `startMQTT()`, `mqttSubscribe()`, `mqttPublish()`, `applyStreamUpdates()` |
| `camera-editor.js` | `openCamerasModal()`, camera CRUD UI |
| `debug.js` | `updateDebugOverlay()`, `markInteracted()`, `startDebugTimer()` |
| `views-editor.js` | Views CRUD form, `saveViewForm()`, `openViewEditor()`, drag-to-reorder |
| `actions.js` | `loadActionsConfig()`, `openActionsModal()`, `closeActionsModal()`, `pressAction()`, `saveKeepOpen()` |
| `boot.js` | `boot()`, backdrop listeners, `startMQTT()` call |

## Key Globals

- `STREAMS` — array of stream objects (may be temporarily replaced in `activateView()`)
- `VIEWS`, `VIEWS_CYCLE`, `VIEWS_DEFAULT`, `activeView` — view state
- `ACTION_GROUPS`, `ACTIONS`, `ACTION_STATES` — actions config (from `actions.json`)
- `ACTIONS_MODAL_OPEN` — boolean, checked by ESC handler in `ui.js`
- `streamPCs` — object keyed by stream path → RTCPeerConnection
- `activePCs` — array of active RTCPeerConnections (for `stopAll()`)
- `PERF` — performance settings object
- `FORCE_LAYOUT`, `FULLSCREEN_TIMEOUT`, `ENABLE_MODALS`, `ENABLE_PRELOAD`, `STREAM_REFRESH_GLOBAL` — from env

## Key Patterns

### Modal Consistency Checklist
Every modal must be registered in:
1. `closeAllModals()` in `ui.js` (or handled separately like `actions-modal`)
2. `anyOpen` array in keydown handler in `ui.js`
3. Backdrop-click forEach in `boot.js`
4. Has a visible `✕` close button

### MQTT Public API (mqtt.js)
- `mqttSubscribe(topic, callback)` — safe to call before connect; callback receives `(topic, payloadString)`
- `mqttPublish(topic, payload)` — returns `true` if sent, `false` if not connected

### Actions Config (actions.json)
```json
{
  "actions": [{ "id": "...", "label": "...", "icon": "mdi:...", "publish": { "topic": "...", "payload": "..." }, "state": { "topic": "...", "onValue": "ON" } }],
  "groups":  [{ "id": "...", "name": "...", "actions": ["action-id", ...] }]
}
```

### View slotGroups
Views can have a `slotGroups` array (parallel to `streams`) mapping slot index → group id or null. Set in the views editor per slot. Used by `layouts.js` to inject action indicators and by `actions.js` to open the correct group.
