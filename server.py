#!/usr/bin/env python3
"""NOVARA local server: static files + DynamoDB readings/savings/sites/systems/owners/mgmt-companies/leads APIs."""

from __future__ import annotations

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import novara_api

DEFAULT_PORT = int(os.environ.get("PORT", "8000"))


class NovaraHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header(
                "Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS"
            )
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/readings":
            params = parse_qs(parsed.query)
            status, payload = novara_api.handle_readings_request(params)
            self._send_json(status, payload)
            return
        if parsed.path == "/api/savings":
            params = parse_qs(parsed.query)
            status, payload = novara_api.handle_savings_request(params)
            self._send_json(status, payload)
            return
        if parsed.path == "/api/sites":
            status, payload = novara_api.handle_sites_request()
            self._send_json(status, payload)
            return
        if parsed.path == "/api/systems":
            status, payload = novara_api.handle_systems_request()
            self._send_json(status, payload)
            return
        if parsed.path == "/api/owners":
            status, payload = novara_api.handle_owners_request()
            self._send_json(status, payload)
            return
        if parsed.path == "/api/mgmt-companies":
            status, payload = novara_api.handle_mgmt_companies_request()
            self._send_json(status, payload)
            return
        if parsed.path == "/api/leads":
            status, payload = novara_api.handle_leads_request()
            self._send_json(status, payload)
            return
        if parsed.path == "/api/health":
            status, payload = novara_api.handle_health_request()
            self._send_json(status, payload)
            return
        super().do_GET()

    def do_POST(self):
        self._handle_json_write("create")

    def do_PUT(self):
        self._handle_json_write("update")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        system_path_id = novara_api._system_id_from_path(parsed.path)
        if system_path_id is not None:
            status, payload = novara_api.handle_system_delete_request(system_path_id)
            self._send_json(status, payload)
            return
        self.send_error(404)

    def _handle_json_write(self, mode: str):
        parsed = urlparse(self.path)
        if parsed.path == "/api/sites":
            body = self._read_json_body()
            if body is None:
                return
            status, payload = novara_api.handle_site_write_request(body, mode=mode)
            self._send_json(status, payload)
            return
        if parsed.path == "/api/systems":
            body = self._read_json_body()
            if body is None:
                return
            status, payload = novara_api.handle_system_write_request(body, mode=mode)
            self._send_json(status, payload)
            return
        system_path_id = novara_api._system_id_from_path(parsed.path)
        if system_path_id is not None and mode == "update":
            body = self._read_json_body()
            if body is None:
                return
            if not isinstance(body, dict):
                body = {}
            body = dict(body)
            body["SystemID"] = system_path_id
            status, payload = novara_api.handle_system_write_request(body, mode=mode)
            self._send_json(status, payload)
            return
        if parsed.path == "/api/owners":
            body = self._read_json_body()
            if body is None:
                return
            status, payload = novara_api.handle_owner_write_request(body, mode=mode)
            self._send_json(status, payload)
            return
        owner_path_id = novara_api._owner_id_from_path(parsed.path)
        if owner_path_id is not None and mode == "update":
            body = self._read_json_body()
            if body is None:
                return
            status, payload = novara_api.handle_owner_write_request(
                body, mode=mode, owner_id=owner_path_id
            )
            self._send_json(status, payload)
            return
        if parsed.path == "/api/mgmt-companies":
            body = self._read_json_body()
            if body is None:
                return
            status, payload = novara_api.handle_mgmt_company_write_request(
                body, mode=mode
            )
            self._send_json(status, payload)
            return
        mgmt_company_path_id = novara_api._mgmt_company_id_from_path(parsed.path)
        if mgmt_company_path_id is not None and mode == "update":
            body = self._read_json_body()
            if body is None:
                return
            status, payload = novara_api.handle_mgmt_company_write_request(
                body, mode=mode, company_id=mgmt_company_path_id
            )
            self._send_json(status, payload)
            return
        if parsed.path == "/api/leads":
            body = self._read_json_body()
            if body is None:
                return
            status, payload = novara_api.handle_lead_write_request(body, mode=mode)
            self._send_json(status, payload)
            return
        lead_path_id = novara_api._lead_id_from_path(parsed.path)
        if lead_path_id is not None and mode == "update":
            body = self._read_json_body()
            if body is None:
                return
            status, payload = novara_api.handle_lead_write_request(
                body, mode=mode, lead_id=lead_path_id
            )
            self._send_json(status, payload)
            return
        self.send_error(404)

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON body"})
            return None

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main():
    novara_api.sanitize_aws_env()
    os.chdir(os.path.dirname(os.path.abspath(__file__)) or ".")
    server = ThreadingHTTPServer(("0.0.0.0", DEFAULT_PORT), NovaraHandler)
    print(
        "NOVARA server on http://0.0.0.0:%s "
        "(readings=%s savings=demo sites=%s systems=%s owners=%s mgmtCompanies=%s leads=%s)"
        % (
            DEFAULT_PORT,
            novara_api.TABLE_NAME,
            novara_api.SITES_TABLE_NAME,
            novara_api.SYSTEMS_TABLE_NAME,
            novara_api.OWNERS_TABLE_NAME,
            novara_api.MGMT_COMPANIES_TABLE_NAME,
            novara_api.LEADS_TABLE_NAME,
        )
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
