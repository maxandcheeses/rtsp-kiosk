function activateView(name, skipCycleReset) {
  const view = getView(name);
  if (!view) { console.warn(`View not found: ${name}`); return; }

  if (typeof closeActionsModal === 'function' && ACTIONS_MODAL_OPEN) closeActionsModal();

  console.log(`Activating view: ${name}`);
  activeView = name;

  // Filter STREAMS to only those in this view, in order
  const ordered = view.streams
    .map(p => STREAMS.find(s => s.path === p))
    .filter(Boolean);

  // ── Promote preloaded PCs into streamPCs BEFORE applyLayout ──
  // This ensures attachExistingPC() finds them when startWhep() runs.
  ordered.forEach(stream => {
    const path = stream.path;
    if (preloadPCs[path]) {
      console.log(`[Preload] promoting ${path} into streamPCs before layout`);
      // Close any existing stale connection for this path
      if (streamPCs[path]) {
        try { streamPCs[path].close(); } catch(e) {}
        streamPCs[path] = null;
      }
      streamPCs[path] = preloadPCs[path];
      activePCs.push(preloadPCs[path]);
      delete preloadPCs[path];
      // Keep preloadVideos[path] so attachExistingPC can grab tracks
    }
  });

  // Temporarily replace STREAMS with the view's subset to build the layout
  const allStreams = STREAMS;
  STREAMS = ordered;
  applyLayout(view.layout);  // startWhep → attachExistingPC will reuse promoted PCs
  STREAMS = allStreams;

  // Clean up preload video elements — must happen AFTER applyLayout() since
  // attachExistingPC() uses preloadVideos[path].srcObject during layout build
  ordered.forEach(stream => { delete preloadVideos[stream.path]; });

  // Release preloaded connections that aren't in this view
  cleanupPreloads(ordered.map(s => s.path));

  // If destroyOffscreen is enabled, close connections for streams not in this view.
  //
  // Keep-alive logic (for streams needed by next view):
  //   maxKeepAlive > 0 — keep alive if total active connections ≤ maxKeepAlive
  //   maxKeepAlive = 0 — use lead time logic (keep if duration ≤ leadTime)
  if (PERF.destroyOffscreen) {
    const activePaths  = ordered.map(s => s.path);
    const curIdx       = VIEWS.findIndex(v => v.name === name);
    const nextView     = VIEWS.length > 1 ? VIEWS[(curIdx + 1) % VIEWS.length] : null;
    const nextPaths    = nextView?.streams || [];
    const maxKeepAlive = PERF.maxKeepAlive || 0;

    // Count currently active connections (in view + already kept alive)
    let activeCount = activePaths.length; // streams in current view always kept

    Object.keys(streamPCs).forEach(path => {
      if (!streamPCs[path]) return;        // already null
      if (activePaths.includes(path)) return; // in current view — always keep

      const neededByNext = nextPaths.includes(path);

      let keep = false;

      if (neededByNext) {
        if (maxKeepAlive > 0) {
          // Keep alive up to the configured max simultaneous connections
          if (activeCount < maxKeepAlive) {
            keep = true;
            activeCount++;
          }
        } else {
          // No limit set — always keep streams needed by next view
          keep = true;
        }
      }

      if (keep) {
        console.log(`[Connection] keeping ${path} alive — needed by next view "${nextView?.name}"${maxKeepAlive > 0 ? ` (${activeCount}/${maxKeepAlive} slots)` : ''}`);
      } else {
        console.log(`[Connection] dropping ${path}${neededByNext ? ' (maxKeepAlive limit reached)' : ''}`);
        try { streamPCs[path].close(); } catch(e) {}
        streamPCs[path] = null;
        if (refreshTimers[path]) { clearInterval(refreshTimers[path]); delete refreshTimers[path]; }
      }
    });
  }

  // Update wall dataset and save last viewed
  document.getElementById('wall').dataset.view = name;
  try { localStorage.setItem('lastView', name); } catch(e) {}

  // Start debug countdown timer for this view
  startDebugTimer(view.duration);
  updateDebugOverlay();

  // Schedule next view if cycling
  if (!skipCycleReset) scheduleCycle(view);

}

function getCycleViews() {
  const filtered = VIEWS.filter(v => v.cycle !== false);
  return filtered.length > 0 ? filtered : VIEWS;
}

