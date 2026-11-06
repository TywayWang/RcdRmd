/**
 * RcdRmd - Popup Script (Multi-Window & Workspace Aware)
 * Renders deleted videos list, active tabs across Edge workspaces / windows, and sync status.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // State
  let appState = {
    currentBrowser: 'Microsoft Edge',
    currentWindowId: null,
    currentWorkspaceName: '默认工作区',
    allWindows: [],
    windowNames: {},
    trackedTabs: {},
    deletedVideos: [],
    crossBrowserTabs: [],
    syncServerStatus: 'offline',
    lastSyncTime: null,
    syncServerUrl: 'http://127.0.0.1:32188',
    customBrowserName: '',
    selectedWorkspaceFilter: 'current' // 'current', 'all', or specific windowId/workspace
  };

  // DOM Elements
  const currentBrowserBadge = document.getElementById('currentBrowserBadge');
  const currentWorkspacePill = document.getElementById('currentWorkspacePill');
  const currentWorkspaceName = document.getElementById('currentWorkspaceName');
  const currentWorkspaceCount = document.getElementById('currentWorkspaceCount');
  const renameWorkspaceBtn = document.getElementById('renameWorkspaceBtn');

  const brandIcon = document.getElementById('brandIcon');
  const quickSyncBtn = document.getElementById('quickSyncBtn');
  const deletedBadge = document.getElementById('deletedBadge');
  const tabsBadge = document.getElementById('tabsBadge');
  const syncStatusDot = document.getElementById('syncStatusDot');

  const yellowAlertBanner = document.getElementById('yellowAlertBanner');
  const ackAlertBtn = document.getElementById('ackAlertBtn');
  const deletedSearchInput = document.getElementById('deletedSearchInput');
  const exportBtn = document.getElementById('exportBtn');
  const clearAllDeletedBtn = document.getElementById('clearAllDeletedBtn');
  const deletedListContainer = document.getElementById('deletedListContainer');
  const deletedEmptyState = document.getElementById('deletedEmptyState');

  const workspaceChipsContainer = document.getElementById('workspaceChipsContainer');
  const activeTabsSearchInput = document.getElementById('activeTabsSearchInput');
  const tabsSummaryChip = document.getElementById('tabsSummaryChip');
  const activeTabsListContainer = document.getElementById('activeTabsListContainer');
  const tabsEmptyState = document.getElementById('tabsEmptyState');

  const workspaceSummaryList = document.getElementById('workspaceSummaryList');
  const syncServiceStatusPill = document.getElementById('syncServiceStatusPill');
  const syncServerUrlText = document.getElementById('syncServerUrlText');
  const lastSyncTimeText = document.getElementById('lastSyncTimeText');
  const manualSyncBtn = document.getElementById('manualSyncBtn');
  const browserIdentitySelect = document.getElementById('browserIdentitySelect');
  const saveBrowserNameBtn = document.getElementById('saveBrowserNameBtn');
  const footerStatusText = document.getElementById('footerStatusText');

  // Format timestamps
  function formatTime(isoString) {
    if (!isoString) return '刚刚';
    try {
      const d = new Date(isoString);
      const now = new Date();
      const diffMs = now - d;
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return '刚刚';
      if (diffMins < 60) return `${diffMins} 分钟前`;
      const hours = Math.floor(diffMins / 60);
      if (hours < 24) return `${hours} 小时前`;
      return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch (e) {
      return isoString;
    }
  }

  function isBiliUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      return u.hostname.endsWith('bilibili.com');
    } catch (e) {
      return false;
    }
  }

  // Load state from background service worker and browser window API
  async function loadState() {
    try {
      // 1. Identify current window and all windows directly from Chrome/Edge API
      const [currentWin, allWins] = await Promise.all([
        chrome.windows.getCurrent({ populate: true }),
        chrome.windows.getAll({ populate: true })
      ]);

      appState.currentWindowId = currentWin.id;
      appState.allWindows = allWins;

      // 2. Fetch persistent state from background service worker
      const bgState = await chrome.runtime.sendMessage({ type: 'GET_ALL_STATE' });
      if (bgState) {
        appState = {
          ...appState,
          ...bgState
        };
      }

      // 3. Resolve Workspace Names for all windows
      const windowNames = appState.windowNames || {};
      allWins.forEach(win => {
        if (!windowNames[win.id]) {
          windowNames[win.id] = `工作区 ${win.id}`;
        }
      });
      appState.windowNames = windowNames;
      appState.currentWorkspaceName = windowNames[currentWin.id] || `工作区 ${currentWin.id}`;

      // 4. Retroactive title repair for UI state
      if (Array.isArray(appState.deletedVideos)) {
        let changed = false;
        for (const v of appState.deletedVideos) {
          if (!isValidVideoTitle(v.title)) {
            if (v.bvid && appState.videoHistory && isValidVideoTitle(appState.videoHistory[v.bvid]?.title)) {
              v.title = appState.videoHistory[v.bvid].title;
              changed = true;
            }
            if (!isValidVideoTitle(v.title) && v.bvid && appState.trackedTabs) {
              const f = Object.values(appState.trackedTabs).find(t => t.bvid === v.bvid && isValidVideoTitle(t.title));
              if (f) {
                v.title = f.title;
                changed = true;
              }
            }
            if (!isValidVideoTitle(v.title) && v.bvid && Array.isArray(appState.crossBrowserTabs)) {
              const fc = appState.crossBrowserTabs.find(t => t.bvid === v.bvid && isValidVideoTitle(t.title));
              if (fc) {
                v.title = cleanTitle(fc.title);
                changed = true;
              }
            }
            if (!isValidVideoTitle(v.title) && typeof chrome !== 'undefined' && chrome.history && chrome.history.search && v.bvid) {
              try {
                const histItems = await chrome.history.search({ text: v.bvid, maxResults: 10 });
                for (const h of (histItems || [])) {
                  if (h.url && h.url.includes(v.bvid)) {
                    const ct = cleanTitle(h.title);
                    if (isValidVideoTitle(ct)) {
                      v.title = ct;
                      changed = true;
                      break;
                    }
                  }
                }
              } catch (e) {}
            }
          }
          if ((!v.channel || v.channel === '未知UP主') && v.bvid && appState.videoHistory?.[v.bvid]?.channel) {
            v.channel = appState.videoHistory[v.bvid].channel;
            changed = true;
          }
        }
        if (changed) {
          await chrome.storage.local.set({ deletedVideos: appState.deletedVideos });
        }
      }

      renderAll();
    } catch (err) {
      console.error('[RcdRmd] Error loading state:', err);
    }
  }

  // Render everything
  function renderAll() {
    // Current Browser Badge
    currentBrowserBadge.textContent = appState.currentBrowser || 'Microsoft Edge';
    if (appState.customBrowserName) {
      browserIdentitySelect.value = appState.customBrowserName;
    } else {
      browserIdentitySelect.value = 'auto';
    }

    // Current Window & Workspace
    const currentWin = appState.allWindows.find(w => w.id === appState.currentWindowId);
    const currentWinBiliTabs = currentWin ? (currentWin.tabs || []).filter(t => isBiliUrl(t.url)) : [];
    const totalLocalBiliTabs = appState.allWindows.reduce((acc, w) => acc + (w.tabs || []).filter(t => isBiliUrl(t.url)).length, 0);

    currentWorkspaceName.textContent = appState.currentWorkspaceName;
    currentWorkspaceCount.textContent = `(${currentWinBiliTabs.length})`;

    // Nav Badge for Active Tabs: show current window's Bilibili tab count
    tabsBadge.textContent = currentWinBiliTabs.length;
    tabsBadge.title = `当前工作区 (${appState.currentWorkspaceName}): ${currentWinBiliTabs.length} 标签 | 所有工作区: ${totalLocalBiliTabs} 标签`;

    // Deleted Videos Badge & Alert Icon
    const deletedList = appState.deletedVideos || [];
    const unackCount = deletedList.filter(v => !v.acknowledged).length;

    deletedBadge.textContent = deletedList.length;

    if (unackCount > 0) {
      brandIcon.src = '../icons/icon-yellow-32.png';
      yellowAlertBanner.classList.remove('hidden');
      deletedBadge.classList.add('badge-alert');
    } else {
      brandIcon.src = '../icons/icon-32.png';
      yellowAlertBanner.classList.add('hidden');
      deletedBadge.classList.remove('badge-alert');
    }

    // Sync status dot & text
    if (appState.syncServerStatus === 'connected') {
      syncStatusDot.className = 'status-dot online';
      syncStatusDot.title = '跨浏览器同步中心: 已连接';
      syncServiceStatusPill.className = 'status-pill online';
      syncServiceStatusPill.textContent = '已连接 (跨浏览器实时同步)';
      footerStatusText.textContent = `跨浏览器已联通 · 每30分钟同步`;
    } else {
      syncStatusDot.className = 'status-dot offline';
      syncStatusDot.title = '独立本地模式 (同步服务未开启)';
      syncServiceStatusPill.className = 'status-pill offline';
      syncServiceStatusPill.textContent = '本地单机模式 (未连接同步服务)';
      footerStatusText.textContent = `本地独立运行 · 多工作区准确记录`;
    }

    syncServerUrlText.textContent = appState.syncServerUrl || 'http://127.0.0.1:32188';
    lastSyncTimeText.textContent = appState.lastSyncTime ? formatTime(appState.lastSyncTime) : '尚未同步';

    // Render lists
    renderDeletedVideos();
    renderWorkspaceChips();
    renderActiveTabs();
    renderWorkspaceSummaryList();
  }

  // Render Workspace Chips in View 2
  function renderWorkspaceChips() {
    workspaceChipsContainer.innerHTML = '';

    const currentWin = appState.allWindows.find(w => w.id === appState.currentWindowId);
    const currentWinBiliCount = currentWin ? (currentWin.tabs || []).filter(t => isBiliUrl(t.url)).length : 0;
    const totalLocalBiliCount = appState.allWindows.reduce((acc, w) => acc + (w.tabs || []).filter(t => isBiliUrl(t.url)).length, 0);

    // Chip 1: Current Workspace
    const currentChip = document.createElement('button');
    currentChip.className = `ws-chip ${appState.selectedWorkspaceFilter === 'current' ? 'active' : ''}`;
    currentChip.innerHTML = `📍 当前: ${escapeHtml(appState.currentWorkspaceName)} <span class="chip-count">${currentWinBiliCount}</span>`;
    currentChip.addEventListener('click', () => {
      appState.selectedWorkspaceFilter = 'current';
      renderWorkspaceChips();
      renderActiveTabs();
    });
    workspaceChipsContainer.appendChild(currentChip);

    // Chip 2: All Local Workspaces
    const allChip = document.createElement('button');
    allChip.className = `ws-chip ${appState.selectedWorkspaceFilter === 'all' ? 'active' : ''}`;
    allChip.innerHTML = `🪟 全部工作区 <span class="chip-count">${totalLocalBiliCount}</span>`;
    allChip.addEventListener('click', () => {
      appState.selectedWorkspaceFilter = 'all';
      renderWorkspaceChips();
      renderActiveTabs();
    });
    workspaceChipsContainer.appendChild(allChip);

    // Individual Window Chips
    appState.allWindows.forEach(win => {
      const name = appState.windowNames[win.id] || `工作区 ${win.id}`;
      const count = (win.tabs || []).filter(t => isBiliUrl(t.url)).length;
      const winChip = document.createElement('button');
      const isSelected = appState.selectedWorkspaceFilter === String(win.id);
      winChip.className = `ws-chip ${isSelected ? 'active' : ''}`;
      winChip.innerHTML = `📂 ${escapeHtml(name)} <span class="chip-count">${count}</span>`;
      winChip.addEventListener('click', () => {
        appState.selectedWorkspaceFilter = String(win.id);
        renderWorkspaceChips();
        renderActiveTabs();
      });
      workspaceChipsContainer.appendChild(winChip);
    });

    // Remote Browser Tabs Chip (if available from sync hub)
    const remoteCount = (appState.crossBrowserTabs || []).length;
    if (remoteCount > 0) {
      const remoteChip = document.createElement('button');
      const isSelected = appState.selectedWorkspaceFilter === 'remote';
      remoteChip.className = `ws-chip ${isSelected ? 'active' : ''}`;
      remoteChip.innerHTML = `🌐 远端浏览器 <span class="chip-count">${remoteCount}</span>`;
      remoteChip.addEventListener('click', () => {
        appState.selectedWorkspaceFilter = 'remote';
        renderWorkspaceChips();
        renderActiveTabs();
      });
      workspaceChipsContainer.appendChild(remoteChip);
    }
  }

  // Render Active Opening Tabs
  function renderActiveTabs() {
    const searchTerm = (activeTabsSearchInput.value || '').trim().toLowerCase();
    activeTabsListContainer.innerHTML = '';

    // Collect all local Bilibili tabs from actual windows
    const localTabsGrouped = []; // Array of { windowId, workspaceName, tabs: [...] }

    appState.allWindows.forEach(win => {
      const wsName = appState.windowNames[win.id] || `工作区 ${win.id}`;
      const winBiliTabs = (win.tabs || [])
        .filter(t => isBiliUrl(t.url))
        .map(t => {
          const tracked = appState.trackedTabs[t.id] || {};
          return {
            tabId: t.id,
            windowId: win.id,
            workspaceName: wsName,
            isCurrentWindow: win.id === appState.currentWindowId,
            url: t.url,
            title: tracked.title || cleanTitle(t.title) || 'B站标签页',
            channel: tracked.channel || '',
            browser: appState.currentBrowser
          };
        });

      if (winBiliTabs.length > 0) {
        localTabsGrouped.push({
          windowId: win.id,
          workspaceName: wsName,
          isCurrentWindow: win.id === appState.currentWindowId,
          tabs: winBiliTabs
        });
      }
    });

    // Filter by selected workspace
    let groupsToDisplay = [];
    if (appState.selectedWorkspaceFilter === 'current') {
      groupsToDisplay = localTabsGrouped.filter(g => g.isCurrentWindow);
    } else if (appState.selectedWorkspaceFilter === 'all') {
      groupsToDisplay = localTabsGrouped;
    } else if (appState.selectedWorkspaceFilter === 'remote') {
      groupsToDisplay = [{
        windowId: 'remote',
        workspaceName: '其他浏览器 (Chrome / Canary)',
        tabs: appState.crossBrowserTabs || []
      }];
    } else {
      // Specific windowId
      groupsToDisplay = localTabsGrouped.filter(g => String(g.windowId) === appState.selectedWorkspaceFilter);
    }

    let totalDisplayed = 0;

    groupsToDisplay.forEach(group => {
      // Filter tabs by search keyword
      const matchedTabs = group.tabs.filter(tab => {
        if (!searchTerm) return true;
        const title = (tab.title || '').toLowerCase();
        const channel = (tab.channel || '').toLowerCase();
        const url = (tab.url || '').toLowerCase();
        return title.includes(searchTerm) || channel.includes(searchTerm) || url.includes(searchTerm);
      });

      if (matchedTabs.length === 0) return;
      totalDisplayed += matchedTabs.length;

      // Render Section Header if displaying all workspaces or multiple groups
      if (groupsToDisplay.length > 1 || appState.selectedWorkspaceFilter === 'all') {
        const header = document.createElement('div');
        header.className = 'workspace-section-header';
        header.innerHTML = `
          <div class="ws-header-title">
            <span>📁 工作区: <strong>${escapeHtml(group.workspaceName)}</strong></span>
            ${group.isCurrentWindow ? '<span class="meta-browser-tag" style="background:#00A1D6;color:#fff;">当前窗口</span>' : ''}
          </div>
          <span class="ws-header-count">${matchedTabs.length} 标签</span>
        `;
        activeTabsListContainer.appendChild(header);
      }

      // Render each tab card
      matchedTabs.forEach(tab => {
        const card = document.createElement('div');
        card.className = 'tab-item-card';

        const title = document.createElement('div');
        title.className = 'video-title';
        title.textContent = tab.title || '（B站视频）';
        card.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'video-meta';

        const channel = document.createElement('span');
        channel.className = 'meta-channel';
        channel.textContent = tab.channel ? `👤 UP主: ${tab.channel}` : 'UP主未知';
        meta.appendChild(channel);

        const wsTag = document.createElement('span');
        wsTag.className = 'meta-workspace-tag';
        wsTag.textContent = `工作区: ${tab.workspaceName || group.workspaceName}`;
        meta.appendChild(wsTag);

        card.appendChild(meta);

        const bottom = document.createElement('div');
        bottom.className = 'card-bottom';

        const openLink = document.createElement('a');
        openLink.className = 'action-link';
        openLink.innerHTML = `🔗 转到标签页`;
        openLink.addEventListener('click', () => {
          if (tab.tabId) {
            chrome.tabs.update(tab.tabId, { active: true });
            if (tab.windowId) {
              chrome.windows.update(tab.windowId, { focused: true });
            }
          } else if (tab.url) {
            chrome.tabs.create({ url: tab.url });
          }
        });
        bottom.appendChild(openLink);

        card.appendChild(bottom);
        activeTabsListContainer.appendChild(card);
      });
    });

    tabsSummaryChip.textContent = `共 ${totalDisplayed} 标签`;

    if (totalDisplayed === 0) {
      tabsEmptyState.classList.remove('hidden');
    } else {
      tabsEmptyState.classList.add('hidden');
    }
  }

  // Render Deleted Videos
  function renderDeletedVideos() {
    const searchTerm = (deletedSearchInput.value || '').trim().toLowerCase();
    const rawList = appState.deletedVideos || [];

    const filtered = rawList.filter(item => {
      if (!searchTerm) return true;
      const title = (item.title || '').toLowerCase();
      const channel = (item.channel || '').toLowerCase();
      const browser = (item.browser || '').toLowerCase();
      const bvid = (item.bvid || '').toLowerCase();
      return title.includes(searchTerm) || channel.includes(searchTerm) || browser.includes(searchTerm) || bvid.includes(searchTerm);
    });

    deletedListContainer.innerHTML = '';

    if (filtered.length === 0) {
      deletedEmptyState.classList.remove('hidden');
      return;
    }

    deletedEmptyState.classList.add('hidden');

    filtered.forEach(video => {
      const card = document.createElement('div');
      card.className = `video-card ${!video.acknowledged ? 'unacknowledged' : ''}`;

      let titleText = video.title || '';
      if (!isValidVideoTitle(titleText)) {
        if (video.bvid && appState.videoHistory && isValidVideoTitle(appState.videoHistory[video.bvid]?.title)) {
          titleText = appState.videoHistory[video.bvid].title;
        } else {
          titleText = '（原视频标题未获取）';
        }
      }
      const channelText = (video.channel && video.channel !== '未知UP主')
        ? `UP主: ${video.channel}`
        : (video.bvid && appState.videoHistory && appState.videoHistory[video.bvid]?.channel)
          ? `UP主: ${appState.videoHistory[video.bvid].channel}`
          : 'UP主未知';
      const browserTag = video.browser || '未知浏览器';
      const timeStr = formatTime(video.deletedAt);
      const bvid = video.bvid || '';
      const originalUrl = video.originalUrl || (bvid ? `https://www.bilibili.com/video/${bvid}` : '');
      const reasonText = video.reason || 'UP主删稿或重定向至首页';

      const cardTop = document.createElement('div');
      cardTop.className = 'card-top';

      const titleEl = document.createElement('div');
      titleEl.className = 'video-title';
      titleEl.textContent = titleText;
      cardTop.appendChild(titleEl);
      card.appendChild(cardTop);

      const metaEl = document.createElement('div');
      metaEl.className = 'video-meta';

      const channelEl = document.createElement('span');
      channelEl.className = 'meta-channel';
      channelEl.innerHTML = `👤 <span>${escapeHtml(channelText)}</span>`;
      metaEl.appendChild(channelEl);

      const browserEl = document.createElement('span');
      browserEl.className = 'meta-browser-tag';
      browserEl.textContent = browserTag;
      metaEl.appendChild(browserEl);

      const timeEl = document.createElement('span');
      timeEl.className = 'meta-time';
      timeEl.textContent = `检测时间: ${timeStr}`;
      metaEl.appendChild(timeEl);

      card.appendChild(metaEl);

      const reasonEl = document.createElement('div');
      reasonEl.className = 'card-reason';
      reasonEl.textContent = `⚠️ 失效原因: ${reasonText}`;
      card.appendChild(reasonEl);

      const cardBottom = document.createElement('div');
      cardBottom.className = 'card-bottom';

      const actionsLeft = document.createElement('div');
      actionsLeft.className = 'card-actions-left';

      const copyLink = document.createElement('a');
      copyLink.className = 'action-link';
      copyLink.innerHTML = `📋 复制信息`;
      copyLink.addEventListener('click', () => {
        const textToCopy = `【已失效B站视频】\n标题: ${titleText}\n${channelText}\n来源浏览器: ${browserTag}\n原链接: ${originalUrl}`;
        navigator.clipboard.writeText(textToCopy).then(() => {
          copyLink.textContent = '✅ 已复制!';
          setTimeout(() => { copyLink.innerHTML = '📋 复制信息'; }, 1500);
        });
      });
      actionsLeft.appendChild(copyLink);

      const searchBiliLink = document.createElement('a');
      searchBiliLink.className = 'action-link';
      searchBiliLink.innerHTML = `🔍 B站搜索补档`;
      searchBiliLink.addEventListener('click', () => {
        let query = '';
        if (isValidVideoTitle(video.title)) {
          query = video.title;
        } else if (isValidVideoTitle(titleText)) {
          query = titleText;
        } else if (video.bvid) {
          query = video.bvid;
        } else if (video.channel && video.channel !== '未知UP主') {
          query = video.channel;
        }
        chrome.tabs.create({ url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}` });
      });
      actionsLeft.appendChild(searchBiliLink);

      if (originalUrl) {
        const archiveLink = document.createElement('a');
        archiveLink.className = 'action-link';
        archiveLink.innerHTML = `🌐 网页快照`;
        archiveLink.addEventListener('click', () => {
          chrome.tabs.create({ url: `https://web.archive.org/web/*/${encodeURI(originalUrl)}` });
        });
        actionsLeft.appendChild(archiveLink);
      }

      cardBottom.appendChild(actionsLeft);

      const deleteLink = document.createElement('a');
      deleteLink.className = 'action-link delete-link';
      deleteLink.textContent = '✕ 移除记录';
      deleteLink.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({
          type: 'REMOVE_DELETED_ITEM',
          id: video.id || video.bvid
        });
        await loadState();
      });
      cardBottom.appendChild(deleteLink);

      card.appendChild(cardBottom);
      deletedListContainer.appendChild(card);
    });
  }

  // Render Workspace Summary in Settings View
  function renderWorkspaceSummaryList() {
    workspaceSummaryList.innerHTML = '';
    appState.allWindows.forEach(win => {
      const wsName = appState.windowNames[win.id] || `工作区 ${win.id}`;
      const count = (win.tabs || []).filter(t => isBiliUrl(t.url)).length;
      const isCurrent = win.id === appState.currentWindowId;

      const row = document.createElement('div');
      row.className = 'ws-summary-row';
      row.innerHTML = `
        <div class="ws-summary-name">
          <span>${isCurrent ? '📍' : '📂'}</span>
          <span>${escapeHtml(wsName)}</span>
          ${isCurrent ? '<span class="browser-badge" style="font-size:10px;padding:1px 5px;">当前窗口</span>' : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="ws-summary-count">${count} 个B站标签</span>
          <button class="btn btn-outline btn-xs rename-win-btn" data-winid="${win.id}" data-name="${escapeHtml(wsName)}">重命名</button>
        </div>
      `;
      workspaceSummaryList.appendChild(row);
    });

    document.querySelectorAll('.rename-win-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const winId = parseInt(btn.dataset.winid, 10);
        const oldName = btn.dataset.name;
        const newName = prompt(`请输入工作区/窗口名称：`, oldName);
        if (newName && newName.trim()) {
          await chrome.runtime.sendMessage({
            type: 'SET_WORKSPACE_NAME',
            windowId: winId,
            name: newName.trim()
          });
          await loadState();
        }
      });
    });
  }

  // Helper to clean Bilibili document titles
  function cleanTitle(text) {
    if (!text) return '';
    return text
      .replace(/_哔哩哔哩_bilibili.*/i, '')
      .replace(/_哔哩哔哩.*/i, '')
      .replace(/ - 哔哩哔哩.*/i, '')
      .replace(/ - bilibili.*/i, '')
      .trim();
  }

  // Error title patterns representing Bilibili video deletion / removal pages
  const ERROR_TITLE_PATTERNS = [
    /^视频去哪[了儿呢\?？\s]*$/i,
    /^啊叻[？\?]?\s*视频不见了.*/i,
    /^(404(\s*not\s*found)?|404|bilibili-404|404-bilibili|出错了(\s*-\s*bilibili\.com)?)$/i,
    /^(稿件不可见|该稿件已被下架|稿件已被UP主删除|抱歉[，,].*已被删除|非常抱歉.*|该内容已不存在)$/i,
    /^(原视频已失效|视频已失效|该视频已失效|已失效|视频不存在|原视频不存在|视频不见了)$/i,
    /^(已删除的B站视频|Unknown Video Title|（原视频标题未获取）|原视频标题未获取|（未获取到标题）|未获取到标题)$/i,
    /^(B站视频|B站页面|B站标签页|B站首页)$/i
  ];

  // Check if text indicates a removed/deleted video or error state
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

  // Validate that an extracted title is a genuine video title
  function isValidVideoTitle(title) {
    if (!title) return false;
    const t = cleanTitle(title);
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

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Rename current workspace dialog
  async function promptRenameCurrentWorkspace() {
    const newName = prompt(`请输入当前工作区名称（如 工作区 1、学习、娱乐 等）：`, appState.currentWorkspaceName);
    if (newName && newName.trim()) {
      await chrome.runtime.sendMessage({
        type: 'SET_WORKSPACE_NAME',
        windowId: appState.currentWindowId,
        name: newName.trim()
      });
      await loadState();
    }
  }

  currentWorkspacePill.addEventListener('click', promptRenameCurrentWorkspace);
  renameWorkspaceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    promptRenameCurrentWorkspace();
  });

  // Navigation Tab Switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));

      btn.classList.add('active');
      const targetId = `view-${btn.dataset.tab}`;
      const targetView = document.getElementById(targetId);
      if (targetView) targetView.classList.add('active');
    });
  });

  // Acknowledge Yellow Alert Notification
  ackAlertBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'ACKNOWLEDGE_DELETED' });
    await loadState();
  });

  // Search filter
  deletedSearchInput.addEventListener('input', renderDeletedVideos);
  activeTabsSearchInput.addEventListener('input', renderActiveTabs);

  // Trigger Sync
  async function performSync() {
    quickSyncBtn.classList.add('spinning');
    manualSyncBtn.disabled = true;
    manualSyncBtn.textContent = '正在同步中...';

    try {
      await chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC_NOW' });
      await loadState();
    } catch (err) {
      console.error('[RcdRmd] Manual sync error:', err);
    } finally {
      quickSyncBtn.classList.remove('spinning');
      manualSyncBtn.disabled = false;
      manualSyncBtn.textContent = '立即执行跨浏览器同步';
    }
  }

  quickSyncBtn.addEventListener('click', performSync);
  manualSyncBtn.addEventListener('click', performSync);

  // Clear All Deleted History
  clearAllDeletedBtn.addEventListener('click', async () => {
    if (confirm('确定要清空所有已失效视频记录吗？')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_DELETED_RECORDS' });
      await loadState();
    }
  });

  // Save Browser Name Setting
  saveBrowserNameBtn.addEventListener('click', async () => {
    const selected = browserIdentitySelect.value;
    const nameToSave = selected === 'auto' ? '' : selected;
    await chrome.runtime.sendMessage({ type: 'SET_BROWSER_NAME', name: nameToSave });
    saveBrowserNameBtn.textContent = '已保存';
    setTimeout(() => { saveBrowserNameBtn.textContent = '保存'; }, 1500);
    await loadState();
  });

  // Export Data (JSON / CSV)
  exportBtn.addEventListener('click', () => {
    const list = appState.deletedVideos || [];
    if (list.length === 0) {
      alert('暂无已失效视频记录可导出');
      return;
    }

    const format = confirm('点击“确定”导出为 JSON 格式；点击“取消”导出为 CSV (Excel) 格式。');

    if (format) {
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rcdrmd-deleted-videos-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const headers = ['BVID', '视频标题', 'UP主频道', '来源浏览器/工作区', '检测时间', '失效原因', '原始链接'];
      const rows = list.map(item => [
        `"${(item.bvid || '').replace(/"/g, '""')}"`,
        `"${(item.title || '').replace(/"/g, '""')}"`,
        `"${(item.channel || '').replace(/"/g, '""')}"`,
        `"${(item.browser || '').replace(/"/g, '""')}"`,
        `"${(item.deletedAt || '').replace(/"/g, '""')}"`,
        `"${(item.reason || '').replace(/"/g, '""')}"`,
        `"${(item.originalUrl || '').replace(/"/g, '""')}"`
      ]);

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rcdrmd-deleted-videos-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });

  // Initial load
  await loadState();
});
