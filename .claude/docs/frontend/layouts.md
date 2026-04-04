# Layout System

## LAYOUTS Object

Defined in `app.js` around line 579. Each key is a layout name used throughout the codebase (in `LAYOUTS`, `LAYOUT_RECTS`, picker buttons, and `views.json`).

```js
const LAYOUTS = {
  'single':         { streams: 1, css: { cols: '1fr',             rows: '1fr' } },
  'two-col':        { streams: 2, css: { cols: '1fr 1fr',         rows: '1fr' } },
  'two-row':        { streams: 2, css: { cols: '1fr',             rows: '1fr 1fr' } },
  'primary-right':  { streams: 3, css: { cols: '2fr 1fr',         rows: '1fr 1fr' },
                      spans: [{ col: '1', row: '1 / 3' }] },
  'primary-left':   { streams: 3, css: { cols: '1fr 2fr',         rows: '1fr 1fr' },
                      spans: [null, null, { col: '2 / 3', row: '1 / 3' }] },
  'primary-bottom': { streams: 3, css: { cols: '1fr 1fr',         rows: '2fr 1fr' },
                      spans: [{ col: '1 / 3', row: '1 / 2' }] },
  'primary-top':    { streams: 3, css: { cols: '1fr 1fr',         rows: '1fr 2fr' },
                      spans: [null, null, { col: '1 / 3', row: '2 / 3' }] },
  'quad':           { streams: 4, css: { cols: '1fr 1fr',         rows: '1fr 1fr' } },
  'six':            { streams: 6, css: { cols: '1fr 1fr 1fr',     rows: '1fr 1fr' } },
  'eight':          { streams: 8, css: { cols: '1fr 1fr 1fr 1fr', rows: '1fr 1fr' } },
};
```

### Fields

- `streams` — number of stream slots. `applyLayout` caps at `Math.min(layout.streams, STREAMS.length, PERF.maxStreams)`.
- `css.cols` / `css.rows` — set directly on `#wall` as `gridTemplateColumns` / `gridTemplateRows`.
- `spans[]` — optional array, one entry per stream slot. Each entry is `{ col, row }` or `null`. Applied as `cell.style.gridColumn` / `cell.style.gridRow`. The `spans` array is sparse — use `null` placeholders for slots that need no override.

### spans index mapping (primary layouts)

| Layout | Slot 0 | Slot 1 | Slot 2 |
|--------|--------|--------|--------|
| `primary-right` | large left (spans 2 rows) | top right | bottom right |
| `primary-left` | top left | bottom left | large right (spans 2 rows) |
| `primary-bottom` | large top (spans 2 cols) | bottom left | bottom right |
| `primary-top` | top left | top right | large bottom (spans 2 cols) |

---

## Cell DOM Structure

`applyLayout` clears `#wall.innerHTML` and rebuilds one `.cell` div per stream slot.

```html
<div class="cell" id="cell{i}">
  <div class="loading" id="load{i}">
    <div class="ring"></div>
  </div>
  <div class="err-overlay" id="err{i}">
    <div class="err-inner">
      <div class="err-code">No Signal</div>
      <div class="err-sub">{stream.label}</div>
    </div>
  </div>
  <video id="v{i}" autoplay muted playsinline style="object-fit:{stream.objectFit}"></video>
  <div class="chrome">
    <div class="live">
      <div class="live-row">
        <span id="lbl{i}">LIVE</span>
        <span class="dot" id="dot{i}"></span>
      </div>
      <div class="lbl">{stream.label}</div>
    </div>
    <button class="btn-fs" onclick="toggleFS({i})">…</button>
  </div>
</div>
```

### State classes

| Element | Class change | Meaning |
|---------|-------------|---------|
| `#load{i}` | add `.gone` | Fade out loading spinner |
| `#err{i}` | add `.show` | Show "No Signal" overlay |
| `#dot{i}` | add `.err` | Turn status dot red |
| `#lbl{i}` | textContent `'ERR'` | Label shows error state |

All four are updated together by `setLive()` and `setError()` closures inside `startWhep`.

### objectFit
Applied inline on the `<video>` element from `stream.objectFit` (defaults to `'contain'`). Do not set `aspect-ratio` on `.cell` — it fights the CSS grid sizing and causes clipping.

---

## How to Add a New Layout

Five places must be updated. Missing any one causes the layout to silently fail or produce a broken picker icon.

1. **`www/js/app.js` — `LAYOUTS`** (~line 579): add entry with `streams`, `css`, and optional `spans`.

2. **`www/js/app.js` — `LAYOUT_RECTS`** (~line 1119): add SVG rect geometry used to generate the picker icon. Each entry is an array of `{ x, y, w, h }` objects (normalised 0–1 coordinates).

3. **`www/js/app.js` — `bestLayout()`** (~line 605): if the layout should be auto-selected by stream count, add a branch here.

4. **`www/index.html` — `#picker` layout grid**: add a `<button class="layout-btn" onclick="applyLayout('your-name')">` with label text. The SVG icon is generated at runtime via `layoutSvgWithNumbers()` — the button only needs the `onclick`.

5. **`www/index.html` — `#views-modal` layout grid**: add a matching `<button class="ve-layout-btn" data-layout="your-name">` so the layout appears in the views editor.

### Layout naming convention

Existing names follow a `noun` or `adjective-noun` pattern describing the dominant feature (`single`, `quad`, `primary-right`). Keep names lowercase with hyphens.
