# Panel Actions Modal

> Status: `planned`
> Last updated: 2026-04-03

## Goal

Enable kiosk operators to control devices (lights, locks, relays, etc.) directly from camera panels via MQTT. When a user clicks/touches a camera panel, a modal appears with up to 6 configurable action buttons. Each button publishes an MQTT message when pressed and can display live state from a subscribed MQTT topic (glowing when "on"). Actions are defined in a global registry, grouped into named sets, and assigned per-view slot so each camera can have its own set of contextual controls.

**Who benefits**: Kiosk operators who need to control physical devices while monitoring camera feeds — e.g., unlocking a door while watching the entrance camera, turning on lights while viewing a dark hallway.

---

## UX Design

### Interaction model

1. **Panel indicator**: Panels that have an action group assigned display a subtle action indicator button in the bottom-right corner (36×36px semi-transparent dark circle with a lightning bolt icon `⚡` or grid icon). The indicator is always visible when hovering/touching the panel.

2. **Trigger**: User taps/clicks anywhere on the panel OR the indicator button → actions modal opens, overlaying the panel.

3. **Modal interaction**: User can press multiple buttons in sequence — modal does **not** close after each press. Closes on:
   - `ESC` key
   - Clicking the `✕` close button in modal top-right
   - Clicking the backdrop outside the modal

4. **Slots without actions**: If a slot has no action group assigned (`slotGroups[i]` is `null` or undefined), no indicator is shown and tapping the panel does nothing.

### Visual design

#### Panel indicator

- **Position**: Absolute, bottom-right corner of the panel cell, offset `12px` from edges
- **Size**: `36×36px`
- **Style**:
  ```css
  background: rgba(10,10,10,0.7);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 50%;
  color: rgba(255,255,255,0.5);
  font-size: 18px;
  cursor: pointer;
  transition: background 0.15s ease;
  ```
- **Hover**: `background: rgba(10,10,10,0.85); color: rgba(255,255,255,0.75);`
- **Icon**: `⚡` (emoji) or Material Design Icons `mdi-apps` (grid icon)

#### Actions modal

- **Positioning**: Centered over the panel cell that triggered it (not fullscreen). If the panel is too small (< 300px in either dimension), center on viewport instead.
- **Sizing**: Auto-sized to fit button grid + padding. Min width `280px`, max width `600px`.
- **Background**: `rgba(10,10,10,0.92)`
- **Border**: `1px solid rgba(255,255,255,0.12)`, `border-radius: 8px`
- **Padding**: `32px 24px 24px 24px` (extra top padding for close button)
- **Shadow**: `box-shadow: 0 8px 32px rgba(0,0,0,0.5)`

#### Backdrop

- Semi-transparent overlay covering the entire viewport except the modal
- `background: rgba(0,0,0,0.4)`
- Click on backdrop → close modal

#### Close button (`✕`)

- **Position**: `position: absolute; top: 16px; right: 20px;`
- **Style**: Uses existing `.sp-btn` class (monospace, small), no border, `color: rgba(255,255,255,0.5)`
- **Hover**: `color: rgba(248,113,113,0.6)` (red tint)
- **Consistency requirement**: Add this close button pattern to **all existing modals** (`#picker`, `#streams-modal`, `#views-modal`, `#settings-modal`, `#performance-modal`, `#cameras-modal`)

#### Button grid

Buttons arranged in a CSS Grid:
- **1–2 actions**: 1 column, auto rows
- **3–4 actions**: 2 columns, 2 rows
- **5–6 actions**: 2 columns, 3 rows
- **Gap**: `16px`

Each button:
- **Size**: `120px × 80px`
- **Layout**: Flexbox column, center-aligned
  - Icon on top (24px size)
  - Label below (11px monospace, word-wrap allowed)
- **Default state**:
  ```css
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
  color: rgba(255,255,255,0.7);
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.2s ease;
  ```
