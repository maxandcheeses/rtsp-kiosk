# Plan: Actions Settings Editor

> Status: `planned`
> Last updated: 2026-04-05

## Task Description

Add a browser-based editor for `data/actions.json` — the actions registry that drives Panel Actions Modal buttons. Operators can edit MQTT broker config, add/edit/delete actions, and manage action groups without SSH or manual file editing. The editor follows the same patterns as the cameras editor (`#cameras-modal`) and views editor (`#views-modal`): full-screen modal, tabbed sections, local-edit + apply flow, unsaved changes banner.

## Objective

When complete, pressing `A` or clicking "Actions" in the settings modal opens `#actions-settings-modal` with three tabs:
- **MQTT** — broker URL, username, password
- **Actions** — CRUD table with drag-to-reorder for individual action definitions
- **Groups** — CRUD table for action groups (ordered sets of up to 6 actions)

Changes are staged in memory and persisted via a new `PUT /api/actions` endpoint in `streams-api`. On apply, the kiosk hot-reloads its in-memory actions config without a page refresh.

## Problem Statement

`actions.json` is currently edited by hand on the filesystem. Adding a new action or changing a MQTT topic requires SSH access and a container restart. There is no in-browser editor (unlike streams and views which both have editors). This creates a gap: operators can configure views and cameras from the kiosk UI but must use the CLI to configure the action buttons those views expose.

## Solution Approach

1. **Backend** — extend `streams-api/server.js` with `GET /actions` and `PUT /actions` routes that read/write `data/actions.json`. Expose via nginx at `/api/actions`. Mount `data/actions.json` into the `streams-api` container (currently only nginx has this mount).

2. **Frontend** — new `www/js/actions-editor.js` with all editor logic. New `#actions-settings-modal` HTML skeleton in `index.html`. Tabs rendered by JS (no separate HTML per tab — same pattern as the cameras modal renders its table dynamically).

3. **Hot-reload** — after `PUT /api/actions` succeeds, call a new `reloadActionsConfig()` that clears and re-subscribes MQTT state topics. Requires a small refactor to `mqtt.js` (`mqttSubscribe` returns an unsubscribe function) and to `actions.js` (tracks its unsubscribers).

4. **Keyboard shortcut** — `A` key, consistent with existing single-letter shortcuts.

---

## Relevant Files

- `streams-api/server.js` — add `GET /actions` and `PUT /actions` routes; add `ACTIONS_FILE` env var
- `nginx.conf` — add `location /api/actions` proxy block
- `docker-compose.yml` — mount `./data/actions.json` into `streams-api` service; add `ACTIONS_FILE` env var
- `docker-compose.dev.yml` — same mounts + bind-mount `actions-editor.js` for nginx
- `www/js/mqtt.js` — refactor `mqttSubscribe()` to return an unsubscribe function
- `www/js/actions.js` — add `reloadActionsConfig()`; track unsubscribers
- `www/index.html` — add `#actions-settings-modal` HTML, CSS, `A` shortcut row in settings, script tag
- `www/js/ui.js` — add `A` keyboard shortcut; add modal to `closeAllModals()` and `anyOpen` check; add `'actions-settings'` case in `openFromSettings()`
- `www/js/boot.js` — add `actions-settings-modal` to backdrop-click array

### New Files
- `www/js/actions-editor.js` — all editor logic (load, render, CRUD, save)

---

## Implementation Phases

### Phase 1: Backend API
Extend streams-api and nginx so `/api/actions` is readable and writable from the browser.

### Phase 2: MQTT hot-reload refactor
Update `mqtt.js` and `actions.js` so `loadActionsConfig()` is safely re-callable without duplicate subscriptions.

### Phase 3: Editor UI
Build the modal, three tabs, edit drawers, and unsaved changes banner.

### Phase 4: Integration
Wire up keyboard shortcut, settings modal entry, boot hooks, and dev compose mounts.

---

## Step by Step Tasks

### 1. Extend `streams-api/server.js` with actions routes

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

