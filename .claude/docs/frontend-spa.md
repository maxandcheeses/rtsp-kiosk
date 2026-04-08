# Frontend SPA — index.html

## Structure

Single HTML file. Contains:
- Inline `<style>` block with all CSS
- Env var placeholders replaced by `envsubst` at container start (see below)
- Modal HTML for: `settings-modal`, `performance-modal`, `views-modal`, `streams-modal`, `cameras-modal`
- Actions modal HTML: `actions-modal` + `actions-backdrop` (fixed-position overlay, not a `.modal` class)
- `<script>` inline block for env vars
- `<script src>` tags in load order (see below)

## Env Var Placeholders

These are literal `$VAR` strings replaced at runtime — do not change format:
- `${FORCE_LAYOUT}` — forces layout, empty = use views
- `${FULLSCREEN_TIMEOUT}` — seconds before fullscreen exits (0 = off)
- `${STREAM_REFRESH}` — global stream refresh interval in seconds
- `${ENABLE_MODALS}` — "false" disables keyboard shortcuts and modal access
- `${ENABLE_PRELOAD}` — enables preload lead time setting in views editor

## Script Load Order

```
/mqtt.min.js    (external, loaded in <head>)
@mdi/font       (CDN CSS in <head>)
/js/config.js
/js/layouts.js
/js/webrtc.js
/js/views.js
/js/ui.js
/js/mqtt.js
/js/camera-editor.js
/js/debug.js
/js/views-editor.js
/js/actions.js
/js/boot.js
```

All JS is global scope — no modules.

## Modals

### `.modal` class modals (full-screen overlay)
These use `display:none` / `.open` class toggle:
- `streams-modal` — stream debug info
- `views-modal` — views CRUD
- `settings-modal` — settings/shortcuts (also contains the fullscreen timeout input)
- `performance-modal` — perf settings
- `cameras-modal` — camera CRUD

All 5 are registered in:
1. `closeAllModals()` in `ui.js`
2. `anyOpen` array in the `keydown` handler in `ui.js`
3. Backdrop-click forEach in `boot.js`
4. Each has a `✕` close button (`onclick="closeAllModals()"`)

### Actions modal (fixed-position panel)
- `actions-modal` — fixed panel positioned over the triggering cell
- `actions-backdrop` — semi-transparent full-screen backdrop with `onclick="closeActionsModal()"`
- Uses `style.display` toggle, not `.open` class
- Has its own `✕` button (`onclick="closeActionsModal()"`)
- ESC closes it first (handled in `ui.js` keydown, checked before `anyOpen`)
- Not in `closeAllModals()` — managed separately via `closeActionsModal()`

## CSS

Theming via CSS custom properties is not currently used — styles are inline rgba values throughout. Keep specificity low.

### Close button — `.modal-close-btn`

All 7 modal close buttons (6 `.modal` modals + `actions-modal`) use this single class. Defined near the top of the style block before modal-specific rules. Spec: `position:absolute; top:14px; right:16px; 28×28px; transparent background; border 1px rgba(255,255,255,0.12); border-radius:4px`. Hover state turns red (`rgba(248,113,113,*)`). No inline styles on any close button.

The `sp-btn` class is used for small reorder/remove buttons within modal content (not close buttons).

Action indicator button (`.action-indicator`) is injected into cells by `layouts.js` when a slot has an assigned action group.
