// ═══════════════════════════════════════════════════════
// PANEL ACTIONS — load config, open/close modal, MQTT
// ═══════════════════════════════════════════════════════

let ACTIONS       = {};  // id → action object
let ACTION_GROUPS = {};  // id → group object
let ACTION_STATES = {};  // state topic → last payload string
let ACTIONS_MODAL_OPEN = false;
let _actionsSlotIndex  = null; // which slot triggered the modal
let _actionUnsubscribers = [];
let _connectedServerIds = new Set();
let _actionsConfig = null;  // full parsed config from /actions.json
let _focusPanelTimer    = null;
let _focusReopenSlot    = null; // slot to reopen actions modal on focus close

const BUILTIN_ACTIONS = {
  'Next View': {
    id: 'Next View', type: 'builtin', description: 'Next View',
    icon: 'mdi:chevron-right', builtin: true,
  },
  'Previous View': {
    id: 'Previous View', type: 'builtin', description: 'Previous View',
    icon: 'mdi:chevron-left', builtin: true,
  },
};

async function loadActionsConfig() {
  // Clean up any previous subscriptions from a prior load
  _actionUnsubscribers.forEach(fn => fn());
  _actionUnsubscribers = [];
  ACTIONS       = {};
  ACTION_GROUPS = {};
  // Keep ACTION_STATES — values are still valid if topics haven't changed

  try {
    const res = await fetch('/actions.json');
    if (!res.ok) { console.log('Actions: no actions.json found, skipping'); Object.assign(ACTIONS, BUILTIN_ACTIONS); return; }
    const cfg = await res.json();

    _actionsConfig = cfg;

    (cfg.actions || []).forEach(a => { ACTIONS[a.id] = a; });
    (cfg.groups  || []).forEach(g => { ACTION_GROUPS[g.id] = g; });

    // Merge builtin actions (always available, not stored in config)
    Object.assign(ACTIONS, BUILTIN_ACTIONS);

    // Legacy single-broker support: if mqtt.broker is set directly (old schema)
    if (cfg.mqtt && cfg.mqtt.broker && !cfg.mqtt.servers) {
      const { broker, username, password } = cfg.mqtt;
      mqttConnect(broker, username, password);
    }

    // Subscribe to all unique state topics via the global MQTT client
    const stateTopics = new Set();
    (cfg.actions || []).forEach(a => {
      if (a.state && a.state.topic) stateTopics.add(a.state.topic);
    });
    stateTopics.forEach(topic => {
      const unsub = mqttSubscribe(topic, (t, payload) => {
        ACTION_STATES[t] = payload;
        if (ACTIONS_MODAL_OPEN) _refreshActionButtons();
      });
      _actionUnsubscribers.push(unsub);
    });

    // Auto-connect named MQTT servers where autoConnect !== false
    const servers = (cfg.mqtt && cfg.mqtt.servers) || [];
    servers.forEach(srv => {
      if (srv.autoConnect !== false) {
        getOrCreateMqttClient(srv.id, srv);
        _connectedServerIds.add(srv.id);
      }
    });

    console.log(`Actions: loaded ${Object.keys(ACTIONS).length} actions, ${Object.keys(ACTION_GROUPS).length} groups`);
  } catch(e) {
    console.warn('Actions: failed to load actions.json', e);
  }
  // Always ensure builtins are available regardless of config load success
  Object.assign(ACTIONS, BUILTIN_ACTIONS);
}

function _connectServersForGroup(groupId) {
  const group = ACTION_GROUPS[groupId];
  if (!group) return;

  const needed = new Set();
  (group.actions || []).forEach(actionId => {
    const action = ACTIONS[actionId];
    if (action && action.type === 'mqtt' && action.mqttServer) needed.add(action.mqttServer);
  });

  // Disconnect servers no longer needed
  _connectedServerIds.forEach(id => {
    if (!needed.has(id)) {
      disconnectMqttClient(id);
      _connectedServerIds.delete(id);
    }
  });

  // Connect newly needed servers
  const servers = (_actionsConfig && _actionsConfig.mqtt && _actionsConfig.mqtt.servers) || [];
  needed.forEach(id => {
    if (!_connectedServerIds.has(id)) {
      const cfg = servers.find(s => s.id === id);
      if (cfg) {
        getOrCreateMqttClient(id, cfg);
        _connectedServerIds.add(id);
      }
    }
  });
}

