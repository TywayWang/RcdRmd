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
      '.error-body'
    ];

    for (const sel of errorSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) { // visible
        return { isDeleted: true, reason: 'Error container detected on page' };
      }
    }

    // Check key phrases in body
    const bodyText = document.body ? document.body.innerText : '';
    if (bodyText) {
      const deletedPhrases = [
        '视频不见了哦',
        '稿件已被删除',
        '已被UP主删除',
        '非常抱歉，视频不存在或已被删除',
        '啊咧？视频不见了',
        '你感兴趣的视频不见了',
        '该视频已被删除',
        '视频已失效'
      ];
      for (const phrase of deletedPhrases) {
        if (bodyText.includes(phrase)) {
          return { isDeleted: true, reason: phrase };
        }
      }
    }

    return { isDeleted: false };
  }

  // Main scanner
  function scanPage() {
    const currentUrl = window.location.href;
    const bvid = extractBvid(currentUrl);

    // If on homepage or error page
    if (currentUrl === 'https://www.bilibili.com/' ||
        currentUrl.startsWith('https://www.bilibili.com/?') ||
        currentUrl.includes('/404')) {
      chrome.runtime.sendMessage({
        type: 'LANDING_PAGE_ACTIVE',
        url: currentUrl
      }).catch(() => {});
      return;
    }

    // If on a video page
    if (bvid || currentUrl.includes('/video/') || currentUrl.includes('/bangumi/play/')) {
      const deletedCheck = checkIsDeletedOrRemoved();
      if (deletedCheck.isDeleted) {
        chrome.runtime.sendMessage({
          type: 'VIDEO_DELETED_DETECTED',
          data: {
            bvid: bvid,
            url: currentUrl,
            reason: deletedCheck.reason
          }
        }).catch(() => {});
        return;
      }

      const title = extractTitle();
      const channel = extractChannel();

      if (title || channel || bvid) {
        chrome.runtime.sendMessage({
          type: 'RECORD_TAB_METADATA',
          data: {
            bvid: bvid,
            url: currentUrl,
            title: title,
            channel: channel
          }
        }).catch(() => {});
      }
    }
  }

  // Scan immediately
  scanPage();

  // Polling / retry scanning as SPA elements render
  let attempts = 0;
  const pollInterval = setInterval(() => {
    attempts++;
    scanPage();
    if (attempts >= 8) {
      clearInterval(pollInterval);
    }
  }, 1000);

  // Observe DOM changes for SPA navigation
  const observer = new MutationObserver(() => {
    scanPage();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
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

})();