- **Hover**: `background: rgba(255,255,255,0.1);`
- **"On" state** (when `ACTION_STATES[state.topic]` equals `state.onValue`):
  ```css
  background: rgba(74,222,128,0.12);
  border-color: rgba(74,222,128,0.5);
  box-shadow: 0 0 12px rgba(74,222,128,0.6);
  color: rgba(74,222,128,0.9);
  ```
- **Press feedback**: On click, briefly flash `background: rgba(255,255,255,0.15)` for `150ms`, then revert to state-appropriate style.
- **State pending** (state topic configured but no MQTT message received yet): neutral styling (default state, no glow).
- **MQTT error** (publish fails): briefly flash red background `rgba(248,113,113,0.3)` for `1s`.

#### Icons

Icons use two formats:

1. **Material Design Icons** (MDI):
   - Specified as `"icon": "mdi:lightbulb"` in config
   - Rendered as `<span class="mdi mdi-lightbulb"></span>`
   - Load MDI CSS in `<head>`:
     ```html
     <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mdi/font/css/materialdesignicons.min.css">
     ```

2. **Emoji**:
   - Specified as raw emoji string: `"icon": "💡"`
   - Rendered as `<span style="font-size:20px">💡</span>`

### States

| UI State | Trigger | Visual |
|----------|---------|--------|
| **Panel with actions** | `slotGroups[i]` is set | Action indicator visible in bottom-right |
| **Panel without actions** | `slotGroups[i]` is `null` | No indicator, panel not interactive |
| **Modal open** | User clicks panel/indicator | Modal overlays panel, backdrop covers rest of viewport |
| **Button default** | No state topic or state unknown | Default styling |
| **Button "on"** | MQTT state matches `onValue` | Green glow |
| **Button pressed** | Click/touch | 150ms white flash |
| **MQTT publish error** | Network/connection failure | 1s red flash on button |

### Motion

| Element | Property | Duration | Easing |
|---------|----------|----------|--------|
| Modal open | `opacity` | `150ms` | `ease-out` |
| Modal close | `opacity` | `120ms` | `ease-in` |
| Backdrop | `opacity` | `150ms` | `ease-out` |
| Button hover | `background` | `150ms` | `ease` |
| Button press flash | `background` | `150ms` | `ease` |
| Button state change (off→on) | `box-shadow`, `border-color` | `200ms` | `ease` |

### Edge cases

| Scenario | Behavior |
|----------|----------|
| Action group has > 6 actions | UI enforces 6-action limit — excess actions are ignored. Console warning logged. |
| Panel too small for modal | If panel < 300px in width or height, center modal on viewport instead of panel. |
| MQTT not connected when button pressed | Show 1s red flash on button, log error to console. Do not crash. |
| State topic never receives message | Button remains in neutral state (no glow). |
| User switches views while modal open | Modal closes immediately. |
| User cycles to next view mid-interaction | Modal closes, connections for old view cleaned up per normal cycle logic. |
| Action `publish.mqtt` has different broker than global | Not supported in v1 — use global broker only. Per-action creds are parsed but not used. |
| `slotGroups` array shorter than `streams` array | Missing entries treated as `null` (no actions for those slots). |
| View has no `slotGroups` key | All panels in view have no actions. |
| Action ID referenced in group but not defined in `actions` array | Console warning, button not rendered in modal. |

---

## Implementation Plan

### New files

1. **`data/actions.json`**
   - Global actions registry
   - Structure:
     ```json
     {
       "mqtt": {
         "broker": "ws://192.168.1.x:9001",
         "username": "user",
         "password": "pass"
       },
       "actions": [
         {
           "id": "lights-on",
           "label": "Lights On",
           "icon": "mdi:lightbulb",
           "publish": {
             "topic": "home/living/lights/set",
             "payload": "ON"
           },
           "state": {
             "topic": "home/living/lights/state",
             "onValue": "ON"
           }
         }
       ],
       "groups": [
         {
           "id": "living-room",
           "name": "Living Room",
           "actions": ["lights-on", "lights-off", "fan-toggle"]
         }
       ]
     }
     ```
   - Sample file includes 3 actions: `lights-on`, `lights-off`, `fan-toggle`
   - One sample group: `living-room` with all 3 actions

