// ═══════════════════════════════════════════════════════
// Exponential backoff per stream
// Starts at 2s, doubles each failure, caps at 30s.
// Resets to 2s on successful connection.
// Guard flag prevents multiple overlapping retry loops.
// ═══════════════════════════════════════════════════════
const retryDelay   = {};   // current delay per stream PATH
const retryPending = {};   // true if a retry is already scheduled, per PATH
const RETRY_MIN    = 2000;
const RETRY_MAX    = 30000;

function scheduleRetry(index) {
  const path = STREAMS[index]?.path;
  if (!path) return;
  if (retryPending[path]) return;   // already queued for this path
  retryPending[path] = true;
  if (!retryDelay[path]) retryDelay[path] = RETRY_MIN;
  const delay = retryDelay[path];
  retryDelay[path] = Math.min(delay * 2, (PERF.maxRetryDelay || 30) * 1000);
  console.log(`[Retry] ${path} in ${delay / 1000}s (backoff: ${retryDelay[path] / 1000}s next)`);
  setTimeout(() => {
    retryPending[path] = false;
    // Re-resolve index at fire time — view may have changed
    const currentIndex = STREAMS.findIndex(s => s.path === path);
    if (currentIndex === -1) {
      console.log(`[Retry] ${path} no longer in active streams — skipping`);
      return;
    }
    const video = document.getElementById(`v${currentIndex}`);
    if (!video) {
      console.log(`[Retry] ${path} no DOM element — skipping`);
      return;
    }
    startWhep(currentIndex);
  }, delay);
}

function resetRetry(index) {
  const path = STREAMS[index]?.path;
  if (path) {
    retryDelay[path]   = RETRY_MIN;
    retryPending[path] = false;
  }
}

// ═══════════════════════════════════════════════════════
// Stream refresh — periodically reconnects a stream
// Uses per-stream refreshInterval if set, else global.
// ═══════════════════════════════════════════════════════
function scheduleRefresh(index) {
  const stream = STREAMS[index];
  const path   = stream?.path;
  if (!path) return;
  clearRefresh(index);

  if (STREAM_REFRESH_GLOBAL === 0) return; // globally disabled
  const interval = (stream?.refreshInterval ?? STREAM_REFRESH_GLOBAL ?? 0) * 1000;
  if (!interval) return;
  console.log(`[Refresh] ${path} every ${interval / 1000}s`);
  refreshTimerStarted[path] = Date.now();
  refreshTimers[path] = setInterval(() => {
    refreshTimerStarted[path] = Date.now();
    console.log(`Stream ${path}: scheduled refresh`);
    if (streamPCs[path]) {
      try { streamPCs[path].close(); } catch(e) {}
      delete streamPCs[path];
    }
    resetRetry(index);
    startWhep(index);
  }, interval);
}

function clearRefresh(index) {
  const path = STREAMS[index]?.path;
  if (path && refreshTimers[path]) {
    clearInterval(refreshTimers[path]);
    delete refreshTimers[path];
    delete refreshTimerStarted[path];
  }
}

// ═══════════════════════════════════════════════════════
// WebRTC / WHEP
// streamPCs is keyed by stream PATH (not DOM index) so
// connections survive view switches where the same stream
// appears at a different index.
// ═══════════════════════════════════════════════════════
const streamPCs         = {};  // path → RTCPeerConnection
const refreshTimers     = {};  // path → interval handle
const refreshTimerStarted = {}; // path → Date.now() when interval started

// Attach an existing live PC to a new DOM cell (view switch reuse)
function attachExistingPC(path, index) {
  const pc    = streamPCs[path];
  const video = document.getElementById(`v${index}`);
  if (!pc || !video) return false; // null or missing — no active connection

  // Find the track from the existing PC's receivers
  const receivers = pc.getReceivers();
  const videoRecv = receivers.find(r => r.track?.kind === 'video');
  if (!videoRecv || videoRecv.track.readyState !== 'live') return false;

  // Use preloadVideo srcObject if available (already buffered), otherwise
  // build a new MediaStream from the PC's receivers
  const preloadVid = preloadVideos[path];
  if (preloadVid?.srcObject) {
    video.srcObject = preloadVid.srcObject;
  } else {
    const tracks = receivers.map(r => r.track).filter(Boolean);
    video.srcObject = new MediaStream(tracks);
  }
  video.play().catch(() => {});

  const loading = document.getElementById(`load${index}`);
  const errEl   = document.getElementById(`err${index}`);
  const dot     = document.getElementById(`dot${index}`);
  const lbl     = document.getElementById(`lbl${index}`);
  if (loading) loading.classList.add('gone');
  if (errEl)   errEl.classList.remove('show');
  if (dot)     dot.classList.remove('err');
  if (lbl)     lbl.textContent = 'LIVE';

  console.log(`[Connection] reusing existing connection for ${path} at index ${index}`);
  return true;
}

