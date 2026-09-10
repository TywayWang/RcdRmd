const assert = require('assert');

function cleanTitle(text) {
  if (!text) return '';
  return text
    .replace(/_哔哩哔哩_bilibili.*/i, '')
    .replace(/_哔哩哔哩.*/i, '')
    .replace(/ - 哔哩哔哩.*/i, '')
    .replace(/ - bilibili.*/i, '')
    .trim();
}

function extractBvid(url) {
  if (!url) return '';
  const match = url.match(/\/video\/(BV[0-9a-zA-Z]+)/i);
  return match ? match[1] : '';
}

function isBilibiliUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('bilibili.com');
  } catch (e) {
    return false;
  }
}

function isBilibiliVideoUrl(url) {
  if (!url) return false;
  return /bilibili\.com\/video\/(BV|av)/i.test(url) ||
         /bilibili\.com\/bangumi\/play\//i.test(url) ||
         /bilibili\.com\/festival\//i.test(url) ||
         /bilibili\.com\/cheese\/play\//i.test(url);
}

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
    return false;
  }
  return false;
}

function crossCheckAdjacentDatasets(lastSyncDataset, currentTabMap, deletedVideos = [], videoHistory = {}) {
  const currentSyncDataset = {};
  const newDeletions = [];

  for (const [tabId, tab] of currentTabMap.entries()) {
    if (!isBilibiliUrl(tab.url)) continue;

    const bvid = extractBvid(tab.url);
    const isVideo = isBilibiliVideoUrl(tab.url);
    const isLanding = isLandingPageOrError(tab.url);
    const prevRecord = lastSyncDataset[tabId] || {};

    const title = cleanTitle(tab.title) || prevRecord.title || videoHistory[bvid]?.title || (isVideo ? 'B站视频' : 'B站页面');
    const channel = prevRecord.channel || videoHistory[bvid]?.channel || '';

    currentSyncDataset[tabId] = {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      bvid: bvid,
      title: title,
      channel: channel,
      isBilibiliVideo: isVideo,
      isLandingPage: isLanding
    };
  }

  if (lastSyncDataset && Object.keys(lastSyncDataset).length > 0) {
    for (const [prevTabIdStr, prevRecord] of Object.entries(lastSyncDataset)) {
      const prevTabId = parseInt(prevTabIdStr, 10);
      if (!prevRecord || !prevRecord.isBilibiliVideo) continue;

      const currTab = currentTabMap.get(prevTabId);
      if (!currTab) {
        continue; // Tab closed -> ignore
      }

      if (isLandingPageOrError(currTab.url)) {
        const bvid = prevRecord.bvid || '';
        const title = prevRecord.title || videoHistory[bvid]?.title || '已删除的B站视频';
        const channel = prevRecord.channel || videoHistory[bvid]?.channel || '未知UP主';
        const deletedItem = {
          id: bvid || ('tab-' + prevTabId),
          bvid: bvid,
          title: title,
          channel: channel,
          originalUrl: prevRecord.url,
          deletedAt: new Date().toISOString(),
          reason: '原视频标签页已重定向至首页 (UP主删稿或被平台下架)'
        };

        newDeletions.push(deletedItem);
        deletedVideos.unshift(deletedItem);

        if (currentSyncDataset[prevTabId]) {
          currentSyncDataset[prevTabId].isBilibiliVideo = false;
          currentSyncDataset[prevTabId].isLandingPage = true;
        }
      }
    }
  }

  const cleanedDeleted = deletedVideos.filter(v => {
    const r = (v.reason || '').toLowerCase();
    return !r.includes('http 412') && !r.includes('http 403');
  });

  return { currentSyncDataset, newDeletions, cleanedDeleted };
}

console.log('=== Running Adjacent Dataset Cross-Check Test Suite ===');

