# WebRTC / WHEP — Connection Lifecycle

## Connection Tracking

```js
const streamPCs = {};  // path → RTCPeerConnection (null = no active connection)
let   activePCs = [];  // flat array of all live PCs (used for bulk close)
```

Keyed by stream **path**, not DOM index. The same stream can appear at different grid positions across view switches without losing its connection.

Preload connections use separate maps:
```js
const preloadPCs    = {};  // path → RTCPeerConnection (hidden, pre-warming)
const preloadVideos = {};  // path → hidden <video> element (buffering frames)
```

---

## startWhep(index) Lifecycle

```
startWhep(index)
    │
    ├─► attachExistingPC(path, index)
    │       live track found? → attach srcObject to video, setLive(), return
    │       otherwise → fall through
    │
    ├─► close stale streamPCs[path] if any
    ├─► new RTCPeerConnection({ iceServers: [google STUN] })
    │       + lowPower flag: rtcpMuxPolicy:'require', iceCandidatePoolSize:0
    ├─► addTransceiver('video', recvonly)
    ├─► addTransceiver('audio', recvonly | inactive per stream.audio flag)
    ├─► createOffer → setLocalDescription
    ├─► wait for ICE gathering complete (or 5s timeout)
    ├─► POST http://{host}:8889/{path}/whep  (SDP offer body)
    ├─► setRemoteDescription (SDP answer from MediaMTX)
    │
    └─► event handlers registered on pc:
            ontrack           → attach srcObject, setLive(), start stallTimer
            oniceconnectionstatechange → ICE failure handling (see below)
```

If any step throws, `setError()` is called and `scheduleRetry(index)` queues reconnect.

---

## Failure Handling and Retry

All retry paths call the local `doRetry(reason)` closure, which:
1. Sets `retried = true` (prevents double-retry from concurrent failure events)
2. Clears `noTrackTimer`, `disconnectTimer`, `stallTimer`
3. Sets `streamPCs[path] = null`, closes the PC
4. Calls `setError()` to update the cell UI
5. Calls `scheduleRetry(index)`

### Failure triggers

| Trigger | Condition | Delay before retry |
|---------|-----------|-------------------|
| No track received | `ontrack` never fires within 20s | Immediate → `scheduleRetry` |
| ICE failed | `iceConnectionState === 'failed'` | Immediate |
| ICE disconnected | `iceConnectionState === 'disconnected'` persists for 8s | 8s wait |
| ICE closed | `iceConnectionState === 'closed'` after track was received | Immediate |
| Video stalled | Frame count unchanged over 8s interval | Immediate |
| Video paused unexpectedly | `video.paused && readyState >= 2` | 2s re-check, then retry |

ICE `'disconnected'` is treated as potentially transient — if it recovers to `'connected'` or `'completed'` within 8s, the disconnect timer is cancelled and no retry happens.

### Exponential backoff

```
retryDelay[path]: starts at 2s, doubles each failure, capped at PERF.maxRetryDelay (default 30s)
retryPending[path]: guard flag, prevents stacking multiple retries for the same stream
```

Delay resets to 2s on successful connection (`resetRetry(index)` called from `setLive()`).

On retry fire, the stream index is re-resolved at that moment:
```js
const currentIndex = STREAMS.findIndex(s => s.path === path);
if (currentIndex === -1) return; // stream no longer in active layout, drop
```

---

## Connection Reuse Across View Switches

When `activateView` is called, streams that are both in the old and new view do not reconnect:

1. Preloaded PCs (`preloadPCs[path]`) are promoted to `streamPCs[path]` before `applyLayout` runs.
2. `applyLayout` filters `activePCs` — connections for streams not in the new layout are closed; connections for streams that remain are kept.
3. When `startWhep(i)` runs for each new cell, it calls `attachExistingPC(path, i)` first. If `streamPCs[path]` has a live video track (`readyState === 'live'`), it attaches that PC's MediaStream to the new `<video>` element and returns without creating a new connection.

`attachExistingPC` prefers `preloadVideos[path].srcObject` if available (already buffered frames from hidden preload video), otherwise constructs a new `MediaStream` from `pc.getReceivers()` tracks.

---

## Stream Refresh

`scheduleRefresh(index)` sets a periodic forced reconnect:
- Uses `stream.refreshInterval` (seconds) if set on the stream
- Falls back to `STREAM_REFRESH_GLOBAL` (from `$STREAM_REFRESH` env var)
- If `STREAM_REFRESH_GLOBAL === 0`, refresh is disabled globally regardless of per-stream config
- If `STREAM_REFRESH_GLOBAL === null` (env var unset), only per-stream `refreshInterval` applies

On refresh fire, the stream is torn down and `startWhep` is called fresh. This forces MediaMTX to renegotiate the stream, which can recover from encoding drift or server-side buffer buildup.

---

## Audio

`addTransceiver('audio', { direction: stream.audio ? 'recvonly' : 'inactive' })` — audio transceiver is always added, but set inactive unless `stream.audio: true` in `streams.json`.

All video elements start `muted = true` for browser autoplay compliance. `applyMute()` unmutes streams only after `userInteracted` is set (first user gesture). `globalMuted` tracks the mute toggle state.

---

## STUN Configuration

The default `iceServers` uses `stun.l.google.com:19302`. In the full Docker stack, coturn runs on the host at port 3478 — but this external Google STUN server is the hardcoded default. For fully offline deployments the `iceServers` config should be updated to point at the local coturn instance.
