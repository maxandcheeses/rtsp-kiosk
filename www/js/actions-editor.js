// ── Actions settings editor ─────────────────────────────────────────────────

let AE_FULL        = null;  // { mqtt, actions, groups } — loaded from API
let AE_LOCAL       = null;  // working copy — mutated by editor
let AE_UNSAVED     = false;
let AE_TAB         = 'mqtt';   // 'mqtt' | 'actions' | 'groups'
let AE_OPEN_DRAWER = null;     // action id or group id currently open
let AE_DRAWER_DIRTY = false;   // true if any form field has been modified since drawer opened

function _aeDeepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function _aeEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Open / load ─────────────────────────────────────────────────────────────

function renderActionsTab() {
  loadActionsEditorData();
}

function openActionsSettingsModal() {
  openSettingsModal('actions');
}

async function loadActionsEditorData() {
  const content = document.getElementById('ae-content');
  if (!content) return;
  content.innerHTML = '<div style="font-family:\'Courier New\',monospace;font-size:10px;color:rgba(255,255,255,0.3);padding:40px 0;text-align:center">Loading...</div>';

  try {
    const res = await fetch('/api/actions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    AE_FULL    = data;
    AE_LOCAL   = _aeDeepClone(data);
    // Ensure servers array exists
    if (!AE_LOCAL.mqtt) AE_LOCAL.mqtt = { servers: [] };
    if (!Array.isArray(AE_LOCAL.mqtt.servers)) AE_LOCAL.mqtt.servers = [];
    AE_UNSAVED = false;
    AE_OPEN_DRAWER = null;
  } catch(e) {
    // API unavailable or file missing — start with empty structure
    console.warn('Actions editor: failed to load /api/actions', e);
    const empty = { mqtt: { servers: [] }, actions: [], groups: [] };
    AE_FULL    = null;  // null = not yet saved; track as unavailable for error display
    AE_LOCAL   = _aeDeepClone(empty);
    AE_UNSAVED = false;
    AE_OPEN_DRAWER = null;
    const content2 = document.getElementById('ae-content');
    if (content2) {
      content2.innerHTML = `
        <div class="cam-api-notice" style="margin-bottom:20px">
          <div style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:rgba(248,113,113,0.8);margin-bottom:10px">Actions API Not Available</div>
          The streams-api service is not reachable or actions.json does not exist.<br>
          You can configure actions below and Apply — this will create the file.
        </div>
        <div id="ae-tabs-and-content"></div>`;
      _renderAeTabsInto(document.getElementById('ae-tabs-and-content'));
    }
    return;
  }

  renderActionsEditor();
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderActionsEditor() {
  const content = document.getElementById('ae-content');
  if (!content) return;
  content.innerHTML = '<div id="ae-tabs-and-content"></div>';
  _renderAeTabsInto(document.getElementById('ae-tabs-and-content'));
}

function _renderAeTabsInto(container) {
  if (!container) return;

  const tabs = [
    { id: 'mqtt',    label: 'MQTT' },
    { id: 'actions', label: 'Actions' },
    { id: 'groups',  label: 'Groups' },
  ];
  const tabNav = tabs.map(t =>
    `<button class="ae-tab-btn${AE_TAB === t.id ? ' active' : ''}" onclick="switchAeTab('${t.id}')">${t.label}</button>`
  ).join('');

  let tabContent = '';
  if (AE_TAB === 'mqtt')    tabContent = _buildAeMqttTab();
  if (AE_TAB === 'actions') tabContent = _buildAeActionsTab();
  if (AE_TAB === 'groups')  tabContent = _buildAeGroupsTab();

  const bannerHtml = AE_UNSAVED ? _buildAeBanner() : '';

  container.innerHTML = `
    <div class="ae-tab-nav" style="width:100%;max-width:900px">${tabNav}</div>
    <div id="ae-tab-content" style="width:100%;max-width:900px">${tabContent}</div>
    ${bannerHtml}`;

  if (AE_TAB === 'mqtt')    _initAeSrvDrag();
  if (AE_TAB === 'actions') _initAeActionDrag();
  if (AE_TAB === 'groups')  _initAeGroupDrag();
}

function switchAeTab(tab) {
  AE_TAB         = tab;
  AE_OPEN_DRAWER = null;
  AE_DRAWER_DIRTY = false;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
}

// ── MQTT Tab ─────────────────────────────────────────────────────────────────

function _buildAeMqttTab() {
  const servers = (AE_LOCAL && AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers) || [];

  const addBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:12px">
    <button class="cam-add-btn" onclick="addAeSrv()">+ Add Server</button>
  </div>`;

  if (servers.length === 0) {
    return addBtn + `<div style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.3);padding:32px 0;text-align:center">
      NO SERVERS CONFIGURED<br><span style="margin-top:6px;display:block">Use + Add Server above</span>
    </div>`;
  }

  let rows = '';
  servers.forEach(srv => {
    const id  = srv.id || '';
    const esc = _aeEsc(id);
    const isOpen = AE_OPEN_DRAWER === id;

    rows += `<tr id="ae-srv-row-${esc}" style="cursor:pointer" onclick="(function(e){if(!e.target.closest('button'))openAeSrvDrawer('${esc}')})(event)">
      <td class="cam-drag-handle" style="width:32px">≡</td>
      <td style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.5)">${_aeEsc(id)}</td>
      <td style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.4)">${_aeEsc(srv.broker || '')}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="sp-btn" onclick="openAeSrvDrawer('${esc}')" title="Edit">✎</button>
        <button class="sp-btn" onclick="deleteAeSrv('${esc}')" title="Delete" style="color:rgba(248,113,113,0.6);border-color:rgba(248,113,113,0.2)">✕</button>
      </td>
    </tr>
    <tr id="ae-srv-drawer-row-${esc}">
      <td colspan="4" style="padding:0;border:none">
        <div class="cam-drawer" id="ae-srv-drawer-${esc}" style="${isOpen ? 'max-height:9999px' : ''}">
          <div class="cam-drawer-inner" id="ae-srv-drawer-inner-${esc}">${isOpen ? _buildAeSrvDrawerForm(srv, false) : ''}</div>
        </div>
      </td>
    </tr>`;
  });

  return addBtn + `<table class="streams-table" style="width:100%">
    <thead><tr>
      <th></th><th>ID</th><th>Broker</th><th></th>
    </tr></thead>
    <tbody id="ae-srv-tbody">${rows}</tbody>
  </table>`;
}

function _buildAeSrvDrawerForm(srv, isNew) {
  const id       = srv.id || '';
  const broker   = srv.broker || '';
  const username = srv.username || '';
  const password = srv.password || '';

  return `<div class="cam-form-grid">
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">ID (slug)</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-srv-id" value="${_aeEsc(id)}" placeholder="home">
        <div style="font-size:9px;color:rgba(255,255,255,0.25);font-family:'Courier New',monospace">Lowercase letters, numbers, hyphens</div>
        <div class="cam-field-error" id="ae-err-srv-id"></div>
      </div>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Broker URL</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-srv-broker" value="${_aeEsc(broker)}" placeholder="ws://localhost:9001">
        <div class="cam-field-error" id="ae-err-srv-broker"></div>
      </div>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Username</label>
      <input class="views-input" id="ae-field-srv-username" value="${_aeEsc(username)}" placeholder="optional">
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Password</label>
      <input class="views-input" type="password" id="ae-field-srv-password" value="${_aeEsc(password)}" placeholder="optional">
    </div>
  </div>
  <div class="cam-drawer-footer">
    <button class="perf-reset" onclick="closeAeDrawer()">Cancel</button>
    <button class="cam-save-btn" onclick="saveAeSrvDrawer('${_aeEsc(id)}', ${isNew})">Save</button>
  </div>`;
}

function openAeSrvDrawer(id) {
  if (AE_OPEN_DRAWER === id) {
    if (!AE_DRAWER_DIRTY) closeAeDrawer();
    return;
  }
  if (AE_OPEN_DRAWER) closeAeDrawer();
  const srv = (AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers || []).find(s => s.id === id);
  if (!srv) return;
  const inner = document.getElementById(`ae-srv-drawer-inner-${id}`);
  if (!inner) return;
  const isNew = !AE_FULL || !(AE_FULL.mqtt && AE_FULL.mqtt.servers || []).find(s => s.id === id);
  inner.innerHTML = _buildAeSrvDrawerForm(srv, isNew);
  const drawer = document.getElementById(`ae-srv-drawer-${id}`);
  if (drawer) drawer.style.maxHeight = '9999px';
  AE_OPEN_DRAWER = id;
  AE_DRAWER_DIRTY = false;
  inner.addEventListener('input',  () => { AE_DRAWER_DIRTY = true; });
  inner.addEventListener('change', () => { AE_DRAWER_DIRTY = true; });
  const row = document.getElementById(`ae-srv-row-${id}`);
  if (row) row.classList.add('cam-row-active');
}

function saveAeSrvDrawer(originalId, isNew) {
  const idEl     = document.getElementById('ae-field-srv-id');
  const brokerEl = document.getElementById('ae-field-srv-broker');

  const newId      = idEl     ? idEl.value.trim()     : originalId;
  const newBroker  = brokerEl ? brokerEl.value.trim() : '';
  const username   = (document.getElementById('ae-field-srv-username') || {}).value || '';
  const password   = (document.getElementById('ae-field-srv-password') || {}).value || '';

  let valid = true;

  const errId = document.getElementById('ae-err-srv-id');
  if (!/^[a-z0-9-]+$/.test(newId)) {
    if (errId) errId.textContent = 'Lowercase letters, numbers, and hyphens only';
    valid = false;
  } else if (newId !== originalId && (AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers || []).find(s => s.id === newId)) {
    if (errId) errId.textContent = 'ID already exists';
    valid = false;
  } else {
    if (errId) errId.textContent = '';
  }

  const errBroker = document.getElementById('ae-err-srv-broker');
  if (!newBroker) {
    if (errBroker) errBroker.textContent = 'Broker URL is required';
    valid = false;
  } else {
    if (errBroker) errBroker.textContent = '';
  }

  if (!valid) return;

  // Cascade-update action.mqttServer references if id changed
  if (newId !== originalId) {
    (AE_LOCAL.actions || []).forEach(a => {
      if (a.mqttServer === originalId) a.mqttServer = newId;
    });
  }

  const updated = {
    id: newId,
    broker: newBroker,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };

  if (!AE_LOCAL.mqtt) AE_LOCAL.mqtt = { servers: [] };
  if (!Array.isArray(AE_LOCAL.mqtt.servers)) AE_LOCAL.mqtt.servers = [];

  const idx = AE_LOCAL.mqtt.servers.findIndex(s => s.id === originalId);
  if (idx >= 0) {
    AE_LOCAL.mqtt.servers[idx] = updated;
  } else {
    AE_LOCAL.mqtt.servers.push(updated);
  }

  AE_DRAWER_DIRTY = false;
  AE_OPEN_DRAWER = null;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  applyAeChanges();
}

function deleteAeSrv(id) {
  const srv = (AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers || []).find(s => s.id === id);
  if (!srv) return;
  const row = document.getElementById(`ae-srv-row-${id}`);
  if (!row) return;
  row.classList.add('cam-row-confirm');
  row.onclick = null;
  row.innerHTML = `<td colspan="3" style="padding:10px 16px">
    <span style="font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.7)">Delete server "<strong>${_aeEsc(id)}</strong>"?</span>
  </td>
  <td style="text-align:right;white-space:nowrap;padding:10px 16px">
    <button class="perf-reset" onclick="(function(){const c=document.getElementById('ae-tabs-and-content');if(c)_renderAeTabsInto(c);})()">Cancel</button>
    <button class="cam-save-btn" style="background:rgba(248,113,113,0.15);border-color:rgba(248,113,113,0.5);color:#f87171" onclick="confirmDeleteAeSrv('${_aeEsc(id)}')">Delete</button>
  </td>`;
}

function confirmDeleteAeSrv(id) {
  if (AE_LOCAL.mqtt && Array.isArray(AE_LOCAL.mqtt.servers)) {
    AE_LOCAL.mqtt.servers = AE_LOCAL.mqtt.servers.filter(s => s.id !== id);
  }
  if (AE_OPEN_DRAWER === id) AE_OPEN_DRAWER = null;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  applyAeChanges();
}

function addAeSrv() {
  if (!AE_LOCAL.mqtt) AE_LOCAL.mqtt = { servers: [] };
  if (!Array.isArray(AE_LOCAL.mqtt.servers)) AE_LOCAL.mqtt.servers = [];
  let n = 1;
  while (AE_LOCAL.mqtt.servers.find(s => s.id === `server-${n}`)) n++;
  const newSrv = { id: `server-${n}`, broker: '', username: '', password: '' };
  AE_LOCAL.mqtt.servers.push(newSrv);
  AE_OPEN_DRAWER = newSrv.id;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
}

// ── Drag-to-reorder: Servers ─────────────────────────────────────────────────

let _aeSrvDrag = null;

function _initAeSrvDrag() {
  document.querySelectorAll('#ae-srv-tbody .cam-drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', _onAeSrvDragDown, { passive: false });
  });
}

function _onAeSrvDragDown(e) {
  e.preventDefault();
  const handle = e.currentTarget;
  const row    = handle.closest('tr');
  const tbody  = document.getElementById('ae-srv-tbody');
  if (!tbody) return;
  const rows   = [...tbody.querySelectorAll('tr[id^="ae-srv-row-"]')];
  const idx    = rows.indexOf(row);
  if (idx < 0) return;
  const rect = row.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.id = 'ae-drag-ghost';
  ghost.style.cssText = `position:fixed;z-index:2000;pointer-events:none;background:rgba(15,15,15,0.97);border:1px solid rgba(74,222,128,0.5);border-radius:3px;box-shadow:0 6px 24px rgba(0,0,0,0.7);display:flex;align-items:center;padding:0 16px;font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.8);left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  ghost.textContent = (AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers || [])[idx]?.id || '';
  document.body.appendChild(ghost);
  row.classList.add('cam-row-dragging');
  handle.setPointerCapture(e.pointerId);
  _aeSrvDrag = { idx, dropIdx: idx, ghost, rows, offsetY: e.clientY - rect.top };
  handle.addEventListener('pointermove', _onAeSrvDragMove);
  handle.addEventListener('pointerup',   _onAeSrvDragEnd);
  handle.addEventListener('pointercancel', _onAeSrvDragEnd);
}

