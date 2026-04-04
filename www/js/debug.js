// ═══════════════════════════════════════════════════════
// Global mute — mutes all video elements and persists to localStorage
// Independent of per-stream audio config.
// ═══════════════════════════════════════════════════════
let globalMuted      = false;
let userInteracted   = false;  // true after first click/key/touch

function markInteracted() {
  if (userInteracted) return;
  userInteracted = true;
  // If audio was requested but blocked, try again now
  if (!globalMuted) applyMute();
}

function applyMute() {
  document.querySelectorAll('.cell video').forEach(v => {
    if (!globalMuted && userInteracted) {
      v.muted = false;
      if (v.paused) v.play().catch(() => { v.muted = true; });
    } else {
      v.muted = true;
    }
  });
  const toggle = document.getElementById('settings-mute');
  if (toggle) toggle.checked = globalMuted;
  console.log(`[Audio] ${globalMuted ? 'muted' : (userInteracted ? 'unmuted' : 'unmuted (pending interaction)')}`);
}

function toggleMute() {
  // Can be called from toggle change event — read its value directly
  const toggle = document.getElementById('settings-mute');
  globalMuted = toggle ? toggle.checked : !globalMuted;
  try { localStorage.setItem('globalMuted', globalMuted); } catch(e) {}
  applyMute();
}

function loadMuteState() {
  try {
    const saved = localStorage.getItem('globalMuted');
    if (saved !== null) globalMuted = saved === 'true';
  } catch(e) {}
  applyMute();
}



// ═══════════════════════════════════════════════════════
// Debug overlay
// Shows live stream info + view countdown when enabled.
// Updates every second via setInterval.
// ═══════════════════════════════════════════════════════
let debugInterval  = null;
let cycleStartedAt = null;   // Date.now() when current view activated
let cycleDuration  = null;   // duration in ms of current view

function startDebugTimer(durationSec) {
  cycleStartedAt = Date.now();
  cycleDuration  = (durationSec && durationSec > 0) ? durationSec * 1000 : null;
}

