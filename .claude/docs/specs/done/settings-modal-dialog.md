# Plan: Settings Modal Dialog

> Status: `planned`
> Last updated: 2026-04-09

## Task Description

Convert the settings overlay from a full-screen viewport takeover into a compact, centered modal dialog. The dialog must fit its content — no fixed height that leaves blank space on short tabs (General, Performance) — and scroll internally on tall tabs (Views, Cameras, Actions). A semi-transparent backdrop lets the video wall remain visible behind the dialog.

## Objective

Settings opens as a centered dialog box that:
- Is compact (no unused vertical space)
- Scrolls internally on tall tab content
- Shows the video wall dimly behind a backdrop
- Closes on ESC, ✕, and backdrop click (no JS changes needed)

## Problem Statement

The current `.modal` class fills `inset:0` with `rgba(15,15,15,0.96)` and `#settings-modal` stretches to full viewport via `align-items:stretch`. This completely hides the video wall and wastes space. A proper dialog should size to its content and float over the wall.

## Solution Approach

Two CSS layers:

**Layer 1 — backdrop:** `.modal` becomes a transparent dim overlay (`rgba(0,0,0,0.65)`), centring its child via flexbox. No change to `.modal.open`. The backdrop-click handler in `boot.js` already works (`e.target === el`).

**Layer 2 — dialog box:** `.settings-layout` becomes the visible dialog. It gets the dark background, border, border-radius, constrained max-width, and `max-height: 80vh`. **No fixed height** — height is determined by content up to the max. This prevents blank space on short tabs.

The critical flex detail: `.settings-content` needs `min-height: 0` so the browser allows it to shrink below its natural scroll height inside the flex container. Without this, the content area won't respect `max-height` on the parent and the dialog will overflow.

## Relevant Files

- `www/index.html` — all changes are CSS + one inline style removal on `#settings-modal`

## Step by Step Tasks

### 1. Update `.modal` to be a dim backdrop

Replace the `.modal` rule:

```css
.modal {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.65);
  display: none; align-items: center; justify-content: center;
  z-index: 1000;
  font-family: 'Courier New', monospace;
}
```

Remove `flex-direction: column`, `gap: 32px`, and the opaque background. Keep `display:none` / `.modal.open { display:flex }` unchanged.

### 2. Update `.settings-layout` to be the dialog box

Replace the `.settings-layout` rule:

```css
.settings-layout {
  display: flex;
  width: min(980px, 92vw);
  max-height: 80vh;
  background: rgb(13,13,13);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  box-shadow: 0 24px 80px rgba(0,0,0,0.7);
  overflow: hidden;
}
```

Key points:
- No `height` or `height:100%` — height is auto (determined by content)
- `max-height: 80vh` — caps dialog on tall tabs
- `overflow: hidden` — clips the border-radius cleanly; content scrolls inside `.settings-content`
- `width: min(980px, 92vw)` — sidebar (160px) + content area (~820px after padding)

### 3. Add `min-height: 0` to `.settings-content`

Update `.settings-content`:

```css
.settings-content { flex:1; overflow-y:auto; padding:32px 40px; position:relative; min-height:0; }
```

Also reduce padding from `40px 48px` to `32px 40px` — less wasted space on the sides.

`min-height: 0` is required for a flex child to honour `overflow-y: auto` when the parent has `max-height`. Without it, the flex algorithm sizes the child to its natural scroll height, ignoring the parent cap.

### 4. Add `min-height: 0` to `.settings-sidebar`

Update `.settings-sidebar`:

```css
.settings-sidebar { width:160px; min-width:160px; min-height:0; border-right:1px solid rgba(255,255,255,0.08); display:flex; flex-direction:column; gap:2px; padding:12px 8px; }
```

Sidebar content is short so it won't scroll, but `min-height:0` is correct hygiene for flex children.

### 5. Remove the inline style override from `#settings-modal`

In the HTML, change:
```html
<div id="settings-modal" class="modal" style="padding:0;align-items:stretch;">
```
to:
```html
<div id="settings-modal" class="modal">
```

The `align-items:stretch` and `padding:0` overrides are no longer needed since `.settings-layout` is now the dialog box (not the full `#settings-modal`).

### 6. Update the `@media (max-width: 900px)` rule

```css
@media (max-width: 900px) {
  .settings-layout { width: 96vw; }
  .settings-content { padding: 20px 24px; }
  .settings-sidebar { width: 110px; min-width: 110px; }
}
```

### 7. Validate

- Open the kiosk, press Escape → settings opens as a compact centered dialog
- On General tab: dialog is short, no empty vertical space below the last row
- On Views tab (with several views): dialog grows to `80vh` and the content area scrolls
- Click outside the dialog → closes
- ESC → closes
- ✕ button → closes
- Resize browser to 800px wide → dialog adapts with the media query

## Acceptance Criteria

- [ ] Settings modal appears as a centered dialog, not a full-screen overlay
- [ ] Video wall is visible (dimmed) behind the backdrop
- [ ] Dialog height is determined by content, not a fixed value
- [ ] Short tabs (General, Performance) produce a compact dialog with no blank space below content
- [ ] Tall tabs (Views, Cameras, Actions) cap at `80vh` and scroll internally
- [ ] All existing tab content and editors work correctly
- [ ] ESC, ✕, and backdrop click close the modal
- [ ] No regressions in unsaved-changes banners (sticky bottom inside `.settings-content`)

## Notes

- The `.modal h1` and `.modal-hint` rules can stay — they're used by other elements inside `.settings-content` (h1 in General tab, modal-hint in Views/Cameras).
- The `cam-unsaved-banner` uses `position:sticky; bottom:0` inside `.settings-content` — this works correctly because `.settings-content` is the scroll container.
- `.modal` is only used by `#settings-modal`. No other element has `class="modal"` in the HTML.
- Backdrop click already wired in `boot.js`: `['settings-modal'].forEach(id => { el.addEventListener('click', e => { if (e.target === el) closeAllModals(); }); })` — clicks on `.settings-layout` bubble up but `e.target` will be the inner element, not `el`, so this is safe.
