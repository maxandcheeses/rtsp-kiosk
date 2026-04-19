// ── Camera settings editor ─────────────────────────────────────────────────

let CAM_STREAMS_FULL = null;
let CAM_LOCAL_STREAMS = null;
let CAM_UNSAVED = false;
let CAM_OPEN_DRAWER = null;
let CAM_DRAWER_IS_NEW = false;
let CAM_DRAWER_DIRTY = false;

const CAM_FIELD_SCHEMA = [
  {
    id: 'path', label: 'Path', type: 'text', default: '', section: 'main',
    placeholder: 'my-camera',
    hint: "Lowercase letters, numbers, hyphens",
    validate: v => /^[a-z0-9-]+$/.test(v) ? null : 'Lowercase letters, numbers, and hyphens only',
  },
  {
    id: 'source', label: 'RTSP Source', type: 'text', default: '', section: 'main',
    placeholder: 'rtsp://user:pass@host/stream',
    validate: v => (v.startsWith('rtsp://') || v.startsWith('rtsps://')) ? null : 'Must start with rtsp:// or rtsps://',
  },
  {
    id: 'rtspTransport', label: 'Transport', type: 'select', default: 'tcp', section: 'main',
    options: [{value:'tcp',label:'TCP'},{value:'udp',label:'UDP'}],
  },
  {
    id: 'aspectRatio', label: 'Aspect Ratio', type: 'select', default: '16:9', section: 'main',
    options: [
      {value:'16:9',label:'16:9'},{value:'4:3',label:'4:3'},
      {value:'1:1',label:'1:1'},{value:'21:9',label:'21:9'},
      {value:'custom',label:'Custom'},
    ],
  },
  {
    id: 'objectFit', label: 'Object Fit', type: 'select', default: 'contain', section: 'main',
    options: [{value:'contain',label:'Contain (letterbox)'},{value:'cover',label:'Cover (crop)'}],
  },
  { id: 'audio', label: 'Audio', type: 'toggle', default: false, section: 'advanced',
    tooltip: 'Enables audio playback for this stream. Requires the RTSP source to include an audio track.' },
  {
    id: 'sourceOnDemand', label: 'On Demand', type: 'toggle', default: true, section: 'advanced',
    tooltip: 'When enabled, the stream is only fetched from the RTSP source when a viewer is connected. Saves bandwidth when no one is watching.',
  },
  {
    id: 'sourceOnDemandStartTimeout', label: 'Start Timeout', type: 'text', default: '10s',
    section: 'advanced', placeholder: '10s', dependsOn: 'sourceOnDemand',
    tooltip: 'How long to wait for the stream to start before giving up. Use Go duration format (e.g. 10s, 1m).',
  },
  {
    id: 'sourceOnDemandCloseAfter', label: 'Close After', type: 'text', default: '10s',
    section: 'advanced', placeholder: '10s', dependsOn: 'sourceOnDemand',
    tooltip: 'How long after the last viewer disconnects before closing the upstream RTSP connection. Use Go duration format (e.g. 10s, 1m).',
  },
  {
    id: 'refreshInterval', label: 'Refresh Interval', type: 'number', default: 0,
    section: 'advanced', hint: 'sec (0 = off)',
    tooltip: 'Automatically reload the stream player every N seconds. Useful for streams that stall. Set to 0 to disable.',
  },
  {
    id: 'preloadLeadTime', label: 'Preload Lead', type: 'number', default: 0,
    section: 'advanced', hint: 'sec (0 = default)',
    showIf: () => typeof ENABLE_PRELOAD !== 'undefined' && ENABLE_PRELOAD,
    tooltip: 'Number of seconds before the stream tile becomes visible to start loading the stream. 0 uses the application default.',
  },
];

function renderCamerasTab() {
  loadCamStreams();
}

function openCamerasModal() {
  openSettingsModal('cameras');
}

