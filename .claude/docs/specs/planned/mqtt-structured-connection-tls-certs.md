# Plan: MQTT Structured Connection, TLS Cert Support & Disconnect Button

## Task Description

Refactor MQTT server configuration in the Actions Editor to replace the single freeform `broker` URL field with structured connection fields (connection type dropdown + host + auto-defaulted port). Add TLS certificate support with a cert upload workflow, cert directory env var shown in the UI, and a manual disconnect button per server.

## Objective

When complete:
- The MQTT server drawer shows a **connection type dropdown** (`ws`, `wss`, `mqtt`, `mqtts`) and separate **host** and **port** fields. The port auto-populates with a sensible default when the type changes.
- TLS fields (CA cert, client cert, client key) appear when `wss` or `mqtts` is selected, populated from uploaded cert files.
- Users can **upload cert files** via the UI (stored in `data/certs/`, served at `/certs/`).
- A **`MQTT_CERTS_DIR` env var** (default `/data/certs`) is shown in the cert section of the UI.
- Each server row has a **Disconnect** button to manually tear down a live connection.
- Existing `broker` URLs in `actions.json` are parsed backward-compatibly.

## Problem Statement

The current `broker` text field (`ws://localhost:9001`) is error-prone — users must know the URL scheme, correct WebSocket path suffix (`/mqtt`), and port for their broker type. There is no TLS cert support, no cert file management, and no way to manually disconnect a running connection.

## Solution Approach

1. **Structured fields** — split `broker` into `connectionType + host + port` in both the JSON schema and the drawer form. On save, derive the `broker` URL for mqtt.js. On drawer open, parse any legacy `broker` string back to structured fields.
2. **Cert upload** — add three endpoints to `streams-api` (`GET /api/certs`, `POST /api/certs`, `DELETE /api/certs/:filename`) that manage files in a configurable `MQTT_CERTS_DIR`. Nginx proxies `/api/certs` to the streams-api and serves `/certs/` as static files for the browser to fetch.
3. **Cert UI** — show a file list + upload input below TLS fields. A new `MQTT_CERTS_DIR` env var is injected into `index.html` and displayed informatively.
4. **Disconnect button** — each server row gets a disconnect icon button that calls `disconnectMqttClient(id)`.

## Relevant Files

- **`www/js/actions-editor.js`** — server drawer form (`_buildAeSrvDrawerForm`), server list (`_buildAeSrvTable`), save/test logic, new cert upload section
- **`www/js/mqtt.js`** — `getOrCreateMqttClient()` — needs to pass TLS cert data to mqtt.js opts
- **`www/index.html`** — env var injection block; add `MQTT_CERTS_DIR`
- **`docker-compose.yml`** — add `MQTT_CERTS_DIR` env var and `./data/certs` volume to nginx and streams-api
- **`streams-api/server.js`** — add cert file endpoints
- **`nginx.conf`** — add `/certs/` static route and `/api/certs` proxy location

### New Files
- **`data/certs/.gitkeep`** — ensures the cert directory is tracked by git but empty
- **`streams-api/Dockerfile`** (if it exists — check) — may need `MQTT_CERTS_DIR` env

## Implementation Phases

### Phase 1: Foundation
- Add `data/certs/.gitkeep`
- Add streams-api cert endpoints (`GET`, `POST`, `DELETE /api/certs`)
- Add nginx `/certs/` static route and `/api/certs` proxy
- Add `MQTT_CERTS_DIR` env var to docker-compose.yml and nginx envsubst
- Add `MQTT_CERTS_DIR` js global to `index.html`

### Phase 2: Core Implementation
- Refactor `_buildAeSrvDrawerForm` — replace `broker` field with type/host/port + TLS section + cert upload widget
- Add port-defaulting logic and type→port map
- Add backward-compat `broker` URL parser on drawer open
- Update `saveAeSrvDrawer` to build structured JSON and derive `broker`
- Update `testAeSrvConnection` to build broker URL from structured fields
- Update `getOrCreateMqttClient` to fetch and pass cert files to mqtt.js when configured
- Add disconnect button to server rows in `_buildAeSrvTable`

### Phase 3: Integration & Polish
- Add `aeUploadCert()` and `aeDeleteCert()` JS functions called from cert widget
- Refresh cert file list after upload/delete
- Validate: port is a number 1–65535; host is non-empty; cert file names are safe
- Test backward compat with existing `broker`-only server objects

## Step by Step Tasks

### 1. Create cert directory and gitkeep
- Create `data/certs/.gitkeep` (empty file)

