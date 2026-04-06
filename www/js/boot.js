// ═══════════════════════════════════════════════════════
// Boot — load streams.json then initialise
// ═══════════════════════════════════════════════════════
async function boot() {
  await loadStreams();
  await loadViews();
  if (typeof loadActionsConfig === 'function') await loadActionsConfig();
  loadPerfSettings();
  loadMuteState();

  // Wire up fullscreen timeout input in settings modal
  const fsInput = document.getElementById('fs-timeout-input');
  if (fsInput) {
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
  }

  if (FORCE_LAYOUT && FORCE_LAYOUT !== '$FORCE_LAYOUT' && LAYOUTS[FORCE_LAYOUT]) {
    // Env var is set — lock to this layout, disable modals and shortcuts
    applyLayout(FORCE_LAYOUT);
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
    // No views — try saved layout, then auto-select best
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
      // No views and no streams — open settings so the user can configure
      if (typeof openSettingsModal === 'function') openSettingsModal();
    }
  }
} // end boot()

// Interaction tracking — must register after debug.js defines markInteracted
document.addEventListener('click',      markInteracted, { once: false });
document.addEventListener('keydown',    markInteracted, { once: false });
document.addEventListener('touchstart', () => { markInteracted(); showSettingsBtn(); });

// Close modal when clicking/tapping outside (on the backdrop)
['settings-modal'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', e => {
    if (e.target === el) closeAllModals();
  });
});

startMQTT();
boot();
