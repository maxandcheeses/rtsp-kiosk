#!/usr/bin/env node

/**
 * MQTT Test Harness for rtsp-kiosk
 *
 * A CLI tool for testing MQTT functionality locally.
 *
 * Usage:
 *   node tools/mqtt-test/index.js subscribe         - Listen to all state topics
 *   node tools/mqtt-test/index.js publish <id>      - Publish one action
 *   node tools/mqtt-test/index.js simulate          - Simulate device responses
 *   node tools/mqtt-test/index.js ping              - Test broker connectivity
 *   node tools/mqtt-test/index.js --help            - Show this help
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
        log(`${colors.cyan}[${serverId}] ${topic}${colors.reset} → ${colors.green}${msg}${colors.reset}`);
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
    log(`Publishing to ${colors.cyan}${topic}${colors.reset}: ${colors.green}${payload}${colors.reset}`);

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
          log(`${colors.green}${mapping.actionId}${colors.reset} set received on ${colors.cyan}[${serverId}] ${topic}${colors.reset}`);
          // Simulate response after delay
          setTimeout(() => {
            client.publish(mapping.stateTopic, mapping.onValue, { qos: 1 });
            log(`  → published ${colors.green}${mapping.onValue}${colors.reset} to ${colors.cyan}${mapping.stateTopic}${colors.reset}`);
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
  subscribe              Listen to all action state topics and print incoming messages
  publish <action-id>    Publish one action's configured payload and exit
  simulate               Loop forever, simulating device state responses
  ping                   Test broker connectivity and measure latency
  --help, -h             Show this help

Examples:
  node tools/mqtt-test/index.js subscribe
  node tools/mqtt-test/index.js publish lights-on
  node tools/mqtt-test/index.js simulate
  node tools/mqtt-test/index.js ping

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
  default:
    logError(`Unknown command: ${cmd}`);
    showHelp();
}
