# Data Schemas

## streams.json (`data/streams.json`)

Authoritative stream list. Never served directly to the browser — `generate-config.sh` strips credentials and writes `data/streams-public.json`.

### Required fields
| Field | Type | Description |
|-------|------|-------------|
| `path` | string | MediaMTX path name; also used as the stream identifier in views |
| `source` | string | RTSP source URL (may contain credentials) |

### Optional fields
| Field | Type | Description |
|-------|------|-------------|
| `aspectRatio` | string | e.g. `"16:9"`, `"4:3"`, `"1:1"` |
| `objectFit` | string | CSS object-fit value (`"contain"`, `"cover"`) |
| `audio` | boolean | Whether to enable audio |
| `rtspTransport` | string | `"tcp"` or `"udp"` |
| `sourceOnDemand` | boolean | Only connect to source when a viewer is present |
| `sourceOnDemandStartTimeout` | string | e.g. `"10s"` |
| `sourceOnDemandCloseAfter` | string | e.g. `"10s"` |
| `runOnInit` | string | Shell command to run on path init |
| `runOnInitRestart` | boolean | Restart `runOnInit` on failure |
| `refreshInterval` | number | Per-stream refresh interval (seconds) |
| `preloadLeadTime` | number | Seconds before view switch to start preloading |

Note: `label` was removed. Stream display names are derived from `path` by the frontend if needed.

## views.json (`data/views.json`)

View preset configuration. Copied (without modification) to `data/views-public.json` by `generate-config.sh` and served at `/views.json`.

### Top-level fields
| Field | Type | Description |
|-------|------|-------------|
| `default` | string | Name of the view to show on load |
| `cycle` | boolean | Whether to auto-cycle through views |
| `views` | array | List of view objects |

### View object fields
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique identifier for this view |
| `layout` | string | Layout ID (e.g. `"primary-right"`, `"primary-left"`) |
| `streams` | array of strings | Ordered list of stream `path` values |
| `duration` | number | Seconds to display this view during cycle |
| `preloadLeadTime` | number | Seconds before switch to start preloading next view |

Note: `label` was removed. View display names are derived from `name` by the frontend if needed.

## actions.json (`data/actions.json`)

MQTT broker configuration and action definitions. Served directly at `/actions.json` (no sanitisation step — credentials are present, so treat this file as sensitive; do not commit real credentials).

### Top-level fields
| Field | Type | Description |
|-------|------|-------------|
| `mqtt` | object | Broker connection settings |
| `actions` | array | List of action objects |
| `groups` | array | Optional groupings of action IDs |

### mqtt object
| Field | Type | Description |
|-------|------|-------------|
| `broker` | string | WebSocket URL of the MQTT broker (e.g. `"ws://192.168.1.100:9001"`) |
| `username` | string | MQTT username |
| `password` | string | MQTT password |

### Action object fields
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique action identifier |
| `label` | string | Display label |
| `icon` | string | MDI icon name (e.g. `"mdi:lightbulb"`) or a literal emoji |
| `publish.topic` | string | MQTT topic to publish to |
| `publish.payload` | string | Payload to publish |
| `state.topic` | string | (optional) MQTT topic to subscribe to for state feedback |
| `state.onValue` | string | (optional) Payload value that means "active/on" |

### Group object fields
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique group identifier |
| `name` | string | Display name |
| `actions` | array of strings | Ordered list of action `id` values |

Note: Unlike `streams.json`, `actions.json` is served as-is (no generated public variant). If credentials must be kept off the wire, run the broker on a local network only.

## Public file sanitisation

`generate-config.sh` produces two public files at container startup:

- `data/streams-public.json` — same schema as `streams.json` but with `source` (and any credential-bearing fields) stripped
- `data/views-public.json` — direct copy of `views.json`

Both are served no-cache by Nginx. All other `*.json` paths return 403.
