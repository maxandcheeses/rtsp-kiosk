#!/bin/sh
# reload-watcher.sh
# Watches data files for changes and writes a reload trigger file.
# Nginx serves /reload-events as an SSE endpoint via the trigger file.

WATCH_DIR=/data
TRIGGER=/tmp/reload-trigger
INTERVAL=2  # poll every 2 seconds

echo "Watching $WATCH_DIR for changes..."

get_mtime() {
  stat -c %Y "$1" 2>/dev/null || echo 0
}

LAST_STREAMS=$(get_mtime "$WATCH_DIR/streams.json")
LAST_VIEWS=$(get_mtime "$WATCH_DIR/views.json")

while true; do
  sleep $INTERVAL
  CUR_STREAMS=$(get_mtime "$WATCH_DIR/streams.json")
  CUR_VIEWS=$(get_mtime "$WATCH_DIR/views.json")

  if [ "$CUR_STREAMS" != "$LAST_STREAMS" ] || [ "$CUR_VIEWS" != "$LAST_VIEWS" ]; then
    echo "File change detected — signaling reload"
    echo "$(date +%s)" > "$TRIGGER"
    LAST_STREAMS=$CUR_STREAMS
    LAST_VIEWS=$CUR_VIEWS
  fi
done