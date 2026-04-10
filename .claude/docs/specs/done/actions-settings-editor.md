# Plan: Actions Settings Editor

> Status: `planned`
> Last updated: 2026-04-06

## Task Description

Add a browser-based editor for `data/actions.json` — the actions registry that drives Panel Actions Modal buttons. Operators can manage a list of named MQTT servers, add/edit/delete actions (each referencing one of those servers), and manage action groups without SSH or manual file editing. The editor follows the same patterns as the cameras editor (`#cameras-modal`) and views editor (`#views-modal`): full-screen modal, tabbed sections, local-edit + apply flow, unsaved changes banner.

## Objective

When complete, pressing `A` or clicking "Actions" in the settings modal opens `#actions-settings-modal` with three tabs:
- **MQTT** — a list of named MQTT server configurations (id, broker URL, username, password). Operators can add, edit, and delete servers.
- **Actions** — CRUD table with drag-to-reorder for individual action definitions. Each action specifies a `type` (currently only `"mqtt"`) and a `mqttServer` reference (id of a server in the MQTT tab).
- **Groups** — CRUD table for action groups (ordered sets of up to 6 actions)

Changes are staged in memory and persisted via a new `PUT /api/actions` endpoint in `streams-api`. On apply, the kiosk hot-reloads its in-memory actions config without a page refresh.

## Problem Statement

`actions.json` is currently edited by hand on the filesystem. Adding a new action or changing a MQTT topic requires SSH access and a container restart. There is no in-browser editor (unlike streams and views which both have editors). This creates a gap: operators can configure views and cameras from the kiosk UI but must use the CLI to configure the action buttons those views expose.

## Solution Approach

1. **Schema** — `mqtt` in `actions.json` becomes a `servers` array; each action gains `type` and `mqttServer` fields.

2. **Backend** — extend `streams-api/server.js` with `GET /actions` and `PUT /actions` routes that read/write `data/actions.json`. Expose via nginx at `/api/actions`. Mount `data/actions.json` into the `streams-api` container (currently only nginx has this mount).

3. **Frontend** — new `www/js/actions-editor.js` with all editor logic. New `#actions-settings-modal` HTML skeleton in `index.html`. Tabs rendered by JS (no separate HTML per tab — same pattern as the cameras modal renders its table dynamically).

4. **Hot-reload** — after `PUT /api/actions` succeeds, call `loadActionsConfig()` which re-evaluates which MQTT servers are needed for the currently displayed panel's group and connects/disconnects accordingly.

5. **Connection lifecycle** — MQTT clients connect lazily, only for servers referenced by actions in the currently displayed panel's group. On panel change (view switch), re-evaluate needed servers and connect/disconnect.

6. **Keyboard shortcut** — `A` key, consistent with existing single-letter shortcuts.

---

## Schema

`data/actions.json` shape after this change:

```json
{
  "mqtt": {
    "servers": [
      { "id": "home", "broker": "ws://localhost:9001", "username": "", "password": "" }
    ]
  },
  "actions": [
    {
      "id": "lights-on",
      "type": "mqtt",
      "mqttServer": "home",
      "label": "Lights On",
      "icon": "mdi-lightbulb",
      "publish": { "topic": "home/lights", "payload": "ON" },
      "state": { "topic": "home/lights/state", "onValue": "ON" }
    }
  ],
  "groups": [
    { "id": "living-room", "name": "Living Room", "actions": ["lights-on"] }
  ]
}
```

**Field rules:**
- `type` — string, required on every action. Currently only `"mqtt"`. Extensible in future.
- `mqttServer` — string (server `id`), required when `type === "mqtt"`. Omitted or null for non-MQTT types.
- Actions without a matched server (server id not found in `mqtt.servers`, or `mqttServer` unset) render as disabled buttons in the panel actions modal.

---

## Relevant Files

