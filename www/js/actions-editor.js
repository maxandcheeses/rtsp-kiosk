// ── Actions settings editor ─────────────────────────────────────────────────

// ── TLS cert storage (localStorage) ─────────────────────────────────────────
const _AE_CERTS_KEY = 'mqtt_certs';
const _AE_MQTT_PORT_DEFAULTS = { ws: 9001, wss: 8884, mqtt: 1883, mqtts: 8883 };

function _aeCertsLoad()           { try { return JSON.parse(localStorage.getItem(_AE_CERTS_KEY) || '{}'); } catch(e) { return {}; } }
function _aeCertsSave(map)        { localStorage.setItem(_AE_CERTS_KEY, JSON.stringify(map)); }
function _aeCertsList()           { return Object.keys(_aeCertsLoad()); }
function _aeCertsGet(name)        { return _aeCertsLoad()[name] || null; }
function _aeCertsAdd(name, pem)   { const m = _aeCertsLoad(); m[name] = pem; _aeCertsSave(m); }
function _aeCertsDelete(name)     { const m = _aeCertsLoad(); delete m[name]; _aeCertsSave(m); }

// ── Backward-compat broker URL parser ────────────────────────────────────────
function _aeParsesBrokerUrl(broker) {
  try {
    const u = new URL(broker);
    const type = u.protocol.replace(':', '');
    return {
      connectionType: type,
      host: u.hostname || '',
      port: u.port ? parseInt(u.port, 10) : (_AE_MQTT_PORT_DEFAULTS[type] || 1883),
    };
  } catch(e) {
    return { connectionType: 'ws', host: broker || '', port: 9001 };
  }
}

let AE_FULL        = null;  // { mqtt, actions, collections } — loaded from API
let AE_LOCAL       = null;  // working copy — mutated by editor
let AE_UNSAVED     = false;
let AE_TAB         = 'mqtt';   // 'mqtt' | 'actions' | 'collections'
let AE_OPEN_DRAWER = null;          // action id or group id currently open
let AE_OPEN_DRAWER_IS_NEW = false;  // true if the open drawer is for a newly added (unsaved) entry
let AE_DRAWER_DIRTY = false;        // true if any form field has been modified since drawer opened

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
    const empty = { mqtt: { servers: [] }, actions: [], collections: [] };
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

  try {
    renderActionsEditor();
  } catch(e) {
    console.error('Actions editor: render failed', e);
    const c = document.getElementById('ae-content');
    if (c) c.innerHTML = `<div style="padding:40px 0;text-align:center;font-family:'Courier New',monospace;font-size:10px;color:rgba(248,113,113,0.8)">Render error — see browser console</div>`;
  }
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
    { id: 'mqtt',        label: 'MQTT' },
    { id: 'actions',     label: 'Actions' },
    { id: 'collections', label: 'Collections' },
  ];
  const tabNav = tabs.map(t =>
    `<button class="ae-tab-btn${AE_TAB === t.id ? ' active' : ''}" onclick="switchAeTab('${t.id}')">${t.label}</button>`
  ).join('');

  let tabContent = '';
  if (AE_TAB === 'mqtt')        tabContent = _buildAeMqttTab();
  if (AE_TAB === 'actions')     tabContent = _buildAeActionsTab();
  if (AE_TAB === 'collections') tabContent = _buildAeCollectionsTab();

  const bannerHtml = AE_UNSAVED ? _buildAeBanner() : '';

  const addActionBtn = AE_TAB === 'actions'
    ? `<button class="cam-add-btn" style="margin-left:auto" onclick="addAeAction()">+ Add Action</button>`
    : AE_TAB === 'mqtt'
    ? `<button class="cam-add-btn" style="margin-left:auto" onclick="addAeSrv()">+ Add Server</button>`
    : AE_TAB === 'collections'
    ? `<button class="cam-add-btn" style="margin-left:auto" onclick="addAeCollection()">+ Add Collection</button>`
    : '';

  const aeSubtabDesc = {
    mqtt:        'Connect to MQTT brokers for event messaging. Brokers configured here can be used as triggers and targets in actions.',
    actions:     'Actions can be triggered by users on any view or panel — navigate views or publish MQTT commands.',
    collections: 'Bundle actions into a named collection — displayed as a pop-up menu users can trigger from any view.',
  };
  const subtabDescHtml = `<p style="color:rgba(255,255,255,0.4);font-size:11px;margin:6px 0 16px">${aeSubtabDesc[AE_TAB] || ''}</p>`;

  container.innerHTML = `
    <div class="ae-tab-nav" style="width:100%;max-width:900px;display:flex;align-items:center">${tabNav}${addActionBtn}</div>
    ${subtabDescHtml}
    <div id="ae-tab-content" class="ae-tab-body" style="width:100%;max-width:900px">${tabContent}</div>
    ${bannerHtml}`;

  if (AE_TAB === 'mqtt')        _initAeSrvDrag();
  if (AE_TAB === 'actions')     _initAeActionDrag();
  if (AE_TAB === 'collections') _initAeCollectionDrag();
}

function switchAeTab(tab) {
  AE_TAB         = tab;
  AE_OPEN_DRAWER = null;
  AE_DRAWER_DIRTY = false;
  const aeTabDescriptions = {
    mqtt:        'MQTT — connect to brokers for event messaging.',
    actions:     'Actions — map MQTT triggers to kiosk commands.',
    collections: 'Collections — organize cameras into logical collections.',
  };
  if (typeof setSettingsFooter === 'function') setSettingsFooter(aeTabDescriptions[tab] || '');
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
}

// ── MQTT Tab ─────────────────────────────────────────────────────────────────

