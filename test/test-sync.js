/**
 * Automated Test Suite for RcdRmd
 * Verifies:
 * 1. Sync server startup and API endpoints
 * 2. Multi-browser and multi-window/workspace dataset generation (Edge "Mixed" & "Dev", Chrome, Canary)
 * 3. Accurate per-window and total tab counts
 * 4. Deleted video registration and cross-browser propagation
 * 5. Dataset persistence to rcdrmd-dataset.json
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_PATH = path.join(__dirname, '..', 'sync-server', 'rcdrmd-sync-server.js');
const DATASET_PATH = path.join(__dirname, '..', 'sync-server', 'rcdrmd-dataset.json');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('--- Starting RcdRmd Multi-Browser & Multi-Workspace Tests ---');

  // Clean previous test dataset if exists
  if (fs.existsSync(DATASET_PATH)) {
    fs.unlinkSync(DATASET_PATH);
  }

  // 1. Spawn sync server process
  const serverProcess = spawn('node', [SERVER_PATH], { stdio: 'inherit' });
  await sleep(1500);

  try {
    // 2. Test status endpoint
    console.log('\n[Test 1] Checking server status...');
    const statusRes = await fetch('http://127.0.0.1:32188/api/status');
    const statusData = await statusRes.json();
    console.log('Status response:', statusData);
    if (statusData.status !== 'online') throw new Error('Status not online');
    console.log('✅ Test 1 Passed: Server online on port 32188.');

    // 3. Simulate Microsoft Edge with 2 Workspaces: "Mixed" (152 tabs) and "Dev" (68 tabs)
    console.log('\n[Test 2] Simulating Edge syncing 2 workspaces: "Mixed" (152 tabs) and "Dev" (68 tabs)...');

    const edgeTabs = [];
    // 152 tabs in "Mixed"
    for (let i = 1; i <= 152; i++) {
      edgeTabs.push({
        tabId: 1000 + i,
        windowId: 1,
        workspace: 'Mixed',
        bvid: `BV1mix${i.toString().padStart(5, '0')}`,
        title: `【Mixed工作区】第 ${i} 个B站精彩视频`,
        channel: '综合UP主',
        url: `https://www.bilibili.com/video/BV1mix${i.toString().padStart(5, '0')}`
      });
    }

    // 68 tabs in "Dev"
    for (let i = 1; i <= 68; i++) {
      edgeTabs.push({
        tabId: 2000 + i,
        windowId: 2,
        workspace: 'Dev',
        bvid: `BV1dev${i.toString().padStart(5, '0')}`,
        title: `【Dev工作区】第 ${i} 个开发与数理模型视频`,
        channel: '极客UP主',
        url: `https://www.bilibili.com/video/BV1dev${i.toString().padStart(5, '0')}`
      });
    }

    const edgeSyncRes = await fetch('http://127.0.0.1:32188/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        browser: 'Microsoft Edge',
        windows: {
          'Mixed': 152,
          'Dev': 68
        },
        tabs: edgeTabs,
        deletedVideos: []
      })
    });
    const edgeData = await edgeSyncRes.json();
    console.log(`Edge synced. Total tabs in dataset: ${edgeData.allOpeningTabs.length}`);
    if (edgeData.allOpeningTabs.length !== 220) throw new Error(`Expected 220 tabs, got ${edgeData.allOpeningTabs.length}`);
    console.log('✅ Test 2 Passed: Microsoft Edge "Mixed" (152) and "Dev" (68) synced accurately (Total 220).');

    // 4. Simulate Google Chrome syncing 2 tabs
    console.log('\n[Test 3] Simulating Google Chrome tab sync...');
    const chromeSyncRes = await fetch('http://127.0.0.1:32188/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        browser: 'Google Chrome',
        windows: { 'Default': 2 },
        tabs: [
          { tabId: 301, windowId: 3, workspace: 'Default', bvid: 'BV1GJ411x7h7', title: '【罗翔】法考热点案例解读', channel: '罗翔说刑法', url: 'https://www.bilibili.com/video/BV1GJ411x7h7' },
          { tabId: 302, windowId: 3, workspace: 'Default', bvid: 'BV1b5411b7Nn', title: '【手工耿】自制全自动倒茶机', channel: '手工耿', url: 'https://www.bilibili.com/video/BV1b5411b7Nn' }
        ],
        deletedVideos: []
      })
    });
    const chromeData = await chromeSyncRes.json();
    console.log(`Chrome synced. Total tabs across all browsers: ${chromeData.allOpeningTabs.length}`);
    if (chromeData.allOpeningTabs.length !== 222) throw new Error('Expected 222 combined tabs');
    console.log('✅ Test 3 Passed: Chrome tabs merged correctly with Edge workspaces.');

    // 5. Simulate Edge detecting a deleted video in the Dev workspace
    console.log('\n[Test 4] Simulating Edge reporting deleted video in "Dev" workspace...');
    const edgeReportDeletedRes = await fetch('http://127.0.0.1:32188/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        browser: 'Microsoft Edge',
        windows: {
          'Mixed': 152,
          'Dev': 67
        },
        tabs: edgeTabs.slice(0, 219), // 1 tab deleted
        deletedVideos: [
          {
            id: 'BV1dev00068',
            bvid: 'BV1dev00068',
            title: '【Dev工作区】在数学模型的指导下，如何度过这一生！',
            channel: '数理之谜',
            browser: 'Microsoft Edge (Dev)',
            originalUrl: 'https://www.bilibili.com/video/BV1dev00068',
            deletedAt: new Date().toISOString(),
            reason: '已重定向至首页 (UP主删稿或被平台下架)',
            acknowledged: false
          }
        ]
      })
    });
    const edgeDeletedData = await edgeReportDeletedRes.json();
    if (edgeDeletedData.deletedVideos.length !== 1) throw new Error('Expected 1 deleted video');
    console.log('✅ Test 4 Passed: Deleted video from "Dev" workspace registered.');

    // 6. Simulate Google Chrome Canary syncing and receiving the deleted video
    console.log('\n[Test 5] Simulating Canary receiving the deleted video...');
    const canarySyncRes = await fetch('http://127.0.0.1:32188/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        browser: 'Google Chrome Canary',
        windows: { 'Default': 1 },
        tabs: [
          { tabId: 401, windowId: 4, workspace: 'Default', bvid: 'BV1Ab411c7XX', title: '【音乐】周杰伦经典吉他指弹', channel: '音乐工坊', url: 'https://www.bilibili.com/video/BV1Ab411c7XX' }
        ],
        deletedVideos: []
      })
    });
    const canaryData = await canarySyncRes.json();
    if (canaryData.deletedVideos.length !== 1) throw new Error('Canary failed to receive deleted video');
    if (canaryData.deletedVideos[0].title !== '【Dev工作区】在数学模型的指导下，如何度过这一生！') throw new Error('Title mismatch');
    if (canaryData.deletedVideos[0].browser !== 'Microsoft Edge (Dev)') throw new Error('Browser/workspace source mismatch');
    console.log('✅ Test 5 Passed: Canary received deleted record with source "Microsoft Edge (Dev)".');

    // 7. Verify persistent JSON dataset file
    console.log('\n[Test 6] Verifying local dataset file persistence...');
    if (!fs.existsSync(DATASET_PATH)) throw new Error('Dataset file does not exist on disk');
    const diskDataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
    console.log('Edge windows in dataset:', diskDataset.browsers['Microsoft Edge'].windows);
    if (diskDataset.browsers['Microsoft Edge'].windows['Mixed'] !== 152) throw new Error('Mixed count mismatch');
    if (diskDataset.browsers['Microsoft Edge'].windows['Dev'] !== 67) throw new Error('Dev count mismatch');
    console.log('✅ Test 6 Passed: rcdrmd-dataset.json stores exact workspace counts (Mixed: 152, Dev: 67).');

    console.log('\n========================================');
    console.log('🎉 ALL MULTI-WORKSPACE TESTS PASSED! 🎉');
    console.log('========================================');
  } catch (err) {
    console.error('❌ Test failed:', err);
  } finally {
    serverProcess.kill();
  }
}

runTests();
