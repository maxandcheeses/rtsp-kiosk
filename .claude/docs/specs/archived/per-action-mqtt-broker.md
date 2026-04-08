# Plan: Per-Action MQTT Broker Configuration

> Status: `archived`
> Last updated: 2026-04-06
> **Superseded by:** `actions-settings-editor.md` — the multi-server MQTT design (named server list + `mqttServer` reference on each action) replaces the inline per-action broker approach described here.

## Task Description
Add a "Use global MQTT server" checkbox to each action in the actions editor UI. When unchecked, the user can configure a custom MQTT broker (URL, optional username/password) for that specific action. The per-action broker is used at runtime when publishing or subscribing to that action's topics.

## Objective
Users can configure a separate MQTT broker per action. The actions editor modal (new) exposes a "Use global MQTT server" toggle per action. If toggled off, broker/username/password fields appear. At runtime, `actions.js` maintains a pool of MQTT clients keyed by broker URL and routes each publish/subscribe to the right client.

## Problem Statement
Currently all actions share a single global MQTT broker. Users with devices spread across multiple brokers (e.g. Home Assistant and a separate broker for door lock) cannot route individual actions to different servers without maintaining separate `actions.json` files.

## Solution Approach
1. Extend the `actions.json` schema so each action may carry an optional `mqtt: { broker, username, password }` block.
2. Add `/api/actions` (GET + PUT) to `streams-api/server.js` backed by `/data/actions.json`.
3. Update `nginx.conf` to proxy `/api/actions` and serve `/actions.json` from the data volume (not a static alias).
4. Build a new `actions-editor.js` + modal HTML that lists actions with the MQTT toggle + conditional broker fields.
5. Add an "A → Actions" shortcut to the settings modal.
6. Update `actions.js` runtime to maintain an MQTT client pool, routing per-action publishes and state subscriptions to the correct client.

## Relevant Files

- `data/actions.json` — schema change: each action gains optional `mqtt: { broker, username, password }`
- `streams-api/server.js` — add `/api/actions` GET + PUT endpoint, add `ACTIONS_FILE` env var
- `nginx.conf` — proxy `/api/actions` to streams-api; change `/actions.json` static alias to proxy or data-volume path
- `www/js/actions.js` — runtime: MQTT client pool, per-action routing
- `www/js/actions-editor.js` — new file: editor modal logic
- `www/index.html` — new actions editor modal HTML, settings shortcut row

### New Files
- `www/js/actions-editor.js` — all editor state, render, save logic

## Implementation Phases

### Phase 1: Foundation — Data + API
Make `actions.json` writable via API and update its schema.

### Phase 2: Core Implementation — Editor UI
Build the actions editor modal with per-action MQTT toggle.

### Phase 3: Integration & Polish — Runtime routing
Update `actions.js` to use per-action MQTT clients.

## Step by Step Tasks

### 1. Extend actions.json schema
- Add an optional `mqtt` object to actions that need a custom broker:
  ```json
  {
    "id": "lock-door",
    ...
    "mqtt": {
      "broker": "ws://other-host:9001",
      "username": "",
      "password": ""
    }
  }
  ```
- Absence of `action.mqtt` (or `action.mqtt === null`) means "use global broker"
- No schema file to update — this is additive and backward-compatible

### 2. Add /api/actions to streams-api/server.js
- Add `const ACTIONS_FILE = process.env.ACTIONS_FILE || '/data/actions.json';`
- Add `readActions()` and `writeActions()` helpers (same pattern as streams)
- Handle `GET /api/actions` → return full actions.json content
- Handle `PUT /api/actions` → accept `{ mqtt, actions, groups }` body, write to file, respond `{ ok: true }`
- No MediaMTX sync needed for actions
- Log `ACTIONS_FILE` in the startup banner

### 3. Update nginx.conf
- Remove the static alias block for `/actions.json`:
  ```nginx
  location = /actions.json {
      alias /usr/share/nginx/html/actions.json;
      add_header Cache-Control "no-store, must-revalidate";
  }
  ```