async function loadCamStreams() {
  const tbody = document.getElementById('cam-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;font-family:\'Courier New\',monospace;font-size:12px;color:rgba(255,255,255,0.3)">Loading...</td></tr>';
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
    tbody.innerHTML = `<tr><td colspan="6"><div class="cam-api-notice">
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
    tbody.innerHTML = `<tr><td colspan="6" style="padding:32px;text-align:center;font-family:'Courier New',monospace;font-size:12px;color:rgba(255,255,255,0.3)">
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
    const streamIdx = (typeof STREAMS !== 'undefined' ? STREAMS : []).findIndex(s => s.path === stream.path);
    let streamStatus = 'idle';
    if (streamIdx >= 0) {
      if (document.getElementById('err' + streamIdx)?.classList.contains('show')) {
        streamStatus = 'err';
      } else {
        const vid = document.getElementById('v' + streamIdx);
        if (vid && !vid.paused && vid.readyState >= 2) streamStatus = 'live';
      }
    }
    row.innerHTML = `
      <td class="cam-drag-handle" style="width:32px">≡</td>
      <td style="font-family:'Courier New',monospace;color:rgba(255,255,255,0.7)">${camEscHtml(stream.path)}</td>
      <td style="width:48px;text-align:center"><span class="stream-status ${streamStatus}"></span></td>
      <td style="font-family:'Courier New',monospace;color:rgba(255,255,255,0.5);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${camEscHtml(camMaskSource(stream.source))}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="sp-btn" onclick="openCamStreamTest('${camEscHtml(stream.path)}')" title="Test stream" style="color:rgba(74,222,128,0.6);border-color:rgba(74,222,128,0.2)">▶</button>
        <button class="sp-btn" onclick="openCamDrawer('${camEscHtml(stream.path)}')" title="Edit">✎</button>
        <button class="sp-btn" onclick="deleteCamStream('${camEscHtml(stream.path)}')" title="Delete" style="color:rgba(248,113,113,0.6);border-color:rgba(248,113,113,0.2)">✕</button>
      </td>`;
    tbody.appendChild(row);

    const drawerRow = document.createElement('tr');
    drawerRow.id = `cam-drawer-row-${stream.path}`;
    drawerRow.innerHTML = `<td colspan="6" style="padding:0;border:none">
      <div class="cam-drawer" id="cam-drawer-${camEscHtml(stream.path)}">
        <div class="cam-drawer-inner" id="cam-drawer-inner-${camEscHtml(stream.path)}"></div>
      </div>
    </td>`;
    tbody.appendChild(drawerRow);
  });
  _initCamDrag();
}

function camFormRow(label, inputHtml, tooltip = '') {
  const infoIcon = tooltip ? `<span class="cam-info-icon" title="${tooltip}" style="cursor:help;font-size:11px;color:rgba(255,255,255,0.4);margin-left:4px;">ℹ</span>` : '';
  return `<div class="views-form-row"><label>${label}${infoIcon}</label><div style="flex:1;display:flex;flex-direction:column;gap:4px">${inputHtml}</div></div>`;
}

function renderCamField(field, stream) {
  const val = stream[field.id] !== undefined ? stream[field.id] : field.default;

  if (field.id === 'aspectRatio') {
    const ar = ['16:9','4:3','1:1','21:9'].includes(val) ? val : 'custom';
    const arCustom = ar === 'custom' ? (val || '') : '';
    const opts = field.options.map(o =>
      `<option value="${camEscHtml(o.value)}" ${ar===o.value?'selected':''}>${camEscHtml(o.label)}</option>`
    ).join('');
    return camFormRow(field.label, `<div style="display:flex;gap:8px;align-items:center">
      <select class="views-input" id="cam-field-aspectRatio" style="flex:none;width:auto" onchange="camArChange(this)">${opts}</select>
      <input class="views-input" id="cam-field-aspectRatio-custom" value="${camEscHtml(arCustom)}" placeholder="e.g. 9:16" style="flex:none;width:90px;${ar==='custom'?'':'display:none'}">
    </div>`, field.tooltip);
  }

  if (field.type === 'toggle') {
    const checked = field.id === 'sourceOnDemand' ? val !== false : !!val;
    const extra = field.id === 'sourceOnDemand' ? ' onchange="camOnDemandChange(this)"' : '';
    return camFormRow(field.label,
      `<label class="toggle"><input type="checkbox" id="cam-field-${field.id}"${checked?' checked':''}${extra}><span class="toggle-track"></span></label>`,
      field.tooltip
    );
  }

  if (field.type === 'select') {
    const opts = field.options.map(o =>
      `<option value="${camEscHtml(o.value)}" ${val===o.value?'selected':''}>${camEscHtml(o.label)}</option>`
    ).join('');
    return camFormRow(field.label,
      `<select class="views-input" id="cam-field-${field.id}" style="flex:none;width:auto">${opts}</select>`,
      field.tooltip
    );
  }

  if (field.type === 'number') {
    const hint = field.hint ? `<span style="font-size:10px;color:rgba(255,255,255,0.3)">${camEscHtml(field.hint)}</span>` : '';
    return camFormRow(field.label,
      `<div style="display:flex;align-items:center;gap:8px"><input type="number" class="perf-input" id="cam-field-${field.id}" value="${camEscHtml(String(val))}" min="0">${hint}</div>`,
      field.tooltip
    );
  }

  // default: text
  const phAttr = field.placeholder ? ` placeholder="${camEscHtml(field.placeholder)}"` : '';
  const hintHtml = field.hint
    ? `<div style="font-size:9px;color:rgba(255,255,255,0.25);margin-top:2px;font-family:'Courier New',monospace">${camEscHtml(field.hint)}</div>`
    : '';
  const errHtml = field.validate ? `<div class="cam-field-error" id="cam-err-${field.id}"></div>` : '';
  return camFormRow(field.label,
    `<input class="views-input" id="cam-field-${field.id}" value="${camEscHtml(String(val))}"${phAttr}>${hintHtml}${errHtml}`,
    field.tooltip
  );
}