### 2. Update `nginx.conf`

Add after the `/api/streams` block:
```nginx
location /api/actions {
    set $streams_api http://streams-api:9998;
    proxy_pass $streams_api/actions;
    proxy_set_header Host $host;
    proxy_read_timeout 10s;
}
```

### 3. Update `docker-compose.yml` and `docker-compose.dev.yml`

**`streams-api` service** — add environment var and volume:
```yaml
environment:
  - ACTIONS_FILE=/data/actions.json   # add alongside existing env vars
volumes:
  - ./data:/data   # already present — actions.json is inside data/
```

(The `data/` directory is already mounted into `streams-api` — no new volume needed, just the env var.)

**`docker-compose.dev.yml` nginx volumes** — add:
```yaml
- ./www/js/actions-editor.js:/usr/share/nginx/html/js/actions-editor.js:ro
```

### 4. Refactor `mqtt.js` — `mqttSubscribe` returns unsubscribe fn

Change `mqttSubscribe` to return a cleanup function:

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
    // Note: intentionally does NOT call _mqttClient.unsubscribe — the broker
    // may still send messages for this topic if other subscribers exist.
    // Suppressing at the callback level is sufficient.
  };
}
```

This is backward-compatible: callers that ignore the return value are unaffected.

### 5. Update `actions.js` — track unsubscribers, expose `reloadActionsConfig()`

Add module-level:
```js
let _actionUnsubscribers = [];
```

In `loadActionsConfig()`, at the very start, clean up old subscriptions:
```js
async function loadActionsConfig() {
  // Clean up any previous subscriptions from a prior load
  _actionUnsubscribers.forEach(fn => fn());
  _actionUnsubscribers = [];

  ACTIONS       = {};
  ACTION_GROUPS = {};
  // Keep ACTION_STATES — values are still valid if topics haven't changed
  
  try {
    // ... existing fetch/parse logic ...
    stateTopics.forEach(topic => {
      const unsub = mqttSubscribe(topic, (t, payload) => { ... });
      _actionUnsubscribers.push(unsub);
    });
    // ...
  } catch(e) { ... }
}
```

Add a public alias for hot-reload (no code change needed — just document that callers should call `loadActionsConfig()` directly):
```js
// Re-exported as convenience alias used by the actions editor after save
const reloadActionsConfig = loadActionsConfig;
```

### 6. Create `www/js/actions-editor.js`

Module-level state:
```js
let AE_FULL  = null;  // { mqtt, actions, groups } — loaded from API
let AE_LOCAL = null;  // working copy — mutated by editor
let AE_UNSAVED = false;
let AE_TAB   = 'mqtt';   // 'mqtt' | 'actions' | 'groups'
let AE_OPEN_DRAWER = null; // action id or group id of open drawer
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
- Call `renderActionsEditor()`

`renderActionsEditor()`:
- Renders tab nav (MQTT / Actions / Groups buttons)
- Renders active tab content
- Renders unsaved banner (if `AE_UNSAVED`)

`switchAeTab(tab)`:
- `AE_TAB = tab; AE_OPEN_DRAWER = null; renderActionsEditor();`

**Tab: MQTT** (`renderAeMqttTab()`):
Simple form — no drawer, always visible:
```
Broker URL:  [input — AE_LOCAL.mqtt.broker]
Username:    [input — AE_LOCAL.mqtt.username]
Password:    [input type=password — AE_LOCAL.mqtt.password]
```
Each input has `oninput` that writes to `AE_LOCAL.mqtt` and calls `markAeUnsaved()`.

**Tab: Actions** (`renderAeActionsTab()`):
Table with columns: drag-handle | ID | Label | Icon | Publish topic → payload | State topic (onValue) | edit/delete buttons.

Each row `id="ae-action-row-{id}"`. Clicking row or edit button opens edit drawer.

