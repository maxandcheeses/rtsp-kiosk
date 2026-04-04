// ── Camera settings editor ─────────────────────────────────────────────────

let CAM_STREAMS_FULL = null;
let CAM_LOCAL_STREAMS = null;
let CAM_UNSAVED = false;
let CAM_OPEN_DRAWER = null;

function openCamerasModal() {
  closeAllModals();
  document.getElementById('cameras-modal').classList.add('open');
  loadCamStreams();
}

async function loadCamStreams() {
  const tbody = document.getElementById('cam-tbody');
  tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;font-family:\'Courier New\',monospace;font-size:10px;color:rgba(255,255,255,0.3)">Loading...</td></tr>';
  try {
    const res = await fetch('/api/streams');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const streams = await res.json();
    CAM_STREAMS_FULL = streams;
    CAM_LOCAL_STREAMS = JSON.parse(JSON.stringify(streams));
    CAM_UNSAVED = false;
    CAM_OPEN_DRAWER = null;
    document.getElementById('cam-banner').style.display = 'none';
    renderCamTable();
  } catch (e) {
    CAM_STREAMS_FULL = null;
    CAM_LOCAL_STREAMS = null;
    const addBtn = document.getElementById('cam-add-btn');
    if (addBtn) addBtn.style.display = 'none';
    tbody.innerHTML = `<tr><td colspan="5"><div class="cam-api-notice">
      <div style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:rgba(248,113,113,0.8);margin-bottom:10px">Streams API Not Available</div>
      The streams-api service is not reachable.<br>Ensure it is running and Nginx is proxying /api/streams.
    </div></td></tr>`;
  }
}

function camMaskSource(source) {
  if (!source) return '';
  return source.replace(/:\/\/([^@]+)@/, '://***@');
}

function camEscHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderCamTable() {
  const tbody = document.getElementById('cam-tbody');
  if (!CAM_LOCAL_STREAMS || CAM_LOCAL_STREAMS.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:32px;text-align:center;font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.3)">
      NO STREAMS CONFIGURED<br><span style="margin-top:6px;display:block">Use + Add Camera to add your first stream</span>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  CAM_LOCAL_STREAMS.forEach(stream => {
    const row = document.createElement('tr');
    row.id = `cam-row-${stream.path}`;
    row.style.cursor = 'pointer';
    row.onclick = (e) => { if (!e.target.closest('button')) openCamDrawer(stream.path); };
    row.innerHTML = `
      <td style="width:32px;color:rgba(255,255,255,0.25);text-align:center">⠿</td>
      <td style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.5)">${camEscHtml(stream.path)}</td>
      <td>${camEscHtml(stream.label || '')}</td>
      <td style="font-family:'Courier New',monospace;font-size:10px;color:rgba(255,255,255,0.5);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${camEscHtml(camMaskSource(stream.source))}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="sp-btn" onclick="openCamDrawer('${camEscHtml(stream.path)}')" title="Edit">✎</button>
        <button class="sp-btn" onclick="deleteCamStream('${camEscHtml(stream.path)}')" title="Delete" style="color:rgba(248,113,113,0.6);border-color:rgba(248,113,113,0.2)">✕</button>
      </td>`;
    tbody.appendChild(row);

    const drawerRow = document.createElement('tr');
    drawerRow.id = `cam-drawer-row-${stream.path}`;
    drawerRow.innerHTML = `<td colspan="5" style="padding:0;border:none">
      <div class="cam-drawer" id="cam-drawer-${camEscHtml(stream.path)}">
        <div class="cam-drawer-inner" id="cam-drawer-inner-${camEscHtml(stream.path)}"></div>
      </div>
    </td>`;
    tbody.appendChild(drawerRow);
  });
}

function camFormRow(label, inputHtml) {
  return `<div class="views-form-row"><label>${label}</label><div style="flex:1;display:flex;flex-direction:column;gap:4px">${inputHtml}</div></div>`;
}

