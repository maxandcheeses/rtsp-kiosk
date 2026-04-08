# Plan: Actions Modal MQTT Status Dot

> Status: `done`
> Last updated: 2026-04-06

## Task Description
Improve the `● MQTT` status indicator in the actions modal:
1. **Conditional visibility** — only show the dot if at least one action in the currently-displayed group has a `publish` block (i.e., is MQTT-driven). Hide it for groups with no MQTT actions.
2. **Three-state color** — green when connected, yellow when connecting/reconnecting, red when disconnected.
3. **Click-to-reconnect** — when red, the dot becomes clickable and immediately triggers a reconnect attempt (cancels any pending backoff timer, resets delay to 1s).

## Objective
The dot is invisible for non-MQTT groups, gives an accurate at-a-glance connection state (green/yellow/red), and lets operators force a reconnect by clicking the red dot instead of waiting for the backoff timer.

## Relevant Files

- `www/js/mqtt.js` — add `_mqttConnecting` state variable, update all state transitions, update `_updateMqttStatusIndicator` for 3 states + pointer events, add `mqttForceReconnect()`
- `www/js/actions.js` — add `_mqttConnecting` transitions to `_startActionsMqtt`; add show/hide logic to `_renderActionButtons`
- `www/index.html` — add `display:none` default to the status span; remove `pointer-events:none` (now controlled dynamically)

## Step by Step Tasks

### 1. Add `_mqttConnecting` state var to `mqtt.js`

After the existing `let _mqttConnected = false;` line, add:
```js
let _mqttConnecting = false;
```

### 2. Update `startMQTT` in `mqtt.js` for connecting state

After `_mqttClient = mqtt.connect(url, opts);`, add:
```js
_mqttConnecting = true;
_updateMqttStatusIndicator();
```

In the `connect` handler, add `_mqttConnecting = false;` at the very top (before `_mqttConnected = true`).

The `close` handler already sets `_mqttConnected = false` — no changes needed there for `_mqttConnecting` (it was already false at that point).

### 3. Update `_mqttScheduleReconnect` in `mqtt.js`

Inside the `setTimeout` callback, after calling `_mqttClient.reconnect()`, add:
```js
_mqttConnecting = true;
_updateMqttStatusIndicator();
```

So the full function becomes:
```js
function _mqttScheduleReconnect() {
  if (_mqttReconnTimer) return;
  _mqttReconnTimer = setTimeout(() => {
    _mqttReconnTimer = null;
    if (_mqttClient) {
      console.log(`MQTT: reconnecting (backoff ${_mqttReconnDelay}ms)`);
      _mqttClient.reconnect();
      _mqttConnecting = true;
      _updateMqttStatusIndicator();
    }
    _mqttReconnDelay = Math.min(_mqttReconnDelay * 2, _MQTT_DELAY_MAX);
  }, _mqttReconnDelay);
}
```

### 4. Update `_updateMqttStatusIndicator` in `mqtt.js`

Replace the current two-state implementation with three-state + pointer-events control:

```js
function _updateMqttStatusIndicator() {
  const el = document.getElementById('actions-mqtt-status');
  if (!el) return;
  if (_mqttConnected) {
    el.textContent = '● MQTT';
    el.style.color = 'rgba(74,222,128,0.7)';
    el.style.pointerEvents = 'none';
    el.style.cursor = '';
    el.onclick = null;
  } else if (_mqttConnecting) {
    el.textContent = '● MQTT';
    el.style.color = 'rgba(251,191,36,0.7)';
    el.style.pointerEvents = 'none';
    el.style.cursor = '';
    el.onclick = null;
  } else {
    el.textContent = '● MQTT';
    el.style.color = 'rgba(248,113,113,0.7)';
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.onclick = mqttForceReconnect;
  }
}
```

### 5. Add `mqttForceReconnect` to `mqtt.js`

Add after `_updateMqttStatusIndicator`:

