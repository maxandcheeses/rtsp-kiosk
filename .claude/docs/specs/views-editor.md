# Views Editor

> Status: `active`
> Last updated: 2026-04-03

## Goal

Allow operators to create, edit, delete, and reorder named view presets from the browser UI. Views are stream collections with an assigned layout and optional auto-cycling duration. Changes are persisted to `localStorage`, overriding the server-provided `views.json` file. This enables self-service kiosk configuration without editing JSON files or restarting containers.

The primary user is a self-hosted operator who wants to quickly switch between different camera groupings for different use cases: front entrance only, full perimeter, split left/right zones, etc.

---

## UX Design

### Access point

The views editor is accessed two ways:
1. **Keyboard shortcut `V`** — opens `#views-modal` directly
2. **Settings modal** — a "Views" entry in the shortcuts list

The modal is fullscreen, matching the layout picker style.

### Modal structure

`#views-modal` is a fullscreen modal (`position: fixed; inset: 0; background: rgba(15,15,15,0.96); overflow-y: auto; padding: 48px`).

**Default state (table view):**

Layout (top to bottom):
1. **Header** — `h1` "VIEWS" in uppercase monospace
2. **Global controls row** — two controls side-by-side:
   - **Cycle toggle** — `.toggle` checkbox, label "Auto-cycle views"
   - **Default view dropdown** — `select` element, label "Default view on load", populated with view names + "(none)" option
3. **Toolbar** — "New View" button on the right
4. **Views table** — one row per view, drag handle for reorder
5. **Hint** — `modal-hint` text: "ESC to close · changes saved to browser"

Each table row shows:
- Drag handle (≡ icon)
- **Name** — monospace, muted — e.g. `front-entrance`
- **Label** — primary text — e.g. `Front Entrance`
- **Layout** — e.g. `quad` — small text
- **Streams** — comma-separated stream labels (truncated if > 40 chars)
- **Duration** — e.g. `30s`, `stay` (-1), or blank if cycling disabled
- **Edit button** (pencil icon, `sp-btn` style, 40×40px)
- **Clone button** (copy icon, `sp-btn` style)
- **Delete button** (trash icon, `sp-btn` style, red on hover)

Clicking anywhere on the row (except buttons) opens the edit form for that view.

---

### Edit form (replaces table view)

When a user clicks "New View" or edits an existing view, the table is hidden and replaced with a single-view edit panel. The panel is vertically scrollable.

**Header:** "Edit: {view.name}" or "New View"

**Form fields (two-column layout, label left 120px fixed, input right flex):**

