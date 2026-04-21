// ═══════════════════════════════════════════════════════
// PANEL ACTIONS — load config, open/close modal, MQTT
// ═══════════════════════════════════════════════════════

const _LS_DISCOVERED_KEY = 'rtsp-kiosk:discovered-actions';

let ACTIONS       = {};  // id → action object (static + discovered merged; static wins)
let _STATIC_ACTIONS = new Set();  // names that came from actions.json or builtins
let ACTION_COLLECTIONS = {};  // id → collection object
let ACTION_STATES = {};  // state topic → last payload string
let ACTIONS_MODAL_OPEN = false;
let _actionsSlotIndex  = null; // which slot triggered the modal
let _actionUnsubscribers = [];
let _toggleStates = {};
let _connectedServerIds = new Set();
let _actionsConfig = null;  // full parsed config from /actions.json
let _discoveryUnsubscriber = null;  // unsubscribe fn for MQTT discovery topic

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
  _STATIC_ACTIONS    = new Set();
  ACTION_COLLECTIONS = {};
  // Keep ACTION_STATES — values are still valid if topics haven't changed

  try {
    const res = await fetch('/actions.json');
    if (!res.ok) { console.log('Actions: no actions.json found, skipping'); Object.assign(ACTIONS, BUILTIN_ACTIONS); _STATIC_ACTIONS = new Set(Object.keys(BUILTIN_ACTIONS)); return; }
    const cfg = await res.json();

    _actionsConfig = cfg;

    (cfg.actions      || []).forEach(a => { ACTIONS[a.name] = a; _STATIC_ACTIONS.add(a.name); });
    (cfg.collections  || []).forEach(g => { ACTION_COLLECTIONS[g.id] = g; });

    // Merge builtin actions (always available, not stored in config)
    Object.assign(ACTIONS, BUILTIN_ACTIONS);
    Object.keys(BUILTIN_ACTIONS).forEach(k => _STATIC_ACTIONS.add(k));

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
  const _merged = getMergedActions();
  (collection.actions || []).forEach(actionId => {
    const action = _merged[actionId];
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
  const _merged = getMergedActions();
  if (!ACTION_COLLECTIONS[collectionId] && !_merged[collectionId]) {
    console.warn(`Actions: "${collectionId}" not found as collection or action`);
    return;
  }

  // Direct action (not a collection) — execute immediately, no modal
  if (!ACTION_COLLECTIONS[collectionId] && _merged[collectionId]) {
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
  const _merged = getMergedActions();
  let collection = ACTION_COLLECTIONS[collectionId];
  if (!collection && _merged[collectionId]) {
    collection = { id: collectionId, name: '', actions: [collectionId] };
  }
  if (!collection) return;

  // Connect/disconnect named MQTT servers as needed for this collection
  _connectServersForCollection(collectionId);

  const _typeOrder = id => { const a = _merged[id]; if (!a) return 2; if (a.type === 'builtin') return 0; if (a.type === 'focus-stream') return 1; return 2; };
  const actionIds = (collection.actions || []).slice().sort((a, b) => _typeOrder(a) - _typeOrder(b)).slice(0, 6);
  const statusEl = document.getElementById('actions-mqtt-status');
  if (statusEl) {
    const hasMqtt = actionIds.some(id => _merged[id] && _merged[id].publish);
    statusEl.style.display = hasMqtt ? '' : 'none';
  }
  if (collection.actions && collection.actions.length > 6) {
    console.warn(`Actions: collection "${collectionId}" has ${collection.actions.length} actions; only first 6 shown`);
  }

  const servers = (_actionsConfig && _actionsConfig.mqtt && _actionsConfig.mqtt.servers) || [];

  const grid = document.getElementById('actions-grid');
  grid.setAttribute('data-count', actionIds.length);
  grid.innerHTML = actionIds.map(id => {
    const action = _merged[id];
    if (!action) { console.warn(`Actions: action "${id}" not found`); return ''; }

    // Determine if the action's MQTT server is present and connected
    let isDisabled = false;
    if (action.builtin || action.type === 'focus-stream') {
      isDisabled = false;
    } else if (action.type === 'mqtt' || action.type === 'toggle') {
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

    let isOn = false;
    let isUnknown = false;
    if (action.type === 'toggle') {
      if (action.state && action.state.topic && ACTION_STATES[action.state.topic] !== undefined) {
        isOn = ACTION_STATES[action.state.topic] === action.state.onValue;
      } else {
        isOn = _toggleStates[id] ?? false;
      }
      isUnknown = !!(action.state && action.state.topic && !(action.state.topic in ACTION_STATES));
    } else {
      const hasStateData = action.state && (action.state.topic in ACTION_STATES);
      isOn = !!(hasStateData && ACTION_STATES[action.state.topic] === action.state.onValue);
      isUnknown = !!(action.state && !hasStateData);
    }
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
  if (action.type === 'toggle' && (!action.publish.payloadOn || !action.publish.payloadOff)) return;

  const btn = document.querySelector(`[data-action-id="${actionId}"]`);

  let payload;
  if (action.type === 'toggle') {
    let isOn = false;
    if (action.state && action.state.topic && ACTION_STATES[action.state.topic] !== undefined) {
      isOn = ACTION_STATES[action.state.topic] === action.state.onValue;
    } else {
      isOn = _toggleStates[actionId] ?? false;
    }
    payload = isOn ? action.publish.payloadOff : action.publish.payloadOn;
    _toggleStates[actionId] = !isOn;
    _refreshActionButtons();
  } else {
    payload = action.publish.payload;
  }

  // Publish via named client if the action specifies a server, else fall back to global client
  const ok = action.mqttServer
    ? mqttPublishNamed(action.mqttServer, action.publish.topic, payload)
    : mqttPublish(action.publish.topic, payload);

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

let DISCOVERED_ACTIONS = {};
let _discoveryConfig = {};

function getMergedActions() {
  return { ...DISCOVERED_ACTIONS, ...ACTIONS };
}

function _extractDiscoveryKey(topic, prefix) {
  const withoutPrefix = topic.slice(prefix.length + 1);
  const parts = withoutPrefix.split('/');
  const keyParts = parts.slice(1, parts.length - 1);
  return keyParts.join('/');
}

function _resolveMqttServer(haPayload, discoveryCfg) {
  return discoveryCfg.mqttServer || null;
}

function parseHaPayload(component, haPayload, key, discoveryCfg) {
  const resolvedComponent = haPayload.component || component;
  const mqttServer = _resolveMqttServer(haPayload, discoveryCfg);
  const base = {
    name: key,
    description: haPayload.name || haPayload.friendly_name || key,
    icon: haPayload.icon,
    mqttServer,
  };
  switch (resolvedComponent) {
    case 'button':
      return {
        ...base,
        type: 'mqtt',
        icon: base.icon || 'mdi:gesture-tap-button',
        publish: {
          topic: haPayload.command_topic,
          payload: haPayload.payload_press ?? 'PRESS',
        },
      };
    case 'switch':
    case 'light': {
      const action = {
        ...base,
        type: 'toggle',
        icon: base.icon || (resolvedComponent === 'light' ? 'mdi:lightbulb' : 'mdi:toggle-switch'),
        publish: {
          topic: haPayload.command_topic,
          payloadOn: haPayload.payload_on ?? 'ON',
          payloadOff: haPayload.payload_off ?? 'OFF',
        },
      };
      if (haPayload.state_topic) {
        action.state = { topic: haPayload.state_topic, onValue: haPayload.state_on ?? 'ON' };
      }
      return action;
    }
    case 'lock': {
      const action = {
        ...base,
        type: 'toggle',
        icon: base.icon || 'mdi:lock',
        publish: {
          topic: haPayload.command_topic,
          payloadOn: haPayload.payload_lock ?? 'LOCK',
          payloadOff: haPayload.payload_unlock ?? 'UNLOCK',
        },
      };
      if (haPayload.state_topic) {
        action.state = { topic: haPayload.state_topic, onValue: haPayload.state_locked ?? 'LOCKED' };
      }
      return action;
    }
    default:
      console.warn(`[discovery] unsupported component type: ${resolvedComponent}`);
      return null;
  }
}

function handleNativeDiscoveryMessage(topic, rawPayload) {
  const key = topic.split('/').pop();

  if (!rawPayload || rawPayload === '' || rawPayload === 'null') {
    if (DISCOVERED_ACTIONS[key]) {
      delete DISCOVERED_ACTIONS[key];
      _refreshActionButtons();
    }
    return;
  }

  let action;
  try {
    action = JSON.parse(rawPayload);
  } catch (e) {
    console.warn(`[discovery] malformed JSON on ${topic}:`, e.message);
    return;
  }

  if (ACTIONS[key]) {
    console.info(`[discovery] static action wins for "${key}" — skipping`);
    return;
  }

  DISCOVERED_ACTIONS[key] = { name: key, ...action };
  _refreshActionButtons();
  if (typeof renderActionsEditor === 'function') {
    const el = document.getElementById('ae-content');
    if (el) renderActionsEditor();
  }
}

function handleDiscoveryMessage(topic, rawPayload) {
  const prefix = _discoveryConfig.prefix || 'homeassistant';
  const key = _extractDiscoveryKey(topic, prefix);
  const componentFromTopic = topic.split('/')[1];

  if (!rawPayload || rawPayload === '' || rawPayload === 'null') {
    if (DISCOVERED_ACTIONS[key]) {
      delete DISCOVERED_ACTIONS[key];
      _refreshActionButtons();
    }
    return;
  }

  let haPayload;
  try {
    haPayload = JSON.parse(rawPayload);
  } catch (e) {
    console.warn(`[discovery] malformed JSON on ${topic}:`, e.message);
    return;
  }

  if (ACTIONS[key]) {
    console.info(`[discovery] static action wins for "${key}" — skipping`);
    return;
  }

  const action = parseHaPayload(componentFromTopic, haPayload, key, _discoveryConfig);
  if (!action) return;

  DISCOVERED_ACTIONS[key] = action;
  _refreshActionButtons();
  if (typeof renderActionsEditor === 'function') {
    const el = document.getElementById('ae-content');
    if (el) renderActionsEditor();
  }
}

function initDiscovery(cfg) {
  if (_discoveryUnsubscriber) { _discoveryUnsubscriber(); _discoveryUnsubscriber = null; }
  if (!cfg) return;
  const servers = (_actionsConfig && _actionsConfig.mqtt && _actionsConfig.mqtt.servers) || [];
  const srv = cfg.mqttServer ? servers.find(s => s.id === cfg.mqttServer) : null;
  if (!cfg.enabled && !(srv && srv.discoveryTopic)) return;
  if (srv) getOrCreateMqttClient(srv.id, srv);
  const prefix = (srv && srv.discoveryTopic) || cfg.prefix || 'homeassistant';
  _discoveryConfig = { ...cfg, prefix };
  const unsub1 = mqttSubscribe(`${prefix}/+/+/config`, handleDiscoveryMessage);
  const unsub2 = mqttSubscribe(`${prefix}/+/+/+/config`, handleDiscoveryMessage);
  const unsub3 = mqttSubscribe(`${prefix}/+`, handleNativeDiscoveryMessage);
  _discoveryUnsubscriber = () => { unsub1(); unsub2(); unsub3(); };
}
