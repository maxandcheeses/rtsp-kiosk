// ═══════════════════════════════════════════════════════
// PANEL ACTIONS — load config, open/close modal, MQTT
// ═══════════════════════════════════════════════════════

let ACTIONS       = {};  // id → action object
let ACTION_GROUPS = {};  // id → group object
let ACTION_STATES = {};  // state topic → last payload string
let MQTT_SERVERS  = {};  // id → server config object
let ACTIONS_MODAL_OPEN = false;
let _actionsSlotIndex  = null; // which slot triggered the modal
let _actionUnsubscribers = [];
let _connectedServerIds = new Set(); // server ids currently connected for active panel

async function loadActionsConfig() {
  // Clean up any previous subscriptions from a prior load
  _actionUnsubscribers.forEach(fn => fn());
  _actionUnsubscribers = [];
  ACTIONS       = {};
  ACTION_GROUPS = {};
  MQTT_SERVERS  = {};
  // Keep ACTION_STATES — values are still valid if topics haven't changed

  try {
    const res = await fetch('/actions.json');
    if (!res.ok) { console.log('Actions: no actions.json found, skipping'); return; }
    const cfg = await res.json();

    // Parse servers (new schema: mqtt.servers array)
    ((cfg.mqtt && cfg.mqtt.servers) || []).forEach(s => { MQTT_SERVERS[s.id] = s; });

    (cfg.actions || []).forEach(a => { ACTIONS[a.id] = a; });
    (cfg.groups  || []).forEach(g => { ACTION_GROUPS[g.id] = g; });

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

    console.log(`Actions: loaded ${Object.keys(ACTIONS).length} actions, ${Object.keys(ACTION_GROUPS).length} groups, ${Object.keys(MQTT_SERVERS).length} MQTT servers`);

    // Connect servers for the current view context
    connectServersForContext();
  } catch(e) {
    console.warn('Actions: failed to load actions.json', e);
  }
}

// Connect MQTT servers needed for the current view context; disconnect others.
// - If view cycling is enabled: connect servers for all groups across all views.
// - If view cycling is disabled: connect servers for groups in the active view only.
// Called after loadActionsConfig() and after each view change (when cycling is off).
function connectServersForContext() {
  if (typeof mqtt === 'undefined') return;

  // Determine which view(s) to consider
  let groupIds = new Set();
  if (VIEWS_CYCLE && VIEWS.length > 1) {
    // Cycling on — collect groups from all views
    VIEWS.forEach(view => {
      const slotGroups = view.slotGroups;
      if (slotGroups) Object.values(slotGroups).forEach(g => { if (g) groupIds.add(g); });
    });
  } else {
    // Cycling off — only current active view
    const view = typeof getView === 'function' && activeView ? getView(activeView) : null;
    const slotGroups = view && view.slotGroups;
    if (slotGroups) Object.values(slotGroups).forEach(g => { if (g) groupIds.add(g); });
  }

  // Collect all unique mqttServer ids needed by actions in those groups
  const needed = new Set();
  groupIds.forEach(groupId => {
    const group = ACTION_GROUPS[groupId];
    if (!group) return;
    (group.actions || []).forEach(actionId => {
      const action = ACTIONS[actionId];
      if (action && action.type === 'mqtt' && action.mqttServer) {
        needed.add(action.mqttServer);
      }
    });
  });

  // Disconnect servers no longer needed
  _connectedServerIds.forEach(id => {
    if (!needed.has(id)) {
      disconnectMqttClient(id);
      _connectedServerIds.delete(id);
    }
  });

  // Connect newly needed servers
  needed.forEach(serverId => {
    if (!_connectedServerIds.has(serverId)) {
      const serverConfig = MQTT_SERVERS[serverId];
      if (serverConfig) {
        getOrCreateMqttClient(serverConfig);
        _connectedServerIds.add(serverId);
      }
    }
  });

  if (needed.size > 0 || _connectedServerIds.size > 0) {
    console.log(`Actions MQTT: context updated — connected servers: [${[...needed].join(', ') || 'none'}]`);
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

    // Determine if the action's MQTT client is connected
    const isDisabled = action.type === 'mqtt' && (
      !action.mqttServer ||
      !MQTT_SERVERS[action.mqttServer] ||
      !(_mqttClients.get(action.mqttServer) && _mqttClients.get(action.mqttServer).connected)
    );

    const isOn = action.state && ACTION_STATES[action.state.topic] === action.state.onValue;
    const iconHtml = _renderIcon(action.icon);
    const disabledAttr = isDisabled ? ' disabled' : '';
    const disabledClass = isDisabled ? ' disabled' : '';
    return `<button class="action-btn${isOn ? ' on' : ''}${disabledClass}"${disabledAttr} data-action-id="${id}" onclick="pressAction('${id}')">${iconHtml}<span>${action.label || id}</span></button>`;
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

  // Route publish to the correct named MQTT client
  let ok = false;
  if (action.type === 'mqtt' && action.mqttServer) {
    const client = _mqttClients.get(action.mqttServer);
    if (client && client.connected) {
      client.publish(action.publish.topic, action.publish.payload, { qos: 1 });
      ok = true;
    }
  } else if (!action.type || action.type !== 'mqtt') {
    // Fallback to global MQTT for legacy actions without type field
    ok = mqttPublish(action.publish.topic, action.publish.payload);
  }

  if (!ok) {
    if (btn) {
      btn.style.background = 'rgba(248,113,113,0.3)';
      setTimeout(() => { if (btn) btn.style.background = ''; }, 1000);
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
