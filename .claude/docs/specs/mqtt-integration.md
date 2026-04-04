# MQTT Integration

> Status: `active`
> Last updated: 2026-04-03

## Goal

Allow external systems to dynamically update stream configurations and control view switching via MQTT messages — without editing JSON files or restarting the browser. Enables integration with home automation systems (Home Assistant, Node-RED), monitoring dashboards, or remote control apps.

Primary use cases:
- **Stream config updates**: Change a camera's label, aspect ratio, or audio setting at runtime
- **View control**: Switch to a specific view on-demand with optional duration override (e.g., "show front entrance for 60 seconds")
- **Stream additions**: Add new camera streams discovered on the network without restarting

---

## UX Design

MQTT integration is invisible to the end user. There is no UI for MQTT config — it is configured via `data/streams.json` or via defaults in `config.js`.

### Config structure

MQTT can be configured two ways:

**1. Defaults in `config.js`:**
```js
const MQTT_DEFAULTS = {
  enabled:    false,
  host:       window.location.hostname,
  port:       9001,
  tls:        false,
  username:   '',
  password:   '',
  topicBase:  'kiosk/streams',
};
```

**2. Override via `streams.json`:**
```json
{
  "streams": [...],
  "mqtt": {
    "enabled": true,
    "host": "mqtt.local",
    "port": 9001,
    "tls": false,
    "username": "user",
    "password": "pass",
    "topicBase": "kiosk/streams"
  }
}
```

The `streams.json` mqtt block takes precedence over defaults.

### MQTT topics

| Topic | Payload | Effect |
|-------|---------|--------|
| `<topicBase>` | JSON array of stream objects | Replace entire stream list (not implemented — per-stream updates only) |
| `<topicBase>/<path>` | JSON stream object | Update one stream by path. Fields in the payload merge over existing stream config. |
| `<topicBase>/view` | `{ "name": "front", "duration": 30 }` | Switch to the named view. `duration` overrides the view's default duration. `-1` = stay forever. `0` = clear override and return to default view. |

**Per-stream topic example:**
```
Topic: kiosk/streams/cam1
Payload: { "label": "Front Entrance (Night Mode)", "audio": true }
```

**View control example:**
```
Topic: kiosk/streams/view
Payload: { "name": "front-entrance", "duration": 60 }
```

---

## Interaction Model

### Connection lifecycle

1. On page load, `boot()` calls `startMQTT()` in `mqtt.js`
2. If `MQTT_ENABLED === false`, MQTT is skipped (no connection attempt)
3. If enabled, `mqtt.connect(url, opts)` establishes WebSocket connection to broker
4. On connect, subscribe to:
   - `<topicBase>/+` (all per-stream topics)
   - `<topicBase>/view` (view control)
5. On message received, parse JSON and apply changes

### Stream update flow

When a per-stream message arrives:
1. Parse payload as JSON stream object
2. Extract `path` from topic (e.g., `kiosk/streams/cam1` → path = `cam1`)
3. Call `applyStreamUpdates([payload])`
4. `applyStreamUpdates()` checks which fields are locked in `STREAMS_STATIC[path]` (fields explicitly set in `streams.json` cannot be overridden by MQTT)
5. If the stream doesn't exist in `STREAMS[]`, add it as a new stream
6. If the stream exists, merge unlocked fields into `STREAMS[idx]`
7. If the stream is currently displayed (has a video element), tear down its WebRTC connection and restart it

### View control flow

When a view control message arrives:
1. Parse payload as `{ name, duration }`
2. Look up the view by name in `VIEWS[]`
3. If `duration === 0`, clear any override and return to default view cycling
4. If `duration !== undefined`, temporarily override the view's duration (does not persist — only affects the current browser session)
5. Call `activateView(name)` to switch immediately

---

## States

### MQTT disabled
`startMQTT()` logs "MQTT: disabled" and returns. No connection attempt.

### Connecting
`mqtt.connect()` is called. Console logs "MQTT: connecting to ws://...". No visual indicator.

### Connected
Console logs "MQTT: connected". No visual indicator. The app listens for messages.