function _onAeSrvDragMove(e) {
  if (!_aeSrvDrag) return;
  const { ghost, rows, offsetY } = _aeSrvDrag;
  ghost.style.top = (e.clientY - offsetY) + 'px';
  let dropIdx = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { dropIdx = i; break; }
  }
  _aeSrvDrag.dropIdx = dropIdx;
  rows.forEach(r => r.classList.remove('cam-drop-before', 'cam-drop-after'));
  if (dropIdx < rows.length) rows[dropIdx].classList.add('cam-drop-before');
  else rows[rows.length - 1].classList.add('cam-drop-after');
}

function _onAeSrvDragEnd(e) {
  if (!_aeSrvDrag) return;
  const { idx, dropIdx, ghost, rows } = _aeSrvDrag;
  const handle = e.currentTarget;
  handle.removeEventListener('pointermove', _onAeSrvDragMove);
  handle.removeEventListener('pointerup',   _onAeSrvDragEnd);
  handle.removeEventListener('pointercancel', _onAeSrvDragEnd);
  ghost.remove();
  rows.forEach(r => r.classList.remove('cam-row-dragging', 'cam-drop-before', 'cam-drop-after'));
  _aeSrvDrag = null;
  const newIdx = dropIdx <= idx ? dropIdx : dropIdx - 1;
  if (newIdx === idx) return;
  if (!AE_LOCAL.mqtt || !Array.isArray(AE_LOCAL.mqtt.servers)) return;
  const [moved] = AE_LOCAL.mqtt.servers.splice(idx, 1);
  AE_LOCAL.mqtt.servers.splice(newIdx, 0, moved);
  markAeUnsaved();
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
}

