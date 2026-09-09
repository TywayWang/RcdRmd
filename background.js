/**
 * RcdRmd - Background Service Worker
 * Manages multi-window / workspace Bilibili tab tracking, deletion detection,
 * 30-min alarm sync, cross-browser coordination, and yellow notification icon/badge states.
 */

const SYNC_SERVER_DEFAULT_URL = 'http://127.0.0.1:32188';
const SYNC_TOKEN = 'rcdrmd-local-sync-token';

// Detect browser identity (Edge, Chrome Canary, or Chrome)
async function getBrowserName() {
  const { customBrowserName } = await chrome.storage.local.get('customBrowserName');
  if (customBrowserName && customBrowserName.trim()) {
    return customBrowserName.trim();
  }

  const ua = navigator.userAgent || '';
  if (ua.includes('Edg/')) {
    return 'Microsoft Edge';
  }

  if (ua.includes('Chrome/')) {
    if (ua.includes('Canary') || (navigator.userAgentData && navigator.userAgentData.brands &&
        navigator.userAgentData.brands.some(b => b.brand.toLowerCase().includes('canary')))) {
      return 'Google Chrome Canary';
    }
    return 'Google Chrome';
  }

  return 'Chromium Browser';
}

// Get or auto-assign a workspace/window name
async function getWorkspaceName(windowId, tabCount = 0) {
  const { windowNames = {} } = await chrome.storage.local.get('windowNames');
  if (windowNames[windowId]) {
    return windowNames[windowId];
  }

  // Smart default assignment based on user setup (e.g., Mixed has ~152 tabs, Dev has ~68 tabs)
  let assigned = '';
  const existingNames = Object.values(windowNames);
  if (!existingNames.includes('Mixed') && tabCount >= 100) {
    assigned = 'Mixed';
  } else if (!existingNames.includes('Dev') && tabCount > 0 && tabCount < 100) {
    assigned = 'Dev';
  } else {
    assigned = `工作区 ${windowId}`;
  }

  windowNames[windowId] = assigned;
  await chrome.storage.local.set({ windowNames });
  return assigned;
}

// Clean titles from Bilibili
function cleanTitle(text) {
  if (!text) return '';
  return text
    .replace(/_哔哩哔哩_bilibili.*/i, '')
    .replace(/_哔哩哔哩.*/i, '')
    .replace(/ - 哔哩哔哩.*/i, '')
    .replace(/ - bilibili.*/i, '')
    .trim();
}

// Extract BVID from URL
function extractBvid(url) {
  if (!url) return '';
  const match = url.match(/\/video\/(BV[0-9a-zA-Z]+)/i);
  return match ? match[1] : '';
}

// Check if URL is any Bilibili page
function isBilibiliUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('bilibili.com');
  } catch (e) {
    return false;
  }
}

// Check if URL is a Bilibili video page
function isBilibiliVideoUrl(url) {
  if (!url) return false;
  return /bilibili\.com\/video\/(BV|av)/i.test(url) ||
         /bilibili\.com\/bangumi\/play\//i.test(url) ||
         /bilibili\.com\/festival\//i.test(url) ||
         /bilibili\.com\/cheese\/play\//i.test(url);
}

// Check if URL is landing page or error page
function isLandingPageOrError(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('bilibili.com')) {
      if (parsed.pathname === '/' || parsed.pathname === '' || parsed.pathname === '/index.html') {
        return true;
      }
      if (parsed.pathname.includes('/404')) {
        return true;
      }
    }
  } catch (e) {
    // Ignore invalid URL
  }
  return false;
}

// Update Action Badge and Icon (Yellow notification symbol)
async function updateBadgeAndIcon() {
  try {
    const { deletedVideos = [] } = await chrome.storage.local.get('deletedVideos');
    const unacknowledgedCount = deletedVideos.filter(v => !v.acknowledged).length;

    if (unacknowledgedCount > 0) {
      await chrome.action.setBadgeText({ text: String(unacknowledgedCount) });
      await chrome.action.setBadgeBackgroundColor({ color: '#FFB800' });
      if (chrome.action.setBadgeTextColor) {
        await chrome.action.setBadgeTextColor({ color: '#000000' });
      }
      await chrome.action.setIcon({
        path: {
          "16": "icons/icon-yellow-16.png",
          "32": "icons/icon-yellow-32.png",
          "48": "icons/icon-yellow-48.png",
          "128": "icons/icon-yellow-128.png"
        }
      });
      await chrome.action.setTitle({
        title: `RcdRmd: 发现 ${unacknowledgedCount} 个已被UP主删除的B站视频！点击查看`
      });
    } else {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setIcon({
        path: {
          "16": "icons/icon-16.png",
          "32": "icons/icon-32.png",
          "48": "icons/icon-48.png",
          "128": "icons/icon-128.png"
        }
      });
      await chrome.action.setTitle({
        title: 'RcdRmd - Bilibili Deleted Video Tracker'
      });
    }
  } catch (err) {
    console.error('[RcdRmd] Error updating badge/icon:', err);
  }
}

