/**
 * RcdRmd - Content Script
 * Runs on bilibili.com pages to extract video metadata and detect removal/deletion states.
 */

(function () {
  'use strict';

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

  // Helper to extract BVID from URL
  function extractBvid(url) {
    if (!url) return '';
    const match = url.match(/\/video\/(BV[0-9a-zA-Z]+)/i);
    return match ? match[1] : '';
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

  // Extract video title from DOM
  function extractTitle() {
    // 1. Video title element
    const titleEl = document.querySelector('h1.video-title') ||
                    document.querySelector('.video-info-title-inner') ||
                    document.querySelector('h1.title') ||
                    document.querySelector('.media-info-title') ||
                    document.querySelector('.season-title');
    if (titleEl) {
      const candidate = (titleEl.getAttribute('title') || titleEl.innerText || '').trim();
      if (isValidVideoTitle(candidate)) {
        return cleanTitle(candidate);
      }
    }

    // 2. Open Graph meta tag
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) {
      const candidate = cleanTitle(ogTitle.content);
      if (isValidVideoTitle(candidate)) {
        return candidate;
      }
    }

    // 3. Document title fallback (must NOT be an error or homepage title)
    if (document.title && !document.title.startsWith('哔哩哔哩') && !document.title.startsWith('bilibili')) {
      const candidate = cleanTitle(document.title);
      if (isValidVideoTitle(candidate)) {
        return candidate;
      }
    }

    return '';
  }

  // Extract channel (UP主) name from DOM
  function extractChannel() {
    // 1. Standard UP master name elements
    const channelEl = document.querySelector('.up-name') ||
                      document.querySelector('.up-detail-top .up-name') ||
                      document.querySelector('.username') ||
                      document.querySelector('.up-info--right .name .name-text') ||
                      document.querySelector('a.up-name') ||
                      document.querySelector('.member-info .name') ||
                      document.querySelector('.staff-name');
    if (channelEl) {
      const candidate = (channelEl.innerText || channelEl.getAttribute('title') || '').trim();
      if (candidate && candidate !== '未知UP主') {
        return candidate;
      }
    }

    // 2. Meta author tag
    const metaAuthor = document.querySelector('meta[name="author"]');
    if (metaAuthor && metaAuthor.content) {
      const candidate = metaAuthor.content.trim();
      if (candidate && candidate !== '未知UP主') {
        return candidate;
      }
    }

    return '';
  }

  // Check if page indicates the video was removed or deleted
  function checkIsDeletedOrRemoved() {
    // If a genuine video title is visible and video player exists, it is NOT deleted
    const titleCandidate = extractTitle();
    const hasPlayer = Boolean(
      document.querySelector('video') ||
      document.querySelector('.bpx-player-video-wrap') ||
      document.querySelector('#bilibili-player') ||
      document.querySelector('.bilibili-player-video')
    );
    if (isValidVideoTitle(titleCandidate) && hasPlayer) {
      return { isDeleted: false };
    }

    // 1. Check document.title
    if (document.title) {
      const dt = document.title.trim();
      if (isDeletedOrErrorText(dt)) {
        return { isDeleted: true, reason: '原视频已失效/被删除 (页面显示“视频去哪儿了？”)' };
      }
    }

    // 2. Check prominent error selectors
    const errorSelectors = [
      '.error-container',
      '.error-text',
      '.error-m',
      '.b-404-box',
      '.not-found',
      '.video-error',
      '.page-404',
      '.error-body',
      '.error-panel'
    ];

    for (const sel of errorSelectors) {
      const el = document.querySelector(sel);
      if (el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.offsetParent !== null)) {
        const text = (el.innerText || '').trim();
        if (isDeletedOrErrorText(text) || text.includes('视频去哪') || text.includes('不见了') || text.includes('404') || text.includes('出错了')) {
          return { isDeleted: true, reason: text ? text.slice(0, 60) : '原视频已失效/被删除 (页面显示“视频去哪儿了？”)' };
        }
      }
    }

    // 3. Fallback: only if NO player and NO valid title exists, check if body is error page
    if (!hasPlayer && !titleCandidate && document.body) {
      const bodyText = (document.body.innerText || '').slice(0, 1000);
      if (isDeletedOrErrorText(bodyText) ||
          bodyText.startsWith('视频去哪了呢') ||
          bodyText.startsWith('视频去哪儿了') ||
          bodyText.startsWith('啊叻？视频不见了')) {
        return { isDeleted: true, reason: '原视频已失效/被删除 (页面显示“视频去哪儿了？”)' };
      }
    }

    return { isDeleted: false };
  }

  // Safe context validity check to prevent "Extension context invalidated" errors upon extension reload
  let pollInterval = null;
  let observer = null;

  function isExtensionContextValid() {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
  }

  function cleanup() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function safeSendMessage(payload) {
    if (!isExtensionContextValid()) {
      cleanup();
      return;
    }
    try {
      chrome.runtime.sendMessage(payload).catch(() => {});
    } catch (err) {
      cleanup();
    }
  }

  // Main scanner
  function scanPage() {
    if (!isExtensionContextValid()) {
      cleanup();
      return;
    }

    const currentUrl = window.location.href;
    const bvid = extractBvid(currentUrl);

    // If on homepage or error page
    if (currentUrl === 'https://www.bilibili.com/' ||
        currentUrl.startsWith('https://www.bilibili.com/?') ||
        currentUrl.startsWith('https://www.bilibili.com/#') ||
        currentUrl.includes('/404')) {
      const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || null;
      const isRedirect = Boolean((nav && nav.redirectCount > 0) || (document.referrer && document.referrer.includes('/video/')));
      safeSendMessage({
        type: 'LANDING_PAGE_ACTIVE',
        url: currentUrl,
        isRedirect: isRedirect,
        referrer: document.referrer || ''
      });
      return;
    }

    // If on a video page
    if (bvid || currentUrl.includes('/video/') || currentUrl.includes('/bangumi/play/')) {
      const deletedCheck = checkIsDeletedOrRemoved();
      if (deletedCheck.isDeleted) {
        safeSendMessage({
          type: 'VIDEO_DELETED_DETECTED',
          data: {
            bvid: bvid,
            url: currentUrl,
            reason: deletedCheck.reason
          }
        });
        return;
      }

      const title = extractTitle();
      const channel = extractChannel();

      if (title || channel || bvid) {
        safeSendMessage({
          type: 'RECORD_TAB_METADATA',
          data: {
            bvid: bvid,
            url: currentUrl,
            title: title,
            channel: channel
          }
        });
      }
    }
  }

  // Scan immediately if extension context is valid
  if (isExtensionContextValid()) {
    scanPage();

    // Polling / retry scanning as SPA elements render
    let attempts = 0;
    pollInterval = setInterval(() => {
      attempts++;
      scanPage();
      if (attempts >= 8 || !isExtensionContextValid()) {
        cleanup();
      }
    }, 1000);

    // Observe DOM changes for SPA navigation
    observer = new MutationObserver(() => {
      scanPage();
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body && isExtensionContextValid() && observer) {
          observer.observe(document.body, { childList: true, subtree: true });
        }
      });
    }

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_PAGE_METADATA') {
        const bvid = extractBvid(window.location.href);
        const title = extractTitle();
        const channel = extractChannel();
        const deletedCheck = checkIsDeletedOrRemoved();
        sendResponse({
          bvid,
          title,
          channel,
          url: window.location.href,
          isDeleted: deletedCheck.isDeleted,
          reason: deletedCheck.reason
        });
      }
      return true;
    });
  }

})();
