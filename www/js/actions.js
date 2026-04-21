// ═══════════════════════════════════════════════════════
// PANEL ACTIONS — load config, open/close modal, MQTT
// ═══════════════════════════════════════════════════════

const _LS_DISCOVERED_KEY = 'rtsp-kiosk:discovered-actions';

let ACTIONS       = {};  // id → action object
let DISCOVERED_ACTIONS = {};  // id → action object (from MQTT discovery, runtime only)
let ACTION_COLLECTIONS = {};  // id → collection object
let ACTION_STATES = {};  // state topic → last payload string
let ACTIONS_MODAL_OPEN = false;
let _actionsSlotIndex  = null; // which slot triggered the modal
let _actionUnsubscribers = [];
let _connectedServerIds = new Set();
let _actionsConfig = null;  // full parsed config from /actions.json
let _discoveryUnsubscriber = null;  // unsubscribe fn for MQTT discovery topic

function getMergedActions() {
  return { ...DISCOVERED_ACTIONS, ...ACTIONS };
}
let _focusStreamTimer    = null;
let _focusReopenSlot    = null; // slot to reopen actions modal on focus close

const BUILTIN_ACTIONS = {
  'Next View': {
    name: 'Next View', type: 'builtin', description: 'Next View',
    icon: 'mdi:chevron-right', builtin: true,
  },
  'Previous View': {
    name: 'Previous View', type: 'builtin', description: 'Previous View',
    icon: 'mdi:chevron-left', builtin: true,
  },
};

async function loadActionsConfig() {
  // Clean up any previous subscriptions from a prior load
  _actionUnsubscribers.forEach(fn => fn());
  _actionUnsubscribers = [];
  ACTIONS            = {};
  DISCOVERED_ACTIONS = {};
  ACTION_COLLECTIONS = {};
  // Keep ACTION_STATES — values are still valid if topics haven't changed

  // Restore persisted discovered actions (static actions will override below)
  try {
    const stored = JSON.parse(localStorage.getItem(_LS_DISCOVERED_KEY) || '{}');
    DISCOVERED_ACTIONS = stored;
  } catch(e) { DISCOVERED_ACTIONS = {}; }

  try {
    const res = await fetch('/actions.json');
    if (!res.ok) { console.log('Actions: no actions.json found, skipping'); Object.assign(ACTIONS, BUILTIN_ACTIONS); return; }
    const cfg = await res.json();

    _actionsConfig = cfg;

    (cfg.actions      || []).forEach(a => { ACTIONS[a.name] = a; });
    (cfg.collections  || []).forEach(g => { ACTION_COLLECTIONS[g.id] = g; });

    // Merge builtin actions (always available, not stored in config)
    Object.assign(ACTIONS, BUILTIN_ACTIONS);

    // Evict any persisted discovered actions that conflict with static actions
    Object.keys(DISCOVERED_ACTIONS).forEach(name => {
      if (ACTIONS[name]) delete DISCOVERED_ACTIONS[name];
    });

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

    initDiscovery(cfg.discovery);

    // Per-broker discovery topics
    const servers2 = (cfg.mqtt && cfg.mqtt.servers) || [];
    servers2.forEach(srv => {
      if (!srv.discoveryTopic) return;
      const unsub = mqttSubscribe(srv.discoveryTopic + '/+', handleDiscoveryMessage);
      _actionUnsubscribers.push(unsub);
    });

    console.log(`Actions: loaded ${Object.keys(ACTIONS).length} actions, ${Object.keys(ACTION_COLLECTIONS).length} collections`);
  } catch(e) {
    console.warn('Actions: failed to load actions.json', e);
  }
  // Always ensure builtins are available regardless of config load success
  Object.assign(ACTIONS, BUILTIN_ACTIONS);
}

