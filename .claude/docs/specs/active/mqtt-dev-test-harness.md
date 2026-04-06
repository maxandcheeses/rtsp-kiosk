# Plan: MQTT Dev Test Harness

> Status: `active`
> Last updated: 2026-04-05

## Task Description

Add a local MQTT broker (Eclipse Mosquitto) to the dev Docker Compose stack so panel action buttons can be tested end-to-end without a real broker. Alongside the broker, add a static test harness page (`/mqtt-test`) that auto-discovers actions from `actions.json`, renders labelled toggle switches for each state topic, and logs incoming publish commands — letting a developer simulate device state and observe kiosk publish events in real time.

## Objective

After this plan is complete, running `docker compose -f docker-compose.dev.yml up` gives a full local MQTT environment. The developer opens `http://localhost:8080/mqtt-test.html` to flip switches (simulating device state changes) and see what the kiosk publishes when action buttons are pressed — all without needing a real MQTT broker or smart home device.

## Problem Statement

`actions.json` ships with broker `ws://192.168.1.100:9001` — a real LAN address. In dev there is no broker, so `mqttSubscribe` / `mqttPublish` silently fail and the green glow / press feedback cannot be verified. Developers currently have no way to test the Panel Actions Modal feature locally.

## Solution Approach

1. Add `eclipse-mosquitto` to `docker-compose.dev.yml`, exposing port `9001` (WebSocket) and `1883` (plain TCP). A minimal `mosquitto.conf` enables the WebSocket listener and allows anonymous connections.
2. Serve the test harness page from the existing dev nginx (volume-mount `tools/mqtt-test/index.html` → `/usr/share/nginx/html/mqtt-test.html`). No extra container needed.
3. The test page uses MQTT.js from CDN to connect directly to `ws://localhost:9001/mqtt`. It fetches `/actions.json` to discover state topics and publish topics dynamically, then renders a switch panel and message log.
4. The kiosk's MQTT client reads `host: window.location.hostname` and `port: 9001` from `MQTT_DEFAULTS` in `config.js` — so enabling MQTT via `streams.json` (`"mqtt": {"enabled": true}`) is all the user needs. No broker URL to configure.

---

## Relevant Files

- `docker-compose.dev.yml` — add `mqtt` service; add test page volume mount to `nginx`
- `tools/mqtt-test/mosquitto.conf` — **new** — Mosquitto config enabling WebSocket on 9001
- `tools/mqtt-test/index.html` — **new** — browser-based MQTT test harness
- `data/actions.json` — reference only; test page fetches this at runtime to discover topics
- `www/js/config.js` — reference only; confirms `MQTT_DEFAULTS.host = window.location.hostname`, `port: 9001`

### New Files
- `tools/mqtt-test/mosquitto.conf` — Mosquitto listener config
- `tools/mqtt-test/index.html` — test harness UI

---

## Implementation Phases

### Phase 1: Mosquitto service
Add broker to dev compose with correct WebSocket config.

### Phase 2: Test harness page
Build the static HTML page that connects, discovers topics from `actions.json`, and renders switches + log.

### Phase 3: Integration
Wire the page into dev nginx, document the one-time `streams.json` edit needed to enable MQTT in the kiosk.

---

## Step by Step Tasks

### 1. Create `tools/mqtt-test/mosquitto.conf`

```
# Allow connections without credentials (dev only)
allow_anonymous true

# Standard MQTT (TCP)
listener 1883

# WebSocket MQTT — required by browsers (kiosk + test page)
listener 9001
protocol websockets
```

### 2. Add `mqtt` service to `docker-compose.dev.yml`

In the `services:` block, add after `fake-streams`:

```yaml
  mqtt:
    image: eclipse-mosquitto:2
    ports:
      - "1883:1883"   # plain MQTT (optional, useful for CLI tools like mosquitto_pub/sub)
      - "9001:9001"   # WebSocket MQTT (used by browsers)
    volumes:
      - ./tools/mqtt-test/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
```

