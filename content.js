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

  // Extract video title from DOM
  function extractTitle() {
    // 1. Video title element
    const titleEl = document.querySelector('h1.video-title') ||
                    document.querySelector('.video-info-title-inner') ||
                    document.querySelector('.media-info-title') ||
                    document.querySelector('.season-title');
    if (titleEl && titleEl.innerText && titleEl.innerText.trim()) {
      return titleEl.innerText.trim();
    }

    // 2. Open Graph meta tag
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) {
      return cleanTitle(ogTitle.content);
    }

    // 3. Document title fallback
    if (document.title && !document.title.startsWith('哔哩哔哩') && !document.title.startsWith('bilibili')) {
      return cleanTitle(document.title);
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
                      document.querySelector('.member-info .name');
    if (channelEl && channelEl.innerText && channelEl.innerText.trim()) {
      return channelEl.innerText.trim();
    }

    // 2. Meta author tag
    const metaAuthor = document.querySelector('meta[name="author"]');
    if (metaAuthor && metaAuthor.content) {
      return metaAuthor.content.trim();
    }

    return '';
  }

  // Check if page indicates the video was removed or deleted
  function checkIsDeletedOrRemoved() {
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
        return { isDeleted: true, reason: text ? text.slice(0, 60) : '页面显示视频失效或错误提示' };
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
