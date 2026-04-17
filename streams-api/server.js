'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9998;
const STREAMS_FILE = process.env.STREAMS_FILE || '/data/streams.json';
const VIEWS_FILE = process.env.VIEWS_FILE || '/data/views.json';
const ACTIONS_FILE = process.env.ACTIONS_FILE || '/data/actions.json';

function readActions() {
  return JSON.parse(fs.readFileSync(ACTIONS_FILE, 'utf8'));
}

function writeActions(data) {
  fs.writeFileSync(ACTIONS_FILE, JSON.stringify(data, null, 2));
}

function readViews() {
  return JSON.parse(fs.readFileSync(VIEWS_FILE, 'utf8'));
}

function writeViews(data) {
  fs.writeFileSync(VIEWS_FILE, JSON.stringify(data, null, 2));
}

const MEDIAMTX_API_URL = (process.env.MEDIAMTX_API_URL || 'http://mediamtx:9997').replace(/\/$/, '');
const API_KEY = process.env.STREAMS_API_KEY || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(payload);
}

function checkAuth(req) {
  if (!API_KEY) return true;
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${API_KEY}`;
}

function applyRenamesToViews(renames) {
  if (!renames || renames.length === 0) return;
  let views;
  try {
    views = JSON.parse(fs.readFileSync(VIEWS_FILE, 'utf8'));
  } catch (e) {
    console.warn(`Could not read views file for rename: ${e.message}`);
    return;
  }
  for (const { from, to } of renames) {
    if (!from || !to || from === to) continue;
    for (const view of (views.views || [])) {
      if (Array.isArray(view.streams)) {
        view.streams = view.streams.map(s => s === from ? to : s);
      }
    }
  }
  fs.writeFileSync(VIEWS_FILE, JSON.stringify(views, null, 2));
}

function readStreams() {
  return JSON.parse(fs.readFileSync(STREAMS_FILE, 'utf8'));
}

function writeStreams(streams) {
  fs.writeFileSync(STREAMS_FILE, JSON.stringify(streams, null, 2));
}

function fetchJson(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const options = {
      hostname: opts.hostname,
      port: opts.port || 9997,
      path: opts.pathname + (opts.search || ''),
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function streamToMtxConfig(stream) {
  const cfg = {};
  if (stream.source !== undefined) cfg.source = stream.source;
  if (stream.sourceOnDemand !== undefined) cfg.sourceOnDemand = stream.sourceOnDemand;
  if (stream.sourceOnDemandStartTimeout !== undefined) cfg.sourceOnDemandStartTimeout = stream.sourceOnDemandStartTimeout;
  if (stream.sourceOnDemandCloseAfter !== undefined) cfg.sourceOnDemandCloseAfter = stream.sourceOnDemandCloseAfter;
  return cfg;
}

async function syncMediaMTX(streams) {
  // Get current paths from MediaMTX
  let existingPaths = new Set();
  try {
    const res = await fetchJson(`${MEDIAMTX_API_URL}/v3/paths/list`);
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      const items = data.items || [];
      for (const item of items) {
        if (item.name) existingPaths.add(item.name);
      }
    }
  } catch (e) {
    throw new Error(`Failed to list MediaMTX paths: ${e.message}`);
  }

  const newPaths = new Set(streams.map(s => s.path));

  // Add or patch each stream
  for (const stream of streams) {
    const cfg = streamToMtxConfig(stream);
    if (existingPaths.has(stream.path)) {
      await fetchJson(`${MEDIAMTX_API_URL}/v3/config/paths/patch/${stream.path}`, 'PATCH', cfg);
    } else {
      const res = await fetchJson(`${MEDIAMTX_API_URL}/v3/config/paths/add/${stream.path}`, 'POST', cfg);
      // 409 = already exists, fall back to patch
      if (res.status === 409) {
        await fetchJson(`${MEDIAMTX_API_URL}/v3/config/paths/patch/${stream.path}`, 'PATCH', cfg);
      }
    }
  }

  // Delete removed paths
  for (const existing of existingPaths) {
    if (!newPaths.has(existing)) {
      await fetchJson(`${MEDIAMTX_API_URL}/v3/config/paths/delete/${existing}`, 'DELETE');
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => data += c);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    res.end();
    return;
  }

  // Auth check
  if (!checkAuth(req)) {
    send(res, 401, { error: 'Unauthorized' });
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '') {
    if (req.method === 'GET') {
      try {
        const streams = readStreams();
        send(res, 200, streams);
      } catch (e) {
        send(res, 500, { error: `Failed to read streams: ${e.message}` });
      }
      return;
    }

    if (req.method === 'PUT') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw);
        let streams, renames = [];
        if (Array.isArray(body)) {
          streams = body;
        } else if (body && Array.isArray(body.streams)) {
          streams = body.streams;
          renames = Array.isArray(body.renames) ? body.renames : [];
        } else {
          send(res, 400, { error: 'Body must be a JSON array or { streams, renames }' });
          return;
        }
        applyRenamesToViews(renames);
        writeStreams(streams);
        send(res, 200, { ok: true });
        // Sync MediaMTX async — don't block response
        syncMediaMTX(streams).catch((e) => {
          console.warn(`MediaMTX sync failed (streams saved): ${e.message}`);
        });
      } catch (e) {
        send(res, 400, { error: `Invalid request: ${e.message}` });
      }
      return;
    }
  }

  if (url.pathname === '/actions') {
    if (req.method === 'GET') {
      try {
        send(res, 200, readActions());
      } catch(e) {
        send(res, 500, { error: `Failed to read actions: ${e.message}` });
      }
      return;
    }
    if (req.method === 'PUT') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw);
        if (!body || typeof body !== 'object' || !Array.isArray(body.actions) || !Array.isArray(body.groups)) {
          send(res, 400, { error: 'Body must be { mqtt?, actions, groups }' });
          return;
        }
        writeActions(body);
        send(res, 200, { ok: true });
      } catch(e) {
        send(res, 400, { error: `Invalid request: ${e.message}` });
      }
      return;
    }
  }

  if (url.pathname === '/views') {
    if (req.method === 'GET') {
      try {
        send(res, 200, readViews());
      } catch(e) {
        send(res, 500, { error: `Failed to read views: ${e.message}` });
      }
      return;
    }
    if (req.method === 'PUT') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw);
        if (!body || typeof body !== 'object' || !Array.isArray(body.views)) {
          send(res, 400, { error: 'Body must be { default?, cycle?, views }' });
          return;
        }
        writeViews(body);
        send(res, 200, { ok: true });
      } catch(e) {
        send(res, 400, { error: `Invalid request: ${e.message}` });
      }
      return;
    }
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`streams-api listening on :${PORT}`);
  console.log(`  STREAMS_FILE=${STREAMS_FILE}`);
  console.log(`  VIEWS_FILE=${VIEWS_FILE}`);
  console.log(`  MEDIAMTX_API_URL=${MEDIAMTX_API_URL}`);
  console.log(`  Auth: ${API_KEY ? 'enabled' : 'disabled'}`);
});