// ── Actions Tab ───────────────────────────────────────────────────────────────

function _buildAeActionsTab() {
  const actions = (AE_LOCAL && AE_LOCAL.actions) || [];

  const builtinRows = Object.values(BUILTIN_ACTIONS).map(action => {
    const iconHtml = action.icon ? _renderIcon(action.icon) : '';
    const badge = `<span style="font-size:9px;letter-spacing:0.15em;color:rgba(255,255,255,0.3);border:1px solid rgba(255,255,255,0.15);border-radius:2px;padding:1px 5px">BUILT-IN</span>`;
    return `<tr>
      <td style="font-size:18px;padding:6px 10px">${iconHtml}</td>
      <td style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.5)">${_aeEsc(action.id)}</td>
      <td style="font-size:11px">${_aeEsc(action.description || '')}</td>
      <td>${badge}</td>
    </tr>`;
  }).join('');

  const builtinSection = `
    <div style="font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:8px">Built-in Actions</div>
    <table class="streams-table" style="width:100%;margin-bottom:20px">
      <thead><tr><th>Icon</th><th>ID</th><th>Description</th><th>Note</th></tr></thead>
      <tbody>${builtinRows}</tbody>
    </table>`;

  const addBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:12px">
    <button class="cam-add-btn" onclick="addAeAction()">+ Add Action</button>
  </div>`;

  if (actions.length === 0) {
    return builtinSection + addBtn + `<div style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.3);padding:32px 0;text-align:center">
      NO ACTIONS CONFIGURED<br><span style="margin-top:6px;display:block">Use + Add Action above</span>
    </div>`;
  }

  let rows = '';
  actions.forEach(action => {
    const id  = action.id || '';
    const esc = _aeEsc(id);
    const iconHtml = action.icon ? _renderIcon(action.icon) : '';
    const publishSummary = action.type === 'focus-panel'
      ? `focus (${action.timeout > 0 ? action.timeout + 's' : 'manual close'})`
      : (action.publish ? `${_aeEsc(action.publish.topic)} → ${_aeEsc(action.publish.payload)}` : '—');
    const isOpen = AE_OPEN_DRAWER === id;

    rows += `<tr id="ae-action-row-${esc}" style="cursor:pointer" onclick="(function(e){if(!e.target.closest('button'))openAeActionDrawer('${esc}')})(event)">
      <td class="cam-drag-handle" style="width:32px">≡</td>
      <td style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.5)">${_aeEsc(id)}</td>
      <td style="font-size:11px">${_aeEsc(action.description || '')}</td>
      <td style="font-size:18px;padding:6px 10px">${iconHtml}</td>
      <td style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.4);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${publishSummary}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="sp-btn" onclick="openAeActionDrawer('${esc}')" title="Edit">✎</button>
        <button class="sp-btn" onclick="deleteAeAction('${esc}')" title="Delete" style="color:rgba(248,113,113,0.6);border-color:rgba(248,113,113,0.2)">✕</button>
      </td>
    </tr>
    <tr id="ae-action-drawer-row-${esc}">
      <td colspan="6" style="padding:0;border:none">
        <div class="cam-drawer" id="ae-action-drawer-${esc}" style="${isOpen ? 'max-height:9999px' : ''}">
          <div class="cam-drawer-inner" id="ae-action-drawer-inner-${esc}">${isOpen ? _buildAeActionDrawerForm(action, false) : ''}</div>
        </div>
      </td>
    </tr>`;
  });

  return builtinSection + addBtn + `<table class="streams-table" style="width:100%">
    <thead><tr>
      <th></th><th>ID</th><th>Description</th><th>Icon</th><th>Publish</th><th></th>
    </tr></thead>
    <tbody id="ae-actions-tbody">${rows}</tbody>
  </table>`;
}

<<<<<<< Updated upstream
=======
function _refreshAeStateCells() {
  const actions = (AE_LOCAL && AE_LOCAL.actions) || [];
  actions.forEach(action => {
    if (action.type !== 'mqtt' || !action.state || !action.state.topic) return;
    const cell = document.getElementById('ae-action-state-' + _aeEsc(action.id || ''));
    if (cell) cell.innerHTML = _aeStateHtml(action);
  });
}

function _buildAeBuiltinTriggerDrawer(builtinAction, cfgEntry) {
  const trigger      = (cfgEntry && cfgEntry.trigger) || {};
  const tMqttServer  = trigger.mqttServer || '';
  const tTopic       = trigger.topic      || '';
  const tPayload     = trigger.payload    || '';
  const id  = builtinAction.id;
  const esc = _aeEsc(id);

  const serverOpts = ((AE_LOCAL && AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers) || []).map(s =>
    `<option value="${_aeEsc(s.id)}"${s.id === tMqttServer ? ' selected' : ''}>${_aeEsc(s.id)}</option>`
  ).join('');

  return `<div class="cam-form-grid">
    <div style="font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:4px">MQTT Trigger &mdash; ${_aeEsc(builtinAction.description)}</div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">MQTT Server</label>
      <select class="views-input" id="ae-field-trigger-server" style="flex:none;width:auto">
        <option value=""${!tMqttServer ? ' selected' : ''}>— disabled —</option>
        ${serverOpts}
      </select>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Topic</label>
      <input class="views-input" id="ae-field-trigger-topic" value="${_aeEsc(tTopic)}" placeholder="e.g. home/kiosk/view">
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Payload</label>
      <input class="views-input" id="ae-field-trigger-payload" value="${_aeEsc(tPayload)}" placeholder="leave blank to trigger on any payload">
    </div>
  </div>
  <div class="cam-drawer-footer">
    <button class="perf-reset" onclick="closeAeDrawer()">Cancel</button>
    <button class="cam-save-btn" onclick="saveAeBuiltinTrigger('${esc}')">Save</button>
  </div>`;
}

function saveAeBuiltinTrigger(id) {
  const tServer  = (document.getElementById('ae-field-trigger-server')  || {}).value || '';
  const tTopic   = ((document.getElementById('ae-field-trigger-topic')   || {}).value || '').trim();
  const tPayload = ((document.getElementById('ae-field-trigger-payload') || {}).value || '').trim();

  if (!AE_LOCAL) return;
  if (!AE_LOCAL.actions) AE_LOCAL.actions = [];

  // Remove any existing entry for this builtin ID
  AE_LOCAL.actions = AE_LOCAL.actions.filter(a => a.id !== id);

  // If topic is set, add an entry carrying just the trigger
  if (tTopic) {
    AE_LOCAL.actions.push({
      id,
      trigger: {
        ...(tServer ? { mqttServer: tServer } : {}),
        topic: tTopic,
        ...(tPayload ? { payload: tPayload } : {}),
      },
    });
  }

  AE_DRAWER_DIRTY = false;
  closeAeDrawer();
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  applyAeChanges();
}

>>>>>>> Stashed changes
function _buildAeActionDrawerForm(action, isNew) {
  const id     = action.id || '';
  const desc   = action.description || '';
  const icon   = action.icon || '';
  const type       = action.type || 'mqtt';
  const mqttServer = action.mqttServer || '';
  const pTopic = (action.publish && action.publish.topic) || '';
  const pPay   = (action.publish && action.publish.payload) || '';
  const sTopic = (action.state && action.action.state.topic) || '';
  const sOnVal = (action.state && action.action.state.onValue) || '';

  const focusAuto = !!(action.timeout && action.timeout > 0);
  const focusTimeout = focusAuto ? action.timeout : 30;
  const iconPreviewId = `ae-icon-preview-${_aeEsc(id)}`;
  return `<div class="cam-form-grid">
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Type</label>
      <select class="views-input" id="ae-field-type" style="flex:none;width:auto" onchange="_aeTypeChanged(this.value)">
        <option value="mqtt"${type === 'mqtt' ? ' selected' : ''}>mqtt</option>
        <option value="focus-panel"${type === 'focus-panel' ? ' selected' : ''}>focus-panel</option>
      </select>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">ID (slug)</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-id" value="${_aeEsc(id)}" placeholder="my-action">
        <div style="font-size:9px;color:rgba(255,255,255,0.25);font-family:'Courier New',monospace">Lowercase letters, numbers, hyphens</div>
        <div class="cam-field-error" id="ae-err-id"></div>
      </div>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Description</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-description" value="${_aeEsc(desc)}" placeholder="e.g. Turn On">
        <div class="cam-field-error" id="ae-err-description"></div>
      </div>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Icon</label>
      <div style="flex:1;display:flex;gap:8px;align-items:center">
        <input class="views-input" id="ae-field-icon" value="${_aeEsc(icon)}" placeholder="mdi:lightbulb or emoji"
          oninput="document.getElementById('${iconPreviewId}').innerHTML=this.value?_renderIcon(this.value):''">
        <span id="${iconPreviewId}" style="font-size:22px;flex-shrink:0">${icon ? _renderIcon(icon) : ''}</span>
      </div>
    </div>

    <div id="ae-mqtt-fields" style="${type === 'focus-panel' ? 'display:none' : ''}">
      <div class="views-form-row" style="margin-top:0">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">MQTT Server</label>
        <div style="flex:1;display:flex;flex-direction:column;gap:4px">
          ${(function() {
            const servers = (AE_LOCAL && AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers) || [];
            if (servers.length === 0) {
              return `<select class="views-input" id="ae-field-mqttserver" style="flex:none;width:auto" disabled>
                <option value="">— no servers configured —</option>
              </select>`;
            }
            const opts = servers.map(s =>
              `<option value="${_aeEsc(s.id)}"${s.id === mqttServer ? ' selected' : ''}>${_aeEsc(s.id)}</option>`
            ).join('');
            return `<select class="views-input" id="ae-field-mqttserver" style="flex:none;width:auto">
              <option value="">— none —</option>
              ${opts}
            </select>`;
          })()}
          <div class="cam-field-error" id="ae-err-mqttserver"></div>
        </div>
      </div>
      <div style="font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin:4px 0 -4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">Publish</div>
      <div class="views-form-row">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Topic</label>
        <div style="flex:1;display:flex;flex-direction:column;gap:4px">
          <input class="views-input" id="ae-field-publish-topic" value="${_aeEsc(pTopic)}" placeholder="home/light/set">
          <div class="cam-field-error" id="ae-err-publish-topic"></div>
        </div>
      </div>
      <div class="views-form-row">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Payload</label>
        <div style="flex:1;display:flex;flex-direction:column;gap:4px">
          <input class="views-input" id="ae-field-publish-payload" value="${_aeEsc(pPay)}" placeholder="ON">
          <div class="cam-field-error" id="ae-err-publish-payload"></div>
        </div>
      </div>
      <div style="font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin:4px 0 -4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">State (optional)</div>
      <div class="views-form-row">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">State Topic</label>
        <input class="views-input" id="ae-field-state-topic" value="${_aeEsc(sTopic)}" placeholder="home/light/state">
      </div>
      <div class="views-form-row">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">On Value</label>
        <div style="flex:1;display:flex;flex-direction:column;gap:4px">
          <input class="views-input" id="ae-field-state-onvalue" value="${_aeEsc(sOnVal)}" placeholder="ON">
          <div style="font-size:9px;color:rgba(255,255,255,0.25);font-family:'Courier New',monospace">Payload string that means ON</div>
        </div>
      </div>
    </div>

    <div id="ae-focus-fields" style="${type === 'focus-panel' ? '' : 'display:none'}">
      <div class="views-form-row" style="margin-top:8px">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Close behaviour</label>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="radio" name="ae-focus-close" id="ae-focus-keep" value="keep"${!focusAuto ? ' checked' : ''} onclick="_aeFocusRadioChanged()"> Keep open until closed
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="radio" name="ae-focus-close" id="ae-focus-auto" value="auto"${focusAuto ? ' checked' : ''} onclick="_aeFocusRadioChanged()"> Auto-close after
            <input type="number" id="ae-focus-timeout" min="1" max="3600" value="${focusTimeout}"${!focusAuto ? ' disabled' : ''} style="width:60px" class="views-input"> seconds
          </label>
        </div>
      </div>
    </div>
  </div>
  <div class="cam-drawer-footer">
    <button class="perf-reset" onclick="closeAeDrawer()">Cancel</button>
    <button class="cam-save-btn" onclick="saveAeActionDrawer('${_aeEsc(id)}', ${isNew})">Save</button>
  </div>`;
}

function openAeActionDrawer(id) {
  if (AE_OPEN_DRAWER === id) {
    if (!AE_DRAWER_DIRTY) closeAeDrawer();
    return;
  }
  if (AE_OPEN_DRAWER) closeAeDrawer();
  const action = (AE_LOCAL.actions || []).find(a => a.id === id);
  if (!action) return;
  const inner = document.getElementById(`ae-action-drawer-inner-${id}`);
  if (!inner) return;
  const isNew = !AE_FULL || !(AE_FULL.actions || []).find(a => a.id === id);
  inner.innerHTML = _buildAeActionDrawerForm(action, isNew);
  const drawer = document.getElementById(`ae-action-drawer-${id}`);
  if (drawer) drawer.style.maxHeight = '9999px';
  AE_OPEN_DRAWER = id;
  AE_DRAWER_DIRTY = false;
  inner.addEventListener('input',  () => { AE_DRAWER_DIRTY = true; });
  inner.addEventListener('change', () => { AE_DRAWER_DIRTY = true; });
  const row = document.getElementById(`ae-action-row-${id}`);
  if (row) row.classList.add('cam-row-active');
}

function closeAeDrawer() {
  if (!AE_OPEN_DRAWER) return;
  const drawerEl = document.getElementById(`ae-action-drawer-${AE_OPEN_DRAWER}`) ||
                   document.getElementById(`ae-group-drawer-${AE_OPEN_DRAWER}`) ||
                   document.getElementById(`ae-srv-drawer-${AE_OPEN_DRAWER}`);
  const rowEl    = document.getElementById(`ae-action-row-${AE_OPEN_DRAWER}`) ||
                   document.getElementById(`ae-group-row-${AE_OPEN_DRAWER}`) ||
                   document.getElementById(`ae-srv-row-${AE_OPEN_DRAWER}`);
  if (drawerEl) drawerEl.style.maxHeight = '0';
  if (rowEl) rowEl.classList.remove('cam-row-active');
  AE_OPEN_DRAWER = null;
  AE_DRAWER_DIRTY = false;
}

function _aeTypeChanged(type) {
  const focusFields = document.getElementById('ae-focus-fields');
  const mqttFields = document.getElementById('ae-mqtt-fields');
  if (focusFields) focusFields.style.display = type === 'focus-panel' ? '' : 'none';
  if (mqttFields) mqttFields.style.display = type === 'focus-panel' ? 'none' : '';
  if (type === 'focus-panel') _aeFocusRadioChanged();
}

function _aeFocusRadioChanged() {
  const auto = !!(document.getElementById('ae-focus-auto') && document.getElementById('ae-focus-auto').checked);
  const timeoutEl = document.getElementById('ae-focus-timeout');
  if (timeoutEl) timeoutEl.disabled = !auto;
}

function saveAeActionDrawer(originalId, isNew) {
  const idEl     = document.getElementById('ae-field-id');
  const descEl   = document.getElementById('ae-field-description');
  const ptEl     = document.getElementById('ae-field-publish-topic');
  const ppEl     = document.getElementById('ae-field-publish-payload');

  const newId      = idEl    ? idEl.value.trim()    : originalId;
  const newDesc    = descEl  ? descEl.value.trim()  : '';
  const pTopic     = ptEl    ? ptEl.value.trim()    : '';
  const pPayload   = ppEl    ? ppEl.value.trim()    : '';
  const icon       = (document.getElementById('ae-field-icon')           || {}).value || '';
  const sTopic     = (document.getElementById('ae-field-state-topic')   || {}).value.trim();
  const sOnVal     = (document.getElementById('ae-field-state-onvalue') || {}).value.trim();
  const type       = (document.getElementById('ae-field-type')           || {}).value || 'mqtt';
  const mqttServer = (document.getElementById('ae-field-mqttserver')    || {}).value || '';

  let valid = true;

  const errId = document.getElementById('ae-err-id');
  if (!/^[a-z0-9-]+$/.test(newId)) {
    if (errId) errId.textContent = 'Lowercase letters, numbers, and hyphens only';
    valid = false;
  } else if (newId !== originalId && (AE_LOCAL.actions || []).find(a => a.id === newId)) {
    if (errId) errId.textContent = 'ID already exists';
    valid = false;
  } else {
    if (errId) errId.textContent = '';
  }

  const errDesc = document.getElementById('ae-err-description');
  if (!newDesc) {
    if (errDesc) errDesc.textContent = 'Description is required';
    valid = false;
  } else {
    if (errDesc) errDesc.textContent = '';
  }

  if (type === 'mqtt') {
    const errPT = document.getElementById('ae-err-publish-topic');
    if (!pTopic) {
      if (errPT) errPT.textContent = 'Publish topic is required';
      valid = false;
    } else {
      if (errPT) errPT.textContent = '';
    }

    const errPP = document.getElementById('ae-err-publish-payload');
    if (!pPayload) {
      if (errPP) errPP.textContent = 'Publish payload is required';
      valid = false;
    } else {
      if (errPP) errPP.textContent = '';
    }

    const errMS = document.getElementById('ae-err-mqttserver');
    const hasSrv = (AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers || []).length > 0;
    if (hasSrv && !mqttServer) {
      if (errMS) errMS.textContent = 'Server is required for MQTT actions';
      valid = false;
    } else {
      if (errMS) errMS.textContent = '';
    }
  }

  let timeout = 0;
  if (type === 'focus-panel') {
    const autoClose = !!(document.getElementById('ae-focus-auto') && document.getElementById('ae-focus-auto').checked);
    timeout = autoClose ? (parseInt((document.getElementById('ae-focus-timeout') || {}).value, 10) || 30) : 0;
  }

  if (!valid) return;

  const updated = {
    id: newId,
    type,
    description: newDesc,
    ...(icon ? { icon } : {}),
    ...(type === 'mqtt' && mqttServer ? { mqttServer } : {}),
    ...(type === 'mqtt' ? { publish: { topic: pTopic, payload: pPayload } } : {}),
    ...(type === 'mqtt' && sTopic ? { state: { topic: sTopic, ...(sOnVal ? { onValue: sOnVal } : {}) } } : {}),
    ...(type === 'focus-panel' && timeout > 0 ? { timeout } : {}),
  };

  const idx = (AE_LOCAL.actions || []).findIndex(a => a.id === originalId);
  if (idx >= 0) {
    AE_LOCAL.actions[idx] = updated;
  } else {
    AE_LOCAL.actions.push(updated);
  }

  // Update group references if id changed
  if (newId !== originalId) {
    (AE_LOCAL.groups || []).forEach(g => {
      if (Array.isArray(g.actions)) {
        g.actions = g.actions.map(aid => aid === originalId ? newId : aid);
      }
    });
  }

  AE_DRAWER_DIRTY = false;
  AE_OPEN_DRAWER = null;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  applyAeChanges();
}

function deleteAeAction(id) {
  const action = (AE_LOCAL.actions || []).find(a => a.id === id);
  if (!action) return;
  const row = document.getElementById(`ae-action-row-${id}`);
  if (!row) return;
  row.classList.add('cam-row-confirm');
  row.onclick = null;
  row.innerHTML = `<td colspan="5" style="padding:10px 16px">
    <span style="font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.7)">Delete action "<strong>${_aeEsc(id)}</strong>"?</span>
  </td>
  <td style="text-align:right;white-space:nowrap;padding:10px 16px">
    <button class="perf-reset" onclick="(function(){const c=document.getElementById('ae-tabs-and-content');if(c)_renderAeTabsInto(c);})()">Cancel</button>
    <button class="cam-save-btn" style="background:rgba(248,113,113,0.15);border-color:rgba(248,113,113,0.5);color:#f87171" onclick="confirmDeleteAeAction('${_aeEsc(id)}')">Delete</button>
  </td>`;
}

function confirmDeleteAeAction(id) {
  AE_LOCAL.actions = (AE_LOCAL.actions || []).filter(a => a.id !== id);
  // Remove from all groups
  (AE_LOCAL.groups || []).forEach(g => {
    if (Array.isArray(g.actions)) g.actions = g.actions.filter(aid => aid !== id);
  });
  if (AE_OPEN_DRAWER === id) AE_OPEN_DRAWER = null;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  applyAeChanges();
}

function addAeAction() {
  if (!AE_LOCAL.actions) AE_LOCAL.actions = [];
  let n = 1;
  while (AE_LOCAL.actions.find(a => a.id === `new-action-${n}`)) n++;
  const newAction = { id: `new-action-${n}`, type: 'mqtt', description: '', publish: { topic: '', payload: '' } };
  AE_LOCAL.actions.push(newAction);
  AE_OPEN_DRAWER = newAction.id;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
}

// ── Groups Tab ────────────────────────────────────────────────────────────────

function _buildAeGroupsTab() {
  const groups = (AE_LOCAL && AE_LOCAL.groups) || [];

  const addBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:12px">
    <button class="cam-add-btn" onclick="addAeGroup()">+ Add Group</button>
  </div>`;

  if (groups.length === 0) {
    return addBtn + `<div style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.3);padding:32px 0;text-align:center">
      NO GROUPS CONFIGURED<br><span style="margin-top:6px;display:block">Use + Add Group above</span>
    </div>`;
  }

  let rows = '';
  groups.forEach(group => {
    const id  = group.id || '';
    const esc = _aeEsc(id);
    const actionCount = (group.actions || []).length;
    const isOpen = AE_OPEN_DRAWER === id;

    rows += `<tr id="ae-group-row-${esc}" style="cursor:pointer" onclick="(function(e){if(!e.target.closest('button'))openAeGroupDrawer('${esc}')})(event)">
      <td class="cam-drag-handle" style="width:32px">≡</td>
      <td style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.5)">${_aeEsc(id)}</td>
      <td style="font-size:11px">${_aeEsc(group.name || '')}</td>
      <td style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.4)">${actionCount} action${actionCount !== 1 ? 's' : ''}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="sp-btn" onclick="openAeGroupDrawer('${esc}')" title="Edit">✎</button>
        <button class="sp-btn" onclick="deleteAeGroup('${esc}')" title="Delete" style="color:rgba(248,113,113,0.6);border-color:rgba(248,113,113,0.2)">✕</button>
      </td>
    </tr>
    <tr id="ae-group-drawer-row-${esc}">
      <td colspan="5" style="padding:0;border:none">
        <div class="cam-drawer" id="ae-group-drawer-${esc}" style="${isOpen ? 'max-height:9999px' : ''}">
          <div class="cam-drawer-inner" id="ae-group-drawer-inner-${esc}">${isOpen ? _buildAeGroupDrawerForm(group, false) : ''}</div>
        </div>
      </td>
    </tr>`;
  });

  return addBtn + `<table class="streams-table" style="width:100%">
    <thead><tr>
      <th></th><th>ID</th><th>Name</th><th>Actions</th><th></th>
    </tr></thead>
    <tbody id="ae-groups-tbody">${rows}</tbody>
  </table>`;
}