```js
function mqttForceReconnect() {
  if (!_mqttClient) return;
  // Cancel pending backoff timers for both MQTT paths
  if (_mqttReconnTimer) { clearTimeout(_mqttReconnTimer); _mqttReconnTimer = null; }
  if (typeof _actMqttReconnTimer !== 'undefined' && _actMqttReconnTimer) {
    clearTimeout(_actMqttReconnTimer);
    _actMqttReconnTimer = null;
  }
  // Reset delays
  _mqttReconnDelay = 1000;
  if (typeof _actMqttReconnDelay !== 'undefined') _actMqttReconnDelay = 1000;
  // Trigger reconnect
  _mqttConnecting = true;
  _updateMqttStatusIndicator();
  console.log('MQTT: force reconnect requested');
  _mqttClient.reconnect();
}
```

### 6. Update `_startActionsMqtt` in `actions.js`

After `_mqttClient = mqtt.connect(mqttCfg.broker, opts);`, add:
```js
_mqttConnecting = true;
_updateMqttStatusIndicator();
```

In the `connect` handler of `_startActionsMqtt`, add `_mqttConnecting = false;` at the very top (before `_mqttConnected = true`).

In the backoff `setTimeout` callback (inside `close` handler), after calling `_mqttClient.reconnect()`, add:
```js
_mqttConnecting = true;
_updateMqttStatusIndicator();
```

### 7. Add show/hide logic to `_renderActionButtons` in `actions.js`

After `const actionIds = (group.actions || []).slice(0, 6);`, add:

```js
const statusEl = document.getElementById('actions-mqtt-status');
if (statusEl) {
  const hasMqtt = actionIds.some(id => ACTIONS[id] && ACTIONS[id].publish);
  statusEl.style.display = hasMqtt ? '' : 'none';
}
```

### 8. Update `#actions-mqtt-status` in `www/index.html`

Find the current span:
```html
<span id="actions-mqtt-status" style="position:absolute; bottom:19px; right:24px; font-size:9px; font-family:'Courier New',monospace; color:rgba(248,113,113,0.5); pointer-events:none;">● MQTT</span>
```

Replace with (remove `pointer-events:none`, add `display:none` default, update initial color to match disconnected state):
```html
<span id="actions-mqtt-status" style="position:absolute; bottom:19px; right:24px; font-size:9px; font-family:'Courier New',monospace; color:rgba(248,113,113,0.7); display:none;">● MQTT</span>
```

`pointer-events` and `cursor` are now controlled dynamically by `_updateMqttStatusIndicator`. `display:none` is the safe default — `_renderActionButtons` shows it when the group has MQTT actions.

## Acceptance Criteria

- [x] Status dot is hidden when the displayed group has no actions with a `publish` block
- [x] Status dot is visible when at least one group action has a `publish` block
- [x] Dot is green (`rgba(74,222,128,0.7)`) when `_mqttConnected === true`
- [x] Dot is yellow (`rgba(251,191,36,0.7)`) during initial connect and while waiting for backoff reconnect
- [x] Dot is red (`rgba(248,113,113,0.7)`) when disconnected and idle (not actively connecting)
- [x] Red dot has `cursor:pointer` and is clickable
- [x] Clicking red dot cancels pending backoff timer, resets delay to 1s, immediately calls `reconnect()`, and turns dot yellow
- [x] Green/yellow dot is not clickable (`pointer-events:none`)
- [x] Dot color updates in real time without needing to close/reopen the modal

## Validation Commands

```bash
# Verify no JS syntax errors
node --check www/js/mqtt.js && node --check www/js/actions.js

# Manual test: stop broker, open actions modal — dot should be red
docker compose stop mqtt   # or docker compose -f docker-compose.dev.yml stop mqtt

# Manual test: start broker, watch dot turn green
docker compose start mqtt

# Manual test: kill broker mid-session, dot goes red → click it → dot goes yellow → broker restarts → green
```

## Notes

- `_mqttConnecting` is declared in `mqtt.js` and accessed from `actions.js` — valid because both files load as plain `<script>` tags into the same global scope.
- The yellow state covers two sub-states: (a) actively connecting (TCP handshake in flight) and (b) backoff timer fired and `reconnect()` was just called. Both are "trying" from the user's perspective and don't need separate colors.
- The red + idle state (waiting for next backoff, e.g., the 30s window) is when clicking is most useful. During the backoff wait, `_mqttConnecting` is `false` and `_mqttConnected` is `false`, so the dot correctly shows red.
- `mqttForceReconnect` is defined in `mqtt.js` so it's available globally, but called via `el.onclick = mqttForceReconnect` (function reference, not a string) to avoid any inline eval concerns.
