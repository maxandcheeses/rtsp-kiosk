#!/bin/sh
# generate-config.sh
# Generates /data/mediamtx.yml from:
#   - /data/mediamtx-base.yml  (static settings)
#   - /data/streams.json       (camera paths)
# Then substitutes HOST_IP and STUN_PORT env vars.
# Runs at container startup before MediaMTX launches.

set -e

BASE=/data/mediamtx-base.yml
STREAMS=/data/streams.json
OUT=/data/mediamtx.yml

echo "Generating mediamtx.yml from streams.json..."

# Substitute env vars in base config
envsubst '${HOST_IP} ${STUN_PORT}' < "$BASE" > "$OUT"

# Append paths section generated from streams.json
echo "" >> "$OUT"
echo "paths:" >> "$OUT"

# Use jq to iterate streams and emit YAML path blocks
jq -r '.[] | 
  "  " + .path + ":",
  "    source: " + .source,
  (if .rtspTransport then "    rtspTransport: " + .rtspTransport else empty end),
  (if .sourceOnDemand then "    sourceOnDemand: yes" else empty end),
  (if .sourceOnDemandStartTimeout then "    sourceOnDemandStartTimeout: " + .sourceOnDemandStartTimeout else empty end),
  (if .sourceOnDemandCloseAfter then "    sourceOnDemandCloseAfter: " + .sourceOnDemandCloseAfter else empty end),
  (if .runOnInit then "    runOnInit: " + .runOnInit else empty end),
  (if .runOnInitRestart then "    runOnInitRestart: yes" else empty end),
  ""
' "$STREAMS" >> "$OUT"

echo "mediamtx.yml generated:"
cat "$OUT"
echo "---"

exec /mediamtx "$OUT"