function buildCamDrawerForm(stream, isNew) {
  const mainFields = CAM_FIELD_SCHEMA.filter(f => f.section === 'main');
  const advancedFields = CAM_FIELD_SCHEMA.filter(f => f.section === 'advanced' && (!f.showIf || f.showIf()));

  let mainHtml = '';
  for (const field of mainFields) {
    if (field.dependsOn) {
      const depVal = stream[field.dependsOn] !== undefined ? stream[field.dependsOn] : CAM_FIELD_SCHEMA.find(f => f.id === field.dependsOn)?.default;
      const hidden = !depVal;
      mainHtml += `<div id="cam-dep-${field.id}"${hidden?' style="display:none"':''}>` + renderCamField(field, stream) + '</div>';
    } else {
      mainHtml += renderCamField(field, stream);
    }
  }

  let advHtml = '';
  for (const field of advancedFields) {
    advHtml += renderCamField(field, stream);
  }

  return `<div class="cam-form-grid">
    ${mainHtml}
    <button class="cam-advanced-toggle" onclick="camToggleAdvanced(this)">▶ Advanced</button>
    <div id="cam-advanced-fields" style="display:none">${advHtml}</div>
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
  ['sourceOnDemandStartTimeout', 'sourceOnDemandCloseAfter'].forEach(id => {
    const el = document.getElementById(`cam-dep-${id}`);
    if (el) el.style.display = cb.checked ? '' : 'none';
  });
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
  if (CAM_OPEN_DRAWER === path) { closeCamDrawer(); return; }
  if (CAM_OPEN_DRAWER && CAM_OPEN_DRAWER !== path) closeCamDrawer();
  const stream = CAM_LOCAL_STREAMS.find(s => s.path === path);
  if (!stream) return;
  const inner = document.getElementById(`cam-drawer-inner-${path}`);
  if (!inner) return;
  const isNew = !CAM_STREAMS_FULL || !CAM_STREAMS_FULL.find(s => s.path === path);
  CAM_DRAWER_IS_NEW = isNew;
  CAM_DRAWER_DIRTY = false;
  inner.innerHTML = buildCamDrawerForm(stream, isNew);
  inner.addEventListener('input',  () => { CAM_DRAWER_DIRTY = true; });
  inner.addEventListener('change', () => { CAM_DRAWER_DIRTY = true; });
  const drawer = document.getElementById(`cam-drawer-${path}`);
  drawer.style.maxHeight = '9999px';
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
  if (CAM_DRAWER_IS_NEW && !CAM_DRAWER_DIRTY) {
    const removedPath = CAM_OPEN_DRAWER;
    CAM_OPEN_DRAWER = null;
    CAM_DRAWER_IS_NEW = false;
    CAM_LOCAL_STREAMS = CAM_LOCAL_STREAMS.filter(s => s.path !== removedPath);
    renderCamTable();
    return;
  }
  CAM_OPEN_DRAWER = null;
  CAM_DRAWER_IS_NEW = false;
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
  applyCamChanges();
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
  const usedByViews = (typeof VIEWS !== 'undefined' ? VIEWS : [])
    .filter(v => Array.isArray(v.streams) && v.streams.includes(path));
  const usageNote = usedByViews.length > 0
    ? `<div style="margin-top:6px;font-size:12px;color:rgba(248,113,113,0.7)">Used by ${usedByViews.length} view(s) — will be removed from them on apply.</div>`
    : '';
  row.classList.add('cam-row-confirm');
  row.onclick = null;
  row.innerHTML = `<td colspan="5" style="padding:10px 16px">
    <span style="font-family:'Courier New',monospace;font-size:13px;color:rgba(255,255,255,0.7)">Delete "<strong>${camEscHtml(stream.path)}</strong>"?</span>${usageNote}
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
  applyCamChanges();
}

function addCamStream() {
  if (!CAM_LOCAL_STREAMS) CAM_LOCAL_STREAMS = [];
  let n = 1;
  while (CAM_LOCAL_STREAMS.find(s => s.path === `new-camera-${n}`)) n++;
  const newStream = {};
  CAM_FIELD_SCHEMA.forEach(f => { newStream[f.id] = f.default; });
  newStream.path = `new-camera-${n}`;
  CAM_LOCAL_STREAMS.push(newStream);
  renderCamTable();
  openCamDrawer(newStream.path);
  const pathInput = document.getElementById('cam-field-path');
  if (pathInput) pathInput.focus();
}