### 2. Add cert endpoints to streams-api
In `streams-api/server.js`:
- Add `MQTT_CERTS_DIR` constant: `process.env.MQTT_CERTS_DIR || '/data/certs'`
- Add `GET /api/certs` — reads `MQTT_CERTS_DIR`, returns `{ files: ['ca.crt', 'client.crt', ...] }`; returns `{ files: [] }` if dir missing
- Add `POST /api/certs` — parses `multipart/form-data` manually (no dependencies; read raw body, parse boundary, extract filename + bytes); saves file to `MQTT_CERTS_DIR/<filename>`; sanitize filename (strip `..`, `/`); return `{ ok: true, filename }`
- Add `DELETE /api/certs/:filename` — deletes the file; sanitize filename
- Ensure `MQTT_CERTS_DIR` is created if missing on server start (`fs.mkdirSync(..., { recursive: true })`)
- Update the `server.listen` log to print `MQTT_CERTS_DIR`

### 3. Update nginx.conf
- Add `/certs/` static location: serves files from `/usr/share/nginx/html/certs` with `Cache-Control: no-store`
- Add `/api/certs` proxy location pointing to `streams-api:9998/api/certs` (mirror existing `/api/actions` pattern)
  ```nginx
  location /certs/ {
      alias /usr/share/nginx/html/certs/;
      add_header Cache-Control "no-store, must-revalidate";
  }

  location /api/certs {
      set $streams_api http://streams-api:9998;
      proxy_pass $streams_api/api/certs;
      proxy_set_header Host $host;
      proxy_read_timeout 30s;
      client_max_body_size 1m;
  }
  ```

### 4. Update docker-compose.yml
In the `nginx` service:
- Add env var: `MQTT_CERTS_DIR: "/data/certs"`
- Add volume: `./data/certs:/usr/share/nginx/html/certs:ro`
- Add `$$MQTT_CERTS_DIR` to the `envsubst` variable list in `entrypoint`

In the `streams-api` service:
- Add env var: `- MQTT_CERTS_DIR=/data/certs`
- Add volume: `- ./data/certs:/data/certs`

### 5. Inject MQTT_CERTS_DIR into index.html
In `www/index.html`, in the ENV block (~line 1142):
```js
const MQTT_CERTS_DIR = '$MQTT_CERTS_DIR' || '/data/certs';
```

### 6. Refactor actions-editor.js — structured broker fields

**Port defaults map** (add near top of file or inline in function):
```js
const _AE_MQTT_PORT_DEFAULTS = { ws: 9001, wss: 8884, mqtt: 1883, mqtts: 8883 };
```

**Backward-compat parser** (new helper):
```js
function _parseBrokerUrl(broker) {
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

**`_buildAeSrvDrawerForm(srv, isNew)` changes:**
- At the top of the function, resolve structured fields:
  ```js
  let connectionType = srv.connectionType || '';
  let host = srv.host || '';
  let port = srv.port || '';
  // Backward compat: parse existing broker URL
  if (srv.broker && (!srv.connectionType || !srv.host)) {
    const parsed = _parseBrokerUrl(srv.broker);
    if (!connectionType) connectionType = parsed.connectionType;
    if (!host) host = parsed.host;
    if (!port) port = parsed.port;
  }
  if (!connectionType) connectionType = 'ws';
  if (!port) port = _AE_MQTT_PORT_DEFAULTS[connectionType] || 9001;
  ```
- Replace the `Broker URL` row with three rows:
  - **Connection Type** — `<select id="ae-field-srv-conntype" onchange="aeOnConnTypeChange()">` with options `ws`, `wss`, `mqtt`, `mqtts`
  - **Host** — `<input id="ae-field-srv-host" value="${host}" placeholder="localhost">`
  - **Port** — `<input id="ae-field-srv-port" type="number" min="1" max="65535" value="${port}" placeholder="9001">`
- After Password row, add a collapsible TLS section (shown only when conntype is `wss` or `mqtts`):
  ```html
  <div id="ae-tls-section" style="display:${showTls ? 'contents' : 'none'}">
    <div class="views-form-row">
      <label ...>CA Certificate</label>
      <select id="ae-field-srv-ca" ...><option value="">— none —</option>...</select>
    </div>
    <div class="views-form-row">
      <label ...>Client Certificate</label>
      <select id="ae-field-srv-cert" ...>...</select>
    </div>
    <div class="views-form-row">
      <label ...>Client Key</label>
      <select id="ae-field-srv-key" ...>...</select>
    </div>
    <div class="views-form-row">
      <label ...>Cert files dir</label>
      <span style="font-family:monospace;font-size:9px;color:rgba(255,255,255,0.35)">${MQTT_CERTS_DIR}</span>
    </div>
    <!-- Cert upload widget -->
    <div class="views-form-row" style="flex-direction:column;gap:6px">
      <label ...>Upload Cert</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="file" id="ae-cert-file-input" accept=".crt,.pem,.key,.cer" style="font-size:10px;flex:1">
        <button class="perf-reset" onclick="aeUploadCert()">Upload</button>
      </div>
      <div id="ae-cert-upload-status" style="font-size:9px;font-family:monospace"></div>
      <div id="ae-cert-files-list" style="font-size:9px"></div>
    </div>
  </div>
  ```
- Populate TLS dropdowns by calling `aeFetchCertFiles()` which fetches `GET /api/certs` and renders `<option>` elements into the selects
- Store `tls.caFile`, `tls.certFile`, `tls.keyFile` from `srv.tls || {}`

**`aeOnConnTypeChange()`** (new function):
- Reads current conntype from `#ae-field-srv-conntype`
- Updates `#ae-field-srv-port` value to `_AE_MQTT_PORT_DEFAULTS[type]` only if port hasn't been manually edited (track with a dirty flag or compare against known defaults)
- Shows/hides `#ae-tls-section` based on whether type is `wss` or `mqtts`