// Fetch video details from Bilibili Web API
async function fetchVideoDetailsFromApi(bvid) {
  if (!bvid) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      return { isDeleted: true, code: resp.status, reason: `HTTP ${resp.status}` };
    }

    const data = await resp.json();
    if (data.code === 0 && data.data) {
      return {
        isDeleted: false,
        code: 0,
        title: data.data.title,
        channel: data.data.owner ? data.data.owner.name : '',
        pic: data.data.pic,
        pubdate: data.data.pubdate
      };
    } else if (data.code === -404 || data.code === 62002 || data.code === 62004 || data.code === -403) {
      return {
        isDeleted: true,
        code: data.code,
        message: data.message || 'Video removed/inaccessible',
        reason: data.code === -404 ? '啥都木有 (稿件已被删除)' : (data.message || '稿件不可见')
      };
    }

    return null;
  } catch (err) {
    return null;
  }
}

// Record a deleted video into persistent storage
async function recordDeletedVideo(deletedItem) {
  const { deletedVideos = [], videoHistory = {} } = await chrome.storage.local.get(['deletedVideos', 'videoHistory']);

  if ((!deletedItem.title || deletedItem.title === 'Unknown Video Title') && deletedItem.bvid && videoHistory[deletedItem.bvid]) {
    deletedItem.title = videoHistory[deletedItem.bvid].title || deletedItem.title;
    deletedItem.channel = videoHistory[deletedItem.bvid].channel || deletedItem.channel;
  }

  const existingIdx = deletedVideos.findIndex(v => v.bvid && v.bvid === deletedItem.bvid);
  if (existingIdx >= 0) {
    if (deletedItem.title && deletedItem.title !== 'Unknown Video Title') {
      deletedVideos[existingIdx].title = deletedItem.title;
    }
    if (deletedItem.channel) {
      deletedVideos[existingIdx].channel = deletedItem.channel;
    }
    deletedVideos[existingIdx].deletedAt = deletedItem.deletedAt;
    deletedVideos[existingIdx].reason = deletedItem.reason;
    deletedVideos[existingIdx].acknowledged = false;
  } else {
    deletedVideos.unshift(deletedItem);
  }

  await chrome.storage.local.set({ deletedVideos });
  await updateBadgeAndIcon();
  await syncWithServer();
}

