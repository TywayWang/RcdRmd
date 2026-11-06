"""
RcdRmd - Local Cross-Browser Sync Server (Python)
Coordinates Bilibili tabs, workspaces & deleted video records across Edge, Chrome, and Canary.
Zero external dependencies: uses Python standard library http.server.
"""

import json
import os
import sys
import re
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

sys.dont_write_bytecode = True
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PORT = int(os.environ.get('RCDRMD_PORT', '32188'))
DATASET_FILE = os.environ.get(
    'RCDRMD_DATASET_FILE',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rcdrmd-dataset.json')
)

# Shared token that must accompany every data request.
# The real hardening is localhost-only binding; this token blocks casual
# drive-by requests from arbitrary web pages that don't know it.
SYNC_TOKEN = 'rcdrmd-local-sync-token'


def load_dataset():
    if os.path.exists(DATASET_FILE):
        try:
            with open(DATASET_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[Sync Server] Error loading dataset: {e}")
    return {
        "version": "1.0.0",
        "updatedAt": datetime.utcnow().isoformat() + "Z",
        "browsers": {},
        "deletedVideos": [],
        "allTrackedHistory": {}
    }


def save_dataset(data):
    try:
        data["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        temp_file = DATASET_FILE + ".tmp"
        with open(temp_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(temp_file, DATASET_FILE)
    except Exception as e:
        print(f"[Sync Server] Error saving dataset: {e}")


dataset = load_dataset()

ERROR_TITLE_PATTERNS = [
    re.compile(r"^视频去哪[了儿呢\?？\s]*$", re.IGNORECASE),
    re.compile(r"^啊叻[？\?]?\s*视频不见了.*", re.IGNORECASE),
    re.compile(r"^(404(\s*not\s*found)?|404|bilibili-404|404-bilibili|出错了(\s*-\s*bilibili\.com)?)$", re.IGNORECASE),
    re.compile(r"^(稿件不可见|该稿件已被下架|稿件已被UP主删除|抱歉[，,].*已被删除|非常抱歉.*|该内容已不存在)$", re.IGNORECASE),
    re.compile(r"^(原视频已失效|视频已失效|该视频已失效|已失效|视频不存在|原视频不存在|视频不见了)$", re.IGNORECASE),
    re.compile(r"^(已删除的B站视频|Unknown Video Title|（原视频标题未获取）|原视频标题未获取|（未获取到标题）|未获取到标题)$", re.IGNORECASE),
    re.compile(r"^(B站视频|B站页面|B站标签页|B站首页)$", re.IGNORECASE),
]


def clean_title(text):
    if not text:
        return ""
    t = re.sub(r"_哔哩哔哩_bilibili.*", "", text, flags=re.IGNORECASE)
    t = re.sub(r"_哔哩哔哩.*", "", t, flags=re.IGNORECASE)
    t = re.sub(r" - 哔哩哔哩.*", "", t, flags=re.IGNORECASE)
    t = re.sub(r" - bilibili.*", "", t, flags=re.IGNORECASE)
    return t.strip()


def is_deleted_or_error_text(text):
    if not text:
        return False
    raw = text.strip()
    cleaned = clean_title(raw)
    for pat in ERROR_TITLE_PATTERNS:
        if pat.match(raw) or (cleaned and pat.match(cleaned)):
            return True
    return False


def is_valid_video_title(text):
    if not text:
        return False
    t = clean_title(text)
    if not t or t in ['B站视频', 'B站页面', 'B站标签页', 'B站首页'] or t.startswith('哔哩哔哩') or t.startswith('bilibili'):
        return False
    return not is_deleted_or_error_text(t)


class SyncHandler(BaseHTTPRequestHandler):
    def _is_valid_token(self):
        return self.headers.get('X-RcdRmd-Token') == SYNC_TOKEN

    def _set_cors(self):
        if self._is_valid_token():
            self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Accept, X-RcdRmd-Token')

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if not self._is_valid_token():
            self.send_response(401)
            self._set_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error":"Unauthorized: missing or invalid X-RcdRmd-Token"}')
            return

        if parsed.path == '/api/status':
            self.send_response(200)
            self._set_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            active_browsers = list(dataset.get("browsers", {}).keys())
            total_tabs = sum(len(b.get("tabs", [])) for b in dataset.get("browsers", {}).values())
            res = {
                "status": "online",
                "version": "1.0.0",
                "port": PORT,
                "activeBrowsers": active_browsers,
                "totalTabsAcrossBrowsers": total_tabs,
                "totalDeletedVideos": len(dataset.get("deletedVideos", [])),
                "datasetFile": os.path.basename(DATASET_FILE),
                "updatedAt": dataset.get("updatedAt")
            }
            self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))
            return

        if parsed.path == '/api/dataset':
            self.send_response(200)
            self._set_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(dataset, ensure_ascii=False, indent=2).encode('utf-8'))
            return

        self.send_response(404)
        self._set_cors()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"error":"Not Found"}')

    def do_POST(self):
        parsed = urlparse(self.path)
        if not self._is_valid_token():
            self.send_response(401)
            self._set_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error":"Unauthorized: missing or invalid X-RcdRmd-Token"}')
            return

        if parsed.path == '/api/sync':
            length = int(self.headers.get('Content-Length', 0))
            body_bytes = self.rfile.read(length)
            try:
                payload = json.loads(body_bytes.decode('utf-8'))
                browser_name = payload.get("browser", "Unknown Browser")
                incoming_tabs = payload.get("tabs", [])
                incoming_deleted = payload.get("deletedVideos", [])
                incoming_windows = payload.get("windows", {})

                if "browsers" not in dataset:
                    dataset["browsers"] = {}
                dataset["browsers"][browser_name] = {
                    "name": browser_name,
                    "lastHeartbeat": datetime.utcnow().isoformat() + "Z",
                    "windows": incoming_windows,
                    "tabs": incoming_tabs
                }

                if "allTrackedHistory" not in dataset:
                    dataset["allTrackedHistory"] = {}
                for t in incoming_tabs:
                    bvid = t.get("bvid")
                    title = t.get("title")
                    if bvid and title and is_valid_video_title(title):
                        dataset["allTrackedHistory"][bvid] = {
                            "title": title,
                            "channel": t.get("channel", ""),
                            "browser": browser_name,
                            "workspace": t.get("workspace", ""),
                            "lastSeen": datetime.utcnow().isoformat() + "Z"
                        }

                if "deletedVideos" not in dataset:
                    dataset["deletedVideos"] = []
                for del_item in incoming_deleted:
                    r = (del_item.get("reason") or "").lower()
                    if "http 412" in r or "http 403" in r or "http 429" in r or "http 5" in r:
                        continue
                    bvid = del_item.get("bvid")
                    item_id = del_item.get("id")

                    if not is_valid_video_title(del_item.get("title")) and bvid and bvid in dataset.get("allTrackedHistory", {}):
                        hist_title = dataset["allTrackedHistory"][bvid].get("title")
                        if is_valid_video_title(hist_title):
                            del_item["title"] = hist_title

                    if (not del_item.get("channel") or del_item.get("channel") == "未知UP主") and bvid and bvid in dataset.get("allTrackedHistory", {}):
                        hist_channel = dataset["allTrackedHistory"][bvid].get("channel")
                        if hist_channel and hist_channel != "未知UP主":
                            del_item["channel"] = hist_channel

                    match_idx = -1
                    for idx, v in enumerate(dataset["deletedVideos"]):
                        if (bvid and v.get("bvid") == bvid) or (item_id and v.get("id") == item_id):
                            match_idx = idx
                            break

                    if match_idx == -1:
                        del_item_copy = dict(del_item)
                        del_item_copy["recordedByServerAt"] = datetime.utcnow().isoformat() + "Z"
                        dataset["deletedVideos"].insert(0, del_item_copy)
                        print(f"[Sync Server] [!] Registered DELETED video from {browser_name}: {del_item.get('title')}")
                    else:
                        if is_valid_video_title(del_item.get("title")):
                            dataset["deletedVideos"][match_idx]["title"] = del_item["title"]
                        elif not is_valid_video_title(dataset["deletedVideos"][match_idx].get("title")) and bvid and bvid in dataset.get("allTrackedHistory", {}):
                            hist_title = dataset["allTrackedHistory"][bvid].get("title")
                            if is_valid_video_title(hist_title):
                                dataset["deletedVideos"][match_idx]["title"] = hist_title
                        if del_item.get("channel") and del_item.get("channel") != "未知UP主":
                            dataset["deletedVideos"][match_idx]["channel"] = del_item["channel"]

                dataset["deletedVideos"] = [
                    v for v in dataset["deletedVideos"]
                    if "http 412" not in (v.get("reason") or "").lower()
                    and "http 403" not in (v.get("reason") or "").lower()
                    and "http 429" not in (v.get("reason") or "").lower()
                    and "http 5" not in (v.get("reason") or "").lower()
                ]

                for v in dataset["deletedVideos"]:
                    v_bvid = v.get("bvid")
                    if not is_valid_video_title(v.get("title")) and v_bvid and v_bvid in dataset.get("allTrackedHistory", {}):
                        hist_t = dataset["allTrackedHistory"][v_bvid].get("title")
                        if is_valid_video_title(hist_t):
                            v["title"] = hist_t
                    if (not v.get("channel") or v.get("channel") == "未知UP主") and v_bvid and v_bvid in dataset.get("allTrackedHistory", {}):
                        hist_c = dataset["allTrackedHistory"][v_bvid].get("channel")
                        if hist_c and hist_c != "未知UP主":
                            v["channel"] = hist_c

                save_dataset(dataset)

                all_tabs = []
                for b_data in dataset.get("browsers", {}).values():
                    all_tabs.extend(b_data.get("tabs", []))

                print(f"[Sync Server] Synced with '{browser_name}' ({len(incoming_tabs)} tabs). Total: {len(all_tabs)} tabs.")

                self.send_response(200)
                self._set_cors()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                res = {
                    "success": True,
                    "serverTime": datetime.utcnow().isoformat() + "Z",
                    "activeBrowsers": list(dataset.get("browsers", {}).keys()),
                    "allOpeningTabs": all_tabs,
                    "deletedVideos": dataset.get("deletedVideos", [])
                }
                self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))
                return
            except Exception as e:
                print(f"[Sync Server] Sync error: {e}")
                self.send_response(400)
                self._set_cors()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                return

        self.send_response(404)
        self._set_cors()
        self.end_headers()


def run():
    server_address = ('127.0.0.1', PORT)
    httpd = HTTPServer(server_address, SyncHandler)
    print("=" * 52)
    print("  RcdRmd Local Cross-Browser Sync Hub (Python)")
    print(f"  Running on: http://127.0.0.1:{PORT}")
    print(f"  Dataset storage: {os.path.basename(DATASET_FILE)}")
    print("  Ready for Microsoft Edge, Chrome & Chrome Canary")
    print("=" * 52)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[Sync Server] Shutting down.")
        httpd.server_close()


if __name__ == '__main__':
    run()