Edit drawer fields (same accordion-below-row pattern as cameras editor):
- `id` — text, slug validation (`/^[a-z0-9-]+$/`), required, editable
- `label` — text, required
- `icon` — text, with live icon preview span next to it (render `_renderIcon(value)` inline as a preview)
- **Publish section** (sub-heading):
  - `publish.topic` — text, required
  - `publish.payload` — text, required
- **State section** (optional — toggle to show/hide):
  - `state.topic` — text
  - `state.onValue` — text, hint: "payload string that means ON, e.g. ON"

Footer: Cancel | Save (same green `.cam-save-btn` style).

`saveAeActionDrawer(originalId, isNew)`:
- Validate required fields (id, label, publish.topic, publish.payload)
- Slug check on id
- Duplicate id check
- Merge into `AE_LOCAL.actions`
- If id changed, update references in all groups (`AE_LOCAL.groups`)
- Call `markAeUnsaved()`, re-render

`deleteAeAction(id)`:
- Show inline confirmation row (same pattern as camera editor)
- On confirm: remove from `AE_LOCAL.actions`; remove from any group's `actions` arrays
- Mark unsaved, re-render

`addAeAction()`:
- Generate placeholder id (`new-action-1`, incrementing)
- Push blank action to `AE_LOCAL.actions`
- Re-render, open drawer for new entry

**Tab: Groups** (`renderAeGroupsTab()`):
Table with columns: drag-handle | ID | Name | Action count | edit/delete buttons.

Edit drawer fields:
- `id` — text, slug validation, required
- `name` — text, required
- **Action slots** — up to 6 ordered dropdowns, same slot pattern as views editor:
  ```
  Button 1: [select — action id or "— none —"]
  Button 2: [select — action id or "— none —"]
  ...
  [+ Add Button]  (up to 6)
  ```
  Populated from `AE_LOCAL.actions`. Trailing empty slots are hidden until "+ Add Button" is clicked. Empty slot at end is included to allow removing last button.

