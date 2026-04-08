# Camera Settings Editor

**File:** `www/js/camera-editor.js`

## Overview

Inline drawer-based CRUD editor for camera streams. Opens as a modal (`cameras-modal`) containing a table of streams; each row expands a drawer with the edit form.

## CAM_FIELD_SCHEMA

Defined near the top of the file (after `let` globals). Array of field descriptor objects:

```js
{
  id: String,           // key in the stream object; also used as DOM id: cam-field-{id}
  label: String,        // display label
  type: String,         // 'text' | 'number' | 'select' | 'toggle'
  default: any,         // used by addCamStream() to build new stream objects
  section: String,      // 'main' | 'advanced'
  options: Array,       // [{value, label}] — select only
  dependsOn: String,    // optional; wraps field in #cam-dep-{id}, hidden when dep is falsy
  hint: String,         // optional muted helper text
  validate: Function,   // optional (value) => errorString | null
  placeholder: String,  // optional
  showIf: Function,     // optional () => bool — advanced fields only; omit field entirely if false
}
```

To add a field: add an entry to `CAM_FIELD_SCHEMA`. The renderer and `addCamStream` pick it up automatically. To make a field conditional on another field's value, set `dependsOn`.

## Camera Table Columns

The table has 6 columns: drag handle | path | status dot | masked source | edit+delete buttons. All `colspan` values in empty-state, API-unavailable, and drawer rows must be `6`.

### Status dot

Each row shows a `.stream-status` dot (reuses the CSS from `index.html`) between the path and source columns. Status is determined at render time in `renderCamTable()`:

1. Find the stream's index in the global `STREAMS` array by `path`.
2. If not found → `idle`.
3. If `#err{i}` has class `show` → `err`.
4. If `#v{i}` exists, is not paused, and `readyState >= 2` → `live`.
5. Otherwise → `idle`.

The dot is read-only display — no interaction.

## Key Functions

- **`renderCamField(field, stream)`** — returns `camFormRow(...)` HTML for one schema field. Handles `aspectRatio` as a special case (select + sibling custom input).
- **`buildCamDrawerForm(stream, isNew)`** — iterates schema, splits into main/advanced sections, wraps `dependsOn` fields in `#cam-dep-{id}` divs, emits the Advanced toggle and footer buttons.
- **`camOnDemandChange(cb)`** — toggles `#cam-dep-sourceOnDemandStartTimeout` and `#cam-dep-sourceOnDemandCloseAfter` visibility.
- **`addCamStream()`** — derives new stream defaults from `CAM_FIELD_SCHEMA[].default`.
- **`saveCamDrawer(originalPath, isNew)`** — validates path (regex + uniqueness) and source (prefix), then reads all field DOM values to build the updated stream object.

## aspectRatio Special Case

`aspectRatio` in the schema is type `select`, but `renderCamField` handles it specially: renders the select + a sibling `#cam-field-aspectRatio-custom` text input that shows only when "Custom" is selected. The `camArChange(sel)` function manages that visibility. On load, if `stream.aspectRatio` doesn't match a fixed option, the select defaults to `custom` and the sibling input is populated.

## Advanced Section

Fields with `section: 'advanced'` render inside `#cam-advanced-fields` (hidden by default). `showIf` is evaluated at render time — if it returns false the field is omitted entirely. Currently used for `preloadLeadTime` (only shown when `ENABLE_PRELOAD` is truthy).

## Drag-to-Reorder

Camera rows support drag-to-reorder using pointer capture events, mirroring the views modal pattern.

- **`_initCamDrag()`** — attaches `pointerdown` listeners to all `.cam-drag-handle` elements. Called at the end of `renderCamTable()` after every render.
- **`_onCamDragHandleDown`** / **`_onCamDragMove`** / **`_onCamDragEnd`** — handle the drag lifecycle. The ghost element (`#cam-drag-ghost`) is appended to `document.body` and removed on drop.
- Row selection uses `tbody.querySelectorAll('tr[id^="cam-row-"]')` to exclude the interleaved drawer rows from index calculations.
- On drop, `CAM_LOCAL_STREAMS` is spliced in place, then `markCamUnsaved()` + `renderCamTable()` are called. Reorder is treated as a local unsaved change — the user applies it via the "Apply Changes" banner like any other edit.

## Delete Confirmation — View Usage Warning

`deleteCamStream(path)` checks the global `VIEWS` array (guarded with `typeof VIEWS !== 'undefined'`) for any view whose `streams` array contains the path being deleted. If any matches are found, a warning line is appended to the confirmation cell:

> Used by N view(s) — will be removed from them on apply.

Styled in muted red (`rgba(248,113,113,0.7)`). The actual removal from views happens only when "Apply Changes" is confirmed (not on delete confirmation alone).

## Dependency / dependsOn

Fields with `dependsOn` are wrapped in `<div id="cam-dep-{id}">`. The wrapper starts hidden if the dependency field's current value is falsy. The `camOnDemandChange` function manually toggles the wrappers for `sourceOnDemandStartTimeout` and `sourceOnDemandCloseAfter`.