function openActionsModal(slotIndex) {
  const view = typeof getView === 'function' ? getView(activeView) : null;
  const slotGroups = view && view.slotGroups;
  const groupId = slotGroups && slotGroups[slotIndex];
  if (!groupId) return;
  if (!ACTION_GROUPS[groupId] && !ACTIONS[groupId]) {
    console.warn(`Actions: "${groupId}" not found as group or action — removing stale reference`);
    if (view && view.slotGroups) { view.slotGroups[slotIndex] = null; }
    if (typeof _persistViews === 'function') _persistViews();
    return;
  }

  // Direct action (not a group) — execute immediately, no modal
  if (!ACTION_GROUPS[groupId] && ACTIONS[groupId]) {
    _actionsSlotIndex = slotIndex;
    pressAction(groupId);
    _actionsSlotIndex = null;
    return;
  }

  _actionsSlotIndex = slotIndex;
  _renderActionButtons(groupId);

  const modal = document.getElementById('actions-modal');
  const backdrop = document.getElementById('actions-backdrop');

  modal.style.left = '50%';
  modal.style.top  = '50%';
  modal.style.transform = 'translate(-50%, -50%)';

  const keepOpenEl = document.getElementById('actions-keep-open');
  if (keepOpenEl) {
    try { keepOpenEl.checked = localStorage.getItem('actionsKeepOpen') === 'true'; } catch(e) {}
  }

  modal.style.display = '';
  _updateMqttStatusIndicator();
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
  // Support direct action assignment (slotGroups can reference an action id directly)
  let group = ACTION_GROUPS[groupId];
  if (!group && ACTIONS[groupId]) {
    group = { id: groupId, name: '', actions: [groupId] };
  }
  if (!group) return;

  // Connect/disconnect named MQTT servers as needed for this group
  _connectServersForGroup(groupId);

  const _typeOrder = id => { const a = ACTIONS[id]; if (!a) return 2; if (a.type === 'builtin') return 0; if (a.type === 'focus-panel') return 1; return 2; };
  const actionIds = (group.actions || []).slice().sort((a, b) => _typeOrder(a) - _typeOrder(b)).slice(0, 6);
  const statusEl = document.getElementById('actions-mqtt-status');
  if (statusEl) {
    const hasMqtt = actionIds.some(id => ACTIONS[id] && ACTIONS[id].publish);
    statusEl.style.display = hasMqtt ? '' : 'none';
  }
  if (group.actions && group.actions.length > 6) {
    console.warn(`Actions: group "${groupId}" has ${group.actions.length} actions; only first 6 shown`);
  }

  const servers = (_actionsConfig && _actionsConfig.mqtt && _actionsConfig.mqtt.servers) || [];

  const grid = document.getElementById('actions-grid');
  grid.setAttribute('data-count', actionIds.length);
  grid.innerHTML = actionIds.map(id => {
    const action = ACTIONS[id];
    if (!action) { console.warn(`Actions: action "${id}" not found`); return ''; }

    // Determine if the action's MQTT server is present and connected
    let isDisabled = false;
    if (action.builtin || action.type === 'focus-panel') {
      isDisabled = false;
    } else if (action.type === 'mqtt') {
      if (!action.mqttServer) {
        isDisabled = true;
      } else {
        const serverExists = servers.some(s => s.id === action.mqttServer);
        if (!serverExists) {
          isDisabled = true;
        } else {
          // Fall back to global connected state if no named client pool entry
          const namedClient = (typeof _mqttClients !== 'undefined') && _mqttClients.get(action.mqttServer);
          isDisabled = namedClient ? !namedClient.connected : !_mqttConnected;
        }
      }
    }

    const isOn = action.state && ACTION_STATES[action.state.topic] === action.state.onValue;
    const iconHtml = _renderIcon(action.icon);
    const disabledAttr = isDisabled ? ' disabled' : '';
    const disabledClass = isDisabled ? ' disabled' : '';
    return `<button class="action-btn${isOn ? ' on' : ''}${disabledClass}"${disabledAttr} data-action-id="${id}" onclick="pressAction('${id}')">${iconHtml}<span>${action.description || id}</span></button>`;
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
  if (!action) return;

  // Handle builtin actions (next/prev view)
  if (action.type === 'builtin') {
    if (actionId === 'Next View') { if (typeof navigateView === 'function') navigateView(1); }
    if (actionId === 'Previous View') { if (typeof navigateView === 'function') navigateView(-1); }
    closeActionsModal();
    return;
  }

  // Handle focus-panel actions
  if (action.type === 'focus-panel') {
    const slotForFocus = _actionsSlotIndex;
    let keepOpen = false;
    try { keepOpen = localStorage.getItem('actionsKeepOpen') === 'true'; } catch(e) {}
    closeActionsModal();
    openFocusPanel(slotForFocus, action.timeout || 0, keepOpen ? slotForFocus : null);
    return;
  }

  // MQTT actions
  if (!action.publish) return;

  const btn = document.querySelector(`[data-action-id="${actionId}"]`);

  // Publish via named client if the action specifies a server, else fall back to global client
  const ok = action.mqttServer
    ? mqttPublishNamed(action.mqttServer, action.publish.topic, action.publish.payload)
    : mqttPublish(action.publish.topic, action.publish.payload);

  if (!ok) {
    if (btn) {
      btn.style.background = 'rgba(248,113,113,0.3)';
      setTimeout(() => { if (btn) btn.style.background = ''; }, 1000);
    } else if (_actionsSlotIndex !== null) {
      // Direct-action path: modal was never opened, so flash the cell itself
      const cell = document.getElementById(`cell${_actionsSlotIndex}`);
      if (cell) {
        cell.style.outline = '3px solid rgba(248,113,113,0.8)';
        setTimeout(() => { if (cell) cell.style.outline = ''; }, 1000);
      }
    }
    console.warn('Actions: MQTT not connected, cannot publish');
    setTimeout(() => {
      let keepOpen = false;
      try { keepOpen = localStorage.getItem('actionsKeepOpen') === 'true'; } catch(e) {}
      if (!keepOpen) closeActionsModal();
    }, 1000);
    return;
  }

  if (btn) {
    btn.style.background = 'rgba(255,255,255,0.15)';
    setTimeout(() => { if (btn) btn.style.background = ''; }, 150);
  } else if (_actionsSlotIndex !== null) {
    // Direct-action path: flash the cell itself as success confirmation
    const cell = document.getElementById(`cell${_actionsSlotIndex}`);
    if (cell) {
      cell.style.outline = '3px solid rgba(255,255,255,0.5)';
      setTimeout(() => { if (cell) cell.style.outline = ''; }, 150);
    }
  }

  setTimeout(() => {
    let keepOpen = false;
    try { keepOpen = localStorage.getItem('actionsKeepOpen') === 'true'; } catch(e) {}
    if (!keepOpen) closeActionsModal();
  }, 150);
}

function openFocusPanel(slotIndex, timeout, reopenSlot) {
  _focusReopenSlot = reopenSlot !== undefined ? reopenSlot : null;
  // Pause cycling if active
  if (typeof pauseCycle === 'function') pauseCycle();

  // Clone the video source from the cell
  const srcVideo = document.getElementById(`v${slotIndex}`);
  const destVideo = document.getElementById('focus-panel-video');
  if (srcVideo && destVideo) {
    if (srcVideo.srcObject) {
      destVideo.srcObject = srcVideo.srcObject;
    } else {
      destVideo.src = srcVideo.src;
    }
    destVideo.play().catch(() => {});
  }

  document.getElementById('focus-panel-overlay').classList.add('open');

  const countdownEl = document.getElementById('focus-panel-countdown');
  if (timeout && timeout > 0) {
    let remaining = timeout;
    countdownEl.textContent = `Auto-closing in ${remaining}s`;
    _focusPanelTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) { closeFocusPanel(); }
      else { countdownEl.textContent = `Auto-closing in ${remaining}s`; }
    }, 1000);
  } else {
    countdownEl.textContent = '';
  }
}

function closeFocusPanel() {
  if (_focusPanelTimer) { clearInterval(_focusPanelTimer); _focusPanelTimer = null; }
  document.getElementById('focus-panel-overlay').classList.remove('open');
  const destVideo = document.getElementById('focus-panel-video');
  if (destVideo) { try { destVideo.srcObject = null; } catch(e) {} destVideo.src = ''; }
  if (typeof resumeCycle === 'function') resumeCycle();
  const reopen = _focusReopenSlot;
  _focusReopenSlot = null;
  // Only reopen actions modal if the slot points to a GROUP (not a direct action)
  // to prevent an infinite loop where a direct focus-panel action re-opens focus
  if (reopen !== null) {
    const view = typeof getView === 'function' ? getView(activeView) : null;
    const slotGroupId = view && view.slotGroups && view.slotGroups[reopen];
    if (slotGroupId && ACTION_GROUPS[slotGroupId]) {
      openActionsModal(reopen);
    }
  }
}

function saveKeepOpen() {
  const el = document.getElementById('actions-keep-open');
  if (!el) return;
  try { localStorage.setItem('actionsKeepOpen', el.checked ? 'true' : 'false'); } catch(e) {}
}