// Synchronize dataset with local Sync Server
async function syncWithServer() {
  const { syncServerUrl = SYNC_SERVER_DEFAULT_URL, trackedTabs = {}, deletedVideos = [], windowNames = {} } =
    await chrome.storage.local.get(['syncServerUrl', 'trackedTabs', 'deletedVideos', 'windowNames']);

  const browserName = await getBrowserName();

  // Convert trackedTabs map to array with window/workspace info
  const currentTabsList = Object.values(trackedTabs).map(t => ({
    tabId: t.tabId,
    windowId: t.windowId,
    workspace: t.workspace || windowNames[t.windowId] || `工作区 ${t.windowId}`,
    bvid: t.bvid || '',
    title: t.title || 'B站标签页',
    channel: t.channel || '',
    url: t.url || '',
    browser: browserName,
    openedAt: t.openedAt || new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  }));

  // Build windows summary
  const windowsSummary = {};
  currentTabsList.forEach(t => {
    const ws = t.workspace || `工作区 ${t.windowId}`;
    windowsSummary[ws] = (windowsSummary[ws] || 0) + 1;
  });

  const payload = {
    browser: browserName,
    windows: windowsSummary,
    tabs: currentTabsList,
    deletedVideos: deletedVideos
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(`${syncServerUrl}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RcdRmd-Token': SYNC_TOKEN },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const result = await response.json();

      let hasNewDeleted = false;
      const localDeleted = [...deletedVideos];

      if (Array.isArray(result.deletedVideos)) {
        for (const serverItem of result.deletedVideos) {
          const matchIdx = localDeleted.findIndex(l => (l.bvid && l.bvid === serverItem.bvid) || (l.id && l.id === serverItem.id));
          if (matchIdx === -1) {
            localDeleted.unshift({
              ...serverItem,
              acknowledged: false
            });
            hasNewDeleted = true;
          }
        }
      }

      const otherBrowsersTabs = (result.allOpeningTabs || []).filter(t => t.browser !== browserName);

      await chrome.storage.local.set({
        syncServerStatus: 'connected',
        lastSyncTime: new Date().toISOString(),
        deletedVideos: localDeleted,
        crossBrowserTabs: otherBrowsersTabs
      });

      if (hasNewDeleted) {
        await updateBadgeAndIcon();
      }

      return { success: true, connected: true };
    }
  } catch (err) {
    await chrome.storage.local.set({
      syncServerStatus: 'offline',
      lastSyncTime: new Date().toISOString()
    });
    return { success: false, connected: false, error: err.message };
  }
}

// Proactively inspect ALL open windows and tabs for health and deletion
async function checkAllTabsHealth() {
  const { trackedTabs = {}, videoHistory = {}, windowNames = {} } =
    await chrome.storage.local.get(['trackedTabs', 'videoHistory', 'windowNames']);
  const browserName = await getBrowserName();

  // Query ALL windows to correctly handle multiple Edge windows / Workspaces
  const allWindows = await chrome.windows.getAll({ populate: true });
  const actualTabMap = new Map();
  const windowCounts = {};

  // First pass: count tabs per window and collect actual tabs
  for (const win of allWindows) {
    if (!win.tabs) continue;
    let biliCount = 0;
    for (const tab of win.tabs) {
      actualTabMap.set(tab.id, tab);
      if (isBilibiliUrl(tab.url)) {
        biliCount++;
      }
    }
    windowCounts[win.id] = biliCount;
    // Auto-detect or retrieve workspace name
    if (!windowNames[win.id]) {
      windowNames[win.id] = await getWorkspaceName(win.id, biliCount);
    }
  }

  // Remove closed tabs from trackedTabs
  let trackedChanged = false;
  for (const tabIdStr of Object.keys(trackedTabs)) {
    const tabId = parseInt(tabIdStr, 10);
    if (!actualTabMap.has(tabId)) {
      delete trackedTabs[tabIdStr];
      trackedChanged = true;
    }
  }

  // Second pass: instantly record all Bilibili tabs without blocking
  const videoTabsNeedingApiCheck = [];

  for (const [tabId, tab] of actualTabMap.entries()) {
    if (!isBilibiliUrl(tab.url)) continue;

    const bvid = extractBvid(tab.url);
    const isVideo = isBilibiliVideoUrl(tab.url);
    const prevTracked = trackedTabs[tabId] || {};
    const wsName = windowNames[tab.windowId] || `工作区 ${tab.windowId}`;

    const cleanT = cleanTitle(tab.title) || prevTracked.title || (videoHistory[bvid]?.title) || (isVideo ? 'B站视频' : 'B站页面');
    const channel = prevTracked.channel || (videoHistory[bvid]?.channel) || '';

    trackedTabs[tabId] = {
      tabId: tab.id,
      windowId: tab.windowId,
      workspace: wsName,
      url: tab.url,
      bvid: bvid,
      title: cleanT,
      channel: channel,
      browser: browserName,
      isBilibiliTab: true,
      isBilibiliVideo: isVideo,
      openedAt: prevTracked.openedAt || new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
    trackedChanged = true;

    if (bvid && cleanT) {
      videoHistory[bvid] = {
        bvid: bvid,
        title: cleanT,
        channel: channel,
        url: tab.url,
        lastSeen: new Date().toISOString()
      };
    }

    if (isVideo && bvid) {
      videoTabsNeedingApiCheck.push({ tabId, bvid, prevTracked });
    }
  }

  // Persist all tabs immediately so UI always shows accurate counts
  await chrome.storage.local.set({ trackedTabs, videoHistory, windowNames });

  // Third pass: Asynchronous, rate-limited background check for deleted videos (concurrency: 4)
  (async () => {
    const queue = [...videoTabsNeedingApiCheck];
    const BATCH_SIZE = 4;

    while (queue.length > 0) {
      const batch = queue.splice(0, BATCH_SIZE);
      await Promise.all(batch.map(async item => {
        const details = await fetchVideoDetailsFromApi(item.bvid);
        if (details) {
          if (details.isDeleted) {
            console.warn(`[RcdRmd] Video tab ${item.tabId} (${item.bvid}) detected as DELETED via API!`);
            await recordDeletedVideo({
              id: item.bvid,
              bvid: item.bvid,
              title: item.prevTracked.title || '已失效视频',
              channel: item.prevTracked.channel || '未知UP主',
              browser: browserName,
              originalUrl: item.prevTracked.url || `https://www.bilibili.com/video/${item.bvid}`,
              deletedAt: new Date().toISOString(),
              reason: details.reason || 'B站API返回稿件失效 (-404)',
              acknowledged: false
            });
          } else if (details.channel) {
            const latestStorage = await chrome.storage.local.get(['trackedTabs', 'videoHistory']);
            const curTabs = latestStorage.trackedTabs || {};
            const curHist = latestStorage.videoHistory || {};
            if (curTabs[item.tabId]) {
              curTabs[item.tabId].channel = details.channel;
              if (details.title) curTabs[item.tabId].title = cleanTitle(details.title);
            }
            if (curHist[item.bvid]) {
              curHist[item.bvid].channel = details.channel;
            }
            await chrome.storage.local.set({ trackedTabs: curTabs, videoHistory: curHist });
          }
        }
      }));
    }
  })();

  await syncWithServer();
  await updateBadgeAndIcon();
}