function _buildAeMqttTab() {
  const servers = (AE_LOCAL && AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers) || [];
  if (servers.length === 0) {
    return `<div style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.3);padding:32px 0;text-align:center">
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
      <td style="font-family:'Courier New',monospace;font-size:13px;color:rgba(255,255,255,0.5)">${_aeEsc(id)}</td>
      <td style="font-family:'Courier New',monospace;font-size:13px;color:rgba(255,255,255,0.4)">${_aeEsc(srv.broker || '')}</td>
      <td style="text-align:right;white-space:nowrap">
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <div style="display:flex;gap:4px;align-items:center">
            <button class="perf-reset" onclick="aeConnectServer('${esc}')" style="font-size:9px;padding:2px 6px" title="Connect">Connect</button>
            <button class="perf-reset" onclick="aeDisconnectServer('${esc}')" style="font-size:9px;padding:2px 6px" title="Disconnect">Disconnect</button>
            <button class="sp-btn" onclick="openAeSrvDrawer('${esc}')" title="Edit">✎</button>
            <button class="sp-btn" onclick="deleteAeSrv('${esc}')" title="Delete" style="color:rgba(248,113,113,0.6);border-color:rgba(248,113,113,0.2)">✕</button>
          </div>
          <div id="ae-srv-status-${esc}" style="font-size:9px;font-family:'Courier New',monospace">${_aeServerStatusHtml(id)}</div>
        </div>
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

  return `<table class="streams-table" style="width:100%">
    <thead><tr>
      <th></th><th>Name</th><th>Broker</th><th></th>
    </tr></thead>
    <tbody id="ae-srv-tbody">${rows}</tbody>
  </table>`;
}

function _buildAeSrvDrawerForm(srv, isNew) {
  const id       = srv.id || '';
  const username = srv.username || '';
  const password = srv.password || '';

  // Resolve structured fields — parse legacy broker URL if needed
  let connectionType = srv.connectionType || '';
  let host = srv.host || '';
  let port = srv.port || '';
  if (srv.broker && (!srv.connectionType || !srv.host)) {
    const parsed = _aeParsesBrokerUrl(srv.broker);
    if (!connectionType) connectionType = parsed.connectionType;
    if (!host) host = parsed.host;
    if (!port) port = parsed.port;
  }
  if (!connectionType) connectionType = 'ws';
  if (!port) port = _AE_MQTT_PORT_DEFAULTS[connectionType] || 9001;
  const tls = srv.tls || {};
  const basepath = srv.basepath || '';
  const showTls = connectionType === 'wss';
  const autoConnect = srv.autoConnect !== undefined ? srv.autoConnect : true;
  const discoveryTopic = srv.discoveryTopic || '';

  const connTypeOpts = ['ws', 'wss'].map(t =>
    `<option value="${t}"${t === connectionType ? ' selected' : ''}>${t}</option>`
  ).join('');

  return `<div class="cam-form-grid">
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Name</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-srv-id" value="${_aeEsc(id)}" placeholder="home">
        <div class="cam-field-error" id="ae-err-srv-id"></div>
      </div>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Connection Type</label>
      <select class="views-input" id="ae-field-srv-conntype" onchange="aeOnConnTypeChange()" style="flex:none;width:auto">${connTypeOpts}</select>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Host</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-srv-host" value="${_aeEsc(host)}" placeholder="localhost">
        <div class="cam-field-error" id="ae-err-srv-host"></div>
      </div>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Port</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-srv-port" type="number" min="1" max="65535" value="${_aeEsc(port)}">
        <div class="cam-field-error" id="ae-err-srv-port"></div>
      </div>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Basepath</label>
      <input class="views-input" id="ae-field-srv-basepath" value="${_aeEsc(basepath)}" placeholder="e.g. mqtt (optional)">
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Username</label>
      <input class="views-input" id="ae-field-srv-username" value="${_aeEsc(username)}" placeholder="optional">
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Password</label>
      <input class="views-input" type="password" id="ae-field-srv-password" value="${_aeEsc(password)}" placeholder="optional">
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Auto Connect</label>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="ae-field-srv-autoconnect"${autoConnect !== false ? ' checked' : ''}>
      </label>
    </div>
    <div id="ae-tls-section" style="display:${showTls ? 'contents' : 'none'}">
      <div class="views-form-row">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Trust Broker Cert</label>
        <div style="display:flex;flex-direction:column;gap:4px;flex:1">
          <button class="perf-reset" onclick="aeTrustBrokerCert()">Open in new tab</button>
          <div style="font-size:9px;color:rgba(255,255,255,0.25)">If using a self-signed cert, open the broker URL in a new tab and accept the browser warning before connecting.</div>
        </div>
      </div>
      <div class="views-form-row">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">CA Certificate</label>
        <select id="ae-field-srv-ca" class="views-input" style="flex:1">
          <option value="">— none —</option>
          ${_aeCertsList().map(f => `<option value="${_aeEsc(f)}"${tls.caFile===f?' selected':''}>${_aeEsc(f)}</option>`).join('')}
        </select>
      </div>
      <div class="views-form-row">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Client Certificate</label>
        <select id="ae-field-srv-cert" class="views-input" style="flex:1">
          <option value="">— none —</option>
          ${_aeCertsList().map(f => `<option value="${_aeEsc(f)}"${tls.certFile===f?' selected':''}>${_aeEsc(f)}</option>`).join('')}
        </select>
      </div>
      <div class="views-form-row">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Client Key</label>
        <select id="ae-field-srv-key" class="views-input" style="flex:1">
          <option value="">— none —</option>
          ${_aeCertsList().map(f => `<option value="${_aeEsc(f)}"${tls.keyFile===f?' selected':''}>${_aeEsc(f)}</option>`).join('')}
        </select>
      </div>
      <div class="views-form-row" style="flex-direction:column;gap:6px">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Stored Certs</label>
        <div id="ae-cert-files-list">${_aeBuildCertList()}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="file" id="ae-cert-file-input" accept=".crt,.pem,.key,.cer,.p12,.pfx,.der,.p7b,.p7c,.ca-bundle" multiple style="font-size:10px;flex:1">
          <button class="perf-reset" onclick="aeUploadCert()">Upload</button>
        </div>
        <div id="ae-cert-upload-status" style="font-size:9px;font-family:'Courier New',monospace"></div>
        <div style="font-size:9px;color:rgba(255,255,255,0.25)">Certs are stored in your browser (localStorage)</div>
        <div style="font-size:9px;color:rgba(255,255,255,0.25)">Supported: .crt, .pem, .key, .cer, .p12, .pfx, .der, .p7b, .p7c, .ca-bundle</div>
      </div>
    </div>
    <div style="font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin:4px 0 -4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">Discovery (optional)</div>
    <div style="font-size:9px;color:rgba(255,255,255,0.25);font-family:'Courier New',monospace;margin-bottom:6px">Subscribe to this topic prefix to auto-register actions from retained MQTT messages. Listens on &lt;topic&gt;/+</div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Discovery Topic</label>
      <input class="views-input" id="ae-field-srv-discovery-topic" value="${_aeEsc(discoveryTopic)}" placeholder="kiosk/discovery">
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
  AE_OPEN_DRAWER_IS_NEW = isNew;
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
  const idEl         = document.getElementById('ae-field-srv-id');
  const connTypeEl   = document.getElementById('ae-field-srv-conntype');
  const hostEl       = document.getElementById('ae-field-srv-host');
  const portEl       = document.getElementById('ae-field-srv-port');
  const caEl         = document.getElementById('ae-field-srv-ca');
  const certEl       = document.getElementById('ae-field-srv-cert');
  const keyEl        = document.getElementById('ae-field-srv-key');

  const newId           = idEl       ? idEl.value.trim()                   : originalId;
  const connectionType  = connTypeEl ? connTypeEl.value                    : 'ws';
  const host            = hostEl     ? hostEl.value.trim()                 : '';
  const portRaw         = portEl     ? parseInt(portEl.value, 10)          : NaN;
  const username        = (document.getElementById('ae-field-srv-username') || {}).value || '';
  const password        = (document.getElementById('ae-field-srv-password') || {}).value || '';
  const caFile          = caEl       ? caEl.value                          : '';
  const certFile        = certEl     ? certEl.value                        : '';
  const keyFile         = keyEl      ? keyEl.value                        : '';
  const autoConnectEl   = document.getElementById('ae-field-srv-autoconnect');
  const autoConnect     = autoConnectEl ? autoConnectEl.checked : true;
  let basepath          = (document.getElementById('ae-field-srv-basepath') || {}).value?.trim() || '';
  if (basepath && !basepath.startsWith('/')) basepath = '/' + basepath;
  const discoveryTopic  = (document.getElementById('ae-field-srv-discovery-topic') || {}).value?.trim() || '';

  let valid = true;

  const errId = document.getElementById('ae-err-srv-id');
  if (!newId) {
    if (errId) errId.textContent = 'Name is required';
    valid = false;
  } else if (newId !== originalId && (AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers || []).find(s => s.id === newId)) {
    if (errId) errId.textContent = 'Name already exists';
    valid = false;
  } else {
    if (errId) errId.textContent = '';
  }

  const errHost = document.getElementById('ae-err-srv-host');
  if (!host) {
    if (errHost) errHost.textContent = 'Host is required';
    valid = false;
  } else {
    if (errHost) errHost.textContent = '';
  }

  const errPort = document.getElementById('ae-err-srv-port');
  if (isNaN(portRaw) || portRaw < 1 || portRaw > 65535) {
    if (errPort) errPort.textContent = 'Port must be 1–65535';
    valid = false;
  } else {
    if (errPort) errPort.textContent = '';
  }

  if (!valid) return;

  // Derive broker URL from structured fields (no /mqtt path — appended at connect time)
  const broker = `${connectionType}://${host}:${portRaw}`;

  // Cascade-update action.mqttServer references if id changed
  if (newId !== originalId) {
    (AE_LOCAL.actions || []).forEach(a => {
      if (a.mqttServer === originalId) a.mqttServer = newId;
    });
  }

  const updated = {
    id: newId,
    connectionType,
    host,
    port: portRaw,
    broker,
    autoConnect,
    ...(basepath ? { basepath } : {}),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(caFile || certFile || keyFile ? { tls: { caFile, certFile, keyFile } } : {}),
    ...(discoveryTopic ? { discoveryTopic } : {}),
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

  // Connection management: if previously active, disconnect and restart;
  // if autoConnect is enabled and not yet connected, initiate connection.
  if (typeof _mqttClients !== 'undefined') {
    const wasActive = _mqttClients.has(originalId) || (newId !== originalId && _mqttClients.has(newId));
    // If ID changed, clean up old client keyed by old ID
    if (newId !== originalId && _mqttClients.has(originalId)) {
      disconnectMqttClient(originalId);
    }
    if (wasActive) {
      disconnectMqttClient(newId);
      getOrCreateMqttClient(newId, updated);
    } else if (autoConnect) {
      getOrCreateMqttClient(newId, updated);
    }
  }

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
  const idInput = document.getElementById('ae-field-srv-id');
  if (idInput) { idInput.focus(); idInput.select(); }
}

function aeTrustBrokerCert() {
  const hostEl = document.getElementById('ae-field-srv-host');
  const host = (hostEl || {}).value || '';
  const port = (document.getElementById('ae-field-srv-port') || {}).value || '';
  if (!host) {
    const errHost = document.getElementById('ae-err-srv-host');
    if (errHost) errHost.textContent = 'Host is required';
    return;
  }
  window.open(`https://${host}:${port}`, '_blank');
}

// ── Connection type change handler ───────────────────────────────────────────

function aeOnConnTypeChange() {
  const typeEl = document.getElementById('ae-field-srv-conntype');
  const portEl = document.getElementById('ae-field-srv-port');
  const tlsEl  = document.getElementById('ae-tls-section');
  if (!typeEl) return;
  const type = typeEl.value;
  if (portEl) {
    const cur = parseInt(portEl.value, 10);
    const isKnownDefault = Object.values(_AE_MQTT_PORT_DEFAULTS).includes(cur);
    if (isKnownDefault) portEl.value = _AE_MQTT_PORT_DEFAULTS[type] || 1883;
  }
  if (tlsEl) tlsEl.style.display = (type === 'wss') ? 'contents' : 'none';
}

// ── Cert UI helpers ───────────────────────────────────────────────────────────

function _aeBuildCertList() {
  const files = _aeCertsList();
  if (!files.length) return '<span style="font-size:9px;color:rgba(255,255,255,0.25)">No certs stored</span>';
  return files.map(f =>
    `<div style="display:flex;align-items:center;gap:6px;font-family:'Courier New',monospace;font-size:9px">
      <span style="flex:1">${_aeEsc(f)}</span>
      <button class="perf-reset" style="font-size:9px;padding:1px 5px" onclick="aeDeleteCert('${_aeEsc(f)}')">✕</button>
    </div>`
  ).join('');
}

function aeUploadCert() {
  const input    = document.getElementById('ae-cert-file-input');
  const statusEl = document.getElementById('ae-cert-upload-status');
  if (!input || !input.files || !input.files.length) {
    if (statusEl) statusEl.innerHTML = '<span style="color:rgba(248,113,113,0.9)">No file selected</span>';
    return;
  }
  const files = Array.from(input.files);
  const saved = [];
  const errors = [];
  let pending = files.length;
  const finish = () => {
    _aeRefreshCertUI();
    input.value = '';
    if (!statusEl) return;
    const parts = [];
    if (saved.length) {
      const label = saved.length <= 3 ? saved.map(n => _aeEsc(n)).join(', ') : `${saved.length} files`;
      parts.push(`<span style="color:rgba(74,222,128,0.9)">Saved: ${label}</span>`);
    }
    if (errors.length) {
      parts.push(`<span style="color:rgba(248,113,113,0.9)">Failed: ${errors.map(n => _aeEsc(n)).join(', ')}</span>`);
    }
    statusEl.innerHTML = parts.join(' ');
  };
  files.forEach(file => {
    const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        _aeCertsAdd(name, e.target.result);
        saved.push(name);
      } catch(err) {
        errors.push(name);
      }
      if (--pending === 0) finish();
    };
    reader.onerror = () => {
      errors.push(name);
      if (--pending === 0) finish();
    };
    reader.readAsText(file);
  });
}

