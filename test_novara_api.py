#!/usr/bin/env python3
"""Unit tests for API routing (no live DynamoDB required)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import novara_api
import scripts.write_api_config as write_api_config


class RouteTests(unittest.TestCase):
    def test_readings_route_returns_expected_shape(self):
        fake = {
            "points": [{"t": "2026-08-02T20:00:00Z", "t1": 72.5, "t2": 68.1}],
            "lastUpdate": "2026-08-02T20:00:00Z",
            "siteId": "VS001",
            "days": 7,
            "count": 1,
        }
        with patch.object(novara_api, "query_readings", return_value=fake):
            status, payload = novara_api.route_request(
                "GET", "/api/readings", {"siteId": ["VS001"], "days": ["7"]}
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["lastUpdate"], "2026-08-02T20:00:00Z")
        self.assertEqual(payload["points"][0]["t1"], 72.5)
        self.assertEqual(payload["points"][0]["t2"], 68.1)

    def test_invalid_days(self):
        status, payload = novara_api.route_request(
            "GET", "/api/readings", {"days": ["14"]}
        )
        self.assertEqual(status, 400)
        self.assertIn("days", payload["error"])

    def test_days_3_and_30_accepted(self):
        fake = {
            "points": [],
            "lastUpdate": None,
            "siteId": "VS001",
            "days": 3,
            "count": 0,
        }
        with patch.object(novara_api, "query_readings", return_value=fake) as mocked:
            for days in (3, 30):
                status, payload = novara_api.route_request(
                    "GET", "/api/readings", {"siteId": ["VS001"], "days": [str(days)]}
                )
                self.assertEqual(status, 200)
                mocked.assert_called_with("VS001", days)

    def test_sites_route(self):
        fake = {
            "table": "NOVARASites",
            "count": 1,
            "sites": [
                {
                    "siteId": "VS001",
                    "name": "Vista Springs",
                    "location": "AZ",
                    "systems": 1,
                    "status": "Online",
                }
            ],
        }
        with patch.object(novara_api, "scan_sites", return_value=fake):
            status, payload = novara_api.route_request("GET", "/api/sites", {})
        self.assertEqual(status, 200)
        self.assertEqual(payload["sites"][0]["siteId"], "VS001")

    def test_lambda_event_readings(self):
        fake = {
            "points": [{"t": "2026-08-02T20:00:00Z", "t1": 72.5, "t2": 68.1}],
            "lastUpdate": "2026-08-02T20:00:00Z",
            "siteId": "VS001",
            "days": 7,
            "count": 1,
        }
        event = {
            "version": "2.0",
            "routeKey": "GET /api/readings",
            "rawPath": "/api/readings",
            "rawQueryString": "siteId=VS001&days=7",
            "requestContext": {"http": {"method": "GET", "path": "/api/readings"}},
            "queryStringParameters": {"siteId": "VS001", "days": "7"},
        }
        with patch.object(novara_api, "query_readings", return_value=fake):
            response = novara_api.handle_lambda_event(event)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(response["headers"]["Content-Type"], "application/json; charset=utf-8")
        body = json.loads(response["body"])
        self.assertEqual(body["points"][0]["t"], "2026-08-02T20:00:00Z")

    def test_lambda_event_sites(self):
        fake = {"table": "NOVARASites", "count": 0, "sites": []}
        event = {
            "version": "2.0",
            "rawPath": "/api/sites",
            "requestContext": {"http": {"method": "GET", "path": "/api/sites"}},
        }
        with patch.object(novara_api, "scan_sites", return_value=fake):
            response = novara_api.handle_lambda_event(event)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(json.loads(response["body"])["table"], "NOVARASites")

    def test_health(self):
        status, payload = novara_api.route_request("GET", "/api/health", {})
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["table"], "NOVARAReadings")
        self.assertEqual(payload["sitesTable"], "NOVARASites")

    def test_api_response_is_json_not_html(self):
        response = novara_api.api_response(200, {"ok": True})
        self.assertNotIn("<", response["body"])
        self.assertTrue(response["body"].startswith("{"))

    def test_write_api_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "api-config.js"
            rc = write_api_config.main(
                ["--api-url", "https://example.execute-api.us-west-2.amazonaws.com/", "--output", str(out)]
            )
            self.assertEqual(rc, 0)
            text = out.read_text(encoding="utf-8")
            self.assertIn(
                "window.NOVARA_API_BASE = 'https://example.execute-api.us-west-2.amazonaws.com'",
                text,
            )


if __name__ == "__main__":
    unittest.main()
