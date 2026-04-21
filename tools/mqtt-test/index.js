#!/usr/bin/env node

/**
 * MQTT Test Harness for rtsp-kiosk
 *
 * A CLI tool for testing MQTT functionality locally.
 *
 * Usage:
 *   node tools/mqtt-test/index.js subscribe              - Listen to all state topics
 *   node tools/mqtt-test/index.js publish <id>           - Publish one action
 *   node tools/mqtt-test/index.js simulate               - Simulate device responses
 *   node tools/mqtt-test/index.js ping                   - Test broker connectivity
 *   node tools/mqtt-test/index.js discover               - Publish test discovery entity
 *   node tools/mqtt-test/index.js undiscover             - Remove test discovery entity
 *   node tools/mqtt-test/index.js publish-discovery      - Publish custom discovery entity
 *   node tools/mqtt-test/index.js --help                 - Show this help
 */

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

// ─────────────────────────────────────────────────────────────────────────
// ANSI Color Codes (only when TTY)
// ─────────────────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const colors = {
  reset: isTTY ? '\x1b[0m' : '',
  gray: isTTY ? '\x1b[90m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  red: isTTY ? '\x1b[31m' : '',
};

// ─────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────

function getTimestamp() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function log(msg, color = '') {
  const ts = `${colors.gray}[${getTimestamp()}]${colors.reset}`;
  console.log(`${ts} ${color}${msg}${colors.reset}`);
}

function logError(msg) {
  log(msg, colors.red);
}

function logSuccess(msg) {
  log(msg, colors.green);
}

function maskCredentials(brokerUrl, username, password) {
  let masked = brokerUrl;
  if (username && password) {
    masked = brokerUrl.replace(username, '***').replace(password, '***');
  }
  return masked;
}

function loadActionsConfig() {
  const configPath = path.join(process.cwd(), 'data', 'actions.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    logError(`Failed to read ${configPath}: ${e.message}`);
    process.exit(1);
  }
}