- Replace with a proxy to `/api/actions` so the same data volume file is served at both URLs:
  ```nginx
  location = /actions.json {
      set $streams_api http://streams-api:9998;
      proxy_pass $streams_api/api/actions;
      proxy_set_header Host $host;
      add_header Cache-Control "no-store, must-revalidate";
  }

  location /api/actions {
      set $streams_api http://streams-api:9998;
      proxy_pass $streams_api/api/actions;
      proxy_set_header Host $host;
      proxy_read_timeout 10s;
  }
  ```
- **Note**: `actions.json` must be moved from `www/` (static Nginx HTML dir) to the `data/` volume. Update `docker-compose.yml` volume mount if `actions.json` is currently only in `www/`. Verify where it's mounted.

### 4. Update docker-compose.yml (if needed)
- Confirm `data/actions.json` is mounted into `streams-api` container at `/data/actions.json`
- Add `ACTIONS_FILE=/data/actions.json` env var to streams-api service if the data volume isn't already shared
- If `www/actions.json` exists as the canonical file, move it to `data/actions.json` and update mounts

### 5. Update actions.js — MQTT client pool
- Add `_actionsMqttPool = new Map()` — key: broker URL string, value: mqtt client
- Add `_getActionsMqttClient(mqttCfg)`:
  - If `mqttCfg` matches global broker (or is null), return `_mqttClient`
  - Otherwise look up in `_actionsMqttPool`; if not found, create a new connection and store it
  - Return the client (may not be connected yet — queue publishes or use existing `_extraSubscriptions` pattern)
- Update `pressAction(actionId)`:
  - If `action.mqtt` is set, use `_getActionsMqttClient(action.mqtt)` to publish
  - Otherwise use existing `mqttPublish()`
- Update `loadActionsConfig()` state subscription setup:
  - For each state topic, look up the action's mqtt config
  - If custom, subscribe via that action's client; otherwise use global `mqttSubscribe()`
- When a per-action client connects, replay any pending subscriptions for that broker

### 6. Create www/js/actions-editor.js
Build following the camera-editor.js pattern:

**State variables:**
```js
let AE_CONFIG = null;       // full actions.json in memory (loaded from API)
let AE_ORIG   = null;       // original for dirty check
let AE_UNSAVED = false;
```

**`openActionsEditor()`:**
- Close all other modals
- Show `#actions-editor-modal`
- `loadActionsEditorConfig()` — fetch `/api/actions`, store to `AE_CONFIG`/`AE_ORIG`
- Render action rows

**`_renderActionsEditorList()`:**
- For each action, render a card/row with:
  - Label + icon (read-only display)
  - "Use global MQTT server" checkbox: checked when `!action.mqtt`
  - If unchecked: reveal broker URL input, optional username/password inputs
  - onchange of checkbox: toggle visibility of broker fields
- Global broker settings at the top (broker, username, password — always editable)

**`saveActionsEditor()`:**
- Collect `AE_CONFIG.mqtt` from global MQTT fields
- For each action row: if "use global" checked → set `action.mqtt = undefined`; else collect broker/user/pass
- `PUT /api/actions` with the assembled config
- Show success/error banner

**`closeActionsEditor()`:**
- If `AE_UNSAVED`, show confirm dialog
- Hide modal

### 7. Add actions editor modal HTML to index.html
Insert before the closing `</body>` tag, following the cameras-modal structure:

```html
<!-- Actions editor modal -->
<div id="actions-editor-modal" class="modal" style="justify-content:flex-start;padding:48px;overflow-y:auto;">
  <button class="modal-close-btn" onclick="closeActionsEditor()">✕</button>
  <h1>Actions</h1>
  <!-- Global MQTT section -->
  <div class="perf-section">
    <div class="perf-section-title">Global MQTT Broker</div>
    <div id="ae-global-mqtt"></div>
  </div>
  <!-- Actions list -->
  <div id="ae-actions-list"></div>
  <!-- Unsaved banner -->
  <div id="ae-banner" style="display:none;" class="cam-banner">
    <span id="ae-banner-text"></span>
    <button id="ae-apply-btn" class="cam-apply-btn" onclick="saveActionsEditor()">Apply Changes</button>
  </div>
</div>
```

