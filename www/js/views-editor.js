// ═══════════════════════════════════════════════════════
// VIEWS CRUD — edit, add, delete, reorder via UI
// Changes are persisted in localStorage under 'viewsConfig'.
// ═══════════════════════════════════════════════════════

function _persistViews() {
  try {
    localStorage.setItem('viewsConfig', JSON.stringify({
      default: VIEWS_DEFAULT,
      cycle:   VIEWS_CYCLE,
      views:   VIEWS,
    }));
  } catch(e) {}

  // Fire-and-forget persist to backend. On success the server writes data/views.json.
  // Note: data/views-public.json (served by Nginx) is only synced from views.json at
  // container startup via generate-config.sh — it will not reflect changes until restart.
  fetch('/api/views', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ default: VIEWS_DEFAULT, cycle: VIEWS_CYCLE, views: VIEWS }),
  }).catch(e => console.warn('Failed to save views to server:', e));
}

function _updateDefaultVisibility() {
  const wrap = document.getElementById('views-default-wrap');
  if (wrap) wrap.style.display = VIEWS_CYCLE ? 'none' : '';
}

function onViewsCycleToggle() {
  VIEWS_CYCLE = document.getElementById('views-cycle-chk').checked;
  _persistViews();
  const cycleEl = document.getElementById('cycle-status');
  if (cycleEl) cycleEl.textContent = VIEWS_CYCLE ? 'on' : 'off';
  _updateDefaultVisibility();
}

function onViewsDefaultChange() {
  VIEWS_DEFAULT = document.getElementById('views-default-sel').value;
  _persistViews();
}

function moveView(name, dir) {
  const idx = VIEWS.findIndex(v => v.name === name);
  if (idx < 0) return;
  const next = idx + dir;
  if (next < 0 || next >= VIEWS.length) return;
  [VIEWS[idx], VIEWS[next]] = [VIEWS[next], VIEWS[idx]];
  _persistViews();
  renderViewsTab();
}

let _confirmDeleteName = null;

function promptDeleteView(name) {
  _confirmDeleteName = name;
  renderViewsTab();
}

function confirmDeleteView(name) {
  _confirmDeleteName = null;
  const idx = VIEWS.findIndex(v => v.name === name);
  if (idx < 0) return;
  VIEWS.splice(idx, 1);
  if (VIEWS_DEFAULT === name) VIEWS_DEFAULT = VIEWS[0]?.name ?? null;
  _persistViews();
  renderViewsTab();
}

function cancelDeleteView() {
  _confirmDeleteName = null;
  renderViewsTab();
}

function toggleViewCycle(name) {
  const view = VIEWS.find(v => v.name === name);
  if (!view) return;
  view.cycle = view.cycle === false ? true : false;
  _persistViews();
  renderViewsTab();
}

function cloneView(name) {
  const view = getView(name);
  if (!view) return;
  let newName = name + '-copy';
  let i = 2;
  while (VIEWS.find(v => v.name === newName)) { newName = name + '-copy-' + i++; }
  _editingViewName = null;
  _editLayoutSel   = view.layout;
  _editStreams      = [...(view.streams || [])];
  _editSlotGroups  = (view.slotGroups || []).map(g => {
    if (!g) return null;
    if (typeof ACTION_GROUPS !== 'undefined' && ACTION_GROUPS[g]) return g;
    if (typeof ACTIONS !== 'undefined' && ACTIONS[g]) return g;
    return null;
  });
  _showViewForm({ ...view, name: newName });
}

// ── Drag-to-reorder ───────────────────────────────────────

let _drag = null;

function _initViewDrag() {
  document.querySelectorAll('.view-drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', _onDragHandleDown, { passive: false });
  });
}

function _onDragHandleDown(e) {
  e.preventDefault();
  const handle = e.currentTarget;
  const row    = handle.closest('tr');
  const tbody  = row.closest('tbody');
  const rows   = [...tbody.querySelectorAll('tr')];
  const idx    = rows.indexOf(row);
  if (idx < 0) return;

  const rect = row.getBoundingClientRect();

  const ghost = document.createElement('div');
  ghost.id = 'view-drag-ghost';
  ghost.style.left   = rect.left + 'px';
  ghost.style.top    = rect.top  + 'px';
  ghost.style.width  = rect.width  + 'px';
  ghost.style.height = rect.height + 'px';
  ghost.textContent  = VIEWS[idx]?.name || '';
  document.body.appendChild(ghost);

  row.classList.add('view-row-dragging');
  handle.setPointerCapture(e.pointerId);

  _drag = { idx, dropIdx: idx, ghost, tbody, rows, offsetY: e.clientY - rect.top };

  handle.addEventListener('pointermove',   _onDragMove);
  handle.addEventListener('pointerup',     _onDragEnd);
  handle.addEventListener('pointercancel', _onDragEnd);
}

