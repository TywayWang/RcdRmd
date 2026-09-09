<div align="center">

# RcdRmd (Record & Remind)

<img src="icons/icon-128.png" width="96" height="96" alt="RcdRmd Logo" />

**Bilibili Deleted Video Tracker & Multi-Workspace Remind Extension**  
*Record lost Bilibili video titles and channels before they vanish upon homepage redirect.*

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
> **An uploader deletes or hides a video, or the video gets removed. When the tab restores or reloads, Bilibili automatically redirects the tab to the homepage (`https://www.bilibili.com/`), wiping out the video's URL, title, and channel information.**

**RcdRmd** solves this problem by maintaining a local dataset of all open Bilibili tabs, monitoring for deletions and homepage redirects, synchronizing across workspaces and browsers every 30 minutes, and alerting you with a yellow notification symbol.

### ✨ Key Features

1. **Automatic Metadata Ingestion**:
   Captures video title, channel/UP master name (`UP主`), and browser/workspace origin the moment a Bilibili video tab is opened.
2. **Instant Deletion & Redirect Capture**:
   Detects when a tracked video tab redirects to `https://www.bilibili.com/` or an error page, immediately logging the original title and author to your permanent local dataset.
3. **Multi-Window & Workspace Awareness (Edge Workspaces)**:
   Scans all open browser windows independently (e.g. Edge Workspaces like `Mixed`, `Dev`). The extension popup displays the tab count for the **current window** (e.g. `68` in Dev, `152` in Mixed) while providing a unified view of all windows.
4. **Yellow Notification Symbol**:
   Illuminates a prominent yellow warning badge (`#FFB800`) and yellow alert icon (`icon-yellow-*.png`) next to the address bar whenever a video is removed or deleted.
5. **Cross-Browser 30-Minute Sync**:
   Every 30 minutes, tabs and deletion alerts synchronize between Microsoft Edge, Google Chrome, and Chrome Canary via a lightweight, zero-dependency local sync server.
6. **Recovery & Search Tools**:
   From the dropdown menu, search for reuploads/archives on Bilibili with one click, check the Wayback Machine for snapshots, copy metadata, or export records to **JSON** or **CSV (Excel)**.

---

<a name="中文说明"></a>
## 🇨🇳 中文说明

在 B 站开启数十甚至上百个视频标签时，一旦某个视频被 UP 主删除或下架，该页面刷新后会**自动 302 重定向至 B 站首页（`https://www.bilibili.com/`）**，导致标题和 UP 主信息彻底消失。

**RcdRmd (Record & Remind)** 解决此痛点：
1. **自动捕捉入库**：只要标签页打开，立即记录视频标题、UP主名称、BV号与所在窗口/工作区；
2. **重定向捕捉**：捕捉视频标签跳转至首页或 404 的行为，锁定原始标题与 UP 主；
3. **多窗口/工作区感知**：完美支持 Edge 工作区（如 Mixed、Dev），弹窗精确展示当前窗口标签数，并支持全工作区聚合与一键切换；
4. **黄色图标告警**：有视频被删时，地址栏旁扩展图标立即变黄并展示黄色警示感叹号徽章；
5. **每30分钟跨端同步**：内置定时任务，联动本地极轻量服务打通 Edge、Chrome 与 Canary；
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
├── background.js                  # Service worker (tab tracking, 30m alarms, multi-window scans)
├── content.js                     # Content script (DOM metadata extraction & deletion checks)
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
│   ├── stop-server.bat            # Windows stop script
│   └── rcdrmd-dataset.json        # Central local dataset
├── scripts/
│   └── generate-icons.js          # Pure Node.js PNG icon generator
├── test/
    └── test-sync.js               # Multi-workspace & cross-browser integration test suite
├── .gitignore
├── LICENSE                        # MIT License
├── CHROMEWEBSTORE.md              # Store submission metadata & justifications
└── README.md
```

---

## 🔒 Privacy & Security

- **100% Local**: No personal browsing data, tab history, or account credentials are sent to any remote cloud server.
- **Local Storage Only**: All dataset records reside exclusively on your machine (`chrome.storage.local` and `sync-server/rcdrmd-dataset.json`).
- **Local Sync Auth**: The local sync server only accepts requests carrying the shared `X-RcdRmd-Token` header and no longer sends a CORS `Access-Control-Allow-Origin: *` to unauthenticated callers, so an arbitrary visited web page cannot read or pollute the dataset.
- **Open Source**: Full transparency, zero external analytics, zero tracking.

> ⚠️ **Never commit your local dataset.** `sync-server/rcdrmd-dataset.json` (and `sync-server/*.dataset.json`) are listed in `.gitignore` because they accumulate **real** tab titles, URLs, UP主 names and workspace/browser names from your own browsing. The tracked placeholder file in this repo is empty; do not replace it with a populated one.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — Copyright (c) 2026 [TywayWang](https://github.com/TywayWang/RcdRmd).
