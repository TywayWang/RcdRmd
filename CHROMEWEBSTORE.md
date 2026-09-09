# Chrome Web Store Listing — RcdRmd

## Metadata

- **Name**: RcdRmd - Bilibili Deleted Video Tracker
- **Summary**: Records open Bilibili video tabs, detects deleted videos redirecting to homepage, syncs across browsers every 30m, and alerts with a yellow icon symbol.
- **Version**: 1.0.0
- **Category**: Productivity / Tools
- **Default Language**: zh-CN

## Permissions Justification

| Permission | Reason |
| :--- | :--- |
| `tabs` | Required to query currently open tabs, detect when a Bilibili video tab navigates or redirects to the homepage/404, and read video page titles and URLs. |
| `storage` | Required to persist the dataset of tracked tabs, deleted video records, and user preferences locally in `chrome.storage.local`. |
| `alarms` | Required to trigger the 30-minute periodic health check and cross-browser synchronization (`chrome.alarms.create('rcdrmd-30min-sync', { periodInMinutes: 30 })`). |
| `*://*.bilibili.com/*` | Required to inject the content script on Bilibili video pages and query Bilibili's public view API (`api.bilibili.com/x/web-interface/view`) to fetch title/channel metadata and verify video availability. |
| `http://127.0.0.1/*` & `http://localhost/*` | Required to communicate with the local synchronization hub at `http://127.0.0.1:32188` to synchronize open tabs across Edge, Chrome, and Canary. |

## Privacy & Data Use
- **Data Collection**: No personal user data or history is sent to any external server. All tab titles, channels, and deleted video records are stored strictly on the user's local machine (`chrome.storage.local` and `sync-server/rcdrmd-dataset.json`).
- **Data Transmission**: None outside `localhost:32188` and public Bilibili view API queries.
