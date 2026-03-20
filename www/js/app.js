// ═══════════════════════════════════════════════════════
  // CONFIG — edit these to match your mediamtx.yml paths
  // ═══════════════════════════════════════════════════════
  const MEDIAMTX_HOST = window.location.hostname;
  const MEDIAMTX_PORT = 8889;

  // ═══════════════════════════════════════════════════════
  // MQTT CONFIG
  // Set MQTT_ENABLED to true to receive stream config from
  // an MQTT broker instead of (or in addition to) streams.json.
  //
  // Topics:
  //   MQTT_TOPIC_ALL      — full streams array (JSON array)
  //                         published on connect / retained
  //   MQTT_TOPIC_STREAM   — per-stream updates (JSON object)
  //                         topic: <prefix>/<path> e.g. kiosk/streams/cam1
  //
  // Auth:
  //   Leave MQTT_USERNAME/PASSWORD empty for no-auth.
  //   Set MQTT_TLS: true for wss:// connection.
  // ═══════════════════════════════════════════════════════
  // MQTT config can be set here as defaults, or loaded from streams.json:
  // { "streams": [...], "mqtt": { "enabled": true, "host": "...", ... } }
  // streams.json values take precedence over these defaults.
  const MQTT_DEFAULTS = {
    enabled:    false,
    host:       window.location.hostname,
    port:       9001,           // EMQX WebSocket default (not 1883)
    tls:        false,          // true = wss://, false = ws://
    username:   '',
    password:   '',
    topicBase:  'kiosk/streams', // per-stream: kiosk/streams/<path>
  };

  // Resolved at boot after streams.json is loaded — see startMQTT()
  let MQTT_ENABLED, MQTT_HOST, MQTT_PORT, MQTT_TLS,
      MQTT_USERNAME, MQTT_PASSWORD, MQTT_TOPIC_ALL, MQTT_TOPIC_STREAM;



  // ═══════════════════════════════════════════════════════
  // STREAM CONFIG — loaded from /streams.json at startup.
  // Edit data/streams.json to add, remove, or configure streams.
  // No container restart needed — just refresh the browser.
  // ═══════════════════════════════════════════════════════
  let STREAMS = [];
  let STREAMS_STATIC = {};  // fields locked from streams.json — MQTT cannot override these
  let MQTT_CONFIG    = null; // mqtt block from streams.json

  async function loadStreams() {
    try {
      const res = await fetch('/streams.json');
      if (!res.ok) throw new Error(`Failed to load streams.json: ${res.status}`);
      const data = await res.json();

      // streams.json can be either:
      //   [ ...streams ]              — array only (legacy)
      //   { streams: [...], mqtt: {} } — object with streams + mqtt config
      if (Array.isArray(data)) {
        STREAMS = data;
      } else {
        STREAMS     = data.streams || [];
        MQTT_CONFIG = data.mqtt   || null;
      }

      // Record which fields are explicitly set per stream in streams.json
      // These will not be overridden by MQTT messages
      STREAMS_STATIC = {};
      STREAMS.forEach(s => {
        STREAMS_STATIC[s.path] = Object.keys(s);
        // Initialise streamPCs entry as null — key always present for known streams
        if (!(s.path in streamPCs)) streamPCs[s.path] = null;
      });

    } catch(e) {
      console.error('Could not load streams.json:', e);
      STREAMS = [];
    }
  }
  // ═══════════════════════════════════════════════════════
  // VIEWS — named configurations of streams + layout
  // Loaded from /views.json. Supports cycling and MQTT control.
  // ═══════════════════════════════════════════════════════
  let VIEWS         = [];
  let VIEWS_DEFAULT = null;
  let VIEWS_CYCLE   = false;

  let activeView    = null;   // currently displayed view name
  let cycleTimer    = null;   // setTimeout handle for cycling
  let cycleIndex    = 0;      // current position in cycle

  async function loadViews() {
    try {
      const res = await fetch('/views.json');
      if (!res.ok || res.status === 404) return; // views.json is optional
      const data = await res.json();
      VIEWS         = data.views   || [];
      VIEWS_DEFAULT = data.default || (VIEWS[0]?.name ?? null);
      VIEWS_CYCLE   = data.cycle   || false;
    } catch(e) {
      console.warn('Could not load views.json — views disabled:', e);
    }
  }

  function getView(name) {
    return VIEWS.find(v => v.name === name) || null;
  }

  function activateView(name, skipCycleReset) {
    const view = getView(name);
    if (!view) { console.warn(`View not found: ${name}`); return; }

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

  function scheduleCycle(view) {
    clearCycle();
    clearPreload();

    // Cycling disabled — duration is ignored, no timer, no preload
    if (!VIEWS_CYCLE || VIEWS.length < 2) return;

    const duration = view.duration;
    if (!duration || duration < 0) return; // -1 = stay forever, no auto-advance

    cycleTimer = setTimeout(() => {
      const idx  = VIEWS.findIndex(v => v.name === view.name);
      const next = VIEWS[(idx + 1) % VIEWS.length];
      cycleIndex = (idx + 1) % VIEWS.length;
      console.log(`[Cycle] ${view.name} → ${next.name}`);
      showIndicator('playing', next.label || next.name);
      activateView(next.name);
    }, duration * 1000);
    schedulePreload(view);
  }

  function clearCycle() {
    if (cycleTimer) { clearTimeout(cycleTimer); cycleTimer = null; }
  }

  function startCycling() {
    cycleIndex = 0;
    if (VIEWS.length === 0) return;
    activateView(VIEWS[0].name);
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
        const idx  = VIEWS.findIndex(v => v.name === view.name);
        const next = VIEWS[(idx + 1) % VIEWS.length];
        cycleIndex = (idx + 1) % VIEWS.length;
        console.log(`[Cycle] ${view.name} → ${next.name}`);
        activateView(next.name);
      }, resumeDuration);
      schedulePreload(view);
    } else {
      // Time already expired — advance immediately
      const idx  = VIEWS.findIndex(v => v.name === view.name);
      const next = VIEWS[(idx + 1) % VIEWS.length];
      activateView(next.name);
    }
    updateDebugOverlay();
  }

  function navigateView(direction) {
    // direction: 1 = forward, -1 = backward
    const idx     = VIEWS.findIndex(v => v.name === activeView);
    const nextIdx = (idx + direction + VIEWS.length) % VIEWS.length;
    const next    = VIEWS[nextIdx];
    if (!next) return;

    // Pause auto-cycle during manual navigation if cycling is on
    if (VIEWS_CYCLE) {
      clearCycle();
      clearPreload();
      cyclePaused = false; // manual nav resets pause state
      remainingOnPause = null;
    }

    console.log(`[Manual] navigating ${direction > 0 ? 'forward' : 'back'}: ${activeView} → ${next.name}`);
    showIndicator('manual', `${direction > 0 ? '→' : '←'} ${next.label || next.name}`);
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

  function clearAllStorage() {
    try {
      localStorage.clear();
      console.log('localStorage cleared');
    } catch(e) {}
    // Reset in-memory perf settings too
    PERF = Object.assign({}, PERF_DEFAULTS);
    applyPerfSettings();
    // Reset fullscreen timeout to env default
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

  // ═══════════════════════════════════════════════════════
  // LAYOUTS
  // Each layout defines:
  //   streams  — how many streams to show
  //   css      — grid-template-columns + grid-template-rows
  //   spans    — optional per-cell {col, row} span overrides
  // ═══════════════════════════════════════════════════════
  const LAYOUTS = {
    'single':         { streams: 1, css: { cols: '1fr',           rows: '1fr' } },
    'two-col':        { streams: 2, css: { cols: '1fr 1fr',       rows: '1fr' } },
    'two-row':        { streams: 2, css: { cols: '1fr',           rows: '1fr 1fr' } },
    'primary-right':  { streams: 3, css: { cols: '2fr 1fr',       rows: '1fr 1fr' },
                        spans: [{ col: '1', row: '1 / 3' }] },
    'primary-left':   { streams: 3, css: { cols: '1fr 2fr',       rows: '1fr 1fr' },
                        spans: [{ col: '2', row: '1 / 3', colStart: 2 }] },
    'primary-bottom': { streams: 3, css: { cols: '1fr 1fr',       rows: '2fr 1fr' },
                        spans: [{ col: '1 / 3', row: '1' }] },
    'primary-top':    { streams: 3, css: { cols: '1fr 1fr',       rows: '1fr 2fr' },
                        spans: [{ col: '1 / 3', row: '2' }] },
    'quad':           { streams: 4, css: { cols: '1fr 1fr',       rows: '1fr 1fr' } },
    'six':            { streams: 6, css: { cols: '1fr 1fr 1fr',   rows: '1fr 1fr' } },
    'eight':          { streams: 8, css: { cols: '1fr 1fr 1fr 1fr', rows: '1fr 1fr' } },
  };

  // ═══════════════════════════════════════════════════════
  // Best layout — picks the most suitable layout for N streams
  // 1→single, 2→two-col, 3→primary-right, 4→quad,
  // 5-6→six, 7-8→eight
  // ═══════════════════════════════════════════════════════
  function bestLayout(count) {
    if (count <= 1) return 'single';
    if (count === 2) return 'two-col';
    if (count === 3) return 'primary-right';
    if (count === 4) return 'quad';
    if (count <= 6) return 'six';
    return 'eight';
  }

  // ═══════════════════════════════════════════════════════
  // Active peer connections — tracked so we can close them
  // ═══════════════════════════════════════════════════════
  let activePCs = [];

  function stopAll() {
    activePCs.forEach(pc => { try { pc.close(); } catch(e){} });
    activePCs = [];
  }

  // ═══════════════════════════════════════════════════════
  // Build the wall DOM for a given layout
  // ═══════════════════════════════════════════════════════
  function applyLayout(name) {
    const layout = LAYOUTS[name];
    if (!layout) return;

    // Only close connections for streams NOT in the incoming layout.
    // Streams that remain get their PC reused via attachExistingPC().
    const incomingPaths = STREAMS.slice(0, layout.streams).map(s => s.path);
    activePCs = activePCs.filter(pc => {
      const path = Object.keys(streamPCs).find(p => streamPCs[p] === pc);
      if (path && incomingPaths.includes(path)) return true; // keep
      try { pc.close(); } catch(e) {}
      if (path) streamPCs[path] = null; // mark as not active, keep key
      return false;
    });

    const wall = document.getElementById('wall');
    wall.style.gridTemplateColumns = layout.css.cols;
    wall.style.gridTemplateRows    = layout.css.rows;
    wall.innerHTML = '';

    const maxStr = PERF.maxStreams > 0 ? PERF.maxStreams : Infinity;
    const count = Math.min(layout.streams, STREAMS.length, maxStr);

    for (let i = 0; i < count; i++) {
      const stream = STREAMS[i];
      const span   = layout.spans?.[i];
      const num    = String(i + 1).padStart(2, '0');

      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.id = `cell${i}`;

      if (span) {
        if (span.col)      cell.style.gridColumn = span.col;
        if (span.row)      cell.style.gridRow    = span.row;
        if (span.colStart) cell.style.gridColumnStart = span.colStart;
      }

      // Apply per-stream aspect ratio to the cell
      // Config uses '16:9' notation; CSS requires '16/9'
      if (stream.aspectRatio) {
        cell.style.aspectRatio = stream.aspectRatio.replace(':', '/');
        cell.style.maxWidth    = '100%';
        cell.style.maxHeight   = '100%';
        cell.style.margin      = 'auto';
      }

      // objectFit applied inline on the video element
      const objectFit = stream.objectFit || 'contain';

      cell.innerHTML = `
        <div class="loading" id="load${i}"><div class="ring"></div></div>
        <div class="err-overlay" id="err${i}">
          <div class="err-inner">
            <div class="err-code">No Signal</div>
            <div class="err-sub">${stream.label}</div>
          </div>
        </div>
        <video id="v${i}" autoplay muted playsinline style="object-fit:${objectFit}"></video>
        <div class="chrome">
          <div class="live">
            <div class="live-row"><span class="dot" id="dot${i}"></span><span id="lbl${i}">LIVE</span></div>
            <div class="lbl">${stream.label}</div>
          </div>
          <button class="btn-fs" onclick="toggleFS(${i})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M16 21h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
            </svg>
          </button>
        </div>`;

      wall.appendChild(cell);
    }

    // Hide picker, start streams
    document.getElementById('picker').classList.remove('open');
    for (let i = 0; i < count; i++) startWhep(i);

    // Save choice
    try { localStorage.setItem('layout', name); } catch(e) {}
    updateDebugOverlay();
  }

  // ═══════════════════════════════════════════════════════
  // Exponential backoff per stream
  // Starts at 2s, doubles each failure, caps at 30s.
  // Resets to 2s on successful connection.
  // Guard flag prevents multiple overlapping retry loops.
  // ═══════════════════════════════════════════════════════
  const retryDelay   = {};   // current delay per stream index
  const retryPending = {};   // true if a retry is already scheduled
  const RETRY_MIN    = 2000;
  const RETRY_MAX    = 30000;

  function scheduleRetry(index) {
    if (retryPending[index]) return;   // already queued, don't stack
    retryPending[index] = true;
    if (!retryDelay[index]) retryDelay[index] = RETRY_MIN;
    const delay = retryDelay[index];
    retryDelay[index] = Math.min(delay * 2, (PERF.maxRetryDelay || 30) * 1000);
    console.log(`Stream ${index}: retry in ${delay / 1000}s`);
    setTimeout(() => {
      retryPending[index] = false;
      startWhep(index);
    }, delay);
  }

  function resetRetry(index) {
    retryDelay[index]   = RETRY_MIN;
    retryPending[index] = false;
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

      let trackReceived  = false;
      let disconnectTimer = null;
      let stallTimer      = null;
      let lastFrameCount  = -1;

      function doRetry(reason) {
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
      const noTrackTimer = setTimeout(() => {
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
            // Try to resume first
            video.play().catch(() => {});
            // Give it 2s — if still paused, reconnect
            setTimeout(() => {
              if (video.paused) doRetry('video paused unexpectedly — camera may have restarted');
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
      console.error(`Stream ${index}:`, e);
      if (streamPCs[path] === pc) streamPCs[path] = null;
      setError();
      scheduleRetry(index);
    }
  }
  // ═══════════════════════════════════════════════════════
  // Fullscreen per cell
  // Auto-exits after FULLSCREEN_TIMEOUT seconds if set.
  // ═══════════════════════════════════════════════════════
  let fsTimer = null;

  function clearFsTimer() {
    if (fsTimer) { clearTimeout(fsTimer); fsTimer = null; }
  }

  function toggleFS(index) {
    const cell = document.getElementById(`cell${index}`);
    if (!document.fullscreenElement) {
      (cell.requestFullscreen || cell.webkitRequestFullscreen).call(cell);
      // Start auto-exit timer if configured
      if (FULLSCREEN_TIMEOUT) {
        clearFsTimer();
        fsTimer = setTimeout(() => {
          if (document.fullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
          }
        }, FULLSCREEN_TIMEOUT * 1000);
      }
    } else {
      clearFsTimer();
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
  }

  // Also clear the timer if user exits fullscreen manually (Escape key etc.)
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) clearFsTimer();
  });

  // ═══════════════════════════════════════════════════════
  // Keyboard shortcuts
  //   L — layout picker
  //   D — streams debug modal
  //   Escape — close any open modal
  // ═══════════════════════════════════════════════════════
  let returnToSettings = false; // true when a modal was opened from settings

  function closeAllModals() {
    document.getElementById('picker').classList.remove('open');
    document.getElementById('streams-modal').classList.remove('open');
    document.getElementById('views-modal').classList.remove('open');
    document.getElementById('settings-modal').classList.remove('open');
    document.getElementById('performance-modal').classList.remove('open');

    // Return to settings if we navigated here from it
    if (returnToSettings) {
      returnToSettings = false;
      document.getElementById('settings-modal').classList.add('open');
    }
  }

  function openSettingsModal() {
    returnToSettings = false;
    closeAllModals();
    document.getElementById('settings-modal').classList.add('open');
  }

  // Open a modal from within settings — closing returns to settings
  function openFromSettings(which) {
    returnToSettings = true;
    document.getElementById('settings-modal').classList.remove('open');
    document.getElementById('performance-modal').classList.remove('open');
    if (which === 'picker') {
      stopAll();
      document.getElementById('picker').classList.add('open');
    } else if (which === 'views') {
      openViewsModal();
    } else if (which === 'streams') {
      openStreamsModal();
    } else if (which === 'performance') {
      closeAllModals();
      returnToSettings = true;
      document.getElementById('performance-modal').classList.add('open');
    }
  }

  // F key also opens performance directly
  // (handled separately in keydown — openFromSettings just for settings nav)

  // ═══════════════════════════════════════════════════════
  // Layout SVG icons — same as layout picker, scaled down
  // ═══════════════════════════════════════════════════════
  const LAYOUT_SVGS = {
    'single':        `<svg width="48" height="30" viewBox="0 0 80 50"><rect x="2" y="2" width="76" height="46" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/></svg>`,
    'two-col':       `<svg width="48" height="30" viewBox="0 0 80 50"><rect x="2" y="2" width="36" height="46" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="42" y="2" width="36" height="46" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/></svg>`,
    'two-row':       `<svg width="48" height="30" viewBox="0 0 80 50"><rect x="2" y="2" width="76" height="21" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="2" y="27" width="76" height="21" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/></svg>`,
    'primary-right': `<svg width="48" height="30" viewBox="0 0 80 50"><rect x="2" y="2" width="46" height="46" rx="2" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><rect x="52" y="2" width="26" height="21" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="52" y="27" width="26" height="21" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/></svg>`,
    'primary-left':  `<svg width="48" height="30" viewBox="0 0 80 50"><rect x="2" y="2" width="26" height="21" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="2" y="27" width="26" height="21" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="32" y="2" width="46" height="46" rx="2" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/></svg>`,
    'primary-bottom':`<svg width="48" height="30" viewBox="0 0 80 50"><rect x="2" y="2" width="76" height="28" rx="2" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><rect x="2" y="34" width="36" height="14" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="42" y="34" width="36" height="14" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/></svg>`,
    'primary-top':   `<svg width="48" height="30" viewBox="0 0 80 50"><rect x="2" y="2" width="36" height="14" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="42" y="2" width="36" height="14" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="2" y="20" width="76" height="28" rx="2" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/></svg>`,
    'quad':          `<svg width="48" height="30" viewBox="0 0 80 50"><rect x="2" y="2" width="36" height="21" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="42" y="2" width="36" height="21" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="2" y="27" width="36" height="21" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="42" y="27" width="36" height="21" rx="2" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/></svg>`,
    'six':           `<svg width="48" height="30" viewBox="0 0 80 50"><rect x="2" y="2" width="22" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="29" y="2" width="22" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="56" y="2" width="22" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="2" y="27" width="22" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="29" y="27" width="22" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="56" y="27" width="22" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/></svg>`,
    'eight':         `<svg width="48" height="30" viewBox="0 0 80 50"><rect x="2" y="2" width="16" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="22" y="2" width="16" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="42" y="2" width="16" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="62" y="2" width="16" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="2" y="27" width="16" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="22" y="27" width="16" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="42" y="27" width="16" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><rect x="62" y="27" width="16" height="21" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/></svg>`,
  };

  function openViewsModal() {
    const tbody = document.getElementById('views-tbody');
    const cycleEl = document.getElementById('cycle-status');
    cycleEl.textContent = VIEWS_CYCLE ? 'on' : 'off';

    tbody.innerHTML = VIEWS.map(v => {
      const isActive = v.name === activeView;
      const duration = v.duration < 0 ? 'forever' : v.duration ? `${v.duration}s` : '—';
      const layoutSvg = LAYOUT_SVGS[v.layout] || v.layout || '—';
      return `<tr class="${isActive ? 'active-view' : ''}"
                  style="cursor:pointer"
                  title="Click to activate view: ${v.label || v.name}"
                  onclick="closeAllModals(); activateView('${v.name}')">
        <td>${isActive ? '▶' : ''}</td>
        <td title="${v.name}">${v.name}</td>
        <td title="${v.label || ''}">${v.label || '—'}</td>
        <td title="${v.layout || '—'}" style="padding:6px 16px">${layoutSvg}</td>
        <td title="${(v.streams || []).join(', ')}">${(v.streams || []).join(', ')}</td>
        <td>${duration}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" style="opacity:0.4;padding:16px">No views configured</td></tr>';

    document.getElementById('views-modal').classList.add('open');
  }

  function openStreamsModal() {
    const tbody = document.getElementById('streams-tbody');
    tbody.innerHTML = STREAMS.map((s, i) => {
      const video   = document.getElementById(`v${i}`);
      const hasErr  = document.getElementById(`err${i}`)?.classList.contains('show');
      const isLive  = video && !video.paused && video.readyState >= 2;
      const status  = !video ? 'idle' : hasErr ? 'err' : isLive ? 'live' : 'idle';
      const refresh = STREAM_REFRESH_GLOBAL === 0
        ? 'disabled'
        : s.refreshInterval || STREAM_REFRESH_GLOBAL || '—';
      const source  = s.source ? s.source.replace(/:[^@]*@/, ':***@') : '—';

      // Native title tooltip — rendered by browser/OS, no custom styling
      const tip = (text) => `title="${String(text ?? '—').replace(/"/g, '&quot;')}"`;

      const pcState    = streamPCs[i] ? streamPCs[i].iceConnectionState : 'no connection';
      const statusTip  = `Status: ${status.toUpperCase()}
ICE: ${pcState}
Retry delay: ${retryDelay[i] || 0}ms`;
      const refreshVal = typeof refresh === 'number' ? `${refresh}s` : refresh;
      const refreshTip = STREAM_REFRESH_GLOBAL === 0
        ? 'Globally disabled — per-stream config ignored'
        : s.refreshInterval
          ? `Per-stream: ${s.refreshInterval}s`
          : STREAM_REFRESH_GLOBAL
            ? `Global: ${STREAM_REFRESH_GLOBAL}s`
            : 'Disabled';
      const sourceFull = s.source || '—';

      return `<tr>
        <td><span class="stream-status ${status}"></span>${status.toUpperCase()}</td>
        <td>${s.path || '—'}</td>
        <td ${tip(s.label)}>${s.label || '—'}</td>
        <td>${s.aspectRatio || '—'}</td>
        <td>${s.objectFit || '—'}</td>
        <td>${s.audio ? 'yes' : 'no'}</td>
        <td>${refreshVal}</td>
        <td title="${sourceFull.replace(/"/g, '&quot;')}" style="font-size:10px;opacity:0.6;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${source}</td>
      </tr>`;
    }).join('');
    document.getElementById('streams-modal').classList.add('open');
  }

  document.addEventListener('keydown', e => {
    const modalsEnabled = ENABLE_MODALS &&
      !(FORCE_LAYOUT && FORCE_LAYOUT !== '$FORCE_LAYOUT' && LAYOUTS[FORCE_LAYOUT]);

    const anyOpen = ['picker','streams-modal','views-modal','settings-modal','performance-modal']
      .some(id => document.getElementById(id)?.classList.contains('open'));

    // ── Escape — close modal or open settings ──
    if (e.key === 'Escape') {
      if (anyOpen) { closeAllModals(); return; }
      if (modalsEnabled) { openSettingsModal(); return; }
    }

    // ── Navigation + pause — always active, work even with modals open ──
    if (e.key === 'ArrowRight' && VIEWS.length > 1 && !anyOpen) {
      navigateView(1); return;
    }
    if (e.key === 'ArrowLeft' && VIEWS.length > 1 && !anyOpen) {
      navigateView(-1); return;
    }
    if ((e.key === 'p' || e.key === 'P') && !anyOpen) {
      if (VIEWS_CYCLE) { cyclePaused ? resumeCycle() : pauseCycle(); }
      return;
    }

    if (!modalsEnabled) return;

    // ── Modal shortcuts — same key toggles; different key switches ──
    const pickerOpen      = document.getElementById('picker')?.classList.contains('open');
    const viewsOpen       = document.getElementById('views-modal')?.classList.contains('open');
    const streamsOpen     = document.getElementById('streams-modal')?.classList.contains('open');
    const perfOpen        = document.getElementById('performance-modal')?.classList.contains('open');

    if (e.key === 'l' || e.key === 'L') {
      if (pickerOpen) { closeAllModals(); return; }
      returnToSettings = false;
      closeAllModals();
      stopAll();
      document.getElementById('picker').classList.add('open');
      return;
    }

    if (e.key === 'v' || e.key === 'V') {
      if (viewsOpen) { closeAllModals(); return; }
      returnToSettings = false;
      closeAllModals();
      openViewsModal();
      return;
    }

    if (e.key === 'd' || e.key === 'D') {
      if (streamsOpen) { closeAllModals(); return; }
      returnToSettings = false;
      closeAllModals();
      openStreamsModal();
      return;
    }

    if (e.key === 'f' || e.key === 'F') {
      if (perfOpen) { closeAllModals(); return; }
      returnToSettings = false;
      closeAllModals();
      document.getElementById('performance-modal').classList.add('open');
      return;
    }
  });

  // Cursor hide
  let cursorTimer;
  let settingsBtnTimer;

  function showSettingsBtn() {
    if (!ENABLE_MODALS) return;
    const btn = document.getElementById('settings-btn');
    if (btn) {
      btn.classList.add('visible');
      clearTimeout(settingsBtnTimer);
      settingsBtnTimer = setTimeout(() => btn.classList.remove('visible'), 3000);
    }
  }

  document.addEventListener('mousemove', () => {
    document.body.style.cursor = 'default';
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => { document.body.style.cursor = 'none'; }, 3000);
    showSettingsBtn();
  });

  document.addEventListener('click',      markInteracted, { once: false });
  document.addEventListener('keydown',    markInteracted, { once: false });
  document.addEventListener('touchstart', () => { markInteracted(); showSettingsBtn(); });



  // ═══════════════════════════════════════════════════════
  // Boot — load streams.json then initialise
  // ═══════════════════════════════════════════════════════
  async function boot() {
    await loadStreams();
    await loadViews();
    loadPerfSettings();
    loadMuteState();

    // Wire up fullscreen timeout input in picker
  const fsInput = document.getElementById('fs-timeout-input');
  fsInput.value = FULLSCREEN_TIMEOUT || '';
  fsInput.addEventListener('change', () => {
    const val = parseInt(fsInput.value, 10);
    FULLSCREEN_TIMEOUT = isNaN(val) ? 0 : val;
    try { localStorage.setItem('fsTimeout', FULLSCREEN_TIMEOUT); } catch(e) {}
  });
  // Restore saved value (overrides env default if user has changed it)
  try {
    const saved = localStorage.getItem('fsTimeout');
    if (saved !== null) {
      FULLSCREEN_TIMEOUT = Number(saved);
      fsInput.value = FULLSCREEN_TIMEOUT || '';
    }
  } catch(e) {}

  if (FORCE_LAYOUT && FORCE_LAYOUT !== '$FORCE_LAYOUT' && LAYOUTS[FORCE_LAYOUT]) {
    // Env var is set — lock to this layout, disable modals and shortcuts
    applyLayout(FORCE_LAYOUT);
    document.getElementById('picker').classList.remove('open');
    document.getElementById('picker').style.pointerEvents = 'none';
  } else if (VIEWS.length > 0) {
    if (VIEWS_CYCLE) {
      // Cycling enabled — start from first view
      startCycling();
    } else {
      // Cycling disabled — restore last viewed, then default, then first
      let resolved = false;
      try {
        const savedView = localStorage.getItem('lastView');
        if (savedView && getView(savedView)) {
          activateView(savedView);
          resolved = true;
        }
      } catch(e) {}
      if (!resolved && VIEWS_DEFAULT && getView(VIEWS_DEFAULT)) {
        activateView(VIEWS_DEFAULT);
        resolved = true;
      }
      if (!resolved) activateView(VIEWS[0].name);
    }
  } else {
    // No views — try saved layout, then auto-select best, then show picker
    let resolved = false;
    try {
      const saved = localStorage.getItem('layout');
      if (saved && LAYOUTS[saved]) { applyLayout(saved); resolved = true; }
    } catch(e) {}

    if (!resolved && STREAMS.length > 0) {
      applyLayout(bestLayout(STREAMS.length));
      resolved = true;
    }

    if (!resolved) {
      document.getElementById('picker').classList.add('open');
    }
  }
  } // end boot()

  // ═══════════════════════════════════════════════════════
  // MQTT CLIENT
  // ═══════════════════════════════════════════════════════
  function startMQTT() {
    if (typeof mqtt === 'undefined') {
      console.warn('MQTT: mqtt.js not loaded');
      return;
    }

    // Merge streams.json mqtt block over defaults
    const cfg = Object.assign({}, MQTT_DEFAULTS, MQTT_CONFIG || {});
    if (!cfg.enabled) { console.log('MQTT: disabled'); return; }

    MQTT_ENABLED      = true;
    MQTT_HOST         = cfg.host;
    MQTT_PORT         = cfg.port;
    MQTT_TLS          = cfg.tls;
    MQTT_USERNAME     = cfg.username;
    MQTT_PASSWORD     = cfg.password;
    MQTT_TOPIC_ALL    = cfg.topicBase;
    MQTT_TOPIC_STREAM = cfg.topicBase + '/+';

    const protocol = MQTT_TLS ? 'wss' : 'ws';
    const url      = `${protocol}://${MQTT_HOST}:${MQTT_PORT}/mqtt`;
    const opts     = {
      clientId:        'rtsp-kiosk-' + Math.random().toString(16).slice(2, 8),
      clean:           true,
      reconnectPeriod: 5000,
    };
    if (MQTT_USERNAME) opts.username = MQTT_USERNAME;
    if (MQTT_PASSWORD) opts.password = MQTT_PASSWORD;

    console.log(`MQTT: connecting to ${url}`);
    const client = mqtt.connect(url, opts);

    client.on('connect', () => {
      console.log('MQTT: connected');
      client.subscribe(MQTT_TOPIC_STREAM,           { qos: 1 });
      client.subscribe(cfg.topicBase + '/view',     { qos: 1 });
    });

    client.on('error',     err => console.error('MQTT error:', err));
    client.on('reconnect', ()  => console.log('MQTT: reconnecting...'));

    client.on('message', (topic, payload) => {
      let data;
      try { data = JSON.parse(payload.toString()); }
      catch(e) { console.error('MQTT: invalid JSON on', topic, e); return; }

      // View control — topic: <topicBase>/view
      const viewTopic = cfg.topicBase + '/view';
      if (topic === viewTopic) {
        // payload: { "name": "front", "duration": 30 }
        // duration -1 = stay forever, 0 = remove from current view
        const viewName = data.name;
        if (!viewName) return;

        if (data.duration === 0) {
          // Remove this view override — return to default
          console.log(`MQTT: removing view override, returning to default`);
          clearCycle();
          if (VIEWS_DEFAULT) activateView(VIEWS_DEFAULT);
          return;
        }

        // Find or create a temporary view from the payload
        const existing = getView(viewName);
        if (existing) {
          const override = Object.assign({}, existing,
            data.duration !== undefined ? { duration: data.duration } : {}
          );
          // Temporarily inject override
          const idx = VIEWS.findIndex(v => v.name === viewName);
          VIEWS[idx] = override;
          activateView(viewName);
          VIEWS[idx] = existing; // restore original after activation
        } else {
          console.warn(`MQTT: view not found: ${viewName}`);
        }
        return;
      }

      // Per-stream update — topic suffix is the stream path
      const streamPath = topic.split('/').pop();
      if (!streamPath) return;

      data.path = data.path || streamPath;
      console.log(`MQTT: update for stream ${data.path}`);
      applyStreamUpdates([data]);
    });
  }

  // Apply stream config updates from MQTT.
  // Fields explicitly set in streams.json are locked and cannot be overridden.
  function applyStreamUpdates(updates) {
    let layoutChanged = false;

    updates.forEach(update => {
      const idx      = STREAMS.findIndex(s => s.path === update.path);
      const locked   = STREAMS_STATIC[update.path] || [];

      // Remove any fields from the MQTT payload that are locked in streams.json
      const filtered = Object.assign({}, update);
      locked.forEach(key => {
        if (key in filtered && key !== 'path') {
          console.log(`MQTT: ignoring locked field '${key}' for ${update.path}`);
          delete filtered[key];
        }
      });

      if (idx === -1) {
        // New stream not in streams.json — add it entirely from MQTT
        STREAMS.push(filtered);
        layoutChanged = true;
        console.log(`MQTT: added new stream ${update.path}`);
      } else {
        // Merge filtered MQTT fields into existing stream config
        const existing = STREAMS[idx];
        const merged   = Object.assign({}, existing, filtered);
        const hasChange = JSON.stringify(existing) !== JSON.stringify(merged);

        if (hasChange) {
          STREAMS[idx] = merged;
          console.log(`MQTT: updated stream ${update.path} — reconnecting`);
          // Tear down existing WebRTC connection and restart
          if (streamPCs[idx]) {
            try { streamPCs[idx].close(); } catch(e) {}
            delete streamPCs[idx];
          }
          resetRetry(idx);
          if (document.getElementById(`v${idx}`)) startWhep(idx);
        }
      }
    });

    // Reapply layout if new streams were added
    if (layoutChanged) {
      const currentLayout = document.getElementById('wall').dataset.layout;
      if (currentLayout) applyLayout(currentLayout);
    }
  }

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

  // Close modal when clicking/tapping outside (on the backdrop)
  ['picker', 'streams-modal', 'views-modal', 'settings-modal', 'performance-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', e => {
      if (e.target === el) closeAllModals();
    });
  });

  startMQTT();
  boot();