# Plan: MQTT Structured Connection, TLS Cert Support & Disconnect Button

## Task Description

Refactor MQTT server configuration in the Actions Editor to replace the single freeform `broker` URL field with structured connection fields (connection type dropdown + host + auto-defaulted port). Add TLS certificate support where cert files are uploaded via the UI and stored in **browser localStorage** (not on the server). Add a manual disconnect button per server.

## Objective

When complete:
- The MQTT server drawer shows a **connection type dropdown** (`ws`, `wss`, `mqtt`, `mqtts`) and separate **host** and **port** fields. The port auto-populates with a sensible default when the type changes.
- TLS fields (CA cert, client cert, client key) appear when `wss` or `mqtts` is selected, populated from cert files stored in localStorage.
- Users can **upload cert files** via the UI — files are read as PEM text and stored in `localStorage` under the key `mqtt_certs`.
- Each server row has a **Disconnect** button to manually tear down a live connection.
- Existing `broker` URLs in `actions.json` are parsed backward-compatibly.

## Problem Statement

The current `broker` text field (`ws://localhost:9001`) is error-prone — users must know the URL scheme, correct WebSocket path suffix (`/mqtt`), and port for their broker type. There is no TLS cert support, no cert management, and no way to manually disconnect a running connection.

## Solution Approach

1. **Structured fields** — split `broker` into `connectionType + host + port` in both the JSON schema and the drawer form. On save, derive the `broker` URL for mqtt.js. On drawer open, parse any legacy `broker` string back to structured fields.
2. **Cert storage in localStorage** — users upload `.crt`, `.pem`, `.key` files via a file input; the file content is read as text and stored in `localStorage['mqtt_certs']` as a JSON map of `{ filename: pemString }`. No server endpoints, no volume mounts.
3. **Cert UI** — TLS section shows cert file selectors (dropdowns populated from localStorage), a file upload input, and a list of stored certs with delete buttons.
4. **Disconnect button** — each server row gets a disconnect button that calls `disconnectMqttClient(id)`.

## Relevant Files

- **`www/js/actions-editor.js`** — server drawer form (`_buildAeSrvDrawerForm`), server list (`_buildAeSrvTable`), save/test logic, cert upload/delete/list functions
- **`www/js/mqtt.js`** — `getOrCreateMqttClient()` — reads cert PEM strings from localStorage and passes to mqtt.js opts
- **`docker-compose.yml`** — no changes needed for certs (localStorage only)
- **`nginx.conf`** — no changes needed
- **`streams-api/server.js`** — no changes needed

> **No new files or infrastructure changes are required.** Cert storage is entirely client-side.

## Implementation Phases

### Phase 1: localStorage Cert Helpers
- Define `mqttCertsLoad()`, `mqttCertsSave(map)`, `mqttCertsAdd(filename, pem)`, `mqttCertsDelete(filename)`, `mqttCertsList()` — pure localStorage helpers, ideally in `actions-editor.js` or a small inline block

### Phase 2: Core Implementation
- Refactor `_buildAeSrvDrawerForm` — replace `broker` field with type/host/port + TLS section + cert upload widget
- Add port-defaulting logic and type → port map
- Add backward-compat `broker` URL parser on drawer open
- Update `saveAeSrvDrawer` to build structured JSON and derive `broker`
- Update `testAeSrvConnection` to build broker URL from structured fields
- Update `getOrCreateMqttClient` in `mqtt.js` to read cert PEM from localStorage and pass to mqtt.js opts
- Add disconnect button to server rows in `_buildAeSrvTable`

### Phase 3: Integration & Polish
- Refresh cert dropdowns and file list after upload/delete (re-render in place, no full panel re-render)
- Validate: port 1–65535, host non-empty, cert filenames safe (strip `../`)
- Handle localStorage quota errors on upload gracefully

## Step by Step Tasks

### 1. Define localStorage cert helpers (actions-editor.js)

Add near the top of `actions-editor.js`:

```js
const _AE_CERTS_KEY = 'mqtt_certs';

function _aeCertsLoad()           { try { return JSON.parse(localStorage.getItem(_AE_CERTS_KEY) || '{}'); } catch(e) { return {}; } }
function _aeCertsSave(map)        { localStorage.setItem(_AE_CERTS_KEY, JSON.stringify(map)); }
function _aeCertsList()           { return Object.keys(_aeCertsLoad()); }
function _aeCertsGet(name)        { return _aeCertsLoad()[name] || null; }
function _aeCertsAdd(name, pem)   { const m = _aeCertsLoad(); m[name] = pem; _aeCertsSave(m); }
function _aeCertsDelete(name)     { const m = _aeCertsLoad(); delete m[name]; _aeCertsSave(m); }
```