**`aeFetchCertFiles()`** (new function):
- `GET /api/certs` → updates `<select>` options in TLS fields and `#ae-cert-files-list`
- List shows each filename with a delete button: `<button onclick="aeDeleteCert('${name}')">✕</button>`

**`aeUploadCert()`** (new function):
- Reads file from `#ae-cert-file-input`
- Posts as `multipart/form-data` to `/api/certs`
- On success, re-calls `aeFetchCertFiles()`
- Updates `#ae-cert-upload-status` with success/error

**`aeDeleteCert(filename)`** (new function):
- `DELETE /api/certs/${filename}`
- On success, re-calls `aeFetchCertFiles()`

### 7. Update saveAeSrvDrawer
- Read new fields: `connectionType`, `host`, `port`, `caFile`, `certFile`, `keyFile`
- Validate: host non-empty, port 1–65535
- Derive `broker` URL:
  ```js
  const path = (connectionType === 'ws' || connectionType === 'wss') ? '/mqtt' : '';
  const broker = `${connectionType}://${host}:${port}${path}`;
  ```
- Build `updated` object:
  ```js
  const updated = {
    id: newId,
    connectionType,
    host,
    port: parseInt(port, 10),
    broker,                         // kept for backward compat
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(caFile || certFile || keyFile ? { tls: { caFile, certFile, keyFile } } : {}),
    autoConnect: newAutoConnect,
  };
  ```

### 8. Update testAeSrvConnection
- Build broker URL from structured fields (same derivation as save)
- Pass cert opts if TLS fields set (fetch cert files then pass `ca`, `cert`, `key` to mqtt.connect opts)

### 9. Add disconnect button to server list
In `_buildAeSrvTable`, per server row, add a Disconnect button:
```html
<button class="perf-reset" onclick="aeDisconnectServer('${_aeEsc(srv.id)}')"
  title="Disconnect" style="font-size:9px;padding:2px 6px">
  Disconnect
</button>
```

**`aeDisconnectServer(id)`** (new function):
```js
function aeDisconnectServer(id) {
  disconnectMqttClient(id);
  _updateNamedClientStatus(id);
  // Re-render server table to reflect disconnected state
  const container = document.getElementById('ae-tabs-and-content');
  if (container) _renderAeTabsInto(container);
}
```

### 10. Update getOrCreateMqttClient in mqtt.js
When `serverCfg.tls` has cert file references, fetch them and pass to opts:
```js
async function getOrCreateMqttClientAsync(serverId, serverCfg) {
  if (_mqttClients.has(serverId)) return _mqttClients.get(serverId);
  if (typeof mqtt === 'undefined') { console.warn('MQTT: mqtt.js not loaded'); return null; }

  const opts = {
    username: serverCfg.username || undefined,
    password: serverCfg.password || undefined,
    reconnectPeriod: 0,
  };

  if (serverCfg.tls) {
    const { caFile, certFile, keyFile } = serverCfg.tls;
    const certBase = (typeof MQTT_CERTS_DIR !== 'undefined' ? '/certs/' : '/certs/');
    try {
      if (caFile)   opts.ca   = await fetch(`/certs/${caFile}`)  .then(r => r.text());
      if (certFile) opts.cert = await fetch(`/certs/${certFile}`).then(r => r.text());
      if (keyFile)  opts.key  = await fetch(`/certs/${keyFile}`) .then(r => r.text());
    } catch(e) {
      console.warn(`MQTT: failed to load cert files for "${serverId}":`, e);
    }
  }

  const client = mqtt.connect(serverCfg.broker, opts);
  // ... rest of existing client setup
}
```
- Rename existing synchronous `getOrCreateMqttClient` to async; update all call sites (only `saveAeSrvDrawer` and `boot.js` if applicable) to use `await` or `.then()`

### 11. Validate the implementation
- Open Actions Editor → MQTT Servers tab → add new server
- Verify type dropdown shows ws/wss/mqtt/mqtts
- Verify port auto-populates on type change
- Verify existing `ws://localhost:9001` broker parses correctly on edit
- Upload a cert file; verify it appears in list and `/certs/<name>` is fetchable
- TLS section visible only for wss/mqtts
- Disconnect button appears; clicking it disconnects and shows idle status