function buildCamDrawerForm(stream, isNew) {
  const ar = ['16:9','4:3','1:1','21:9'].includes(stream.aspectRatio) ? stream.aspectRatio : 'custom';
  const arCustom = ar === 'custom' ? (stream.aspectRatio || '') : '';
  return `<div class="cam-form-grid">
    ${camFormRow('Path', `<input class="views-input" id="cam-field-path" value="${camEscHtml(stream.path||'')}" placeholder="my-camera">
      <div style="font-size:9px;color:rgba(255,255,255,0.25);margin-top:2px;font-family:'Courier New',monospace">Lowercase letters, numbers, hyphens</div>
      <div class="cam-field-error" id="cam-err-path"></div>`)}
    ${camFormRow('Label', `<input class="views-input" id="cam-field-label" value="${camEscHtml(stream.label||'')}" placeholder="Front Door">`)}
    ${camFormRow('RTSP Source', `<input class="views-input" id="cam-field-source" value="${camEscHtml(stream.source||'')}" placeholder="rtsp://user:pass@host/stream">
      <div class="cam-field-error" id="cam-err-source"></div>`)}
    ${camFormRow('Transport', `<select class="views-input" id="cam-field-rtspTransport" style="flex:none;width:auto">
      <option value="tcp" ${stream.rtspTransport==='tcp'?'selected':''}>TCP</option>
      <option value="udp" ${stream.rtspTransport==='udp'?'selected':''}>UDP</option>
    </select>`)}
    ${camFormRow('Aspect Ratio', `<div style="display:flex;gap:8px;align-items:center">
      <select class="views-input" id="cam-field-aspectRatio" style="flex:none;width:auto" onchange="camArChange(this)">
        <option value="16:9" ${ar==='16:9'?'selected':''}>16:9</option>
        <option value="4:3" ${ar==='4:3'?'selected':''}>4:3</option>
        <option value="1:1" ${ar==='1:1'?'selected':''}>1:1</option>
        <option value="21:9" ${ar==='21:9'?'selected':''}>21:9</option>
        <option value="custom" ${ar==='custom'?'selected':''}>Custom</option>
      </select>
      <input class="views-input" id="cam-field-aspectRatio-custom" value="${camEscHtml(arCustom)}" placeholder="e.g. 9:16" style="flex:none;width:90px;${ar==='custom'?'':'display:none'}">
    </div>`)}
    ${camFormRow('Object Fit', `<select class="views-input" id="cam-field-objectFit" style="flex:none;width:auto">
      <option value="contain" ${stream.objectFit==='cover'?'':'selected'}>Contain (letterbox)</option>
      <option value="cover" ${stream.objectFit==='cover'?'selected':''}>Cover (crop)</option>
    </select>`)}
    ${camFormRow('Audio', `<label class="toggle"><input type="checkbox" id="cam-field-audio" ${stream.audio?'checked':''}><span class="toggle-track"></span></label>`)}
    ${camFormRow('On Demand', `<label class="toggle"><input type="checkbox" id="cam-field-sourceOnDemand" ${stream.sourceOnDemand!==false?'checked':''} onchange="camOnDemandChange(this)"><span class="toggle-track"></span></label>`)}
    <div id="cam-ondemand-fields" ${stream.sourceOnDemand===false?'style="display:none"':''}>
      ${camFormRow('Start Timeout', `<input class="views-input" id="cam-field-sourceOnDemandStartTimeout" value="${camEscHtml(stream.sourceOnDemandStartTimeout||'10s')}" placeholder="10s" style="width:80px;flex:none">`)}
      ${camFormRow('Close After', `<input class="views-input" id="cam-field-sourceOnDemandCloseAfter" value="${camEscHtml(stream.sourceOnDemandCloseAfter||'10s')}" placeholder="10s" style="width:80px;flex:none">`)}
    </div>
    <button class="cam-advanced-toggle" onclick="camToggleAdvanced(this)">▶ Advanced</button>
    <div id="cam-advanced-fields" style="display:none">
      ${camFormRow('Refresh Interval', `<div style="display:flex;align-items:center;gap:8px"><input type="number" class="perf-input" id="cam-field-refreshInterval" value="${stream.refreshInterval||0}" min="0"><span style="font-size:10px;color:rgba(255,255,255,0.3)">sec (0 = off)</span></div>`)}
      ${camFormRow('Preload Lead', `<div style="display:flex;align-items:center;gap:8px"><input type="number" class="perf-input" id="cam-field-preloadLeadTime" value="${stream.preloadLeadTime||0}" min="0"><span style="font-size:10px;color:rgba(255,255,255,0.3)">sec (0 = default)</span></div>`)}
    </div>
  </div>
  <div class="cam-drawer-footer">
    <button class="perf-reset" onclick="closeCamDrawer()">Cancel</button>
    <button class="cam-save-btn" onclick="saveCamDrawer('${camEscHtml(stream.path)}', ${isNew})">Save</button>
  </div>`;
}

function camArChange(sel) {
  const custom = document.getElementById('cam-field-aspectRatio-custom');
  if (custom) custom.style.display = sel.value === 'custom' ? '' : 'none';
}

function camOnDemandChange(cb) {
  const fields = document.getElementById('cam-ondemand-fields');
  if (fields) fields.style.display = cb.checked ? '' : 'none';
}