function _buildAeGroupDrawerForm(group, isNew) {
  const id      = group.id || '';
  const name    = group.name || '';
  const slots   = (group.actions || []).slice(0, 6);
  const numSlots = Math.min(slots.length + 1, 6); // show one extra empty slot unless at max
  const allActions = (AE_LOCAL && AE_LOCAL.actions) || [];

  const actionOpts = allActions.map(a =>
    `<option value="${_aeEsc(a.id)}">${_aeEsc(a.description || a.id)}</option>`
  ).join('');

  const builtinOptsForSlot = (val) => typeof BUILTIN_ACTIONS !== 'undefined'
    ? Object.values(BUILTIN_ACTIONS).map(a =>
        `<option value="${_aeEsc(a.id)}"${a.id===val?' selected':''}>${_aeEsc(a.description || a.id)}</option>`
      ).join('')
    : '';

  let slotsHtml = '';
  for (let i = 0; i < numSlots; i++) {
    const val = slots[i] || '';
    slotsHtml += `<div class="views-form-row" id="ae-slot-row-${i}">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Button ${i + 1}</label>
      <select class="views-input" id="ae-slot-${i}" style="flex:none;width:auto">
        <option value="">— none —</option>
        ${allActions.map(a => `<option value="${_aeEsc(a.id)}"${a.id===val?' selected':''}>${_aeEsc(a.description || a.id)}</option>`).join('')}
        ${builtinOptsForSlot(val)}
      </select>
    </div>`;
  }

  const addSlotBtn = numSlots < 6
    ? `<button class="perf-reset" id="ae-add-slot-btn" onclick="_aeAddSlot(${numSlots})" style="align-self:flex-start;margin-top:4px">+ Add Button</button>`
    : '';

  return `<div class="cam-form-grid">
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">ID (slug)</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-group-id" value="${_aeEsc(id)}" placeholder="my-group">
        <div class="cam-field-error" id="ae-err-group-id"></div>
      </div>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Name</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-group-name" value="${_aeEsc(name)}" placeholder="Living Room">
        <div class="cam-field-error" id="ae-err-group-name"></div>
      </div>
    </div>

    <div style="font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin:4px 0 -4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">Action Slots</div>
    <div id="ae-slots-container" style="display:flex;flex-direction:column;gap:10px">
      ${slotsHtml}
      ${addSlotBtn}
    </div>
  </div>
  <div class="cam-drawer-footer">
    <button class="perf-reset" onclick="closeAeDrawer()">Cancel</button>
    <button class="cam-save-btn" onclick="saveAeGroupDrawer('${_aeEsc(id)}', ${isNew})">Save</button>
  </div>`;
}

