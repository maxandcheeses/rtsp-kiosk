# Plan: Action Toggle Type

> Status: `planned`
> Last updated: 2026-04-06

## Task Description

Add a `toggle` action type to the actions system. Unlike the existing `mqtt` type (which always publishes the same fixed payload), a `toggle` action alternates between two payloads (`payloadOn` / `payloadOff`) each time it is pressed. The button visually reflects the current on/off state — using a subscribed MQTT state topic when configured, or an in-memory per-action boolean as a fallback. The editor drawer in `actions-editor.js` must also support creating and editing toggle actions, showing two payload fields (ON and OFF) instead of one.

## Objective

Users can define toggle action buttons in `data/actions.json` and via the editor UI. Pressing a toggle button alternates the published payload and updates the button's `.on` CSS class immediately. State survives modal open/close. Existing `mqtt` type actions are fully backward-compatible.

## Problem Statement

The current action system only supports a one-shot `mqtt` type that always sends the same payload. There is no first-class way to model a stateful toggle (e.g., lights on/off) without creating two separate `mqtt` actions. Users want a single button that toggles device state and reflects that state visually.

## Solution Approach

### Schema extension

The `toggle` type reuses the existing `publish.topic` and optional `state` fields, but replaces `publish.payload` with `publish.payloadOn` and `publish.payloadOff`:

```json
{
  "id": "lights",
  "type": "toggle",
  "label": "Lights",
  "icon": "mdi:lightbulb",
  "publish": {
    "topic": "home/living/lights/set",
    "payloadOn": "ON",
    "payloadOff": "OFF"
  },
  "state": {
    "topic": "home/living/lights/state",
    "onValue": "ON"
  }
}
```

`state` remains optional. Existing `mqtt` type entries with `publish.payload` are untouched.

### State resolution (two-tier)

1. **With state topic** (`action.state.topic` configured): use `ACTION_STATES[action.state.topic] === action.state.onValue` — identical to how `mqtt` actions already determine `.on`. Updates automatically via MQTT subscription. Persists across modal open/close since `ACTION_STATES` is never cleared.

2. **Without state topic** (fallback): maintain a module-level `let _toggleStates = {}` map (`actionId → boolean`). After a successful publish, flip the boolean and call `_refreshActionButtons()` for an optimistic UI update. Resets on page reload (acceptable — actual device state is unknowable without a state topic after reload).

### `isDisabled` guard

The `isDisabled` condition in `_renderActionButtons` must include `toggle` alongside `mqtt` so that toggle buttons are disabled when MQTT is not connected.

### Payload validation guard in `pressAction`

Add an early return if `action.type === 'toggle'` and either `payloadOn` or `payloadOff` is missing, to avoid publishing undefined.

## Relevant Files

- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions.js` — runtime state and press logic
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions-editor.js` — editor drawer form and save logic
- `/Users/maxwell/Documents/development/rtsp-kiosk/data/actions.json` — action definitions (optional: add sample toggle)

## Implementation Phases

**Phase 1 — Runtime (`actions.js`):** Add `_toggleStates`, update `_renderActionButtons` and `pressAction` to handle the `toggle` type.

**Phase 2 — Editor (`actions-editor.js`):** Add `toggle` to the type `<select>`, add dynamic payload field visibility, update `saveAeActionDrawer` validation and publish block, update the table publish summary.

**Phase 3 — Validation:** Manual smoke test against a live MQTT broker; verify state persistence, optimistic toggle, and editor round-trip.

## Step by Step Tasks

### Phase 1 — `actions.js`

**Task 1.1 — Add `_toggleStates` module-level variable**

In `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions.js`, after the existing `let _actionUnsubscribers = [];` line, add:

```js
let _toggleStates = {};  // actionId → boolean; in-memory fallback when no state topic
```

**Task 1.2 — Update `isDisabled` in `_renderActionButtons`**

Find the line:
```js
const isDisabled = action.type === 'mqtt' && !_mqttConnected;
```
Replace with:
```js
const isDisabled = (action.type === 'mqtt' || action.type === 'toggle') && !_mqttConnected;
```

**Task 1.3 — Update `isOn` computation in `_renderActionButtons`**

Find the line:
```js
const isOn = action.state && ACTION_STATES[action.state.topic] === action.state.onValue;
```
Replace with:
```js
let isOn = false;
if (action.type === 'toggle') {
  if (action.state && action.state.topic && ACTION_STATES[action.state.topic] !== undefined) {
    isOn = ACTION_STATES[action.state.topic] === action.state.onValue;
  } else {
    isOn = _toggleStates[id] ?? false;
  }
} else {
  isOn = !!(action.state && ACTION_STATES[action.state.topic] === action.state.onValue);
}
```

**Task 1.4 — Update `pressAction` to resolve payload and handle toggle state**

In `pressAction`, after `if (!action || !action.publish) return;`, add a toggle-specific validation guard:
```js
if (action.type === 'toggle' && (!action.publish.payloadOn || !action.publish.payloadOff)) return;
```

