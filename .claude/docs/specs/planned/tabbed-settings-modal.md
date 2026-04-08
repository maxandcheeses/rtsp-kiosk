# Plan: Tabbed Settings Modal

> Status: `planned`
> Last updated: 2026-04-06

## Task Description

Replace all six separate settings-related modals with a single unified `#settings-modal` that has a left-side vertical tab bar. Each existing modal becomes a tab panel inside the unified container. This eliminates the `openFromSettings()` / `returnToSettings` indirection pattern, simplifies the modal lifecycle, and gives the operator a single place to access every configuration area.

## Objective

One full-screen `#settings-modal` with six tabs (General, Views, Cameras, Actions, Performance, Streams). Keyboard shortcuts and internal call sites open the modal pre-navigated to the correct tab. All five removed modals (`#performance-modal`, `#cameras-modal`, `#views-modal`, `#actions-settings-modal`, `#streams-modal`) are deleted from the DOM.

## Problem Statement

Six separate modals require duplicated open/close logic, a special `returnToSettings` flag, a backdrop array with six entries, and a growing list of `openXxxModal()` entry points. Adding more settings surfaces worsens this fragmentation. A unified tabbed modal is the correct structural answer.

## Solution Approach

The `#settings-modal` div becomes a flex container: 160 px sidebar on the left, scrollable content area on the right. Each tab panel is a `div` shown/hidden via `style.display`. Dynamic content (cameras, views, actions, streams) is rendered lazily when the user switches to that tab, using the same fetch/render logic that existing editor files already contain — just exposed under new function names (`renderCamerasTab`, `renderViewsTab`, `renderActionsTab`, `renderStreamsTab`). No new data layer is needed.

## Relevant Files

- `/Users/maxwell/Documents/development/rtsp-kiosk/www/index.html`
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/css/app.css`
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/ui.js`
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/boot.js`
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/camera-editor.js`
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/views-editor.js`
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions-editor.js`

## Implementation Phases

### Phase 1 — HTML restructure
Replace the six modal divs in `index.html` with the unified `#settings-modal` layout. Move performance HTML into `#stab-performance`. Add skeleton divs for the other five tab panels. Add CSS to `app.css`.

### Phase 2 — Core JS (`ui.js`)
Add `activateSettingsTab(tab)`, update `openSettingsModal(tab)`, add `renderStreamsTab()`, remove `openFromSettings`/`returnToSettings`, update keyboard shortcuts, update `closeAllModals()` and `anyOpen`.

### Phase 3 — Editor JS files
Expose `renderCamerasTab()` in `camera-editor.js`, `renderViewsTab()` in `views-editor.js`, `renderActionsTab()` in `actions-editor.js`. Update `openActionsSettingsModal()` to delegate to `openSettingsModal('actions')`. Patch any `closeAllModals()` calls inside editors that previously re-opened a parent modal.

### Phase 4 — Boot + call sites
Simplify `boot.js` backdrop array to `['settings-modal']`. Audit all other call sites of the removed modal open functions and redirect to `openSettingsModal(tab)`.

## Step by Step Tasks

1. **`app.css`** — Add the following rule blocks after the existing `.modal` section:
   ```css
   .settings-layout { display:flex; width:100%; height:100%; }
   .settings-sidebar { width:160px; min-width:160px; border-right:1px solid rgba(255,255,255,0.08); display:flex; flex-direction:column; gap:2px; padding:12px 8px; }
   .settings-tab-btn { width:100%; text-align:left; padding:8px 12px; background:transparent; border:1px solid transparent; border-radius:3px; color:rgba(255,255,255,0.45); font-family:'Courier New',monospace; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; cursor:pointer; transition:all 0.15s; }
   .settings-tab-btn:hover { color:rgba(255,255,255,0.7); background:rgba(255,255,255,0.04); }
   .settings-tab-btn.active { color:rgba(255,255,255,0.9); background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.2); }
   .settings-content { flex:1; overflow-y:auto; padding:40px 48px; position:relative; }
   .settings-tab-panel { display:block; }
   .settings-tab-panel[style*="display:none"] { display:none !important; }
   ```

2. **`index.html`** — Replace the old `#settings-modal` div with the unified layout using the HTML structure from the Architecture Decisions section. The `#stab-general` panel receives the keyboard shortcut hints (Esc, ←→, Space — informational only), audio toggle, fullscreen timeout input, and clear-data button. Remove the `shortcut-row` entries that were links to child modals (C, V, A, S, P). The `#stab-performance` panel receives the full performance form HTML previously inside `#performance-modal`. The other four panels (`#stab-views`, `#stab-cameras`, `#stab-actions`, `#stab-streams`) are empty skeleton divs — content is rendered dynamically.

3. **`index.html`** — Delete the five now-removed modal divs: `#performance-modal`, `#cameras-modal`, `#views-modal`, `#actions-settings-modal`, `#streams-modal`.

4. **`ui.js`** — Add module-level variable `let _activeSettingsTab = 'general';`.

5. **`ui.js`** — Add `activateSettingsTab(tab)` function as specified: hide all `.settings-tab-panel` divs, show `#stab-${tab}`, toggle `.active` class on `.settings-tab-btn` elements, then call the appropriate render function for dynamic tabs (`renderCamerasTab`, `renderViewsTab`, `renderActionsTab`, `renderStreamsTab`).

6. **`ui.js`** — Update `openSettingsModal(tab = 'general')`: call `closeAllModals()`, add `open` class to `#settings-modal`, call `activateSettingsTab(tab)`.

7. **`ui.js`** — Add `renderStreamsTab()`: same body as the current `openStreamsModal()` but without the `.classList.add('open')` call (the modal is already open).

