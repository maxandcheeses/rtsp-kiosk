# MQTT Test Harness

A CLI tool for testing MQTT functionality in the rtsp-kiosk project. Helps validate that the actions.json broker config works correctly and test publishing/subscribing to action topics.

## Prerequisites

- Node.js 14+
- Docker (for the Mosquitto MQTT broker)
- The broker must be running: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mqtt`

## Setup

```bash
# Install dependencies (from tools/mqtt-test or root)
npm install

# Or use the mqtt package from the root directory
```

## Usage

All commands read `data/actions.json` dynamically — no hardcoded topics.

### Subscribe to State Topics

Listen to all action state topics and print incoming messages as they arrive:

```bash
node tools/mqtt-test/index.js subscribe
```

Useful for watching what devices are publishing to the broker without any kiosk interaction.

**Output example:**
```
[14:32:15] home/living/lights/state → ON
[14:32:18] home/living/fan/state → OFF
```

### Publish an Action

Publish a single action's configured payload once and exit:

```bash
node tools/mqtt-test/index.js publish lights-on
node tools/mqtt-test/index.js publish fan-off
node tools/mqtt-test/index.js publish lock-door
```

This is useful for testing that the kiosk correctly responds to action publications (e.g., check if a real device actually received the command).

**Output example:**
```
[14:32:15] Publishing to home/living/lights/set: ON
[14:32:15] Published successfully
```

### Simulate Device Responses

Loop forever, simulating device state responses. When a SET command is published to an action's `publish.topic`, automatically publish the corresponding `state.onValue` back on the `state.topic` after a 100ms delay.

```bash
node tools/mqtt-test/index.js simulate
```

This is crucial for testing the kiosk UI without real devices. Start this, then in the kiosk:
1. Assign a view with actions (e.g., living-room or front-door group)
2. Click an action button (e.g., "Lights On")
3. Watch the kiosk UI update and the simulator log the response

**Output example:**
```
[14:32:15] lights-on set received on home/living/lights/set
[14:32:15]   → published ON to home/living/lights/state
[14:32:18] fan-off set received on home/living/fan/set
[14:32:18]   → published OFF to home/living/fan/state
```

### Test Broker Connectivity

Check whether the broker is reachable and measure latency:

```bash
node tools/mqtt-test/index.js ping
```

**Output example:**
```
[14:32:15] Broker: ws://localhost:9001, latency: 45ms, connected: true
```

### Show Help

```bash
node tools/mqtt-test/index.js --help
node tools/mqtt-test/index.js -h
```

## Configuration

All configuration comes from `data/actions.json`:

- **Broker URL** — read from `mqtt.broker` (e.g., `ws://localhost:9001` or `mqtt://localhost:1883`)
- **Authentication** — optional `mqtt.username` and `mqtt.password` (masked in output as `***`)
- **Action topics** — each action defines `publish.topic`, `publish.payload`, and optionally `state.topic` + `state.onValue`

Example `data/actions.json` excerpt:
```json
{
  "mqtt": {
    "broker": "ws://localhost:9001",
    "username": "",
    "password": ""
  },
  "actions": [
    {
      "id": "lights-on",
      "publish": { "topic": "home/living/lights/set", "payload": "ON" },
      "state": { "topic": "home/living/lights/state", "onValue": "ON" }
    }
  ]
}
```

## Common Workflows

### 1. Test Broker Before Starting Kiosk

```bash
npm run ping
# Output: Broker reachable, latency: XXms
```

### 2. Develop UI Actions Without Real Devices

In one terminal:
```bash
npm run simulate
```

In another, start the kiosk:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Then open http://localhost:8080, assign actions to a view, and click buttons. The simulator will log all state changes.

### 3. Debug Broker Traffic

In one terminal, watch all state topics:
```bash
npm run subscribe
```

In another, trigger actions from the kiosk or manually publish:
```bash
npm run publish lights-on
```

You'll see all messages appear in the subscribe terminal.

### 4. Validate actions.json Changes

After editing `data/actions.json`, test connectivity:
```bash
npm run ping
```

Then verify the simulator recognizes all topics:
```bash
npm run simulate
# Should list all action topics in the output
```

## Output Formatting

- All lines include a **timestamp** `[HH:MM:SS]` for debugging timing
- **Colors** are used only when output is a terminal (TTY)
  - `cyan` — topic names
  - `green` — payloads and success messages
  - `red` — errors
  - `gray` — timestamps
- **Credentials** in broker URLs are automatically masked as `***`

## Exit Codes

- **0** — Success
- **1** — Error (connection failed, config invalid, action not found, etc.)

## Troubleshooting

### Connection Failed / Timeout

- Check that the broker is running: `docker compose ps mqtt`
- Verify the broker URL in `data/actions.json` is correct
- If using a remote broker, ensure network connectivity: `ping <broker-host>`

### No State Messages in Subscribe Mode

- Ensure devices are publishing to the expected state topics
- Use the web UI (`http://localhost:8080/mqtt-test.html`) to manually publish and verify topics

### Simulate Doesn't Log Anything

- Publish a test action: `npm run publish lights-on`
- Verify the action has both `publish.topic` and `state.topic` in `data/actions.json`
- Check that the kiosk is publishing to the correct topics (use subscribe in another terminal)

## Notes

- SIGINT (Ctrl+C) gracefully disconnects and exits subscribe and simulate modes
- Credentials in broker URLs are **never** logged (masked as `***`)
- Each command creates a fresh MQTT connection and disconnects when done
- The `simulate` mode is intentionally simple — it echoes back the `onValue` without interpreting payloads
