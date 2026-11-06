/**
 * RcdRmd - Local Cross-Browser Sync Server (Node.js)
 * Coordinates Bilibili tabs, workspaces & deleted video records across Edge, Chrome, and Canary.
 * Zero external dependencies: uses built-in 'http' and 'fs'.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.RCDRMD_PORT, 10) || 32188;
const DATASET_FILE = process.env.RCDRMD_DATASET_FILE || path.join(__dirname, 'rcdrmd-dataset.json');

// Shared token that must accompany every data request.
// The real hardening is localhost-only binding; this token blocks casual
// drive-by requests from arbitrary web pages that don't know it.
const SYNC_TOKEN = 'rcdrmd-local-sync-token';

function isValidToken(req) {
  return req.headers['x-rcdrmd-token'] === SYNC_TOKEN;
}

function cleanTitle(text) {
  if (!text) return '';
  return text
    .replace(/_哔哩哔哩_bilibili.*/i, '')
    .replace(/_哔哩哔哩.*/i, '')
    .replace(/ - 哔哩哔哩.*/i, '')
    .replace(/ - bilibili.*/i, '')
    .trim();
}

const ERROR_TITLE_PATTERNS = [
  /^视频去哪[了儿呢\?？\s]*$/i,
  /^啊叻[？\?]?\s*视频不见了.*/i,
  /^(404(\s*not\s*found)?|404|bilibili-404|404-bilibili|出错了(\s*-\s*bilibili\.com)?)$/i,
  /^(稿件不可见|该稿件已被下架|稿件已被UP主删除|抱歉[，,].*已被删除|非常抱歉.*|该内容已不存在)$/i,
  /^(原视频已失效|视频已失效|该视频已失效|已失效|视频不存在|原视频不存在|视频不见了)$/i,
  /^(已删除的B站视频|Unknown Video Title|（原视频标题未获取）|原视频标题未获取|（未获取到标题）|未获取到标题)$/i,
  /^(B站视频|B站页面|B站标签页|B站首页)$/i
];

function isDeletedOrErrorText(text) {
  if (!text) return false;
  const raw = text.trim();
  const cleaned = cleanTitle(raw);
  for (const pat of ERROR_TITLE_PATTERNS) {
    if (pat.test(raw) || (cleaned && pat.test(cleaned))) {
      return true;
    }
  }
  return false;
}

function isValidVideoTitle(text) {
  if (!text) return false;
  const t = cleanTitle(text);
  if (!t) return false;
  if (
    t === 'B站视频' ||
    t === 'B站页面' ||
    t === 'B站标签页' ||
    t === 'B站首页' ||
    t.startsWith('哔哩哔哩') ||
    t.startsWith('bilibili')
  ) {
    return false;
  }
  return !isDeletedOrErrorText(t);
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
      datasetFile: path.basename(DATASET_FILE),
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
          if (t.bvid && t.title && isValidVideoTitle(t.title)) {
            dataset.allTrackedHistory[t.bvid] = {
              title: t.title,
              channel: t.channel || '',
              browser: browserName,
              workspace: t.workspace || '',
              lastSeen: new Date().toISOString()
            };
          }
        });

        // 3. Merge deleted videos (ignoring any legacy false HTTP 412 / network errors)
        if (!dataset.deletedVideos) dataset.deletedVideos = [];
        incomingDeleted.forEach(delItem => {
          const r = (delItem.reason || '').toLowerCase();
          if (r.includes('http 412') || r.includes('http 403') || r.includes('http 429') || r.includes('http 5')) {
            return;
          }

          if (!isValidVideoTitle(delItem.title) && delItem.bvid && dataset.allTrackedHistory && isValidVideoTitle(dataset.allTrackedHistory[delItem.bvid]?.title)) {
            delItem.title = dataset.allTrackedHistory[delItem.bvid].title;
          }
          if ((!delItem.channel || delItem.channel === '未知UP主') && delItem.bvid && dataset.allTrackedHistory?.[delItem.bvid]?.channel) {
            delItem.channel = dataset.allTrackedHistory[delItem.bvid].channel;
          }

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
            if (isValidVideoTitle(delItem.title)) {
              dataset.deletedVideos[matchIdx].title = delItem.title;
            } else if (!isValidVideoTitle(dataset.deletedVideos[matchIdx].title) && delItem.bvid && dataset.allTrackedHistory && isValidVideoTitle(dataset.allTrackedHistory[delItem.bvid]?.title)) {
              dataset.deletedVideos[matchIdx].title = dataset.allTrackedHistory[delItem.bvid].title;
            }
            if (delItem.channel && delItem.channel !== '未知UP主') {
              dataset.deletedVideos[matchIdx].channel = delItem.channel;
            }
          }
        });

        dataset.deletedVideos = dataset.deletedVideos.filter(v => {
          const r = (v.reason || '').toLowerCase();
          return !r.includes('http 412') && !r.includes('http 403') && !r.includes('http 429') && !r.includes('http 5');
        });

        dataset.deletedVideos.forEach(v => {
          if (!isValidVideoTitle(v.title) && v.bvid && dataset.allTrackedHistory && isValidVideoTitle(dataset.allTrackedHistory[v.bvid]?.title)) {
            v.title = dataset.allTrackedHistory[v.bvid].title;
          }
          if ((!v.channel || v.channel === '未知UP主') && v.bvid && dataset.allTrackedHistory?.[v.bvid]?.channel && dataset.allTrackedHistory[v.bvid].channel !== '未知UP主') {
            v.channel = dataset.allTrackedHistory[v.bvid].channel;
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
  console.log(`  Dataset storage: ${path.basename(DATASET_FILE)}`);
  console.log(`  Ready for Microsoft Edge, Chrome & Chrome Canary`);
  console.log('====================================================');
});