function buildBrokerUrl(server) {
  if (!server.basepath) return server.broker;
  return server.broker.replace(/\/$/, '') + '/' + server.basepath.replace(/^\//, '');
}

// ─────────────────────────────────────────────────────────────────────────
// MQTT Client Factory
// ─────────────────────────────────────────────────────────────────────────

function createMqttClient(brokerUrl, username, password, timeout = 5000, tlsOpts = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      connectTimeout: timeout,
      reconnectPeriod: 0, // Disable auto-reconnect for CLI tools,
      ...tlsOpts,
    };

    if (username) opts.username = username;
    if (password) opts.password = password;

    const client = mqtt.connect(brokerUrl, opts);

    const timeoutId = setTimeout(() => {
      client.end();
      reject(new Error('Connection timeout'));
    }, timeout + 500);

    client.on('connect', () => {
      clearTimeout(timeoutId);
      resolve(client);
    });

    client.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Command: subscribe
// ─────────────────────────────────────────────────────────────────────────

async function cmdSubscribe() {
  const config = loadActionsConfig();
  const servers = config.mqtt?.servers || [];

  if (servers.length === 0) {
    logError('No MQTT servers configured in data/actions.json');
    process.exit(1);
  }

  // Build serversById map
  const serversById = {};
  servers.forEach((server) => {
    serversById[server.id] = server;
  });

  // Group actions by mqttServer
  const actionsByServer = {};
  (config.actions || []).forEach((action) => {
    const serverId = action.mqttServer || 'home';
    if (!actionsByServer[serverId]) {
      actionsByServer[serverId] = [];
    }
    actionsByServer[serverId].push(action);
  });

  // Collect state topics by server
  const topicsByServer = {};
  Object.entries(actionsByServer).forEach(([serverId, actions]) => {
    topicsByServer[serverId] = new Set();
    actions.forEach((action) => {
      if (action.state && action.state.topic) {
        topicsByServer[serverId].add(action.state.topic);
      }
    });
  });

  // Remove servers with no topics
  const serversWithTopics = Object.entries(topicsByServer).filter(
    ([, topics]) => topics.size > 0
  );

  if (serversWithTopics.length === 0) {
    logError('No state topics found in actions.json');
    process.exit(1);
  }

  const clients = {};
  let connectedCount = 0;

  // Connect to all servers
  for (const [serverId, topics] of serversWithTopics) {
    const server = serversById[serverId];
    if (!server) {
      logError(`Server not found: ${serverId}`);
      process.exit(1);
    }

    const tlsOpts = server.connectionType === 'wss' ? { tls: { rejectUnauthorized: false } } : {};

    try {
      logSuccess(`Connecting to ${maskCredentials(server.broker, '', '')} (${serverId})...`);
      const client = await createMqttClient(buildBrokerUrl(server), '', '', 5000, tlsOpts);
      clients[serverId] = client;
      connectedCount++;
      logSuccess(`  Connected. Listening to ${topics.size} topic(s)...`);

      // Subscribe to all topics on this server
      topics.forEach((topic) => {
        client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) {
            logError(`Failed to subscribe to ${topic}: ${err.message}`);
          }
        });
      });

      client.on('message', (topic, payload) => {
        const msg = payload.toString();
        log(`${colors.yellow}[sub]${colors.reset} ${colors.cyan}[${serverId}] ${topic}${colors.reset} ${colors.green}${msg}${colors.reset}`);
      });
    } catch (e) {
      logError(`Failed to connect to ${serverId}: ${e.message}`);
    }
  }

  if (connectedCount === 0) {
    logError('Failed to connect to any servers');
    process.exit(1);
  }

  process.on('SIGINT', () => {
    log('Disconnecting...');
    Object.values(clients).forEach((client) => client.end());
    process.exit(0);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Command: publish
// ─────────────────────────────────────────────────────────────────────────

async function cmdPublish(actionId) {
  if (!actionId) {
    logError('Usage: node tools/mqtt-test/index.js publish <action-id>');
    process.exit(1);
  }

  const config = loadActionsConfig();
  const servers = config.mqtt?.servers || [];

  if (servers.length === 0) {
    logError('No MQTT servers configured in data/actions.json');
    process.exit(1);
  }

  // Build serversById map
  const serversById = {};
  servers.forEach((server) => {
    serversById[server.id] = server;
  });

  const action = (config.actions || []).find((a) => a.id === actionId);
  if (!action) {
    logError(`Action not found: ${actionId}`);
    process.exit(1);
  }

  if (!action.publish || !action.publish.topic) {
    logError(`Action ${actionId} has no publish topic`);
    process.exit(1);
  }

  const serverId = action.mqttServer || 'home';
  const server = serversById[serverId];
  if (!server) {
    logError(`Server not found: ${serverId}`);
    process.exit(1);
  }

  const { topic, payload } = action.publish;
  const tlsOpts = server.connectionType === 'wss' ? { tls: { rejectUnauthorized: false } } : {};

  logSuccess(`Connecting to ${maskCredentials(server.broker, '', '')}...`);

  try {
    const client = await createMqttClient(server.broker, '', '', 5000, tlsOpts);
    log(`${colors.yellow}[pub]${colors.reset} ${colors.cyan}${topic}${colors.reset} ${colors.green}${payload}${colors.reset}`);

    client.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) {
        logError(`Publish failed: ${err.message}`);
        process.exit(1);
      }
      logSuccess('Published successfully');
      client.end(() => {
        process.exit(0);
      });
    });
  } catch (e) {
    logError(`Failed to connect: ${e.message}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Command: simulate
// ─────────────────────────────────────────────────────────────────────────

async function cmdSimulate() {
  const config = loadActionsConfig();
  const servers = config.mqtt?.servers || [];

  if (servers.length === 0) {
    logError('No MQTT servers configured in data/actions.json');
    process.exit(1);
  }

  // Build serversById map
  const serversById = {};
  servers.forEach((server) => {
    serversById[server.id] = server;
  });

  // Group actions by mqttServer and build topic map for each server
  const topicMapByServer = {};
  (config.actions || []).forEach((action) => {
    if (action.publish && action.publish.topic && action.state && action.state.topic) {
      const serverId = action.mqttServer || 'home';
      if (!topicMapByServer[serverId]) {
        topicMapByServer[serverId] = new Map();
      }
      topicMapByServer[serverId].set(action.publish.topic, {
        actionId: action.id,
        stateTopic: action.state.topic,
        onValue: action.state.onValue || 'ON',
      });
    }
  });

  const serversWithActions = Object.entries(topicMapByServer).filter(([, map]) => map.size > 0);

  if (serversWithActions.length === 0) {
    logError('No actions with both publish and state topics found');
    process.exit(1);
  }

  const clients = {};
  let connectedCount = 0;

  // Connect to all servers with actions
  for (const [serverId, topicMap] of serversWithActions) {
    const server = serversById[serverId];
    if (!server) {
      logError(`Server not found: ${serverId}`);
      process.exit(1);
    }

    const tlsOpts = server.connectionType === 'wss' ? { tls: { rejectUnauthorized: false } } : {};

    try {
      logSuccess(`Connecting to ${maskCredentials(server.broker, '', '')} (${serverId})...`);
      const client = await createMqttClient(buildBrokerUrl(server), '', '', 5000, tlsOpts);
      clients[serverId] = { client, topicMap };
      connectedCount++;
      logSuccess(`  Connected. Simulating responses for ${topicMap.size} action(s)...`);

      topicMap.forEach((_, publishTopic) => {
        client.subscribe(publishTopic, { qos: 0 });
      });

      client.on('message', (topic, payload) => {
        const mapping = topicMap.get(topic);
        if (mapping) {
          log(`${colors.yellow}[sub]${colors.reset} ${colors.green}${mapping.actionId}${colors.reset} set received on ${colors.cyan}[${serverId}] ${topic}${colors.reset}`);
          // Simulate response after delay
          setTimeout(() => {
            client.publish(mapping.stateTopic, mapping.onValue, { qos: 1 });
            log(`  ${colors.yellow}[pub]${colors.reset} ${colors.green}${mapping.onValue}${colors.reset} to ${colors.cyan}${mapping.stateTopic}${colors.reset}`);
          }, 100);
        }
      });
    } catch (e) {
      logError(`Failed to connect to ${serverId}: ${e.message}`);
    }
  }

  if (connectedCount === 0) {
    logError('Failed to connect to any servers');
    process.exit(1);
  }

  process.on('SIGINT', () => {
    log('Disconnecting...');
    Object.values(clients).forEach(({ client }) => client.end());
    process.exit(0);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Command: discover
// ─────────────────────────────────────────────────────────────────────────

async function cmdDiscover() {
  const config = loadActionsConfig();

  // Determine broker URL: prefer mqtt.servers[0].broker, fall back to mqtt.broker
  let brokerUrl;
  let serverId = 'unknown';

  if (config.mqtt?.servers && config.mqtt.servers.length > 0) {
    const server = config.mqtt.servers[0];
    brokerUrl = buildBrokerUrl(server);
    serverId = server.id || 'home';
  } else if (config.mqtt?.broker) {
    brokerUrl = config.mqtt.broker;
    serverId = 'default';
  } else {
    logError('No MQTT broker configured in data/actions.json');
    process.exit(1);
  }

  // Determine discovery topic
  const discoveryTopic = config.discovery?.topic || 'kiosk/discovery/actions';
  const fullTopic = `${discoveryTopic}/test-discovered-light`;

  // Prepare discovery payload
  const discoveryPayload = {
    description: 'Test Discovered Light',
    icon: 'mdi:lightbulb',
    mqttServer: 'home',
    publish: {
      topic: 'test/discovered/light/set',
      payload: 'ON',
    },
    state: {
      topic: 'test/discovered/light/state',
      onValue: 'ON',
    },
  };

  const tlsOpts =
    config.mqtt?.servers?.[0]?.connectionType === 'wss'
      ? { tls: { rejectUnauthorized: false } }
      : {};

  logSuccess(`Connecting to ${maskCredentials(brokerUrl, '', '')} (${serverId})...`);

  try {
    const client = await createMqttClient(brokerUrl, '', '', 5000, tlsOpts);
    const payloadStr = JSON.stringify(discoveryPayload, null, 2);

    log(
      `${colors.yellow}[pub]${colors.reset} ${colors.cyan}${fullTopic}${colors.reset} (retain: true)`
    );
    log(`${colors.green}${payloadStr}${colors.reset}`);

    client.publish(fullTopic, JSON.stringify(discoveryPayload), { qos: 1, retain: true }, (err) => {
      if (err) {
        logError(`Publish failed: ${err.message}`);
        process.exit(1);
      }
      logSuccess('Discovery entity published with retain flag');
      client.end(() => {
        process.exit(0);
      });
    });
  } catch (e) {
    logError(`Failed to connect: ${e.message}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Command: undiscover
// ─────────────────────────────────────────────────────────────────────────

async function cmdUndiscover() {
  const config = loadActionsConfig();

  // Determine broker URL: prefer mqtt.servers[0].broker, fall back to mqtt.broker
  let brokerUrl;
  let serverId = 'unknown';

  if (config.mqtt?.servers && config.mqtt.servers.length > 0) {
    const server = config.mqtt.servers[0];
    brokerUrl = buildBrokerUrl(server);
    serverId = server.id || 'home';
  } else if (config.mqtt?.broker) {
    brokerUrl = config.mqtt.broker;
    serverId = 'default';
  } else {
    logError('No MQTT broker configured in data/actions.json');
    process.exit(1);
  }

  // Determine discovery topic
  const discoveryTopic = config.discovery?.topic || 'kiosk/discovery/actions';
  const fullTopic = `${discoveryTopic}/test-discovered-light`;

  const tlsOpts =
    config.mqtt?.servers?.[0]?.connectionType === 'wss'
      ? { tls: { rejectUnauthorized: false } }
      : {};

  logSuccess(`Connecting to ${maskCredentials(brokerUrl, '', '')} (${serverId})...`);

  try {
    const client = await createMqttClient(brokerUrl, '', '', 5000, tlsOpts);

    log(
      `${colors.yellow}[pub]${colors.reset} ${colors.cyan}${fullTopic}${colors.reset} (retain: true, empty)`
    );

    client.publish(fullTopic, '', { qos: 1, retain: true }, (err) => {
      if (err) {
        logError(`Publish failed: ${err.message}`);
        process.exit(1);
      }
      logSuccess('Discovery entity removed (empty retained message published)');
      client.end(() => {
        process.exit(0);
      });
    });
  } catch (e) {
    logError(`Failed to connect: ${e.message}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Command: publish-discovery
// ─────────────────────────────────────────────────────────────────────────

function parseCliOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.includes('=')) {
      const [key, ...valueParts] = arg.split('=');
      const value = valueParts.join('='); // In case value contains '='

      // Parse boolean flags
      if (value === 'true') {
        options[key] = true;
      } else if (value === 'false') {
        options[key] = false;
      } else {
        options[key] = value;
      }
    }
  }
  return options;
}

async function cmdPublishDiscovery(name, argsList) {
  if (!name) {
    logError('Usage: node tools/mqtt-test/index.js publish-discovery <name> [options]');
    logError('Options: description="..." icon="..." mqttServer="..." publishTopic="..." publishPayload="..." stateTopic="..." stateOnValue="..." retain=true/false remove=true/false');
    process.exit(1);
  }

  const config = loadActionsConfig();

  // Determine broker URL: prefer mqtt.servers[0].broker, fall back to mqtt.broker
  let brokerUrl;
  let serverId = 'unknown';

  if (config.mqtt?.servers && config.mqtt.servers.length > 0) {
    const server = config.mqtt.servers[0];
    brokerUrl = buildBrokerUrl(server);
    serverId = server.id || 'home';
  } else if (config.mqtt?.broker) {
    brokerUrl = config.mqtt.broker;
    serverId = 'default';
  } else {
    logError('No MQTT broker configured in data/actions.json');
    process.exit(1);
  }

  // Parse CLI options
  const opts = parseCliOptions(argsList);

  // Extract option values with defaults
  const description = opts.description || name;
  const icon = opts.icon || 'mdi:toggle-switch';
  const mqttServer = opts.mqttServer || 'home';
  const publishTopic = opts.publishTopic || `test/discovered/${name}/set`;
  const publishPayload = opts.publishPayload || 'ON';
  const stateTopic = opts.stateTopic || `test/discovered/${name}/state`;
  const stateOnValue = opts.stateOnValue || 'ON';
  const retain = opts.retain !== false; // Default to true unless explicitly false
  const remove = opts.remove === true; // Only true if explicitly set to true

  // Determine discovery topic
  const discoveryTopic = config.discovery?.topic || 'kiosk/discovery/actions';
  const fullTopic = `${discoveryTopic}/${name}`;

  const tlsOpts =
    config.mqtt?.servers?.[0]?.connectionType === 'wss'
      ? { tls: { rejectUnauthorized: false } }
      : {};

  logSuccess(`Connecting to ${maskCredentials(brokerUrl, '', '')} (${serverId})...`);

  try {
    const client = await createMqttClient(brokerUrl, '', '', 5000, tlsOpts);

    if (remove) {
      // Publish empty retained message to remove
      log(
        `${colors.yellow}[pub]${colors.reset} ${colors.cyan}${fullTopic}${colors.reset} (retain: true, empty)`
      );

      client.publish(fullTopic, '', { qos: 1, retain: true }, (err) => {
        if (err) {
          logError(`Publish failed: ${err.message}`);
          process.exit(1);
        }
        logSuccess('Discovery entity removed (empty retained message published)');
        client.end(() => {
          process.exit(0);
        });
      });
    } else {
      // Prepare discovery payload
      const discoveryPayload = {
        description,
        icon,
        mqttServer,
        publish: {
          topic: publishTopic,
          payload: publishPayload,
        },
        state: {
          topic: stateTopic,
          onValue: stateOnValue,
        },
      };

      const payloadStr = JSON.stringify(discoveryPayload, null, 2);

      log(
        `${colors.yellow}[pub]${colors.reset} ${colors.cyan}${fullTopic}${colors.reset} (retain: ${retain})`
      );
      log(`${colors.green}${payloadStr}${colors.reset}`);

      client.publish(fullTopic, JSON.stringify(discoveryPayload), { qos: 1, retain }, (err) => {
        if (err) {
          logError(`Publish failed: ${err.message}`);
          process.exit(1);
        }
        logSuccess('Discovery entity published successfully');
        client.end(() => {
          process.exit(0);
        });
      });
    }
  } catch (e) {
    logError(`Failed to connect: ${e.message}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Command: ping
// ─────────────────────────────────────────────────────────────────────────

async function cmdPing() {
  const config = loadActionsConfig();
  const servers = config.mqtt?.servers || [];

  if (servers.length === 0) {
    logError('No MQTT servers configured in data/actions.json');
    process.exit(1);
  }

  const results = [];
  let successCount = 0;

  // Test each server
  for (const server of servers) {
    const tlsOpts = server.connectionType === 'wss' ? { tls: { rejectUnauthorized: false } } : {};
    log(`Testing ${maskCredentials(server.broker, '', '')} (${server.id})...`);

    const startTime = Date.now();
    try {
      const client = await createMqttClient(buildBrokerUrl(server), '', '', 5000, tlsOpts);
      const latency = Date.now() - startTime;
      results.push({
        id: server.id,
        broker: server.broker,
        latency,
        connected: true,
      });
      successCount++;
      logSuccess(`  ${server.id}: latency ${latency}ms, connected: true`);
      client.end();
    } catch (e) {
      results.push({
        id: server.id,
        broker: server.broker,
        connected: false,
        error: e.message,
      });
      logError(`  ${server.id}: unreachable (${e.message})`);
    }
  }

  if (successCount === 0) {
    logError('All servers unreachable');
    process.exit(1);
  } else {
    logSuccess(`\nPing complete: ${successCount}/${servers.length} servers reachable`);
    process.exit(0);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Help
// ─────────────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
MQTT Test Harness for rtsp-kiosk

Usage:
  node tools/mqtt-test/index.js <command> [args]

Commands:
  subscribe                        Listen to all action state topics and print incoming messages
  publish <action-id>              Publish one action's configured payload and exit
  simulate                         Loop forever, simulating device state responses
  ping                             Test broker connectivity and measure latency
  discover                         Publish a test MQTT discovery entity
  undiscover                       Remove a test MQTT discovery entity
  publish-discovery <name> [opts]  Publish custom MQTT discovery entity
  --help, -h                       Show this help

Examples:
  node tools/mqtt-test/index.js subscribe
  node tools/mqtt-test/index.js publish lights-on
  node tools/mqtt-test/index.js simulate
  node tools/mqtt-test/index.js ping
  node tools/mqtt-test/index.js discover
  node tools/mqtt-test/index.js undiscover
  node tools/mqtt-test/index.js publish-discovery bedroom-light description="Bedroom Light" icon=mdi:lightbulb
  node tools/mqtt-test/index.js publish-discovery hallway-switch remove=true

Configuration:
  Reads from data/actions.json for broker URL and all action topics.
  No hardcoded topics — all dynamic.
`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

if (!cmd || cmd === '--help' || cmd === '-h') {
  showHelp();
}

switch (cmd) {
  case 'subscribe':
    cmdSubscribe();
    break;
  case 'publish':
    cmdPublish(args[0]);
    break;
  case 'simulate':
    cmdSimulate();
    break;
  case 'ping':
    cmdPing();
    break;
  case 'discover':
    cmdDiscover();
    break;
  case 'undiscover':
    cmdUndiscover();
    break;
  case 'publish-discovery':
    cmdPublishDiscovery(args[0], args.slice(1));
    break;
  default:
    logError(`Unknown command: ${cmd}`);
    showHelp();
}
