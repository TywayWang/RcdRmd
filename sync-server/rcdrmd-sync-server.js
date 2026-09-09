/**
 * RcdRmd - Local Cross-Browser Sync Server (Node.js)
 * Coordinates Bilibili tabs, workspaces & deleted video records across Edge, Chrome, and Canary.
 * Zero external dependencies: uses built-in 'http' and 'fs'.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 32188;
const DATASET_FILE = path.join(__dirname, 'rcdrmd-dataset.json');

// Shared token that must accompany every data request.
// The real hardening is localhost-only binding; this token blocks casual
// drive-by requests from arbitrary web pages that don't know it.
const SYNC_TOKEN = 'rcdrmd-local-sync-token';

function isValidToken(req) {
  return req.headers['x-rcdrmd-token'] === SYNC_TOKEN;
}

function loadDataset() {
  try {
    if (fs.existsSync(DATASET_FILE)) {
      const content = fs.readFileSync(DATASET_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('[Sync Server] Error reading dataset:', err.message);
  }

  return {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    browsers: {},
    deletedVideos: [],
    allTrackedHistory: {}
  };
}

function saveDataset(data) {
  try {
    data.updatedAt = new Date().toISOString();
    const tempFile = `${DATASET_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DATASET_FILE);
  } catch (err) {
    console.error('[Sync Server] Error saving dataset:', err.message);
  }
}

let dataset = loadDataset();

function setCorsHeaders(req, res) {
  // Only reflect the origin when the caller presents a valid token.
  // The extension talks to this server via its `host_permissions`, so it
  // bypasses CORS entirely and is unaffected by this tightening.
  if (isValidToken(req)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-RcdRmd-Token');
}

const server = http.createServer((req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Authentication check: require the shared token on every data endpoint.
  // Without it, an arbitrary web page cannot read the dataset or inject
  // polluting records via a no-cors form/body POST.
  if ((req.method === 'GET' || req.method === 'POST') && !isValidToken(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid X-RcdRmd-Token' }));
    return;
  }

  // Route: GET /api/status
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const activeBrowsers = Object.keys(dataset.browsers || {});
    let totalTabs = 0;
    activeBrowsers.forEach(b => {
      totalTabs += (dataset.browsers[b].tabs || []).length;
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      version: '1.0.0',
      port: PORT,
      activeBrowsers,
      totalTabsAcrossBrowsers: totalTabs,
      totalDeletedVideos: (dataset.deletedVideos || []).length,
      datasetPath: DATASET_FILE,
      updatedAt: dataset.updatedAt
    }));
    return;
  }

  // Route: GET /api/dataset
  if (req.method === 'GET' && url.pathname === '/api/dataset') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(dataset, null, 2));
    return;
  }

  // Route: POST /api/sync
  if (req.method === 'POST' && url.pathname === '/api/sync') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const browserName = payload.browser || 'Unknown Browser';
        const incomingTabs = Array.isArray(payload.tabs) ? payload.tabs : [];
        const incomingDeleted = Array.isArray(payload.deletedVideos) ? payload.deletedVideos : [];
        const incomingWindows = payload.windows || {};

        // 1. Update this browser's tabs & workspaces
        if (!dataset.browsers) dataset.browsers = {};
        dataset.browsers[browserName] = {
          name: browserName,
          lastHeartbeat: new Date().toISOString(),
          windows: incomingWindows,
          tabs: incomingTabs
        };

        // 2. Cache tracked video titles in history
        if (!dataset.allTrackedHistory) dataset.allTrackedHistory = {};
        incomingTabs.forEach(t => {
          if (t.bvid && t.title) {
            dataset.allTrackedHistory[t.bvid] = {
              title: t.title,
              channel: t.channel || '',
              browser: browserName,
              workspace: t.workspace || '',
              lastSeen: new Date().toISOString()
            };
          }
        });

        // 3. Merge deleted videos
        if (!dataset.deletedVideos) dataset.deletedVideos = [];
        incomingDeleted.forEach(delItem => {
          const matchIdx = dataset.deletedVideos.findIndex(v =>
            (v.bvid && delItem.bvid && v.bvid === delItem.bvid) ||
            (v.id && delItem.id && v.id === delItem.id)
          );

          if (matchIdx === -1) {
            dataset.deletedVideos.unshift({
              ...delItem,
              recordedByServerAt: new Date().toISOString()
            });
            console.log(`[Sync Server] ⚠️ Registered DELETED video from ${browserName}: "${delItem.title}" (${delItem.channel})`);
          } else {
            if (delItem.title && delItem.title !== '已删除的B站视频' && delItem.title !== 'Deleted Bilibili Video') {
              dataset.deletedVideos[matchIdx].title = delItem.title;
            }
            if (delItem.channel) {
              dataset.deletedVideos[matchIdx].channel = delItem.channel;
            }
          }
        });

        saveDataset(dataset);

        // 4. Flatten all opening tabs from all browsers
        const allOpeningTabs = [];
        Object.keys(dataset.browsers).forEach(bKey => {
          const bData = dataset.browsers[bKey];
          if (Array.isArray(bData.tabs)) {
            allOpeningTabs.push(...bData.tabs);
          }
        });

        console.log(`[Sync Server] Synced with "${browserName}" (${incomingTabs.length} tabs, ${incomingDeleted.length} deleted). Total across browsers: ${allOpeningTabs.length} tabs.`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          serverTime: new Date().toISOString(),
          activeBrowsers: Object.keys(dataset.browsers),
          allOpeningTabs: allOpeningTabs,
          deletedVideos: dataset.deletedVideos
        }));
      } catch (err) {
        console.error('[Sync Server] Error processing sync request:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('====================================================');
  console.log(`  RcdRmd Local Cross-Browser Sync Hub`);
  console.log(`  Running on: http://127.0.0.1:${PORT}`);
  console.log(`  Dataset storage: ${DATASET_FILE}`);
  console.log(`  Ready for Microsoft Edge, Chrome & Chrome Canary`);
  console.log('====================================================');
});
