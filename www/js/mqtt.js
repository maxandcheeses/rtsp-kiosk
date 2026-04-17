// ═══════════════════════════════════════════════════════
// MQTT CLIENT
// ═══════════════════════════════════════════════════════
let _mqttClient = null;

// Named MQTT client pool — keyed by server id (for actions multi-server support)
const _mqttClients = new Map();

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
  _mqttClients.set(serverId, client);
  console.log(`MQTT: connecting named client "${serverId}" to ${serverCfg.broker}`);
  return client;
}

function disconnectMqttClient(serverId) {
  const client = _mqttClients.get(serverId);
  if (client) { client.end(true); _mqttClients.delete(serverId); console.log(`MQTT: disconnected named client "${serverId}"`); }
}

let _extraSubscriptions = []; // { topic, callback } registered before connection

let _mqttConnected   = false;
let _mqttConnecting  = false;
let _mqttReconnDelay = 1000;
let _mqttReconnTimer = null;
let _mqttPublishQueue = [];
const _MQTT_QUEUE_MAX = 20;
const _MQTT_DELAY_MAX = 30000;

function _mqttScheduleReconnect() {
  if (_mqttReconnTimer) return;
  _mqttReconnTimer = setTimeout(() => {
    _mqttReconnTimer = null;
    if (_mqttClient) {
      console.log(`MQTT: reconnecting (backoff ${_mqttReconnDelay}ms)`);
      _mqttClient.reconnect();
      _mqttConnecting = true;
      _updateMqttStatusIndicator();
    }
    _mqttReconnDelay = Math.min(_mqttReconnDelay * 2, _MQTT_DELAY_MAX);
  }, _mqttReconnDelay);
}

function startMQTT() {
  if (typeof mqtt === 'undefined') {
    console.warn('MQTT: mqtt.js not loaded');
    return;
  }

  // Merge streams.json mqtt block over defaults
  const cfg = Object.assign({}, MQTT_DEFAULTS, MQTT_CONFIG || {});
  if (!cfg.enabled) { console.log('MQTT: disabled'); return; }

  MQTT_ENABLED      = true;
  MQTT_HOST         = cfg.host;
  MQTT_PORT         = cfg.port;
  MQTT_TLS          = cfg.tls;
  MQTT_USERNAME     = cfg.username;
  MQTT_PASSWORD     = cfg.password;
  MQTT_TOPIC_ALL    = cfg.topicBase;
  MQTT_TOPIC_STREAM = cfg.topicBase + '/+';

  const protocol = MQTT_TLS ? 'wss' : 'ws';
  const url      = `${protocol}://${MQTT_HOST}:${MQTT_PORT}/mqtt`;
  const opts     = {
    clientId:        'rtsp-kiosk-' + Math.random().toString(16).slice(2, 8),
    clean:           true,
    reconnectPeriod: 0,
  };
  if (MQTT_USERNAME) opts.username = MQTT_USERNAME;
  if (MQTT_PASSWORD) opts.password = MQTT_PASSWORD;

  console.log(`MQTT: connecting to ${url}`);
  _mqttClient = mqtt.connect(url, opts);
  _mqttConnecting = true;
  _updateMqttStatusIndicator();

  _mqttClient.on('connect', () => {
    _mqttConnecting = false;
    _mqttConnected = true;
    _mqttReconnDelay = 1000;
    if (_mqttReconnTimer) { clearTimeout(_mqttReconnTimer); _mqttReconnTimer = null; }
    const queued = _mqttPublishQueue.splice(0);
    queued.forEach(q => _mqttClient.publish(q.topic, q.payload, { qos: 1 }));
    if (queued.length) console.log(`MQTT: flushed ${queued.length} queued publish(es)`);
    _updateMqttStatusIndicator();
    console.log('MQTT: connected');
    _mqttClient.subscribe(MQTT_TOPIC_STREAM,           { qos: 1 });
    _mqttClient.subscribe(cfg.topicBase + '/view',     { qos: 1 });
    _extraSubscriptions.forEach(sub => _mqttClient.subscribe(sub.topic, { qos: 1 }));
  });

  _mqttClient.on('error', err => {
    console.error('MQTT error:', err);
    _mqttConnected = false;
    _updateMqttStatusIndicator();
  });
  _mqttClient.on('close', () => {
    _mqttConnected = false;
    _updateMqttStatusIndicator();
    _mqttScheduleReconnect();
  });

  _mqttClient.on('message', (topic, payload) => {
    let data;
    try { data = JSON.parse(payload.toString()); }
    catch(e) {
      // Non-JSON payloads are valid for action state topics — skip silently
      if (!_extraSubscriptions.some(s => s.topic === topic)) {
        console.error('MQTT: invalid JSON on', topic, e);
      }
      return;
    }

    // View control — topic: <topicBase>/view
    const viewTopic = cfg.topicBase + '/view';
    if (topic === viewTopic) {
      // payload: { "name": "front", "duration": 30 }
      // duration -1 = stay forever, 0 = remove from current view
      const viewName = data.name;
      if (!viewName) return;

      if (data.duration === 0) {
        // Remove this view override — return to default
        console.log(`MQTT: removing view override, returning to default`);
        clearCycle();
        if (VIEWS_DEFAULT) activateView(VIEWS_DEFAULT);
        return;
      }

      // Find or create a temporary view from the payload
      const existing = getView(viewName);
      if (existing) {
        const override = Object.assign({}, existing,
          data.duration !== undefined ? { duration: data.duration } : {}
        );
        // Temporarily inject override
        const idx = VIEWS.findIndex(v => v.name === viewName);
        VIEWS[idx] = override;
        activateView(viewName);
        VIEWS[idx] = existing; // restore original after activation
      } else {
        console.warn(`MQTT: view not found: ${viewName}`);
      }
      return;
    }

    // Per-stream update — topic suffix is the stream path
    const streamPath = topic.split('/').pop();
    if (!streamPath) return;

    data.path = data.path || streamPath;
    console.log(`MQTT: update for stream ${data.path}`);
    applyStreamUpdates([data]);
  });

  // Dispatch to extra subscribers (raw payload string, not JSON-parsed)
  _mqttClient.on('message', (topic, payload) => {
    _extraSubscriptions.forEach(sub => {
      if (sub.topic === topic) sub.callback(topic, payload.toString());
    });
  });
}