- `/Users/maxwell/Documents/development/rtsp-kiosk/streams-api/server.js` — add `GET /actions` and `PUT /actions` routes; add `ACTIONS_FILE` env var
- `/Users/maxwell/Documents/development/rtsp-kiosk/nginx.conf` — add `location /api/actions` proxy block
- `/Users/maxwell/Documents/development/rtsp-kiosk/docker-compose.yml` — mount `./data/actions.json` into `streams-api` service; add `ACTIONS_FILE` env var
- `/Users/maxwell/Documents/development/rtsp-kiosk/docker-compose.dev.yml` — same mounts + bind-mount `actions-editor.js` for nginx
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/mqtt.js` — refactor `mqttSubscribe()` to return an unsubscribe function; support multiple named clients
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions.js` — update `loadActionsConfig()` to handle `servers` array; add lazy connect/disconnect per panel; track unsubscribers
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/index.html` — add `#actions-settings-modal` HTML, CSS, `A` shortcut row in settings, script tag
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/ui.js` — add `A` keyboard shortcut; add modal to `closeAllModals()` and `anyOpen` check; add `'actions-settings'` case in `openFromSettings()`
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/boot.js` — add `'actions-settings-modal'` to backdrop-click array
- `/Users/maxwell/Documents/development/rtsp-kiosk/data/actions.json` — update sample data to new schema

### New Files
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions-editor.js` — all editor logic (load, render, CRUD, save)

---

## Implementation Phases

### Phase 1: Backend API + Schema
Update `data/actions.json` to new schema and extend streams-api and nginx so `/api/actions` is readable and writable from the browser.

### Phase 2: MQTT runtime refactor
Update `mqtt.js` and `actions.js` to support multiple named MQTT server clients with lazy connect/disconnect per panel.

### Phase 3: Editor UI
Build the modal, three tabs, edit drawers, and unsaved changes banner.

### Phase 4: Integration
Wire up keyboard shortcut, settings modal entry, boot hooks, and dev compose mounts.

---

## Step by Step Tasks

### 1. Update `data/actions.json` to new schema

Migrate the existing sample data to the new shape:
```json
{
  "mqtt": {
    "servers": [
      { "id": "home", "broker": "ws://localhost:9001", "username": "", "password": "" }
    ]
  },
  "actions": [
    {
      "id": "lights-on",
      "type": "mqtt",
      "mqttServer": "home",
      "label": "Lights On",
      "icon": "mdi-lightbulb",
      "publish": { "topic": "home/lights", "payload": "ON" },
      "state": { "topic": "home/lights/state", "onValue": "ON" }
    }
  ],
  "groups": [
    { "id": "living-room", "name": "Living Room", "actions": ["lights-on"] }
  ]
}
```

All existing actions must gain `"type": "mqtt"` and a `"mqttServer"` field pointing to the server id.

### 2. Extend `streams-api/server.js` with actions routes

Add near the top, after `VIEWS_FILE`:
```js
const ACTIONS_FILE = process.env.ACTIONS_FILE || '/data/actions.json';

function readActions() {
  return JSON.parse(fs.readFileSync(ACTIONS_FILE, 'utf8'));
}

function writeActions(data) {
  fs.writeFileSync(ACTIONS_FILE, JSON.stringify(data, null, 2));
}
```

Add a new route block inside the request handler, after the existing `'/'` block:

```js
if (url.pathname === '/actions') {
  if (req.method === 'GET') {
    try {
      send(res, 200, readActions());
    } catch(e) {
      send(res, 500, { error: `Failed to read actions: ${e.message}` });
    }
    return;
  }
  if (req.method === 'PUT') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      // Validate minimal shape
      if (!body || typeof body !== 'object' || !Array.isArray(body.actions) || !Array.isArray(body.groups)) {
        send(res, 400, { error: 'Body must be { mqtt?, actions, groups }' });
        return;
      }
      writeActions(body);
      send(res, 200, { ok: true });
    } catch(e) {
      send(res, 400, { error: `Invalid request: ${e.message}` });
    }
    return;
  }
}
```

No additional server-side validation of `mqtt.servers` is needed — keep it minimal.

### 3. Update `nginx.conf`

Add after the `/api/streams` block:
```nginx
location /api/actions {
    set $streams_api http://streams-api:9998;
    proxy_pass $streams_api/actions;
    proxy_set_header Host $host;
    proxy_read_timeout 10s;
}
```

### 4. Update `docker-compose.yml` and `docker-compose.dev.yml`

**`streams-api` service** — add environment var:
```yaml
environment:
  - ACTIONS_FILE=/data/actions.json   # add alongside existing env vars
