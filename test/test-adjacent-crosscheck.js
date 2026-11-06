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
  if (t === 'B站视频' || t === 'B站页面' || t === 'B站标签页' || t === 'B站首页' || t.startsWith('哔哩哔哩') || t.startsWith('bilibili')) {
    return false;
  }
  return !isDeletedOrErrorText(t);
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
    const rawCleanTitle = cleanTitle(tab.title);

    let title = '';
    if (isValidVideoTitle(rawCleanTitle)) {
      title = rawCleanTitle;
    } else if (isValidVideoTitle(prevRecord.title)) {
      title = prevRecord.title;
    } else if (bvid && isValidVideoTitle(videoHistory[bvid]?.title)) {
      title = videoHistory[bvid].title;
    } else {
      title = isVideo ? 'B站视频' : 'B站页面';
    }

    const channel = (prevRecord.channel && prevRecord.channel !== '未知UP主')
      ? prevRecord.channel
      : (bvid && videoHistory[bvid]?.channel)
        ? videoHistory[bvid].channel
        : '';

    const isDeletedState = isDeletedOrErrorText(rawCleanTitle);

    currentSyncDataset[tabId] = {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      bvid: bvid,
      title: title,
      channel: channel,
      isBilibiliVideo: isVideo && !isDeletedState,
      isLandingPage: isLanding,
      isDeleted: isDeletedState
    };

    if (bvid && isVideo && isValidVideoTitle(title)) {
      videoHistory[bvid] = {
        bvid,
        title,
        channel,
        url: tab.url
      };
    }
  }

  if (lastSyncDataset && Object.keys(lastSyncDataset).length > 0) {
    for (const [prevTabIdStr, prevRecord] of Object.entries(lastSyncDataset)) {
      const prevTabId = parseInt(prevTabIdStr, 10);
      if (!prevRecord || !prevRecord.isBilibiliVideo) continue;

      const currTab = currentTabMap.get(prevTabId);
      if (!currTab) {
        continue; // Tab closed -> ignore
      }

      const nowLanding = isLandingPageOrError(currTab.url);
      const nowDeletedText = isDeletedOrErrorText(currTab.title);

      if (nowLanding || nowDeletedText) {
        const bvid = prevRecord.bvid || extractBvid(prevRecord.url) || extractBvid(currTab.url) || '';
        const title = (isValidVideoTitle(prevRecord.title))
          ? prevRecord.title
          : (bvid && isValidVideoTitle(videoHistory[bvid]?.title))
            ? videoHistory[bvid].title
            : '（原视频标题未获取）';

        const channel = (prevRecord.channel && prevRecord.channel !== '未知UP主')
          ? prevRecord.channel
          : (bvid && videoHistory[bvid]?.channel)
            ? videoHistory[bvid].channel
            : '未知UP主';

        const reason = nowLanding
          ? '原视频标签页已重定向至首页 (UP主删稿或被平台下架)'
          : '原视频已失效/被删除 (页面显示“视频去哪儿了？”)';

        const deletedItem = {
          id: bvid || ('tab-' + prevTabId),
          bvid: bvid,
          title: title,
          channel: channel,
          originalUrl: prevRecord.url,
          deletedAt: new Date().toISOString(),
          reason: reason
        };

        newDeletions.push(deletedItem);

        const existingIdx = deletedVideos.findIndex(v => (v.bvid && bvid && v.bvid === bvid) || (v.id === deletedItem.id));
        if (existingIdx >= 0) {
          if (isValidVideoTitle(title)) {
            deletedVideos[existingIdx].title = title;
          }
          if (channel && channel !== '未知UP主') {
            deletedVideos[existingIdx].channel = channel;
          }
          deletedVideos[existingIdx].reason = reason;
        } else {
          deletedVideos.unshift(deletedItem);
        }

        if (currentSyncDataset[prevTabId]) {
          currentSyncDataset[prevTabId].isBilibiliVideo = false;
          currentSyncDataset[prevTabId].isLandingPage = nowLanding;
          currentSyncDataset[prevTabId].isDeleted = true;
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
    102: { tabId: 102, url: 'https://www.bilibili.com/video/BV1deleted02', bvid: 'BV1deleted02', title: '被UP主删除的示例纪录片', channel: '示例档案UP', isBilibiliVideo: true, isLandingPage: false }
  };

  const currentTabMap = new Map([
    [101, { id: 101, windowId: 1, url: 'https://www.bilibili.com/video/BV1good0001', title: 'Python入门教程_哔哩哔哩_bilibili' }],
    [102, { id: 102, windowId: 1, url: 'https://www.bilibili.com/', title: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili' }]
  ]);

  const result = crossCheckAdjacentDatasets(lastSyncDataset, currentTabMap);
  assert.strictEqual(result.newDeletions.length, 1, 'Should detect exactly 1 deleted video');
  assert.strictEqual(result.newDeletions[0].bvid, 'BV1deleted02');
  assert.strictEqual(result.newDeletions[0].title, '被UP主删除的示例纪录片');
  assert.strictEqual(result.newDeletions[0].channel, '示例档案UP');
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

// Test 6: Video tab displays "视频去哪了呢？" / "视频去哪儿了？" while at video URL
{
  console.log('\n[Test 6] Video tab displays "视频去哪了呢？" before redirecting to homepage');
  const lastSyncDataset = {
    101: { tabId: 101, url: 'https://www.bilibili.com/video/BV1sample001', bvid: 'BV1sample001', title: '示例基础教学课程', channel: '示例教学UP主', isBilibiliVideo: true, isLandingPage: false }
  };

  const currentTabMap = new Map([
    [101, { id: 101, windowId: 1, url: 'https://www.bilibili.com/video/BV1sample001', title: '视频去哪了呢？_哔哩哔哩_bilibili' }]
  ]);

  const result = crossCheckAdjacentDatasets(lastSyncDataset, currentTabMap);
  assert.strictEqual(result.newDeletions.length, 1, 'Should detect deletion even while still on video URL');
  assert.strictEqual(result.newDeletions[0].bvid, 'BV1sample001');
  assert.strictEqual(result.newDeletions[0].title, '示例基础教学课程', 'Title MUST be the real video title, NOT "视频去哪了呢？"');
  assert.strictEqual(result.newDeletions[0].channel, '示例教学UP主', 'Channel MUST be preserved');
  console.log('✅ Test 6 Passed: "视频去哪了呢？" state detected and original title/channel preserved.');
}

// Test 7: Title validation unit tests
{
  console.log('\n[Test 7] Video title validation unit tests');
  assert.strictEqual(isValidVideoTitle('【公开课】计算机科学导论'), true);
  assert.strictEqual(isValidVideoTitle('示例基础教学课程'), true);
  assert.strictEqual(isValidVideoTitle('那些年陪伴我们的经典视频去哪儿了？'), true, 'Video with "视频去哪儿了？" as part of a longer real title must be valid');
  assert.strictEqual(isValidVideoTitle('盘点那些年看过的视频去哪儿了？经典回顾'), true);
  assert.strictEqual(isValidVideoTitle('视频去哪了呢？'), false);
  assert.strictEqual(isValidVideoTitle('视频去哪儿了？'), false);
  assert.strictEqual(isValidVideoTitle('视频去哪了呢？_哔哩哔哩_bilibili'), false);
  assert.strictEqual(isValidVideoTitle('出错了 - bilibili.com'), false);
  assert.strictEqual(isValidVideoTitle('404 Not Found'), false);
  assert.strictEqual(isValidVideoTitle('404'), false);
  assert.strictEqual(isValidVideoTitle('B站视频'), false);
  assert.strictEqual(isValidVideoTitle('B站页面'), false);
  assert.strictEqual(isValidVideoTitle('B站首页'), false);
  assert.strictEqual(isValidVideoTitle('哔哩哔哩 (゜-゜)つロ 干杯~'), false);
  assert.strictEqual(isValidVideoTitle('已删除的B站视频'), false);
  assert.strictEqual(isValidVideoTitle('（原视频标题未获取）'), false);
  assert.strictEqual(isValidVideoTitle('原视频标题未获取'), false);
  assert.strictEqual(isValidVideoTitle('视频已失效'), false);
  assert.strictEqual(isValidVideoTitle('原视频已失效'), false);
  console.log('✅ Test 7 Passed: Video title validator accurately distinguishes genuine titles from error messages.');
}

// Test 8: Discarded/sleeping tab restore in Edge workspace
{
  console.log('\n[Test 8] Simulating sleeping/discarded tab restore in Edge workspace where video was deleted');
  const lastSyncDataset = {
    105: {
      tabId: 105,
      url: 'https://www.bilibili.com/video/BV1sleeping01',
      bvid: 'BV1sleeping01',
      title: '休眠标签页被恢复的示例教程',
      channel: '示例讲堂UP',
      isBilibiliVideo: true,
      isLandingPage: false
    }
  };

  // Tab restores and directly lands on bilibili homepage redirect
  const currentTabMap = new Map([
    [105, { id: 105, windowId: 2, url: 'https://www.bilibili.com/', title: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili' }]
  ]);

  const result = crossCheckAdjacentDatasets(lastSyncDataset, currentTabMap);
  assert.strictEqual(result.newDeletions.length, 1);
  assert.strictEqual(result.newDeletions[0].bvid, 'BV1sleeping01');
  assert.strictEqual(result.newDeletions[0].title, '休眠标签页被恢复的示例教程');
  assert.strictEqual(result.newDeletions[0].channel, '示例讲堂UP');
  console.log('✅ Test 8 Passed: Restored sleeping tab deletion correctly recognized with genuine title & channel.');
}

// Test 9: Video history recovery when previously corrupted with placeholder
{
  console.log('\n[Test 9] Recovery when current tab title has placeholder but history has true title');
  const lastSyncDataset = {
    106: {
      tabId: 106,
      url: 'https://www.bilibili.com/video/BV1corrupted01',
      bvid: 'BV1corrupted01',
      title: '（原视频标题未获取）',
      channel: '未知UP主',
      isBilibiliVideo: true,
      isLandingPage: false
    }
  };

  const videoHistory = {
    'BV1corrupted01': {
      bvid: 'BV1corrupted01',
      title: '历史记录中保存的完整示例课程',
      channel: '示例教学UP主'
    }
  };

  const currentTabMap = new Map([
    [106, { id: 106, windowId: 1, url: 'https://www.bilibili.com/', title: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili' }]
  ]);

  const result = crossCheckAdjacentDatasets(lastSyncDataset, currentTabMap, [], videoHistory);
  assert.strictEqual(result.newDeletions.length, 1);
  assert.strictEqual(result.newDeletions[0].title, '历史记录中保存的完整示例课程', 'Must resolve true title from history');
  assert.strictEqual(result.newDeletions[0].channel, '示例教学UP主', 'Must resolve channel from history');
  console.log('✅ Test 9 Passed: Successfully recovered true title and channel from history.');
}

// Test 10 & 11: Execute actual Release/background.js functions in VM context
(async () => {
  const vm = require('vm');
  const fs = require('fs');
  const path = require('path');

  console.log('\n[Test 10] Executing background.js checkAllTabsHealth() on restored video tab with new tabId showing "视频去哪了呢？"');
  const storageData = {
    lastSyncDataset: {
      101: {
        tabId: 101,
        windowId: 1,
        workspace: '工作区 1',
        url: 'https://www.bilibili.com/video/BV1restart01',
        bvid: 'BV1restart01',
        title: '重启前记录的示例算法课',
        channel: '算法讲师UP',
        isBilibiliVideo: true
      }
    },
    trackedTabs: {},
    videoHistory: {},
    deletedVideos: [],
    windowNames: { 1: '工作区 1' },
    crossBrowserTabs: []
  };

  const sandbox = {
    console,
    URL,
    Date,
    Map,
    Set,
    Object,
    Array,
    Promise,
    parseInt,
    encodeURIComponent,
    AbortController,
    setTimeout,
    clearTimeout,
    navigator: { userAgent: 'Mozilla/5.0 Edg/120.0.0.0' },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        allOpeningTabs: [],
        deletedVideos: [
          {
            id: 'BV1restart01',
            bvid: 'BV1restart01',
            title: '服务器恢复的示例算法课标题',
            channel: '服务器恢复的UP主'
          }
        ]
      })
    }),
    chrome: {
      storage: {
        local: {
          get: async (keys) => {
            if (typeof keys === 'string') return { [keys]: storageData[keys] };
            if (Array.isArray(keys)) {
              const out = {};
              keys.forEach(k => { if (storageData[k] !== undefined) out[k] = storageData[k]; });
              return out;
            }
            return { ...storageData };
          },
          set: async (obj) => {
            Object.assign(storageData, obj);
          }
        }
      },
      windows: {
        getAll: async () => [
          {
            id: 1,
            tabs: [
              {
                id: 999, // New tabId assigned after browser session restore
                windowId: 1,
                url: 'https://www.bilibili.com/video/BV1restart01',
                title: '视频去哪了呢？_哔哩哔哩_bilibili'
              }
            ]
          }
        ],
        onCreated: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      },
      tabs: {
        onUpdated: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      },
      alarms: {
        create: async () => {},
        onAlarm: { addListener: () => {} }
      },
      runtime: {
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      action: {
        setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {},
        setBadgeTextColor: async () => {},
        setIcon: async () => {},
        setTitle: async () => {}
      },
      history: {
        search: (q, cb) => cb([])
      }
    }
  };

  const bgCode = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf-8');
  vm.createContext(sandbox);
  vm.runInContext(bgCode, sandbox);

  await sandbox.checkAllTabsHealth('startup');
  assert.strictEqual(storageData.deletedVideos.length, 1, 'Should record deleted video even when tabId changed after restart');
  assert.strictEqual(storageData.deletedVideos[0].bvid, 'BV1restart01');
  assert.strictEqual(storageData.deletedVideos[0].title, '重启前记录的示例算法课');
  assert.strictEqual(storageData.deletedVideos[0].channel, '算法讲师UP');
  console.log('✅ Test 10 Passed: background.js checkAllTabsHealth() captures deleted video with new tabId and resolves title from previous dataset.');

  console.log('\n[Test 11] Executing background.js syncWithServer() to verify server-repaired title/channel updates existing localDeleted entry');
  storageData.deletedVideos = [
    {
      id: 'BV1restart01',
      bvid: 'BV1restart01',
      title: '（原视频标题未获取）',
      channel: '未知UP主',
      acknowledged: false
    }
  ];
  await sandbox.syncWithServer();
  assert.strictEqual(storageData.deletedVideos[0].title, '服务器恢复的示例算法课标题');
  assert.strictEqual(storageData.deletedVideos[0].channel, '服务器恢复的UP主');
  console.log('✅ Test 11 Passed: background.js syncWithServer() propagates server-repaired title and channel to existing localDeleted entry.');

  console.log('\n[Test 12] Executing popup.js loadState() to verify chrome.history.search fallback is reached when trackedTabs is a truthy object');
  let domLoadedCallback = null;
  let savedStorage = null;
  const makeStubEl = () => ({
    textContent: '',
    innerHTML: '',
    value: '',
    title: '',
    src: '',
    className: '',
    disabled: false,
    dataset: {},
    classList: { add: () => {}, remove: () => {} },
    addEventListener: () => {},
    appendChild: () => {}
  });
  const popupSandbox = {
    console,
    URL,
    Date,
    Object,
    Array,
    Promise,
    parseInt,
    encodeURIComponent,
     encodeURI,
    setTimeout,
    document: {
      addEventListener: (ev, cb) => { if (ev === 'DOMContentLoaded') domLoadedCallback = cb; },
      getElementById: () => makeStubEl(),
      querySelectorAll: () => [],
      createElement: () => makeStubEl()
    },
    chrome: {
      windows: {
        getCurrent: async () => ({ id: 1, tabs: [] }),
        getAll: async () => ([{ id: 1, tabs: [] }])
      },
      runtime: {
        sendMessage: async () => ({
          trackedTabs: { 500: { tabId: 500, bvid: 'BV1popupHist01', title: '视频已失效' } },
          videoHistory: {},
          deletedVideos: [
            {
              id: 'BV1popupHist01',
              bvid: 'BV1popupHist01',
              title: '（原视频标题未获取）',
              channel: '未知UP主',
              acknowledged: false
            }
          ]
        })
      },
      history: {
        search: async ({ text }) => [
          {
            url: `https://www.bilibili.com/video/${text}`,
            title: '从浏览器历史恢复的弹窗测试课程_哔哩哔哩_bilibili'
          }
        ]
      },
      storage: {
        local: {
          set: async (obj) => { savedStorage = obj; }
        }
      }
    }
  };
  const popupCode = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.js'), 'utf-8');
  vm.createContext(popupSandbox);
  vm.runInContext(popupCode, popupSandbox);
  await domLoadedCallback();
  assert.ok(savedStorage && Array.isArray(savedStorage.deletedVideos), 'popup.js should persist repaired deletedVideos');
  assert.strictEqual(savedStorage.deletedVideos[0].title, '从浏览器历史恢复的弹窗测试课程');
  console.log('✅ Test 12 Passed: popup.js loadState() reaches chrome.history.search and repairs title even when trackedTabs is truthy.');

  console.log('\n🎉 ALL 12 CROSS-CHECK & VM INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
})().catch(err => {
  console.error('❌ VM Integration Test failed:', err);
  process.exit(1);
});