// Test 1: Video tab deleted & redirected to landing page
{
  console.log('\n[Test 1] Video tab deleted & redirected to landing page https://www.bilibili.com/');
  const lastSyncDataset = {
    101: { tabId: 101, url: 'https://www.bilibili.com/video/BV1good0001', bvid: 'BV1good0001', title: 'Python入门教程', channel: '代码大师', isBilibiliVideo: true, isLandingPage: false },
    102: { tabId: 102, url: 'https://www.bilibili.com/video/BV1deleted02', bvid: 'BV1deleted02', title: '被UP主删除的珍贵纪录片', channel: '历史档案UP', isBilibiliVideo: true, isLandingPage: false }
  };

  const currentTabMap = new Map([
    [101, { id: 101, windowId: 1, url: 'https://www.bilibili.com/video/BV1good0001', title: 'Python入门教程_哔哩哔哩_bilibili' }],
    [102, { id: 102, windowId: 1, url: 'https://www.bilibili.com/', title: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili' }]
  ]);

  const result = crossCheckAdjacentDatasets(lastSyncDataset, currentTabMap);
  assert.strictEqual(result.newDeletions.length, 1, 'Should detect exactly 1 deleted video');
  assert.strictEqual(result.newDeletions[0].bvid, 'BV1deleted02');
  assert.strictEqual(result.newDeletions[0].title, '被UP主删除的珍贵纪录片');
  assert.strictEqual(result.newDeletions[0].channel, '历史档案UP');
  console.log('✅ Test 1 Passed: Successfully detected deleted video redirecting to landing page.');
}

// Test 2: User manually closed a tab with a video
{
  console.log('\n[Test 2] User manually closed a tab with a video');
  const lastSyncDataset = {
    101: { tabId: 101, url: 'https://www.bilibili.com/video/BV1good0001', bvid: 'BV1good0001', title: 'Python入门教程', channel: '代码大师', isBilibiliVideo: true, isLandingPage: false },
    102: { tabId: 102, url: 'https://www.bilibili.com/video/BV1closed02', bvid: 'BV1closed02', title: '看完了关闭的视频', channel: '日常分享', isBilibiliVideo: true, isLandingPage: false }
  };

  const currentTabMap = new Map([
    [101, { id: 101, windowId: 1, url: 'https://www.bilibili.com/video/BV1good0001', title: 'Python入门教程' }]
  ]);

  const result = crossCheckAdjacentDatasets(lastSyncDataset, currentTabMap);
  assert.strictEqual(result.newDeletions.length, 0, 'Manually closed tab must NOT be flagged as deleted');
  console.log('✅ Test 2 Passed: Manually closed tab is correctly ignored.');
}

// Test 3: User deliberately opens https://www.bilibili.com/ in a new tab
{
  console.log('\n[Test 3] User deliberately opens https://www.bilibili.com/ in a new tab');
  const lastSyncDataset = {
    101: { tabId: 101, url: 'https://www.bilibili.com/video/BV1good0001', bvid: 'BV1good0001', title: 'Python入门教程', channel: '代码大师', isBilibiliVideo: true, isLandingPage: false }
  };

  const currentTabMap = new Map([
    [101, { id: 101, windowId: 1, url: 'https://www.bilibili.com/video/BV1good0001', title: 'Python入门教程' }],
    [205, { id: 205, windowId: 1, url: 'https://www.bilibili.com/', title: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili' }]
  ]);

  const result = crossCheckAdjacentDatasets(lastSyncDataset, currentTabMap);
  assert.strictEqual(result.newDeletions.length, 0, 'Deliberately opened landing page tab must NOT be flagged');
  console.log('✅ Test 3 Passed: Deliberately opened landing page is correctly ignored.');
}

// Test 4: Existing landing page tab remains open
{
  console.log('\n[Test 4] Existing landing page tab remains open between syncs');
  const lastSyncDataset = {
    101: { tabId: 101, url: 'https://www.bilibili.com/video/BV1good0001', bvid: 'BV1good0001', title: 'Python入门教程', channel: '代码大师', isBilibiliVideo: true, isLandingPage: false },
    205: { tabId: 205, url: 'https://www.bilibili.com/', bvid: '', title: 'B站首页', channel: '', isBilibiliVideo: false, isLandingPage: true }
  };

  const currentTabMap = new Map([
    [101, { id: 101, windowId: 1, url: 'https://www.bilibili.com/video/BV1good0001', title: 'Python入门教程' }],
    [205, { id: 205, windowId: 1, url: 'https://www.bilibili.com/', title: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili' }]
  ]);

  const result = crossCheckAdjacentDatasets(lastSyncDataset, currentTabMap);
  assert.strictEqual(result.newDeletions.length, 0, 'Existing homepage tab must NOT be flagged');
  console.log('✅ Test 4 Passed: Existing landing tab is correctly ignored.');
}

// Test 5: Legacy false HTTP 412 records are purged
{
  console.log('\n[Test 5] Legacy false HTTP 412 records cleanup');
  const legacyDeleted = [
    { id: '1', title: '正常视频1', reason: 'HTTP 412' },
    { id: '2', title: '正常视频2', reason: 'HTTP 412' },
    { id: '3', title: '真正被删视频', reason: '原视频标签页已重定向至首页 (UP主删稿或被平台下架)' }
  ];

  const result = crossCheckAdjacentDatasets({}, new Map(), legacyDeleted);
  assert.strictEqual(result.cleanedDeleted.length, 1, 'Should purge all HTTP 412 records');
  assert.strictEqual(result.cleanedDeleted[0].title, '真正被删视频');
  console.log('✅ Test 5 Passed: All legacy false HTTP 412 errors are cleanly purged.');
}

console.log('\n🎉 ALL 5 CROSS-CHECK TESTS PASSED SUCCESSFULLY! 🎉');
