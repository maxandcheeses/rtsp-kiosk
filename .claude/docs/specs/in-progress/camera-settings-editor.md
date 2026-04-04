# Camera Settings Editor

> Status: `planned`
> Last updated: 2026-04-03 (path rename handling)

## Goal

Allow operators to add, edit, and delete stream entries in `data/streams.json` from the browser UI — without SSH access or manual file editing. The changes must persist across container restarts and must re-trigger `generate-config.sh` so MediaMTX picks up the new RTSP configuration.

The primary user is a self-hosted home/office operator managing a small number of IP cameras (1–16). They may use a touchscreen kiosk or a mouse+keyboard admin device on the same LAN.

---

## Backend Requirement (prerequisite)

Nginx currently serves `streams.json` as a static read-only file. There is **no write path today**. This feature requires a new backend service to accept mutations. This is a hard prerequisite — no amount of frontend work unlocks persistence without it.

### Recommended approach: streams-api sidecar

Add a fourth Docker service (`streams-api`) — a minimal HTTP server running alongside the existing three. It:

1. Exposes a REST API on port `9998` (Nginx proxies `/api/streams` to it)
2. Reads and writes `data/streams.json` directly (shared volume mount)
3. After any write, re-runs `generate-config.sh` logic (or signals MediaMTX via its existing API at `:9997`) to apply the new RTSP path config without a full container restart

Nginx proxy block (new `location` in the nginx config):
```
location /api/streams {
    proxy_pass http://streams-api:9998;
}
```

#### API surface (minimum viable)

| Method | Path | Body | Effect |
|--------|------|------|--------|
| `GET` | `/api/streams` | — | Returns full `data/streams.json` (with credentials — internal only, never served as `/streams.json`) |
| `PUT` | `/api/streams` | `[...streams]` | Replaces entire array, regenerates public files, signals MediaMTX. **If any stream's path changed** (compared to the on-disk version), the sidecar must also update `views.json` atomically — finding any view slots that reference the old path and replacing them with the new path. Both files must be written before returning success. |
| `POST` | `/api/streams` | `{...stream}` | Appends one stream |
| `DELETE` | `/api/streams/:path` | — | Removes stream by path key |

The `PUT /api/streams` endpoint is the simplest to implement and what the editor will use (send the full revised array on every save).

#### MediaMTX hot-reload

After writing `streams.json`, the sidecar must update MediaMTX. Two options:
- **Option A (preferred)**: Use the MediaMTX HTTP API (`DELETE /v3/paths/:path`, `POST /v3/config/paths/add/:path`) to add/remove paths without restarting.
- **Option B (fallback)**: Regenerate `mediamtx.yml` and send `SIGHUP` to the MediaMTX process (requires access to the container PID — harder in Docker).

Option A is preferred because it is zero-downtime for existing streams.

---

## UX Design

### Access point

The camera settings editor is accessed via a new **"Cameras"** entry in the settings modal (`#settings-modal`), parallel to the existing "Views" entry. It opens `#cameras-modal`.

```
Settings modal (existing)
  ├── [L] Layout picker
  ├── [V] Views
  ├── [C] Cameras        ← new
  ├── [S] Stream debug info
  └── [P] Performance
```

A keyboard shortcut `C` opens/closes `#cameras-modal` directly (following the existing shortcut pattern).

There is no gear icon on individual stream tiles. The kiosk display is meant to be watched, not administered — inline tile controls add visual noise. Administration is centralised in the modal.

### Modal structure

`#cameras-modal` follows the same fullscreen modal pattern as `#views-modal`: `position: fixed; inset: 0; background: rgba(15,15,15,0.96); overflow-y: auto; padding: 48px`.

Layout (top to bottom):
1. **Header** — `h1` "CAMERAS" in uppercase monospace
2. **Toolbar** — "Add Camera" button on the right
3. **Streams table** — one row per stream, sortable by drag handle (same pattern as views)
4. **Hint** — `modal-hint` text: "ESC to close · changes require container restart for RTSP to apply"
5. **Unsaved changes banner** — sticky bar at bottom when edits are pending (see States)

### Stream list (table rows)

