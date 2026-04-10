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

function closeAllModals() {
  document.getElementById('settings-modal').classList.remove('open');
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

  const defaultSel = document.getElementById('views-default-sel');
  if (defaultSel) {
    defaultSel.innerHTML = VIEWS.map(v =>
      `<option value="${v.name}"${v.name === VIEWS_DEFAULT ? ' selected' : ''}>${v.name}</option>`
    ).join('');
  }

  const cycleEl = document.getElementById('cycle-status');
  if (cycleEl) cycleEl.textContent = VIEWS_CYCLE ? 'on' : 'off';

  _updateDefaultVisibility();

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
             <button class="sp-btn" style="color:rgba(248,113,113,0.9);width:auto;padding:0 12px;font-size:12px" onclick="confirmDeleteView('${v.name}')">Yes</button>
             <button class="sp-btn" style="width:auto;padding:0 12px;font-size:12px" onclick="cancelDeleteView()">No</button>
           </div>
         </td>`
      : `<td style="white-space:nowrap;padding:4px 8px">
           <button class="sp-btn" title="Activate" onclick="closeAllModals();activateView('${v.name}')">▶</button>
           <button class="sp-btn" title="Clone" onclick="cloneView('${v.name}')">⎘</button>
           <button class="sp-btn" title="Edit" onclick="openViewEditor('${v.name}')">✎</button>
           <button class="sp-btn" title="Delete" style="color:rgba(248,113,113,0.9)" onclick="promptDeleteView('${v.name}')">✕</button>
         </td>`;
    return `<tr class="${isActive ? 'active-view' : ''}${confirming ? ' view-row-confirm' : ''}">
      <td class="view-drag-handle">≡</td>
      <td>${isActive ? '▶' : ''}</td>
      <td title="${v.name}">${v.name}</td>
      <td title="${v.layout || '—'}" style="padding:6px 16px">${layoutSvg}</td>
      <td title="${(v.streams || []).map((s,i) => i+':'+s).join(', ')}">${(v.streams || []).map((s,i) => `<span style="color:rgba(255,255,255,0.4)">${i}</span>:${s}`).join('  ')}</td>
      <td>${duration}</td>
      ${actionCell}
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="opacity:0.4;padding:16px">No views configured — click + Add View</td></tr>';

  _initViewDrag();
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
    if (typeof closeActionsModal === 'function' && ACTIONS_MODAL_OPEN) { closeActionsModal(); return; }
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

// Note: markInteracted listeners are registered in boot.js after debug.js loads
