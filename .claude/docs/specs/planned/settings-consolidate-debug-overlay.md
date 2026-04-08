# Plan: Settings — Consolidate Debug Overlay into General Tab

> Status: `planned`
> Last updated: 2026-04-06

## Task Description
The settings modal has two tabs: General and Performance. The Debug overlay toggle currently sits in the Performance tab under a "Debug" section heading. It is a display preference (shows stream info, source, refresh, and view countdown on screen), not a performance tuning knob. Moving it to the General tab improves discoverability alongside other display/UX preferences (audio toggle, fullscreen timeout).

## Objective
Remove the Debug section block from the Performance tab and insert the debug overlay toggle row into the General tab, preserving the exact element `id` and `onchange` handler so no JS changes are required.

## Relevant Files
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/index.html` — only file modified

## Step by Step Tasks

1. **Add debug overlay row to General tab.** In `www/index.html`, locate the `.shortcut-list` inside `#stab-general`. Insert the following `.shortcut-row` block after the fullscreen timeout row and before the clear-data row:
   ```html
   <div class="shortcut-row">
     <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
       <span>Debug overlay
         <small style="display:block;color:var(--muted)">Shows stream info, source, refresh and view countdown on screen</small>
       </span>
       <label class="toggle" style="margin-left:auto">
         <input type="checkbox" id="perf-debug-overlay" onchange="savePerfSettings()">
         <span class="toggle-track"></span>
       </label>
     </div>
   </div>
   ```
   Preserve `id="perf-debug-overlay"` and `onchange="savePerfSettings()"` exactly.

2. **Remove Debug section from Performance tab.** In `#stab-performance`, delete the entire block:
   ```html
   <div class="perf-section-title">Debug</div>
   <div class="perf-rows">
     <div class="perf-row">
       ...perf-debug-overlay input...
     </div>
   </div>
   ```
   The "Reset to defaults" button at the bottom of the Performance tab must remain in place.

3. **Validate.** Open the settings modal in a browser. Confirm the Debug overlay toggle appears in the General tab and is absent from the Performance tab. Toggle it and confirm `savePerfSettings()` fires (check that the setting persists on reload via `applyPerfSettings()` targeting `#perf-debug-overlay`).

## Acceptance Criteria
- Debug overlay toggle is visible in the General tab, positioned after the fullscreen timeout row and before the clear-data row
- Debug overlay toggle is absent from the Performance tab; the "Debug" section heading is gone
- `id="perf-debug-overlay"` is unchanged — no JS file edits needed
- `onchange="savePerfSettings()"` is unchanged
- Toggling debug overlay in General tab persists correctly on page reload
- No visual regressions in either tab

## Validation Commands
```sh
# Verify the id appears exactly once in index.html (only in General tab after move)
grep -n "perf-debug-overlay" /Users/maxwell/Documents/development/rtsp-kiosk/www/index.html

# Verify the Debug section heading is gone from Performance
grep -n "perf-section-title" /Users/maxwell/Documents/development/rtsp-kiosk/www/index.html
```

## Notes
- The `small` description text is optional styling detail — match the visual pattern of other General rows. If the existing Audio row does not use a `<small>` sub-label, omit it for consistency.
- No JS changes needed in `views.js`, `app.js`, or any other file.
