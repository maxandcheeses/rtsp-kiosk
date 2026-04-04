// ═══════════════════════════════════════════════════════
// MQTT CLIENT
// ═══════════════════════════════════════════════════════
let _mqttClient = null;
let _extraSubscriptions = []; // { topic, callback } registered before connection

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
    reconnectPeriod: 5000,
  };
  if (MQTT_USERNAME) opts.username = MQTT_USERNAME;
  if (MQTT_PASSWORD) opts.password = MQTT_PASSWORD;

  console.log(`MQTT: connecting to ${url}`);
  _mqttClient = mqtt.connect(url, opts);

  _mqttClient.on('connect', () => {
    console.log('MQTT: connected');
    _mqttClient.subscribe(MQTT_TOPIC_STREAM,           { qos: 1 });
    _mqttClient.subscribe(cfg.topicBase + '/view',     { qos: 1 });
    _extraSubscriptions.forEach(sub => _mqttClient.subscribe(sub.topic, { qos: 1 }));
  });

  _mqttClient.on('error',     err => console.error('MQTT error:', err));
  _mqttClient.on('reconnect', ()  => console.log('MQTT: reconnecting...'));

  _mqttClient.on('message', (topic, payload) => {
    let data;
    try { data = JSON.parse(payload.toString()); }
    catch(e) { console.error('MQTT: invalid JSON on', topic, e); return; }

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

// Subscribe to an arbitrary topic and call callback(topic, payloadString) on message.
// Safe to call before MQTT connects — will subscribe on connect.
function mqttSubscribe(topic, callback) {
  _extraSubscriptions.push({ topic, callback });
  if (_mqttClient && _mqttClient.connected) {
    _mqttClient.subscribe(topic, { qos: 1 });
  }
}

// Publish a message. Returns true if sent, false if not connected.
function mqttPublish(topic, payload) {
  if (!_mqttClient || !_mqttClient.connected) return false;
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