Then, before the `mqttPublish` call, add payload resolution:
```js
let payload;
if (action.type === 'toggle') {
  let isOn = false;
  if (action.state && action.state.topic && ACTION_STATES[action.state.topic] !== undefined) {
    isOn = ACTION_STATES[action.state.topic] === action.state.onValue;
  } else {
    isOn = _toggleStates[actionId] ?? false;
  }
  payload = isOn ? action.publish.payloadOff : action.publish.payloadOn;
  // Optimistic in-memory state update (used when no state topic)
  _toggleStates[actionId] = !isOn;
  _refreshActionButtons();
} else {
  payload = action.publish.payload;
}
```

Replace the hardcoded `action.publish.payload` in the `mqttPublish` call with `payload`:
```js
const ok = mqttPublish(action.publish.topic, payload);
```

### Phase 2 — `actions-editor.js`

**Task 2.1 — Add `toggle` option to the type `<select>` and wire visibility toggle**

In `_buildAeActionDrawerForm`, locate the type `<select>` element (around line 224). Add the `toggle` option and an `onchange` handler that toggles visibility of the single-payload row vs. the two-payload rows:

```html
<select class="views-input" id="ae-field-type" style="flex:none;width:auto"
  onchange="document.getElementById('ae-mqtt-payload-row').style.display=this.value==='toggle'?'none':'';document.getElementById('ae-toggle-payload-rows').style.display=this.value==='toggle'?'':'none'">
  <option value="mqtt"${type === 'mqtt' ? ' selected' : ''}>mqtt</option>
  <option value="toggle"${type === 'toggle' ? ' selected' : ''}>toggle</option>
</select>
```

**Task 2.2 — Add `pPayOn` / `pPayOff` variable extraction**

In `_buildAeActionDrawerForm`, after the existing `const pPay = ...` line, add:
```js
const pPayOn  = (action.publish && action.publish.payloadOn)  || '';
const pPayOff = (action.publish && action.publish.payloadOff) || '';
```

**Task 2.3 — Replace the single Payload row with conditional rows**

Replace the existing single Payload `<div class="views-form-row">` block (around lines 245–251) with:

```html
<!-- mqtt payload (hidden for toggle) -->
<div class="views-form-row" id="ae-mqtt-payload-row" style="${type === 'toggle' ? 'display:none' : ''}">
  <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Payload</label>
  <div style="flex:1;display:flex;flex-direction:column;gap:4px">
    <input class="views-input" id="ae-field-publish-payload" value="${_aeEsc(pPay)}" placeholder="ON">
    <div class="cam-field-error" id="ae-err-publish-payload"></div>
  </div>
</div>
<!-- toggle payloads (hidden for mqtt) -->
<div id="ae-toggle-payload-rows" style="${type !== 'toggle' ? 'display:none' : ''}">
  <div class="views-form-row">
    <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Payload ON</label>
    <div style="flex:1;display:flex;flex-direction:column;gap:4px">
      <input class="views-input" id="ae-field-publish-payloadOn" value="${_aeEsc(pPayOn)}" placeholder="ON">
      <div class="cam-field-error" id="ae-err-publish-payloadOn"></div>
    </div>
  </div>
  <div class="views-form-row">
    <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Payload OFF</label>
    <div style="flex:1;display:flex;flex-direction:column;gap:4px">
      <input class="views-input" id="ae-field-publish-payloadOff" value="${_aeEsc(pPayOff)}" placeholder="OFF">
      <div class="cam-field-error" id="ae-err-publish-payloadOff"></div>
    </div>
  </div>
</div>
```

**Task 2.4 — Update `saveAeActionDrawer` payload validation and publish object**

In `saveAeActionDrawer`, replace the hardcoded `ppEl`/`pPayload` variable read and its validation block with type-conditional logic:

```js
let publish;
const type = (document.getElementById('ae-field-type') || {}).value || 'mqtt';

if (type === 'toggle') {
  const payloadOn  = (document.getElementById('ae-field-publish-payloadOn')  || {}).value?.trim() || '';
  const payloadOff = (document.getElementById('ae-field-publish-payloadOff') || {}).value?.trim() || '';
  if (!payloadOn) {
    const errOn = document.getElementById('ae-err-publish-payloadOn');
    if (errOn) errOn.textContent = 'Payload ON is required';
    valid = false;
  }
  if (!payloadOff) {
    const errOff = document.getElementById('ae-err-publish-payloadOff');
    if (errOff) errOff.textContent = 'Payload OFF is required';
    valid = false;
  }
  if (valid && pTopic) publish = { topic: pTopic, payloadOn, payloadOff };
} else {
  const pPayload = (document.getElementById('ae-field-publish-payload') || {}).value?.trim() || '';
  const errPP = document.getElementById('ae-err-publish-payload');
  if (!pPayload) {
    if (errPP) errPP.textContent = 'Publish payload is required';
    valid = false;
  } else {
    if (errPP) errPP.textContent = '';
    publish = { topic: pTopic, payload: pPayload };
  }
}
```

Then update the `updated` object to use `publish` variable instead of the inline `{ topic: pTopic, payload: pPayload }`.

