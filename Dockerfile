# Stage 1: grab the MediaMTX binary
FROM bluenviron/mediamtx:latest AS mediamtx

# Stage 2: Ubuntu base with FFmpeg installed via apt
FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy MediaMTX binary and default config from stage 1
COPY --from=mediamtx /mediamtx /mediamtx
COPY --from=mediamtx /mediamtx.yml /mediamtx.yml

ENTRYPOINT ["/mediamtx"]