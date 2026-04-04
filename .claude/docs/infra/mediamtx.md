# MediaMTX

## Role

MediaMTX ingests RTSP streams from IP cameras and re-publishes them as WebRTC/WHEP. The browser connects directly to MediaMTX via WebRTC — nginx is not involved in media delivery.

## Config Generation

MediaMTX config (`/data/mediamtx.yml`) is generated at every container startup by `scripts/generate-config.sh`. It is never checked into the repo.

### How `generate-config.sh` works

The script is POSIX sh (not bash). It runs three steps in sequence, then `exec`s into MediaMTX.

**Step 1 — Generate `mediamtx.yml`**

`data/mediamtx-base.yml` is piped through `envsubst` to substitute `${HOST_IP}` and `${STUN_PORT}`, and the result is written to `/data/mediamtx.yml`. Then a `paths:` block is appended by iterating over `data/streams.json` with `jq`.

The script handles two input formats:
- A top-level JSON array: `[{...}, ...]`
- An object with a `streams` key: `{"streams": [{...}, ...], "mqtt": {...}}`

Fields mapped from `streams.json` to `mediamtx.yml` path config:

| streams.json field | mediamtx.yml key |
|--------------------|-----------------|
| `path` | path name (the YAML key) |
| `source` | `source` |
| `rtspTransport` | `rtspTransport` |
| `sourceOnDemand` | `sourceOnDemand: yes` (if truthy) |
| `sourceOnDemandStartTimeout` | `sourceOnDemandStartTimeout` |
| `sourceOnDemandCloseAfter` | `sourceOnDemandCloseAfter` |
| `runOnInit` | `runOnInit` |
| `runOnInitRestart` | `runOnInitRestart: yes` (if truthy) |

Fields not in this list (e.g., `label`, `aspectRatio`, `objectFit`, `audio`, `refreshInterval`, `preloadLeadTime`) are frontend-only and are not written to the MediaMTX config.

**Step 2 — Generate `streams-public.json`**

A sanitised copy of the stream list is written for the browser. The `source` URL has credentials stripped:
- With `user:pass@host` — becomes `scheme://***@host/***`
- Without credentials — becomes `scheme://host/***`

Fields included in the public output (explicit whitelist in `jq`):
`path`, `label`, `aspectRatio`, `objectFit`, `audio`, `refreshInterval`, `preloadLeadTime`, `source` (sanitised).

Fields with `null` values are omitted from each object (`with_entries(select(.value != null))`).

**Step 3 — Copy `views-public.json`**

`views.json` is copied as-is to `views-public.json`. If `views.json` does not exist, an empty default is written: `{"default":null,"cycle":false,"views":[]}`.

## `data/mediamtx-base.yml`

Static base config. Key settings:

- RTMP, HLS, SRT disabled — WebRTC only.
- RTSP enabled on `:8554`.
- WebRTC enabled on `:8889` (WHEP endpoint).
- API enabled on `:9997`.
- STUN configured via `webrtcICEServers2` using `${HOST_IP}:${STUN_PORT}`.
- `webrtcIPsFromInterfaces: yes` and `webrtcAdditionalHosts: [${HOST_IP}]` ensure the host IP is included in ICE candidates.

Do not add `paths:` entries to `mediamtx-base.yml`. All paths come from `streams.json`.

## WHEP Endpoint

Browsers connect to `http://{HOST_IP}:8889/{path}/whep` with a WebRTC SDP offer. MediaMTX responds with an SDP answer. No authentication on the WHEP endpoint.

## Adding a Stream Field That Affects MediaMTX

1. Add the field to `data/streams.json`.
2. Add a `jq` line in the step 1 section of `generate-config.sh` to emit the YAML key.
3. Restart the `mediamtx` container.