function camToggleAdvanced(btn) {
  const adv = document.getElementById('cam-advanced-fields');
  if (!adv) return;
  const open = adv.style.display !== 'none';
  adv.style.display = open ? 'none' : '';
  btn.textContent = (open ? '▶' : '▼') + ' Advanced';
  if (CAM_OPEN_DRAWER) {
    const drawer = document.getElementById(`cam-drawer-${CAM_OPEN_DRAWER}`);
    if (drawer) drawer.style.maxHeight = (drawer.scrollHeight + 32) + 'px';
  }
}

function openCamDrawer(path) {
  if (CAM_OPEN_DRAWER && CAM_OPEN_DRAWER !== path) closeCamDrawer();
  const stream = CAM_LOCAL_STREAMS.find(s => s.path === path);
  if (!stream) return;
  const inner = document.getElementById(`cam-drawer-inner-${path}`);
  if (!inner) return;
  const isNew = !CAM_STREAMS_FULL || !CAM_STREAMS_FULL.find(s => s.path === path);
  inner.innerHTML = buildCamDrawerForm(stream, isNew);
  const drawer = document.getElementById(`cam-drawer-${path}`);
  drawer.style.maxHeight = (drawer.scrollHeight + 600) + 'px';
  CAM_OPEN_DRAWER = path;
  const row = document.getElementById(`cam-row-${path}`);
  if (row) row.classList.add('cam-row-active');
}

function closeCamDrawer() {
  if (!CAM_OPEN_DRAWER) return;
  const drawer = document.getElementById(`cam-drawer-${CAM_OPEN_DRAWER}`);
  if (drawer) drawer.style.maxHeight = '0';
  const row = document.getElementById(`cam-row-${CAM_OPEN_DRAWER}`);
  if (row) row.classList.remove('cam-row-active');
  CAM_OPEN_DRAWER = null;
}

function saveCamDrawer(originalPath, isNew) {
  const pathEl = document.getElementById('cam-field-path');
  const sourceEl = document.getElementById('cam-field-source');
  let valid = true;

  const path = pathEl ? pathEl.value.trim() : originalPath;
  const errPath = document.getElementById('cam-err-path');
  if (!/^[a-z0-9-]+$/.test(path)) {
    if (errPath) errPath.textContent = 'Lowercase letters, numbers, and hyphens only';
    valid = false;
  } else if (CAM_LOCAL_STREAMS.find(s => s.path === path && s.path !== originalPath)) {
    if (errPath) errPath.textContent = 'Path already exists';
    valid = false;
  } else {
    if (errPath) errPath.textContent = '';
  }

  const source = sourceEl ? sourceEl.value.trim() : '';
  const errSource = document.getElementById('cam-err-source');
  if (!source.startsWith('rtsp://') && !source.startsWith('rtsps://')) {
    if (errSource) errSource.textContent = 'Must start with rtsp:// or rtsps://';
    valid = false;
  } else {
    if (errSource) errSource.textContent = '';
  }

  if (!valid) return;

  const arSel = document.getElementById('cam-field-aspectRatio');
  const arCustomEl = document.getElementById('cam-field-aspectRatio-custom');
  const aspectRatio = arSel.value === 'custom' ? (arCustomEl ? arCustomEl.value.trim() || '16:9' : '16:9') : arSel.value;

  const updated = {
    path,
    ...(!isNew && path !== originalPath ? { _renamedFrom: originalPath } : {}),
    label: document.getElementById('cam-field-label').value.trim(),
    source,
    rtspTransport: document.getElementById('cam-field-rtspTransport').value,
    aspectRatio,
    objectFit: document.getElementById('cam-field-objectFit').value,
    audio: document.getElementById('cam-field-audio').checked,
    sourceOnDemand: document.getElementById('cam-field-sourceOnDemand').checked,
    sourceOnDemandStartTimeout: document.getElementById('cam-field-sourceOnDemandStartTimeout').value.trim(),
    sourceOnDemandCloseAfter: document.getElementById('cam-field-sourceOnDemandCloseAfter').value.trim(),
    refreshInterval: parseInt(document.getElementById('cam-field-refreshInterval').value) || 0,
    preloadLeadTime: parseInt(document.getElementById('cam-field-preloadLeadTime').value) || 0,
  };

  const idx = CAM_LOCAL_STREAMS.findIndex(s => s.path === originalPath);
  if (idx >= 0) {
    CAM_LOCAL_STREAMS[idx] = updated;
  } else {
    CAM_LOCAL_STREAMS.push(updated);
  }

  CAM_OPEN_DRAWER = null;
  renderCamTable();
  markCamUnsaved();
}