Also add `mqtt` to the `nginx` service's `depends_on` list so nginx starts after the broker is up.

### 3. Add test page volume mount to nginx in `docker-compose.dev.yml`

In the `nginx` service `volumes:` list, add:

```yaml
- ./tools/mqtt-test/index.html:/usr/share/nginx/html/mqtt-test.html:ro
```

### 4. Create `tools/mqtt-test/index.html`

Full standalone HTML page. Key behaviours:

**Connect**: On load, connects to `ws://localhost:9001/mqtt` using MQTT.js from CDN (`https://unpkg.com/mqtt/dist/mqtt.min.js`). Shows a connection status badge (grey → green on connect, red on error).

**Discover topics**: Fetches `/actions.json` (same-origin — served by dev nginx at 8080). Parses:
- All unique `action.state.topic` values → **state switches** (subscribe + publish)
- All unique `action.publish.topic` values → **command log** (subscribe only, to see what kiosk sends)

**State switches panel**: For each state topic, renders a labelled toggle button. The button label shows the topic. Shows the current received value next to it. Clicking the toggle cycles through the known `onValue` values for that topic (or just sends ON/OFF if there are two states). Publish to the state topic on click.

**Command log**: Subscribe to all `action.publish.topic` values. Each received message appends a row to a scrollable log:
```
[12:34:56]  home/living/lights/set  →  ON
```
Max 100 rows (oldest removed).

**Manual publish**: A small form at the bottom: topic input + payload input + Send button. Lets the developer publish arbitrary messages for edge case testing.

**Visual design**: Dark background matching the kiosk aesthetic (`#0a0a0a`), monospace font, minimal styling. No external CSS framework needed.

**Skeleton HTML structure**:
```html
<!DOCTYPE html>
<html>
<head>
  <title>MQTT Test Harness</title>
  <meta charset="utf-8">
  <style>
    /* dark, monospace, minimal */
    body { background:#0a0a0a; color:rgba(255,255,255,0.75); font-family:'Courier New',monospace; font-size:12px; padding:32px; }
    h2 { font-size:11px; letter-spacing:0.2em; text-transform:uppercase; color:rgba(255,255,255,0.35); margin:24px 0 12px; }
    .status { display:inline-block; padding:3px 10px; border-radius:3px; font-size:10px; }
    .status.connected { background:rgba(74,222,128,0.15); color:#4ade80; border:1px solid rgba(74,222,128,0.3); }
    .status.disconnected { background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.3); border:1px solid rgba(255,255,255,0.1); }
    .status.error { background:rgba(248,113,113,0.15); color:#f87171; border:1px solid rgba(248,113,113,0.3); }
    .switch-btn { padding:8px 16px; border:1px solid rgba(255,255,255,0.15); border-radius:4px; background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.6); cursor:pointer; font-family:inherit; font-size:11px; margin:4px; transition:all 0.15s; }
    .switch-btn.on { background:rgba(74,222,128,0.12); border-color:rgba(74,222,128,0.5); color:#4ade80; box-shadow:0 0 8px rgba(74,222,128,0.3); }
    .log { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:4px; padding:12px; height:200px; overflow-y:auto; font-size:11px; }
    .log-row { padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.04); color:rgba(255,255,255,0.5); }
    .log-row .topic { color:rgba(255,255,255,0.7); }
    .log-row .payload { color:#4ade80; }
    input { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); border-radius:3px; color:rgba(255,255,255,0.7); font-family:inherit; font-size:11px; padding:6px 10px; }
    button.send { padding:6px 16px; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.15); border-radius:3px; color:rgba(255,255,255,0.6); cursor:pointer; font-family:inherit; font-size:11px; }
  </style>
</head>
<body>
  <h1 style="font-size:13px;letter-spacing:0.3em;text-transform:uppercase;color:rgba(255,255,255,0.4)">MQTT Test Harness</h1>
  <div>Broker: <code>ws://localhost:9001</code> &nbsp; <span id="status" class="status disconnected">Disconnected</span></div>

  <h2>State Switches</h2>
  <div id="switches">Loading actions.json…</div>

  <h2>Command Log <span style="opacity:0.4;font-size:10px">(messages published by kiosk)</span></h2>
  <div id="log" class="log"></div>

  <h2>Manual Publish</h2>
  <div style="display:flex;gap:8px;align-items:center">
    <input id="pub-topic" placeholder="topic" style="width:240px">
    <input id="pub-payload" placeholder="payload" style="width:120px">
    <button class="send" onclick="manualPublish()">Send</button>
  </div>

  <script src="https://unpkg.com/mqtt/dist/mqtt.min.js"></script>
  <script>
    // … JS logic (see implementation notes below) …
  </script>
</body>
</html>
```