```

(The `data/` directory is already mounted into `streams-api` — no new volume needed, just the env var.)

**`docker-compose.dev.yml` nginx volumes** — add:
```yaml
- ./www/js/actions-editor.js:/usr/share/nginx/html/js/actions-editor.js:ro
```

### 5. Refactor `mqtt.js` — multi-client support + `mqttSubscribe` returns unsubscribe fn

Add a named-client pool so `actions.js` can maintain separate MQTT connections per server:

```js
// Map of server id → mqtt client
const _mqttClients = new Map();

function getOrCreateMqttClient(serverId, serverCfg) {
  if (_mqttClients.has(serverId)) return _mqttClients.get(serverId);
  const client = mqtt.connect(serverCfg.broker, {
    username: serverCfg.username || undefined,
    password: serverCfg.password || undefined,
    reconnectPeriod: 0   // managed externally
  });
  _mqttClients.set(serverId, client);
  return client;
}

function disconnectMqttClient(serverId) {
  const client = _mqttClients.get(serverId);
  if (client) { client.end(true); _mqttClients.delete(serverId); }
}
```

Change `mqttSubscribe` to return a cleanup function (backward-compatible — callers that ignore the return value are unaffected):

```js
function mqttSubscribe(topic, callback) {
  const entry = { topic, callback };
  _extraSubscriptions.push(entry);
  if (_mqttClient && _mqttClient.connected) {
    _mqttClient.subscribe(topic, { qos: 1 });
  }
  return function unsubscribe() {
    const idx = _extraSubscriptions.indexOf(entry);
    if (idx >= 0) _extraSubscriptions.splice(idx, 1);
    // Intentionally does NOT call _mqttClient.unsubscribe —
    // suppressing at the callback level is sufficient.
  };
}
```

### 6. Update `actions.js` — multi-server lazy connect/disconnect, unsubscribers

**Module-level additions:**
```js
let _actionUnsubscribers = [];
let _connectedServerIds = new Set();
```

**`loadActionsConfig()`** — at the very start, clean up old subscriptions and disconnect unused servers:
```js
async function loadActionsConfig() {
  _actionUnsubscribers.forEach(fn => fn());
  _actionUnsubscribers = [];

  ACTIONS       = {};
  ACTION_GROUPS = {};
  // Keep ACTION_STATES — values remain valid if topics haven't changed

  try {
    const data = await fetch('/actions.json').then(r => r.json());
    // ... parse actions and groups as before ...
    // ... subscribe state topics, push unsubscribe fns to _actionUnsubscribers ...
  } catch(e) { ... }
}
```

**`_connectServersForGroup(groupId)`** — new function called on panel switch:
```js
function _connectServersForGroup(groupId) {
  const group = ACTION_GROUPS[groupId];
  if (!group) return;

  // Determine which server ids are needed
  const needed = new Set();
  group.actions.forEach(actionId => {
    const action = ACTIONS[actionId];
    if (action && action.type === 'mqtt' && action.mqttServer) {
      needed.add(action.mqttServer);
    }
  });

  // Disconnect servers no longer needed
  _connectedServerIds.forEach(id => {
    if (!needed.has(id)) {
      disconnectMqttClient(id);
      _connectedServerIds.delete(id);
    }
  });

  // Connect newly needed servers
  const servers = (_actionsConfig.mqtt && _actionsConfig.mqtt.servers) || [];
  needed.forEach(id => {
    if (!_connectedServerIds.has(id)) {
      const cfg = servers.find(s => s.id === id);
      if (cfg) {
        getOrCreateMqttClient(id, cfg);
        _connectedServerIds.add(id);
      }
    }
  });
}
```

Call `_connectServersForGroup(groupId)` wherever the displayed panel's group changes (view switch, initial load).

**Disabled button handling** — in the panel actions modal render, if `action.mqttServer` is missing or not found in `mqtt.servers`, render the button with a `disabled` attribute and a dimmed style.

### 7. Create `www/js/actions-editor.js`

Module-level state:
```js
let AE_FULL  = null;  // { mqtt, actions, groups } — loaded from API
let AE_LOCAL = null;  // working copy — mutated by editor
let AE_UNSAVED = false;
let AE_TAB   = 'mqtt';   // 'mqtt' | 'actions' | 'groups'
let AE_OPEN_DRAWER = null; // server id, action id, or group id of open drawer
```

**Functions to implement:**

`openActionsSettingsModal()`:
- Call `closeAllModals()`
- Add `open` class to `#actions-settings-modal`
- Call `loadActionsEditorData()`

