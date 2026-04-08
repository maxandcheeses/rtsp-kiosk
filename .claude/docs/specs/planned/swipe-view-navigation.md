# Plan: swipe-view-navigation

> Status: `planned`
> Last updated: 2026-04-06

## Task Description

Add horizontal swipe gesture support to the kiosk so that tablet and touchscreen users can navigate between views by swiping left or right on the `#wall`. The keyboard equivalent (`ArrowRight` / `ArrowLeft`) already calls `navigateView(direction)` in `www/js/views.js`. This task wires up the same function to touch events with appropriate gesture detection thresholds and modal guards.

## Objective

After implementation, a user can swipe left on the wall to advance to the next view and swipe right to go to the previous view, with the same guard conditions as keyboard navigation (no modals open, more than one view exists).

## Relevant Files

- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/ui.js` — keyboard nav lives here; swipe logic goes here too
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/boot.js` — existing `touchstart` listener at line 76; touch listeners for swipe are registered here or at the bottom of `ui.js` (see Notes)
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/views.js` — `navigateView(direction)` at line 215; no changes needed
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions.js` — exports `ACTIONS_MODAL_OPEN` (line 9); must be read in the guard check

## Step by Step Tasks

1. **Add swipe state variables to `www/js/ui.js`.**
   At module scope (near the top or just above the `keydown` listener), declare:
   ```js
   let _touchStartX = 0;
   let _touchStartY = 0;
   let _touchStartTime = 0;
   let _swipeBlocking = false;
   ```

2. **Add `handleTouchStart` in `www/js/ui.js`.**
   - If `e.touches.length > 1` → return immediately (ignore multi-touch).
   - Record `_touchStartX = e.touches[0].clientX`, `_touchStartY = e.touches[0].clientY`, `_touchStartTime = Date.now()`.
   - Reset `_swipeBlocking = false`.

3. **Add `handleTouchMove` in `www/js/ui.js`.**
   - Compute `deltaX = e.touches[0].clientX - _touchStartX` and `deltaY = e.touches[0].clientY - _touchStartY`.
   - If `|deltaX| > |deltaY|`, set `_swipeBlocking = true` and call `e.preventDefault()` to suppress scroll.
   - If `|deltaX| <= |deltaY|`, ensure `_swipeBlocking` stays false (vertical scroll, do not interfere).

4. **Add `handleTouchEnd` in `www/js/ui.js`.**
   Build the same `anyOpen` guard used by the keyboard handler:
   ```js
   const anyOpen = ['streams-modal','views-modal','settings-modal','performance-modal','cameras-modal','actions-settings-modal']
     .some(id => document.getElementById(id)?.classList.contains('open'));
   ```
   Then apply all guards before acting:
   - `VIEWS.length <= 1` → return
   - `anyOpen` → return
   - `typeof ACTIONS_MODAL_OPEN !== 'undefined' && ACTIONS_MODAL_OPEN` → return

   Compute final gesture:
   - `deltaX = e.changedTouches[0].clientX - _touchStartX`
   - `deltaY = e.changedTouches[0].clientY - _touchStartY`
   - `elapsed = Date.now() - _touchStartTime`

   Trigger condition (either):
   - Standard: `|deltaX| >= 50` and `|deltaX| > |deltaY|`
   - Fast-flick: `elapsed < 300` and `|deltaX| >= 20` and `|deltaX| > |deltaY|`

   Direction:
   - `deltaX < 0` → `navigateView(1)` (swipe left = next)
   - `deltaX > 0` → `navigateView(-1)` (swipe right = prev)

5. **Register touch listeners.**
   At the bottom of `www/js/ui.js` (alongside the existing `document.addEventListener('keydown', ...)` block), add:
   ```js
   document.addEventListener('touchstart',  handleTouchStart, { passive: true });
   document.addEventListener('touchmove',   handleTouchMove,  { passive: false });
   document.addEventListener('touchend',    handleTouchEnd,   { passive: true });
   ```
   The `touchmove` listener must use `{ passive: false }` to allow `e.preventDefault()` to work.
   The existing `touchstart` listener in `boot.js` (line 76) calls `markInteracted()` and `showSettingsBtn()` — leave it untouched. Both listeners will fire independently.

## Acceptance Criteria

- Swiping left on the wall advances to the next view (same as `ArrowRight`).
- Swiping right on the wall goes to the previous view (same as `ArrowLeft`).
- Swipe does nothing when only one view exists.
- Swipe does nothing when any CSS-class modal is open.
- Swipe does nothing when the actions modal is open (`ACTIONS_MODAL_OPEN === true`).
- Vertical scrolling (e.g. in a modal) is not blocked by the swipe handler.
- Multi-touch (pinch/zoom) is ignored.
- The existing `touchstart` handler in `boot.js` (settings button reveal) still fires normally.
- The `showIndicator` arrow + view name feedback appears on swipe, same as keyboard nav.

## Validation Commands

```sh
# Start dev compose and open on a touch device or browser DevTools touch simulation
docker compose -f docker-compose.dev.yml up

# In Chrome DevTools:
# 1. Enable device toolbar (touch simulation)
# 2. Load http://localhost:8080
# 3. Swipe left → confirm next view activates with indicator
# 4. Swipe right → confirm previous view activates with indicator
# 5. Open any modal, swipe → confirm no navigation occurs
# 6. Set up single view, swipe → confirm nothing happens
# 7. Swipe vertically → confirm no navigation, page behaves normally
```

## Notes

- `ACTIONS_MODAL_OPEN` is a module-level `let` in `actions.js` (not a global constant). Access it as a bare name — it is hoisted to the module scope that `ui.js` shares when bundled, or available as a global if `actions.js` loads before `ui.js`. Verify variable visibility at runtime; if not accessible, guard with `typeof ACTIONS_MODAL_OPEN !== 'undefined'`.
- No swipe animation is needed for v1. `navigateView` already calls `showIndicator` which provides directional feedback.
- If the kiosk display uses `overflow: hidden` on `body`, scroll prevention via `e.preventDefault()` in `touchmove` may be redundant but is still correct and harmless.
- The `{ passive: false }` option on `touchmove` is required for `preventDefault()` to take effect in modern browsers. Omitting it silently ignores the call in Chrome/Safari.
- Fast-flick threshold (300ms / 20px) handles quick tap-flick gestures where the finger doesn't travel far but intent is clear.
- Future: consider swipe-up / swipe-down for pause/resume cycling (analogous to `Space` key). Out of scope for v1.
