#!/bin/sh
# generate-config.sh
# 1. Generates /data/mediamtx.yml from mediamtx-base.yml + streams.json
# 2. Generates /data/streams-public.json — credentials stripped
# 3. Copies /data/views.json to /data/views-public.json (no sensitive data)
# Runs at container startup before MediaMTX launches.

set -e

BASE=/data/mediamtx-base.yml
STREAMS=/data/streams.json
VIEWS=/data/views.json
OUT=/data/mediamtx.yml
PUBLIC=/data/streams-public.json
VIEWS_PUBLIC=/data/views-public.json

# Sanity checks
if [ ! -f "$BASE" ]; then
  echo "ERROR: $BASE not found."
  exit 1
fi
if [ ! -f "$STREAMS" ]; then
  echo "ERROR: $STREAMS not found."
  exit 1
fi

# ── 1. Generate mediamtx.yml ─────────────────────────────────────────────────
echo "Generating mediamtx.yml from streams.json..."

envsubst '${HOST_IP} ${STUN_PORT}' < "$BASE" > "$OUT"
echo "" >> "$OUT"
echo "paths:" >> "$OUT"

STREAMS_ARRAY=$(jq 'if type == "array" then . else .streams end' "$STREAMS")

echo "$STREAMS_ARRAY" | jq -r '.[] |
  "  " + .path + ":",
  "    source: " + .source,
  (if .rtspTransport then "    rtspTransport: " + .rtspTransport else empty end),
  (if .sourceOnDemand then "    sourceOnDemand: yes" else empty end),
  (if .sourceOnDemandStartTimeout then "    sourceOnDemandStartTimeout: " + .sourceOnDemandStartTimeout else empty end),
  (if .sourceOnDemandCloseAfter then "    sourceOnDemandCloseAfter: " + .sourceOnDemandCloseAfter else empty end),
  (if .runOnInit then "    runOnInit: " + .runOnInit else empty end),
  (if .runOnInitRestart then "    runOnInitRestart: yes" else empty end),
  ""
' >> "$OUT"

echo "mediamtx.yml generated."

# ── 2. Generate streams-public.json ──────────────────────────────────────────
echo "Generating streams-public.json..."

echo "$STREAMS_ARRAY" | jq '[.[] | {
  path, label, aspectRatio, objectFit, audio, refreshInterval, preloadLeadTime,
  source: (
    if .source then
      (.source | split("@")) as $parts |
      if ($parts | length) > 1 then
        (($parts[0] | split("//")[0]) + "//***@" +
         ($parts[1] | split("/")[0]) + "/***")
      else
        ((.source | split("//")[0]) + "//" +
         (.source | split("//")[1] | split("/")[0]) + "/***")
      end
    else null end
  )
} | with_entries(select(.value != null))]' > "$PUBLIC"

echo "streams-public.json generated."

# ── 3. Copy views.json → views-public.json ───────────────────────────────────
if [ -f "$VIEWS" ]; then
  echo "Copying views.json to views-public.json..."
  cp "$VIEWS" "$VIEWS_PUBLIC"
  echo "views-public.json ready."
else
  echo "No views.json found — skipping."
  echo '{"default":null,"cycle":false,"views":[]}' > "$VIEWS_PUBLIC"
fi

exec /mediamtx "$OUT"