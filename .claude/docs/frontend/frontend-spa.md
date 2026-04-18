# Frontend SPA — index.html

## File Role

`www/index.html` is the single HTML file for the entire SPA. It contains:
- Inline CSS (all styles are here, not in `app.css` — `app.css` does not exist as of current codebase)
- All modal HTML
- The `#wall` grid container
- An inline `<script>` block for env var constants
- `<script src="/js/app.js?v=2">` at the very end of `<body>`

The file is served after `envsubst` replaces placeholder strings at container startup. In dev mode (`docker-compose.dev.yml`) the file is live-mounted, but `envsubst` does not run — placeholders remain as literal `$VAR` strings, which evaluate to empty strings or their falsy defaults in JS.

---

## Document Structure

```
<head>
  meta, title, favicon
  <style>  ← all inline CSS

<body>
  #wall                     ← CSS grid; cells injected here by applyLayout()
  #cycle-indicator          ← brief overlay shown on view change / pause
  #debug-overlay            ← live debug info (toggled by PERF.debugOverlay)
  #settings-btn             ← gear button, appears on hover/interaction

  <!-- Unified Settings Modal -->
  #settings-modal           ← tabbed modal with sidebar nav (.settings-layout)
    .settings-sidebar       ← vertical tab buttons
    .settings-content       ← scrollable tab panels
      #stab-general         ← keyboard hints, audio toggle, fs timeout, clear-data
      #stab-views           ← views CRUD editor (renderViewsTab fills this)
      #stab-cameras         ← camera settings (renderCamerasTab fills this)
      #stab-actions         ← actions editor / MQTT (renderActionsTab fills this)
      #stab-performance     ← PERF settings (static HTML)
      #stab-streams         ← live stream status table (renderStreamsTab fills this)

  <!-- Actions panel modal (separate from settings) -->
  #actions-modal            ← triggered per-stream by action indicator button
  #actions-backdrop

  <!-- Scripts -->
  <script>  ← env var constants (inline, envsubst target)
  <script src="/js/...">    ← 10 module files
```

---

## Modals

Only `#settings-modal` is a full-screen overlay modal. It uses `.modal.open` for visibility.

| ID | Trigger | Purpose |
|----|---------|---------|
| `#settings-modal` | `#settings-btn`, `Esc`, or any shortcut key (C/V/A/P/S) | Unified tabbed settings |
| `#actions-modal` | Action indicator button on stream cell | Per-stream action buttons |

`closeAllModals()` now only removes `.open` from `#settings-modal`.

### Tab activation
`openSettingsModal(tab?)` opens to a specific tab (default `'general'`). `activateSettingsTab(tab)` switches tabs without reopening. On tab switch, render functions are called lazily:
- `cameras` → `renderCamerasTab()`
- `views` → `renderViewsTab()`
- `actions` → `renderActionsTab()`
- `streams` → `renderStreamsTab()` (always runs)

Keyboard shortcuts C/V/A/P/S open the modal to the corresponding tab, or close it if already on that tab.

---

## Env Var Placeholders

These literal strings live in the inline `<script>` block near the bottom of `<body>`. `envsubst` replaces them at container start. Do not move them to `app.js` — Nginx's envsubst only processes `index.html`.

| Placeholder | JS variable | Type after substitution | Behaviour when empty |
|-------------|-------------|------------------------|----------------------|
| `$FORCE_LAYOUT` | `FORCE_LAYOUT` | string | `''` — shows layout picker |
| `$FULLSCREEN_TIMEOUT` | `FULLSCREEN_TIMEOUT` | number (seconds) | `30` (default baked into the expression) |
| `$STREAM_REFRESH` | `STREAM_REFRESH_GLOBAL` | number or null | `null` — honour per-stream `refreshInterval` only |
| `$ENABLE_MODALS` | `ENABLE_MODALS` | boolean | `true` (only `'false'` disables it) |
| `$ENABLE_PRELOAD` | `ENABLE_PRELOAD` | boolean | `false` (only `'1'`, `'on'`, `'true'` enable it) |

### Gotcha: dev mode

In dev mode placeholders are not substituted. `$FORCE_LAYOUT` stays as the string `'$FORCE_LAYOUT'`, which is truthy — this will force a (nonexistent) layout and skip the picker. If you need the picker in dev, hardcode `const FORCE_LAYOUT = '';` temporarily in `index.html`.