| Field | Label | Input type | Notes |
|-------|-------|-----------|-------|
| `name` | Name | `text` | Required. Slug validation: lowercase alphanumeric + hyphens. Disabled when editing (can't rename). Enabled for new views. |
| `label` | Label | `text` | Optional. Free text. Defaults to `name` if left blank. |
| `duration` | Duration (seconds) | `number` | Seconds to display before cycling. `-1` = stay forever (manual navigation only). Default: `20`. |
| `preloadLeadTime` | Preload Lead Time | `number` | (Optional — only shown when `ENABLE_PRELOAD` is true). Seconds before this view's turn to start preloading streams. Checkbox above it: "Enable preload for this view". When unchecked, field is hidden. Default: `5`. |

**Layout picker:** Grid of layout buttons (same visual style as `#picker` modal). Each button shows the layout SVG icon with stream numbers overlaid. Clicking a button selects that layout.

**Stream picker:** Scrollable list split into two sections:
1. **In view (ordered)** — streams assigned to this view, with numeric slot indicators (0, 1, 2...). Each has:
   - Drag handle (≡) for reordering
   - Slot number badge
   - Stream label + path (monospace)
   - Remove button (✕)
2. **Available** — streams not in the view, each with an Add button (+)

Streams in the "In view" section are drag-to-reorder. The order determines which stream appears in which layout slot.

**Form footer (right-aligned):**
- **Cancel** — `perf-reset` style button — returns to table view without saving
- **Save** — primary action button (green accent) — persists to localStorage, returns to table view

---

### Delete flow

Clicking the delete button on a table row replaces the row content with an inline confirmation:

```
Delete "Front Entrance"?    [Cancel]  [Delete]
```

Background changes to `rgba(248,113,113,0.06)` (red tint). Confirmation is row-inline, not a nested modal.

On confirm, the view is removed from the list and localStorage is updated. If the deleted view was set as the default, the default is cleared.

---

### Clone flow

Clicking the clone button on a table row immediately creates a copy with a `-copy` suffix (e.g., `front-entrance-copy`). If that name already exists, it appends `-copy-2`, `-copy-3`, etc. The cloned view opens directly in the edit form.

---

## States

### Default (table view)
Views listed in order. Cycle toggle and default dropdown reflect current config. No view is selected.

### Edit form open
Table is hidden. Edit panel visible. Cancel/Save buttons at bottom.

### Saving (immediate)
No explicit loading state. `_persistViews()` writes to localStorage synchronously and returns to table. If localStorage write fails, no error is shown (silent fail — acceptable for a kiosk).

### Empty (no views)
Table replaced with centered empty state text:
```
NO VIEWS CONFIGURED
Click "New View" to get started
```
"New View" button still visible in toolbar.

### Delete confirm
Row content replaced with confirmation UI. Red background tint. Cancel restores the row, Delete removes it permanently.

### Drag in progress
Ghost element follows cursor. Drop-before/drop-after indicator (blue bar) shows where the view will land. On drop, view order is updated and persisted.

---

## Motion

| Transition | Property | Duration | Easing |
|-----------|----------|----------|--------|
| Table → Edit form | `display` swap (no transition — instant) | 0ms | — |
| Edit form → Table | `display` swap | 0ms | — |
| Row delete confirmation | `background` | 150ms | `ease` |
| Drag ghost | `top`, `left` | realtime (no transition) | — |
| Drop indicator | `opacity` 0 → 1 | 100ms | `ease` |

---

## Implementation Plan

### JS changes (in `www/js/views-editor.js`)

**Already implemented.** The views editor is fully functional as of the current codebase. This spec documents the existing behavior.

**Key functions:**
- `openViewsModal()` — switches between table and edit modes
- `_persistViews()` — writes `{ default, cycle, views }` to `localStorage('viewsConfig')`
- `openViewEditor(name)` — populates edit form for an existing view
- `openNewViewEditor()` — opens blank form for a new view
- `saveViewForm()` — validates fields, updates `VIEWS[]`, calls `_persistViews()`
- `confirmDeleteView(name)` — removes view from `VIEWS[]`, updates localStorage
- `cloneView(name)` — creates a copy with `-copy` suffix
- `moveView(name, dir)` — reorders views (up/down arrows, legacy — now superseded by drag)
- Drag handlers: `_initViewDrag()`, `_onDragHandleDown()`, `_onDragMove()`, `_onDragEnd()`
- Stream picker drag: `_initStreamDrag()`, `_onStreamDragDown()`, `_onStreamDragMove()`, `_onStreamDragEnd()`

### CSS classes (in `www/index.html` inline styles)

**Already implemented.** Key classes:
- `.views-toolbar` — header row with "New View" button
- `.views-table` — monospace table for view list
- `.view-row` — table row with hover state
- `.view-drag-handle` — drag handle (≡ icon)
- `.view-row-dragging` — applied to row being dragged (reduced opacity)
- `.view-drop-before`, `.view-drop-after` — drop indicator (blue bar)
- `#view-drag-ghost` — ghost element that follows cursor
- `#view-edit-panel` — edit form container (hidden by default)
- `.ve-layout-btn` — layout picker button (selected state `.ve-layout-btn.selected`)
- `.sp-item` — stream picker item
- `.sp-drag-handle` — drag handle in stream picker
- `.sp-selected` — stream in the "In view" section
- `.sp-btn` — add/remove button
- `#sp-drag-ghost` — ghost element for stream drag

### HTML changes (`www/index.html`)

**Already implemented.** `#views-modal` contains:
- Table view (`#views-table-wrap`)
- Edit panel (`#view-edit-panel`)
- Global controls (cycle toggle, default dropdown)

### Data / config changes

Views are stored in `localStorage('viewsConfig')` as:
```json
{
  "default": "front-entrance",
  "cycle": true,
  "views": [
    {
      "name": "front-entrance",
      "label": "Front Entrance",
      "layout": "quad",
      "streams": ["cam1", "cam2", "cam3", "cam4"],
      "duration": 30,
      "preloadLeadTime": 5
    }
  ]
}
```

`loadViews()` in `config.js` checks localStorage first. If found, it overrides the server-provided `/views.json`.

There is no write-back to the server. Views are browser-local only.

---

## Edge cases

**Name uniqueness:** On save, check that the new view name doesn't conflict with an existing view. Show an alert if it does.

**Stream references nonexistent path:** If a stream path in a view is not in `STREAMS[]`, the cell is silently skipped during `activateView()`. No user-visible error.

**localStorage full:** If the views config is too large (>5MB quota), `_persistViews()` silently fails. No error shown. Acceptable for a kiosk with <100 views.

**Concurrent edits (multiple browser tabs):** Each tab has its own in-memory `VIEWS[]`. The last tab to call `_persistViews()` wins. No conflict detection.

**Delete default view:** If the deleted view is set as the default, the default is cleared (`VIEWS_DEFAULT = VIEWS[0]?.name ?? null`).

**Drag stream to slot beyond layout capacity:** The stream picker doesn't enforce a max length. `applyLayout()` caps at `layout.streams` slots — extra streams in the view are ignored.

**ENABLE_PRELOAD off:** The preload lead time field is hidden when `ENABLE_PRELOAD` env var is not set.

---

## Open questions

None. Feature is complete and stable.