Note: the existing `type` variable read near line 311 (`const type = ...`) must not be duplicated — hoist it above the validation block or consolidate.

**Task 2.5 — Update the table publish summary**

Find the line (around line 164):
```js
const publishSummary = action.publish ? `${_aeEsc(action.publish.topic)} → ${_aeEsc(action.publish.payload)}` : '—';
```
Replace with:
```js
const publishSummary = action.publish
  ? action.type === 'toggle'
    ? `${_aeEsc(action.publish.topic)} → ${_aeEsc(action.publish.payloadOn)}|${_aeEsc(action.publish.payloadOff)}`
    : `${_aeEsc(action.publish.topic)} → ${_aeEsc(action.publish.payload)}`
  : '—';
```

### Phase 3 — Sample data (optional)

**Task 3.1 — Add a sample toggle action to `data/actions.json`**

Add one toggle-type entry to the `actions` array to demonstrate the new schema:
```json
{
  "id": "lights",
  "type": "toggle",
  "label": "Lights",
  "icon": "mdi:lightbulb",
  "publish": {
    "topic": "home/living/lights/set",
    "payloadOn": "ON",
    "payloadOff": "OFF"
  },
  "state": {
    "topic": "home/living/lights/state",
    "onValue": "ON"
  }
}
```

## Testing Strategy

### State topic path (with MQTT broker)
1. Configure a toggle action with `state.topic` pointing to a real or test MQTT topic.
2. Press the button → verify the correct payload (ON or OFF) is published.
3. Simulate an incoming MQTT message on the state topic → verify the `.on` class updates.
4. Close and reopen the actions modal → verify state is preserved (via `ACTION_STATES`).

### Fallback path (no state topic)
1. Configure a toggle action with no `state` field.
2. Press the button → verify `payloadOn` is published (initial state is off).
3. Press again → verify `payloadOff` is published.
4. Close and reopen the modal → verify the in-memory state is preserved.
5. Reload the page → verify state resets to off (acceptable).

### Editor round-trip
1. Open the actions editor, create a new `toggle` action.
2. Verify Payload ON and Payload OFF fields appear; Payload field is hidden.
3. Switch type back to `mqtt` → verify single Payload field reappears.
4. Save the toggle action → verify it appears in the table with `topic → ON|OFF` summary.
5. Reopen the drawer → verify both payload values are pre-populated.
6. Save and persist to server → reload actions → verify the toggle action loads correctly.

### Backward compatibility
1. Verify existing `mqtt` type actions still work correctly — no regression in `pressAction` or `_renderActionButtons`.

## Acceptance Criteria

- [ ] A `toggle` type action can be defined in `data/actions.json` with `publish.payloadOn` and `publish.payloadOff`.
- [ ] Pressing a toggle button publishes `payloadOn` when state is off, `payloadOff` when state is on.
- [ ] The button receives the `.on` CSS class when state is on (via state topic subscription or in-memory fallback).
- [ ] Without a state topic, pressing the button optimistically flips the `.on` class immediately.
- [ ] State persists across actions modal open/close without page reload.
- [ ] Toggle buttons are disabled (`.disabled`) when MQTT is not connected, identical to `mqtt` type.
- [ ] A toggle action with missing `payloadOn` or `payloadOff` is silently rejected in `pressAction`.
- [ ] Existing `mqtt` type actions are fully backward-compatible — no behavioral changes.
- [ ] The actions editor shows Payload ON / Payload OFF fields for `toggle` type and hides the single Payload field.
- [ ] The actions editor shows the single Payload field for `mqtt` type and hides the toggle fields.
- [ ] Switching the type `<select>` in the editor dynamically shows/hides the correct fields without a page reload.
- [ ] `saveAeActionDrawer` validates both `payloadOn` and `payloadOff` as required for toggle type.
- [ ] The table publish summary for toggle actions shows `topic → ON|OFF` format.
- [ ] The editor saves and reloads toggle actions correctly, pre-populating both payload fields.

## Validation Commands

```sh
# Start the dev compose stack
docker compose -f docker-compose.dev.yml up

# Open browser at http://localhost:8080
# Manually verify toggle button behavior and editor UI

# Check that existing mqtt actions still work — no JS errors in console
```

## Notes

- The `_toggleStates` fallback does not persist across page reloads by design. Persisting it to `localStorage` would be incorrect without a state topic because the actual device state after a reload is unknown.
- The `onchange` handler on the type `<select>` is inline JavaScript in a template literal. This is consistent with the existing pattern in `actions-editor.js` (see the icon `oninput` handler). No refactor needed.
- The `type` variable in `saveAeActionDrawer` is already read near line 311. Task 2.4 must ensure it is not read twice — either hoist the existing read or remove the duplicate.
- If a toggle action has a state topic but the topic has never received a message (`ACTION_STATES[topic] === undefined`), the fallback `_toggleStates` path is used. This is intentional — it prevents a stale-undefined comparison from misreporting state.
- No CSS changes are required — `.action-btn.on` already exists and applies the active visual state.