Each row shows:
- Drag handle (reorder — affects display order in views stream picker only; does not affect MediaMTX config order)
- **Path** — monospace, muted — e.g. `cam1`
- **Label** — primary text — e.g. `Front Door`
- **Source** — monospace small, credentials masked (replace `user:pass@` with `***@`) — e.g. `rtsp://***@192.168.1.10/stream`
- **Status dot** — live/err/idle (reuses `.stream-status` class from the existing streams debug table)
- **Edit button** (pencil icon, `sp-btn` style, 40×40px)
- **Delete button** (trash icon, `sp-btn` style, 40×40px, red on hover)

Clicking anywhere on the row (except buttons) opens the edit drawer for that stream.

### Edit drawer (inline panel, not a nested modal)

When the user clicks a row or the edit button, an **inline edit drawer** expands below that table row (like an accordion). It does not open a second modal — nesting modals is disorienting on a kiosk.

The drawer contains a two-column form grid. Each field is a `views-form-row`-style layout: label on the left (120px fixed), input on the right (flex: 1).

#### Fields and input types

| Field | Label | Input type | Notes |
|-------|-------|-----------|-------|
| `path` | Path | `text` | Required. Slug validation: lowercase alphanumeric + hyphens only. Editable on existing streams. If the path changes, the backend will automatically update all references in `views.json`. |
| `label` | Label | `text` | Required. Free text. |
| `source` | RTSP Source | `text` | Required. Full RTSP URL including credentials. Placeholder: `rtsp://user:pass@host/path`. On load, show the real (unmasked) value from GET /api/streams — never from streams-public.json. |
| `rtspTransport` | Transport | `select` | Options: `tcp` (default), `udp`. |
| `aspectRatio` | Aspect Ratio | `select` | Options: `16:9` (default), `4:3`, `1:1`, `21:9`, `custom`. Selecting "custom" shows a freeform text input next to it. |
| `objectFit` | Object Fit | `select` | Options: `contain` (default), `cover`. Small visual hint: "contain = letterbox, cover = crop". |
| `audio` | Audio | toggle (`checkbox`) | Reuses `.toggle` / `.toggle-track` pattern. Default: off. |
| `sourceOnDemand` | On Demand | toggle | Default: on. When off, hide the two timeout fields below. |
| `sourceOnDemandStartTimeout` | Start Timeout | `text` | Shown only when On Demand is enabled. Placeholder: `10s`. Accepts MediaMTX duration strings (e.g. `10s`, `1m`). |
| `sourceOnDemandCloseAfter` | Close After | `text` | Shown only when On Demand is enabled. Same format. |

Advanced fields (collapsed by default under a "Advanced" disclosure toggle):

| Field | Label | Input type | Notes |
|-------|-------|-----------|-------|
| `refreshInterval` | Refresh Interval | `number` (`.perf-input`) | Seconds. 0 = off. |
| `preloadLeadTime` | Preload Lead Time | `number` (`.perf-input`) | Seconds. 0 = use view default. |

Drawer footer (right-aligned):
- **Cancel** — `perf-reset` style button — collapses the drawer without saving
- **Save** — primary action button (green accent: `background: rgba(74,222,128,0.15); border: 1px solid rgba(74,222,128,0.5); color: #4ade80`) — writes to the in-memory stream list and marks the modal as having unsaved changes

### Add Camera flow

Clicking "Add Camera" in the toolbar opens a new blank drawer appended to the bottom of the table. The same form renders with empty/default values. Path field is enabled. On Save, the new stream is appended to the in-memory list.

### Save / apply flow

Saves within the drawer are **local only** — they update a local copy of the stream array in JS memory. This two-phase approach prevents partial saves from corrupting the live config.

A persistent **unsaved changes banner** appears at the bottom of the modal when any local edits exist:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ● 3 unsaved changes                    [Discard]  [Apply Changes]  │
└─────────────────────────────────────────────────────────────────────┘
```

"Apply Changes" calls `PUT /api/streams` with the full revised array. On success:
- Banner replaced with a brief green success message: "Applied. MediaMTX updating..." for 2s, then dismissed
- The browser re-fetches `/streams.json` (the sanitised public version) to refresh the in-memory `STREAMS[]`
- Any active view is left running — streams that were not affected continue without interruption

On API error:
- Banner shows red error: "Save failed — check console" with the HTTP status
- Local edits are preserved so the user can retry

"Discard" reverts local edits to the last applied state (re-fetches from `/api/streams`).

### Delete flow

Clicking the delete button on a row shows an inline confirmation within that row (replacing the row content), matching the pattern in `#views-modal`:

```
Delete "Front Door"?    [Cancel]  [Delete]
```

Delete removes from the local list and marks unsaved changes. The stream is not actually removed from disk until "Apply Changes" is pressed.

---

## States

### Default (no edits)
Table rows visible, no banner, no open drawers.

### Drawer open (editing)
Row highlighted with `background: rgba(255,255,255,0.04)`. The drawer beneath it is visible. Other drawers are collapsed (only one open at a time).

### Unsaved changes
Bottom banner visible with change count. "Apply Changes" button is green-accented. "Discard" is muted.

### Saving (loading)
"Apply Changes" button becomes disabled and shows `···` text. Banner shows `Saving...`.

### Save success
Banner briefly shows green: `✓ Applied` for 2s, then hides. Table reverts to clean state.

### Save error
Banner turns red: `Save failed (HTTP 502)`. Retry is possible without losing edits.

### Delete confirm
Row content replaced with confirmation UI. Background: `rgba(248,113,113,0.06)` (matches `.view-row-confirm` pattern).

### Empty (no streams)
Table replaced with centered empty state text:
```
NO STREAMS CONFIGURED
Add your first camera to get started
```
"Add Camera" button still visible in toolbar.

### API unavailable (no backend)
On modal open, the editor attempts `GET /api/streams`. If the endpoint returns 404 or network error, the modal shows a full-width notice:
```
STREAMS API NOT AVAILABLE
The streams API service is not running.
Editing requires the streams-api Docker service.
```
The table still renders (read-only) using the sanitised `/streams.json` data. Edit and delete buttons are disabled. Add button is hidden.

---

## Motion

| Transition | Property | Duration | Easing |
|-----------|----------|----------|--------|
| Drawer expand | `max-height` 0 → auto (use JS-set px value) | 200ms | `ease` |
| Drawer collapse | `max-height` → 0 | 150ms | `ease` |
| Row delete confirmation | `background` | 150ms | `ease` |
| Banner appear | `opacity` 0 → 1 | 150ms | `ease` |
| Success flash | `opacity` 1 → 0 after 2s delay | 300ms | `ease` |

---

## Implementation Plan

### New Docker service: `streams-api`

A new service is required before any frontend work. Recommended: a small Node.js or Python script (single file) that:
- Mounts `data/` as a volume (same as mediamtx service)
- Listens on port 9998
- Handles `GET /`, `PUT /` for the streams array
- After a successful write, calls the MediaMTX HTTP API to sync path config

This is owned by the backend-dev agent. The frontend-dev agent should mock the API responses with static JSON during development.

### Nginx config change

Add a proxy pass block to the nginx `server {}` block:
```
location /api/streams {
    proxy_pass http://streams-api:9998/;
    proxy_set_header Host $host;
}
```

### New CSS classes (add to `www/css/app.css`)

`#cameras-modal`
- Same structure as `#views-modal`: `justify-content: flex-start; padding: 48px; overflow-y: auto`

`.cam-toolbar`
- Same pattern as `.views-toolbar`

`.cam-add-btn`
- `background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.3); border-radius: 3px; color: #4ade80; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; padding: 6px 14px; cursor: pointer; transition: background 0.15s, border-color 0.15s`
- hover: `background: rgba(74,222,128,0.2); border-color: rgba(74,222,128,0.55)`

`.cam-drawer`
- `overflow: hidden; max-height: 0; transition: max-height 200ms ease`
- open state `.cam-drawer.open`: max-height set via JS to measured scrollHeight

`.cam-drawer-inner`
- `padding: 16px 20px 20px; background: rgba(255,255,255,0.02); border-top: 1px solid rgba(255,255,255,0.08)`

`.cam-form-grid`
- `display: flex; flex-direction: column; gap: 12px`

`.cam-advanced-toggle`
- `background: none; border: none; color: rgba(255,255,255,0.35); font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase; cursor: pointer; padding: 6px 0; text-align: left; transition: color 0.15s`
- hover: `color: rgba(255,255,255,0.7)`