function scheduleCycle(view) {
  clearCycle();
  clearPreload();

  // Cycling disabled — duration is ignored, no timer, no preload
  if (!VIEWS_CYCLE || VIEWS.length < 2) return;

  const duration = view.duration;
  if (!duration || duration < 0) return; // -1 = stay forever, no auto-advance

  cycleTimer = setTimeout(() => {
    const pool  = getCycleViews();
    const idx   = pool.findIndex(v => v.name === view.name);
    const next  = pool[(idx + 1) % pool.length];
    cycleIndex  = VIEWS.findIndex(v => v.name === next.name);
    console.log(`[Cycle] ${view.name} → ${next.name}`);
    showIndicator('playing', next.name);
    activateView(next.name);
  }, duration * 1000);
  schedulePreload(view);
}

function clearCycle() {
  if (cycleTimer) { clearTimeout(cycleTimer); cycleTimer = null; }
}

function startCycling() {
  cycleIndex = 0;
  const pool = getCycleViews();
  if (pool.length === 0) return;
  activateView(pool[0].name);
}

// ═══════════════════════════════════════════════════════
// Cycle control — pause/resume and manual navigation
// ═══════════════════════════════════════════════════════
let cyclePaused     = false;
let pausedAt        = null;   // Date.now() when paused
let remainingOnPause = null;  // ms remaining when paused
let indicatorTimer  = null;

function showIndicator(mode, text) {
  const el = document.getElementById('cycle-indicator');
  const icon = el?.querySelector('.ci-icon');
  const label = document.getElementById('ci-text');
  if (!el) return;
  // Remove old state classes, add new ones
  el.classList.remove('paused', 'playing', 'manual');
  el.classList.add('visible', mode);
  if (icon) icon.textContent = mode === 'paused' ? '⏸' : mode === 'playing' ? '▶' : mode === 'manual' ? '⬤' : '';
  if (label) label.textContent = text;
  clearTimeout(indicatorTimer);
  indicatorTimer = setTimeout(() => el.classList.remove('visible', 'paused', 'playing', 'manual'), 3000);
}

function pauseCycle() {
  if (!VIEWS_CYCLE || cyclePaused) return;
  cyclePaused = true;
  // Record how much time was left on the current view's timer
  if (cycleStartedAt && cycleDuration) {
    const elapsed = Date.now() - cycleStartedAt;
    remainingOnPause = Math.max(0, cycleDuration - elapsed);
  }
  clearCycle();
  clearPreload();
  console.log(`[Cycle] paused — ${remainingOnPause ? Math.ceil(remainingOnPause/1000) + 's remaining' : ''}`);
  showIndicator('paused', 'Paused');
  updateDebugOverlay();
}

function resumeCycle() {
  if (!VIEWS_CYCLE || !cyclePaused) return;
  cyclePaused = false;
  const view = getView(activeView);
  if (!view) return;

  // Resume with remaining time instead of full duration
  const resumeDuration = remainingOnPause ?? 0;
  remainingOnPause = null;
  console.log(`[Cycle] resumed — ${Math.ceil(resumeDuration/1000)}s remaining`);
  showIndicator('playing', 'Resumed');

  if (resumeDuration > 0) {
    cycleStartedAt = Date.now() - (cycleDuration - resumeDuration);
    cycleTimer = setTimeout(() => {
      const pool  = getCycleViews();
      const idx   = pool.findIndex(v => v.name === view.name);
      const next  = pool[(idx + 1) % pool.length];
      cycleIndex  = VIEWS.findIndex(v => v.name === next.name);
      console.log(`[Cycle] ${view.name} → ${next.name}`);
      activateView(next.name);
    }, resumeDuration);
    schedulePreload(view);
  } else {
    // Time already expired — advance immediately
    const pool  = getCycleViews();
    const idx   = pool.findIndex(v => v.name === view.name);
    const next  = pool[(idx + 1) % pool.length];
    activateView(next.name);
  }
  updateDebugOverlay();
}

function navigateView(direction) {
  // direction: 1 = forward, -1 = backward
  const pool    = getCycleViews();
  const idx     = pool.findIndex(v => v.name === activeView);
  const safeIdx = idx < 0 ? 0 : idx;
  const nextIdx = (safeIdx + direction + pool.length) % pool.length;
  const next    = pool[nextIdx];
  if (!next) return;

  // Pause auto-cycle during manual navigation if cycling is on
  if (VIEWS_CYCLE) {
    clearCycle();
    clearPreload();
    cyclePaused = false; // manual nav resets pause state
    remainingOnPause = null;
  }

  console.log(`[Manual] navigating ${direction > 0 ? 'forward' : 'back'}: ${activeView} → ${next.name}`);
  showIndicator('manual', `${direction > 0 ? '→' : '←'} ${next.name}`);
  activateView(next.name);
}

