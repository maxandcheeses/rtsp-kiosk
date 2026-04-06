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

// ─────────────────────────────────────────────────────────────────────────
// MQTT Client Factory
// ─────────────────────────────────────────────────────────────────────────

function createMqttClient(brokerUrl, username, password, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const opts = {
      connectTimeout: timeout,
      reconnectPeriod: 0, // Disable auto-reconnect for CLI tools
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
  const { broker, username = '', password = '' } = config.mqtt || {};

  if (!broker) {
    logError('No MQTT broker configured in data/actions.json');
    process.exit(1);
  }

  // Collect all state topics
  const stateTopics = new Set();
  (config.actions || []).forEach((action) => {
    if (action.state && action.state.topic) {
      stateTopics.add(action.state.topic);
    }
  });

  if (stateTopics.size === 0) {
    logError('No state topics found in actions.json');
    process.exit(1);
  }

  logSuccess(`Connecting to ${maskCredentials(broker, username, password)}...`);

  try {
    const client = await createMqttClient(broker, username, password);
    logSuccess(`Connected. Listening to ${stateTopics.size} topic(s)...`);

    stateTopics.forEach((topic) => {
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          logError(`Failed to subscribe to ${topic}: ${err.message}`);
        }
      });
    });

    client.on('message', (topic, payload) => {
      const msg = payload.toString();
      log(`${colors.cyan}${topic}${colors.reset} → ${colors.green}${msg}${colors.reset}`);
    });

    process.on('SIGINT', () => {
      log('Disconnecting...');
      client.end();
      process.exit(0);
    });
  } catch (e) {
    logError(`Failed to connect: ${e.message}`);
    process.exit(1);
  }
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
  const { broker, username = '', password = '' } = config.mqtt || {};

  if (!broker) {
    logError('No MQTT broker configured in data/actions.json');
    process.exit(1);
  }

  const action = (config.actions || []).find((a) => a.id === actionId);
  if (!action) {
    logError(`Action not found: ${actionId}`);
    process.exit(1);
  }

  if (!action.publish || !action.publish.topic) {
    logError(`Action ${actionId} has no publish topic`);
    process.exit(1);
  }

  const { topic, payload } = action.publish;

  logSuccess(`Connecting to ${maskCredentials(broker, username, password)}...`);

  try {
    const client = await createMqttClient(broker, username, password);
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
  const { broker, username = '', password = '' } = config.mqtt || {};

  if (!broker) {
    logError('No MQTT broker configured in data/actions.json');
    process.exit(1);
  }

  // Build a map: publish.topic → { actionId, state.topic, state.onValue }
  const topicMap = new Map();
  (config.actions || []).forEach((action) => {
    if (action.publish && action.publish.topic && action.state && action.state.topic) {
      topicMap.set(action.publish.topic, {
        actionId: action.id,
        stateTopic: action.state.topic,
        onValue: action.state.onValue || 'ON',
      });
    }
  });

  if (topicMap.size === 0) {
    logError('No actions with both publish and state topics found');
    process.exit(1);
  }

  logSuccess(`Connecting to ${maskCredentials(broker, username, password)}...`);

  try {
    const client = await createMqttClient(broker, username, password);
    logSuccess(`Connected. Simulating responses for ${topicMap.size} action(s)...`);

    topicMap.forEach((_, publishTopic) => {
      client.subscribe(publishTopic, { qos: 0 });
    });

    client.on('message', (topic, payload) => {
      const mapping = topicMap.get(topic);
      if (mapping) {
        log(`${colors.green}${mapping.actionId}${colors.reset} set received on ${colors.cyan}${topic}${colors.reset}`);
        // Simulate response after delay
        setTimeout(() => {
          client.publish(mapping.stateTopic, mapping.onValue, { qos: 1 });
          log(`  → published ${colors.green}${mapping.onValue}${colors.reset} to ${colors.cyan}${mapping.stateTopic}${colors.reset}`);
        }, 100);
      }
    });

    process.on('SIGINT', () => {
      log('Disconnecting...');
      client.end();
      process.exit(0);
    });
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
  const { broker, username = '', password = '' } = config.mqtt || {};

  if (!broker) {
    logError('No MQTT broker configured in data/actions.json');
    process.exit(1);
  }

  log(`Testing ${maskCredentials(broker, username, password)}...`);

  const startTime = Date.now();
  try {
    const client = await createMqttClient(broker, username, password, 5000);
    const latency = Date.now() - startTime;
    logSuccess(`Broker: ${maskCredentials(broker, username, password)}, latency: ${latency}ms, connected: true`);
    client.end(() => {
      process.exit(0);
    });
  } catch (e) {
    logError(`Broker unreachable: ${e.message}`);
    process.exit(1);
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