**JS logic outline** (implement inline in the `<script>` block):

```js
const BROKER = 'ws://localhost:9001/mqtt';
let client = null;
let stateValues = {}; // topic → current value
let stateOnValues = {}; // topic → Set of known onValues

async function init() {
  // 1. Fetch actions.json
  let cfg;
  try {
    const res = await fetch('/actions.json');
    cfg = await res.json();
  } catch(e) {
    document.getElementById('switches').textContent = 'Failed to load /actions.json';
    return;
  }

  // 2. Collect state topics and their onValues
  const stateTopics = new Map(); // topic → Set of onValues
  const publishTopics = new Set();
  (cfg.actions || []).forEach(a => {
    if (a.state && a.state.topic) {
      if (!stateTopics.has(a.state.topic)) stateTopics.set(a.state.topic, new Set());
      if (a.state.onValue) stateTopics.get(a.state.topic).add(a.state.onValue);
    }
    if (a.publish && a.publish.topic) publishTopics.add(a.publish.topic);
  });

  // 3. Render switch buttons
  const switchContainer = document.getElementById('switches');
  switchContainer.innerHTML = '';
  stateTopics.forEach((onValues, topic) => {
    stateOnValues[topic] = onValues;
    const btn = document.createElement('button');
    btn.className = 'switch-btn';
    btn.id = 'sw-' + topic.replace(/\//g, '-');
    btn.dataset.topic = topic;
    btn.dataset.onValues = JSON.stringify([...onValues]);
    btn.innerHTML = `<span>${topic}</span><br><small id="val-${btn.id}" style="opacity:0.5">—</small>`;
    btn.onclick = () => toggleSwitch(topic, onValues);
    switchContainer.appendChild(btn);
  });

  // 4. Connect MQTT
  client = mqtt.connect(BROKER, { clientId: 'test-harness-' + Math.random().toString(16).slice(2,8) });
  client.on('connect', () => {
    setStatus('connected');
    stateTopics.forEach((_, topic) => client.subscribe(topic));
    publishTopics.forEach(topic => client.subscribe(topic));
  });
  client.on('error', () => setStatus('error'));
  client.on('close', () => setStatus('disconnected'));
  client.on('message', (topic, payload) => {
    const val = payload.toString();
    // Update switch if it's a state topic
    const btnId = 'sw-' + topic.replace(/\//g, '-');
    const btn = document.getElementById(btnId);
    if (btn) {
      stateValues[topic] = val;
      const isOn = (stateOnValues[topic] || new Set()).has(val);
      btn.classList.toggle('on', isOn);
      const valEl = document.getElementById('val-' + btnId);
      if (valEl) valEl.textContent = val;
    }
    // Always log
    appendLog(topic, val);
  });
}

function toggleSwitch(topic, onValues) {
  if (!client || !client.connected) return;
  const current = stateValues[topic];
  const vals = [...onValues];
  // Toggle: if current matches a known value, send the next one; else send first
  let next;
  if (vals.length >= 2) {
    const idx = vals.indexOf(current);
    next = vals[(idx + 1) % vals.length];
  } else if (vals.length === 1) {
    next = current === vals[0] ? 'OFF' : vals[0];
  } else {
    next = current === 'ON' ? 'OFF' : 'ON';
  }
  client.publish(topic, next);
}

function appendLog(topic, payload) {
  const log = document.getElementById('log');
  const now = new Date().toTimeString().slice(0,8);
  const row = document.createElement('div');
  row.className = 'log-row';
  row.innerHTML = `<span style="opacity:0.3">[${now}]</span>  <span class="topic">${topic}</span>  →  <span class="payload">${payload}</span>`;
  log.appendChild(row);
  while (log.children.length > 100) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function manualPublish() {
  if (!client || !client.connected) return;
  const topic = document.getElementById('pub-topic').value.trim();
  const payload = document.getElementById('pub-payload').value.trim();
  if (topic) client.publish(topic, payload);
}

function setStatus(state) {
  const el = document.getElementById('status');
  el.className = 'status ' + state;
  el.textContent = state.charAt(0).toUpperCase() + state.slice(1);
}

init();
```

