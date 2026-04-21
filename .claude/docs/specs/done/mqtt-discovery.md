# Plan: MQTT Discovery (Home Assistant Protocol)

> Status: `done`
> Last updated: 2026-04-21

## Task Description

Add an MQTT discovery subsystem to the rtsp-kiosk so that Home Assistant entities and any HA-compatible devices can publish action definitions using the standard HA MQTT discovery protocol and have them appear as kiosk action buttons automatically — without any manual edits to `data/actions.json`. Discovery is opt-in, configured via a `discovery` block in `actions.json`. Discovered actions live in memory only; MQTT retained messages on the broker handle persistence across reconnects and kiosk reloads.

## Objective

Subscribe to standard Home Assistant MQTT discovery topics (`homeassistant/+/+/config` and `homeassistant/+/+/+/config`), parse inbound HA entity payloads by component type, and convert them into kiosk action objects that are merged into the live `ACTIONS` registry at runtime. Removal is signaled by an empty or null retained payload. Static actions defined in `actions.json` always win over discovered actions with the same name.

## Problem Statement

Currently every action button must be hand-authored in `data/actions.json`. Smart-home devices that use standard HA MQTT discovery have no way to surface contextual controls in the kiosk without manual translation of their payloads into the kiosk schema. Supporting the HA protocol eliminates this translation step entirely.

## Solution Approach

### Topic subscription

Subscribe to two wildcard patterns to cover both HA topic structures:
- `<prefix>/+/+/config` — two-segment node path (e.g. `homeassistant/switch/my_device/config`)
- `<prefix>/+/+/+/config` — three-segment node path (e.g. `homeassistant/light/living_room/ceiling/config`)

Where `<prefix>` is `discovery.prefix` from `actions.json` (default: `homeassistant`).

An empty or null retained payload signals entity removal.

### Component type parser

Parse the `component` field from the HA payload (second segment of the topic path as fallback) and map to a kiosk action:

| HA Component | HA Payload Fields Used | Kiosk Action Type |
|---|---|---|
| `button` | `command_topic`, `payload_press` | `mqtt` — single fixed publish, no state |
| `switch` | `command_topic`, `state_topic`, `payload_on`, `payload_off`, `state_on`, `state_off` | `toggle` |
| `light` | same as switch | `toggle` |
| `lock` | `command_topic`, `state_topic`, `payload_lock`, `payload_unlock`, `state_locked`, `state_unlocked` | `toggle` |

Unsupported component types are logged and skipped.

### Toggle action mapping

Discovered `toggle` actions use the `toggle` type:
- `publish.topic` = `command_topic`
- `publish.payloadOn` = `payload_on` (switch/light) or `payload_lock` (lock)
- `publish.payloadOff` = `payload_off` (switch/light) or `payload_unlock` (lock)
- `state.topic` = `state_topic`
- `state.onValue` = `state_on` (switch/light) or `state_locked` (lock)

### Unique ID / action key

The action key in `DISCOVERED_ACTIONS` is derived from the topic path segments between the component and `config`. For example:
- `homeassistant/switch/my_device/config` → `my_device`
- `homeassistant/light/living_room/ceiling/config` → `living_room/ceiling`

### Icon

Use `icon` from the HA payload if present. Otherwise apply a component-appropriate default:
- `button` → `mdi:gesture-tap-button`
- `switch` → `mdi:toggle-switch`
- `light` → `mdi:lightbulb`
- `lock` → `mdi:lock`

### mqttServer on discovered actions

The `mqttServer` for a discovered action is resolved from `discoveryCfg.mqttServer` (the `mqttServer` value in the `discovery` config block).

### Merge strategy

Discovered actions are stored in `DISCOVERED_ACTIONS`. `getMergedActions()` returns `{ ...DISCOVERED_ACTIONS, ...ACTIONS }` — static actions win on name collision. All action lookups (button rendering, `pressAction`, `openActionsModal`, `_connectServersForCollection`, `_onMqttDisconnect`) use `getMergedActions()`.

## Implementation Summary

### `www/js/actions.js`

- Added `let DISCOVERED_ACTIONS = {}` and `let _discoveryConfig = {}` at module level
- Added `getMergedActions()` returning `{ ...DISCOVERED_ACTIONS, ...ACTIONS }`
- Added `_extractDiscoveryKey(topic, prefix)` to derive action key from topic path
- Added `_resolveMqttServer(haPayload, discoveryCfg)` returning `discoveryCfg.mqttServer`
- Added `parseHaPayload(component, haPayload, key, discoveryCfg)` mapping HA components to kiosk actions
- Replaced `handleDiscoveryMessage` with HA-format version: parses HA payload, stores to `DISCOVERED_ACTIONS`, calls `_refreshActionButtons` and re-renders editor
- Replaced `initDiscovery` to subscribe to `${prefix}/+/+/config` and `${prefix}/+/+/+/config` via two `mqttSubscribe` calls; stores both unsubscribers
- Removed old localStorage-based discovery persistence (`_LS_DISCOVERED_KEY`, `_saveDiscovered`)
- Removed old per-broker `discoveryTopic` subscription loop
- Updated all `ACTIONS` lookups in `openActionsModal`, `_renderActionButtons`, `_connectServersForCollection`, `pressAction`, `_onMqttDisconnect` to use `getMergedActions()`

### `www/js/actions-editor.js`

- Updated `_buildAeActionsTab` to source discovered rows from `DISCOVERED_ACTIONS` directly instead of filtering `ACTIONS` by `_STATIC_ACTIONS`

### `data/actions.json`

- Updated `discovery` block: replaced `topic` field with `prefix: "homeassistant"`

### `tools/mqtt-test/index.js`

- `cmdDiscover`: publishes HA-format switch config to `homeassistant/switch/kiosk-test-light/config` with `unique_id`, `name`, `icon`, `command_topic`, `state_topic`, `payload_on/off`, `state_on/off`
- `cmdUndiscover`: publishes empty retained message to the same HA-format topic
- Both commands derive prefix from `config.discovery?.prefix || 'homeassistant'`

## Relevant Files

- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions.js`
- `/Users/maxwell/Documents/development/rtsp-kiosk/www/js/actions-editor.js`
- `/Users/maxwell/Documents/development/rtsp-kiosk/data/actions.json`
- `/Users/maxwell/Documents/development/rtsp-kiosk/tools/mqtt-test/index.js`

## Testing

```sh
# Publish a discovered switch
mosquitto_pub -h <broker-host> -p 1883 -r \
  -t homeassistant/switch/kiosk-test-fan/config \
  -m '{"unique_id":"kiosk-test-fan","name":"Test Fan","icon":"mdi:fan","command_topic":"test/fan/set","state_topic":"test/fan/state","payload_on":"ON","payload_off":"OFF","state_on":"ON","state_off":"OFF"}'

# Remove discovered entity
mosquitto_pub -h <broker-host> -p 1883 -r \
  -t homeassistant/switch/kiosk-test-fan/config -n

# Test mqtt-test tool
node tools/mqtt-test/index.js discover
node tools/mqtt-test/index.js undiscover
```
