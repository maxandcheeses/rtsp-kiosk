# Custom MediaMTX image with jq and envsubst for config generation.
# Pinned to a specific version for reproducible builds.
FROM bluenviron/mediamtx:1.16.3-ffmpeg

# Install jq (JSON parsing) and gettext (envsubst)
RUN apk add --no-cache jq gettext

# Copy entrypoint script
COPY scripts/generate-config.sh /generate-config.sh
RUN chmod +x /generate-config.sh

ENTRYPOINT ["/generate-config.sh"]
