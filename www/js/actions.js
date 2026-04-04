// ═══════════════════════════════════════════════════════
// PANEL ACTIONS — load config, open/close modal, MQTT
// ═══════════════════════════════════════════════════════

let ACTIONS       = {};  // id → action object
let ACTION_GROUPS = {};  // id → group object
let ACTION_STATES = {};  // state topic → last payload string
let ACTIONS_MODAL_OPEN = false;
let _actionsSlotIndex  = null; // which slot triggered the modal

async function loadActionsConfig() {
  try {
    const res = await fetch('/actions.json');
    if (!res.ok) { console.log('Actions: no actions.json found, skipping'); return; }
    const cfg = await res.json();
    (cfg.actions || []).forEach(a => { ACTIONS[a.id] = a; });
    (cfg.groups  || []).forEach(g => { ACTION_GROUPS[g.id] = g; });
    // Subscribe to all unique state topics
    const stateTopics = new Set();
    (cfg.actions || []).forEach(a => {
      if (a.state && a.state.topic) stateTopics.add(a.state.topic);
    });
    stateTopics.forEach(topic => {
      mqttSubscribe(topic, (t, payload) => {
        ACTION_STATES[t] = payload;
        if (ACTIONS_MODAL_OPEN) _refreshActionButtons();
      });
    });
    console.log(`Actions: loaded ${Object.keys(ACTIONS).length} actions, ${Object.keys(ACTION_GROUPS).length} groups`);
  } catch(e) {
    console.warn('Actions: failed to load actions.json', e);
  }
}

function openActionsModal(slotIndex) {
  const view = typeof getView === 'function' ? getView(activeView) : null;
  const slotGroups = view && view.slotGroups;
  const groupId = slotGroups && slotGroups[slotIndex];
  if (!groupId) return;
  if (!ACTION_GROUPS[groupId]) {
    console.warn(`Actions: group "${groupId}" not found`);
    return;
  }

  _actionsSlotIndex = slotIndex;
  _renderActionButtons(groupId);

  const modal = document.getElementById('actions-modal');
  const backdrop = document.getElementById('actions-backdrop');
  const cell = document.getElementById('cell' + slotIndex);

  if (cell) {
    const rect = cell.getBoundingClientRect();
    if (rect.width >= 280 && rect.height >= 300) {
      modal.style.left = Math.round(rect.left + rect.width / 2) + 'px';
      modal.style.top  = Math.round(rect.top  + rect.height / 2) + 'px';
      modal.style.transform = 'translate(-50%, -50%)';
    } else {
      modal.style.left = '50%';
      modal.style.top  = '50%';
      modal.style.transform = 'translate(-50%, -50%)';
    }
  } else {
    modal.style.left = '50%';
    modal.style.top  = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
  }

  const keepOpenEl = document.getElementById('actions-keep-open');
  if (keepOpenEl) {
    try { keepOpenEl.checked = localStorage.getItem('actionsKeepOpen') === 'true'; } catch(e) {}
  }

  modal.style.display = '';
  backdrop.style.display = '';
  ACTIONS_MODAL_OPEN = true;
}

function closeActionsModal() {
  document.getElementById('actions-modal').style.display = 'none';
  document.getElementById('actions-backdrop').style.display = 'none';
  ACTIONS_MODAL_OPEN = false;
  _actionsSlotIndex = null;
}

function _renderActionButtons(groupId) {
  const group = ACTION_GROUPS[groupId];
  if (!group) return;

  const actionIds = (group.actions || []).slice(0, 6);
  if (group.actions && group.actions.length > 6) {
    console.warn(`Actions: group "${groupId}" has ${group.actions.length} actions; only first 6 shown`);
  }

  const grid = document.getElementById('actions-grid');
  grid.setAttribute('data-count', actionIds.length);
  grid.innerHTML = actionIds.map(id => {
    const action = ACTIONS[id];
    if (!action) { console.warn(`Actions: action "${id}" not found`); return ''; }
    const isOn = action.state && ACTION_STATES[action.state.topic] === action.state.onValue;
    const iconHtml = _renderIcon(action.icon);
    return `<button class="action-btn${isOn ? ' on' : ''}" data-action-id="${id}" onclick="pressAction('${id}')">${iconHtml}<span>${action.label || id}</span></button>`;
  }).join('');
}

function _refreshActionButtons() {
  const view = typeof getView === 'function' ? getView(activeView) : null;
  const slotGroups = view && view.slotGroups;
  const groupId = slotGroups && _actionsSlotIndex !== null && slotGroups[_actionsSlotIndex];
  if (groupId) _renderActionButtons(groupId);
}

function _renderIcon(icon) {
  if (!icon) return '';
  if (icon.startsWith('mdi:')) {
    const iconName = icon.slice(4);
    return `<span class="action-btn-icon mdi mdi-${iconName}"></span>`;
  }
  return `<span class="action-btn-icon" style="font-size:20px">${icon}</span>`;
}

function pressAction(actionId) {
  const action = ACTIONS[actionId];
  if (!action || !action.publish) return;

  const btn = document.querySelector(`[data-action-id="${actionId}"]`);
  const ok = mqttPublish(action.publish.topic, action.publish.payload);

  if (!ok) {
    if (btn) {
      btn.style.background = 'rgba(248,113,113,0.3)';
      setTimeout(() => { if (btn) btn.style.background = ''; }, 1000);
    }
    console.warn('Actions: MQTT not connected, cannot publish');
    return;
  }

  if (btn) {
    btn.style.background = 'rgba(255,255,255,0.15)';
    setTimeout(() => { if (btn) btn.style.background = ''; }, 150);
  }

  setTimeout(() => {
    let keepOpen = false;
    try { keepOpen = localStorage.getItem('actionsKeepOpen') === 'true'; } catch(e) {}
    if (!keepOpen) closeActionsModal();
  }, 150);
}

function saveKeepOpen() {
  const el = document.getElementById('actions-keep-open');
  if (!el) return;
  try { localStorage.setItem('actionsKeepOpen', el.checked ? 'true' : 'false'); } catch(e) {}
}