function markCamUnsaved() {
  CAM_UNSAVED = true;
  const banner = document.getElementById('cam-banner');
  const text = document.getElementById('cam-banner-text');
  if (banner) banner.style.display = 'flex';
  if (text) {
    const changed = CAM_LOCAL_STREAMS.filter(s => {
      const origPath = s._renamedFrom || s.path;
      const orig = (CAM_STREAMS_FULL || []).find(o => o.path === origPath);
      return !orig || JSON.stringify(orig) !== JSON.stringify(s);
    }).length;
    text.textContent = `${changed} unsaved change${changed !== 1 ? 's' : ''}`;
  }
}

async function applyCamChanges() {
  const btn = document.getElementById('cam-apply-btn');
  const text = document.getElementById('cam-banner-text');
  if (btn) { btn.disabled = true; btn.textContent = '···'; }
  if (text) text.textContent = 'Saving...';
  try {
    const renames = CAM_LOCAL_STREAMS
      .filter(s => s._renamedFrom)
      .map(s => ({ from: s._renamedFrom, to: s.path }));
    const streamsToSend = CAM_LOCAL_STREAMS.map(({ _renamedFrom, ...s }) => s);
    const res = await fetch('/api/streams', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streams: streamsToSend, renames }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    CAM_STREAMS_FULL = JSON.parse(JSON.stringify(streamsToSend));
    CAM_UNSAVED = false;
    const banner = document.getElementById('cam-banner');
    if (text) { text.textContent = '✓ Applied'; text.style.color = '#4ade80'; }
    if (btn) { btn.textContent = 'Applied'; }
    setTimeout(() => {
      if (banner) banner.style.display = 'none';
      if (btn) { btn.disabled = false; btn.textContent = 'Apply Changes'; }
      if (text) text.style.color = '';
    }, 2000);
    try {
      const sr = await fetch('/streams.json');
      if (sr.ok) { const s = await sr.json(); if (Array.isArray(s)) STREAMS = s; }
    } catch(_) {}
  } catch(e) {
    if (text) { text.textContent = `Save failed — ${e.message}`; text.style.color = '#f87171'; }
    if (btn) { btn.disabled = false; btn.textContent = 'Apply Changes'; }
  }
}

function discardCamChanges() {
  CAM_LOCAL_STREAMS = JSON.parse(JSON.stringify(CAM_STREAMS_FULL || []));
  CAM_UNSAVED = false;
  CAM_OPEN_DRAWER = null;
  document.getElementById('cam-banner').style.display = 'none';
  renderCamTable();
}

function deleteCamStream(path) {
  const stream = CAM_LOCAL_STREAMS.find(s => s.path === path);
  if (!stream) return;
  const row = document.getElementById(`cam-row-${path}`);
  if (!row) return;
  row.classList.add('cam-row-confirm');
  row.onclick = null;
  row.innerHTML = `<td colspan="4" style="padding:10px 16px">
    <span style="font-family:'Courier New',monospace;font-size:11px;color:rgba(255,255,255,0.7)">Delete "<strong>${camEscHtml(stream.label||stream.path)}</strong>"?</span>
  </td>
  <td style="text-align:right;white-space:nowrap;padding:10px 16px">
    <button class="perf-reset" onclick="renderCamTable()">Cancel</button>
    <button class="cam-save-btn" style="background:rgba(248,113,113,0.15);border-color:rgba(248,113,113,0.5);color:#f87171" onclick="confirmDeleteCamStream('${camEscHtml(path)}')">Delete</button>
  </td>`;
}

function confirmDeleteCamStream(path) {
  CAM_LOCAL_STREAMS = CAM_LOCAL_STREAMS.filter(s => s.path !== path);
  if (CAM_OPEN_DRAWER === path) CAM_OPEN_DRAWER = null;
  renderCamTable();
  markCamUnsaved();
}

function addCamStream() {
  if (!CAM_LOCAL_STREAMS) CAM_LOCAL_STREAMS = [];
  let n = 1;
  while (CAM_LOCAL_STREAMS.find(s => s.path === `new-camera-${n}`)) n++;
  const newStream = {
    path: `new-camera-${n}`,
    label: '',
    source: '',
    rtspTransport: 'tcp',
    aspectRatio: '16:9',
    objectFit: 'contain',
    audio: false,
    sourceOnDemand: true,
    sourceOnDemandStartTimeout: '10s',
    sourceOnDemandCloseAfter: '10s',
  };
  CAM_LOCAL_STREAMS.push(newStream);
  renderCamTable();
  openCamDrawer(newStream.path);
}
