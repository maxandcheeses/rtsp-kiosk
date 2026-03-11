# Video Wall

Fullscreen multi-camera WebRTC video wall. Supports 1–8 streams with selectable layouts.

```
┌─────────────────┬──────────┐
│                 │  CAM 02  │
│     CAM 01      ├──────────┤
│                 │  CAM 03  │
└─────────────────┴──────────┘
```

---

## Stack

| Component | Role |
|-----------|------|
| **MediaMTX** | Ingests any camera source, exposes WebRTC/WHEP to browsers |
| **FFmpeg** (bundled in image) | Transcodes MJPEG/HLS/MP4 sources → H.264 RTSP |
| **Nginx** | Serves the video wall UI on port 80, injects env config |

---

## Quick Start

### 1. Configure camera sources in `mediamtx.yml`

Each camera gets a named path. The path name (`cam1`, `cam2`, etc.) must match the `STREAMS` array in `www/index.html`.

**⚠️ Important:** Each `runOnInit` command must publish to its own path. `cam1` must publish to `rtsp://localhost:8554/cam1`, `cam2` to `cam2`, and so on.

#### RTSP (native — most IP cameras, no FFmpeg needed)
```yaml
cam1:
  source: rtsp://admin:password@192.168.1.101:554/stream1
  sourceOnDemand: yes
  sourceOnDemandStartTimeout: 10s
  sourceOnDemandCloseAfter: 10s
```

#### RTSPS — encrypted RTSP over TLS
```yaml
cam1:
  source: rtsps://admin:password@192.168.1.101:322/stream
  sourceOnDemand: yes
```

#### MJPEG over HTTP
```yaml
cam2:
  runOnInit: >-
    ffmpeg -re
    -i "http://camera-ip/nphMotionJpeg"
    -c:v libx264 -preset ultrafast -tune zerolatency
    -pix_fmt yuv420p -r 15 -g 30
    -f rtsp rtsp://localhost:8554/cam2
  runOnInitRestart: yes
```

#### HLS (.m3u8)
```yaml
cam3:
  runOnInit: >-
    ffmpeg -re
    -i "http://server/live/stream.m3u8"
    -c:v libx264 -preset ultrafast -tune zerolatency
    -pix_fmt yuv420p -r 25 -g 50
    -f rtsp rtsp://localhost:8554/cam3
  runOnInitRestart: yes
```

#### MP4 / HTTP video (loops continuously)
```yaml
cam3:
  runOnInit: >-
    ffmpeg -re -stream_loop -1
    -i "http://server/clip.mp4"
    -c:v libx264 -preset ultrafast -tune zerolatency
    -pix_fmt yuv420p -r 25 -g 50
    -f rtsp rtsp://localhost:8554/cam3
  runOnInitRestart: yes
```

#### USB / local webcam (Linux)
```yaml
cam1:
  runOnInit: >-
    ffmpeg -re
    -f v4l2 -i /dev/video0
    -c:v libx264 -preset ultrafast -tune zerolatency
    -pix_fmt yuv420p -r 30 -g 60
    -f rtsp rtsp://localhost:8554/cam1
  runOnInitRestart: yes
```

---

### 2. (Optional) Force a layout

By default the UI shows a layout picker on load. To lock all sessions to a specific layout, set `FORCE_LAYOUT` in `docker-compose.yml`:

```yaml
environment:
  FORCE_LAYOUT: "primary-right"
```