### Gotcha: FULLSCREEN_TIMEOUT default

The expression `'$FULLSCREEN_TIMEOUT' ? Number('$FULLSCREEN_TIMEOUT') : 30` evaluates the substituted string. If the env var is unset, envsubst leaves the literal `$FULLSCREEN_TIMEOUT` in place — a non-empty string — so it becomes `Number('$FULLSCREEN_TIMEOUT')` which is `NaN`. In practice the docker-compose default is `"30"`, so this is only a risk in custom deployments that omit the var entirely.

---

## CSS Notes

All CSS is inline in `index.html` (not in a separate file). Key points:
- `cursor: none` on `body` — kiosk display, no mouse cursor shown
- `.chrome` is `opacity: 0` by default; shown on `.cell:hover` — overlay controls per stream
- `.modal` uses `display: none` / `display: flex` via `.open` class toggle (not visibility/opacity)
- Loading spinner uses `.loading.gone` (opacity transition to 0) not display removal, so the fade-out is smooth
- Error overlay uses `.err-overlay.show` which switches `display` directly (no transition — error should be immediate)

### Responsive / fluid scaling

`:root` defines CSS custom properties using `clamp()` with `vw` units to scale from ~800px up to 4K:

| Variable | Min | Preferred | Max | Usage |
|---|---|---|---|---|
| `--fs-xs` | 8px | 0.45vw | 13px | `.chrome .lbl`, `.err-sub` |
| `--fs-sm` | 9px | 0.55vw | 15px | `.chrome .live`, `.err-code` |
| `--fs-md` | 10px | 0.65vw | 18px | (reserved for larger labels) |
| `--chrome-inset` | 10px | 0.75vw | 20px | `.live` top/right, `.btn-fs` bottom/right |
| `--btn-fs-size` | 28px | 1.8vw | 48px | `.btn-fs` width/height |
| `--ring-size` | 22px | 1.5vw | 42px | `.ring` width/height |

The SVG inside `.btn-fs` is generated by `layouts.js` with hardcoded `width="13" height="13"`. A CSS override `.chrome .btn-fs svg { width: 45%; height: 45%; }` overrides this so the icon scales with its container.

A media query at `max-width: 900px` reduces `.settings-tab-panel` padding and `.settings-sidebar` width for smaller viewports.

### Settings tab scroll architecture

The settings modal uses a **flex scroll architecture** rather than sticky-header hacks. `.settings-content` is a flex column container with `overflow:hidden` — it does not scroll. Each `.settings-tab-panel` fills the available height (`flex:1; display:flex; flex-direction:column; min-height:0; overflow:hidden; padding:32px 56px 32px 40px`).

Tabs with a fixed header use a **header + `.tab-scroll-body`** split:

| Tab | Fixed header | Scroll body |
|-----|-------------|-------------|
| Cameras (`#stab-cameras`) | `.cam-toolbar` | `.tab-scroll-body` wrapping table + hint + `.cam-unsaved-banner` |
| Views (`#stab-views`) | `.views-toolbar` (inside `#views-table-wrap`) | `.tab-scroll-body` wrapping table + hint |
| Streams (`#stab-streams`) | `<thead>` sticky inside scroll body | `.tab-scroll-body` wrapping the whole table |

`.tab-scroll-body` is `flex:1; overflow-y:auto; min-height:0`. Table `<thead>` rows inside a `.tab-scroll-body` use `position:sticky; top:0` scoped via `.tab-scroll-body .streams-table th`.

Tabs without a fixed header just scroll the whole panel:
- `#stab-general` and `#stab-performance` override to `overflow-y:auto`.

**Actions tab** (`#stab-actions`): content is JS-rendered into `#ae-content` → `#ae-tabs-and-content` → `.ae-tab-nav` + `.ae-tab-body`. The CSS chain `#ae-content, #ae-tabs-and-content { display:flex; flex-direction:column; flex:1; min-height:0; }` and `.ae-tab-body { flex:1; overflow-y:auto; min-height:0; }` handle the scroll without any `max-height` calc.

**Views edit form** (`#view-edit-panel`): toggled by JS (shown instead of `#views-table-wrap`). Gets `flex:1; overflow-y:auto; min-height:0` from CSS so it fills the panel and scrolls when the form is tall.

The `.cam-unsaved-banner` uses `position:sticky; bottom:0` inside `.tab-scroll-body` to pin to the bottom of the scroll container.
