# Plan: Action Toggle Type

> Status: `done`
> Last updated: 2026-04-21

## Task Description

Add a `toggle` action type to the actions system. Unlike the existing `mqtt` type (which always publishes the same fixed payload), a `toggle` action alternates between two payloads (`payloadOn` / `payloadOff`) each time it is pressed. The button visually reflects the current on/off state — using a subscribed MQTT state topic when configured, or an in-memory per-action boolean as a fallback. The editor drawer in `actions-editor.js` must also support creating and editing toggle actions, showing two payload fields (ON and OFF) instead of one.

## Objective

Users can define toggle action buttons in `data/actions.json` and via the editor UI. Pressing a toggle button alternates the published payload and updates the button's `.on` CSS class immediately. State survives modal open/close. Existing `mqtt` type actions are fully backward-compatible.

## Problem Statement

The current action system only supports a one-shot `mqtt` type that always sends the same payload. There is no first-class way to model a stateful toggle (e.g., lights on/off) without creating two separate `mqtt` actions. Users want a single button that toggles device state and reflects that state visually.

## Solution Approach

### Schema extension

The `toggle` type reuses the existing `publish.topic` and optional `state` fields, but replaces `publish.payload` with `publish.payloadOn` and `publish.payloadOff`:

```json
{
  "name": "lights",
  "type": "toggle",
  "description": "Lights",
  "icon": "mdi:lightbulb",
  "publish": {
    "topic": "home/living/lights/set",
    "payloadOn": "ON",
    "payloadOff": "OFF"
  },
  "state": {
    "topic": "home/living/lights/state",
    "onValue": "ON"
  }
}
```

`state` remains optional. Existing `mqtt` type entries with `publish.payload` are untouched.

### State resolution (two-tier)

1. **With state topic** (`action.state.topic` configured): use `ACTION_STATES[action.state.topic] === action.state.onValue` — identical to how `mqtt` actions already determine `.on`. Updates automatically via MQTT subscription. Persists across modal open/close since `ACTION_STATES` is never cleared.

2. **Without state topic** (fallback): module-level `let _toggleStates = {}` map (`actionId → boolean`). After a successful publish, flip the boolean and call `_refreshActionButtons()` for an optimistic UI update. Resets on page reload (acceptable — actual device state is unknowable without a state topic after reload).

### `isDisabled` guard

The `isDisabled` condition in `_renderActionButtons` includes `toggle` alongside `mqtt` so that toggle buttons are disabled when MQTT is not connected.

### Payload validation guard in `pressAction`

Early return if `action.type === 'toggle'` and either `payloadOn` or `payloadOff` is missing, to avoid publishing undefined.

## Relevant Files

- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions.js` — runtime state and press logic
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions-editor.js` — editor drawer form and save logic

## Implementation Summary

- `actions.js`: Added `_toggleStates = {}`, updated `_renderActionButtons` to compute `isOn`/`isUnknown` for toggle type (using `ACTION_STATES` when available, `_toggleStates` fallback), updated `isDisabled` guard to include `toggle`, updated `pressAction` to resolve payload and flip `_toggleStates` on press.
- `actions-editor.js`: Added `toggle` option to type `<select>`, added `pPayOn`/`pPayOff` extraction, replaced single Payload row with conditional mqtt/toggle rows, updated `_aeTypeChanged` to show/hide the toggle payload rows, updated `saveAeActionDrawer` validation and publish object construction, updated table publish summary for `toggle` type.

## Notes

- The `_toggleStates` fallback does not persist across page reloads by design. Persisting it to `localStorage` would be incorrect without a state topic because the actual device state after a reload is unknown.
- No CSS changes were required — `.action-btn.on` already existed and applies the active visual state.
- Backward compatibility: existing `mqtt` type actions are fully unaffected.