2. **`www/js/actions.js`**
   - All actions logic
   - Exports:
     - `loadActionsConfig()` — fetch `/actions.json`, populate globals, subscribe to state topics via MQTT
     - `openActionsModal(slotIndex)` — look up group for active view's slot, position/render modal
     - `closeActionsModal()` — hide modal, clear backdrop
     - `renderActionButtons(groupId)` — build button grid from group's actions + current `ACTION_STATES`
     - `pressAction(actionId)` — publish MQTT message, show press feedback
   - Globals:
     - `ACTIONS` — map of action ID → action object
     - `ACTION_GROUPS` — map of group ID → group object
     - `ACTION_STATES` — map of state topic → last received payload
     - `ACTIONS_MODAL_OPEN` — boolean
   - MQTT integration:
     - Subscribe to all unique `state.topic` values from loaded actions
     - On message received: update `ACTION_STATES[topic]`, re-render buttons if modal is open
     - On button press: publish to `action.publish.topic` with `action.publish.payload`
   - Keydown ESC handler: call `closeActionsModal()`

### HTML changes (`www/index.html`)

1. **Add MDI CSS** in `<head>`:
   ```html
   <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mdi/font/css/materialdesignicons.min.css">
   ```

2. **Add `#actions-modal` HTML** before closing `</body>`:
   ```html
   <div id="actions-modal" class="modal" style="display:none; position:absolute;">
     <button class="sp-btn" style="position:absolute; top:16px; right:20px;" onclick="closeActionsModal()">✕</button>
     <div id="actions-grid" class="actions-grid"></div>
   </div>
   <div id="actions-backdrop" class="modal-backdrop" style="display:none;" onclick="closeActionsModal()"></div>
   ```

3. **Add close button to all existing modals**:
   - `#picker`, `#streams-modal`, `#views-modal`, `#settings-modal`, `#performance-modal`, `#cameras-modal`
   - Insert before first child:
     ```html
     <button class="sp-btn" style="position:absolute; top:16px; right:20px;" onclick="close{ModalName}()">✕</button>
     ```

4. **Add `<script src="/js/actions.js"></script>`** before closing `</body>`

### CSS changes (`www/css/app.css`)

Add new section **"Actions modal"** after **"Camera editor modal"** section:

```css
/* ─────────────────────────────────────────────────────────────
   Actions modal
   ───────────────────────────────────────────────────────────── */

#actions-modal {
  background: rgba(10,10,10,0.92);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 32px 24px 24px 24px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  z-index: 10001;
  min-width: 280px;
  max-width: 600px;
}

#actions-backdrop {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4);
  z-index: 10000;
}

.actions-grid {
  display: grid;
  gap: 16px;
}

.actions-grid[data-count="1"],
.actions-grid[data-count="2"] {
  grid-template-columns: 1fr;
}

.actions-grid[data-count="3"],
.actions-grid[data-count="4"],
.actions-grid[data-count="5"],
.actions-grid[data-count="6"] {
  grid-template-columns: 1fr 1fr;
}

.action-btn {
  width: 120px;
  height: 80px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
  color: rgba(255,255,255,0.7);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  text-align: center;
  padding: 8px;
}

.action-btn:hover {
  background: rgba(255,255,255,0.1);
}

.action-btn.on {
  background: rgba(74,222,128,0.12);
  border-color: rgba(74,222,128,0.5);
  box-shadow: 0 0 12px rgba(74,222,128,0.6);
  color: rgba(74,222,128,0.9);
}

.action-btn-icon {
  font-size: 24px;
  line-height: 1;
}

.action-indicator {
  position: absolute;
  bottom: 12px;
  right: 12px;
  width: 36px;
  height: 36px;
  background: rgba(10,10,10,0.7);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 50%;
  color: rgba(255,255,255,0.5);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
  z-index: 100;
}

.action-indicator:hover {
  background: rgba(10,10,10,0.85);
  color: rgba(255,255,255,0.75);
}
```

