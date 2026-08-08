#!/usr/bin/env python3
"""NOVARA local server: static files + DynamoDB readings/sites APIs."""

from __future__ import annotations

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import novara_api

DEFAULT_PORT = int(os.environ.get("PORT", "8000"))


class NovaraHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/readings":
            params = parse_qs(parsed.query)
            status, payload = novara_api.handle_readings_request(params)
            self._send_json(status, payload)
            return
        if parsed.path == "/api/sites":
            status, payload = novara_api.handle_sites_request()
            self._send_json(status, payload)
            return
        if parsed.path == "/api/health":
            status, payload = novara_api.handle_health_request()
            self._send_json(status, payload)
            return
        super().do_GET()

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main():
    novara_api.sanitize_aws_env()
    os.chdir(os.path.dirname(os.path.abspath(__file__)) or ".")
    server = ThreadingHTTPServer(("0.0.0.0", DEFAULT_PORT), NovaraHandler)
    print(
        "NOVARA server on http://0.0.0.0:%s (readings=%s sites=%s)"
        % (DEFAULT_PORT, novara_api.TABLE_NAME, novara_api.SITES_TABLE_NAME)
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