function _onDragMove(e) {
  if (!_drag) return;
  const { ghost, rows, offsetY } = _drag;

  ghost.style.top = (e.clientY - offsetY) + 'px';

  let dropIdx = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { dropIdx = i; break; }
  }
  _drag.dropIdx = dropIdx;

  rows.forEach(r => r.classList.remove('view-drop-before', 'view-drop-after'));
  if (dropIdx < rows.length) {
    rows[dropIdx].classList.add('view-drop-before');
  } else {
    rows[rows.length - 1].classList.add('view-drop-after');
  }
}

function _onDragEnd(e) {
  if (!_drag) return;
  const { idx, dropIdx, ghost, rows } = _drag;
  const handle = e.currentTarget;

  handle.removeEventListener('pointermove',   _onDragMove);
  handle.removeEventListener('pointerup',     _onDragEnd);
  handle.removeEventListener('pointercancel', _onDragEnd);

  ghost.remove();
  rows.forEach(r => r.classList.remove('view-row-dragging', 'view-drop-before', 'view-drop-after'));
  _drag = null;

  const newIdx = dropIdx <= idx ? dropIdx : dropIdx - 1;
  if (newIdx === idx) return;

  const [moved] = VIEWS.splice(idx, 1);
  VIEWS.splice(newIdx, 0, moved);
  _persistViews();
  renderViewsTab();
}

// ── View edit form ────────────────────────────────────

let _editingViewName = null; // null = new view
let _editLayoutSel   = null;
let _editStreams      = [];
let _editSlotGroups  = [];

function openNewViewEditor() {
  _editingViewName = null;
  _editLayoutSel   = Object.keys(LAYOUTS)[0];
  _editStreams      = [];
  _editSlotGroups  = [];
  _showViewForm({ name: '', duration: 20, preloadLeadTime: 5 });
}

function openViewEditor(name) {
  const view = getView(name);
  if (!view) return;
  _editingViewName = name;
  _editLayoutSel   = view.layout;
  _editStreams      = [...(view.streams || [])];
  _editSlotGroups  = (view.slotGroups || []).map(g => {
    if (!g) return null;
    if (typeof ACTION_GROUPS !== 'undefined' && ACTION_GROUPS[g]) return g;
    if (typeof ACTIONS !== 'undefined' && ACTIONS[g]) return g;
    return null;
  });
  _showViewForm(view);
}

function _showViewForm(view) {
  ['ve-err-name', 've-err-layout', 've-err-streams'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '';
  });
  document.getElementById('views-table-wrap').style.display = 'none';
  document.getElementById('view-edit-panel').style.display  = '';
  document.getElementById('view-edit-title').textContent = _editingViewName ? `Edit: ${_editingViewName}` : 'New View';

  const nameEl = document.getElementById('ve-name');
  nameEl.value = view.name || '';

  document.getElementById('ve-duration').value = view.duration !== undefined ? view.duration : 20;
  document.getElementById('ve-preload-row').style.display = ENABLE_PRELOAD ? '' : 'none';
  if (ENABLE_PRELOAD) {
    const hasPreload = view.preloadLeadTime !== undefined && view.preloadLeadTime !== null;
    document.getElementById('ve-preload-enabled').checked    = hasPreload;
    document.getElementById('ve-leadtime').value             = hasPreload ? view.preloadLeadTime : 5;
    document.getElementById('ve-leadtime').style.display     = hasPreload ? '' : 'none';
    document.getElementById('ve-preload-hint').style.display = hasPreload ? 'none' : '';
  }

  _renderVeLayoutGrid();
  _renderVeStreamPicker();
}

function _renderVeLayoutGrid() {
  document.getElementById('ve-layout-grid').innerHTML = Object.keys(LAYOUTS).map(k => {
    const sel = k === _editLayoutSel ? ' selected' : '';
    const svg = layoutSvgWithNumbers(k, _editStreams);
    return `<button class="ve-layout-btn${sel}" onclick="_veSelectLayout('${k}')">${svg}<span>${k}</span></button>`;
  }).join('');
}

function _veSelectLayout(key) {
  _editLayoutSel = key;
  _renderVeLayoutGrid();
  _renderVeStreamPicker();
}