// Initialize extension on install / startup
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[RcdRmd] Extension initialized. Setting up 30-min recurring sync.');
  await chrome.alarms.create('rcdrmd-30min-sync', { periodInMinutes: 30 });
  await checkAllTabsHealth();
  await updateBadgeAndIcon();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[RcdRmd] Browser startup. Refreshing all workspace tabs.');
  await checkAllTabsHealth();
  await updateBadgeAndIcon();
});

// Alarm Listener (30 minutes)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'rcdrmd-30min-sync') {
    console.log('[RcdRmd] 30-minute sync alarm triggered.');
    await checkAllTabsHealth();
  }
});

// Multi-window lifecycle listeners
chrome.windows.onCreated.addListener(async () => {
  await checkAllTabsHealth();
});

chrome.windows.onRemoved.addListener(async (winId) => {
  const { trackedTabs = {} } = await chrome.storage.local.get('trackedTabs');
  let changed = false;
  for (const [tabId, tab] of Object.entries(trackedTabs)) {
    if (tab.windowId === winId) {
      delete trackedTabs[tabId];
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.local.set({ trackedTabs });
    await updateBadgeAndIcon();
  }
});

// Tab Navigation Listener
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;

  const currentUrl = tab.url || changeInfo.url || '';
  if (!currentUrl) return;

  const { trackedTabs = {}, videoHistory = {}, windowNames = {} } =
    await chrome.storage.local.get(['trackedTabs', 'videoHistory', 'windowNames']);
  const prevTab = trackedTabs[tabId];
  const browserName = await getBrowserName();
  const wsName = windowNames[tab.windowId] || (prevTab ? prevTab.workspace : `工作区 ${tab.windowId}`);

  // DELETION DETECTION: Video tab was redirected to landing page or 404
  if (prevTab && prevTab.isBilibiliVideo && isLandingPageOrError(currentUrl)) {
    console.warn(`[RcdRmd] DELETION REDIRECT! Tab ${tabId} was ${prevTab.title} (${prevTab.bvid}) and redirected to homepage`);

    const bvid = prevTab.bvid || '';
    const title = prevTab.title || videoHistory[bvid]?.title || '已删除的B站视频';
    const channel = prevTab.channel || videoHistory[bvid]?.channel || '未知UP主';

    await recordDeletedVideo({
      id: bvid || ('tab-' + tabId + '-' + Date.now()),
      bvid: bvid,
      title: title,
      channel: channel,
      browser: `${browserName} (${wsName})`,
      originalUrl: prevTab.url,
      deletedAt: new Date().toISOString(),
      reason: '已重定向至首页 (UP主删稿或被平台下架)',
      acknowledged: false
    });

    delete trackedTabs[tabId];
    await chrome.storage.local.set({ trackedTabs });
    await updateBadgeAndIcon();
    return;
  }

  // Active Bilibili Tab
  if (isBilibiliUrl(currentUrl)) {
    const bvid = extractBvid(currentUrl);
    const isVideo = isBilibiliVideoUrl(currentUrl);
    const existingTitle = prevTab?.title || videoHistory[bvid]?.title || cleanTitle(tab.title) || (isVideo ? 'B站视频' : 'B站页面');
    const existingChannel = prevTab?.channel || videoHistory[bvid]?.channel || '';

    trackedTabs[tabId] = {
      tabId: tab.id,
      windowId: tab.windowId,
      workspace: wsName,
      url: currentUrl,
      bvid: bvid,
      title: existingTitle,
      channel: existingChannel,
      browser: browserName,
      isBilibiliTab: true,
      isBilibiliVideo: isVideo,
      openedAt: prevTab?.openedAt || new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };

    await chrome.storage.local.set({ trackedTabs });

    if (bvid && !existingChannel) {
      (async () => {
        const details = await fetchVideoDetailsFromApi(bvid);
        if (details && details.channel) {
          const latest = await chrome.storage.local.get(['trackedTabs', 'videoHistory']);
          const curT = latest.trackedTabs || {};
          const curH = latest.videoHistory || {};
          if (curT[tabId]) {
            curT[tabId].channel = details.channel;
            if (details.title) curT[tabId].title = cleanTitle(details.title);
          }
          if (curH[bvid]) {
            curH[bvid].channel = details.channel;
          }
          await chrome.storage.local.set({ trackedTabs: curT, videoHistory: curH });
        }
      })();
    }
  } else if (prevTab) {
    delete trackedTabs[tabId];
    await chrome.storage.local.set({ trackedTabs });
  }
});