## Testing Strategy

- **Backward compat**: load actions.json with old `broker`-only servers; open drawer and confirm host/port/type parse correctly
- **Port defaulting**: change type from `ws` → `wss`; port should change from 9001 → 8884 automatically (but not if user has manually edited port)
- **Cert upload**: upload a `.crt` file; `GET /api/certs` returns it; nginx serves it at `/certs/<name>`
- **Delete cert**: delete the file; confirm it's removed from the list
- **Disconnect**: create a connected server; click Disconnect; status should show idle
- **TLS section visibility**: ws/mqtt → TLS hidden; wss/mqtts → TLS shown

## Acceptance Criteria

- [ ] MQTT server drawer shows Connection Type (dropdown), Host, and Port fields — no raw broker URL input
- [ ] Port field auto-defaults to 9001 (ws), 8884 (wss), 1883 (mqtt), 8883 (mqtts) when type changes
- [ ] Legacy `broker` URLs in actions.json are parsed back to type/host/port without errors
- [ ] TLS section (CA cert, client cert, client key) is shown only for `wss` and `mqtts` types
- [ ] `MQTT_CERTS_DIR` is displayed in the TLS section as an informational path
- [ ] Cert upload works: file appears in `/certs/<name>` after upload
- [ ] Cert delete works: file is removed
- [ ] Cert file selects are populated from `GET /api/certs`
- [ ] `broker` field in saved JSON is derived correctly (e.g. `wss://broker.example.com:8884/mqtt`)
- [ ] Each MQTT server row has a Disconnect button that tears down the live connection
- [ ] `docker-compose.yml` mounts `./data/certs` into both nginx and streams-api

## Validation Commands

```bash
# Start the stack
docker compose up --build -d

# Verify cert API endpoint is available
curl -s http://localhost/api/certs
# Expected: {"files":[]}

# Upload a cert (test with any PEM file)
echo "test" > /tmp/test.crt
curl -s -F "file=@/tmp/test.crt" http://localhost/api/certs
# Expected: {"ok":true,"filename":"test.crt"}

# Verify nginx serves the cert
curl -s http://localhost/certs/test.crt
# Expected: "test"

# Verify delete
curl -s -X DELETE http://localhost/api/certs/test.crt
# Expected: {"ok":true}

# Confirm MQTT_CERTS_DIR appears in index.html
docker compose exec nginx grep -o "MQTT_CERTS_DIR.*" /usr/share/nginx/html/index.html
```

## Notes

- **Browser TLS limitation**: Browser-side WebSocket TLS (`wss://`) is handled by the OS/browser certificate store. The `ca`, `cert`, `key` opts passed to mqtt.js only work in Node.js environments. For self-signed broker certs, users must manually trust the cert in their browser. The cert upload feature is still valuable for documentation, future server-side MQTT proxy use, and Node.js-based clients.
- **Security**: Serving private key files via nginx `/certs/` is a trade-off — these files are accessible to anyone who can reach the kiosk. This is acceptable for a self-hosted LAN deployment. Document the risk in the cert upload UI.
- **Multipart parsing**: `streams-api/server.js` has no dependencies. Implement a minimal multipart parser from scratch (boundary extraction, header parsing) rather than adding `multer` or similar.
- **Port dirty tracking**: To avoid overwriting a user-edited port when they change the connection type, compare current port value against all known defaults; only auto-update if it matches a known default (i.e. hasn't been customized).
- **No new npm packages needed** — all implementation in vanilla JS and Node.js built-ins.