`loadActionsEditorData()`:
- Render loading state
- `GET /api/actions`
- On success: `AE_FULL = data; AE_LOCAL = deepClone(data); AE_UNSAVED = false;`
- On error (404 / network): show API-unavailable notice (same pattern as cameras editor)
- Normalise: if `AE_LOCAL.mqtt` is missing or lacks `servers`, initialise `AE_LOCAL.mqtt = { servers: [] }`
- Call `renderActionsEditor()`

`renderActionsEditor()`:
- Renders tab nav (MQTT / Actions / Groups buttons)
- Renders active tab content
- Renders unsaved banner (if `AE_UNSAVED`)

`switchAeTab(tab)`:
- `AE_TAB = tab; AE_OPEN_DRAWER = null; renderActionsEditor();`

---

**Tab: MQTT** (`renderAeMqttTab()`):

Server list table with columns: drag handle | ID | Broker | edit/delete buttons.

Each row `id="ae-srv-row-{id}"`. Clicking row or edit button opens an edit drawer inline (accordion-below-row pattern, same as cameras editor).

Edit drawer fields per server:
- `id` — text, auto-generated slug on add (e.g. `server-1`), user-editable. Slug validation `/^[a-z0-9-]+$/`, required.
- `broker` — text, required (e.g. `ws://localhost:9001`)
- `username` — text, optional
- `password` — input type=password, optional

Footer: Cancel | Save.

`saveAeServerDrawer(originalId, isNew)`:
- Validate `id` (slug) and `broker` required
- Duplicate server id check: if `id` collides with another server → inline error "ID already exists"
- If `id` changed (rename), cascade-update all `action.mqttServer` references across `AE_LOCAL.actions` that match `originalId` (same cascade pattern as action id rename in groups)
- Merge into `AE_LOCAL.mqtt.servers`
- Call `markAeUnsaved()`, re-render

`deleteAeServer(id)`:
- Show inline confirmation row
- On confirm: remove from `AE_LOCAL.mqtt.servers`
- Re-render Actions tab will show orphaned `mqttServer` references — leave as-is (user must fix or actions will render disabled at runtime)
- Mark unsaved, re-render

`addAeServer()`:
- Generate placeholder id (`server-1`, incrementing)
- Push blank server to `AE_LOCAL.mqtt.servers`
- Re-render, open drawer for new entry

"+ Add Server" button at bottom of server list.

---

**Tab: Actions** (`renderAeActionsTab()`):

Table with columns: drag-handle | ID | Label | Type | Server | Icon | edit/delete buttons.

Each row `id="ae-action-row-{id}"`. Clicking row or edit button opens edit drawer.

Edit drawer fields:
- `id` — text, slug validation (`/^[a-z0-9-]+$/`), required, editable
- `label` — text, required
- `type` — dropdown, currently only option is `"mqtt"`. Default to `"mqtt"` for new actions. (Extensible in future — render a `<select>` even though there is only one option now.)
- `mqttServer` — dropdown, populated from `AE_LOCAL.mqtt.servers` (show server `id` values). Required when `type === "mqtt"`. If no servers exist, show disabled dropdown with placeholder "No servers configured". Show inline validation error "Server is required for MQTT actions" if empty on save.
- `icon` — text, with live icon preview span next to it (render `_renderIcon(value)` inline as a preview)
- **Publish section** (sub-heading):
  - `publish.topic` — text, required
  - `publish.payload` — text, required
- **State section** (optional — toggle to show/hide):
  - `state.topic` — text
  - `state.onValue` — text, hint: "payload string that means ON, e.g. ON"

Footer: Cancel | Save.