### 2. Define port defaults map (actions-editor.js)

```js
const _AE_MQTT_PORT_DEFAULTS = { ws: 9001, wss: 8884, mqtt: 1883, mqtts: 8883 };
```

### 3. Add backward-compat broker URL parser (actions-editor.js)

```js
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
```

### 4. Refactor _buildAeSrvDrawerForm (actions-editor.js)

At the top of the function, resolve structured fields from `srv`:
```js
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
const showTls = connectionType === 'wss' || connectionType === 'mqtts';
```

Replace the `Broker URL` row with:
- **Connection Type** row: `<select id="ae-field-srv-conntype" onchange="aeOnConnTypeChange()">` with options `ws`, `wss`, `mqtt`, `mqtts` (selected on matching value)
- **Host** row: `<input id="ae-field-srv-host" value="${_aeEsc(host)}" placeholder="localhost">`
- **Port** row: `<input id="ae-field-srv-port" type="number" min="1" max="65535" value="${port}">`

After the Password row, add a TLS section div (visibility controlled by `showTls`):
```html
<div id="ae-tls-section" style="display:${showTls ? 'contents' : 'none'}">
  <!-- CA Certificate select -->
  <div class="views-form-row">
    <label ...>CA Certificate</label>
    <select id="ae-field-srv-ca" ...>
      <option value="">— none —</option>
      ${_aeCertsList().map(f => `<option value="${_aeEsc(f)}"${tls.caFile===f?' selected':''}>${_aeEsc(f)}</option>`).join('')}
    </select>
  </div>
  <!-- Client Certificate select -->
  <div class="views-form-row">
    <label ...>Client Certificate</label>
    <select id="ae-field-srv-cert" ...>
      <option value="">— none —</option>
      ${_aeCertsList().map(f => `<option value="${_aeEsc(f)}"${tls.certFile===f?' selected':''}>${_aeEsc(f)}</option>`).join('')}
    </select>
  </div>
  <!-- Client Key select -->
  <div class="views-form-row">
    <label ...>Client Key</label>
    <select id="ae-field-srv-key" ...>
      <option value="">— none —</option>
      ${_aeCertsList().map(f => `<option value="${_aeEsc(f)}"${tls.keyFile===f?' selected':''}>${_aeEsc(f)}</option>`).join('')}
    </select>
  </div>

  <!-- Cert management -->
  <div class="views-form-row" style="flex-direction:column;gap:6px">
    <label ...>Stored Certs</label>
    <div id="ae-cert-files-list">${_aeBuildCertList()}</div>
    <div style="display:flex;gap:6px;align-items:center">
      <input type="file" id="ae-cert-file-input" accept=".crt,.pem,.key,.cer" style="font-size:10px;flex:1">
      <button class="perf-reset" onclick="aeUploadCert()">Upload</button>
    </div>
    <div id="ae-cert-upload-status" style="font-size:9px;font-family:'Courier New',monospace"></div>
    <div style="font-size:9px;color:rgba(255,255,255,0.25)">Certs are stored in your browser (localStorage)</div>
  </div>
</div>
```

### 5. Add aeOnConnTypeChange (actions-editor.js)

```js
function aeOnConnTypeChange() {
  const typeEl = document.getElementById('ae-field-srv-conntype');
  const portEl = document.getElementById('ae-field-srv-port');
  const tlsEl  = document.getElementById('ae-tls-section');
  if (!typeEl) return;
  const type = typeEl.value;
  // Auto-update port only if current value matches a known default (not user-customized)
  if (portEl) {
    const cur = parseInt(portEl.value, 10);
    const isKnownDefault = Object.values(_AE_MQTT_PORT_DEFAULTS).includes(cur);
    if (isKnownDefault) portEl.value = _AE_MQTT_PORT_DEFAULTS[type] || 1883;
  }
  // Show/hide TLS section
  if (tlsEl) tlsEl.style.display = (type === 'wss' || type === 'mqtts') ? 'contents' : 'none';
}
```

### 6. Add cert upload/delete/list helpers (actions-editor.js)