### JS changes

#### `www/js/actions.js` (new file)

Functions and logic:

1. **`loadActionsConfig()`**
   - `fetch('/actions.json')`
   - Parse, populate `ACTIONS` (map by ID), `ACTION_GROUPS` (map by ID)
   - Extract all unique `state.topic` values → subscribe via `mqtt.js` (call `subscribeTopic(topic, handleActionState)`)
   - Called from boot sequence in `app.js` (after `loadStreams()`, `loadViews()`)

2. **`handleActionState(topic, payload)`**
   - Update `ACTION_STATES[topic] = payload`
   - If `ACTIONS_MODAL_OPEN`, re-render buttons to update visual state

3. **`openActionsModal(slotIndex)`**
   - Get active view from `ACTIVE_VIEW`
   - Look up `groupId = view.slotGroups[slotIndex]`
   - If `!groupId`, return (no-op)
   - Get panel cell DOM: `document.getElementById('cell' + slotIndex)`
   - Calculate modal position:
     - If cell width/height > 300px: center modal over cell
     - Else: center modal on viewport
   - Set `#actions-modal` `top`, `left`, `display: block`
   - Set `#actions-backdrop` `display: block`
   - Call `renderActionButtons(groupId)`
   - Set `ACTIONS_MODAL_OPEN = true`

4. **`closeActionsModal()`**
   - Set `#actions-modal` `display: none`
   - Set `#actions-backdrop` `display: none`
   - Set `ACTIONS_MODAL_OPEN = false`

5. **`renderActionButtons(groupId)`**
   - Get group from `ACTION_GROUPS[groupId]`
   - Get `group.actions` array (max 6)
   - Clear `#actions-grid` inner HTML
   - For each action ID:
     - Get action from `ACTIONS[actionId]`
     - If not found, log warning, skip
     - Build button HTML:
       ```html
       <button class="action-btn" onclick="pressAction('...')" data-action-id="...">
         <span class="action-btn-icon mdi mdi-{icon}"></span>  <!-- or emoji -->
         <span>{label}</span>
       </button>
       ```
     - If `action.state.topic` exists and `ACTION_STATES[action.state.topic] === action.state.onValue`, add `.on` class
   - Set `#actions-grid` `data-count` attribute to action count (for grid column CSS)

6. **`pressAction(actionId)`**
   - Get action from `ACTIONS[actionId]`
   - Publish MQTT: `mqtt.publish(action.publish.topic, action.publish.payload)`
   - If publish fails (MQTT not connected), flash button red (`background: rgba(248,113,113,0.3)` for 1s)
   - Else: flash button white (`background: rgba(255,255,255,0.15)` for 150ms)

#### `www/js/app.js` changes

1. **Boot sequence** (after `loadViews()`):
   - Add `loadActionsConfig()` call

2. **`applyLayout()` / cell rendering**:
   - After building each cell's HTML, check if `ACTIVE_VIEW.slotGroups[i]` exists
   - If set, inject action indicator button into cell:
     ```html
     <button class="action-indicator" onclick="openActionsModal({i})">⚡</button>
     ```

3. **`activateView()` / view switch**:
   - If `ACTIONS_MODAL_OPEN`, call `closeActionsModal()` before switching

4. **Keyboard handler** (existing ESC handler):
   - Add `closeActionsModal()` to ESC key handler (only if `ACTIONS_MODAL_OPEN`)

#### `www/js/views-editor.js` changes

1. **`_renderVeStreamPicker()`** (stream slot editor):
   - After the stream dropdown for each slot, add a second dropdown/select for action group:
     ```html
     <select id="ve-slot-{i}-group" class="sp-dropdown">
       <option value="">— no actions —</option>
       <option value="{groupId}">{group.name}</option>
       ...
     </select>
     ```
   - Populate from `ACTION_GROUPS` global