// ═══════════════════════════════════════════════════════
// Stream preloading
// Opens hidden WebRTC connections for the next view's streams
// before the view switches, eliminating blank-screen transitions.
//
// Lead time priority:
//   stream.preloadLeadTime  (highest)
//   view.preloadLeadTime
//   default: 5s
//
// Preloaded PCs are kept alive even if current view is -1,
// as long as a preload was already initiated.
// ═══════════════════════════════════════════════════════
const PRELOAD_DEFAULT   = 5;      // seconds
const preloadPCs        = {};     // path → RTCPeerConnection (hidden)

// ═══════════════════════════════════════════════════════
// PERFORMANCE SETTINGS — stored per-device in localStorage
// Each browser can have its own profile.
// ═══════════════════════════════════════════════════════
const PERF_DEFAULTS = {
  lowPower:         false,   // powerPreference: 'low-power' on RTCPeerConnection
  noPreload:        false,   // disable hidden preload connections
  destroyOffscreen: false,   // close WebRTC connections for off-screen streams
  maxStreams:        0,       // cap simultaneous streams (0 = no limit)
  maxKeepAlive:     0,       // max simultaneous kept-alive connections (0 = use lead time logic)
  maxRetryDelay:    30,       // seconds — caps exponential backoff
  debugOverlay:     false,   // show debug overlay on screen
};

let PERF = Object.assign({}, PERF_DEFAULTS);

function loadPerfSettings() {
  try {
    const saved = localStorage.getItem('perfSettings');
    if (saved) PERF = Object.assign({}, PERF_DEFAULTS, JSON.parse(saved));
  } catch(e) {}
  applyPerfSettings();
}

function savePerfSettings() {
  PERF = {
    lowPower:         document.getElementById('perf-low-power')?.checked       ?? PERF_DEFAULTS.lowPower,
    noPreload:        document.getElementById('perf-no-preload')?.checked      ?? PERF_DEFAULTS.noPreload,
    destroyOffscreen: document.getElementById('perf-destroy-offscreen')?.checked ?? PERF_DEFAULTS.destroyOffscreen,
    maxStreams:        parseInt(document.getElementById('perf-max-streams')?.value)  || PERF_DEFAULTS.maxStreams,
    maxRetryDelay:     parseInt(document.getElementById('perf-max-retry')?.value)    || PERF_DEFAULTS.maxRetryDelay,
    maxKeepAlive:      parseInt(document.getElementById('perf-max-keepalive')?.value)  ?? PERF_DEFAULTS.maxKeepAlive,
    debugOverlay:      document.getElementById('perf-debug-overlay')?.checked     ?? PERF_DEFAULTS.debugOverlay,
  };
  try { localStorage.setItem('perfSettings', JSON.stringify(PERF)); } catch(e) {}
  applyPerfSettings();
  console.log('Performance settings saved:', PERF);
}

function applyPerfSettings() {
  // Sync UI inputs to current PERF values
  const set = (id, val) => { const el = document.getElementById(id); if (el) { if (typeof val === 'boolean') el.checked = val; else el.value = val; } };
  set('perf-low-power',         PERF.lowPower);
  set('perf-no-preload',        PERF.noPreload);
  set('perf-destroy-offscreen', PERF.destroyOffscreen);
  set('perf-max-streams',       PERF.maxStreams);
  set('perf-max-retry',         PERF.maxRetryDelay);
  set('perf-debug-overlay',     PERF.debugOverlay);
  set('perf-max-keepalive',     PERF.maxKeepAlive);
  updateDebugOverlay();
}

function resetPerfSettings() {
  PERF = Object.assign({}, PERF_DEFAULTS);
  try { localStorage.removeItem('perfSettings'); } catch(e) {}
  applyPerfSettings();
  console.log('Performance settings reset to defaults');
}

function promptClearStorage() {
  document.getElementById('clear-storage-btn').style.display = 'none';
  const confirm = document.getElementById('clear-storage-confirm');
  confirm.style.display = 'flex';
}

function cancelClearStorage() {
  document.getElementById('clear-storage-confirm').style.display = 'none';
  document.getElementById('clear-storage-btn').style.display = '';
}

function confirmClearStorage() {
  clearAllStorage();
  cancelClearStorage();
  closeAllModals();
}