function _aeAddSlot(currentCount) {
  if (currentCount >= 6) return;
  const allActions = (AE_LOCAL && AE_LOCAL.actions) || [];
  const container = document.getElementById('ae-slots-container');
  if (!container) return;

  const addBtn = document.getElementById('ae-add-slot-btn');
  const slotRow = document.createElement('div');
  slotRow.className = 'views-form-row';
  slotRow.id = `ae-slot-row-${currentCount}`;
  const builtinOptsAdd = typeof BUILTIN_ACTIONS !== 'undefined'
    ? Object.values(BUILTIN_ACTIONS).map(a =>
        `<option value="${_aeEsc(a.id)}">${_aeEsc(a.description || a.id)}</option>`
      ).join('')
    : '';
  slotRow.innerHTML = `
    <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Button ${currentCount + 1}</label>
    <select class="views-input" id="ae-slot-${currentCount}" style="flex:none;width:auto">
      <option value="">— none —</option>
      ${allActions.map(a => `<option value="${_aeEsc(a.id)}">${_aeEsc(a.description || a.id)}</option>`).join('')}
      ${builtinOptsAdd}
    </select>`;

  if (addBtn) {
    container.insertBefore(slotRow, addBtn);
    if (currentCount + 1 >= 6) addBtn.style.display = 'none';
    else addBtn.setAttribute('onclick', `_aeAddSlot(${currentCount + 1})`);
  } else {
    container.appendChild(slotRow);
  }
}