`saveAeActionDrawer(originalId, isNew)`:
- Validate required fields (id, label, publish.topic, publish.payload)
- Slug check on id
- Duplicate id check
- If `type === "mqtt"` and `mqttServer` is empty → inline error "Server is required for MQTT actions"
- Merge into `AE_LOCAL.actions`
- If id changed, update references in all groups (`AE_LOCAL.groups`) — same cascade pattern as action id rename in groups
- Call `markAeUnsaved()`, re-render

`deleteAeAction(id)`:
- Show inline confirmation row
- On confirm: remove from `AE_LOCAL.actions`; remove from any group's `actions` arrays
- Mark unsaved, re-render

`addAeAction()`:
- Generate placeholder id (`new-action-1`, incrementing)
- Push blank action to `AE_LOCAL.actions` with `type: "mqtt"`, `mqttServer: ""` (first server id if available)
- Re-render, open drawer for new entry

---

**Tab: Groups** (`renderAeGroupsTab()`):

Table with columns: drag-handle | ID | Name | Action count | edit/delete buttons.

Edit drawer fields:
- `id` — text, slug validation, required
- `name` — text, required
- **Action slots** — up to 6 ordered dropdowns:
  ```
  Button 1: [select — action id or "— none —"]
  Button 2: [select — action id or "— none —"]
  ...
  [+ Add Button]  (up to 6)
  ```
  Populated from `AE_LOCAL.actions`. Trailing empty slots hidden until "+ Add Button" clicked.