function clearAllStorage() {
  try {
    localStorage.clear();
    console.log('localStorage cleared');
  } catch(e) {}
  PERF = Object.assign({}, PERF_DEFAULTS);
  applyPerfSettings();
  FULLSCREEN_TIMEOUT = typeof FULLSCREEN_TIMEOUT !== 'undefined' ? FULLSCREEN_TIMEOUT : 30;
  const fsInput = document.getElementById('fs-timeout-input');
  if (fsInput) fsInput.value = FULLSCREEN_TIMEOUT || '';
}

const preloadVideos     = {};     // path → detached <video> element
let   preloadTimer      = null;

function clearPreload() {
  if (preloadTimer) { clearTimeout(preloadTimer); preloadTimer = null; }
}

function getLeadTime(view, streamPath) {
  const stream = STREAMS.find(s => s.path === streamPath);
  return stream?.preloadLeadTime ?? view?.preloadLeadTime ?? PRELOAD_DEFAULT;
}

// Start a hidden WHEP connection for a stream path (not index-based)
async function preloadStream(path) {
  if (preloadPCs[path]) return; // already preloading
  console.log(`Preload: starting hidden connection for ${path}`);

  const whepUrl = `http://${MEDIAMTX_HOST}:${MEDIAMTX_PORT}/${path}/whep`;

  // Use a detached video element — never added to DOM
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  preloadVideos[path] = video;

  try {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: `stun:${MEDIAMTX_HOST}:${typeof STUN_PORT !== 'undefined' ? STUN_PORT : 3478}` }]
    });
    preloadPCs[path] = pc;  // keyed by path

    pc.ontrack = e => {
      video.srcObject = e.streams[0];
      video.play().catch(() => {});
      console.log(`[Preload] ${path} buffering`);
    };

    pc.addTransceiver('video', { direction: 'recvonly' });
    const stream = STREAMS.find(s => s.path === path);
    pc.addTransceiver('audio', { direction: stream?.audio ? 'recvonly' : 'inactive' });

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
    console.log(`[Preload] connection established for ${path}`);

  } catch(e) {
    console.warn(`[Preload] failed for ${path}:`, e);
    delete preloadPCs[path];
    delete preloadVideos[path];
    // Leave streamPCs[path] as null — no active connection
  }
}

// Note: preload promotion is handled inline in activateView()

// Tear down all preloaded connections that aren't needed
function cleanupPreloads(keepPaths) {
  Object.keys(preloadPCs).forEach(path => {
    if (!keepPaths.includes(path)) {
      console.log(`[Preload] releasing unused preload for ${path}`);
      try { preloadPCs[path].close(); } catch(e) {}
      delete preloadPCs[path];
      delete preloadVideos[path];
    }
  });
}

// Schedule preloading for the next view
function schedulePreload(currentView) {
  if (PERF.noPreload) return;
  clearPreload();
  const duration = currentView?.duration;
  if (!duration || duration < 0) return; // -1 = stay forever, no preload trigger

  // Find next view — always wraps (last view preloads first view)
  const idx      = VIEWS.findIndex(v => v.name === currentView.name);
  if (idx === -1) return;
  const nextView = VIEWS[(idx + 1) % VIEWS.length];
  if (!nextView || nextView.name === currentView.name) return;

  // Determine the lead time — use max across streams so all are ready in time
  const streamLeadTimes = nextView.streams.map(p => getLeadTime(nextView, p));
  const leadTime = streamLeadTimes.length ? Math.max(...streamLeadTimes) : PRELOAD_DEFAULT;
  const delay    = Math.max(0, (duration - leadTime) * 1000);

  // Log what we expect to happen at fire time (based on current state)
  nextView.streams.forEach(path => {
    if (streamPCs[path]) {
      console.log(`[Preload] "${path}" currently active — will reuse on switch (no preload needed)`);
    } else {
      console.log(`[Preload] "${path}" not active — will preload in ${delay / 1000}s`);
    }
  });

  preloadTimer = setTimeout(() => {
    // Re-evaluate at fire time — state may have changed since scheduling
    // Only preload streams that are STILL not connected at fire time
    nextView.streams.forEach(path => {
      if (streamPCs[path]) {
        // Active connection exists — reuse it, no preload needed
        console.log(`[Preload] ${path} active at fire time — will reuse, skipping preload`);
      } else if (preloadPCs[path]) {
        console.log(`[Preload] ${path} already preloading`);
      } else {
        console.log(`[Preload] ${path} not connected at fire time — starting hidden connection`);
        preloadStream(path);
      }
    });
  }, delay);
}
