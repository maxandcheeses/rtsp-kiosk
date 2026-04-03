#!/bin/sh
# Usage: fake-streams.sh
# Publishes 8 synthetic RTSP test streams to rtsp://localhost:8554/test-N (N=1-8).
# Each stream: 1280x720 @ 30fps, solid color background, large centered stream number.
# Depends on: ffmpeg (in PATH)
#
# Streams are published indefinitely. Send SIGTERM or SIGINT to stop all streams.

set -e

RTSP_BASE="rtsp://localhost:8554"

# Colors per stream (hex, ffmpeg lavfi format)
COLOR_1="0x1a1a2e"  # navy
COLOR_2="0x16213e"  # dark blue
COLOR_3="0x0f3460"  # ocean
COLOR_4="0x533483"  # purple
COLOR_5="0xe94560"  # crimson
COLOR_6="0x1b4332"  # forest green
COLOR_7="0x7b3f00"  # brown
COLOR_8="0x2d6a4f"  # teal

PIDS=""

cleanup() {
    echo "Stopping all ffmpeg stream processes..."
    for pid in $PIDS; do
        kill "$pid" 2>/dev/null || true
    done
    wait
    echo "All streams stopped."
    exit 0
}

trap cleanup TERM INT

echo "Waiting for MediaMTX to be ready..."
sleep 2

start_stream() {
    stream_num="$1"
    color="$2"
    label="Stream $stream_num"
    path="test-${stream_num}"

    ffmpeg -hide_banner -loglevel error \
        -re \
        -f lavfi -i "color=c=${color}:size=1280x720:rate=30" \
        -vf "drawtext=text='${label}':fontsize=200:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:font=Sans" \
        -c:v libx264 \
        -preset ultrafast \
        -tune zerolatency \
        -pix_fmt yuv420p \
        -f rtsp \
        "${RTSP_BASE}/${path}" \
        &
    echo "Started stream ${stream_num} (color ${color}) -> ${RTSP_BASE}/${path} [pid $!]"
    PIDS="$PIDS $!"
}

start_stream 1 "$COLOR_1"
start_stream 2 "$COLOR_2"
start_stream 3 "$COLOR_3"
start_stream 4 "$COLOR_4"
start_stream 5 "$COLOR_5"
start_stream 6 "$COLOR_6"
start_stream 7 "$COLOR_7"
start_stream 8 "$COLOR_8"

echo "All 8 streams started. Waiting..."
wait