function aeDeleteCert(name) {
  _aeCertsDelete(name);
  _aeRefreshCertUI();
}

function _aeRefreshCertUI() {
  const listEl = document.getElementById('ae-cert-files-list');
  if (listEl) listEl.innerHTML = _aeBuildCertList();
  for (const [id, field] of [['ae-field-srv-ca','caFile'],['ae-field-srv-cert','certFile'],['ae-field-srv-key','keyFile']]) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const cur = sel.value;
    sel.innerHTML = `<option value="">— none —</option>` +
      _aeCertsList().map(f => `<option value="${_aeEsc(f)}"${f===cur?' selected':''}>${_aeEsc(f)}</option>`).join('');
  }
}

// ── Disconnect server ─────────────────────────────────────────────────────────

function _aeServerStatusHtml(serverId) {
  if (typeof _mqttClients === 'undefined') return '<span style="color:rgba(255,255,255,0.2)">● unknown</span>';
  const client = _mqttClients.get(serverId);
  if (!client) return '<span style="color:rgba(248,113,113,0.5)">● disconnected</span>';
  if (client.connected) return '<span style="color:rgba(74,222,128,0.6)">● connected</span>';
  return '<span style="color:rgba(251,191,36,0.6)">● connecting</span>';
}

function aeConnectServer(serverId) {
  const servers = (AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers) || [];
  const cfg = servers.find(s => s.id === serverId);
  if (!cfg) return;
  getOrCreateMqttClient(serverId, cfg);
  // Re-render after a short delay to show updated status
  setTimeout(() => {
    const container = document.getElementById('ae-tabs-and-content');
    if (container) _renderAeTabsInto(container);
  }, 300);
}