function _renderVeStreamPicker() {
  const slotCount = LAYOUTS[_editLayoutSel]?.streams ?? 0;
  const container = document.getElementById('ve-stream-picker');

  // Sync _editStreams length to slot count
  if (_editStreams.length > slotCount) {
    _editStreams.splice(slotCount);
  } else {
    while (_editStreams.length < slotCount) _editStreams.push('');
  }

  // Sync _editSlotGroups length to slot count
  if (_editSlotGroups.length > slotCount) {
    _editSlotGroups.splice(slotCount);
  } else {
    while (_editSlotGroups.length < slotCount) _editSlotGroups.push(null);
  }

  container.innerHTML = '';

  for (let i = 0; i < slotCount; i++) {
    const current = _editStreams[i] || '';

    const row = document.createElement('div');
    row.className = 'views-form-row';

    const lbl = document.createElement('label');
    lbl.style.cssText = 'font-family:monospace;color:rgba(255,255,255,0.45)';
    lbl.textContent = `Panel ${i}`;

    const sel = document.createElement('select');
    sel.className = 'views-input';

    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— select camera —';
    sel.appendChild(blank);

    STREAMS.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.path;
      opt.textContent = s.path;
      if (s.path === current) opt.selected = true;
      sel.appendChild(opt);
    });

    sel.addEventListener('change', (function(idx) {
      return function() {
        _editStreams[idx] = this.value;
        _renderVeLayoutGrid();
      };
    })(i));

    const groupSel = document.createElement('select');
    groupSel.className = 'views-input';
    groupSel.style.marginTop = '4px';

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— no actions —';
    groupSel.appendChild(noneOpt);

    const actionsGroup = document.createElement('optgroup');
    actionsGroup.label = 'Actions';
    const _typeOrder = a => a.type === 'builtin' ? 0 : a.type === 'focus-panel' ? 1 : 2;
    Object.values(ACTIONS).sort((a, b) => _typeOrder(a) - _typeOrder(b)).forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.id;
      if ((_editSlotGroups[i] || '') === a.id) opt.selected = true;
      actionsGroup.appendChild(opt);
    });
    if (actionsGroup.children.length > 0) groupSel.appendChild(actionsGroup);

    const groupsGroup = document.createElement('optgroup');
    groupsGroup.label = 'Groups';
    Object.values(ACTION_GROUPS).forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.id;
      if ((_editSlotGroups[i] || '') === g.id) opt.selected = true;
      groupsGroup.appendChild(opt);
    });
    if (groupsGroup.children.length > 0) groupSel.appendChild(groupsGroup);

    groupSel.addEventListener('change', (function(idx) {
      return function() { _editSlotGroups[idx] = this.value || null; };
    })(i));

    row.appendChild(lbl);
    row.appendChild(sel);
    row.appendChild(groupSel);
    container.appendChild(row);
  }
}

function cancelViewEdit() {
  _editingViewName = null;
  _editStreams      = [];
  _editSlotGroups  = [];
  renderViewsTab();
}

function toggleVePreload() {
  const on = document.getElementById('ve-preload-enabled').checked;
  document.getElementById('ve-leadtime').style.display     = on ? '' : 'none';
  document.getElementById('ve-preload-hint').style.display = on ? 'none' : '';
}

function saveViewForm() {
  // Clear all inline errors
  ['ve-err-name', 've-err-layout', 've-err-streams'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '';
  });

  const name           = document.getElementById('ve-name').value.trim();
  const dur            = parseInt(document.getElementById('ve-duration').value, 10);
  const preloadEnabled = document.getElementById('ve-preload-enabled').checked;
  const lead           = preloadEnabled ? parseInt(document.getElementById('ve-leadtime').value, 10) : undefined;

  let valid = true;
  if (!name) {
    const el = document.getElementById('ve-err-name'); if (el) el.textContent = 'Name is required';
    valid = false;
  }
  if (!_editLayoutSel) {
    const el = document.getElementById('ve-err-layout'); if (el) el.textContent = 'Select a layout';
    valid = false;
  }
  if (_editStreams.filter(Boolean).length === 0) {
    const el = document.getElementById('ve-err-streams'); if (el) el.textContent = 'Add at least one stream';
    valid = false;
  }
  if (!valid) return;

  const view = {
    name,
    layout:     _editLayoutSel,
    streams:    _editStreams.filter(Boolean),
    duration:   isNaN(dur) ? 20 : dur,
    cycle:      _editingViewName ? (getView(_editingViewName)?.cycle ?? true) : true,
    slotGroups: _editSlotGroups.map(g => g || null),
    ...(preloadEnabled ? { preloadLeadTime: isNaN(lead) ? 5 : lead } : {}),
  };

  if (_editingViewName) {
    if (name !== _editingViewName && VIEWS.find(v => v.name === name)) {
      const el = document.getElementById('ve-err-name'); if (el) el.textContent = `"${name}" already exists`;
      return;
    }
    const idx = VIEWS.findIndex(v => v.name === _editingViewName);
    if (idx >= 0) VIEWS[idx] = view;
    if (VIEWS_DEFAULT === _editingViewName) VIEWS_DEFAULT = name;
  } else {
    if (VIEWS.find(v => v.name === name)) {
      const el = document.getElementById('ve-err-name'); if (el) el.textContent = `"${name}" already exists`;
      return;
    }
    VIEWS.push(view);
    if (!VIEWS_DEFAULT) VIEWS_DEFAULT = name;
  }

  _persistViews();

  // Re-activate if the edited view is currently playing
  const wasActive = activeView === (_editingViewName || name);
  cancelViewEdit();
  if (wasActive) { stopAll(); activateView(name); }
}
