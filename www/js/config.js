// ═══════════════════════════════════════════════════════
// CONFIG — edit these to match your mediamtx.yml paths
// ═══════════════════════════════════════════════════════
const MEDIAMTX_HOST = window.location.hostname;
const MEDIAMTX_PORT = 8889;

// ═══════════════════════════════════════════════════════
// MQTT CONFIG
// Set MQTT_ENABLED to true to receive stream config from
// an MQTT broker instead of (or in addition to) streams.json.
//
// Topics:
//   MQTT_TOPIC_ALL      — full streams array (JSON array)
//                         published on connect / retained
//   MQTT_TOPIC_STREAM   — per-stream updates (JSON object)
//                         topic: <prefix>/<path> e.g. kiosk/streams/cam1
//
// Auth:
//   Leave MQTT_USERNAME/PASSWORD empty for no-auth.
//   Set MQTT_TLS: true for wss:// connection.
// ═══════════════════════════════════════════════════════
// MQTT config can be set here as defaults, or loaded from streams.json:
// { "streams": [...], "mqtt": { "enabled": true, "host": "...", ... } }
// streams.json values take precedence over these defaults.
const MQTT_DEFAULTS = {
  enabled:    false,
  host:       window.location.hostname,
  port:       9001,           // EMQX WebSocket default (not 1883)
  tls:        false,          // true = wss://, false = ws://
  username:   '',
  password:   '',
  topicBase:  'kiosk/streams', // per-stream: kiosk/streams/<path>
};

// Resolved at boot after streams.json is loaded — see startMQTT()
let MQTT_ENABLED, MQTT_HOST, MQTT_PORT, MQTT_TLS,
    MQTT_USERNAME, MQTT_PASSWORD, MQTT_TOPIC_ALL, MQTT_TOPIC_STREAM;



// ═══════════════════════════════════════════════════════
// STREAM CONFIG — loaded from /streams.json at startup.
// Edit data/streams.json to add, remove, or configure streams.
// No container restart needed — just refresh the browser.
// ═══════════════════════════════════════════════════════
let STREAMS = [];
let STREAMS_STATIC = {};  // fields locked from streams.json — MQTT cannot override these
let MQTT_CONFIG    = null; // mqtt block from streams.json

async function loadStreams() {
  try {
    const res = await fetch('/streams.json');
    if (!res.ok) throw new Error(`Failed to load streams.json: ${res.status}`);
    const data = await res.json();

    // streams.json can be either:
    //   [ ...streams ]              — array only (legacy)
    //   { streams: [...], mqtt: {} } — object with streams + mqtt config
    if (Array.isArray(data)) {
      STREAMS = data;
    } else {
      STREAMS     = data.streams || [];
      MQTT_CONFIG = data.mqtt   || null;
    }

    // Record which fields are explicitly set per stream in streams.json
    // These will not be overridden by MQTT messages
    STREAMS_STATIC = {};
    STREAMS.forEach(s => {
      STREAMS_STATIC[s.path] = Object.keys(s);
      // Initialise streamPCs entry as null — key always present for known streams
      if (!(s.path in streamPCs)) streamPCs[s.path] = null;
    });

  } catch(e) {
    console.error('Could not load streams.json:', e);
    STREAMS = [];
  }
}
// ═══════════════════════════════════════════════════════
// VIEWS — named configurations of streams + layout
// Loaded from /views.json. Supports cycling and MQTT control.
// ═══════════════════════════════════════════════════════
let VIEWS         = [];
let VIEWS_DEFAULT = null;
let VIEWS_CYCLE   = false;

let activeView    = null;   // currently displayed view name
let cycleTimer    = null;   // setTimeout handle for cycling
let cycleIndex    = 0;      // current position in cycle

async function loadViews() {
  // Check localStorage first (user-edited views take precedence)
  try {
    const saved = localStorage.getItem('viewsConfig');
    if (saved) {
      const data = JSON.parse(saved);
      VIEWS         = data.views   || [];
      VIEWS_DEFAULT = data.default || (VIEWS[0]?.name ?? null);
      VIEWS_CYCLE   = data.cycle   || false;
      return;
    }
  } catch(e) {}

  try {
    const res = await fetch('/views.json');
    if (!res.ok || res.status === 404) return; // views.json is optional
    const data = await res.json();
    VIEWS         = data.views   || [];
    VIEWS_DEFAULT = data.default || (VIEWS[0]?.name ?? null);
    VIEWS_CYCLE   = data.cycle   || false;
  } catch(e) {
    console.warn('Could not load views.json — views disabled:', e);
  }
}

function getView(name) {
  return VIEWS.find(v => v.name === name) || null;
}