// Connect the global MQTT client to an explicit broker URL.
// Used by actions.js when actions.json specifies its own broker.
// No-op if the global client is already connected.
function mqttConnect(broker, username, password) {
  if (_mqttClient && _mqttClient.connected) return;
  if (typeof mqtt === 'undefined') { console.warn('MQTT: mqtt.js not loaded'); return; }

  const opts = {
    clientId: 'rtsp-kiosk-act-' + Math.random().toString(16).slice(2, 8),
    clean: true,
    reconnectPeriod: 0,
  };
  if (username) opts.username = username;
  if (password) opts.password = password;

  console.log(`MQTT (actions): connecting to ${broker}`);
  _mqttClient = mqtt.connect(broker, opts);
  _mqttConnecting = true;
  _updateMqttStatusIndicator();

  _mqttClient.on('connect', () => {
    _mqttConnecting = false;
    _mqttConnected = true;
    _mqttReconnDelay = 1000;
    if (_mqttReconnTimer) { clearTimeout(_mqttReconnTimer); _mqttReconnTimer = null; }
    const queued = _mqttPublishQueue.splice(0);
    queued.forEach(q => _mqttClient.publish(q.topic, q.payload, { qos: 1 }));
    if (queued.length) console.log(`MQTT: flushed ${queued.length} queued publish(es)`);
    _updateMqttStatusIndicator();
    console.log('MQTT (actions): connected');
    _extraSubscriptions.forEach(sub => _mqttClient.subscribe(sub.topic, { qos: 1 }));
  });
  _mqttClient.on('error', err => {
    console.error('MQTT (actions) error:', err);
    _mqttConnected = false;
    _updateMqttStatusIndicator();
  });
  _mqttClient.on('close', () => {
    _mqttConnected = false;
    _updateMqttStatusIndicator();
    _mqttScheduleReconnect();
  });
  _mqttClient.on('message', (topic, payload) => {
    _extraSubscriptions.forEach(sub => {
      if (sub.topic === topic) sub.callback(topic, payload.toString());
    });
  });
}

// Subscribe to an arbitrary topic and call callback(topic, payloadString) on message.
// Safe to call before MQTT connects — will subscribe on connect.
// Returns an unsubscribe function — call it to stop receiving messages.
function mqttSubscribe(topic, callback) {
  const entry = { topic, callback };
  _extraSubscriptions.push(entry);
  if (_mqttClient && _mqttClient.connected) {
    _mqttClient.subscribe(topic, { qos: 1 });
  }
  return function unsubscribe() {
    const idx = _extraSubscriptions.indexOf(entry);
    if (idx >= 0) _extraSubscriptions.splice(idx, 1);
    // Note: intentionally does NOT call _mqttClient.unsubscribe — suppressing
    // at the callback level is sufficient and avoids unsubscribing shared topics.
  };
}

// Publish a message. Returns true if sent, false if not connected (queues the message).
function mqttPublish(topic, payload) {
  if (!_mqttClient || !_mqttClient.connected) {
    if (_mqttPublishQueue.length < _MQTT_QUEUE_MAX) {
      _mqttPublishQueue.push({ topic, payload });
      console.log(`MQTT: queued publish to ${topic} (disconnected)`);
    }
    return false;
  }
  _mqttClient.publish(topic, payload, { qos: 1 });
  return true;
}