function openAeGroupDrawer(id) {
  if (AE_OPEN_DRAWER === id) {
    if (!AE_DRAWER_DIRTY) closeAeDrawer();
    return;
  }
  if (AE_OPEN_DRAWER) closeAeDrawer();
  const group = (AE_LOCAL.groups || []).find(g => g.id === id);
  if (!group) return;
  const inner = document.getElementById(`ae-group-drawer-inner-${id}`);
  if (!inner) return;
  const isNew = !AE_FULL || !(AE_FULL.groups || []).find(g => g.id === id);
  inner.innerHTML = _buildAeGroupDrawerForm(group, isNew);
  const drawer = document.getElementById(`ae-group-drawer-${id}`);
  if (drawer) drawer.style.maxHeight = '9999px';
  AE_OPEN_DRAWER = id;
  AE_DRAWER_DIRTY = false;
  inner.addEventListener('input',  () => { AE_DRAWER_DIRTY = true; });
  inner.addEventListener('change', () => { AE_DRAWER_DIRTY = true; });
  const row = document.getElementById(`ae-group-row-${id}`);
  if (row) row.classList.add('cam-row-active');
}

function saveAeGroupDrawer(originalId, isNew) {
  const idEl   = document.getElementById('ae-field-group-id');
  const nameEl = document.getElementById('ae-field-group-name');
  const newId   = idEl   ? idEl.value.trim()   : originalId;
  const newName = nameEl ? nameEl.value.trim() : '';

  let valid = true;

  const errId = document.getElementById('ae-err-group-id');
  if (!/^[a-z0-9-]+$/.test(newId)) {
    if (errId) errId.textContent = 'Lowercase letters, numbers, and hyphens only';
    valid = false;
  } else if (newId !== originalId && (AE_LOCAL.groups || []).find(g => g.id === newId)) {
    if (errId) errId.textContent = 'ID already exists';
    valid = false;
  } else {
    if (errId) errId.textContent = '';
  }

  const errName = document.getElementById('ae-err-group-name');
  if (!newName) {
    if (errName) errName.textContent = 'Name is required';
    valid = false;
  } else {
    if (errName) errName.textContent = '';
  }

  if (!valid) return;

  // Collect slot selects
  const actions = [];
  for (let i = 0; i < 6; i++) {
    const sel = document.getElementById(`ae-slot-${i}`);
    if (!sel) break;
    if (sel.value) actions.push(sel.value);
  }

  const updated = { id: newId, name: newName, actions };

  const idx = (AE_LOCAL.groups || []).findIndex(g => g.id === originalId);
  if (idx >= 0) {
    AE_LOCAL.groups[idx] = updated;
  } else {
    AE_LOCAL.groups.push(updated);
  }

  AE_DRAWER_DIRTY = false;
  AE_OPEN_DRAWER = null;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  applyAeChanges();
}