function _connectServersForCollection(collectionId) {
  const collection = ACTION_COLLECTIONS[collectionId];
  if (!collection) return;

  const needed = new Set();
  (collection.actions || []).forEach(actionId => {
    const action = getMergedActions()[actionId];
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
  const slotCollections = view && view.slotCollections;
  const collectionId = slotCollections && slotCollections[slotIndex];
  if (!collectionId) return;
  if (!ACTION_COLLECTIONS[collectionId] && !getMergedActions()[collectionId]) {
    console.warn(`Actions: "${collectionId}" not found as collection or action`);
    return;
  }

  // Direct action (not a collection) — execute immediately, no modal
  if (!ACTION_COLLECTIONS[collectionId] && getMergedActions()[collectionId]) {
    _actionsSlotIndex = slotIndex;
    pressAction(collectionId);
    _actionsSlotIndex = null;
    return;
  }

  _actionsSlotIndex = slotIndex;
  _renderActionButtons(collectionId);

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

function _renderActionButtons(collectionId) {
  // Support direct action assignment (slotCollections can reference an action id directly)
  let collection = ACTION_COLLECTIONS[collectionId];
  if (!collection && getMergedActions()[collectionId]) {
    collection = { id: collectionId, name: '', actions: [collectionId] };
  }
  if (!collection) return;

  // Connect/disconnect named MQTT servers as needed for this collection
  _connectServersForCollection(collectionId);

  const _typeOrder = id => { const a = getMergedActions()[id]; if (!a) return 2; if (a.type === 'builtin') return 0; if (a.type === 'focus-stream') return 1; return 2; };
  const actionIds = (collection.actions || []).slice().sort((a, b) => _typeOrder(a) - _typeOrder(b)).slice(0, 6);
  const statusEl = document.getElementById('actions-mqtt-status');
  if (statusEl) {
    const hasMqtt = actionIds.some(id => getMergedActions()[id] && getMergedActions()[id].publish);
    statusEl.style.display = hasMqtt ? '' : 'none';
  }
  if (collection.actions && collection.actions.length > 6) {
    console.warn(`Actions: collection "${collectionId}" has ${collection.actions.length} actions; only first 6 shown`);
  }

  const servers = (_actionsConfig && _actionsConfig.mqtt && _actionsConfig.mqtt.servers) || [];

  const grid = document.getElementById('actions-grid');
  grid.setAttribute('data-count', actionIds.length);
  grid.innerHTML = actionIds.map(id => {
    const action = getMergedActions()[id];
    if (!action) { console.warn(`Actions: action "${id}" not found`); return ''; }

    // Determine if the action's MQTT server is present and connected
    let isDisabled = false;
    if (action.builtin || action.type === 'focus-stream') {
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

    const hasStateData = action.state && (action.state.topic in ACTION_STATES);
    const isOn = hasStateData && ACTION_STATES[action.state.topic] === action.state.onValue;
    const isUnknown = action.state && !hasStateData;
    const iconHtml = _renderIcon(action.icon);
    const disabledAttr = isDisabled ? ' disabled' : '';
    const disabledClass = isDisabled ? ' disabled' : '';
    return `<button class="action-btn${isOn ? ' on' : ''}${isUnknown ? ' state-unknown' : ''}${disabledClass}"${disabledAttr} data-action-id="${id}" onclick="pressAction('${id}')">${iconHtml}<span>${action.description || id}</span></button>`;
  }).join('');
}

function _onMqttDisconnect(serverId) {
  if (serverId) {
    Object.values(getMergedActions()).forEach(a => {
      if (a.state && a.mqttServer === serverId) delete ACTION_STATES[a.state.topic];
    });
  } else {
    Object.keys(ACTION_STATES).forEach(k => delete ACTION_STATES[k]);
  }
  if (ACTIONS_MODAL_OPEN) _refreshActionButtons();
}

function _refreshActionButtons() {
  const view = typeof getView === 'function' ? getView(activeView) : null;
  const slotCollections = view && view.slotCollections;
  const collectionId = slotCollections && _actionsSlotIndex !== null && slotCollections[_actionsSlotIndex];
  if (collectionId) _renderActionButtons(collectionId);
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
  const action = getMergedActions()[actionId];
  if (!action) return;

  // Handle builtin actions (next/prev view)
  if (action.type === 'builtin') {
    if (actionId === 'Next View') { if (typeof navigateView === 'function') navigateView(1); }
    if (actionId === 'Previous View') { if (typeof navigateView === 'function') navigateView(-1); }
    closeActionsModal();
    return;
  }

  // Handle focus-stream actions
  if (action.type === 'focus-stream') {
    const panelSlot = (typeof action.panel === 'number' && action.panel >= 0) ? action.panel : _actionsSlotIndex;
    let keepOpen = false;
    try { keepOpen = localStorage.getItem('actionsKeepOpen') === 'true'; } catch(e) {}
    closeActionsModal();
    openFocusStream(panelSlot, action.timeout || 0, keepOpen ? panelSlot : null);
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

function openFocusStream(slotIndex, timeout, reopenSlot) {
  _focusReopenSlot = reopenSlot !== undefined ? reopenSlot : null;
  // Pause cycling if active
  if (typeof pauseCycle === 'function') pauseCycle();

  // Clone the video source from the cell
  const srcVideo = document.getElementById(`v${slotIndex}`);
  const destVideo = document.getElementById('focus-stream-video');
  if (srcVideo && destVideo) {
    if (srcVideo.srcObject) {
      destVideo.srcObject = srcVideo.srcObject;
    } else {
      destVideo.src = srcVideo.src;
    }
    destVideo.play().catch(() => {});
  }

  document.getElementById('focus-stream-overlay').classList.add('open');

  const countdownEl = document.getElementById('focus-stream-countdown');
  if (timeout && timeout > 0) {
    let remaining = timeout;
    countdownEl.textContent = `Auto-closing in ${remaining}s`;
    _focusStreamTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) { closeFocusStream(); }
      else { countdownEl.textContent = `Auto-closing in ${remaining}s`; }
    }, 1000);
  } else {
    countdownEl.textContent = '';
  }
}

function closeFocusStream() {
  if (_focusStreamTimer) { clearInterval(_focusStreamTimer); _focusStreamTimer = null; }
  document.getElementById('focus-stream-overlay').classList.remove('open');
  const destVideo = document.getElementById('focus-stream-video');
  if (destVideo) { try { destVideo.srcObject = null; } catch(e) {} destVideo.src = ''; }
  if (typeof resumeCycle === 'function') resumeCycle();
  const reopen = _focusReopenSlot;
  _focusReopenSlot = null;
  // Only reopen actions modal if the slot points to a COLLECTION (not a direct action)
  // to prevent an infinite loop where a direct focus-stream action re-opens focus
  if (reopen !== null) {
    const view = typeof getView === 'function' ? getView(activeView) : null;
    const slotCollectionId = view && view.slotCollections && view.slotCollections[reopen];
    if (slotCollectionId && ACTION_COLLECTIONS[slotCollectionId]) {
      openActionsModal(reopen);
    }
  }
}

function saveKeepOpen() {
  const el = document.getElementById('actions-keep-open');
  if (!el) return;
  try { localStorage.setItem('actionsKeepOpen', el.checked ? 'true' : 'false'); } catch(e) {}
}

// ── MQTT Discovery ────────────────────────────────────────────────────────────

function _saveDiscovered() {
  try { localStorage.setItem(_LS_DISCOVERED_KEY, JSON.stringify(DISCOVERED_ACTIONS)); } catch(e) {}
  _refreshDiscoveredActions();
}

function handleDiscoveryMessage(topic, payload) {
  const name = topic.split('/').pop();
  if (payload === null || payload === '' || payload === 'null') {
    delete DISCOVERED_ACTIONS[name];
    _saveDiscovered();
    return;
  }
  let parsed;
  try { parsed = JSON.parse(payload); } catch(e) { console.warn(`discovery: invalid JSON for "${name}"`, e); return; }
  if (ACTIONS[name]) { console.log(`discovery: static action wins for "${name}"`); return; }
  DISCOVERED_ACTIONS[name] = { name, ...parsed };
  _saveDiscovered();
}

function _refreshDiscoveredActions() {
  if (ACTIONS_MODAL_OPEN) _refreshActionButtons();
  if (typeof renderActionsEditor === 'function') {
    const el = document.getElementById('ae-content');
    if (el) renderActionsEditor();
  }
}

function initDiscovery(cfg) {
  if (_discoveryUnsubscriber) { _discoveryUnsubscriber(); _discoveryUnsubscriber = null; }
  if (!cfg || !cfg.enabled) return;
  _discoveryUnsubscriber = mqttSubscribe(cfg.topic + '/+', handleDiscoveryMessage);
  if (cfg.mqttServer) {
    const servers = (_actionsConfig && _actionsConfig.mqtt && _actionsConfig.mqtt.servers) || [];
    const srv = servers.find(s => s.id === cfg.mqttServer);
    if (srv) getOrCreateMqttClient(srv.id, srv);
  }
}
