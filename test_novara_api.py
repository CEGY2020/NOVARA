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
            "siteId": "SITE001",
            "days": 7,
            "count": 1,
        }
        with patch.object(novara_api, "query_readings", return_value=fake):
            status, payload = novara_api.route_request(
                "GET", "/api/readings", {"siteId": ["SITE001"], "days": ["7"]}
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
            "siteId": "SITE001",
            "days": 3,
            "count": 0,
        }
        with patch.object(novara_api, "query_readings", return_value=fake) as mocked:
            for days in (3, 30):
                status, payload = novara_api.route_request(
                    "GET", "/api/readings", {"siteId": ["SITE001"], "days": [str(days)]}
                )
                self.assertEqual(status, 200)
                mocked.assert_called_with("SITE001", days)

    def test_sites_route(self):
        fake = {
            "table": "NOVARASites",
            "count": 1,
            "sites": [
                {
                    "siteId": "SITE001",
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
        self.assertEqual(payload["sites"][0]["siteId"], "SITE001")

    def test_create_site_route(self):
        body = {
            "SiteID": "TST001",
            "SiteName": "Test Site",
            "SystemType": "DHW",
            "Status": "Online",
            "Systems": 2,
        }
        fake = {"ok": True, "table": "NOVARASites", "site": {"siteId": "TST001"}}
        with patch.object(novara_api, "save_site", return_value=fake) as mocked:
            status, payload = novara_api.route_request("POST", "/api/sites", {}, body)
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "create")

    def test_update_site_route(self):
        body = {
            "SiteID": "SITE001",
            "SiteName": "Vista Springs",
            "Status": "Needs Review",
            "Systems": 1,
        }
        fake = {"ok": True, "table": "NOVARASites", "site": {"siteId": "SITE001"}}
        with patch.object(novara_api, "save_site", return_value=fake) as mocked:
            status, payload = novara_api.route_request("PUT", "/api/sites", {}, body)
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "update")

    def test_create_site_validation(self):
        status, payload = novara_api.route_request(
            "POST", "/api/sites", {}, {"SiteName": "Missing ID"}
        )
        self.assertEqual(status, 400)
        self.assertIn("SiteID", payload["error"])

    def test_parse_site_payload_normalizes_system_type(self):
        item, error = novara_api.parse_site_payload(
            {
                "siteId": "HP002",
                "siteName": "Highlander Two",
                "systemType": "Common Area DHW",
                "status": "Online",
                "systems": "3",
            }
        )
        self.assertIsNone(error)
        self.assertEqual(item["SiteID"], "HP002")
        self.assertEqual(item["SystemType"], "DHW")
        self.assertEqual(item["Systems"], 3)

    def test_normalize_site_location_and_address(self):
        site = novara_api.normalize_site(
            {
                "SiteID": "SITE001",
                "SiteName": "Vista Springs",
                "StreetAddress": "21550 Box Springs Rd",
                "City": "Moreno Valley",
                "State": "CA",
                "SystemType": "Common Area DHW",
                "Owner": "Crystal Asset Management",
            }
        )
        self.assertEqual(site["location"], "Moreno Valley, CA")
        self.assertEqual(site["address"], "21550 Box Springs Rd")
        self.assertEqual(site["systemType"], "DHW")
        self.assertEqual(site["owner"], "Crystal Asset Management")
        self.assertEqual(site["status"], "Online")

    def test_lambda_event_readings(self):
        fake = {
            "points": [{"t": "2026-08-02T20:00:00Z", "t1": 72.5, "t2": 68.1}],
            "lastUpdate": "2026-08-02T20:00:00Z",
            "siteId": "SITE001",
            "days": 7,
            "count": 1,
        }
        event = {
            "version": "2.0",
            "routeKey": "GET /api/readings",
            "rawPath": "/api/readings",
            "rawQueryString": "siteId=SITE001&days=7",
            "requestContext": {"http": {"method": "GET", "path": "/api/readings"}},
            "queryStringParameters": {"siteId": "SITE001", "days": "7"},
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

    def test_lambda_event_create_site(self):
        fake = {
            "ok": True,
            "table": "NOVARASites",
            "site": {"siteId": "TST001", "name": "Test Site"},
        }
        event = {
            "version": "2.0",
            "rawPath": "/api/sites",
            "requestContext": {"http": {"method": "POST", "path": "/api/sites"}},
            "body": json.dumps(
                {
                    "SiteID": "TST001",
                    "SiteName": "Test Site",
                    "SystemType": "Pool",
                    "Status": "Offline",
                    "Systems": 1,
                }
            ),
        }
        with patch.object(novara_api, "save_site", return_value=fake) as mocked:
            response = novara_api.handle_lambda_event(event)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(mocked.call_args.kwargs["mode"], "create")
        self.assertIn("POST", response["headers"]["Access-Control-Allow-Methods"])

    def test_lambda_event_update_site(self):
        fake = {
            "ok": True,
            "table": "NOVARASites",
            "site": {"siteId": "SITE001", "name": "Vista Springs Updated"},
        }
        event = {
            "version": "2.0",
            "rawPath": "/api/sites",
            "requestContext": {"http": {"method": "PUT", "path": "/api/sites"}},
            "body": json.dumps(
                {
                    "SiteID": "SITE001",
                    "SiteName": "Vista Springs Updated",
                    "SystemType": "DHW",
                    "Status": "Needs Review",
                    "Systems": 2,
                }
            ),
        }
        with patch.object(novara_api, "save_site", return_value=fake) as mocked:
            response = novara_api.handle_lambda_event(event)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(mocked.call_args.kwargs["mode"], "update")
        self.assertIn("PUT", response["headers"]["Access-Control-Allow-Methods"])

    def test_sites_js_keeps_edit_mode_after_form_reset(self):
        """Regression: form.reset() must not leave Save stuck in create mode."""
        source = Path(__file__).resolve().parent.joinpath("sites.js").read_text(
            encoding="utf-8"
        )
        open_modal = source.split("function openModal", 1)[1].split(
            "function closeModal", 1
        )[0]
        reset_at = open_modal.find("form.reset()")
        mode_at = open_modal.find("currentMode = mode")
        self.assertNotEqual(reset_at, -1, "openModal should call form.reset()")
        self.assertNotEqual(mode_at, -1, "openModal should set currentMode")
        self.assertLess(
            reset_at,
            mode_at,
            "currentMode must be set after form.reset() so Edit Save uses PUT",
        )
        save_site = source.split("function saveSite", 1)[1].split(
            "if (addBtn)", 1
        )[0]
        self.assertIn("currentMode === \"edit\"", save_site)
        self.assertIn("api.updateSite", save_site)
        self.assertIn("api.createSite", save_site)

    def test_systems_route(self):
        fake = {
            "table": "NOVARASystems",
            "count": 1,
            "systems": [
                {
                    "systemId": "SYS001",
                    "siteId": "SITE001",
                    "systemName": "DHW Loop A",
                    "systemType": "DHW",
                    "status": "Online",
                    "equipmentCount": 2,
                }
            ],
        }
        with patch.object(novara_api, "scan_systems", return_value=fake):
            status, payload = novara_api.route_request("GET", "/api/systems", {})
        self.assertEqual(status, 200)
        self.assertEqual(payload["systems"][0]["systemId"], "SYS001")

    def test_create_system_route(self):
        body = {
            "SystemID": "SYS001",
            "SiteID": "SITE001",
            "SystemName": "DHW Loop A",
            "SystemType": "DHW",
            "Status": "Online",
            "EquipmentCount": 2,
        }
        fake = {"ok": True, "table": "NOVARASystems", "system": {"systemId": "SYS001"}}
        with patch.object(novara_api, "save_system", return_value=fake) as mocked:
            with patch.object(
                novara_api,
                "parse_system_payload",
                return_value=(body, None),
            ):
                status, payload = novara_api.route_request(
                    "POST", "/api/systems", {}, body
                )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "create")

    def test_update_system_route(self):
        body = {
            "SystemID": "SYS001",
            "SiteID": "SITE001",
            "SystemName": "DHW Loop A",
            "SystemType": "Boiler",
            "Status": "Maintenance",
            "EquipmentCount": 3,
        }
        fake = {"ok": True, "table": "NOVARASystems", "system": {"systemId": "SYS001"}}
        with patch.object(novara_api, "save_system", return_value=fake) as mocked:
            with patch.object(
                novara_api,
                "parse_system_payload",
                return_value=(body, None),
            ):
                status, payload = novara_api.route_request(
                    "PUT", "/api/systems", {}, body
                )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "update")

    def test_create_system_validation(self):
        status, payload = novara_api.route_request(
            "POST", "/api/systems", {}, {"SystemName": "Missing IDs"}
        )
        self.assertEqual(status, 400)
        self.assertIn("SystemID", payload["error"])

    def test_parse_system_payload_requires_site(self):
        with patch.object(novara_api, "get_site_item", return_value=None):
            item, error = novara_api.parse_system_payload(
                {
                    "SystemID": "SYS001",
                    "SiteID": "MISSING",
                    "SystemName": "Orphan",
                    "SystemType": "Pool",
                    "Status": "Online",
                    "EquipmentCount": 1,
                }
            )
        self.assertIsNone(item)
        self.assertIn("not found", error)

    def test_parse_system_payload_accepts_boiler_and_maintenance(self):
        with patch.object(
            novara_api,
            "get_site_item",
            return_value={"siteId": "SITE001", "name": "Vista Springs"},
        ):
            item, error = novara_api.parse_system_payload(
                {
                    "systemId": "SYS002",
                    "siteId": "SITE001",
                    "systemName": "Boiler Plant",
                    "systemType": "Boiler",
                    "status": "Maintenance",
                    "equipmentCount": "4",
                    "installDate": "2024-06-01",
                    "notes": "Quarterly service due",
                }
            )
        self.assertIsNone(error)
        self.assertEqual(item["SystemID"], "SYS002")
        self.assertEqual(item["SystemType"], "Boiler")
        self.assertEqual(item["Status"], "Maintenance")
        self.assertEqual(item["EquipmentCount"], 4)
        self.assertEqual(item["InstallDate"], "2024-06-01")

    def test_normalize_system(self):
        system = novara_api.normalize_system(
            {
                "SystemID": "SYS001",
                "SiteID": "SITE001",
                "SystemName": "DHW Loop A",
                "SystemType": "Domestic Hot Water",
                "Status": "Online",
                "EquipmentCount": 2,
            },
            site_name="Vista Springs",
        )
        self.assertEqual(system["systemId"], "SYS001")
        self.assertEqual(system["siteName"], "Vista Springs")
        self.assertEqual(system["systemType"], "DHW")
        self.assertEqual(system["equipmentCount"], 2)

    def test_systems_js_keeps_edit_mode_after_form_reset(self):
        source = Path(__file__).resolve().parent.joinpath("systems.js").read_text(
            encoding="utf-8"
        )
        open_modal = source.split("function openModal", 1)[1].split(
            "function closeModal", 1
        )[0]
        reset_at = open_modal.find("form.reset()")
        mode_at = open_modal.find("currentMode = mode")
        self.assertNotEqual(reset_at, -1, "openModal should call form.reset()")
        self.assertNotEqual(mode_at, -1, "openModal should set currentMode")
        self.assertLess(
            reset_at,
            mode_at,
            "currentMode must be set after form.reset() so Edit Save uses PUT",
        )
        save_system = source.split("function saveSystem", 1)[1].split(
            "if (addBtn)", 1
        )[0]
        self.assertIn("currentMode === \"edit\"", save_system)
        self.assertIn("api.updateSystem", save_system)
        self.assertIn("api.createSystem", save_system)

    def test_health(self):
        status, payload = novara_api.route_request("GET", "/api/health", {})
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["table"], "NOVARAReadings")
        self.assertEqual(payload["sitesTable"], "NOVARASites")
        self.assertEqual(payload["systemsTable"], "NOVARASystems")

    def test_api_response_is_json_not_html(self):
        response = novara_api.api_response(200, {"ok": True})
        self.assertNotIn("<", response["body"])
        self.assertTrue(response["body"].startswith("{"))

    def test_write_api_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "api-config.js"
            rc = write_api_config.main(
                ["--api-url", "https://example.execute-api.[REDACTED].amazonaws.com/", "--output", str(out)]
            )
            self.assertEqual(rc, 0)
            text = out.read_text(encoding="utf-8")
            self.assertIn(
                "window.NOVARA_API_BASE = 'https://example.execute-api.[REDACTED].amazonaws.com'",
                text,
            )


if __name__ == "__main__":
    unittest.main()
