# Plan: MQTT Reconnection Resilience

> Status: `planned`
> Last updated: 2026-04-05

## Task Description

Improve MQTT connection reliability with exponential backoff reconnection, a publish queue that retries on reconnect, and a live connection status indicator in the actions modal.

## Objective

After this plan is complete, MQTT connections are self-healing: the client reconnects with increasing delays when the broker is unavailable, queued publishes are flushed automatically when the connection is restored, and the actions modal shows a live MQTT status dot so operators know at a glance whether the broker is reachable.

## Problem Statement

Both MQTT paths (`startMQTT` in `mqtt.js` and `_startActionsMqtt` in `actions.js`) currently use MQTT.js's built-in `reconnectPeriod: 5000` — a fixed 5-second retry interval. When the broker is down for minutes or hours on a 24/7 kiosk, this generates continuous log spam and provides no backoff. More importantly, `mqttPublish` silently drops messages when disconnected — there is no retry mechanism, so action button presses are lost during a transient disconnect. Users also have no visual indication of whether MQTT is currently connected when they open the actions modal.

## Solution Approach

1. **Exponential backoff** — disable MQTT.js's built-in reconnect (`reconnectPeriod: 0`) and implement manual reconnect scheduling with delay doubling: 1s → 2s → 4s → 8s → ... → 30s max. Reset to 1s on successful connect. Apply to both `startMQTT` and `_startActionsMqtt`.

2. **Publish queue** — when `mqttPublish` is called while disconnected, push `{ topic, payload }` to a capped in-memory queue (max 20 items). On each `connect` event, flush the queue in order. Oldest items are dropped when the cap is reached.

3. **MQTT status indicator** — track `_mqttConnected` as a module-level boolean in `mqtt.js`, updated on every `connect` / `close` / `error` event. The actions modal reads this when opening and renders a ● status dot (green = connected, yellow = connecting, red = error) in its footer alongside the keep-open toggle.

---

## Relevant Files

- `www/js/mqtt.js` — add backoff scheduler, publish queue, `_mqttConnected` flag
- `www/js/actions.js` — add backoff scheduler to `_startActionsMqtt`; read `_mqttConnected` in `openActionsModal`
- `www/index.html` — add `#actions-mqtt-status` element to actions modal footer

---

## Step by Step Tasks

### 1. Add backoff state and scheduler to `mqtt.js`

Add module-level vars after `_extraSubscriptions`:

```js
let _mqttConnected   = false;
let _mqttReconnDelay = 1000;       // current backoff delay in ms
let _mqttReconnTimer = null;       // pending reconnect timeout handle
let _mqttPublishQueue = [];        // { topic, payload } buffered while disconnected
const _MQTT_QUEUE_MAX    = 20;
const _MQTT_DELAY_MAX    = 30000;
```

Add the scheduler helper (before `startMQTT`):

```js
function _mqttScheduleReconnect() {
  if (_mqttReconnTimer) return;
  _mqttReconnTimer = setTimeout(() => {
    _mqttReconnTimer = null;
    if (_mqttClient) {
      console.log(`MQTT: reconnecting (backoff ${_mqttReconnDelay}ms)`);
      _mqttClient.reconnect();
    }
    _mqttReconnDelay = Math.min(_mqttReconnDelay * 2, _MQTT_DELAY_MAX);
  }, _mqttReconnDelay);
}
```

### 2. Update `startMQTT` in `mqtt.js`

Change `reconnectPeriod: 5000` to `reconnectPeriod: 0` in the `opts` object.

In the `connect` handler, add at the top:
```js
_mqttConnected = true;
_mqttReconnDelay = 1000;
if (_mqttReconnTimer) { clearTimeout(_mqttReconnTimer); _mqttReconnTimer = null; }
// Flush publish queue
const queued = _mqttPublishQueue.splice(0);
queued.forEach(q => _mqttClient.publish(q.topic, q.payload, { qos: 1 }));
if (queued.length) console.log(`MQTT: flushed ${queued.length} queued publish(es)`);
_updateMqttStatusIndicator();
```

Add a `close` event handler after the existing `reconnect` handler:
```js
_mqttClient.on('close', () => {
  _mqttConnected = false;
  _updateMqttStatusIndicator();
  _mqttScheduleReconnect();
});
```

Remove (or keep, harmless) the existing `reconnect` log handler — with `reconnectPeriod: 0` it won't fire.

Update the `error` handler to also set state and schedule reconnect:
```js
_mqttClient.on('error', err => {
  console.error('MQTT error:', err);
  _mqttConnected = false;
  _updateMqttStatusIndicator();
});
```

Add the status indicator update helper (near bottom of `mqtt.js`):
```js
function _updateMqttStatusIndicator() {
  const el = document.getElementById('actions-mqtt-status');
  if (!el) return;
  if (_mqttConnected) {
    el.textContent = '● MQTT';
    el.style.color = 'rgba(74,222,128,0.7)';
  } else {
    el.textContent = '● MQTT';
    el.style.color = 'rgba(248,113,113,0.5)';
  }
}
```

### 3. Update `mqttPublish` in `mqtt.js`

Replace the current implementation:
```js
function mqttPublish(topic, payload) {
  if (!_mqttClient || !_mqttClient.connected) {
    if (_mqttPublishQueue.length < _MQTT_QUEUE_MAX) {
      _mqttPublishQueue.push({ topic, payload });
      console.log(`MQTT: queued publish to ${topic} (disconnected)`);
    }
    return false;
  }
  _mqttClient.publish(topic, payload, { qos: 1 });
  return true;
}
```