Add script tag:
```html
<script src="/js/actions-editor.js"></script>
```

### 8. Add "Actions" to settings modal
In `index.html`, add after the cameras shortcut row:
```html
<div class="shortcut-row">
  <button class="shortcut-key" onclick="openFromSettings('actions')" title="Open actions editor">A</button>
  <span>Actions</span>
</div>
```

Update `openFromSettings()` in `ui.js` to handle `'actions'`:
```js
if (type === 'actions') openActionsEditor();
```

Also add keyboard shortcut handler: `'a'` → `openActionsEditor()` (alongside existing `'c'` for cameras, `'v'` for views).

### 9. Validate
- Open settings → press A → actions editor opens
- Change global broker → save → reload page → verify `/actions.json` reflects change
- Uncheck "Use global MQTT server" on an action → broker fields appear → enter a URL → save
- Verify `data/actions.json` contains `"mqtt": { "broker": "...", ... }` on that action
- Check browser console: action with custom broker creates a separate MQTT connection
- Check action with default broker still publishes via global client

## Testing Strategy
- **Manual (primary)**: Open the new Actions editor from settings, toggle per-action MQTT on one action, save, reload, verify JSON and runtime behavior.
- **Edge cases**:
  - Action with custom broker that is unreachable → publish fails gracefully (same red flash + modal close behavior as global MQTT failure)
  - Two actions with the same custom broker URL → only one MQTT client is created (pool reuse)
  - Unchecking "use global" then rechecking → `action.mqtt` removed from saved JSON
  - `actions.json` not accessible (file missing) → editor shows error state, falls back gracefully

## Acceptance Criteria
- [ ] Actions editor modal opens from settings (A shortcut)
- [ ] Each action row has a "Use global MQTT server" toggle
- [ ] When toggled off, broker URL + username + password fields appear
- [ ] When toggled back on, custom fields hide and `action.mqtt` is removed on save
- [ ] Saving writes to `/data/actions.json` via `PUT /api/actions`
- [ ] `/actions.json` (Nginx) serves the same file (proxied from streams-api)
- [ ] At runtime, actions with `action.mqtt` publish/subscribe via a dedicated MQTT client
- [ ] Two actions sharing the same custom broker URL share one MQTT client (pool reuse)
- [ ] Actions without `action.mqtt` continue using the global MQTT client unchanged

## Validation Commands
```bash
# Verify streams-api responds to GET /api/actions
curl http://localhost/api/actions | jq .

# Verify /actions.json still works (proxied)
curl http://localhost/actions.json | jq .

# After saving a per-action broker, verify JSON on disk
docker compose exec streams-api cat /data/actions.json | jq '.actions[] | {id, mqtt}'

# Check that streams-api started with ACTIONS_FILE set
docker compose logs streams-api | grep ACTIONS_FILE
```

## Notes
- The `actions.json` file is currently served as a static file from the Nginx HTML directory (`www/actions.json` mounted to `/usr/share/nginx/html/actions.json`). Check `docker-compose.yml` to confirm the mount — if `actions.json` is only in `www/`, it needs to be moved to `data/` and both the Nginx and streams-api volume mounts updated.
- Per-action MQTT clients use the same reconnect/error handling pattern as `_startActionsMqtt()` in `actions.js`. Refactor `_startActionsMqtt()` to accept a `poolKey` and store in `_actionsMqttPool` rather than duplicating connection logic.
- Username/password fields for per-action MQTT should be `type="password"` with a show/hide toggle, consistent with how any future credential inputs are handled.
- The global MQTT settings displayed in the actions editor (top section) edit `actions.json`'s `mqtt` block — **not** `streams.json`'s MQTT config. These are separate.