2. **Save view logic** (in `veApply()` or equivalent):
   - Build `slotGroups` array from `#ve-slot-{i}-group` select values
   - Include `slotGroups` in saved view object (parallel to `streams` array)
   - Empty string becomes `null` in `slotGroups[i]`

#### `www/js/mqtt.js` changes (minimal)

- Existing `subscribeTopic()` and `publish()` functions are already suitable
- No structural changes needed — `actions.js` calls these APIs directly

### Nginx changes

Add route in `nginx.conf` to serve `actions.json`:

```nginx
location = /actions.json {
  alias /usr/share/nginx/html/actions.json;
  add_header Cache-Control "no-store, must-revalidate";
}
```

Mount in `docker-compose.yml`:

```yaml
volumes:
  - ./data/actions.json:/usr/share/nginx/html/actions.json:ro
```

### Data / config changes

#### `data/views.json` schema extension

Add optional `slotGroups` array to each view:

```json
{
  "name": "living-room-view",
  "layout": "quad",
  "streams": ["cam1", "cam2", "cam3", "cam4"],
  "slotGroups": ["living-room", null, "bedroom", null]
}
```

- `slotGroups[i]` is the action group ID for slot `i`
- `null` or missing entry means no actions for that slot
- If `slotGroups` is absent, all slots have no actions

#### `data/actions.json` (new file)

Create sample file:

```json
{
  "mqtt": {
    "broker": "ws://192.168.1.100:9001",
    "username": "admin",
    "password": "password"
  },
  "actions": [
    {
      "id": "lights-on",
      "label": "Lights On",
      "icon": "mdi:lightbulb",
      "publish": {
        "topic": "home/living/lights/set",
        "payload": "ON"
      },
      "state": {
        "topic": "home/living/lights/state",
        "onValue": "ON"
      }
    },
    {
      "id": "lights-off",
      "label": "Lights Off",
      "icon": "mdi:lightbulb-off",
      "publish": {
        "topic": "home/living/lights/set",
        "payload": "OFF"
      },
      "state": {
        "topic": "home/living/lights/state",
        "onValue": "OFF"
      }
    },
    {
      "id": "fan-toggle",
      "label": "Fan",
      "icon": "💨",
      "publish": {
        "topic": "home/living/fan/toggle",
        "payload": "TOGGLE"
      }
    }
  ],
  "groups": [
    {
      "id": "living-room",
      "name": "Living Room",
      "actions": ["lights-on", "lights-off", "fan-toggle"]
    }
  ]
}
```

---

## Open questions

1. **Actions editor UI**: v1 has no in-browser editor for `actions.json` — operators edit the file directly, restart kiosk to reload. Should a future spec cover an actions editor modal (similar to views editor)?

2. **Multiple MQTT connections**: If actions use different brokers (per-action `publish.mqtt` block), each needs its own MQTT client connection. v1 can limit to one global broker only — per-action override is parsed but ignored. Defer multi-broker support to v2?

3. **Modal position on small panels**: If a panel is very small (e.g., 8-stream layout where each panel is < 300px), centering the modal over the panel may cause overlap or readability issues. Current plan is to fall back to viewport centering — is this sufficient?

4. **Toggle actions**: Should a button auto-detect toggle behavior (e.g., publish "ON" if current state is "OFF" and vice versa), or always publish a fixed payload? Current design: always publish fixed payload. Toggle logic requires explicit ON/OFF actions in the group.

5. **Action limit enforcement**: Config enforces max 6 actions per group. Should the views editor show a warning when assigning a group with > 6 actions, or silently truncate? Current plan: silently ignore excess actions, log console warning at runtime.

6. **Icon library**: MDI font is loaded from CDN. Should this be bundled locally for offline-first kiosk environments? v1 uses CDN, v2 can bundle if needed.
