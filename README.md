# rtsp-kiosk

A self-hosted, fullscreen video wall for IP cameras and live streams. Drop in your RTSP sources, pick a layout, and deploy with a single `docker compose up`.

Designed to be used with [free-kiosk](https://github.com/RushB-fr/freekiosk) — a browser-based kiosk manager that locks a display to a single URL. Point free-kiosk at `http://<HOST_IP>` and use `FORCE_LAYOUT` to pin the layout, giving you a fully unattended, zero-interaction security monitor.

```
┌─────────────────┬──────────┐
│                 │  CAM 02  │
│     CAM 01      ├──────────┤
│                 │  CAM 03  │
└─────────────────┴──────────┘
```

![Live Streams](docs/streams.png)

---

## Stack

| Component | Role |
|-----------|------|
| **MediaMTX** | Ingests RTSP streams, exposes WebRTC/WHEP to browsers |
| **FFmpeg** (bundled) | Transcodes MJPEG/HLS/MP4 sources → H.264 RTSP |
| **coturn** | Local STUN server — keeps ICE discovery on the LAN |
| **Nginx** | Serves the UI on port 80, injects env config |

---

## File Structure

```
rtsp-kiosk/
├── data/                        ← gitignored — private runtime config
│   ├── streams.json             ← camera config (single source of truth)
│   └── mediamtx-base.yml       ← static MediaMTX settings
├── scripts/
│   └── generate-config.sh      ← builds mediamtx.yml from streams.json at startup
├── www/
│   └── index.html              ← UI (fetches streams.json at load time)
├── Dockerfile                   ← MediaMTX + FFmpeg + jq + envsubst
├── docker-compose.yml
├── nginx.conf
├── .env                         ← gitignored — HOST_IP, STUN_PORT
└── .gitignore
```

---

## Quick Start

### 1. Create `.env`

```env
HOST_IP=10.0.0.10       # LAN IP of this host
STUN_PORT=3478
```

### 2. Configure cameras in `data/streams.json`

This is the single source of truth for all cameras. It configures both the UI and MediaMTX.

```json
[
  {
    "path": "cam1",
    "label": "Front Door",
    "aspectRatio": "16:9",
    "objectFit": "contain",
    "source": "rtsp://user:password@10.0.1.1:7447/token",
    "rtspTransport": "tcp",
    "sourceOnDemand": true,
    "sourceOnDemandStartTimeout": "10s",
    "sourceOnDemandCloseAfter": "10s"
  },
  {
    "path": "cam2",
    "label": "Backyard",
    "aspectRatio": "4:3",
    "objectFit": "contain",
    "source": "rtsp://user:password@10.0.1.1:7447/token",
    "rtspTransport": "tcp",
    "sourceOnDemand": true,
    "sourceOnDemandStartTimeout": "10s",
    "sourceOnDemandCloseAfter": "10s"
  }
]
```

#### Stream fields

| Field | Required | Description |
|-------|----------|-------------|
| `path` | ✓ | MediaMTX path name — must be unique |
| `label` | ✓ | Display name shown on hover |
| `aspectRatio` | ✓ | `16:9`, `4:3`, `1:1` — constrains cell shape |
| `objectFit` | ✓ | `contain` (no crop) or `cover` (crop to fill) |
| `source` | ✓ | RTSP/RTSPS URL |
| `rtspTransport` | | `tcp` or `udp` — use `tcp` for UniFi and flaky networks |
| `sourceOnDemand` | | `true` — only connect when a browser is watching |
| `sourceOnDemandStartTimeout` | | How long to wait for stream to start |
| `sourceOnDemandCloseAfter` | | How long to keep stream alive after last viewer leaves |
| `runOnInit` | | FFmpeg command for MJPEG/HLS/MP4 sources |
| `runOnInitRestart` | | `true` — restart FFmpeg on failure |
| `audio` | | `true` to receive audio — omit or `false` for no audio (default) |

> ⚠️ **Android + free-kiosk crash:** A fatal crash in the `AudioTrack` thread (`SIGABRT`) has been observed on Android when audio is enabled on one or more streams. The crash kills the free-kiosk process and triggers a restart. If you are running rtsp-kiosk on an Android device via free-kiosk, leave `audio` unset or set to `false` on all streams.

#### Source type examples

**RTSP (native — most IP cameras)**
```json
{
  "path": "cam1",
  "source": "rtsp://admin:password@192.168.1.101:554/stream1",
  "rtspTransport": "tcp",
  "sourceOnDemand": true
}
```

**UniFi Protect**
```json
{
  "path": "cam1",
  "source": "rtsp://username:password@10.0.1.1:7447/your-camera-token",
  "rtspTransport": "tcp",
  "sourceOnDemand": true,
  "sourceOnDemandStartTimeout": "10s",
  "sourceOnDemandCloseAfter": "10s"
}
```

**RTSP — 16:9, no crop**
```json
{
  "path": "cam1",
  "label": "Front Door",
  "aspectRatio": "16:9",
  "objectFit": "contain",
  "source": "rtsp://admin:password@192.168.1.101:554/stream1",
  "rtspTransport": "tcp",
  "sourceOnDemand": true,
  "sourceOnDemandStartTimeout": "10s",
  "sourceOnDemandCloseAfter": "10s"
}
```

**RTSP — 4:3, no crop (fisheye / older cameras)**
```json
{
  "path": "cam2",
  "label": "Backyard",
  "aspectRatio": "4:3",
  "objectFit": "contain",
  "source": "rtsp://admin:password@192.168.1.102:554/stream1",
  "rtspTransport": "tcp",
  "sourceOnDemand": true,
  "sourceOnDemandStartTimeout": "10s",
  "sourceOnDemandCloseAfter": "10s"
}
```

**RTSP — 16:9, crop to fill cell**
```json
{
  "path": "cam3",
  "label": "Garage",
  "aspectRatio": "16:9",
  "objectFit": "cover",
  "source": "rtsp://admin:password@192.168.1.103:554/stream1",
  "rtspTransport": "tcp",
  "sourceOnDemand": true,
  "sourceOnDemandStartTimeout": "10s",
  "sourceOnDemandCloseAfter": "10s"
}
```

**UniFi Protect — 16:9**
```json
{
  "path": "cam4",
  "label": "Side Gate",
  "aspectRatio": "16:9",
  "objectFit": "contain",
  "source": "rtsp://username:password@10.0.1.1:7447/your-camera-token",
  "rtspTransport": "tcp",
  "sourceOnDemand": true,
  "sourceOnDemandStartTimeout": "10s",
  "sourceOnDemandCloseAfter": "10s"
}
```

**MJPEG over HTTP — 4:3**
```json
{
  "path": "cam5",
  "label": "Workshop",
  "aspectRatio": "4:3",
  "objectFit": "contain",
  "source": "publisher",
  "runOnInit": "ffmpeg -re -i http://camera-ip/nphMotionJpeg -an -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -r 15 -g 30 -f rtsp rtsp://localhost:8554/cam5",
  "runOnInitRestart": true
}
```

**HLS (.m3u8) — 16:9**
```json
{
  "path": "cam6",
  "label": "Driveway",
  "aspectRatio": "16:9",
  "objectFit": "contain",
  "source": "publisher",
  "runOnInit": "ffmpeg -re -i http://server/live/stream.m3u8 -an -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -r 25 -g 50 -f rtsp rtsp://localhost:8554/cam6",
  "runOnInitRestart": true
}
```

### 3. Create `data/mediamtx-base.yml`

Static MediaMTX settings — `paths:` is generated automatically from `streams.json`.

```yaml
logLevel: info
logDestinations: [stdout]

rtmp: no
hls: no
srt: no

rtsp: yes
rtspAddress: :8554

webrtc: yes
webrtcAddress: :8889

api: yes
apiAddress: :9997

webrtcICEServers2:
  - url: stun:${HOST_IP}:${STUN_PORT}
webrtcIPsFromInterfaces: yes
webrtcAdditionalHosts: [${HOST_IP}]
```

### 4. Deploy

```bash
docker compose build
docker compose up -d
```

### 5. Open

Navigate to `http://<HOST_IP>` in any modern browser.

---

## Configuration

### Changing cameras

Edit `data/streams.json`, then:
```bash
docker compose restart mediamtx
```
The browser only needs a refresh — no rebuild required.

### Force a layout

Set `FORCE_LAYOUT` in `docker-compose.yml` to skip the picker:
```yaml
environment:
  FORCE_LAYOUT: "primary-right"
```
Then `docker compose up -d`. Set to `""` to show the picker.

### Fullscreen auto-exit

Set `FULLSCREEN_TIMEOUT` in `docker-compose.yml`:
```yaml
environment:
  FULLSCREEN_TIMEOUT: "30"   # seconds — set to 0 to disable
```
Users can also override this in the layout picker UI. Their preference is saved in `localStorage`.

---

## Layouts

Press **`L`** at any time to open the layout picker.

![Layout Picker](docs/webpage.png)

#### `single` — 1 stream
```
┌──────────────────────┐
│                      │
│         CAM 01       │
│                      │
└──────────────────────┘
```

#### `two-col` — 2 streams, side by side
```
┌───────────┬───────────┐
│           │           │
│  CAM 01   │  CAM 02   │
│           │           │
└───────────┴───────────┘
```

#### `two-row` — 2 streams, stacked
```
┌──────────────────────┐
│       CAM 01         │
├──────────────────────┤
│       CAM 02         │
└──────────────────────┘
```

#### `primary-right` — 3 streams, large left
```
┌─────────────┬─────────┐
│             │  CAM 02 │
│   CAM 01    ├─────────┤
│             │  CAM 03 │
└─────────────┴─────────┘
```

#### `primary-left` — 3 streams, large right
```
┌─────────┬─────────────┐
│  CAM 02 │             │
├─────────┤   CAM 01    │
│  CAM 03 │             │
└─────────┴─────────────┘
```

#### `primary-bottom` — 3 streams, large top
```
┌──────────────────────┐
│                      │
│       CAM 01         │
│                      │
├──────────┬───────────┤
│  CAM 02  │  CAM 03   │
└──────────┴───────────┘
```

#### `primary-top` — 3 streams, large bottom
```
┌──────────┬───────────┐
│  CAM 02  │  CAM 03   │
├──────────┴───────────┤
│                      │
│       CAM 01         │
│                      │
└──────────────────────┘
```

#### `quad` — 4 streams, 2×2 grid
```
┌───────────┬───────────┐
│  CAM 01   │  CAM 02   │
├───────────┼───────────┤
│  CAM 03   │  CAM 04   │
└───────────┴───────────┘
```

#### `six` — 6 streams, 3×2 grid
```
┌────────┬────────┬────────┐
│ CAM 01 │ CAM 02 │ CAM 03 │
├────────┼────────┼────────┤
│ CAM 04 │ CAM 05 │ CAM 06 │
└────────┴────────┴────────┘
```

#### `eight` — 8 streams, 4×2 grid
```
┌──────┬──────┬──────┬──────┐
│CAM 01│CAM 02│CAM 03│CAM 04│
├──────┼──────┼──────┼──────┤
│CAM 05│CAM 06│CAM 07│CAM 08│
└──────┴──────┴──────┴──────┘
```

---

## Common RTSP URL Formats

| Brand | URL |
|-------|-----|
| UniFi Protect | `rtsp://user:pass@ip:7447/token` |
| Hikvision | `rtsp://user:pass@ip:554/Streaming/Channels/101` |
| Dahua | `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0` |
| Reolink | `rtsp://user:pass@ip:554/h264Preview_01_main` |
| Amcrest | `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0` |
| Axis | `rtsp://user:pass@ip:554/axis-media/media.amp` |
| Wyze | `rtsp://user:pass@ip:554/live` |

---

## Ports

| Port | Protocol | Service |
|------|----------|---------|
| 80 | TCP | UI (Nginx) |
| 3478 | UDP/TCP | STUN (coturn) |
| 8554 | TCP | RTSP |
| 8889 | TCP | WebRTC/WHEP signaling |
| 8189 | UDP | WebRTC ICE media |
| 9997 | TCP | MediaMTX API |

---

## Troubleshooting

```bash
docker compose logs -f mediamtx       # stream and config errors
docker compose logs -f rtsp-kiosk-ui  # nginx / UI errors
docker compose restart mediamtx       # restart streams only
docker compose down && docker compose up -d  # full restart
```

**"No Signal" in browser**
1. Check MediaMTX logs show `stream is available and online`
2. Check port `8889` is reachable: `curl http://<HOST_IP>:8889`
3. Check `HOST_IP` in `.env` matches the IP the browser is connecting from

**`deadline exceeded while waiting connection`**
ICE negotiation failed — UDP port `8189` is likely blocked. Verify:
```bash
nc -vzu <HOST_IP> 8189
```

**`jq: error: Is a directory`**
`data/streams.json` was created as a directory by Docker before the file existed. Fix:
```bash
rm -rf data/streams.json
# recreate the file, then:
docker compose restart mediamtx
```

**H.265 cameras**
FFmpeg is bundled in the image and will transcode H.265 → H.264 automatically via a `runOnInit` command in `streams.json`.