`saveAeGroupDrawer(originalId, isNew)`:
- Validate id (slug) and name required
- Build `actions` array from slot selects, filtering out empty slots
- Warn if > 6 actions (shouldn't be possible via UI)
- Merge into `AE_LOCAL.groups`
- Mark unsaved, re-render

**Drag-to-reorder** for both Actions and Groups tabs:
Follow identical pattern to `_initCamDrag` / `_initViewDrag`. Name functions `_initAeActionDrag()` and `_initAeGroupDrag()`. On drop, reorder `AE_LOCAL.actions` or `AE_LOCAL.groups` respectively, call `markAeUnsaved()`, re-render tab.

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

### 7. Update `www/index.html`

**Add CSS** (in `<style>` block, after actions modal styles):
```css
/* ─── Actions settings modal ─── */
#actions-settings-modal { justify-content: flex-start; padding: 48px; overflow-y: auto; }
#actions-settings-modal h1 { margin-bottom: 8px; }
.ae-tab-nav { display:flex; gap:4px; margin-bottom:20px; }
.ae-tab-btn { padding:6px 16px; border:1px solid rgba(255,255,255,0.12); border-radius:3px; background:transparent; color:rgba(255,255,255,0.4); font-family:'Courier New',monospace; font-size:10px; letter-spacing:0.15em; text-transform:uppercase; cursor:pointer; transition:all 0.15s; }
.ae-tab-btn.active { border-color:rgba(255,255,255,0.35); color:rgba(255,255,255,0.85); background:rgba(255,255,255,0.06); }
```
All other styling reuses existing classes: `.cam-drag-handle`, `.cam-drawer`, `.cam-drawer-inner`, `.cam-form-grid`, `.cam-save-btn`, `.cam-unsaved-banner`, `.views-form-row`, `.views-input`, `.sp-btn`, `streams-table`, etc.

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

### 8. Update `www/js/ui.js`

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

### 9. Update `www/js/boot.js`

Add `'actions-settings-modal'` to the backdrop-click forEach array:
```js
['streams-modal','views-modal','settings-modal','performance-modal','cameras-modal','actions-settings-modal']
  .forEach(id => { ... });
```

### 10. Validate

- Open `http://localhost:8080`, press `A` → actions settings modal opens
- MQTT tab: change broker URL → unsaved banner appears → Apply → verify `data/actions.json` updated
- Actions tab: add a new action → save → apply → press `A` again → new action visible
- Groups tab: create a group with 2 actions → apply → open views editor → group appears in slot dropdown
- After apply: open the panel actions modal for a slot using the edited group → buttons render correctly
- Delete an action that is referenced in a group → verify it is removed from the group's action list on save
- Press ESC → modal closes

---

## Testing Strategy

**Functional tests (manual):**
1. CRUD for actions: add, edit (including id rename), delete, reorder
2. CRUD for groups: add, edit (slot assignment), delete, reorder
3. Group with renamed action: rename action id, verify group `actions` array updated
4. Delete action in use by group: verify group drops that action
5. Apply changes: verify `data/actions.json` written correctly
6. Hot-reload: after apply, open panel actions modal — new/changed actions reflect immediately
7. Discard: make changes, discard, verify reverted to server state
8. API unavailable: stop streams-api, open modal — show error notice gracefully

**Edge cases:**
- Action id collision (duplicate id on save → inline error)
- Group with > 6 buttons (enforced by UI — "+ Add Button" hidden at 6)
- Empty `publish.topic` or `publish.payload` (validation error)
- Reload modal after apply while panel actions modal is already open for a group that was edited

---

## Acceptance Criteria

- [ ] `A` keyboard shortcut opens `#actions-settings-modal`
- [ ] Settings modal has "A — Action settings" shortcut entry
- [ ] MQTT tab shows broker/username/password fields, changes tracked as unsaved
- [ ] Actions tab shows all actions as a table with drag-to-reorder
- [ ] Edit drawer opens per action with all fields (id, label, icon, publish, state)
- [ ] Icon field renders a live preview of the icon
- [ ] Add/delete actions work; delete from group refs cascades
- [ ] Groups tab shows all groups with drag-to-reorder
- [ ] Group edit drawer shows up to 6 action slot dropdowns; populated from `AE_LOCAL.actions`
- [ ] Apply Changes → `PUT /api/actions` → `data/actions.json` updated on disk
- [ ] After apply, `loadActionsConfig()` runs — kiosk reflects new actions without page refresh
- [ ] Discard resets to last applied state
- [ ] No duplicate MQTT subscriptions on repeated applies
- [ ] ESC, backdrop click, and ✕ button all close the modal
- [ ] API unavailable state shows an error notice (no JS crash)

## Validation Commands

```bash
# Verify API route works
curl -s http://localhost:8080/api/actions | jq '.actions | length'
# Expected: number of actions (3 in sample)

# Verify write path
curl -s -X PUT http://localhost:8080/api/actions \
  -H "Content-Type: application/json" \
  -d '{"actions":[{"id":"test","label":"Test","publish":{"topic":"t","payload":"x"}}],"groups":[]}' \
  | jq .
# Expected: {"ok":true}

# Verify file was written
cat data/actions.json | jq '.actions[0].id'
# Expected: "test"

# Restore sample data
git checkout data/actions.json
```

## Notes

- The `data/` directory is already mounted into `streams-api` — only the `ACTIONS_FILE` env var addition is needed (no new volume).
- The `mqtt.js` unsubscribe-return refactor is backward-compatible — all existing callers that ignore the return value continue working.
- `ACTION_STATES` is intentionally NOT cleared on reload — if a state topic is reused after an edit, the last known value is preserved and the button renders correctly immediately.
- The actions editor does **not** need to validate that MQTT topics are well-formed beyond "not empty" — topic format enforcement is out of scope for v1.
- Icon preview requires MDI CSS (already loaded via CDN in `<head>`) — emoji previews work natively.
- If `actions.json` doesn't exist yet (fresh install), `GET /api/actions` returns a 500. The editor should handle this by initialising with an empty `{ mqtt: {}, actions: [], groups: [] }` structure and prompting the user to configure.
