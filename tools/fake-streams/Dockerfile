FROM alpine:3.19

# Install ffmpeg and ca-certificates
RUN apk add --no-cache ffmpeg ca-certificates

# Download and install MediaMTX v1.9.3 for linux/amd64
RUN wget -qO /tmp/mediamtx.tar.gz \
    https://github.com/bluenviron/mediamtx/releases/download/v1.9.3/mediamtx_v1.9.3_linux_amd64.tar.gz \
    && tar -xzf /tmp/mediamtx.tar.gz -C /usr/local/bin mediamtx \
    && rm /tmp/mediamtx.tar.gz

# Copy config and stream script
COPY mediamtx.yml /etc/mediamtx/mediamtx.yml
COPY fake-streams.sh /usr/local/bin/fake-streams.sh
RUN chmod +x /usr/local/bin/fake-streams.sh

EXPOSE 8554

# Start MediaMTX in background, then run the stream publisher
CMD ["/bin/sh", "-c", "mediamtx /etc/mediamtx/mediamtx.yml & exec fake-streams.sh"]
