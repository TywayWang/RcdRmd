/**
 * Automated Test Suite for RcdRmd
 * Verifies:
 * 1. Sync server startup, token authentication, and API endpoints
 * 2. Multi-browser and multi-window/workspace dataset generation (Edge workspaces, Chrome, Canary)
 * 3. Accurate per-window and total tab counts
 * 4. Deleted video registration, title recovery from history, and cross-browser propagation
 * 5. Dataset persistence and cleanup
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 32189;
const SERVER_PATH = path.join(__dirname, '..', 'sync-server', 'rcdrmd-sync-server.js');
const DATASET_PATH = path.join(__dirname, '..', 'sync-server', 'rcdrmd-test.dataset.json');
const SYNC_TOKEN = 'rcdrmd-local-sync-token';
const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  'X-RcdRmd-Token': SYNC_TOKEN
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('--- Starting RcdRmd Multi-Browser & Multi-Workspace Tests ---');

  // Clean previous test dataset if exists
  if (fs.existsSync(DATASET_PATH)) {
    fs.unlinkSync(DATASET_PATH);
  }

  // 1. Spawn sync server process on isolated test port & dataset file
  const serverProcess = spawn('node', [SERVER_PATH], {
    stdio: 'inherit',
    env: {
      ...process.env,
      RCDRMD_PORT: String(TEST_PORT),
      RCDRMD_DATASET_FILE: DATASET_PATH
    }
  });
  await sleep(1200);

  try {
    // 2. Test unauthorized rejection and authorized status endpoint
    console.log('\n[Test 1] Checking token auth & server status...');
    const unauthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/status`);
    if (unauthRes.status !== 401) {
      throw new Error(`Expected 401 without token, got ${unauthRes.status}`);
    }

    const statusRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/status`, {
      headers: { 'X-RcdRmd-Token': SYNC_TOKEN }
    });
    const statusData = await statusRes.json();
    console.log('Status response:', statusData);
    if (statusData.status !== 'online') throw new Error('Status not online');
    console.log('✅ Test 1 Passed: Server online and enforces X-RcdRmd-Token.');

    // 3. Simulate Microsoft Edge with 2 Workspaces: "工作区 1" (20 tabs) and "工作区 2" (10 tabs)
    console.log('\n[Test 2] Simulating Edge syncing 2 workspaces: "工作区 1" (20 tabs) and "工作区 2" (10 tabs)...');

    const edgeTabs = [];
    for (let i = 1; i <= 20; i++) {
      edgeTabs.push({
        tabId: 1000 + i,
        windowId: 1,
        workspace: '工作区 1',
        bvid: `BV1wsA${i.toString().padStart(5, '0')}`,
        title: `【工作区 1】第 ${i} 个示例测试视频`,
        channel: '测试UP主A',
        url: `https://www.bilibili.com/video/BV1wsA${i.toString().padStart(5, '0')}`
      });
    }

    for (let i = 1; i <= 10; i++) {
      edgeTabs.push({
        tabId: 2000 + i,
        windowId: 2,
        workspace: '工作区 2',
        bvid: `BV1wsB${i.toString().padStart(5, '0')}`,
        title: `【工作区 2】第 ${i} 个技术开发示例视频`,
        channel: '测试UP主B',
        url: `https://www.bilibili.com/video/BV1wsB${i.toString().padStart(5, '0')}`
      });
    }

    const edgeSyncRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/sync`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        browser: 'Microsoft Edge',
        windows: {
          '工作区 1': 20,
          '工作区 2': 10
        },
        tabs: edgeTabs,
        deletedVideos: []
      })
    });
    const edgeData = await edgeSyncRes.json();
    console.log(`Edge synced. Total tabs in dataset: ${edgeData.allOpeningTabs.length}`);
    if (edgeData.allOpeningTabs.length !== 30) throw new Error(`Expected 30 tabs, got ${edgeData.allOpeningTabs.length}`);
    console.log('✅ Test 2 Passed: Microsoft Edge "工作区 1" (20) and "工作区 2" (10) synced accurately (Total 30).');

    // 4. Simulate Google Chrome syncing 2 tabs
    console.log('\n[Test 3] Simulating Google Chrome tab sync...');
    const chromeSyncRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/sync`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        browser: 'Google Chrome',
        windows: { 'Default': 2 },
        tabs: [
          { tabId: 301, windowId: 3, workspace: 'Default', bvid: 'BV1chr00001', title: '【示例】Web前端工程化实践', channel: '前端技术UP', url: 'https://www.bilibili.com/video/BV1chr00001' },
          { tabId: 302, windowId: 3, workspace: 'Default', bvid: 'BV1chr00002', title: '【示例】开源硬件制作教程', channel: '硬件创客UP', url: 'https://www.bilibili.com/video/BV1chr00002' }
        ],
        deletedVideos: []
      })
    });
    const chromeData = await chromeSyncRes.json();
    console.log(`Chrome synced. Total tabs across all browsers: ${chromeData.allOpeningTabs.length}`);
    if (chromeData.allOpeningTabs.length !== 32) throw new Error('Expected 32 combined tabs');
    console.log('✅ Test 3 Passed: Chrome tabs merged correctly with Edge workspaces.');

    // 5. Simulate Edge detecting a deleted video in "工作区 2"
    console.log('\n[Test 4] Simulating Edge reporting deleted video in "工作区 2"...');
    const edgeReportDeletedRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/sync`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        browser: 'Microsoft Edge',
        windows: {
          '工作区 1': 20,
          '工作区 2': 9
        },
        tabs: edgeTabs.slice(0, 29), // 1 tab deleted
        deletedVideos: [
          {
            id: 'BV1wsB00010',
            bvid: 'BV1wsB00010',
            title: '【工作区 2】算法与数据结构进阶指南',
            channel: '科技科普UP',
            browser: 'Microsoft Edge (工作区 2)',
            originalUrl: 'https://www.bilibili.com/video/BV1wsB00010',
            deletedAt: new Date().toISOString(),
            reason: '已重定向至首页 (UP主删稿或被平台下架)',
            acknowledged: false
          }
        ]
      })
    });
    const edgeDeletedData = await edgeReportDeletedRes.json();
    if (edgeDeletedData.deletedVideos.length !== 1) throw new Error('Expected 1 deleted video');
    console.log('✅ Test 4 Passed: Deleted video from "工作区 2" registered.');

    // 6. Simulate Google Chrome Canary syncing and receiving the deleted video
    console.log('\n[Test 5] Simulating Canary receiving the deleted video...');
    const canarySyncRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/sync`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        browser: 'Google Chrome Canary',
        windows: { 'Default': 1 },
        tabs: [
          { tabId: 401, windowId: 4, workspace: 'Default', bvid: 'BV1can00001', title: '【示例】古典吉他指弹练习曲', channel: '音乐工坊UP', url: 'https://www.bilibili.com/video/BV1can00001' }
        ],
        deletedVideos: []
      })
    });
    const canaryData = await canarySyncRes.json();
    if (canaryData.deletedVideos.length !== 1) throw new Error('Canary failed to receive deleted video');
    if (canaryData.deletedVideos[0].title !== '【工作区 2】算法与数据结构进阶指南') throw new Error('Title mismatch');
    if (canaryData.deletedVideos[0].browser !== 'Microsoft Edge (工作区 2)') throw new Error('Browser/workspace source mismatch');
    console.log('✅ Test 5 Passed: Canary received deleted record with source "Microsoft Edge (工作区 2)".');

    // 7. Test recovering video title when incoming deleted record has error title "视频去哪了呢？"
    console.log('\n[Test 6] Simulating Edge reporting deleted video with error title "视频去哪了呢？"...');
    const edgeReportCorruptedTitleRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/sync`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        browser: 'Microsoft Edge',
        windows: { '工作区 1': 19, '工作区 2': 9 },
        tabs: edgeTabs.slice(1, 29),
        deletedVideos: [
          {
            id: 'BV1wsA00001',
            bvid: 'BV1wsA00001',
            title: '视频去哪了呢？',
            channel: '测试UP主A',
            browser: 'Microsoft Edge (工作区 1)',
            originalUrl: 'https://www.bilibili.com/video/BV1wsA00001',
            deletedAt: new Date().toISOString(),
            reason: '原视频已失效/被删除 (页面显示“视频去哪儿了？”)',
            acknowledged: false
          }
        ]
      })
    });
    const edgeCorruptedData = await edgeReportCorruptedTitleRes.json();
    const recoveredVideo = edgeCorruptedData.deletedVideos.find(v => v.bvid === 'BV1wsA00001');
    if (!recoveredVideo) throw new Error('BV1wsA00001 not found in deletedVideos');
    if (recoveredVideo.title !== '【工作区 1】第 1 个示例测试视频') {
      throw new Error(`Expected title '【工作区 1】第 1 个示例测试视频', got '${recoveredVideo.title}'`);
    }
    console.log('✅ Test 6 Passed: Sync server successfully resolved original title from history instead of "视频去哪了呢？".');

    // 8. Test recovering video title when incoming deleted record has placeholder "（原视频标题未获取）"
    console.log('\n[Test 7] Simulating Edge reporting deleted video with placeholder "（原视频标题未获取）"...');
    const edgeReportPlaceholderRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/sync`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        browser: 'Microsoft Edge',
        windows: { '工作区 1': 18, '工作区 2': 9 },
        tabs: edgeTabs.slice(2, 29),
        deletedVideos: [
          {
            id: 'BV1wsA00002',
            bvid: 'BV1wsA00002',
            title: '（原视频标题未获取）',
            channel: '未知UP主',
            browser: 'Microsoft Edge (工作区 1)',
            originalUrl: 'https://www.bilibili.com/video/BV1wsA00002',
            deletedAt: new Date().toISOString(),
            reason: '原视频标签页已重定向至首页 (UP主删稿或被平台下架)',
            acknowledged: false
          }
        ]
      })
    });
    const edgePlaceholderData = await edgeReportPlaceholderRes.json();
    const recoveredPlaceholder = edgePlaceholderData.deletedVideos.find(v => v.bvid === 'BV1wsA00002');
    if (!recoveredPlaceholder) throw new Error('BV1wsA00002 not found in deletedVideos');
    if (recoveredPlaceholder.title !== '【工作区 1】第 2 个示例测试视频') {
      throw new Error(`Expected title '【工作区 1】第 2 个示例测试视频', got '${recoveredPlaceholder.title}'`);
    }
    if (recoveredPlaceholder.channel !== '测试UP主A') {
      throw new Error(`Expected channel '测试UP主A', got '${recoveredPlaceholder.channel}'`);
    }
    console.log('✅ Test 7 Passed: Sync server resolved original title & channel for placeholder "（原视频标题未获取）".');

    // 9. Test retroactive repair when Browser A reports unknown deleted video first, and Browser B later syncs active tabs containing its metadata
    console.log('\n[Test 8] Simulating retroactive repair when a second browser later supplies tab metadata for a previously unknown deleted video...');
    await fetch(`http://127.0.0.1:${TEST_PORT}/api/sync`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        browser: 'Microsoft Edge',
        windows: { '工作区 1': 18, '工作区 2': 9 },
        tabs: edgeTabs.slice(2, 29),
        deletedVideos: [
          {
            id: 'BV1crossRepair99',
            bvid: 'BV1crossRepair99',
            title: '（原视频标题未获取）',
            channel: '未知UP主',
            browser: 'Microsoft Edge (工作区 1)',
            originalUrl: 'https://www.bilibili.com/video/BV1crossRepair99',
            deletedAt: new Date().toISOString(),
            reason: '原视频已失效/被删除 (页面显示“视频去哪儿了？”)',
            acknowledged: false
          }
        ]
      })
    });

    const chromeSupplyMetaRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/sync`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        browser: 'Google Chrome',
        windows: { 'Default': 1 },
        tabs: [
          {
            tabId: 399,
            windowId: 3,
            workspace: 'Default',
            bvid: 'BV1crossRepair99',
            title: '【跨浏览器恢复】计算机图形学渲染管线详解',
            channel: '图形学讲堂UP',
            url: 'https://www.bilibili.com/video/BV1crossRepair99'
          }
        ],
        deletedVideos: []
      })
    });
    const chromeSupplyMetaData = await chromeSupplyMetaRes.json();
    const crossRepaired = chromeSupplyMetaData.deletedVideos.find(v => v.bvid === 'BV1crossRepair99');
    if (!crossRepaired) throw new Error('BV1crossRepair99 not found in deletedVideos');
    if (crossRepaired.title !== '【跨浏览器恢复】计算机图形学渲染管线详解') {
      throw new Error(`Expected cross-browser repaired title, got '${crossRepaired.title}'`);
    }
    if (crossRepaired.channel !== '图形学讲堂UP') {
      throw new Error(`Expected cross-browser repaired channel, got '${crossRepaired.channel}'`);
    }
    console.log('✅ Test 8 Passed: Sync server retroactively repaired existing deleted video record when another browser supplied tab metadata.');

    // 10. Verify persistent JSON dataset file
    console.log('\n[Test 9] Verifying local dataset file persistence...');
    if (!fs.existsSync(DATASET_PATH)) throw new Error('Dataset file does not exist on disk');
    const diskDataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
    console.log('Edge windows in dataset:', diskDataset.browsers['Microsoft Edge'].windows);
    if (diskDataset.browsers['Microsoft Edge'].windows['工作区 1'] !== 18) throw new Error('工作区 1 count mismatch');
    if (diskDataset.browsers['Microsoft Edge'].windows['工作区 2'] !== 9) throw new Error('工作区 2 count mismatch');
    console.log('✅ Test 9 Passed: Dataset file stores exact workspace counts.');

    // 11. Verify Python sync server parity (auth, Unicode stdout handling, retroactive cross-browser repair)
    console.log('\n[Test 10] Verifying Python sync server (rcdrmd-sync-server.py) parity...');
    const pyPort = TEST_PORT + 1;
    const pyServerPath = path.join(__dirname, '..', 'sync-server', 'rcdrmd-sync-server.py');
    const pyDatasetPath = path.join(__dirname, '..', 'sync-server', 'rcdrmd-py-test.dataset.json');
    if (fs.existsSync(pyDatasetPath)) fs.unlinkSync(pyDatasetPath);

    const pyProc = spawn('python', ['-B', pyServerPath], {
      stdio: 'pipe', // Piped stdio tests non-console default encoding on Windows
      env: {
        ...process.env,
        RCDRMD_PORT: String(pyPort),
        RCDRMD_DATASET_FILE: pyDatasetPath
      }
    });
    await sleep(1200);
    try {
      const pyUnauth = await fetch(`http://127.0.0.1:${pyPort}/api/status`);
      if (pyUnauth.status !== 401) throw new Error(`Python server expected 401, got ${pyUnauth.status}`);

      const pyStatusRes = await fetch(`http://127.0.0.1:${pyPort}/api/status`, { headers: AUTH_HEADERS });
      const pyStatus = await pyStatusRes.json();
      if (pyStatus.datasetFile !== 'rcdrmd-py-test.dataset.json') {
        throw new Error(`Python server datasetFile mismatch: ${pyStatus.datasetFile}`);
      }

      // Report deleted video with corrupted title first (including Unicode symbols to test stdout encoding)
      const pySync1 = await fetch(`http://127.0.0.1:${pyPort}/api/sync`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          browser: 'Microsoft Edge',
          windows: { '工作区 1': 1 },
          tabs: [],
          deletedVideos: [{
            id: 'BV1pyCross01',
            bvid: 'BV1pyCross01',
            title: '视频去哪了呢？',
            channel: '未知UP主',
            reason: '原视频已失效/被删除 (页面显示“视频去哪儿了？”)'
          }]
        })
      });
      if (!pySync1.ok) throw new Error(`Python server sync 1 failed with status ${pySync1.status}`);

      // Second browser supplies genuine title with special Unicode characters (🎯 / ゜)
      const pySync2 = await fetch(`http://127.0.0.1:${pyPort}/api/sync`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          browser: 'Google Chrome',
          windows: { 'Default': 1 },
          tabs: [{
            tabId: 10,
            windowId: 1,
            workspace: 'Default',
            bvid: 'BV1pyCross01',
            title: '🎯 Python跨端恢复测试视频 (゜-゜)つロ',
            channel: 'Python测试UP',
            url: 'https://www.bilibili.com/video/BV1pyCross01'
          }],
          deletedVideos: []
        })
      });
      if (!pySync2.ok) throw new Error(`Python server sync 2 failed with status ${pySync2.status}`);
      const pyData2 = await pySync2.json();
      const pyRepaired = pyData2.deletedVideos.find(v => v.bvid === 'BV1pyCross01');
      if (!pyRepaired || pyRepaired.title !== '🎯 Python跨端恢复测试视频 (゜-゜)つロ' || pyRepaired.channel !== 'Python测试UP') {
        throw new Error(`Python server failed to repair deleted video: ${JSON.stringify(pyRepaired)}`);
      }
      console.log('✅ Test 10 Passed: Python sync server enforces auth, handles Unicode under piped stdio, and retroactively repairs metadata.');
    } finally {
      pyProc.kill();
      await sleep(300);
      if (fs.existsSync(pyDatasetPath)) {
        try { fs.unlinkSync(pyDatasetPath); } catch (e) {}
      }
    }

    console.log('\n========================================');
    console.log('🎉 ALL MULTI-WORKSPACE TESTS PASSED! 🎉');
    console.log('========================================');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exitCode = 1;
  } finally {
    serverProcess.kill();
    await sleep(300);
    if (fs.existsSync(DATASET_PATH)) {
      try {
        fs.unlinkSync(DATASET_PATH);
      } catch (e) {}
    }
  }
}

runTests();