```js
function _aeBuildCertList() {
  const files = _aeCertsList();
  if (!files.length) return '<span style="font-size:9px;color:rgba(255,255,255,0.25)">No certs stored</span>';
  return files.map(f =>
    `<div style="display:flex;align-items:center;gap:6px;font-family:\'Courier New\',monospace;font-size:9px">
      <span style="flex:1">${_aeEsc(f)}</span>
      <button class="perf-reset" style="font-size:9px;padding:1px 5px" onclick="aeDeleteCert('${_aeEsc(f)}')">✕</button>
    </div>`
  ).join('');
}

function aeUploadCert() {
  const input    = document.getElementById('ae-cert-file-input');
  const statusEl = document.getElementById('ae-cert-upload-status');
  if (!input || !input.files || !input.files[0]) {
    if (statusEl) statusEl.innerHTML = '<span style="color:rgba(248,113,113,0.9)">No file selected</span>';
    return;
  }
  const file = input.files[0];
  const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_'); // sanitize
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      _aeCertsAdd(name, e.target.result);
      if (statusEl) statusEl.innerHTML = `<span style="color:rgba(74,222,128,0.9)">Saved: ${_aeEsc(name)}</span>`;
      _aeRefreshCertUI();
    } catch(err) {
      if (statusEl) statusEl.innerHTML = `<span style="color:rgba(248,113,113,0.9)">Error: ${_aeEsc(err.message)}</span>`;
    }
    input.value = '';
  };
  reader.onerror = () => {
    if (statusEl) statusEl.innerHTML = '<span style="color:rgba(248,113,113,0.9)">Failed to read file</span>';
  };
  reader.readAsText(file);
}

function aeDeleteCert(name) {
  _aeCertsDelete(name);
  _aeRefreshCertUI();
}

function _aeRefreshCertUI() {
  // Refresh the cert file list
  const listEl = document.getElementById('ae-cert-files-list');
  if (listEl) listEl.innerHTML = _aeBuildCertList();
  // Refresh all three cert selects, preserving current selection
  for (const [id, field] of [['ae-field-srv-ca','caFile'],['ae-field-srv-cert','certFile'],['ae-field-srv-key','keyFile']]) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const cur = sel.value;
    sel.innerHTML = `<option value="">— none —</option>` +
      _aeCertsList().map(f => `<option value="${_aeEsc(f)}"${f===cur?' selected':''}>${_aeEsc(f)}</option>`).join('');
  }
}
```

### 7. Update saveAeSrvDrawer (actions-editor.js)

- Read: `connectionType`, `host`, `port`, `caFile` (from `#ae-field-srv-ca`), `certFile`, `keyFile`
- Validate: host non-empty, port integer 1–65535
- Derive `broker`:
  ```js
  const suffix = (connectionType === 'ws' || connectionType === 'wss') ? '/mqtt' : '';
  const broker = `${connectionType}://${host}:${port}${suffix}`;
  ```
- Build `updated`:
  ```js
  const updated = {
    id: newId,
    connectionType,
    host,
    port: parseInt(port, 10),
    broker,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(caFile || certFile || keyFile ? { tls: { caFile, certFile, keyFile } } : {}),
    autoConnect: newAutoConnect,
  };
  ```

### 8. Update testAeSrvConnection (actions-editor.js)

- Build broker URL from `#ae-field-srv-conntype`, `#ae-field-srv-host`, `#ae-field-srv-port` (same derivation)
- If TLS fields are set, read cert PEM strings from localStorage and add to `opts` (`ca`, `cert`, `key`)

### 9. Add disconnect button to server list (actions-editor.js)

In `_buildAeSrvTable`, add per-row button:
```html
<button class="perf-reset" onclick="aeDisconnectServer('${_aeEsc(srv.id)}')"
  style="font-size:9px;padding:2px 6px" title="Disconnect">Disconnect</button>
```

Add function:
```js
function aeDisconnectServer(id) {
  disconnectMqttClient(id);
  _updateNamedClientStatus(id);
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
}
```

### 10. Update getOrCreateMqttClient (mqtt.js)