See the [Layouts](#layouts) section below for all valid values.

---

### 3. Deploy

```bash
docker compose up -d
```

### 4. Open

Navigate to `http://<your-server-ip>` in any modern browser.

---

## Layouts

The UI supports 10 layouts selectable from a picker on load. Press **`L`** at any time to reopen the picker.

| Value | Streams | Description |
|-------|---------|-------------|
| `single` | 1 | Single fullscreen stream |
| `two-col` | 2 | Side by side |
| `two-row` | 2 | Stacked vertically |
| `primary-right` | 3 | Large left + 2 stacked right |
| `primary-left` | 3 | 2 stacked left + large right |
| `primary-bottom` | 3 | Large top + 2 bottom |
| `primary-top` | 3 | 2 top + large bottom |
| `quad` | 4 | 2×2 grid |
| `six` | 6 | 3×2 grid |
| `eight` | 8 | 4×2 grid |

### Forcing a layout via environment variable

Set `FORCE_LAYOUT` in `docker-compose.yml` to skip the picker and lock all new browser sessions to a specific layout:

```yaml
# docker-compose.yml
services:
  nginx:
    environment:
      FORCE_LAYOUT: "quad"
```

- The layout picker is hidden and the `L` key is disabled when a layout is forced.
- Each user's last-chosen layout is saved in `localStorage` when no layout is forced.
- To revert to showing the picker, set `FORCE_LAYOUT: ""`.
- Changes take effect after `docker compose up -d` (no rebuild needed).

---

## Changing layouts at runtime

| Method | How |
|--------|-----|
| Keyboard | Press **`L`** to open/close the layout picker |
| Force via env | Set `FORCE_LAYOUT` in `docker-compose.yml` and run `docker compose up -d` |

---

## Common RTSP URL formats

| Brand | URL |
|-------|-----|
| Hikvision | `rtsp://user:pass@ip:554/Streaming/Channels/101` |
| Dahua | `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0` |
| Reolink | `rtsp://user:pass@ip:554/h264Preview_01_main` |
| Amcrest | `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0` |
| Axis | `rtsp://user:pass@ip:554/axis-media/media.amp` |
| Wyze | `rtsp://user:pass@ip:554/live` |

---

## File Structure

```
video-wall/
├── Dockerfile                # Builds MediaMTX + FFmpeg image
├── docker-compose.yml        # Service orchestration + FORCE_LAYOUT config
├── mediamtx.yml              # Camera sources, WebRTC, ICE config
├── nginx.conf                # Nginx vhost
├── README.md
└── www/
    └── index.html            # Video wall UI (layout picker + WebRTC player)
```

---

## Docker Desktop (Mac/Windows)

`network_mode: host` does not work on Docker Desktop. The project already uses bridge networking with explicit port mapping. If WebRTC streams connect but no video appears, set your machine's LAN IP in `mediamtx.yml`:

```yaml
webrtcAdditionalHosts: [192.168.x.x]   # your LAN IP
```

Find your IP: `ipconfig getifaddr en0` (Mac) or `ipconfig` (Windows).

---

## Accessing Over the Internet

Set your server's public IP in `mediamtx.yml`:
```yaml
webrtcAdditionalHosts: [YOUR_PUBLIC_IP]
```

Open these ports on your firewall/router:
- `80` — UI
- `8889` — WebRTC/WHEP signaling
- `8189/udp` — WebRTC ICE media

For strict NAT, add a TURN server:
```yaml
webrtcICEServers2:
  - url: turn:your-turn-server:3478
    username: user
    password: pass
```

---

## Troubleshooting

```bash
docker compose logs -f mediamtx        # Stream and FFmpeg errors
docker compose logs -f video-wall-ui   # Nginx / UI errors
docker compose restart mediamtx        # Restart streams only
docker compose down && docker compose up -d  # Full restart
```

**"No Signal" in browser** — check that:
1. MediaMTX logs show the stream as `available and online`
2. Port `8889` is reachable from the browser (`curl http://<ip>:8889`)
3. `webrtcAdditionalHosts` is set to your LAN/public IP

**cam path conflict** — if you see `closing existing publisher`, two FFmpeg processes are publishing to the same path. Check each `runOnInit` command ends with the correct `rtsp://localhost:8554/camN` for its own path.

**H.265 cameras** — the custom Docker image includes FFmpeg which transcodes H.265 → H.264 for browser compatibility.