### 5. Document the one-time `streams.json` edit

Add a comment block at the top of `tools/mqtt-test/index.html` (visible in source) explaining:

```
To enable MQTT in the kiosk, add to data/streams.json:
  "mqtt": { "enabled": true }
The kiosk will connect to ws://localhost:9001 automatically
(MQTT_DEFAULTS.host = window.location.hostname, port = 9001).
```

Also note this in `data/actions.json` as a comment (JSON doesn't support comments, so put it in a `_dev_note` field or just document it in the spec/README).

---

## Testing Strategy

1. Start the stack: `docker compose -f docker-compose.dev.yml up`
2. Open `http://localhost:8080/mqtt-test.html` — should show "Connected" status
3. Open the kiosk at `http://localhost:8080` — enable MQTT in streams.json
4. Assign the `living-room` action group to a view slot in the views editor
5. Click the ⚡ panel — actions modal appears
6. Press "Lights On" in the kiosk → test page log shows `home/living/lights/set → ON`
7. Click the Lights state toggle on the test page → kiosk action button should glow green
8. Press ESC in kiosk → modal closes; kiosk still shows correct button state on next open

---

## Acceptance Criteria

- [x] `docker compose -f docker-compose.dev.yml up` starts Mosquitto alongside the existing services
- [x] `http://localhost:8080/mqtt-test.html` loads and shows "Connected" within 2s of page load
- [x] All state topics from `actions.json` appear as toggle buttons on the test page
- [x] Clicking a toggle publishes to the state topic; the kiosk action button glows green/off accordingly
- [x] Pressing an action button in the kiosk appears in the test page command log within 1s
- [x] Manual publish form works for arbitrary topic/payload
- [x] No authentication required (anonymous connections allowed)
- [x] Mosquitto ports `1883` and `9001` are exposed on localhost

## Validation Commands

```bash
# Verify Mosquitto is running
docker compose -f docker-compose.dev.yml ps mqtt

# Test plain MQTT connectivity (if mosquitto-clients installed locally)
mosquitto_pub -h localhost -p 1883 -t test/ping -m hello
mosquitto_sub -h localhost -p 1883 -t test/ping

# Test WebSocket connectivity (confirm port is open)
curl -s --include --no-buffer \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  http://localhost:9001/ | head -5
# Expected: HTTP/1.1 101 Switching Protocols

# Confirm test page is served
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/mqtt-test.html
# Expected: 200
```

## Notes

- `eclipse-mosquitto:2` is the official image — no custom Dockerfile needed
- The test page deliberately does NOT use a framework — it's a single self-contained file, easy to debug and modify
- `allow_anonymous true` is intentional for dev only — production deployments should use the `username`/`password` fields in `actions.json` and configure Mosquitto with `password_file`
- The kiosk's stream-update MQTT (from `streams.json`) and the actions MQTT share the same connection — enabling MQTT for one enables both
- If a developer wants to test with a real broker instead of Mosquitto, they only need to update `streams.json` mqtt block — the test page URL is hardcoded to localhost but can be made configurable via URL param (`?broker=ws://...`) as a future enhancement
