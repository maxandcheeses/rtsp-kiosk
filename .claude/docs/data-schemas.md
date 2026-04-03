# Data Schemas

## `data/streams.json`

The authoritative stream list. Never served to the browser directly. Contains credentials.

The file may be either a JSON array or an object with a `streams` key. `generate-config.sh` handles both forms.

**Array form (simple):**
```json
[ { "path": "cam1", ... } ]
```

**Object form (with MQTT config):**
```json
{ "streams": [ { "path": "cam1", ... } ], "mqtt": { ... } }
```

### Stream object fields

| Field | Required | Type | Purpose |
|-------|----------|------|---------|
| `path` | yes | string | MediaMTX path key; appears in the WHEP URL as `/{path}/whep` |
| `source` | yes | string | RTSP source URL including credentials if needed |
| `label` | no | string | Display name shown in the browser UI |
| `aspectRatio` | no | string | e.g. `"16:9"`, `"4:3"` — informational only, not used for sizing |
| `objectFit` | no | string | CSS `object-fit` on the `<video>` element: `"contain"` or `"cover"` |
| `audio` | no | boolean | Whether to enable an audio transceiver on the WebRTC connection |
| `rtspTransport` | no | string | `"tcp"` or `"udp"` — how MediaMTX connects to the camera |
| `sourceOnDemand` | no | boolean | Connect to the camera only when a viewer is watching |
| `sourceOnDemandStartTimeout` | no | string | e.g. `"10s"` — how long to wait for the camera to respond |
| `sourceOnDemandCloseAfter` | no | string | e.g. `"10s"` — disconnect camera N seconds after last viewer leaves |
| `runOnInit` | no | string | Shell command to run when the path is initialised |
| `runOnInitRestart` | no | boolean | Whether to restart the `runOnInit` command if it exits |
| `refreshInterval` | no | number | Seconds between forced WebRTC reconnects (browser-side) |
| `preloadLeadTime` | no | number | Seconds before a view switch to start preloading this stream |

`path` must be unique. It is used as the MediaMTX path name and as the identifier that views reference in their `streams` array.

## `data/views.json`

View preset configuration. Copied as-is to `views-public.json` — no sanitisation needed, it contains no credentials.

### Top-level object

| Field | Type | Purpose |
|-------|------|---------|
| `default` | string or null | Name of the view to activate on browser load |
| `cycle` | boolean | Whether to automatically cycle through views |
| `views` | array | List of view preset objects |

### View preset object

| Field | Required | Type | Purpose |
|-------|----------|------|---------|
| `name` | yes | string | Unique identifier; referenced by `default` and by `streams` arrays in other views |
| `label` | no | string | Display name in the views modal |
| `layout` | yes | string | Must match a key in the frontend `LAYOUTS` constant |
| `streams` | yes | array of strings | Ordered list of stream `path` values |
| `duration` | no | number | Seconds to display this view before cycling to the next; `-1` means stay forever |
| `preloadLeadTime` | no | number | Seconds before the view switch to begin preloading the next view's streams |

If a `streams` entry references a path that does not exist in `streams.json`, the cell is silently skipped.

Valid `layout` values (must match exactly): `single`, `two-col`, `two-row`, `primary-right`, `primary-left`, `primary-bottom`, `primary-top`, `quad`, `six`, `eight`.

## Public Files

`generate-config.sh` produces two browser-safe copies in `/data`:

### `data/streams-public.json`

Credentials are stripped from the `source` URL. The stripping logic in `generate-config.sh`:

- URL with `user:pass@host` becomes `scheme://***@host/***`
- URL without credentials becomes `scheme://host/***`

Fields included (explicit whitelist — anything not listed is dropped):
`path`, `label`, `aspectRatio`, `objectFit`, `audio`, `refreshInterval`, `preloadLeadTime`, `source` (sanitised).

Fields whose value is `null` are omitted from the object entirely.

### `data/views-public.json`

An exact copy of `views.json`. If `views.json` does not exist, the file is created with:
```json
{"default":null,"cycle":false,"views":[]}
```

## Keeping Public Files in Sync

`streams-public.json` and `views-public.json` are regenerated every time the `mediamtx` container starts (via `generate-config.sh`). On the host they are bind-mounted into the nginx container so nginx always serves the freshest copy without a rebuild.

**Important:** these files must exist as regular files on the host before the containers start. If they are absent, Docker will create them as empty directories on first mount, breaking nginx. If this happens:

1. `rm -rf data/streams-public.json data/views-public.json`
2. Recreate them using the jq snippet in step 2 of `generate-config.sh` (for streams) and `cp data/views.json data/views-public.json` (for views), or simply restart the `mediamtx` container which will regenerate both.

## Adding a New Stream Field

1. Add to objects in `data/streams.json`.
2. If it maps to a MediaMTX config key, add a `jq` line in step 1 of `scripts/generate-config.sh`.
3. If the browser needs to read it, add the field name to the `jq` whitelist in step 2 of `generate-config.sh`.
4. Restart the `mediamtx` container to regenerate all derived files.