// Tab Closed Listener
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { trackedTabs = {} } = await chrome.storage.local.get('trackedTabs');
  if (trackedTabs[tabId]) {
    delete trackedTabs[tabId];
    await chrome.storage.local.set({ trackedTabs });
  }
});

// Message Passing Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const browserName = await getBrowserName();

    switch (message.type) {
      case 'RECORD_TAB_METADATA': {
        if (!sender.tab || !sender.tab.id) {
          sendResponse({ success: false });
          return;
        }
        const { trackedTabs = {}, videoHistory = {}, windowNames = {} } =
          await chrome.storage.local.get(['trackedTabs', 'videoHistory', 'windowNames']);
        const tabId = sender.tab.id;
        const meta = message.data || {};
        const bvid = meta.bvid || extractBvid(meta.url || sender.tab.url);
        const wsName = windowNames[sender.tab.windowId] || `工作区 ${sender.tab.windowId}`;

        const cleanT = cleanTitle(meta.title) || trackedTabs[tabId]?.title || cleanTitle(sender.tab.title);
        const channel = meta.channel || trackedTabs[tabId]?.channel || '';

        trackedTabs[tabId] = {
          tabId: tabId,
          windowId: sender.tab.windowId,
          workspace: wsName,
          url: meta.url || sender.tab.url,
          bvid: bvid,
          title: cleanT,
          channel: channel,
          browser: browserName,
          isBilibiliTab: true,
          isBilibiliVideo: isBilibiliVideoUrl(meta.url || sender.tab.url),
          openedAt: trackedTabs[tabId]?.openedAt || new Date().toISOString(),
          lastUpdated: new Date().toISOString()
        };

        if (bvid && cleanT) {
          videoHistory[bvid] = {
            bvid: bvid,
            title: cleanT,
            channel: channel,
            url: meta.url || sender.tab.url,
            lastSeen: new Date().toISOString()
          };
        }

        await chrome.storage.local.set({ trackedTabs, videoHistory });
        sendResponse({ success: true });
        break;
      }

      case 'VIDEO_DELETED_DETECTED': {
        const meta = message.data || {};
        const bvid = meta.bvid || extractBvid(meta.url);
        const { videoHistory = {}, trackedTabs = {}, windowNames = {} } =
          await chrome.storage.local.get(['videoHistory', 'trackedTabs', 'windowNames']);

        const winId = (sender.tab && sender.tab.windowId) || 0;
        const wsName = windowNames[winId] || (sender.tab ? `工作区 ${winId}` : '');

        const tabTitle = (sender.tab && sender.tab.id && trackedTabs[sender.tab.id]?.title) ||
                         videoHistory[bvid]?.title ||
                         cleanTitle(sender.tab?.title) ||
                         '已删除的B站视频';
        const tabChannel = (sender.tab && sender.tab.id && trackedTabs[sender.tab.id]?.channel) ||
                           videoHistory[bvid]?.channel ||
                           '未知UP主';

        await recordDeletedVideo({
          id: bvid || ('deleted-' + Date.now()),
          bvid: bvid,
          title: tabTitle,
          channel: tabChannel,
          browser: wsName ? `${browserName} (${wsName})` : browserName,
          originalUrl: meta.url || (sender.tab && sender.tab.url) || '',
          deletedAt: new Date().toISOString(),
          reason: meta.reason || '页面检测显示视频已被删除/下架',
          acknowledged: false
        });

        sendResponse({ success: true });
        break;
      }

      case 'LANDING_PAGE_ACTIVE': {
        if (sender.tab && sender.tab.id) {
          const tabId = sender.tab.id;
          const { trackedTabs = {}, videoHistory = {}, windowNames = {} } =
            await chrome.storage.local.get(['trackedTabs', 'videoHistory', 'windowNames']);
          const prevTab = trackedTabs[tabId];

          if (prevTab && prevTab.isBilibiliVideo) {
            const bvid = prevTab.bvid;
            const wsName = windowNames[sender.tab.windowId] || prevTab.workspace || `工作区 ${sender.tab.windowId}`;
            await recordDeletedVideo({
              id: bvid || ('tab-' + tabId + '-' + Date.now()),
              bvid: bvid,
              title: prevTab.title || videoHistory[bvid]?.title || '已删除的B站视频',
              channel: prevTab.channel || videoHistory[bvid]?.channel || '未知UP主',
              browser: `${browserName} (${wsName})`,
              originalUrl: prevTab.url,
              deletedAt: new Date().toISOString(),
              reason: '已重定向至首页 (UP主删稿或被平台下架)',
              acknowledged: false
            });
            delete trackedTabs[tabId];
            await chrome.storage.local.set({ trackedTabs });
            await updateBadgeAndIcon();
          }
        }
        sendResponse({ success: true });
        break;
      }

      case 'GET_ALL_STATE': {
        const state = await chrome.storage.local.get([
          'trackedTabs',
          'deletedVideos',
          'crossBrowserTabs',
          'lastSyncTime',
          'syncServerStatus',
          'customBrowserName',
          'syncServerUrl',
          'windowNames'
        ]);
        const currentBrowser = await getBrowserName();
        sendResponse({
          ...state,
          currentBrowser: currentBrowser
        });
        break;
      }

      case 'SET_WORKSPACE_NAME': {
        const { windowId, name } = message;
        if (windowId && name) {
          const { windowNames = {}, trackedTabs = {} } =
            await chrome.storage.local.get(['windowNames', 'trackedTabs']);
          windowNames[windowId] = name.trim();

          // Update tabs under this window
          for (const t of Object.values(trackedTabs)) {
            if (t.windowId === windowId) {
              t.workspace = name.trim();
            }
          }

          await chrome.storage.local.set({ windowNames, trackedTabs });
          await syncWithServer();
          sendResponse({ success: true, name: name.trim() });
        } else {
          sendResponse({ success: false });
        }
        break;
      }

      case 'TRIGGER_SYNC_NOW': {
        await checkAllTabsHealth();
        const syncResult = await syncWithServer();
        sendResponse({ success: true, syncResult });
        break;
      }

      case 'ACKNOWLEDGE_DELETED': {
        const { deletedVideos = [] } = await chrome.storage.local.get('deletedVideos');
        const updated = deletedVideos.map(v => ({ ...v, acknowledged: true }));
        await chrome.storage.local.set({ deletedVideos: updated });
        await updateBadgeAndIcon();
        sendResponse({ success: true });
        break;
      }

      case 'CLEAR_DELETED_RECORDS': {
        await chrome.storage.local.set({ deletedVideos: [] });
        await updateBadgeAndIcon();
        await syncWithServer();
        sendResponse({ success: true });
        break;
      }

      case 'REMOVE_DELETED_ITEM': {
        const { deletedVideos = [] } = await chrome.storage.local.get('deletedVideos');
        const targetId = message.id;
        const filtered = deletedVideos.filter(v => v.id !== targetId && v.bvid !== targetId);
        await chrome.storage.local.set({ deletedVideos: filtered });
        await updateBadgeAndIcon();
        await syncWithServer();
        sendResponse({ success: true });
        break;
      }

      case 'SET_BROWSER_NAME': {
        const newName = message.name || '';
        await chrome.storage.local.set({ customBrowserName: newName });
        await syncWithServer();
        sendResponse({ success: true, browser: await getBrowserName() });
        break;
      }

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  })();

  return true;
});