function deleteAeGroup(id) {
  const group = (AE_LOCAL.groups || []).find(g => g.id === id);
  if (!group) return;
  const row = document.getElementById(`ae-group-row-${id}`);
  if (!row) return;
  row.classList.add('cam-row-confirm');
  row.onclick = null;
  row.innerHTML = `<td colspan="4" style="padding:10px 16px">
    <span style="font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.7)">Delete group "<strong>${_aeEsc(id)}</strong>"?</span>
  </td>
  <td style="text-align:right;white-space:nowrap;padding:10px 16px">
    <button class="perf-reset" onclick="(function(){const c=document.getElementById('ae-tabs-and-content');if(c)_renderAeTabsInto(c);})()">Cancel</button>
    <button class="cam-save-btn" style="background:rgba(248,113,113,0.15);border-color:rgba(248,113,113,0.5);color:#f87171" onclick="confirmDeleteAeGroup('${_aeEsc(id)}')">Delete</button>
  </td>`;
}

function confirmDeleteAeGroup(id) {
  AE_LOCAL.groups = (AE_LOCAL.groups || []).filter(g => g.id !== id);
  if (AE_OPEN_DRAWER === id) AE_OPEN_DRAWER = null;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  applyAeChanges();
}

function addAeGroup() {
  if (!AE_LOCAL.groups) AE_LOCAL.groups = [];
  let n = 1;
  while (AE_LOCAL.groups.find(g => g.id === `new-group-${n}`)) n++;
  const newGroup = { id: `new-group-${n}`, name: '', actions: [] };
  AE_LOCAL.groups.push(newGroup);
  AE_OPEN_DRAWER = newGroup.id;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
}

// ── Unsaved banner ────────────────────────────────────────────────────────────

function _buildAeBanner() {
  const changed = _aeCountChanges();
  return `<div class="cam-unsaved-banner" id="ae-banner">
    <span><span class="cam-unsaved-dot"></span><span id="ae-banner-text">${changed} unsaved change${changed !== 1 ? 's' : ''}</span></span>
    <div style="display:flex;gap:8px">
      <button class="perf-reset" onclick="discardAeChanges()">Discard</button>
      <button class="cam-apply-btn" id="ae-apply-btn" onclick="applyAeChanges()">Apply Changes</button>
    </div>
  </div>`;
}

function _aeCountChanges() {
  if (!AE_FULL) return 1; // new file — counts as a change
  const a = JSON.stringify(AE_FULL);
  const b = JSON.stringify(AE_LOCAL);
  if (a === b) return 0;
  // Rough count: sum changed actions + changed groups + mqtt change
  let count = 0;
  if (JSON.stringify(AE_FULL.mqtt) !== JSON.stringify(AE_LOCAL.mqtt)) count++;
  const fullActions  = AE_FULL.actions  || [];
  const localActions = AE_LOCAL.actions || [];
  const fullGroups   = AE_FULL.groups   || [];
  const localGroups  = AE_LOCAL.groups  || [];
  const maxAct = Math.max(fullActions.length, localActions.length);
  for (let i = 0; i < maxAct; i++) {
    if (JSON.stringify(fullActions[i]) !== JSON.stringify(localActions[i])) count++;
  }
  const maxGrp = Math.max(fullGroups.length, localGroups.length);
  for (let i = 0; i < maxGrp; i++) {
    if (JSON.stringify(fullGroups[i]) !== JSON.stringify(localGroups[i])) count++;
  }
  return Math.max(count, 1);
}

function markAeUnsaved() {
  AE_UNSAVED = true;
  const banner = document.getElementById('ae-banner');
  const text   = document.getElementById('ae-banner-text');
  if (!banner) {
    // Re-render to add banner
    const container = document.getElementById('ae-tabs-and-content');
    if (container) _renderAeTabsInto(container);
    return;
  }
  banner.style.display = 'flex';
  if (text) {
    const changed = _aeCountChanges();
    text.textContent = `${changed} unsaved change${changed !== 1 ? 's' : ''}`;
  }
}

async function applyAeChanges() {
  const btn  = document.getElementById('ae-apply-btn');
  const text = document.getElementById('ae-banner-text');
  if (btn)  { btn.disabled = true; btn.textContent = '···'; }
  if (text) text.textContent = 'Saving...';

  try {
    const res = await fetch('/api/actions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(AE_LOCAL),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    AE_FULL    = _aeDeepClone(AE_LOCAL);
    AE_UNSAVED = false;

    if (text) { text.textContent = '✓ Applied'; text.style.color = '#4ade80'; }
    if (btn)  { btn.textContent  = 'Applied'; }

    // Hot-reload actions in the kiosk
    if (typeof loadActionsConfig === 'function') await loadActionsConfig();

    setTimeout(() => {
      const banner = document.getElementById('ae-banner');
      if (banner) banner.style.display = 'none';
      if (btn)  { btn.disabled = false; btn.textContent = 'Apply Changes'; }
      if (text) { text.style.color = ''; text.textContent = ''; }
    }, 2000);
  } catch(e) {
    if (text) { text.textContent = `Save failed — ${e.message}`; text.style.color = '#f87171'; }
    if (btn)  { btn.disabled = false; btn.textContent = 'Apply Changes'; }
  }
}

function discardAeChanges() {
  AE_LOCAL       = _aeDeepClone(AE_FULL || { mqtt: { servers: [] }, actions: [], groups: [] });
  AE_UNSAVED     = false;
  AE_OPEN_DRAWER = null;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
}

// ── Drag-to-reorder: Actions ──────────────────────────────────────────────────

let _aeDrag = null;

function _initAeActionDrag() {
  document.querySelectorAll('#ae-actions-tbody .cam-drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', _onAeActionDragDown, { passive: false });
  });
}

