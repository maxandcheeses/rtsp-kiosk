# Plan: Action Button Drag-to-Reorder

> Status: `planned`
> Last updated: 2026-04-04

## Task Description

Allow users to drag and drop action buttons within the actions modal to reorder them. The new order is persisted per-group in `localStorage` so it survives page reloads.

## Objective

After this plan is complete, users can hold a drag handle on any action button and drag it to a new position in the grid. The reordered sequence persists across sessions (per group). No backend changes are needed.

## Problem Statement

Action buttons are currently rendered in the fixed order defined in `actions.json`. On a 24/7 kiosk, operators may want frequently-used buttons in the top-left position (easiest to reach). There is no way to reorder them without editing `actions.json`.

## Solution Approach

Add a small `≡` drag handle to each button. Use pointer-capture drag (matching the existing pattern in `camera-editor.js` and `views-editor.js`). Drag is position-based: calculate which grid cell the pointer is over during `pointermove` and swap the dragged item into that slot. On `pointerup`, persist the new order to `localStorage` under key `actionsGroupOrder` (a JSON object mapping `groupId → string[]` of action IDs). On next `openActionsModal`, read the saved order and apply it before rendering.

The drag handle is in the top-right corner of each button. Pointer events on the handle call `stopPropagation` so they do not trigger the button's `onclick` (action press). The button body itself still fires the action on click.

---

## Relevant Files

- `www/js/actions.js` — all drag logic and persistence lives here alongside `_renderActionButtons`
- `www/index.html` — add drag-handle CSS (`.action-drag-handle`) and drag-state CSS (`.action-btn.dragging`, `.action-btn.drag-over`)

---

## Step by Step Tasks

### 1. Add drag state vars to `actions.js`

After the existing module-level vars (`ACTIONS`, `ACTION_GROUPS`, etc.), add:

```js
let _dragSrcIndex  = null;  // index in actionIds array being dragged
let _dragGroupId   = null;  // group currently being reordered
```

### 2. Load saved order in `_renderActionButtons`

At the start of `_renderActionButtons(groupId)`, before slicing, apply any saved order from localStorage:

```js
function _renderActionButtons(groupId) {
  const group = ACTION_GROUPS[groupId];
  if (!group) return;

  // Apply saved order if present
  try {
    const saved = JSON.parse(localStorage.getItem('actionsGroupOrder') || '{}');
    if (saved[groupId] && Array.isArray(saved[groupId])) {
      // Merge: saved order first, then any new IDs not yet saved
      const savedIds = saved[groupId].filter(id => group.actions.includes(id));
      const newIds   = group.actions.filter(id => !savedIds.includes(id));
      group.actions  = [...savedIds, ...newIds];
    }
  } catch(e) {}

  const actionIds = group.actions.slice(0, 6);
  // ... rest of existing logic
```

### 3. Add drag handle to each button in `_renderActionButtons`

Update the button template inside `_renderActionButtons` to include a drag handle and `data-index`:

```js
return `<button class="action-btn${isOn ? ' on' : ''}" data-action-id="${id}" data-index="${index}" onclick="pressAction('${id}')">
  <span class="action-drag-handle" onpointerdown="event.stopPropagation();_onActionDragStart(event,${index},'${groupId}')">≡</span>
  ${iconHtml}
  <span>${action.label || id}</span>
</button>`;
```

Note: `index` is the map callback's second argument — update the `.map((id, index) => { ... })` signature accordingly.

### 4. Implement drag handlers in `actions.js`

Add these three functions after `_renderActionButtons`:

```js
function _onActionDragStart(e, srcIndex, groupId) {
  e.preventDefault();
  _dragSrcIndex = srcIndex;
  _dragGroupId  = groupId;

  const btn = e.currentTarget.closest('.action-btn');
  btn.classList.add('dragging');
  btn.setPointerCapture(e.pointerId);

  btn.addEventListener('pointermove', _onActionDragMove);
  btn.addEventListener('pointerup',   _onActionDragEnd);
  btn.addEventListener('pointercancel', _onActionDragEnd);
}

function _onActionDragMove(e) {
  const grid = document.getElementById('actions-grid');
  const buttons = [...grid.querySelectorAll('.action-btn')];

  // Find which button the pointer is over
  let overIndex = null;
  buttons.forEach((b, i) => {
    const r = b.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top  && e.clientY <= r.bottom) {
      overIndex = i;
    }
    b.classList.remove('drag-over');
  });

  if (overIndex !== null && overIndex !== _dragSrcIndex) {
    buttons[overIndex].classList.add('drag-over');
  }
}

function _onActionDragEnd(e) {
  const btn = e.currentTarget;
  btn.removeEventListener('pointermove', _onActionDragMove);
  btn.removeEventListener('pointerup',   _onActionDragEnd);
  btn.removeEventListener('pointercancel', _onActionDragEnd);
  btn.releasePointerCapture(e.pointerId);
  btn.classList.remove('dragging');

  const grid = document.getElementById('actions-grid');
  const buttons = [...grid.querySelectorAll('.action-btn')];
  buttons.forEach(b => b.classList.remove('drag-over'));

  // Find drop target
  let destIndex = null;
  buttons.forEach((b, i) => {
    const r = b.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top  && e.clientY <= r.bottom) {
      destIndex = i;
    }
  });

  if (destIndex !== null && destIndex !== _dragSrcIndex && _dragGroupId) {
    const group = ACTION_GROUPS[_dragGroupId];
    const ids = group.actions.slice(0, 6); // current rendered order
    const [moved] = ids.splice(_dragSrcIndex, 1);
    ids.splice(destIndex, 0, moved);
    // Update in memory: replace first N entries with new order
    group.actions = [...ids, ...group.actions.slice(6)];
    // Persist
    _saveGroupOrder(_dragGroupId);
    // Re-render
    _renderActionButtons(_dragGroupId);
  }

  _dragSrcIndex = null;
  _dragGroupId  = null;
}

function _saveGroupOrder(groupId) {
  try {
    const saved = JSON.parse(localStorage.getItem('actionsGroupOrder') || '{}');
    saved[groupId] = ACTION_GROUPS[groupId].actions;
    localStorage.setItem('actionsGroupOrder', JSON.stringify(saved));
  } catch(e) {}
}
```

### 5. Add CSS in `www/index.html`

Inside the `/* ─── Actions modal ─── */` block, add after `.action-btn-icon`:

```css
.action-drag-handle {
  position: absolute;
  top: 4px;
  right: 6px;
  font-size: 12px;
  color: rgba(255,255,255,0.2);
  cursor: grab;
  line-height: 1;
  user-select: none;
  padding: 2px 4px;
  border-radius: 2px;
  transition: color 0.15s ease;
}
.action-drag-handle:hover { color: rgba(255,255,255,0.5); }
.action-btn { position: relative; } /* ensure handle is positioned relative to button */
.action-btn.dragging {
  opacity: 0.4;
  cursor: grabbing;
}
.action-btn.drag-over {
  border-color: rgba(255,255,255,0.4);
  background: rgba(255,255,255,0.1);
}
```

Note: `.action-btn` already has `position` implicitly (flex), but must add `position: relative` explicitly for the absolute-positioned handle.

---

## Testing Strategy

1. **Basic reorder** — open actions modal, drag a button to a different slot, verify it moves in the grid.
2. **Persistence** — reload the page, reopen the modal, verify the reordered sequence is preserved.
3. **Per-group isolation** — reorder `living-room` group buttons; switch to `front-door` group; verify its order is unaffected.
4. **New action added to group** — manually add a new action ID to `actions.json` group; reload; verify new button appears appended after saved order.
5. **No accidental action press** — drag a button without releasing on itself; confirm no MQTT publish fires.
6. **>6 actions** — if group has 7 actions, only first 6 are shown; reorder affects only those 6; 7th is preserved in `group.actions` array.

---

## Acceptance Criteria

- [ ] Each action button shows a `≡` drag handle in its top-right corner
- [ ] Dragging a button to another slot reorders them in the grid immediately
- [ ] Reordered order persists in `localStorage` under `actionsGroupOrder`
- [ ] Order is restored correctly when the modal is reopened or the page is reloaded
- [ ] Dragging the handle does not trigger the button's action (no MQTT publish)
- [ ] Clicking the button body (not the handle) still fires the action normally
- [ ] Different groups maintain independent orderings

## Notes

- The `group.actions` array in memory is mutated in-place during reorder. This is fine — `ACTION_GROUPS` is rebuilt from `actions.json` on each page load, so mutations don't persist beyond the session; `localStorage` is the source of truth for ordering.
- Pointer capture is used (not mouse events) for cross-element drag, consistent with `camera-editor.js` pattern.
- No server-side persistence is needed for now; the actions settings editor (planned) can later expose ordering in the UI.