function aeDisconnectServer(id) {
  disconnectMqttClient(id);
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
      <td style="font-family:'Courier New',monospace;font-size:13px;color:rgba(255,255,255,0.5)">${_aeEsc(action.name)}</td>
      <td style="font-size:11px">${_aeEsc(action.description || '')}</td>
      <td>${badge}</td>
    </tr>`;
  }).join('');

  const builtinSection = `
    <div style="font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:8px">Built-in Actions</div>
    <table class="streams-table" style="width:100%;margin-bottom:20px">
      <thead><tr><th>Icon</th><th>Name</th><th>Description</th><th>Note</th></tr></thead>
      <tbody>${builtinRows}</tbody>
    </table>`;

  if (actions.length === 0) {
    return builtinSection + `<div style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.3);padding:32px 0;text-align:center">
      NO ACTIONS CONFIGURED<br><span style="margin-top:6px;display:block">Use + Add Action above</span>
    </div>`;
  }

  let rows = '';
  actions.forEach(action => {
    const id  = action.name || '';
    const esc = _aeEsc(id);
    const iconHtml = action.icon ? _renderIcon(action.icon) : '';
    const publishSummary = action.type === 'focus-stream'
      ? `focus (${action.timeout > 0 ? action.timeout + 's' : 'manual close'})`
      : (action.publish ? `${_aeEsc(action.publish.topic)} → ${_aeEsc(action.publish.payload)}` : '—');
    const isOpen = AE_OPEN_DRAWER === id;

    rows += `<tr id="ae-action-row-${esc}" style="cursor:pointer" onclick="(function(e){if(!e.target.closest('button'))openAeActionDrawer('${esc}')})(event)">
      <td class="cam-drag-handle" style="width:32px">≡</td>
      <td style="font-family:'Courier New',monospace;font-size:13px;color:rgba(255,255,255,0.5)">${_aeEsc(id)}</td>
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

  // Append discovered action rows into the main table (read-only, no edit/delete controls)
  const discoveredEntries = Object.values(ACTIONS).filter(a => !_STATIC_ACTIONS.has(a.name) && !BUILTIN_ACTIONS[a.name]);
  const discoveredRows = discoveredEntries.map(action => {
    const iconHtml = action.icon ? _renderIcon(action.icon) : '';
    const publishSummary = action.type === 'focus-stream'
      ? `focus (${action.timeout > 0 ? action.timeout + 's' : 'manual close'})`
      : (action.publish ? `${_aeEsc(action.publish.topic)} → ${_aeEsc(action.publish.payload)}` : '—');
    return `<tr>
      <td style="width:32px"></td>
      <td style="font-family:'Courier New',monospace;font-size:13px;color:rgba(255,255,255,0.5)">${_aeEsc(action.name)}<span class="action-discovered-badge">discovered</span></td>
      <td style="font-size:11px">${_aeEsc(action.description || '')}</td>
      <td style="font-size:18px;padding:6px 10px">${iconHtml}</td>
      <td style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.4);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${publishSummary}</td>
      <td></td>
    </tr>`;
  }).join('');

  return builtinSection + `<table class="streams-table" style="width:100%">
    <thead><tr>
      <th></th><th>Name</th><th>Description</th><th>Icon</th><th>Publish</th><th></th>
    </tr></thead>
    <tbody id="ae-actions-tbody">${rows}${discoveredRows}</tbody>
  </table>`;
}

function _aeStateHtml(action) {
  if (!action.state || !action.state.topic) return '';
  const topic = action.state.topic;
  const onVal = action.state.onValue || '';
  const cur   = ACTION_STATES[topic];
  if (cur === undefined) return '<span style="color:rgba(255,255,255,0.2);font-size:9px">●</span>';
  const isOn = cur === onVal;
  const col = isOn ? 'rgba(74,222,128,0.7)' : 'rgba(248,113,113,0.6)';
  return `<span style="color:${col};font-size:9px">● ${_aeEsc(cur)}</span>`;
}

function _refreshAeStateCells() {
  const actions = (AE_LOCAL && AE_LOCAL.actions) || [];
  actions.forEach(action => {
    if (action.type !== 'mqtt' || !action.state || !action.state.topic) return;
    const cell = document.getElementById('ae-action-state-' + _aeEsc(action.name || ''));
    if (cell) cell.innerHTML = _aeStateHtml(action);
  });
}