`.cam-save-btn`
- `background: rgba(74,222,128,0.15); border: 1px solid rgba(74,222,128,0.5); border-radius: 3px; color: #4ade80; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; padding: 6px 16px; cursor: pointer; transition: background 0.15s, border-color 0.15s`
- disabled state: `opacity: 0.4; cursor: default; pointer-events: none`

`.cam-unsaved-banner`
- `position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: rgba(15,15,15,0.97); border-top: 1px solid rgba(255,255,255,0.12); font-family: 'Courier New', monospace; font-size: 11px; color: rgba(255,255,255,0.7); gap: 16px`

`.cam-unsaved-dot`
- `width: 6px; height: 6px; border-radius: 50%; background: #facc15; flex-shrink: 0`

`.cam-banner-actions`
- `display: flex; gap: 8px; flex-shrink: 0`

`.cam-api-unavailable`
- `width: 100%; max-width: 600px; padding: 24px; background: rgba(248,113,113,0.06); border: 1px solid rgba(248,113,113,0.2); border-radius: 4px; font-family: 'Courier New', monospace; text-align: center`

`.cam-api-unavailable-title`
- `font-size: 11px; letter-spacing: 0.3em; text-transform: uppercase; color: rgba(248,113,113,0.8); margin-bottom: 10px`

`.cam-api-unavailable-body`
- `font-size: 10px; color: rgba(255,255,255,0.4); line-height: 1.8`

### JS changes (in `www/js/app.js`)

All new camera editor functions should be added as a new section after the existing views modal section (after ~line 1100).

**New globals:**
- `let CAM_STREAMS_FULL = null` — full stream list from `/api/streams` (with credentials)
- `let CAM_LOCAL_STREAMS = null` — working copy, mutated by editor actions
- `let CAM_UNSAVED = false`
- `let CAM_OPEN_DRAWER = null` — path string of currently open drawer, or null

**New functions:**

`openCamerasModal()` — sets `#cameras-modal` to open, calls `loadCamStreams()`, renders table

`loadCamStreams()` — `GET /api/streams`. On success: populate `CAM_STREAMS_FULL` and `CAM_LOCAL_STREAMS`. On 404/network error: set `CAM_STREAMS_FULL = null` and render the API-unavailable notice instead of the table.

`renderCamTable()` — rebuilds the `<tbody>` from `CAM_LOCAL_STREAMS`. Each row gets a `data-path` attribute. Attach click handler to open/close drawer. Attach edit/delete button handlers.

`openCamDrawer(path)` — collapses any currently open drawer, then expands the drawer for the given path. Populates form fields from `CAM_LOCAL_STREAMS` entry. Sets `CAM_OPEN_DRAWER = path`.

`closeCamDrawer()` — collapses drawer, sets `CAM_OPEN_DRAWER = null`.

