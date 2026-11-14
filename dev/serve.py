#!/usr/bin/env python3
"""Preview server for screenshots of the page in headless Firefox.

Serves extension/ as the site root and dev/ under /dev/, and slips dev/shim.js
(stand-ins for the browser.* APIs and the weather service) into index.html on
the way out. Nothing on disk is modified. Standard library only.

    /slow?s=N   waits N seconds, then answers 204 (holds the page's load event)
    /dev/...    files from dev/
    /...        files from extension/
"""

import mimetypes
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

HOST, PORT = "127.0.0.1", 8765
ROOT = Path(__file__).resolve().parent.parent
DEV = ROOT / "dev"
EXT = ROOT / "extension"

APP_TAG = b'<script type="module" src="app.js"></script>'
SHIM_TAG = b'<script src="/dev/shim.js"></script>\n  '

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("image/svg+xml", ".svg")


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        # Every response, including errors: a cached stylesheet once hid a fix.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/slow":
            seconds = float(parse_qs(url.query).get("s", ["0"])[0])
            time.sleep(min(max(seconds, 0), 60))
            self.send_response(204)
            self.end_headers()
            return

        if url.path.startswith("/dev/"):
            base, rel = DEV, url.path[len("/dev/") :]
        else:
            base, rel = EXT, url.path.lstrip("/")
        file = (base / rel).resolve()
        if not file.is_relative_to(base) or not file.is_file():
            self.send_error(404)
            return

        body = file.read_bytes()
        if url.path == "/page/index.html":
            if APP_TAG not in body:
                self.send_error(500, "index.html has no app.js module tag to hook")
                return
            body = body.replace(APP_TAG, SHIM_TAG + APP_TAG, 1)

        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(str(file))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"serving http://{HOST}:{PORT}/page/index.html", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
