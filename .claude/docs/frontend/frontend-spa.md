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