### 4. Update `_startActionsMqtt` in `actions.js`

Apply the same backoff pattern. Add module-level vars at the top of `actions.js` (after `_actionUnsubscribers` if present, or just before `_startActionsMqtt`):

```js
let _actMqttReconnDelay = 1000;
let _actMqttReconnTimer = null;
```

Change `reconnectPeriod: 5000` to `reconnectPeriod: 0` in `_startActionsMqtt`'s `opts`.

In the `connect` handler of `_startActionsMqtt`, add:
```js
_mqttConnected = true;
_actMqttReconnDelay = 1000;
if (_actMqttReconnTimer) { clearTimeout(_actMqttReconnTimer); _actMqttReconnTimer = null; }
// Flush publish queue (shared with mqtt.js)
const queued = _mqttPublishQueue.splice(0);
queued.forEach(q => _mqttClient.publish(q.topic, q.payload, { qos: 1 }));
if (queued.length) console.log(`Actions MQTT: flushed ${queued.length} queued publish(es)`);
_updateMqttStatusIndicator();
```

Add `close` and `error` handlers in `_startActionsMqtt`:
```js
_mqttClient.on('close', () => {
  _mqttConnected = false;
  _updateMqttStatusIndicator();
  if (_actMqttReconnTimer) return;
  _actMqttReconnTimer = setTimeout(() => {
    _actMqttReconnTimer = null;
    if (_mqttClient) {
      console.log(`Actions MQTT: reconnecting (backoff ${_actMqttReconnDelay}ms)`);
      _mqttClient.reconnect();
    }
    _actMqttReconnDelay = Math.min(_actMqttReconnDelay * 2, 30000);
  }, _actMqttReconnDelay);
});

_mqttClient.on('error', err => {
  console.error('Actions MQTT error:', err);
  _mqttConnected = false;
  _updateMqttStatusIndicator();
});
```

### 5. Add MQTT status dot to actions modal HTML

In `www/index.html`, find the `#actions-modal` div. Add the status dot alongside the keep-open label in the modal footer area. Currently the footer has:

```html
<label style="...position:absolute; bottom:16px; left:24px;...">
  <input type="checkbox" id="actions-keep-open" ...>
  <span>Keep open</span>
</label>
```

Add after the label (still inside `#actions-modal`):
```html
<span id="actions-mqtt-status" style="position:absolute; bottom:19px; right:24px; font-size:9px; font-family:'Courier New',monospace; color:rgba(248,113,113,0.5); pointer-events:none;">● MQTT</span>
```

It starts red (disconnected) and turns green when MQTT connects. `_updateMqttStatusIndicator()` handles the color updates.

### 6. Call `_updateMqttStatusIndicator()` when actions modal opens

In `openActionsModal()` in `actions.js`, after `modal.style.display = ''`, add:
```js
_updateMqttStatusIndicator();
```

This ensures the dot reflects the current connection state when the modal opens, not just on connection events.

---

## Testing Strategy

1. **Broker down at page load** — start kiosk without mosquitto running. Open actions modal — dot is red. Start mosquitto — within `_reconnectDelay` seconds the dot turns green.
2. **Backoff progression** — kill broker, observe console logs showing delays: 1s, 2s, 4s, 8s, 16s, 30s, 30s (capped).
3. **Reset on reconnect** — reconnect after a long backoff, confirm next disconnect starts at 1s again.
4. **Publish queue** — kill broker, press 3 action buttons (should queue; modal closes with error flash if keep-open off). Restart broker — console shows "flushed 3 queued publish(es)". MQTT test harness shows the 3 messages arrive.
5. **Queue cap** — disconnect, press >20 buttons. Queue stays at 20 items; oldest messages are dropped.
6. **Status dot** — open actions modal while disconnected → red. Reconnect → dot turns green without closing/reopening modal.
7. **Both MQTT paths** — test backoff for streams.json-configured MQTT and actions.json-configured MQTT separately.

---

## Acceptance Criteria

- [ ] Reconnection delays follow exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (cap)
- [ ] Delay resets to 1s after each successful connect
- [ ] Pressing action buttons while disconnected queues publishes (max 20)
- [ ] Queued publishes are flushed in order on next successful connect
- [ ] Actions modal footer shows `● MQTT` dot — green when connected, red when not
- [ ] Dot updates in real time (no modal re-open needed)
- [ ] Both `startMQTT` (streams.json) and `_startActionsMqtt` (actions.json) use backoff
- [ ] No log spam when broker is down for extended periods

## Validation Commands

```bash
# Watch reconnect logs with broker down
docker compose -f docker-compose.dev.yml stop mqtt
# Observe console in browser: should see delays doubling, not every 5s

# Start broker and watch queue flush
docker compose -f docker-compose.dev.yml start mqtt
# Console: "MQTT: flushed N queued publish(es)"
```

## Notes

- `_mqttPublishQueue`, `_mqttConnected`, and `_updateMqttStatusIndicator` live in `mqtt.js` and are shared with `actions.js` via global scope (all scripts are plain `<script>` tags, no ES modules)
- `reconnectPeriod: 0` disables MQTT.js's built-in reconnect; `client.reconnect()` is called manually by our scheduler
- The publish queue is intentionally not persisted to `localStorage` — stale queued actions from a previous session could cause unintended device state changes
- Queue cap of 20 is conservative; for 6-button action groups this is >3 full modal interactions worth of buffering
- The `close` event in MQTT.js fires after both clean disconnect and unexpected connection loss, making it the right hook for scheduling reconnects
