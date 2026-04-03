#!/bin/bash
# fake-streams.sh
# Generates 8 synthetic RTSP streams via FFmpeg and publishes them to MediaMTX.
# Each stream has a solid color background with its stream number centered.
#
# Usage: ./scripts/fake-streams.sh [MEDIAMTX_HOST]
# Default host: localhost
#
# Prerequisites: ffmpeg must be installed (brew install ffmpeg)

set -e

HOST="${1:-localhost}"
RTSP_PORT=8554

# Color palette (R:G:B) for streams 1-8
COLORS=(
  "0x1a1a2e"   # 1 — navy
  "0x16213e"   # 2 — dark blue
  "0x0f3460"   # 3 — ocean
  "0x533483"   # 4 — purple
  "0xe94560"   # 5 — crimson
  "0x1b4332"   # 6 — forest green
  "0x7b3f00"   # 7 — brown
  "0x2d6a4f"   # 8 — teal
)

PIDS=()

cleanup() {
  echo ""
  echo "Stopping all fake streams..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "Done."
}

trap cleanup INT TERM

if ! command -v ffmpeg &>/dev/null; then
  echo "ERROR: ffmpeg not found. Install it with: brew install ffmpeg"
  exit 1
fi

echo "Starting 8 fake RTSP streams → rtsp://$HOST:$RTSP_PORT/test-N"
echo "Press Ctrl+C to stop all streams."
echo ""

for i in $(seq 1 8); do
  COLOR="${COLORS[$((i-1))]}"
  STREAM_URL="rtsp://$HOST:$RTSP_PORT/test-$i"

  ffmpeg -re \
    -f lavfi \
    -i "color=c=${COLOR}:size=1280x720:rate=30,drawtext=text='${i}':fontcolor=white:fontsize=300:x=(w-tw)/2:y=(h-th)/2:font=Helvetica" \
    -c:v libx264 \
    -preset ultrafast \
    -tune zerolatency \
    -pix_fmt yuv420p \
    -f rtsp \
    -rtsp_transport tcp \
    "$STREAM_URL" \
    -loglevel error \
    &

  PIDS+=($!)
  echo "  Stream $i → $STREAM_URL  (color: $COLOR)"
done

echo ""
echo "All 8 streams running. Waiting..."
wait
