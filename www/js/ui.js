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
//   D — toggle debug overlay
//   Escape — close any open modal
// ═══════════════════════════════════════════════════════
let _activeSettingsTab = 'general';
let _logTabInterval = null;

function closeAllModals() {
  if (_logTabInterval) { clearInterval(_logTabInterval); _logTabInterval = null; }
  document.getElementById('settings-modal').classList.remove('open');
  // Close cam stream test modal if open
  if (typeof closeCamStreamTest === 'function') closeCamStreamTest();
  // Discard any unsaved changes in the cameras and actions editors
  if (typeof discardCamChanges === 'function') discardCamChanges();
  if (typeof discardAeChanges  === 'function') discardAeChanges();
  // Reset clear storage confirmation state
  const confirmEl = document.getElementById('clear-storage-confirm');
  const btnEl = document.getElementById('clear-storage-btn');
  if (confirmEl) confirmEl.style.display = 'none';
  if (btnEl) btnEl.style.display = '';
}

function activateSettingsTab(tab) {
  _activeSettingsTab = tab;
  document.querySelectorAll('.settings-tab-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('stab-' + tab);
  if (panel) panel.style.display = '';
  document.querySelectorAll('.settings-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  if (tab === 'cameras' && typeof renderCamerasTab === 'function') renderCamerasTab();
  if (tab === 'views'   && typeof renderViewsTab   === 'function') renderViewsTab();
  if (tab === 'actions' && typeof renderActionsTab === 'function') {
    renderActionsTab();
  }
  if (tab === 'streams') renderStreamsTab();
  if (_logTabInterval) { clearInterval(_logTabInterval); _logTabInterval = null; }
  if (tab === 'log') {
    renderLogTab();
    _logTabInterval = setInterval(renderLogTab, 2000);
  }
  const footerDescriptions = {
    general:     'Keyboard shortcuts and global preferences.',
    cameras:     'Manage IP cameras and RTSP stream sources.',
    views:       'Define and organize named layouts for the video wall.',
    actions:     'Automate kiosk behavior using MQTT events.',
    performance: 'Tune WebRTC streaming quality and behavior.',
    streams:     'Monitor live stream health and connection status.',
    log:         'Diagnostic event log.',
  };
  setSettingsFooter(footerDescriptions[tab] || '');
}

function setSettingsFooter(text) {
  const el = document.getElementById('settings-tab-footer');
  if (el) el.textContent = text;
}

function openSettingsModal(tab = 'general') {
  closeAllModals();
  document.getElementById('settings-modal').classList.add('open');
  activateSettingsTab(tab);
}

function renderViewsTab() {
  // Toolbar state
  const cycleChk = document.getElementById('views-cycle-chk');
  if (cycleChk) cycleChk.checked = VIEWS_CYCLE;

  // Show table, hide edit panel
  document.getElementById('views-table-wrap').style.display = '';
  document.getElementById('view-edit-panel').style.display = 'none';

  const tbody = document.getElementById('views-tbody');
  tbody.innerHTML = VIEWS.map((v, idx) => {
    const isActive   = v.name === activeView;
    const duration   = v.duration < 0 ? 'forever' : v.duration ? `${v.duration}s` : '—';
    const layoutSvg  = layoutSvgWithNumbers(v.layout, v.streams);
    const confirming = v.name === _confirmDeleteName;
    const actionCell = confirming
      ? `<td style="white-space:nowrap;padding:4px 12px">
           <div class="view-delete-confirm">
             <span>Delete?</span>
             <button class="sp-btn" style="color:rgba(248,113,113,0.9);width:auto;padding:0 16px" onclick="confirmDeleteView('${v.name}')">Yes</button>
             <button class="sp-btn" style="width:auto;padding:0 16px" onclick="cancelDeleteView()">No</button>
           </div>
         </td>`
      : `<td style="white-space:nowrap;padding:4px 8px">
           <button class="sp-btn" title="Activate" style="color:rgba(74,222,128,0.7);border-color:rgba(74,222,128,0.25)" onclick="closeAllModals();activateView('${v.name}')">▶</button>
           <button class="sp-btn" title="Clone" onclick="cloneView('${v.name}')">⎘</button>
           <button class="sp-btn" title="Edit" onclick="openViewEditor('${v.name}')">✎</button>
           <button class="sp-btn" title="Delete" style="color:rgba(248,113,113,0.7);border-color:rgba(248,113,113,0.2)" onclick="promptDeleteView('${v.name}')">✕</button>
         </td>`;
    const onlyCycleView = VIEWS_CYCLE && v.cycle !== false && VIEWS.filter(w => w.cycle !== false).length <= 1;
    const cycleToggle = `<td style="padding:4px 8px">
           <input type="checkbox" ${v.cycle !== false ? 'checked' : ''} ${onlyCycleView ? 'disabled title="At least one view must be included in cycle"' : 'title="Include in cycle"'} onchange="toggleViewCycle('${v.name}')">
         </td>`;
    return `<tr class="${isActive ? 'active-view' : ''}${confirming ? ' view-row-confirm' : ''}">
      <td class="view-drag-handle">≡</td>
      <td>${isActive ? '▶' : ''}</td>
      <td title="${v.name}" style="color:rgba(255,255,255,0.7)">${v.name}</td>
      <td title="${v.layout || '—'}" style="padding:6px 16px">${layoutSvg}</td>
      <td title="${(v.streams || []).map((s,i) => i+':'+s).join(', ')}"><div style="display:flex;flex-direction:column;gap:2px">${(v.streams || []).map((s,i) => `<span><span style="color:rgba(255,255,255,0.4)">${i}</span>:${s}</span>`).join('')}</div></td>
      <td class="views-duration-col">${duration}</td>
      ${cycleToggle}
      ${actionCell}
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="opacity:0.4;padding:16px">No views configured — click + Add View</td></tr>';

  _initViewDrag();

  const tableWrap = document.getElementById('views-table-wrap');
  if (tableWrap) tableWrap.classList.toggle('views-cycle-off', !VIEWS_CYCLE);
}

function openViewsModal() {
  openSettingsModal('views');
}

function renderStreamsTab() {
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

    const pcState    = streamPCs[i] ? streamPCs[i].iceConnectionState : 'no connection';
    const refreshVal = typeof refresh === 'number' ? `${refresh}s` : refresh;
    const sourceFull = s.source || '—';

    return `<tr>
      <td><span class="stream-status ${status}"></span>${status.toUpperCase()}</td>
      <td>${s.path || '—'}</td>
      <td>${s.aspectRatio || '—'}</td>
      <td>${s.objectFit || '—'}</td>
      <td>${s.audio ? 'yes' : 'no'}</td>
      <td>${refreshVal}</td>
      <td title="${sourceFull.replace(/"/g, '&quot;')}" style="font-size:10px;opacity:0.6;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${source}</td>
    </tr>`;
  }).join('');
}

function openStreamsModal() {
  openSettingsModal('streams');
}

document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  const modalsEnabled = ENABLE_MODALS &&
    !(FORCE_LAYOUT && FORCE_LAYOUT !== '$FORCE_LAYOUT' && LAYOUTS[FORCE_LAYOUT]);

  const anyOpen = ['settings-modal'].some(id => document.getElementById(id)?.classList.contains('open'));

  // ── Escape — close modal or open settings ──
  if (e.key === 'Escape') {
    const focusOverlay = document.getElementById('focus-stream-overlay');
    if (focusOverlay && focusOverlay.classList.contains('open')) { if (typeof closeFocusStream === 'function') closeFocusStream(); return; }
    if (typeof closeActionsModal === 'function' && ACTIONS_MODAL_OPEN) { closeActionsModal(); return; }
    if (document.getElementById('cam-test-modal')?.style.display === 'flex') { if (typeof closeCamStreamTest === 'function') closeCamStreamTest(); return; }
    if (anyOpen) { closeAllModals(); return; }
    if (modalsEnabled) { openSettingsModal(); return; }
  }

  // ── Navigation + pause — always active, work even with modals open ──
  if (e.key === 'ArrowRight' && VIEWS.length > 1 && !anyOpen) {
    if (!VIEWS_CYCLE || VIEWS.some(v => v.cycle !== false)) { navigateView(1); return; }
  }
  if (e.key === 'ArrowLeft' && VIEWS.length > 1 && !anyOpen) {
    if (!VIEWS_CYCLE || VIEWS.some(v => v.cycle !== false)) { navigateView(-1); return; }
  }
  if (e.key === ' ' && !anyOpen) {
    // Space = pause/resume cycling
    e.preventDefault();
    if (VIEWS_CYCLE) { cyclePaused ? resumeCycle() : pauseCycle(); }
    return;
  }

  if (!modalsEnabled) return;

  // ── Modal shortcuts — if settings open on that tab already, close; otherwise switch/open ──
  const settingsOpen = document.getElementById('settings-modal')?.classList.contains('open');

  if (e.key === 'a' || e.key === 'A') {
    if (settingsOpen && _activeSettingsTab === 'actions') { closeAllModals(); return; }
    openSettingsModal('actions');
    return;
  }

  if (e.key === 'c' || e.key === 'C') {
    if (settingsOpen && _activeSettingsTab === 'cameras') { closeAllModals(); return; }
    openSettingsModal('cameras');
    return;
  }

  if (e.key === 'v' || e.key === 'V') {
    if (settingsOpen && _activeSettingsTab === 'views') { closeAllModals(); return; }
    openSettingsModal('views');
    return;
  }

  if (e.key === 'd' || e.key === 'D') {
    // D toggles debug overlay directly — no modal
    PERF.debugOverlay = !PERF.debugOverlay;
    try { localStorage.setItem('perfSettings', JSON.stringify(PERF)); } catch(e) {}
    applyPerfSettings();
    return;
  }

  if (e.key === 'p' || e.key === 'P') {
    if (settingsOpen && _activeSettingsTab === 'performance') { closeAllModals(); return; }
    openSettingsModal('performance');
    return;
  }

  if (e.key === 's' || e.key === 'S') {
    if (settingsOpen && _activeSettingsTab === 'streams') { closeAllModals(); return; }
    openSettingsModal('streams');
    return;
  }
});

// ═══════════════════════════════════════════════════════
// Touch swipe — left/right navigates views (same as arrow keys)
// ═══════════════════════════════════════════════════════
let touchStartX = null;
let touchStartY = null;

document.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { touchStartX = null; touchStartY = null; return; }
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', e => {
  if (touchStartX === null || touchStartY === null) return;
  const deltaX = e.changedTouches[0].clientX - touchStartX;
  const deltaY = e.changedTouches[0].clientY - touchStartY;
  touchStartX = null;
  touchStartY = null;

  // Ignore if not primarily horizontal or below threshold
  if (Math.abs(deltaX) < 50 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
  if (VIEWS.length <= 1) return;

  const anyOpen = ['settings-modal'].some(id => document.getElementById(id)?.classList.contains('open'));
  if (anyOpen) return;

  if (VIEWS_CYCLE && !VIEWS.some(v => v.cycle !== false)) return;
  if (deltaX < 0) {
    navigateView(1);   // swipe left → next view
  } else {
    navigateView(-1);  // swipe right → previous view
  }
}, { passive: true });

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

// ─── Log tab ────────────────────────────────────────────
function activateLogSubtab(subtab) {
  document.querySelectorAll('.log-subtab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.subtab === subtab)
  );
  document.querySelectorAll('.log-subtab-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('log-subtab-' + subtab);
  if (panel) panel.style.display = 'flex';
}

function renderLogTab() {
  const entries = window.mqttGetLog ? window.mqttGetLog() : [];
  const container = document.getElementById('mqtt-log-entries');
  if (!container) return;
  if (!entries.length) {
    container.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:11px;padding:8px 0">No events yet.</div>';
    return;
  }
  container.innerHTML = entries.map(e => {
    const ts = e.ts instanceof Date ? e.ts : new Date(e.ts);
    const hh = String(ts.getHours()).padStart(2,'0');
    const mm = String(ts.getMinutes()).padStart(2,'0');
    const ss = String(ts.getSeconds()).padStart(2,'0');
    const ms = String(ts.getMilliseconds()).padStart(3,'0');
    const tsStr = `${hh}:${mm}:${ss}.${ms}`;
    const dir = e.dir || '';
    const broker = e.brokerId ? `[${e.brokerId}]` : '';
    const rawPayload = e.payload != null ? String(e.payload) : '';
    const truncated = rawPayload.length > 120 ? rawPayload.slice(0, 120) + '…' : rawPayload;
    const payloadHtml = rawPayload
      ? `<span class="mqtt-log-payload" onclick="this.classList.toggle('expanded');this.textContent=this.classList.contains('expanded')?${JSON.stringify(rawPayload)}:${JSON.stringify(truncated)}">${_escHtml(truncated)}</span>`
      : '';
    return `<div class="mqtt-log-entry">
      <span class="mqtt-log-ts">${tsStr}</span>
      <span class="mqtt-log-badge mqtt-log-badge-${_escHtml(dir)}">${_escHtml(dir)}</span>
      <span class="mqtt-log-broker">${_escHtml(broker)}</span>
      ${e.topic ? `<span class="mqtt-log-topic">${_escHtml(e.topic)}</span>` : ''}
      ${payloadHtml}
    </div>`;
  }).join('');
}

function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function clearMqttLog() {
  if (window.mqttGetLog) { const log = window.mqttGetLog(); log.splice(0, log.length); }
  renderLogTab();
}

// Note: markInteracted listeners are registered in boot.js after debug.js loads
