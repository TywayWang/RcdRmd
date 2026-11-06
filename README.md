<div align="center">

# RcdRmd (Record & Remind)

<img src="icons/icon-128.png" width="96" height="96" alt="RcdRmd Logo" />

**Bilibili Deleted Video Tracker & Multi-Workspace Remind Extension**  
*Record lost Bilibili video titles and channels before they vanish upon homepage redirect or removal.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Browsers](https://img.shields.io/badge/Browsers-Edge%20%7C%20Chrome%20%7C%20Canary-informational.svg)](https://github.com/TywayWang/RcdRmd)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/TywayWang/RcdRmd)

[English](#english) | [中文说明](#中文说明)

</div>

---

<a name="english"></a>
## 📖 Overview

If you frequently open tens or hundreds of Bilibili (`https://www.bilibili.com/`) tabs to watch later, you may have experienced this frustrating situation:
> **An uploader deletes or hides a video, or the video gets removed. When the tab restores or reloads, Bilibili either redirects the tab to the homepage (`https://www.bilibili.com/`) or replaces the page with an error screen (`"视频去哪儿了？"` / `"视频去哪了呢？"`), wiping out the video's original title and channel information.**

**RcdRmd** solves this problem by maintaining a local dataset of all open Bilibili tabs, cross-checking adjacent 30-minute snapshots for deletions and redirects, recovering original titles across multiple local stores (including browser history fallback), synchronizing across workspaces and browsers, and alerting you with a yellow notification symbol.

### ✨ Key Features

1. **Automatic Metadata Ingestion & Title Protection**:
   Captures video title, channel/UP master name (`UP主`), and browser/workspace origin the moment a Bilibili video tab is opened, while strictly filtering out error titles (`"视频去哪儿了？"`, `404`, etc.) so genuine titles are never overwritten.
2. **Instant Deletion, Error Page & Redirect Capture**:
   Detects when a tracked video tab redirects to `https://www.bilibili.com/` or transitions to a removal/error page (`"视频去哪儿了？"`), immediately resolving the original title and author from local history stores or `chrome.history`.
3. **Multi-Window & Workspace Awareness (Edge Workspaces)**:
   Scans all open browser windows independently. The extension popup displays the Bilibili tab count for the **current window/workspace** while providing a unified view and quick switcher across all windows.
4. **Yellow Notification Symbol**:
   Illuminates a prominent yellow warning badge (`#FFB800`) and yellow alert icon (`icon-yellow-*.png`) next to the address bar whenever a video is removed or deleted.
5. **Cross-Browser 30-Minute Sync & Adjacent Dataset Cross-Check**:
   Every 30 minutes, open tabs are cross-checked against the previous snapshot (ignoring manually closed tabs or intentionally opened homepages) and synchronized between Microsoft Edge, Google Chrome, and Chrome Canary via a lightweight, zero-dependency local sync server.
6. **Recovery & Search Tools**:
   From the dropdown menu, search for reuploads/archives on Bilibili with one click, check the Wayback Machine for snapshots, copy metadata, or export records to **JSON** or **CSV (Excel)**.

---

<a name="中文说明"></a>
## 🇨🇳 中文说明

在 B 站开启数十甚至上百个视频标签时，一旦某个视频被 UP 主删除或下架，该页面刷新或从休眠恢复后会**自动重定向至 B 站首页（`https://www.bilibili.com/`）**或显示**“视频去哪儿了？”/“视频去哪了呢？”**，导致原标题和 UP 主信息彻底丢失。

**RcdRmd (Record & Remind)** 解决此痛点：
1. **自动捕捉与防污染保护**：只要标签页打开，立即记录视频标题、UP主名称、BV号与所在窗口/工作区，并严格拦截错误页标题（如“视频去哪了呢？”），防止覆盖真实视频标题；
2. **重定向与失效页面双重捕获**：精准捕捉视频标签跳转至首页或显示“视频去哪儿了？”的行为，通过多级本地缓存与浏览器历史记录（`chrome.history`）回溯还原原始标题与 UP 主；
3. **多窗口/工作区感知**：支持多窗口与 Edge 工作区独立计数，弹窗精确展示当前窗口标签数，并支持全工作区聚合、自定义重命名与一键切换；
4. **黄色图标告警**：有视频被删时，地址栏旁扩展图标立即切换为黄色警示感叹号徽章；
5. **每30分钟相邻数据集比对与跨端同步**：内置定时任务，自动比对相邻周期标签快照（排除手动关闭标签或主动打开B站首页的正常操作），并联动本地轻量服务打通 Edge、Chrome 与 Canary；
6. **补档与导出**：一键在 B 站搜索补档、查询网页历史快照，支持一键导出为 JSON / CSV (Excel)。

---

## 🚀 Installation / 安装指南

Compatible with **Microsoft Edge**, **Google Chrome**, and **Google Chrome Canary**:

1. Clone or download this repository:
   ```bash
   git clone https://github.com/TywayWang/RcdRmd.git
   ```
2. Open your browser extension management page:
   - **Microsoft Edge**: `edge://extensions/`
   - **Google Chrome**: `chrome://extensions/`
   - **Chrome Canary**: `chrome://extensions/`
3. Enable **Developer mode** (开发人员模式) in the top-right or sidebar.
4. Click **Load unpacked** (加载已解压的扩展程序).
5. Select the repository root folder.
6. Pin **RcdRmd** to your browser toolbar.

---

## 🔄 Cross-Browser Sync Hub / 跨浏览器同步中心

The extension functions 100% standalone inside any single browser. If you want to synchronize tabs and deletion alerts across **multiple browsers (Edge + Chrome + Canary)**:

1. Navigate to the `sync-server/` directory.
2. Start the local server:
   - **Windows (Double-click)**: Run `start-server.bat` (automatically detects Node.js or Python).
   - **Windows (Silent Background)**: Run `start-server-hidden.vbs` (runs without terminal window).
   - **Node.js Manual**: `node rcdrmd-sync-server.js`
   - **Python Manual**: `python rcdrmd-sync-server.py`
3. The server runs on `http://127.0.0.1:32188` and writes to `sync-server/rcdrmd-dataset.json`. Zero external packages required.
4. To stop the server, run `stop-server.bat`.

---

## 📂 Project Structure / 项目结构

```
RcdRmd/
├── manifest.json                  # Manifest V3 configuration
├── background.js                  # Service worker (tab tracking, 30m adjacent cross-check, history recovery)
├── content.js                     # Content script (DOM metadata extraction & deletion state checks)
├── icons/                         # Complete icons (normal blue & yellow-alert state)
│   ├── icon-16.png / 32 / 48 / 128
│   └── icon-yellow-16.png / 32 / 48 / 128
├── popup/
│   ├── popup.html                 # Dropdown UI
│   ├── popup.css                  # Responsive styling with yellow alert banners
│   └── popup.js                   # Interactive logic & multi-workspace switcher
├── sync-server/
│   ├── rcdrmd-sync-server.js      # Zero-dependency Node.js sync server
│   ├── rcdrmd-sync-server.py      # Zero-dependency Python sync server
│   ├── start-server.bat           # One-click Windows starter
│   ├── start-server-hidden.vbs    # Silent background launcher
│   └── stop-server.bat            # Windows stop script
├── scripts/
│   └── generate-icons.js          # Pure Node.js PNG icon generator
├── test/
│   ├── test-adjacent-crosscheck.js # Unit & edge-case tests for adjacent dataset cross-checking
│   └── test-sync.js               # Multi-workspace & cross-browser integration test suite
├── .gitignore
├── LICENSE                        # MIT License
├── CHROMEWEBSTORE.md              # Store submission metadata & justifications
└── README.md
```

---

## 🔒 Privacy & Security

- **100% Local**: No personal browsing data, tab history, or account credentials are sent to any remote cloud server.
- **Local Storage Only**: All dataset records reside exclusively on your machine (`chrome.storage.local` and `sync-server/rcdrmd-dataset.json`).
- **Local Sync Auth**: The local sync server only accepts requests carrying the shared `X-RcdRmd-Token` header and does not send a CORS `Access-Control-Allow-Origin: *` header to unauthenticated callers, so an arbitrary visited web page cannot read or pollute the dataset.
- **Open Source**: Full transparency, zero external analytics, zero tracking.

> ⚠️ **Never commit your local dataset.** `sync-server/rcdrmd-dataset.json` (and `sync-server/*.dataset.json`) are listed in `.gitignore` because they accumulate **real** tab titles, URLs, UP主 names and workspace/browser names from your own browsing.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — Copyright (c) 2026 [TywayWang](https://github.com/TywayWang/RcdRmd).