`saveCamDrawer(path)` — reads form fields, validates (required fields, path slug format), merges into `CAM_LOCAL_STREAMS`, closes drawer, calls `markCamUnsaved()`. If the path field value differs from the original path, the drawer should pass both `oldPath` and `newPath` so the frontend can update the `CAM_LOCAL_STREAMS` map correctly (the entry's key changes). The backend handles `views.json` updates on apply.

`markCamUnsaved()` — sets `CAM_UNSAVED = true`, updates banner text with change count (diff between `CAM_STREAMS_FULL` and `CAM_LOCAL_STREAMS`).

`applyCamChanges()` — disables Apply button, calls `PUT /api/streams` with `CAM_LOCAL_STREAMS`. On success: sets `CAM_STREAMS_FULL = [...CAM_LOCAL_STREAMS]`, `CAM_UNSAVED = false`, hides banner, shows success flash, re-fetches `/streams.json` and updates `STREAMS[]`. On error: shows error banner.

`discardCamChanges()` — resets `CAM_LOCAL_STREAMS` to deep copy of `CAM_STREAMS_FULL`, re-renders table, hides banner.

`deleteCamStream(path)` — shows inline confirmation row. On confirm: removes from `CAM_LOCAL_STREAMS`, re-renders, marks unsaved.

`addCamStream()` — appends a blank stream object to `CAM_LOCAL_STREAMS` with a generated placeholder path (`new-camera-1`, incrementing), re-renders table, opens the drawer for the new entry.

**Keyboard shortcut:**
Add `'C'` → `openCamerasModal()` to the keydown handler (around line 1013–1100 section). This matches the existing pattern where single-letter keys toggle modals.

**Settings modal entry:**
Add a row in `#settings-modal`'s shortcut list:
```html
<div class="shortcut-row">
  <button class="shortcut-key" onclick="openFromSettings('cameras')" title="Open camera settings">C</button>
  <span>Camera settings</span>
</div>
```
Update `openFromSettings()` to handle the `'cameras'` case.

### HTML changes (`www/index.html`)

Add `#cameras-modal` as a new `.modal` div before the closing `</body>` tag (same position as other modals). Structure:

```
<div id="cameras-modal" class="modal">
  <h1>CAMERAS</h1>
  <div class="cam-toolbar"> ... Add Camera button ... </div>
  <table class="streams-table" id="cam-table"> ... </table>
  <div class="cam-unsaved-banner" id="cam-banner" style="display:none"> ... </div>
  <p class="modal-hint">ESC to close · changes require container restart for RTSP to apply</p>
</div>
```

The table body is rendered entirely by `renderCamTable()`. The modal HTML only contains the skeleton.

### Data / config changes

No changes to the JSON schemas themselves. The `streams.json` schema already supports all editable fields (see architecture.md §9).

The `generate-config.sh` script does not need to change — it is invoked by the streams-api sidecar after each write, not by the frontend.

`data/streams.json` credentials remain server-side only. The browser never receives them via `/streams.json` (the sanitised file). The editor fetches from `/api/streams` (the new internal API), which is only accessible within the Docker network (proxied by Nginx without auth — acceptable for a LAN kiosk; operators who need auth can add HTTP basic auth at the Nginx proxy layer).

---

## Edge cases

**Path uniqueness**: On save, check that the new path does not conflict with an existing `path` value in `CAM_LOCAL_STREAMS`. Show a red inline error below the path field if it does.

**Path in use by views**: When a stream's path is changed, the backend handles updating `views.json` automatically — no user-visible warning needed for path renames. When a stream is deleted that is referenced by one or more views, show a warning in the delete confirmation: "This stream is used by N view(s). It will be removed from those views on apply."

**Concurrent edits**: If two browser sessions both load and edit streams simultaneously, the last `PUT /api/streams` wins. No conflict detection is implemented — acceptable for a single-operator kiosk.

**Container not running streams-api**: The API-unavailable state (see States) handles this gracefully without crashing.

**`sourceOnDemand` toggle**: When the user turns off On Demand, the `sourceOnDemandStartTimeout` and `sourceOnDemandCloseAfter` fields should collapse (height transition, 150ms) so users do not accidentally leave stale timeout values visible.

**Drawer with unsaved row edits**: If the user opens a second row's drawer while the first drawer has been edited but not saved, the first drawer is closed (calling `closeCamDrawer()`) — local form values are discarded. Only committed-to-memory saves (via the drawer Save button) persist in `CAM_LOCAL_STREAMS`.

**Empty `source` field**: MediaMTX requires a valid RTSP source. Validate that `source` starts with `rtsp://` or `rtsps://` before enabling the drawer Save button.

---

## Open questions

1. **Authentication on `/api/streams`**: Should the streams API require any authentication token, or rely solely on network-level isolation (LAN only)? If the kiosk is exposed to a broader network, unauthenticated write access is dangerous.

2. **Which language/runtime for the sidecar?**: Node.js (no extra image), Python (smaller), or a compiled binary (Go/Rust, zero runtime deps)? The backend-dev agent should decide based on existing tooling in the repo.

3. **MediaMTX hot-reload vs restart**: Option A (MediaMTX HTTP API) requires testing that all path CRUD operations work cleanly via the v3 API. If there are edge cases (e.g. streams with active viewers), Option B (SIGHUP) may be more reliable at the cost of a brief reconnect for all streams.

4. **Drag-to-reorder streams**: Should stream order in `streams.json` be reorderable via drag handles? Currently stream order only affects which streams appear as candidates in the views editor. Leaving this out of v1 keeps scope tight.