async function startWhep(index) {
  const { path } = STREAMS[index];
  const video   = document.getElementById(`v${index}`);
  const loading = document.getElementById(`load${index}`);
  const errEl   = document.getElementById(`err${index}`);
  const dot     = document.getElementById(`dot${index}`);
  const lbl     = document.getElementById(`lbl${index}`);
  if (!video) return;

  // Try to reuse an existing live connection for this path
  if (attachExistingPC(path, index)) return;

  // Close any stale connection for this path before reconnecting
  if (streamPCs[path]) {
    console.log(`[Connection] dropping stale connection for ${path}`);
    try { streamPCs[path].close(); } catch(e) {}
    streamPCs[path] = null;  // keep key, set null — not active
    console.log(`[Connection] dropped ${path}`);
  }

  console.log(`[Connection] new connection starting for ${path}`);

  const whepUrl = `http://${MEDIAMTX_HOST}:${MEDIAMTX_PORT}/${path}/whep`;

  const setLive = () => {
    loading.classList.add('gone');
    errEl.classList.remove('show');
    dot.classList.remove('err');
    lbl.textContent = 'LIVE';
    resetRetry(index);
    scheduleRefresh(index);
    // Always start muted — browser requires this for autoplay.
    // Unmuting happens via applyMute() only after user interaction.
    video.muted = true;
    if (!globalMuted && userInteracted) applyMute();
  };

  const setError = () => {
    loading.classList.add('gone');
    errEl.classList.add('show');
    dot.classList.add('err');
    lbl.textContent = 'ERR';
    clearRefresh(index);
  };

  let pc;
  try {
    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      ...(PERF.lowPower ? { rtcpMuxPolicy: 'require', iceCandidatePoolSize: 0 } : {}),
    });
    if (PERF.lowPower && pc.setConfiguration) {
      try { pc.setConfiguration({ ...pc.getConfiguration(), powerPreference: 'low-power' }); } catch(e) {}
    }
    streamPCs[path] = pc;
    activePCs.push(pc);

    let trackReceived   = false;
    let disconnectTimer = null;
    let stallTimer      = null;
    let lastFrameCount  = -1;
    let noTrackTimer    = null;
    let retried         = false;  // guard — only retry once per PC lifecycle

    function doRetry(reason) {
      if (retried) return;  // prevent double-retry from multiple triggers
      retried = true;
      clearTimeout(noTrackTimer);
      clearTimeout(disconnectTimer);
      clearInterval(stallTimer);
      if (streamPCs[path] === pc) streamPCs[path] = null;
      try { pc.close(); } catch(e) {}
      setError();
      console.warn(`[Connection] ${path} retrying — ${reason}`);
      scheduleRetry(index);
    }

    // Fallback: if no track arrives within 20s, retry
    noTrackTimer = setTimeout(() => {
      if (!trackReceived) doRetry('no track received within 20s');
    }, 20000);

    pc.ontrack = e => {
      clearTimeout(noTrackTimer);
      trackReceived = true;
      video.srcObject = e.streams[0];
      video.play()
        .then(setLive)
        .catch(err => {
          console.warn(`Stream ${index} autoplay blocked:`, err);
          setLive();
        });

      // ── Video stall watchdog ──
      // Live WebRTC streams don't advance currentTime reliably.
      // Instead track decoded frame count via getVideoPlaybackQuality().
      // If frame count hasn't increased in 8s, the stream has stalled.
      stallTimer = setInterval(() => {
        if (!document.getElementById(`v${index}`)) {
          clearInterval(stallTimer); return;
        }

        // Detect paused-but-should-be-playing — happens when camera restarts
        // and MediaMTX sends a new stream interrupting the play() promise
        if (video.paused && video.readyState >= 2) {
          video.play().catch(() => {});
          setTimeout(() => {
            // Re-check video still exists and is still this stream
            const v = document.getElementById(`v${index}`);
            if (v && v.paused && streamPCs[path] === pc) {
              doRetry('video paused unexpectedly — camera may have restarted');
            }
          }, 2000);
          return;
        }

        // Detect frozen frame — playing but no new frames arriving
        if (video.readyState >= 2 && !video.paused) {
          const quality = video.getVideoPlaybackQuality?.();
          const frames  = quality?.totalVideoFrames ?? -1;
          if (frames !== -1) {
            if (lastFrameCount !== -1 && frames === lastFrameCount) {
              doRetry('video stalled — no new frames decoded');
            }
            lastFrameCount = frames;
          }
        }
      }, 8000);
    };

    // ICE state handler
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log(`[Connection] ${path} ICE: ${state}`);
      if (state === 'failed') {
        doRetry('ICE failed');
      } else if (state === 'disconnected') {
        // Disconnected can be transient — wait 8s before retrying
        clearTimeout(disconnectTimer);
        disconnectTimer = setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            doRetry('ICE disconnected for 8s');
          }
        }, 8000);
      } else if (state === 'connected' || state === 'completed') {
        // Recovered from disconnected — cancel the retry timer
        clearTimeout(disconnectTimer);
      } else if (state === 'closed' && trackReceived) {
        doRetry('ICE closed');
      }
    };

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: STREAMS[index]?.audio ? 'recvonly' : 'inactive' });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') return resolve();
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') resolve();
      };
      setTimeout(resolve, 5000);
    });

    const res = await fetch(whepUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: pc.localDescription.sdp,
    });

    if (!res.ok) throw new Error(`WHEP ${res.status}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    console.log(`[Connection] ${path} WHEP established`);

  } catch(e) {
    console.error(`[Connection] ${path} error:`, e);
    if (streamPCs[path] === pc) streamPCs[path] = null;
    if (pc) { try { pc.close(); } catch(_) {} }
    setError();
    scheduleRetry(index);
  }
}
