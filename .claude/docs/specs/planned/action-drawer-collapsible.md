# Plan: action-drawer-collapsible

> Status: `planned`
> Last updated: 2026-04-06

## Task Description
In the actions editor, clicking a row that is already open should close its drawer rather than do nothing. The camera settings editor already implements this toggle guard in `openCamDrawer`. The same one-liner needs to be added to both `openAeActionDrawer` and `openAeGroupDrawer` in `www/js/actions-editor.js`.

## Objective
Both actions-editor drawer functions toggle closed when their row is clicked while already open, matching the behavior of the camera editor.

## Relevant Files
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions-editor.js`

## Step by Step Tasks
1. In `openAeActionDrawer(id)`, add the following as the very first line of the function body:
   ```js
   if (AE_OPEN_DRAWER === id) { closeAeDrawer(); return; }
   ```
2. In `openAeGroupDrawer(id)`, add the following as the very first line of the function body:
   ```js
   if (AE_OPEN_DRAWER === id) { closeAeDrawer(); return; }
   ```
3. Open the actions editor in a browser, open any action drawer, click the same row again, and confirm the drawer closes. Repeat for a group drawer.

## Acceptance Criteria
- Clicking an open action drawer row closes it.
- Clicking an open group drawer row closes it.
- Clicking a different row while one is open still switches to the new drawer (existing behavior unchanged).
- No other drawer behavior is affected.

## Validation Commands
```
# No build step required — open the kiosk in a browser and exercise the drawers manually.
open http://localhost/
```

## Notes
- `closeAeDrawer()` is the existing close function used elsewhere in the file; no new helper is needed.
- This is a two-line fix. No phases, no schema changes, no CSS changes required.
