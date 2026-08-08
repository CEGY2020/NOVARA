#!/usr/bin/env python3
"""Unit tests for API routing (no live DynamoDB required)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

import novara_api


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
        body = __import__("json").loads(response["body"])
        self.assertEqual(body["points"][0]["t"], "2026-08-02T20:00:00Z")

    def test_health(self):
        status, payload = novara_api.route_request("GET", "/api/health", {})
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["table"], "NOVARAReadings")


if __name__ == "__main__":
    unittest.main()