8. **`ui.js`** — Remove `openFromSettings(which)` function entirely. Remove all `returnToSettings` logic from any modal close handlers.

9. **`ui.js`** — Update keyboard shortcut handler: `C` → `openSettingsModal('cameras')`, `V` → `openSettingsModal('views')`, `A` → `openSettingsModal('actions')`, `S` → `openSettingsModal('streams')`, `P` → `openSettingsModal('performance')`. `Escape` when settings is open → `closeAllModals()`.

10. **`ui.js`** — Update `closeAllModals()`: remove `.classList.remove('open')` calls for the five deleted modals; keep only `document.getElementById('settings-modal').classList.remove('open')`. Update `anyOpen` (or equivalent guard) to check only `['settings-modal']`.

11. **`boot.js`** — Find the backdrop-click registration array and reduce it to `['settings-modal']` only. Remove entries for the five deleted modal ids.

12. **`camera-editor.js`** — Add `function renderCamerasTab()` that runs the fetch + render logic currently inside `openCamerasModal()`. Update `openCamerasModal()` to call `openSettingsModal('cameras')` (it will be called by `activateSettingsTab` when the user switches to the cameras tab). Remove any internal call to `closeAllModals()` that previously re-opened the parent settings modal.

13. **`views-editor.js`** — Add `function renderViewsTab()` that runs the render logic currently inside `openViewsModal()` (populating `#views-tbody`, initialising drag, etc.). Update `openViewsModal()` to call `openSettingsModal('views')`. Ensure the view-edit sub-panel's "back" button calls `renderViewsTab()` to return to the table (not `openViewsModal()`). Remove any stale `returnToSettings` references.

14. **`actions-editor.js`** — Add `function renderActionsTab()` that triggers the data load + render currently inside `openActionsSettingsModal()`. Update `openActionsSettingsModal()` to call `openSettingsModal('actions')`. Remove any `returnToSettings` references.

15. **Audit remaining call sites** across all JS files for `openCamerasModal()`, `openViewsModal()`, `openActionsSettingsModal()`, `openStreamsModal()`, and the performance modal open call. Redirect each to `openSettingsModal('cameras')`, `openSettingsModal('views')`, `openSettingsModal('actions')`, `openSettingsModal('streams')`, `openSettingsModal('performance')` respectively.

## Testing Strategy

- Open settings (keyboard `S` equivalent, or click settings button) — verify General tab is active.
- Click each tab in the sidebar — verify correct panel appears, tab button is highlighted.
- Press `C`, `V`, `A`, `S`, `P` keyboard shortcuts — verify settings modal opens pre-navigated to the correct tab.
- Press `Escape` — verify modal closes.
- Click outside the modal (backdrop) — verify modal closes.
- Navigate to Cameras tab, edit a camera, save — verify no modal-close regression.
- Navigate to Views tab, open a view for editing, press back — verify returns to views list (not closing modal).
- Navigate to Actions tab — verify the MQTT/Actions/Groups sub-tabs still render and function.
- Navigate to Streams tab — verify stream debug table renders.
- Navigate to Performance tab — verify performance inputs are present and save correctly.

## Acceptance Criteria

- `#settings-modal` is the only settings-related modal in the DOM; the five old modal divs do not exist.
- All six tabs render their content correctly.
- All keyboard shortcuts (`C`, `V`, `A`, `S`, `P`, `Escape`) work as described.
- `closeAllModals()` references only `#settings-modal`.
- `boot.js` backdrop array contains only `['settings-modal']`.
- `openFromSettings()` and `returnToSettings` no longer exist anywhere in the codebase.
- No console errors when switching between tabs multiple times.
- The actions editor's MQTT/Actions/Groups sub-tabs continue to function normally inside `#stab-actions`.
- The views editor's edit-view sub-panel back button returns to the views list without closing the modal.

## Validation Commands

```sh
# Verify removed modal ids are gone from HTML
grep -n "performance-modal\|cameras-modal\|views-modal\|actions-settings-modal\|streams-modal" www/index.html
# Should return no matches (other than stab- prefixed panel ids)

# Verify returnToSettings is removed
grep -rn "returnToSettings\|openFromSettings" www/js/
# Should return no matches

# Verify closeAllModals only references settings-modal
grep -A 10 "function closeAllModals" www/js/ui.js

# Verify boot.js backdrop array
grep -A 5 "backdrop" www/js/boot.js

# Build and smoke-test in dev compose
docker compose -f docker-compose.dev.yml up -d
# Open http://localhost:8080 and exercise all tabs + shortcuts
```

## Notes

- The `actions-settings-editor` spec (`.claude/docs/specs/planned/actions-settings-editor.md`) describes the actions editor as a standalone modal (`#actions-settings-modal`). After this refactor, that editor lives inside `#stab-actions`. The actions-settings-editor spec should be updated after this task to reflect the new container — its internal tab structure and data layer are unchanged.
- The `#settings-modal` div uses `.modal` CSS class which handles the full-screen overlay. Override `padding:0` and `align-items:stretch` inline on the element so the `.settings-layout` flex container fills the full modal area.
- The views editor `#view-edit-panel` sub-panel stays inside `#stab-views`. Confirm its back-navigation calls `renderViewsTab()` and does not call `openViewsModal()` (which now delegates to `openSettingsModal('views')` and would re-trigger tab activation logic unnecessarily).
- If `renderStreamsTab()` or other render functions are called before the settings modal is open (e.g., from a keyboard shortcut path), they must be safe to call with the modal already open and the panel visible — no double-initialisation issues.
- The `architecture.md` section 13 (keyboard shortcuts) and section 5 (app.js section map) reference old function names. Those docs should be updated in a follow-up — out of scope for this task.