// Apply stream config updates from MQTT.
// Fields explicitly set in streams.json are locked and cannot be overridden.
function applyStreamUpdates(updates) {
  let layoutChanged = false;

  updates.forEach(update => {
    const idx      = STREAMS.findIndex(s => s.path === update.path);
    const locked   = STREAMS_STATIC[update.path] || [];

    // Remove any fields from the MQTT payload that are locked in streams.json
    const filtered = Object.assign({}, update);
    locked.forEach(key => {
      if (key in filtered && key !== 'path') {
        console.log(`MQTT: ignoring locked field '${key}' for ${update.path}`);
        delete filtered[key];
      }
    });

    if (idx === -1) {
      // New stream not in streams.json — add it entirely from MQTT
      STREAMS.push(filtered);
      layoutChanged = true;
      console.log(`MQTT: added new stream ${update.path}`);
    } else {
      // Merge filtered MQTT fields into existing stream config
      const existing = STREAMS[idx];
      const merged   = Object.assign({}, existing, filtered);
      const hasChange = JSON.stringify(existing) !== JSON.stringify(merged);

      if (hasChange) {
        STREAMS[idx] = merged;
        console.log(`MQTT: updated stream ${update.path} — reconnecting`);
        // Tear down existing WebRTC connection and restart
        if (streamPCs[idx]) {
          try { streamPCs[idx].close(); } catch(e) {}
          delete streamPCs[idx];
        }
        resetRetry(idx);
        if (document.getElementById(`v${idx}`)) startWhep(idx);
      }
    }
  });

  // Reapply layout if new streams were added
  if (layoutChanged) {
    const currentLayout = document.getElementById('wall').dataset.layout;
    if (currentLayout) applyLayout(currentLayout);
  }
}

function _updateMqttStatusIndicator() {
  const el = document.getElementById('actions-mqtt-status');
  if (!el) return;

  // Determine which MQTT server IDs are needed by the current modal's group
  let neededServerIds = new Set();
  if (typeof _actionsSlotIndex !== 'undefined' && _actionsSlotIndex !== null &&
      typeof getView === 'function' && typeof activeView !== 'undefined') {
    const view = getView(activeView);
    const slotGroups = view && view.slotGroups;
    const groupId = slotGroups && slotGroups[_actionsSlotIndex];
    const group = groupId && typeof ACTION_GROUPS !== 'undefined' && ACTION_GROUPS[groupId];
    if (group) {
      (group.actions || []).forEach(actionId => {
        const action = typeof ACTIONS !== 'undefined' && ACTIONS[actionId];
        if (action && action.type === 'mqtt' && action.mqttServer) {
          neededServerIds.add(action.mqttServer);
        }
      });
    }
  }

  // If named servers are needed, compute status from _mqttClients
  if (neededServerIds.size > 0) {
    let anyDisconnected = false;
    let anyConnecting   = false;
    const disconnectedIds = [];

    neededServerIds.forEach(id => {
      const client = _mqttClients.get(id);
      if (!client) {
        anyDisconnected = true;
        disconnectedIds.push(id);
      } else if (!client.connected) {
        anyConnecting = true;
      }
    });

    el.textContent = '● MQTT';
    if (anyDisconnected) {
      el.style.color = 'rgba(248,113,113,0.7)';
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'pointer';
      el.onclick = () => {
        const servers = (typeof _actionsConfig !== 'undefined' && _actionsConfig &&
                         _actionsConfig.mqtt && _actionsConfig.mqtt.servers) || [];
        disconnectedIds.forEach(id => {
          const cfg = servers.find(s => s.id === id);
          if (cfg) getOrCreateMqttClient(id, cfg);
        });
        _updateMqttStatusIndicator();
      };
    } else if (anyConnecting) {
      el.style.color = 'rgba(251,191,36,0.7)';
      el.style.pointerEvents = 'none';
      el.style.cursor = '';
      el.onclick = null;
    } else {
      // All connected
      el.style.color = 'rgba(74,222,128,0.7)';
      el.style.pointerEvents = 'none';
      el.style.cursor = '';
      el.onclick = null;
    }
    return;
  }

  // Fallback: legacy single-broker global state
  if (_mqttConnected) {
    el.textContent = '● MQTT';
    el.style.color = 'rgba(74,222,128,0.7)';
    el.style.pointerEvents = 'none';
    el.style.cursor = '';
    el.onclick = null;
  } else if (_mqttConnecting) {
    el.textContent = '● MQTT';
    el.style.color = 'rgba(251,191,36,0.7)';
    el.style.pointerEvents = 'none';
    el.style.cursor = '';
    el.onclick = null;
  } else {
    el.textContent = '● MQTT';
    el.style.color = 'rgba(248,113,113,0.7)';
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.onclick = mqttForceReconnect;
  }
}

function mqttForceReconnect() {
  if (!_mqttClient) return;
  // Cancel pending backoff timers for both MQTT paths
  if (_mqttReconnTimer) { clearTimeout(_mqttReconnTimer); _mqttReconnTimer = null; }
  if (typeof _actMqttReconnTimer !== 'undefined' && _actMqttReconnTimer) {
    clearTimeout(_actMqttReconnTimer);
    _actMqttReconnTimer = null;
  }
  // Reset delays
  _mqttReconnDelay = 1000;
  if (typeof _actMqttReconnDelay !== 'undefined') _actMqttReconnDelay = 1000;
  // Trigger reconnect
  _mqttConnecting = true;
  _updateMqttStatusIndicator();
  console.log('MQTT: force reconnect requested');
  _mqttClient.reconnect();
}