### Reconnecting
If the connection drops, the MQTT.js library automatically reconnects (5s interval). Console logs "MQTT: reconnecting...".

### Error
On connection error, console logs "MQTT error: ...". No visual indicator. Reconnect is automatic.

### Message received
Console logs "MQTT: update for stream <path>". No visual indicator unless the stream is currently displayed (in which case the video restarts).

---

## Motion

No transitions. Stream updates that affect displayed streams cause a WebRTC reconnect (loading spinner → video, ~2s latency).

---

## Implementation Plan

### JS changes (in `www/js/mqtt.js`)

**Already implemented.** Key functions:

`startMQTT()` — reads `MQTT_DEFAULTS` and `MQTT_CONFIG` (from `streams.json`), merges them, connects to broker, subscribes to topics.

`applyStreamUpdates(updates)` — accepts an array of stream update objects. For each:
- Check if the stream exists in `STREAMS[]`
- Filter out fields that are locked in `STREAMS_STATIC[path]`
- If new stream: append to `STREAMS[]` and reapply layout
- If existing stream: merge fields, close WebRTC connection if active, restart `startWhep(idx)`

View control is handled inline in the `client.on('message')` handler. If the topic matches `<topicBase>/view`, parse the payload and call `activateView(name)` with optional duration override.

### Dependencies

Requires `mqtt.js` (WebSocket client library). Loaded from npm at build time in `Dockerfile.ui` stage 1:
```sh
npm install mqtt
cp node_modules/mqtt/dist/mqtt.min.js www/mqtt.min.js
```

The library is included via `<script src="/js/mqtt.min.js">` in `index.html` before `config.js`.

If `mqtt.js` is not loaded, `startMQTT()` logs "MQTT: mqtt.js not loaded" and returns.

### MQTT broker setup (out of scope)

The MQTT integration assumes an existing MQTT broker is running on the network. Common options:
- **EMQX** (WebSocket support out of the box, port 9001)
- **Mosquitto** with WebSocket listener enabled
- **Home Assistant** built-in MQTT broker (WebSocket on port 9001 by default)

Broker setup is not part of the rtsp-kiosk stack. The user must configure their own broker and set the host/port in `streams.json` or `config.js`.

### TLS support

If `tls: true`, the connection URL changes from `ws://` to `wss://`. The broker must have a valid certificate. Self-signed certs will fail in the browser unless the user manually trusts them.

---

## Edge cases

**Locked fields:** Fields explicitly set in `streams.json` cannot be overridden by MQTT. The `STREAMS_STATIC[path]` map records which fields were present in the JSON at load time. MQTT updates that attempt to modify locked fields are ignored and logged: "MQTT: ignoring locked field 'label' for cam1".

**New stream via MQTT:** If a stream with a new `path` arrives via MQTT, it is appended to `STREAMS[]`. If the current layout has spare slots, the new stream may appear immediately. Otherwise it will appear on the next layout change.

**Missing `path` in payload:** The path is derived from the topic suffix (e.g., `kiosk/streams/cam1` → path = `cam1`). If the payload has a `path` field that differs, the topic takes precedence: `data.path = data.path || streamPath`.

**Invalid JSON payload:** If the payload is not valid JSON, the message is logged and dropped: "MQTT: invalid JSON on <topic>".

**View not found:** If a view control message references a view name that doesn't exist in `VIEWS[]`, log a warning and do nothing: "MQTT: view not found: <name>".

**Duration override persistence:** Duration overrides from MQTT do not persist to `localStorage` or `views.json`. They are session-only. On page reload, the view reverts to its original duration.

**Reconnect behavior:** The `mqtt.js` library handles reconnects automatically (5s interval). Streams that were updated via MQTT before the disconnect are preserved in `STREAMS[]` — the reconnect does not reset them.

**Broker unavailable at page load:** If the broker is not reachable, the connection fails silently. Console logs "MQTT error: ...". The app remains functional with the stream config from `streams.json`.

---

## Open questions

None. Feature is complete and stable.