function updateDebugOverlay() {
  const el = document.getElementById('debug-overlay');
  if (!el) return;

  if (!PERF.debugOverlay) {
    el.classList.remove('visible');
    if (debugInterval) { clearInterval(debugInterval); debugInterval = null; }
    return;
  }

  el.classList.add('visible');
  if (!debugInterval) {
    debugInterval = setInterval(updateDebugOverlay, 1000);
  }

  // View countdown + next view stream reuse info
  let countdownHtml = '';
  if (activeView) {
    const view     = getView(activeView);
    const nextIdx  = view ? (VIEWS.findIndex(v => v.name === activeView) + 1) % VIEWS.length : -1;
    const nextView = nextIdx >= 0 ? VIEWS[nextIdx] : null;

    // Which streams in the next view already have a live connection
    const currentPaths = Object.keys(streamPCs);
    const nextPaths    = nextView?.streams || [];
    const reused       = nextPaths.filter(p => currentPaths.includes(p));
    const newConns     = nextPaths.filter(p => !currentPaths.includes(p));
    const preloading   = nextPaths.filter(p => preloadPCs[p] && !streamPCs[p]); // exclude if already active

    // Streams in current view that won't appear in the next view
    const currentViewPaths = view?.streams || [];
    const dropped = currentViewPaths.filter(p => !nextPaths.includes(p));

    const reuseRow = nextView ? `
      <div class="dbg-row"><span class="dbg-key" style="padding-left:8px">reuse</span><span class="dbg-val dbg-live">${reused.length ? reused.join(', ') : '—'}</span></div>
      <div class="dbg-row"><span class="dbg-key" style="padding-left:8px">new conn</span><span class="dbg-val">${newConns.length ? newConns.join(', ') : '—'}</span></div>
      <div class="dbg-row"><span class="dbg-key" style="padding-left:8px">preloading</span><span class="dbg-val" style="color:#facc15">${preloading.length ? preloading.join(', ') : '—'}</span></div>
      <div class="dbg-row"><span class="dbg-key" style="padding-left:8px">dropping</span><span class="dbg-val dbg-err">${dropped.length ? dropped.join(', ') : '—'}</span></div>` : '';

    // Cameras active in current view
    const currentViewStreams = view?.streams || [];
    const currentCamsRow = `
      <div class="dbg-row"><span class="dbg-key" style="padding-left:8px">cameras</span><span class="dbg-val">${currentViewStreams.join(', ') || '—'}</span></div>`;

    if (cycleStartedAt && cycleDuration) {
      const elapsed   = Date.now() - cycleStartedAt;
      const remaining = cyclePaused && remainingOnPause
      ? Math.ceil(remainingOnPause / 1000)
      : Math.max(0, Math.ceil((cycleDuration - elapsed) / 1000));
      countdownHtml = `
        <div class="dbg-section">View</div>
        <div class="dbg-row"><span class="dbg-key">current</span><span class="dbg-val">${activeView}</span></div>
        ${currentCamsRow}
        <div class="dbg-row"><span class="dbg-key">next</span><span class="dbg-val">${nextView?.name || '—'}</span></div>
        <div class="dbg-row"><span class="dbg-key">switching in</span><span class="dbg-val dbg-countdown">${cyclePaused ? "⏸ " : ""}${remaining}s</span></div>
        ${reuseRow}`;
    } else {
      countdownHtml = `
        <div class="dbg-section">View</div>
        <div class="dbg-row"><span class="dbg-key">current</span><span class="dbg-val">${activeView}</span></div>
        ${currentCamsRow}
        <div class="dbg-row"><span class="dbg-key">next</span><span class="dbg-val">${nextView?.name || '—'}</span></div>
        <div class="dbg-row"><span class="dbg-key">switching in</span><span class="dbg-val">—</span></div>
        ${reuseRow}`;
    }
  }

  // Stream rows
  const streamRows = STREAMS.map((s, i) => {
    const video  = document.getElementById(`v${i}`);
    const hasErr = document.getElementById(`err${i}`)?.classList.contains('show');
    const isLive = video && !video.paused && video.readyState >= 2;
    const status = !video ? 'idle' : hasErr ? 'err' : isLive ? 'live' : 'idle';
    const cls    = status === 'live' ? 'dbg-live' : status === 'err' ? 'dbg-err' : '';
    const src    = s.source ? s.source.replace(/:[^@]*@/, ':***@') : '—';
    const refresh = STREAM_REFRESH_GLOBAL === 0
      ? 'off'
      : s.refreshInterval
        ? `${s.refreshInterval}s`
        : STREAM_REFRESH_GLOBAL
          ? `${STREAM_REFRESH_GLOBAL}s`
          : '—';
    // Refresh countdown — show time remaining until next refresh
    let refreshDisplay = refresh;
    if (refresh !== 'off' && refresh !== '—') {
      const intervalSec = s.refreshInterval || STREAM_REFRESH_GLOBAL;
      if (intervalSec && refreshTimers[s.path]) {
        // Estimate remaining: use path-keyed timer start if available
        const elapsed = refreshTimerStarted[s.path]
          ? Math.floor((Date.now() - refreshTimerStarted[s.path]) / 1000) % intervalSec
          : null;
        if (elapsed !== null) {
          const remaining = intervalSec - elapsed;
          refreshDisplay = `${refresh} (${remaining}s)`;
        }
      }
    }

    return `
      <div class="dbg-row"><span class="dbg-key ${cls}">${s.path}</span><span class="dbg-val ${cls}">${status.toUpperCase()}</span></div>
      <div class="dbg-row"><span class="dbg-key" style="padding-left:8px">label</span><span class="dbg-val">${s.label || '—'}</span></div>
      <div class="dbg-row"><span class="dbg-key" style="padding-left:8px">source</span><span class="dbg-val" title="${src}">${src}</span></div>
      <div class="dbg-row"><span class="dbg-key" style="padding-left:8px">refresh</span><span class="dbg-val">${refreshDisplay}</span></div>`;
  }).join('');

  el.innerHTML = `
    <div class="dbg-section">Streams</div>
    ${streamRows}
    ${countdownHtml}`;
}