function _onAeActionDragDown(e) {
  e.preventDefault();
  const handle = e.currentTarget;
  const row    = handle.closest('tr');
  const tbody  = document.getElementById('ae-actions-tbody');
  if (!tbody) return;
  const rows   = [...tbody.querySelectorAll('tr[id^="ae-action-row-"]')];
  const idx    = rows.indexOf(row);
  if (idx < 0) return;

  const rect = row.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.id = 'ae-drag-ghost';
  ghost.style.cssText = `position:fixed;z-index:2000;pointer-events:none;background:rgba(15,15,15,0.97);border:1px solid rgba(74,222,128,0.5);border-radius:3px;box-shadow:0 6px 24px rgba(0,0,0,0.7);display:flex;align-items:center;padding:0 16px;font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.8);left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  ghost.textContent = (AE_LOCAL.actions || [])[idx] ? AE_LOCAL.actions[idx].id : '';
  document.body.appendChild(ghost);

  row.classList.add('cam-row-dragging');
  handle.setPointerCapture(e.pointerId);
  _aeDrag = { type: 'action', idx, dropIdx: idx, ghost, rows, offsetY: e.clientY - rect.top };
  handle.addEventListener('pointermove',   _onAeActionDragMove);
  handle.addEventListener('pointerup',     _onAeActionDragEnd);
  handle.addEventListener('pointercancel', _onAeActionDragEnd);
}

function _onAeActionDragMove(e) {
  if (!_aeDrag) return;
  const { ghost, rows, offsetY } = _aeDrag;
  ghost.style.top = (e.clientY - offsetY) + 'px';
  let dropIdx = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { dropIdx = i; break; }
  }
  _aeDrag.dropIdx = dropIdx;
  rows.forEach(r => r.classList.remove('cam-drop-before', 'cam-drop-after'));
  if (dropIdx < rows.length) rows[dropIdx].classList.add('cam-drop-before');
  else rows[rows.length - 1].classList.add('cam-drop-after');
}

function _onAeActionDragEnd(e) {
  if (!_aeDrag) return;
  const { idx, dropIdx, ghost, rows } = _aeDrag;
  const handle = e.currentTarget;
  handle.removeEventListener('pointermove',   _onAeActionDragMove);
  handle.removeEventListener('pointerup',     _onAeActionDragEnd);
  handle.removeEventListener('pointercancel', _onAeActionDragEnd);
  ghost.remove();
  rows.forEach(r => r.classList.remove('cam-row-dragging', 'cam-drop-before', 'cam-drop-after'));
  _aeDrag = null;
  const newIdx = dropIdx <= idx ? dropIdx : dropIdx - 1;
  if (newIdx === idx) return;
  const [moved] = (AE_LOCAL.actions || []).splice(idx, 1);
  AE_LOCAL.actions.splice(newIdx, 0, moved);
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  markAeUnsaved();
}

// ── Drag-to-reorder: Groups ───────────────────────────────────────────────────

function _initAeGroupDrag() {
  document.querySelectorAll('#ae-groups-tbody .cam-drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', _onAeGroupDragDown, { passive: false });
  });
}

function _onAeGroupDragDown(e) {
  e.preventDefault();
  const handle = e.currentTarget;
  const row    = handle.closest('tr');
  const tbody  = document.getElementById('ae-groups-tbody');
  if (!tbody) return;
  const rows   = [...tbody.querySelectorAll('tr[id^="ae-group-row-"]')];
  const idx    = rows.indexOf(row);
  if (idx < 0) return;

  const rect = row.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.id = 'ae-drag-ghost';
  ghost.style.cssText = `position:fixed;z-index:2000;pointer-events:none;background:rgba(15,15,15,0.97);border:1px solid rgba(74,222,128,0.5);border-radius:3px;box-shadow:0 6px 24px rgba(0,0,0,0.7);display:flex;align-items:center;padding:0 16px;font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.8);left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  ghost.textContent = (AE_LOCAL.groups || [])[idx] ? AE_LOCAL.groups[idx].id : '';
  document.body.appendChild(ghost);

  row.classList.add('cam-row-dragging');
  handle.setPointerCapture(e.pointerId);
  _aeDrag = { type: 'group', idx, dropIdx: idx, ghost, rows, offsetY: e.clientY - rect.top };
  handle.addEventListener('pointermove',   _onAeGroupDragMove);
  handle.addEventListener('pointerup',     _onAeGroupDragEnd);
  handle.addEventListener('pointercancel', _onAeGroupDragEnd);
}

function _onAeGroupDragMove(e) {
  if (!_aeDrag) return;
  const { ghost, rows, offsetY } = _aeDrag;
  ghost.style.top = (e.clientY - offsetY) + 'px';
  let dropIdx = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { dropIdx = i; break; }
  }
  _aeDrag.dropIdx = dropIdx;
  rows.forEach(r => r.classList.remove('cam-drop-before', 'cam-drop-after'));
  if (dropIdx < rows.length) rows[dropIdx].classList.add('cam-drop-before');
  else rows[rows.length - 1].classList.add('cam-drop-after');
}

function _onAeGroupDragEnd(e) {
  if (!_aeDrag) return;
  const { idx, dropIdx, ghost, rows } = _aeDrag;
  const handle = e.currentTarget;
  handle.removeEventListener('pointermove',   _onAeGroupDragMove);
  handle.removeEventListener('pointerup',     _onAeGroupDragEnd);
  handle.removeEventListener('pointercancel', _onAeGroupDragEnd);
  ghost.remove();
  rows.forEach(r => r.classList.remove('cam-row-dragging', 'cam-drop-before', 'cam-drop-after'));
  _aeDrag = null;
  const newIdx = dropIdx <= idx ? dropIdx : dropIdx - 1;
  if (newIdx === idx) return;
  const [moved] = (AE_LOCAL.groups || []).splice(idx, 1);
  AE_LOCAL.groups.splice(newIdx, 0, moved);
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  markAeUnsaved();
}

// ── Drag-to-reorder: Servers ──────────────────────────────────────────────────

function _initAeSrvDrag() {
  document.querySelectorAll('#ae-srv-tbody .cam-drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', _onAeSrvDragDown, { passive: false });
  });
}

function _onAeSrvDragDown(e) {
  e.preventDefault();
  const handle = e.currentTarget;
  const row    = handle.closest('tr');
  const tbody  = document.getElementById('ae-srv-tbody');
  if (!tbody) return;
  const rows   = [...tbody.querySelectorAll('tr[id^="ae-srv-row-"]')];
  const idx    = rows.indexOf(row);
  if (idx < 0) return;

  const rect = row.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.id = 'ae-drag-ghost';
  ghost.style.cssText = `position:fixed;z-index:2000;pointer-events:none;background:rgba(15,15,15,0.97);border:1px solid rgba(74,222,128,0.5);border-radius:3px;box-shadow:0 6px 24px rgba(0,0,0,0.7);display:flex;align-items:center;padding:0 16px;font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.8);left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  ghost.textContent = (AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers || [])[idx] ? AE_LOCAL.mqtt.servers[idx].id : '';
  document.body.appendChild(ghost);

  row.classList.add('cam-row-dragging');
  handle.setPointerCapture(e.pointerId);
  _aeDrag = { type: 'srv', idx, dropIdx: idx, ghost, rows, offsetY: e.clientY - rect.top };
  handle.addEventListener('pointermove',   _onAeSrvDragMove);
  handle.addEventListener('pointerup',     _onAeSrvDragEnd);
  handle.addEventListener('pointercancel', _onAeSrvDragEnd);
}

function _onAeSrvDragMove(e) {
  if (!_aeDrag) return;
  const { ghost, rows, offsetY } = _aeDrag;
  ghost.style.top = (e.clientY - offsetY) + 'px';
  let dropIdx = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { dropIdx = i; break; }
  }
  _aeDrag.dropIdx = dropIdx;
  rows.forEach(r => r.classList.remove('cam-drop-before', 'cam-drop-after'));
  if (dropIdx < rows.length) rows[dropIdx].classList.add('cam-drop-before');
  else rows[rows.length - 1].classList.add('cam-drop-after');
}

function _onAeSrvDragEnd(e) {
  if (!_aeDrag) return;
  const { idx, dropIdx, ghost, rows } = _aeDrag;
  const handle = e.currentTarget;
  handle.removeEventListener('pointermove',   _onAeSrvDragMove);
  handle.removeEventListener('pointerup',     _onAeSrvDragEnd);
  handle.removeEventListener('pointercancel', _onAeSrvDragEnd);
  ghost.remove();
  rows.forEach(r => r.classList.remove('cam-row-dragging', 'cam-drop-before', 'cam-drop-after'));
  _aeDrag = null;
  const newIdx = dropIdx <= idx ? dropIdx : dropIdx - 1;
  if (newIdx === idx) return;
  const servers = AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers;
  if (!servers) return;
  const [moved] = servers.splice(idx, 1);
  servers.splice(newIdx, 0, moved);
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  markAeUnsaved();
}