When `serverCfg.tls` is present, read PEM strings from localStorage before connecting:
```js
function getOrCreateMqttClient(serverId, serverCfg) {
  if (_mqttClients.has(serverId)) return _mqttClients.get(serverId);
  if (typeof mqtt === 'undefined') { console.warn('MQTT: mqtt.js not loaded'); return null; }

  const opts = {
    username: serverCfg.username || undefined,
    password: serverCfg.password || undefined,
    reconnectPeriod: 0,
  };

  if (serverCfg.tls) {
    const certs = (() => { try { return JSON.parse(localStorage.getItem('mqtt_certs') || '{}'); } catch(e) { return {}; } })();
    const { caFile, certFile, keyFile } = serverCfg.tls;
    if (caFile   && certs[caFile])   opts.ca   = certs[caFile];
    if (certFile && certs[certFile]) opts.cert = certs[certFile];
    if (keyFile  && certs[keyFile])  opts.key  = certs[keyFile];
  }

  const client = mqtt.connect(serverCfg.broker, opts);
  // ... rest unchanged
}
```

### 11. Validate the implementation

- Open Actions Editor → MQTT Servers tab → add new server
- Verify type dropdown shows ws/wss/mqtt/mqtts
- Verify port auto-populates on type change; does not change if port was manually edited
- Verify legacy `ws://localhost:9001` broker URL parses correctly on edit
- Select `wss` type → TLS section appears
- Upload a `.crt` file → appears in cert list and dropdowns; `localStorage['mqtt_certs']` contains the PEM
- Delete the cert → removed from list and dropdowns
- Save server with `wss` + CA cert selected → saved JSON has `connectionType`, `host`, `port`, `tls`, and derived `broker`
- Disconnect button appears on server row; clicking it shows idle status

## Testing Strategy

- **Backward compat**: load `actions.json` with `broker`-only servers; open drawer and confirm host/port/type parse correctly
- **Port defaulting**: change type `ws` → `wss`; port changes 9001 → 8884. Manually edit port, then change type again; port should NOT be overwritten
- **Cert upload**: upload a `.pem` file; verify `localStorage['mqtt_certs']` contains it; verify cert selects include it
- **Cert delete**: delete cert; verify removed from localStorage and dropdowns
- **TLS section visibility**: ws/mqtt → hidden; wss/mqtts → visible
- **Disconnect**: connect a server; click Disconnect; status badge shows idle

## Acceptance Criteria

- [ ] MQTT server drawer shows Connection Type dropdown, Host, and Port fields — no raw broker URL input
- [ ] Port auto-defaults: `ws`→9001, `wss`→8884, `mqtt`→1883, `mqtts`→8883 on type change; not overwritten if user has customized the port
- [ ] Legacy `broker` URLs in `actions.json` parse back to type/host/port correctly
- [ ] TLS section (CA cert, client cert, client key dropdowns) shown only for `wss` and `mqtts`
- [ ] Cert file upload reads file as text and stores in `localStorage['mqtt_certs']` JSON map
- [ ] Cert delete removes entry from localStorage
- [ ] Cert dropdowns are populated from localStorage and refresh after upload/delete
- [ ] Saved server JSON has `connectionType`, `host`, `port`, derived `broker`, and optional `tls` object
- [ ] `getOrCreateMqttClient` reads cert PEM from localStorage and passes to mqtt.js opts
- [ ] Each server row has a Disconnect button that calls `disconnectMqttClient` and updates status
- [ ] No backend or infrastructure changes required

## Validation Commands

```bash
# No server-side changes — validate via browser console after opening the Actions Editor

# Confirm actions.json backward compat — existing broker URLs should still load
cat data/actions.json | python3 -c "import json,sys; d=json.load(sys.stdin); print([s.get('broker') for s in d.get('mqtt',{}).get('servers',[])])"

# After saving a server in the UI, verify the JSON structure
curl -s http://localhost/api/actions | python3 -m json.tool | grep -A5 '"servers"'
```

## Notes

- **Browser TLS limitation**: `ca`, `cert`, `key` opts passed to mqtt.js work in Node.js; in a browser the WebSocket TLS handshake is managed by the browser's built-in TLS stack. The opts are passed anyway — they may be honoured in some Electron/browser environments, and the feature prepares the codebase for a future server-side MQTT proxy.
- **localStorage quota**: Typical limit is 5–10 MB. PEM cert files are small (a few KB each), so quota should not be an issue in practice. The upload handler catches errors and shows a message if saving fails.
- **Cert filename sanitization**: On upload, replace any characters outside `[a-zA-Z0-9._-]` with `_` to prevent key pollution in the localStorage map.
- **Port dirty tracking**: Compare current port value against all four known defaults to decide whether to auto-update on type change. If the value is not one of the four defaults, assume the user customized it and leave it alone.
- **No new dependencies** — implementation uses only vanilla JS and browser APIs.