`saveAeGroupDrawer(originalId, isNew)`:
- Validate id (slug) and name required
- Build `actions` array from slot selects, filtering out empty slots
- Warn if > 6 actions (shouldn't be possible via UI)
- Merge into `AE_LOCAL.groups`
- Mark unsaved, re-render

---

**Drag-to-reorder** for MQTT servers, Actions, and Groups tabs:
Follow identical pattern to `_initCamDrag` / `_initViewDrag`. Name functions `_initAeSrvDrag()`, `_initAeActionDrag()`, and `_initAeGroupDrag()`. On drop, reorder the respective array in `AE_LOCAL`, call `markAeUnsaved()`, re-render tab.

**Unsaved changes banner** (same as cameras editor):
```
● N unsaved change(s)          [Discard]  [Apply Changes]
```
Sticky at bottom of modal.

`markAeUnsaved()`:
- `AE_UNSAVED = true`
- Count changed items (deep diff `AE_FULL` vs `AE_LOCAL`)
- Update banner text

`applyAeChanges()`:
- Disable Apply button, show `···`
- `PUT /api/actions` with `AE_LOCAL`
- On success:
  - `AE_FULL = deepClone(AE_LOCAL); AE_UNSAVED = false`
  - Hide banner, show green `✓ Applied` flash
  - Call `loadActionsConfig()` to hot-reload actions in the kiosk
- On error: show red error in banner

`discardAeChanges()`:
- `AE_LOCAL = deepClone(AE_FULL); AE_UNSAVED = false; AE_OPEN_DRAWER = null`
- Re-render

### 8. Update `www/index.html`

**Add CSS** (in `<style>` block, after actions modal styles):
```css
/* ─── Actions settings modal ─── */
#actions-settings-modal { justify-content: flex-start; padding: 48px; overflow-y: auto; }
#actions-settings-modal h1 { margin-bottom: 8px; }
.ae-tab-nav { display:flex; gap:4px; margin-bottom:20px; }
.ae-tab-btn { padding:6px 16px; border:1px solid rgba(255,255,255,0.12); border-radius:3px; background:transparent; color:rgba(255,255,255,0.4); font-family:'Courier New',monospace; font-size:10px; letter-spacing:0.15em; text-transform:uppercase; cursor:pointer; transition:all 0.15s; }
.ae-tab-btn.active { border-color:rgba(255,255,255,0.35); color:rgba(255,255,255,0.85); background:rgba(255,255,255,0.06); }
```
All other styling reuses existing classes: `.cam-drag-handle`, `.cam-drawer`, `.cam-drawer-inner`, `.cam-form-grid`, `.cam-save-btn`, `.cam-unsaved-banner`, `.views-form-row`, `.views-input`, `.sp-btn`, `.streams-table`, etc.

**Add `#actions-settings-modal` HTML** (before closing `</body>`, alongside other modals):
```html
<div id="actions-settings-modal" class="modal">
  <button class="modal-close-btn" onclick="closeAllModals()">✕</button>
  <h1>ACTIONS</h1>
  <div id="ae-content"><!-- rendered by JS --></div>
</div>
```

**Add `A` shortcut row** in `#settings-modal` (after the cameras row):
```html
<div class="shortcut-row">
  <button class="shortcut-key" onclick="openFromSettings('actions-settings')" title="Open actions settings">A</button>
  <span>Action settings</span>
</div>
```

**Add script tag** before closing `</body>`:
```html
<script src="/js/actions-editor.js"></script>
```

### 9. Update `www/js/ui.js`

**`closeAllModals()`** — add:
```js
document.getElementById('actions-settings-modal').classList.remove('open');
```

**`anyOpen` array** — add `'actions-settings-modal'`.

**`openFromSettings()`** — add case:
```js
} else if (which === 'actions-settings') {
  openActionsSettingsModal();
}
```

**Keyboard shortcut** — add after the `C` block:
```js
if (e.key === 'a' || e.key === 'A') {
  if (document.getElementById('actions-settings-modal')?.classList.contains('open')) return;
  returnToSettings = false;
  closeAllModals();
  openActionsSettingsModal();
  return;
}
```

### 10. Update `www/js/boot.js`

Add `'actions-settings-modal'` to the backdrop-click forEach array:
```js
['streams-modal','views-modal','settings-modal','performance-modal','cameras-modal','actions-settings-modal']
  .forEach(id => { ... });
```

### 11. Validate

- Open `http://localhost:8080`, press `A` → actions settings modal opens
- MQTT tab: add a new server with id `home` and a broker URL → save drawer → unsaved banner appears → Apply → verify `data/actions.json` updated with `mqtt.servers` array
- Actions tab: add a new action, set type `mqtt`, select server from dropdown → save → apply → press `A` again → new action visible
- Actions tab: try saving an MQTT action with no server selected → inline error "Server is required for MQTT actions"
- MQTT tab: rename a server id → verify all actions referencing the old id are updated automatically
- Groups tab: create a group with 2 actions → apply → open views editor → group appears in slot dropdown
- After apply: open the panel actions modal for a slot using the edited group → buttons render correctly; action with missing server renders as disabled button
- Delete an action that is referenced in a group → verify it is removed from the group's action list on save
- Switch panel (view) → verify only servers needed by the new group's actions are connected
- Press ESC → modal closes

---

## Testing Strategy

**Functional tests (manual):**
1. CRUD for servers: add, edit (including id rename with cascade to actions), delete, reorder
2. CRUD for actions: add (with type + mqttServer), edit (including id rename with cascade to groups), delete, reorder
3. CRUD for groups: add, edit (slot assignment), delete, reorder
4. Validation: MQTT action with no server → inline error; server id collision → inline error
5. Apply changes: verify `data/actions.json` written correctly with new schema
6. Hot-reload: after apply, open panel actions modal — new/changed actions reflect immediately
7. Lazy connect: switch panel → verify browser console shows only connections for the new panel's servers
8. Discard: make changes, discard, verify reverted to server state
9. API unavailable: stop streams-api, open modal — show error notice gracefully

**Edge cases:**
- Action id collision (duplicate id on save → inline error)
- Group with > 6 buttons (enforced by UI — "+ Add Button" hidden at 6)
- Empty `publish.topic` or `publish.payload` (validation error)
- Delete a server that is still referenced by actions → actions render disabled at runtime (no crash)
- Fresh install: `GET /api/actions` returns 500 → editor initialises with `{ mqtt: { servers: [] }, actions: [], groups: [] }`
- Reload modal after apply while panel actions modal is already open for a group that was edited

---

## Acceptance Criteria

- [ ] `A` keyboard shortcut opens `#actions-settings-modal`
- [ ] Settings modal has "A — Action settings" shortcut entry
- [ ] MQTT tab shows a server list (drag-to-reorder) with add/edit/delete per server
- [ ] Server edit drawer has id, broker, username, password fields; id slug validated; duplicate id → inline error
- [ ] Renaming a server id cascades to all `action.mqttServer` references in `AE_LOCAL.actions`
- [ ] Actions tab shows all actions as a table with drag-to-reorder
- [ ] Edit drawer includes `type` dropdown (only `"mqtt"` option) and `mqttServer` dropdown populated from server list
- [ ] Saving an MQTT action with no server selected shows inline error "Server is required for MQTT actions"
- [ ] Edit drawer has all other fields (id, label, icon, publish, state) with live icon preview
- [ ] Add/delete actions work; delete cascades to group refs
- [ ] Groups tab shows all groups with drag-to-reorder
- [ ] Group edit drawer shows up to 6 action slot dropdowns populated from `AE_LOCAL.actions`
- [ ] Apply Changes → `PUT /api/actions` → `data/actions.json` updated on disk with new schema
- [ ] After apply, `loadActionsConfig()` runs — kiosk reflects new actions without page refresh
- [ ] Panel switch triggers lazy connect/disconnect: only servers needed for the current group's actions are connected
- [ ] Actions with missing or unresolvable `mqttServer` render as disabled buttons in the panel actions modal
- [ ] Discard resets to last applied state
- [ ] No duplicate MQTT subscriptions on repeated applies
- [ ] ESC, backdrop click, and ✕ button all close the modal
- [ ] API unavailable state shows an error notice (no JS crash)

## Validation Commands

```bash
# Verify API route works
curl -s http://localhost:8080/api/actions | jq '.actions | length'
# Expected: number of actions

# Verify new schema shape
curl -s http://localhost:8080/api/actions | jq '.mqtt.servers'
# Expected: array of server objects with id, broker, username, password

# Verify write path with new schema
curl -s -X PUT http://localhost:8080/api/actions \
  -H "Content-Type: application/json" \
  -d '{
    "mqtt": { "servers": [{ "id": "home", "broker": "ws://localhost:9001", "username": "", "password": "" }] },
    "actions": [{ "id": "test", "type": "mqtt", "mqttServer": "home", "label": "Test", "publish": { "topic": "t", "payload": "x" } }],
    "groups": []
  }' | jq .
# Expected: {"ok":true}

# Verify file was written with new schema
cat data/actions.json | jq '.mqtt.servers[0].id'
# Expected: "home"

cat data/actions.json | jq '.actions[0].mqttServer'
# Expected: "home"

# Restore sample data
git checkout data/actions.json
```

## Notes

- The `per-action-mqtt-broker.md` spec (inline per-action broker config) is superseded by this multi-server design. That spec should be archived.
- The `data/` directory is already mounted into `streams-api` — only the `ACTIONS_FILE` env var addition is needed (no new volume).
- The `mqtt.js` unsubscribe-return refactor is backward-compatible — all existing callers that ignore the return value continue working.
- `ACTION_STATES` is intentionally NOT cleared on reload — if a state topic is reused after an edit, the last known value is preserved and the button renders correctly immediately.
- The actions editor does **not** need to validate that MQTT topics are well-formed beyond "not empty" — topic format enforcement is out of scope for v1.
- Icon preview requires MDI CSS (already loaded via CDN in `<head>`) — emoji previews work natively.
- If `actions.json` doesn't exist yet (fresh install), `GET /api/actions` returns a 500. The editor should handle this by initialising with an empty `{ mqtt: { servers: [] }, actions: [], groups: [] }` structure and prompting the user to configure.
- The `type` dropdown in the action edit drawer should be rendered as a `<select>` with only `"mqtt"` as an option for now. This primes the UI for future non-MQTT action types without requiring a re-design.
- When a server is deleted, actions that referenced it are left with an orphaned `mqttServer` value. These actions will render as disabled buttons at runtime. The editor does not force cleanup — the user must resolve orphaned references manually by editing each affected action.
- Lazy connect/disconnect behavior: the connect logic lives in `actions.js` and is triggered by the same mechanism that switches the displayed panel (view change event). Disconnecting unused clients prevents unnecessary background traffic to unrelated brokers.