// ── Drag-to-reorder ───────────────────────────────────────

let _camDrag = null;

function _initCamDrag() {
  document.querySelectorAll('.cam-drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', _onCamDragHandleDown, { passive: false });
  });
}

function _onCamDragHandleDown(e) {
  e.preventDefault();
  const handle = e.currentTarget;
  const row    = handle.closest('tr');
  const tbody  = row.closest('tbody');
  const rows   = [...tbody.querySelectorAll('tr[id^="cam-row-"]')];
  const idx    = rows.indexOf(row);
  if (idx < 0) return;

  const rect = row.getBoundingClientRect();

  const ghost = document.createElement('div');
  ghost.id = 'cam-drag-ghost';
  ghost.style.left   = rect.left + 'px';
  ghost.style.top    = rect.top  + 'px';
  ghost.style.width  = rect.width  + 'px';
  ghost.style.height = rect.height + 'px';
  ghost.textContent  = CAM_LOCAL_STREAMS[idx]?.path || '';
  document.body.appendChild(ghost);

  row.classList.add('cam-row-dragging');
  handle.setPointerCapture(e.pointerId);

  _camDrag = { idx, dropIdx: idx, ghost, tbody, rows, offsetY: e.clientY - rect.top };

  handle.addEventListener('pointermove',   _onCamDragMove);
  handle.addEventListener('pointerup',     _onCamDragEnd);
  handle.addEventListener('pointercancel', _onCamDragEnd);
}

function _onCamDragMove(e) {
  if (!_camDrag) return;
  const { ghost, rows, offsetY } = _camDrag;

  ghost.style.top = (e.clientY - offsetY) + 'px';

  let dropIdx = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { dropIdx = i; break; }
  }
  _camDrag.dropIdx = dropIdx;

  rows.forEach(r => r.classList.remove('cam-drop-before', 'cam-drop-after'));
  if (dropIdx < rows.length) {
    rows[dropIdx].classList.add('cam-drop-before');
  } else {
    rows[rows.length - 1].classList.add('cam-drop-after');
  }
}

function _onCamDragEnd(e) {
  if (!_camDrag) return;
  const { idx, dropIdx, ghost, rows } = _camDrag;
  const handle = e.currentTarget;

  handle.removeEventListener('pointermove',   _onCamDragMove);
  handle.removeEventListener('pointerup',     _onCamDragEnd);
  handle.removeEventListener('pointercancel', _onCamDragEnd);

  ghost.remove();
  rows.forEach(r => r.classList.remove('cam-row-dragging', 'cam-drop-before', 'cam-drop-after'));
  _camDrag = null;

  const newIdx = dropIdx <= idx ? dropIdx : dropIdx - 1;
  if (newIdx === idx) return;

  const [moved] = CAM_LOCAL_STREAMS.splice(idx, 1);
  CAM_LOCAL_STREAMS.splice(newIdx, 0, moved);
  markCamUnsaved();
  renderCamTable();
}

// ── Camera stream test modal ───────────────────────────────

let _camTestPC = null;

async function openCamStreamTest(path) {
  const modal   = document.getElementById('cam-test-modal');
  const titleEl = document.getElementById('cam-test-title');
  const videoEl = document.getElementById('cam-test-video');
  const statusEl = document.getElementById('cam-test-status');

  // Close any existing test connection first
  closeCamStreamTest();

  titleEl.textContent = path;
  statusEl.textContent = 'Connecting…';
  statusEl.style.color = 'rgba(255,255,255,0.4)';
  videoEl.srcObject = null;
  modal.style.display = 'flex';

  const whepUrl = `http://${MEDIAMTX_HOST}:${MEDIAMTX_PORT}/${path}/whep`;

  try {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    _camTestPC = pc;

    pc.ontrack = e => {
      videoEl.srcObject = e.streams[0];
      videoEl.play().catch(() => {});
      statusEl.textContent = 'Connected';
      statusEl.style.color = 'rgba(74,222,128,0.7)';
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        statusEl.textContent = 'Connection lost';
        statusEl.style.color = 'rgba(248,113,113,0.7)';
      }
    };

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'inactive' });

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

  } catch(e) {
    console.error('[CamTest] WHEP error:', e);
    statusEl.textContent = `Error: ${e.message}`;
    statusEl.style.color = 'rgba(248,113,113,0.7)';
    if (_camTestPC) { try { _camTestPC.close(); } catch(_) {} _camTestPC = null; }
  }
}

function closeCamStreamTest() {
  const modal   = document.getElementById('cam-test-modal');
  const videoEl = document.getElementById('cam-test-video');
  if (modal) modal.style.display = 'none';
  if (videoEl) videoEl.srcObject = null;
  if (_camTestPC) {
    try { _camTestPC.close(); } catch(_) {}
    _camTestPC = null;
  }
}