function _buildAeBuiltinTriggerDrawer(builtinAction, cfgEntry) {
  const trigger      = (cfgEntry && cfgEntry.trigger) || {};
  const tMqttServer  = trigger.mqttServer || '';
  const tTopic       = trigger.topic      || '';
  const tPayload     = trigger.payload    || '';
  const id  = builtinAction.name;
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
  AE_LOCAL.actions = AE_LOCAL.actions.filter(a => a.name !== id);

  // If topic is set, add an entry carrying just the trigger
  if (tTopic) {
    AE_LOCAL.actions.push({
      name: id,
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

function _buildAeActionDrawerForm(action, isNew) {
  const id     = action.name || '';
  const desc   = action.description || '';
  const icon   = action.icon || '';
  const type       = action.type || 'mqtt';
  const mqttServer = action.mqttServer || '';
  const pTopic = (action.publish && action.publish.topic) || '';
  const pPay   = (action.publish && action.publish.payload) || '';
  const sTopic = (action.state && action.state.topic) || '';
  const sOnVal = (action.state && action.state.onValue) || '';
  const focusAuto = !!(action.timeout && action.timeout > 0);
  const focusTimeout = focusAuto ? action.timeout : 30;
  const focusSamePanel = !(typeof action.panel === 'number' && action.panel >= 0 && action.panel <= 7);
  const focusStreamVal  = focusSamePanel ? '' : String(action.panel);
  const iconPreviewId = `ae-icon-preview-${_aeEsc(id)}`;
  return `<div class="cam-form-grid">
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Type</label>
      <select class="views-input" id="ae-field-type" style="flex:none;width:auto" onchange="_aeTypeChanged(this.value)">
        <option value="mqtt"${type === 'mqtt' ? ' selected' : ''}>mqtt</option>
        <option value="focus-stream"${type === 'focus-stream' ? ' selected' : ''}>focus-stream</option>
      </select>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Name</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-id" value="${_aeEsc(id)}" placeholder="my-action">
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

    <div id="ae-mqtt-fields" style="${type === 'focus-stream' ? 'display:none' : ''}">
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
      <div style="font-size:9px;color:rgba(255,255,255,0.25);font-family:'Courier New',monospace;margin-bottom:6px">The MQTT message sent when this action is triggered.</div>
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
      <div style="font-size:9px;color:rgba(255,255,255,0.25);font-family:'Courier New',monospace;margin-bottom:6px">Subscribe to a topic to reflect this action's current on/off state in the UI.</div>
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

    <div id="ae-focus-fields" style="${type === 'focus-stream' ? '' : 'display:none'}">
      <div style="font-size:9px;color:rgba(255,255,255,0.25);font-family:'Courier New',monospace;margin-bottom:6px">Displays a panel overlay in the kiosk view. Useful for interstitial messages or confirmation screens.</div>
      <div class="views-form-row" style="margin-top:8px">
        <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Focus panel</label>
        <div style="display:flex;flex-direction:column;gap:6px">
          <select class="views-input" id="ae-focus-stream-select" style="width:auto;flex:none">
            <option value="">Same Panel</option>
            ${[0,1,2,3,4,5,6,7].map(i => `<option value="${i}"${focusStreamVal === String(i) ? ' selected' : ''}>Stream ${i+1}</option>`).join('')}
          </select>
        </div>
      </div>
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
  const action = (AE_LOCAL.actions || []).find(a => a.name === id);
  if (!action) return;
  const inner = document.getElementById(`ae-action-drawer-inner-${id}`);
  if (!inner) return;
  const isNew = !AE_FULL || !(AE_FULL.actions || []).find(a => a.name === id);
  AE_OPEN_DRAWER_IS_NEW = isNew;
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
                   document.getElementById(`ae-collection-drawer-${AE_OPEN_DRAWER}`) ||
                   document.getElementById(`ae-srv-drawer-${AE_OPEN_DRAWER}`);
  const rowEl    = document.getElementById(`ae-action-row-${AE_OPEN_DRAWER}`) ||
                   document.getElementById(`ae-collection-row-${AE_OPEN_DRAWER}`) ||
                   document.getElementById(`ae-srv-row-${AE_OPEN_DRAWER}`);
  if (drawerEl) drawerEl.style.maxHeight = '0';
  if (rowEl) rowEl.classList.remove('cam-row-active');
  if (AE_OPEN_DRAWER_IS_NEW && !AE_DRAWER_DIRTY) {
    const removedId = AE_OPEN_DRAWER;
    AE_OPEN_DRAWER = null;
    AE_OPEN_DRAWER_IS_NEW = false;
    AE_DRAWER_DIRTY = false;
    if (AE_LOCAL.mqtt && AE_LOCAL.mqtt.servers) {
      AE_LOCAL.mqtt.servers = AE_LOCAL.mqtt.servers.filter(s => s.id !== removedId);
    }
    AE_LOCAL.actions     = (AE_LOCAL.actions     || []).filter(a => a.name !== removedId);
    AE_LOCAL.collections = (AE_LOCAL.collections || []).filter(g => g.id !== removedId);
    const container = document.getElementById('ae-tabs-and-content');
    if (container) _renderAeTabsInto(container);
    return;
  }
  AE_OPEN_DRAWER = null;
  AE_OPEN_DRAWER_IS_NEW = false;
  AE_DRAWER_DIRTY = false;
}

function _aeTypeChanged(type) {
  const focusFields = document.getElementById('ae-focus-fields');
  const mqttFields = document.getElementById('ae-mqtt-fields');
  if (focusFields) focusFields.style.display = type === 'focus-stream' ? '' : 'none';
  if (mqttFields) mqttFields.style.display = type === 'focus-stream' ? 'none' : '';
  if (type === 'focus-stream') _aeFocusRadioChanged();
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
  const sTopic     = (document.getElementById('ae-field-state-topic')     || {}).value.trim();
  const sOnVal     = (document.getElementById('ae-field-state-onvalue')   || {}).value.trim();
  const type       = (document.getElementById('ae-field-type')             || {}).value || 'mqtt';
  const mqttServer = (document.getElementById('ae-field-mqttserver')    || {}).value || '';

  let valid = true;

  const errId = document.getElementById('ae-err-id');
  if (!newId) {
    if (errId) errId.textContent = 'Name is required';
    valid = false;
  } else if (newId !== originalId && (AE_LOCAL.actions || []).find(a => a.name === newId)) {
    if (errId) errId.textContent = 'Name already exists';
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
  let focusStreamSaved = null;
  if (type === 'focus-stream') {
    const autoClose = !!(document.getElementById('ae-focus-auto') && document.getElementById('ae-focus-auto').checked);
    timeout = autoClose ? (parseInt((document.getElementById('ae-focus-timeout') || {}).value, 10) || 30) : 0;
    const panelSel = document.getElementById('ae-focus-stream-select');
    if (panelSel && panelSel.value !== '') {
      focusStreamSaved = parseInt(panelSel.value, 10);
    }
  }

  if (!valid) return;

  const updated = {
    name: newId,
    type,
    description: newDesc,
    ...(icon ? { icon } : {}),
    ...(type === 'mqtt' && mqttServer ? { mqttServer } : {}),
    ...(type === 'mqtt' ? { publish: { topic: pTopic, payload: pPayload } } : {}),
    ...(type === 'mqtt' && sTopic ? { state: { topic: sTopic, ...(sOnVal ? { onValue: sOnVal } : {}) } } : {}),
    ...(type === 'focus-stream' && timeout > 0 ? { timeout } : {}),
    ...(type === 'focus-stream' && typeof focusStreamSaved === 'number' ? { panel: focusStreamSaved } : {}),
  };

  const idx = (AE_LOCAL.actions || []).findIndex(a => a.name === originalId);
  if (idx >= 0) {
    AE_LOCAL.actions[idx] = updated;
  } else {
    AE_LOCAL.actions.push(updated);
  }

  // Update collection references if id changed
  if (newId !== originalId) {
    (AE_LOCAL.collections || []).forEach(g => {
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
  const action = (AE_LOCAL.actions || []).find(a => a.name === id);
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
  AE_LOCAL.actions = (AE_LOCAL.actions || []).filter(a => a.name !== id);
  // Remove from all collections
  (AE_LOCAL.collections || []).forEach(g => {
    if (Array.isArray(g.actions)) g.actions = g.actions.filter(aid => aid !== id);
  });
  if (AE_OPEN_DRAWER === id) AE_OPEN_DRAWER = null;
  // Clean up dangling slotCollections references in views
  (VIEWS || []).forEach(v => {
    if (!Array.isArray(v.slotCollections)) return;
    v.slotCollections = v.slotCollections.map(sg => sg === id ? null : sg);
  });
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  applyAeChanges();
  _persistViews();
}

function addAeAction() {
  if (!AE_LOCAL.actions) AE_LOCAL.actions = [];
  let n = 1;
  while (AE_LOCAL.actions.find(a => a.name === `new-action-${n}`)) n++;
  const newAction = { name: `new-action-${n}`, type: 'mqtt', description: '', publish: { topic: '', payload: '' } };
  AE_LOCAL.actions.push(newAction);
  AE_OPEN_DRAWER = newAction.name;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  const idInput = document.getElementById('ae-field-id');
  if (idInput) { idInput.focus(); idInput.select(); }
}

// ── Collections Tab ───────────────────────────────────────────────────────────

function _buildAeCollectionsTab() {
  const collections = (AE_LOCAL && AE_LOCAL.collections) || [];
  if (collections.length === 0) {
    return `<div style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.3);padding:32px 0;text-align:center">
      NO COLLECTIONS CONFIGURED<br><span style="margin-top:6px;display:block">Use + Add Collection above</span>
    </div>`;
  }

  let rows = '';
  collections.forEach(collection => {
    const id  = collection.id || '';
    const esc = _aeEsc(id);
    const actionCount = (collection.actions || []).length;
    const isOpen = AE_OPEN_DRAWER === id;

    rows += `<tr id="ae-collection-row-${esc}" style="cursor:pointer" onclick="(function(e){if(!e.target.closest('button'))openAeCollectionDrawer('${esc}')})(event)">
      <td class="cam-drag-handle" style="width:32px">≡</td>
      <td style="font-family:'Courier New',monospace;font-size:13px;color:rgba(255,255,255,0.5)">${_aeEsc(id)}</td>
      <td style="font-size:11px">${_aeEsc(collection.description || '')}</td>
      <td style="font-family:'Courier New',monospace;font-size:13px;color:rgba(255,255,255,0.4)">${actionCount} action${actionCount !== 1 ? 's' : ''}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="sp-btn" onclick="openAeCollectionDrawer('${esc}')" title="Edit">✎</button>
        <button class="sp-btn" onclick="deleteAeCollection('${esc}')" title="Delete" style="color:rgba(248,113,113,0.6);border-color:rgba(248,113,113,0.2)">✕</button>
      </td>
    </tr>
    <tr id="ae-collection-drawer-row-${esc}">
      <td colspan="5" style="padding:0;border:none">
        <div class="cam-drawer" id="ae-collection-drawer-${esc}" style="${isOpen ? 'max-height:9999px' : ''}">
          <div class="cam-drawer-inner" id="ae-collection-drawer-inner-${esc}">${isOpen ? _buildAeCollectionDrawerForm(collection, false) : ''}</div>
        </div>
      </td>
    </tr>`;
  });

  return `<table class="streams-table" style="width:100%">
    <thead><tr>
      <th></th><th>Name</th><th>Description</th><th>Actions</th><th></th>
    </tr></thead>
    <tbody id="ae-collections-tbody">${rows}</tbody>
  </table>`;
}

function _buildAeCollectionDrawerForm(collection, isNew) {
  const id      = collection.id || '';
  const description = collection.description || '';
  const slots   = (collection.actions || []).slice(0, 6);
  const numSlots = Math.min(slots.length + 1, 6); // show one extra empty slot unless at max
  const typeOrder = a => a.type === 'builtin' ? 0 : a.type === 'focus-stream' ? 1 : 2;
  const sortedActions = Object.values(ACTIONS).sort((a, b) => typeOrder(a) - typeOrder(b));

  let slotsHtml = '';
  for (let i = 0; i < numSlots; i++) {
    const val = slots[i] || '';
    slotsHtml += `<div class="views-form-row" id="ae-slot-row-${i}" style="align-items:center">
      <span class="cam-drag-handle" style="margin-right:6px;flex-shrink:0;cursor:grab">≡</span>
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Button ${i + 1}</label>
      <select class="views-input" id="ae-slot-${i}" style="flex:none;width:auto">
        <option value="">— none —</option>
        ${sortedActions.map(a => `<option value="${_aeEsc(a.name)}"${a.name===val?' selected':''}>${_aeEsc(a.name)}</option>`).join('')}
      </select>
    </div>`;
  }

  const addSlotBtn = numSlots < 6
    ? `<button class="perf-reset" id="ae-add-slot-btn" onclick="_aeAddSlot(${numSlots})" style="align-self:flex-start;margin-top:4px">+ Add Button</button>`
    : '';

  return `<div class="cam-form-grid">
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Name</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-collection-id" value="${_aeEsc(id)}" placeholder="my-collection">
        <div class="cam-field-error" id="ae-err-collection-id"></div>
      </div>
    </div>
    <div class="views-form-row">
      <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Description</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="views-input" id="ae-field-collection-description" value="${_aeEsc(description)}" placeholder="Living Room">
        <div class="cam-field-error" id="ae-err-collection-description"></div>
      </div>
    </div>

    <div style="font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin:4px 0 -4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">Action Slots</div>
    <div style="font-size:9px;color:rgba(255,255,255,0.25);font-family:'Courier New',monospace;margin-bottom:6px">Assign actions to each button slot. Slots appear left-to-right in the overlay button bar. Leave a slot empty to hide it.</div>
    <div id="ae-slots-container" style="display:flex;flex-direction:column;gap:10px">
      ${slotsHtml}
      ${addSlotBtn}
    </div>
  </div>
  <div class="cam-drawer-footer">
    <button class="perf-reset" onclick="closeAeDrawer()">Cancel</button>
    <button class="cam-save-btn" onclick="saveAeCollectionDrawer('${_aeEsc(id)}', ${isNew})">Save</button>
  </div>`;
}

function _aeAddSlot(currentCount) {
  if (currentCount >= 6) return;
  const container = document.getElementById('ae-slots-container');
  if (!container) return;

  const addBtn = document.getElementById('ae-add-slot-btn');
  const slotRow = document.createElement('div');
  slotRow.className = 'views-form-row';
  slotRow.id = `ae-slot-row-${currentCount}`;
  const typeOrderAdd = a => a.type === 'builtin' ? 0 : a.type === 'focus-stream' ? 1 : 2;
  const sortedActionsAdd = Object.values(ACTIONS).sort((a, b) => typeOrderAdd(a) - typeOrderAdd(b));
  slotRow.style.alignItems = 'center';
  slotRow.innerHTML = `
    <span class="cam-drag-handle" style="margin-right:6px;flex-shrink:0;cursor:grab">≡</span>
    <label style="width:140px;flex-shrink:0;font-size:10px;letter-spacing:0.1em;color:rgba(255,255,255,0.4)">Button ${currentCount + 1}</label>
    <select class="views-input" id="ae-slot-${currentCount}" style="flex:none;width:auto">
      <option value="">— none —</option>
      ${sortedActionsAdd.map(a => `<option value="${_aeEsc(a.name)}">${_aeEsc(a.name)}</option>`).join('')}
    </select>`;

  if (addBtn) {
    container.insertBefore(slotRow, addBtn);
    if (currentCount + 1 >= 6) addBtn.style.display = 'none';
    else addBtn.setAttribute('onclick', `_aeAddSlot(${currentCount + 1})`);
  } else {
    container.appendChild(slotRow);
  }
  _initAeSlotDrag();
}

function openAeCollectionDrawer(id) {
  if (AE_OPEN_DRAWER === id) {
    if (!AE_DRAWER_DIRTY) closeAeDrawer();
    return;
  }
  if (AE_OPEN_DRAWER) closeAeDrawer();
  const collection = (AE_LOCAL.collections || []).find(g => g.id === id);
  if (!collection) return;
  const inner = document.getElementById(`ae-collection-drawer-inner-${id}`);
  if (!inner) return;
  const isNew = !AE_FULL || !(AE_FULL.collections || []).find(g => g.id === id);
  AE_OPEN_DRAWER_IS_NEW = isNew;
  inner.innerHTML = _buildAeCollectionDrawerForm(collection, isNew);
  _initAeSlotDrag();
  const drawer = document.getElementById(`ae-collection-drawer-${id}`);
  if (drawer) drawer.style.maxHeight = '9999px';
  AE_OPEN_DRAWER = id;
  AE_DRAWER_DIRTY = false;
  inner.addEventListener('input',  () => { AE_DRAWER_DIRTY = true; });
  inner.addEventListener('change', () => { AE_DRAWER_DIRTY = true; });
  const row = document.getElementById(`ae-collection-row-${id}`);
  if (row) row.classList.add('cam-row-active');
}

function saveAeCollectionDrawer(originalId, isNew) {
  const idEl   = document.getElementById('ae-field-collection-id');
  const descEl  = document.getElementById('ae-field-collection-description');
  const newId   = idEl  ? idEl.value.trim()  : originalId;
  const newDescription = descEl ? descEl.value.trim() : '';

  let valid = true;

  const errId = document.getElementById('ae-err-collection-id');
  if (!newId) {
    if (errId) errId.textContent = 'Name is required';
    valid = false;
  } else if (newId !== originalId && (AE_LOCAL.collections || []).find(g => g.id === newId)) {
    if (errId) errId.textContent = 'Name already exists';
    valid = false;
  } else {
    if (errId) errId.textContent = '';
  }

  const errDescription = document.getElementById('ae-err-collection-description');
  if (!newDescription) {
    if (errDescription) errDescription.textContent = 'Description is required';
    valid = false;
  } else {
    if (errDescription) errDescription.textContent = '';
  }

  if (!valid) return;

  // Collect slot selects
  const actions = [];
  for (let i = 0; i < 6; i++) {
    const sel = document.getElementById(`ae-slot-${i}`);
    if (!sel) break;
    if (sel.value) actions.push(sel.value);
  }

  const updated = { id: newId, description: newDescription, actions };

  const idx = (AE_LOCAL.collections || []).findIndex(g => g.id === originalId);
  if (idx >= 0) {
    AE_LOCAL.collections[idx] = updated;
  } else {
    AE_LOCAL.collections.push(updated);
  }

  AE_DRAWER_DIRTY = false;
  AE_OPEN_DRAWER = null;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  applyAeChanges();
}

function deleteAeCollection(id) {
  const collection = (AE_LOCAL.collections || []).find(g => g.id === id);
  if (!collection) return;
  const row = document.getElementById(`ae-collection-row-${id}`);
  if (!row) return;
  row.classList.add('cam-row-confirm');
  row.onclick = null;
  row.innerHTML = `<td colspan="4" style="padding:10px 16px">
    <span style="font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.7)">Delete collection "<strong>${_aeEsc(id)}</strong>"?</span>
  </td>
  <td style="text-align:right;white-space:nowrap;padding:10px 16px">
    <button class="perf-reset" onclick="(function(){const c=document.getElementById('ae-tabs-and-content');if(c)_renderAeTabsInto(c);})()">Cancel</button>
    <button class="cam-save-btn" style="background:rgba(248,113,113,0.15);border-color:rgba(248,113,113,0.5);color:#f87171" onclick="confirmDeleteAeCollection('${_aeEsc(id)}')">Delete</button>
  </td>`;
}

function confirmDeleteAeCollection(id) {
  AE_LOCAL.collections = (AE_LOCAL.collections || []).filter(g => g.id !== id);
  if (AE_OPEN_DRAWER === id) AE_OPEN_DRAWER = null;
  // Clean up dangling slotCollections references in views
  (VIEWS || []).forEach(v => {
    if (!Array.isArray(v.slotCollections)) return;
    v.slotCollections = v.slotCollections.map(sg => sg === id ? null : sg);
  });
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  applyAeChanges();
  _persistViews();
}

function addAeCollection() {
  if (!AE_LOCAL.collections) AE_LOCAL.collections = [];
  let n = 1;
  while (AE_LOCAL.collections.find(g => g.id === `new-collection-${n}`)) n++;
  const newCollection = { id: `new-collection-${n}`, name: '', actions: [] };
  AE_LOCAL.collections.push(newCollection);
  AE_OPEN_DRAWER = newCollection.id;
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  const idInput = document.getElementById('ae-field-collection-id');
  if (idInput) { idInput.focus(); idInput.select(); }
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
  const fullActions      = AE_FULL.actions      || [];
  const localActions     = AE_LOCAL.actions     || [];
  const fullCollections  = AE_FULL.collections  || [];
  const localCollections = AE_LOCAL.collections || [];
  const maxAct = Math.max(fullActions.length, localActions.length);
  for (let i = 0; i < maxAct; i++) {
    if (JSON.stringify(fullActions[i]) !== JSON.stringify(localActions[i])) count++;
  }
  const maxGrp = Math.max(fullCollections.length, localCollections.length);
  for (let i = 0; i < maxGrp; i++) {
    if (JSON.stringify(fullCollections[i]) !== JSON.stringify(localCollections[i])) count++;
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
  AE_LOCAL       = _aeDeepClone(AE_FULL || { mqtt: { servers: [] }, actions: [], collections: [] });
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
  ghost.textContent = (AE_LOCAL.actions || [])[idx] ? AE_LOCAL.actions[idx].name : '';
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

// ── Drag-to-reorder: Collections ─────────────────────────────────────────────

function _initAeCollectionDrag() {
  document.querySelectorAll('#ae-collections-tbody .cam-drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', _onAeCollectionDragDown, { passive: false });
  });
}

function _onAeCollectionDragDown(e) {
  e.preventDefault();
  const handle = e.currentTarget;
  const row    = handle.closest('tr');
  const tbody  = document.getElementById('ae-collections-tbody');
  if (!tbody) return;
  const rows   = [...tbody.querySelectorAll('tr[id^="ae-collection-row-"]')];
  const idx    = rows.indexOf(row);
  if (idx < 0) return;

  const rect = row.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.id = 'ae-drag-ghost';
  ghost.style.cssText = `position:fixed;z-index:2000;pointer-events:none;background:rgba(15,15,15,0.97);border:1px solid rgba(74,222,128,0.5);border-radius:3px;box-shadow:0 6px 24px rgba(0,0,0,0.7);display:flex;align-items:center;padding:0 16px;font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.8);left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  ghost.textContent = (AE_LOCAL.collections || [])[idx] ? AE_LOCAL.collections[idx].id : '';
  document.body.appendChild(ghost);

  row.classList.add('cam-row-dragging');
  handle.setPointerCapture(e.pointerId);
  _aeDrag = { type: 'collection', idx, dropIdx: idx, ghost, rows, offsetY: e.clientY - rect.top };
  handle.addEventListener('pointermove',   _onAeCollectionDragMove);
  handle.addEventListener('pointerup',     _onAeCollectionDragEnd);
  handle.addEventListener('pointercancel', _onAeCollectionDragEnd);
}

function _onAeCollectionDragMove(e) {
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

function _onAeCollectionDragEnd(e) {
  if (!_aeDrag) return;
  const { idx, dropIdx, ghost, rows } = _aeDrag;
  const handle = e.currentTarget;
  handle.removeEventListener('pointermove',   _onAeCollectionDragMove);
  handle.removeEventListener('pointerup',     _onAeCollectionDragEnd);
  handle.removeEventListener('pointercancel', _onAeCollectionDragEnd);
  ghost.remove();
  rows.forEach(r => r.classList.remove('cam-row-dragging', 'cam-drop-before', 'cam-drop-after'));
  _aeDrag = null;
  const newIdx = dropIdx <= idx ? dropIdx : dropIdx - 1;
  if (newIdx === idx) return;
  const [moved] = (AE_LOCAL.collections || []).splice(idx, 1);
  AE_LOCAL.collections.splice(newIdx, 0, moved);
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
  markAeUnsaved();
}

// ── Drag-to-reorder: Collection Drawer Slots ─────────────────────────────────

function _initAeSlotDrag() {
  document.querySelectorAll('#ae-slots-container .cam-drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', _onAeSlotDragDown, { passive: false });
  });
}

function _onAeSlotDragDown(e) {
  e.preventDefault();
  const handle = e.currentTarget;
  const row    = handle.closest('.views-form-row[id^="ae-slot-row-"]');
  const container = document.getElementById('ae-slots-container');
  if (!container || !row) return;
  const rows = [...container.querySelectorAll('.views-form-row[id^="ae-slot-row-"]')];
  const idx  = rows.indexOf(row);
  if (idx < 0) return;

  const rect  = row.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.id = 'ae-drag-ghost';
  ghost.style.cssText = `position:fixed;z-index:2000;pointer-events:none;background:rgba(15,15,15,0.97);border:1px solid rgba(74,222,128,0.5);border-radius:3px;box-shadow:0 6px 24px rgba(0,0,0,0.7);display:flex;align-items:center;padding:0 16px;font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.8);left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  const sel = row.querySelector('select');
  ghost.textContent = sel ? (sel.value || '— none —') : '';
  document.body.appendChild(ghost);

  row.classList.add('cam-row-dragging');
  handle.setPointerCapture(e.pointerId);
  _aeDrag = { type: 'slot', idx, dropIdx: idx, ghost, rows, offsetY: e.clientY - rect.top };
  handle.addEventListener('pointermove',   _onAeSlotDragMove);
  handle.addEventListener('pointerup',     _onAeSlotDragEnd);
  handle.addEventListener('pointercancel', _onAeSlotDragEnd);
}

function _onAeSlotDragMove(e) {
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

function _onAeSlotDragEnd(e) {
  if (!_aeDrag) return;
  const { idx, dropIdx, ghost, rows } = _aeDrag;
  const handle = e.currentTarget;
  handle.removeEventListener('pointermove',   _onAeSlotDragMove);
  handle.removeEventListener('pointerup',     _onAeSlotDragEnd);
  handle.removeEventListener('pointercancel', _onAeSlotDragEnd);
  ghost.remove();
  rows.forEach(r => r.classList.remove('cam-row-dragging', 'cam-drop-before', 'cam-drop-after'));
  _aeDrag = null;
  const newIdx = dropIdx <= idx ? dropIdx : dropIdx - 1;
  if (newIdx === idx) return;

  // Reorder rows in the DOM
  const container = document.getElementById('ae-slots-container');
  const addBtn    = document.getElementById('ae-add-slot-btn');
  if (!container) return;
  const [movedRow] = rows.splice(idx, 1);
  rows.splice(newIdx, 0, movedRow);
  rows.forEach(r => {
    if (addBtn) container.insertBefore(r, addBtn);
    else container.appendChild(r);
  });

  // Renumber all slot row ids and select ids sequentially from 0
  rows.forEach((r, i) => {
    r.id = `ae-slot-row-${i}`;
    const label = r.querySelector('label');
    if (label) label.textContent = `Button ${i + 1}`;
    const sel = r.querySelector('select');
    if (sel) sel.id = `ae-slot-${i}`;
  });

  // Re-wire drag handles
  _initAeSlotDrag();
}

