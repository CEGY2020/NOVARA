#!/usr/bin/env python3
"""Unit tests for API routing (no live DynamoDB required)."""

from __future__ import annotations

import json
import tempfile
import unittest
from decimal import Decimal
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
                mocked.assert_called_with("SITE001", days, None)

    def test_readings_route_passes_system_id(self):
        fake = {
            "points": [],
            "lastUpdate": None,
            "siteId": "SITE001",
            "systemId": "SYS001",
            "days": 7,
            "count": 0,
        }
        with patch.object(novara_api, "query_readings", return_value=fake) as mocked:
            status, payload = novara_api.route_request(
                "GET",
                "/api/readings",
                {"siteId": ["SITE001"], "systemId": ["SYS001"], "days": ["7"]},
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["systemId"], "SYS001")
        mocked.assert_called_once_with("SITE001", 7, "SYS001")

    def test_savings_route_returns_demo_series(self):
        status, payload = novara_api.route_request(
            "GET", "/api/savings", {"days": ["30"]}
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["days"], 30)
        self.assertEqual(payload["source"], "demo")
        self.assertEqual(payload["count"], 30)
        self.assertEqual(len(payload["points"]), 30)
        self.assertGreater(payload["points"][-1]["cumulative"], 0)
        self.assertEqual(len(payload["sites"]), 4)
        self.assertIn("totalSavings", payload["summary"])

    def test_savings_invalid_days(self):
        status, payload = novara_api.route_request(
            "GET", "/api/savings", {"days": ["7"]}
        )
        self.assertEqual(status, 400)
        self.assertIn("days", payload["error"])

    def test_savings_days_90_and_365_accepted(self):
        for days in (90, 365):
            status, payload = novara_api.route_request(
                "GET", "/api/savings", {"days": [str(days)]}
            )
            self.assertEqual(status, 200)
            self.assertEqual(payload["days"], days)
            self.assertEqual(len(payload["points"]), days)

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

    def test_sites_form_uses_owner_and_mgmt_company_dropdowns(self):
        """Owner/MgmtCompany are lookup selects that store IDs, not free text."""
        html = Path(__file__).resolve().parent.joinpath("sites.html").read_text(
            encoding="utf-8"
        )
        source = Path(__file__).resolve().parent.joinpath("sites.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('<select id="field-owner" name="Owner">', html)
        self.assertIn('<select id="field-mgmtCompany" name="MgmtCompany">', html)
        self.assertNotIn(
            '<input type="text" id="field-owner" name="Owner"', html
        )
        self.assertNotIn(
            '<input type="text" id="field-mgmtCompany" name="MgmtCompany"', html
        )
        self.assertIn("api.getOwners()", source)
        self.assertIn("api.getMgmtCompanies()", source)
        self.assertIn("populateOwnerOptions", source)
        self.assertIn("populateMgmtCompanyOptions", source)
        self.assertIn("owner.ownerId", source)
        self.assertIn("company.mgmtCompanyId", source)
        self.assertIn("populateOwnerOptions(site.owner)", source)
        self.assertIn("populateMgmtCompanyOptions(site.mgmtCompany)", source)

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
        self.assertIn("api.deleteSystem", source)
        self.assertIn("nextSystemId", source)
        self.assertIn("SYS", source)

    def test_derive_site_status_from_systems(self):
        self.assertIsNone(novara_api.derive_site_status_from_systems([]))
        self.assertEqual(
            novara_api.derive_site_status_from_systems(["Online", "Online"]),
            "Online",
        )
        self.assertEqual(
            novara_api.derive_site_status_from_systems(["Online", "Maintenance"]),
            "Needs Review",
        )
        self.assertEqual(
            novara_api.derive_site_status_from_systems(
                ["Online", "Needs Review", "Offline"]
            ),
            "Offline",
        )

    def test_delete_system_route(self):
        fake = {
            "ok": True,
            "table": "NOVARASystems",
            "deleted": True,
            "systemId": "SYS001",
            "siteId": "SITE001",
        }
        with patch.object(novara_api, "delete_system", return_value=fake) as mocked:
            status, payload = novara_api.route_request(
                "DELETE", "/api/systems/SYS001", {}
            )
        self.assertEqual(status, 200)
        self.assertTrue(payload["deleted"])
        mocked.assert_called_once_with("SYS001")

    def test_api_client_exposes_delete_system(self):
        source = Path(__file__).resolve().parent.joinpath("api-client.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("deleteSystem:", source)
        self.assertIn('"/api/systems/"', source)
        self.assertIn('"DELETE"', source)

    def test_sites_js_uses_derived_status_hints(self):
        html = Path(__file__).resolve().parent.joinpath("sites.html").read_text(
            encoding="utf-8"
        )
        source = Path(__file__).resolve().parent.joinpath("sites.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('id="site-status-hint"', html)
        self.assertIn('id="systems-count-hint"', html)
        self.assertIn("updateDerivedFieldHints", source)
        self.assertIn("Derived from linked systems", source)

    def test_owners_route(self):
        fake = {
            "table": "NOVARAOwners",
            "count": 1,
            "owners": [
                {
                    "ownerId": "OWN001",
                    "name": "Crystal Asset Management",
                    "city": "Denver",
                    "state": "CO",
                    "contactName": "Jane Doe",
                    "contactPhone": "303-555-0100",
                }
            ],
        }
        with patch.object(novara_api, "scan_owners", return_value=fake):
            status, payload = novara_api.route_request("GET", "/api/owners", {})
        self.assertEqual(status, 200)
        self.assertEqual(payload["owners"][0]["ownerId"], "OWN001")

    def test_create_owner_route(self):
        body = {
            "OwnerID": "OWN001",
            "Name": "Crystal Asset Management",
            "City": "Denver",
            "State": "CO",
        }
        fake = {"ok": True, "table": "NOVARAOwners", "owner": {"ownerId": "OWN001"}}
        with patch.object(novara_api, "save_owner", return_value=fake) as mocked:
            with patch.object(
                novara_api,
                "parse_owner_payload",
                return_value=(body, None),
            ):
                status, payload = novara_api.route_request(
                    "POST", "/api/owners", {}, body
                )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "create")

    def test_update_owner_route(self):
        body = {
            "OwnerID": "OWN001",
            "Name": "Crystal Asset Management",
            "ContactName": "Jane Doe",
        }
        fake = {"ok": True, "table": "NOVARAOwners", "owner": {"ownerId": "OWN001"}}
        with patch.object(novara_api, "save_owner", return_value=fake) as mocked:
            with patch.object(
                novara_api,
                "parse_owner_payload",
                return_value=(body, None),
            ):
                status, payload = novara_api.route_request(
                    "PUT", "/api/owners", {}, body
                )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "update")

    def test_update_owner_by_id_route(self):
        body = {
            "Name": "Crystal Asset Management",
            "ContactName": "Jane Doe",
        }
        fake = {"ok": True, "table": "NOVARAOwners", "owner": {"ownerId": "OWN001"}}
        with patch.object(novara_api, "save_owner", return_value=fake) as mocked:
            status, payload = novara_api.route_request(
                "PUT", "/api/owners/OWN001", {}, body
            )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "update")
        self.assertEqual(mocked.call_args.args[0]["OwnerID"], "OWN001")

    def test_update_owner_by_id_mismatch(self):
        status, payload = novara_api.route_request(
            "PUT",
            "/api/owners/OWN001",
            {},
            {"OwnerID": "OWN002", "Name": "Mismatch"},
        )
        self.assertEqual(status, 400)
        self.assertIn("must match", payload["error"])

    def test_create_owner_validation(self):
        status, payload = novara_api.route_request(
            "POST", "/api/owners", {}, {"City": "Denver"}
        )
        self.assertEqual(status, 400)
        self.assertIn("OwnerID", payload["error"])

    def test_parse_owner_payload_requires_name(self):
        item, error = novara_api.parse_owner_payload(
            {"OwnerID": "OWN001", "Address": "123 Main"}
        )
        self.assertIsNone(item)
        self.assertIn("Name", error)

    def test_parse_owner_payload_accepts_fields(self):
        item, error = novara_api.parse_owner_payload(
            {
                "ownerId": "OWN002",
                "name": "Summit Holdings",
                "address": "100 Market St",
                "city": "Boulder",
                "state": "CO",
                "zip": "80301",
                "contactName": "Sam Lee",
                "contactEmail": "sam@example.com",
                "contactPhone": "303-555-0199",
                "notes": "Preferred billing contact",
            }
        )
        self.assertIsNone(error)
        self.assertEqual(item["OwnerID"], "OWN002")
        self.assertEqual(item["Name"], "Summit Holdings")
        self.assertEqual(item["ContactEmail"], "sam@example.com")
        self.assertEqual(item["Notes"], "Preferred billing contact")

    def test_normalize_owner(self):
        owner = novara_api.normalize_owner(
            {
                "OwnerID": "OWN001",
                "Name": "Crystal Asset Management",
                "City": "Denver",
                "State": "CO",
                "ContactName": "Jane Doe",
                "ContactPhone": "303-555-0100",
            }
        )
        self.assertEqual(owner["ownerId"], "OWN001")
        self.assertEqual(owner["name"], "Crystal Asset Management")
        self.assertEqual(owner["location"], "Denver, CO")
        self.assertEqual(owner["contactName"], "Jane Doe")

    def test_owners_js_keeps_edit_mode_after_form_reset(self):
        source = Path(__file__).resolve().parent.joinpath("owners.js").read_text(
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
        save_owner = source.split("function saveOwner", 1)[1].split(
            "if (addBtn)", 1
        )[0]
        self.assertIn("currentMode === \"edit\"", save_owner)
        self.assertIn("api.updateOwner", save_owner)
        self.assertIn("api.createOwner", save_owner)

    def test_api_client_update_owner_uses_path_id(self):
        source = Path(__file__).resolve().parent.joinpath("api-client.js").read_text(
            encoding="utf-8"
        )
        update_owner = source.split("updateOwner:", 1)[1].split(
            "getOwners:", 1
        )[0]
        # Fall back if method order changes: take a generous slice.
        if "encodeURIComponent" not in update_owner:
            update_owner = source.split("updateOwner:", 1)[1][:400]
        self.assertIn("/api/owners/", update_owner)
        self.assertIn("encodeURIComponent", update_owner)

    def test_mgmt_companies_route(self):
        fake = {
            "table": "NOVARAMgmtCompanies",
            "count": 1,
            "mgmtCompanies": [
                {
                    "mgmtCompanyId": "MGT001",
                    "name": "Peak Property Management",
                    "city": "Denver",
                    "state": "CO",
                    "contactName": "Alex Rivera",
                    "contactPhone": "303-555-0200",
                }
            ],
        }
        with patch.object(novara_api, "scan_mgmt_companies", return_value=fake):
            status, payload = novara_api.route_request(
                "GET", "/api/mgmt-companies", {}
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["mgmtCompanies"][0]["mgmtCompanyId"], "MGT001")

    def test_create_mgmt_company_route(self):
        body = {
            "MgmtCompanyID": "MGT001",
            "Name": "Peak Property Management",
            "City": "Denver",
            "State": "CO",
        }
        fake = {
            "ok": True,
            "table": "NOVARAMgmtCompanies",
            "mgmtCompany": {"mgmtCompanyId": "MGT001"},
        }
        with patch.object(novara_api, "save_mgmt_company", return_value=fake) as mocked:
            with patch.object(
                novara_api,
                "parse_mgmt_company_payload",
                return_value=(body, None),
            ):
                status, payload = novara_api.route_request(
                    "POST", "/api/mgmt-companies", {}, body
                )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "create")

    def test_update_mgmt_company_route(self):
        body = {
            "MgmtCompanyID": "MGT001",
            "Name": "Peak Property Management",
            "ContactName": "Alex Rivera",
        }
        fake = {
            "ok": True,
            "table": "NOVARAMgmtCompanies",
            "mgmtCompany": {"mgmtCompanyId": "MGT001"},
        }
        with patch.object(novara_api, "save_mgmt_company", return_value=fake) as mocked:
            with patch.object(
                novara_api,
                "parse_mgmt_company_payload",
                return_value=(body, None),
            ):
                status, payload = novara_api.route_request(
                    "PUT", "/api/mgmt-companies", {}, body
                )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "update")

    def test_update_mgmt_company_by_id_route(self):
        body = {
            "Name": "Peak Property Management",
            "ContactName": "Alex Rivera",
        }
        fake = {
            "ok": True,
            "table": "NOVARAMgmtCompanies",
            "mgmtCompany": {"mgmtCompanyId": "MGT001"},
        }
        with patch.object(novara_api, "save_mgmt_company", return_value=fake) as mocked:
            status, payload = novara_api.route_request(
                "PUT", "/api/mgmt-companies/MGT001", {}, body
            )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "update")
        self.assertEqual(mocked.call_args.args[0]["MgmtCompanyID"], "MGT001")

    def test_update_mgmt_company_by_id_mismatch(self):
        status, payload = novara_api.route_request(
            "PUT",
            "/api/mgmt-companies/MGT001",
            {},
            {"MgmtCompanyID": "MGT002", "Name": "Mismatch"},
        )
        self.assertEqual(status, 400)
        self.assertIn("must match", payload["error"])

    def test_create_mgmt_company_validation(self):
        status, payload = novara_api.route_request(
            "POST", "/api/mgmt-companies", {}, {"City": "Denver"}
        )
        self.assertEqual(status, 400)
        self.assertIn("MgmtCompanyID", payload["error"])

    def test_parse_mgmt_company_payload_requires_name(self):
        item, error = novara_api.parse_mgmt_company_payload(
            {"MgmtCompanyID": "MGT001", "Address": "123 Main"}
        )
        self.assertIsNone(item)
        self.assertIn("Name", error)

    def test_parse_mgmt_company_payload_accepts_fields(self):
        item, error = novara_api.parse_mgmt_company_payload(
            {
                "mgmtCompanyId": "MGT002",
                "name": "Summit Management",
                "address": "100 Market St",
                "city": "Boulder",
                "state": "CO",
                "zip": "80301",
                "contactName": "Sam Lee",
                "contactEmail": "sam@example.com",
                "contactPhone": "303-555-0199",
                "notes": "Preferred billing contact",
            }
        )
        self.assertIsNone(error)
        self.assertEqual(item["MgmtCompanyID"], "MGT002")
        self.assertEqual(item["Name"], "Summit Management")
        self.assertEqual(item["ContactEmail"], "sam@example.com")
        self.assertEqual(item["Notes"], "Preferred billing contact")

    def test_normalize_mgmt_company(self):
        company = novara_api.normalize_mgmt_company(
            {
                "MgmtCompanyID": "MGT001",
                "Name": "Peak Property Management",
                "City": "Denver",
                "State": "CO",
                "ContactName": "Alex Rivera",
                "ContactPhone": "303-555-0200",
            }
        )
        self.assertEqual(company["mgmtCompanyId"], "MGT001")
        self.assertEqual(company["name"], "Peak Property Management")
        self.assertEqual(company["location"], "Denver, CO")
        self.assertEqual(company["contactName"], "Alex Rivera")

    def test_mgmt_companies_js_keeps_edit_mode_after_form_reset(self):
        source = Path(__file__).resolve().parent.joinpath(
            "mgmt-companies.js"
        ).read_text(encoding="utf-8")
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
        save_company = source.split("function saveMgmtCompany", 1)[1].split(
            "if (addBtn)", 1
        )[0]
        self.assertIn("currentMode === \"edit\"", save_company)
        self.assertIn("api.updateMgmtCompany", save_company)
        self.assertIn("api.createMgmtCompany", save_company)

    def test_api_client_update_mgmt_company_uses_path_id(self):
        source = Path(__file__).resolve().parent.joinpath("api-client.js").read_text(
            encoding="utf-8"
        )
        update_company = source.split("updateMgmtCompany:", 1)[1][:500]
        self.assertIn("/api/mgmt-companies/", update_company)
        self.assertIn("encodeURIComponent", update_company)

    def test_nav_includes_mgmt_companies(self):
        source = Path(__file__).resolve().parent.joinpath("nav.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('id: "mgmt-companies"', source)
        self.assertIn("mgmt-companies.html", source)
        self.assertIn("Management Companies", source)

    def test_leads_route(self):
        fake = {
            "table": "NOVARALeads",
            "count": 1,
            "leads": [
                {
                    "leadId": "LD001",
                    "companyName": "Vista Springs",
                    "stage": "New Lead",
                    "nextFollowUp": "2026-09-01",
                    "contactName": "Alex Rivera",
                }
            ],
        }
        with patch.object(novara_api, "scan_leads", return_value=fake):
            status, payload = novara_api.route_request("GET", "/api/leads", {})
        self.assertEqual(status, 200)
        self.assertEqual(payload["leads"][0]["leadId"], "LD001")

    def test_create_lead_route(self):
        body = {
            "LeadID": "LD001",
            "CompanyName": "Vista Springs",
            "Stage": "New Lead",
            "Source": "Website",
        }
        fake = {"ok": True, "table": "NOVARALeads", "lead": {"leadId": "LD001"}}
        with patch.object(novara_api, "save_lead", return_value=fake) as mocked:
            with patch.object(
                novara_api,
                "parse_lead_payload",
                return_value=(body, None),
            ):
                status, payload = novara_api.route_request(
                    "POST", "/api/leads", {}, body
                )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "create")

    def test_update_lead_route(self):
        body = {
            "LeadID": "LD001",
            "CompanyName": "Vista Springs",
            "Stage": "Contacted",
        }
        fake = {"ok": True, "table": "NOVARALeads", "lead": {"leadId": "LD001"}}
        with patch.object(novara_api, "save_lead", return_value=fake) as mocked:
            with patch.object(
                novara_api,
                "parse_lead_payload",
                return_value=(body, None),
            ):
                status, payload = novara_api.route_request(
                    "PUT", "/api/leads", {}, body
                )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "update")

    def test_update_lead_by_id_route(self):
        body = {
            "CompanyName": "Vista Springs",
            "Stage": "Qualified",
        }
        fake = {"ok": True, "table": "NOVARALeads", "lead": {"leadId": "LD001"}}
        with patch.object(novara_api, "save_lead", return_value=fake) as mocked:
            status, payload = novara_api.route_request(
                "PUT", "/api/leads/LD001", {}, body
            )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "update")
        self.assertEqual(mocked.call_args.args[0]["LeadID"], "LD001")

    def test_update_lead_by_id_mismatch(self):
        status, payload = novara_api.route_request(
            "PUT",
            "/api/leads/LD001",
            {},
            {"LeadID": "LD002", "CompanyName": "Mismatch"},
        )
        self.assertEqual(status, 400)
        self.assertIn("must match", payload["error"])

    def test_create_lead_validation(self):
        status, payload = novara_api.route_request(
            "POST", "/api/leads", {}, {"Stage": "New Lead"}
        )
        self.assertEqual(status, 400)
        self.assertIn("LeadID", payload["error"])

    def test_parse_lead_payload_requires_company_name(self):
        item, error = novara_api.parse_lead_payload(
            {"LeadID": "LD001", "ContactName": "Alex"}
        )
        self.assertIsNone(item)
        self.assertIn("CompanyName", error)

    def test_parse_lead_payload_accepts_fields(self):
        item, error = novara_api.parse_lead_payload(
            {
                "leadId": "LD002",
                "siteName": "Summit Residences",
                "contactName": "Sam Lee",
                "contactEmail": "sam@example.com",
                "contactPhone": "303-555-0199",
                "source": "Referral",
                "systemType": "DHW",
                "stage": "Qualified",
                "nextFollowUp": "2026-10-15",
                "assignedTo": "Steve Nold",
                "estimatedSavings": 12500.5,
                "notes": "Interested in pool retrofit",
            }
        )
        self.assertIsNone(error)
        self.assertEqual(item["LeadID"], "LD002")
        self.assertEqual(item["CompanyName"], "Summit Residences")
        self.assertEqual(item["Source"], "Referral")
        self.assertEqual(item["SystemType"], "DHW")
        self.assertEqual(item["Stage"], "Qualified")
        self.assertEqual(item["NextFollowUp"], "2026-10-15")
        self.assertEqual(item["AssignedTo"], "Steve Nold")
        self.assertEqual(item["EstimatedSavings"], Decimal("12500.5"))
        self.assertEqual(item["Notes"], "Interested in pool retrofit")

    def test_parse_lead_payload_rejects_bad_source(self):
        item, error = novara_api.parse_lead_payload(
            {
                "LeadID": "LD003",
                "CompanyName": "Bad Source Co",
                "Source": "Not A Real Source",
            }
        )
        self.assertIsNone(item)
        self.assertIn("Source", error)

    def test_parse_lead_payload_accepts_new_sources(self):
        for source in (
            "Carlos",
            "Cam",
            "Cold Call",
            "Katia",
            "PHEEP",
            "Steve",
        ):
            item, error = novara_api.parse_lead_payload(
                {
                    "LeadID": "LD004",
                    "CompanyName": "Source Check Co",
                    "Source": source,
                }
            )
            self.assertIsNone(error, source)
            self.assertEqual(item["Source"], source)

    def test_unknown_api_path_returns_clear_error(self):
        status, payload = novara_api.route_request("POST", "/api/missing", {})
        self.assertEqual(status, 404)
        self.assertIn("Unknown API path", payload["error"])
        self.assertIn("/api/leads", payload.get("hint", ""))

    def test_normalize_lead(self):
        lead = novara_api.normalize_lead(
            {
                "LeadID": "LD001",
                "CompanyName": "Vista Springs",
                "Stage": "New Lead",
                "NextFollowUp": "2026-09-01",
                "ContactName": "Alex Rivera",
                "EstimatedSavings": Decimal("1000"),
            }
        )
        self.assertEqual(lead["leadId"], "LD001")
        self.assertEqual(lead["companyName"], "Vista Springs")
        self.assertEqual(lead["siteName"], "Vista Springs")
        self.assertEqual(lead["stage"], "New Lead")
        self.assertEqual(lead["nextFollowUp"], "2026-09-01")
        self.assertEqual(lead["contactName"], "Alex Rivera")
        self.assertEqual(lead["estimatedSavings"], 1000)

    def test_leads_js_keeps_edit_mode_after_form_reset(self):
        source = Path(__file__).resolve().parent.joinpath("leads.js").read_text(
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
        save_lead = source.split("function saveLead", 1)[1].split(
            "if (addBtn)", 1
        )[0]
        self.assertIn("currentMode === \"edit\"", save_lead)
        self.assertIn("api.updateLead", save_lead)
        self.assertIn("api.createLead", save_lead)

    def test_api_client_update_lead_uses_path_id(self):
        source = Path(__file__).resolve().parent.joinpath("api-client.js").read_text(
            encoding="utf-8"
        )
        update_lead = source.split("updateLead:", 1)[1][:500]
        self.assertIn("/api/leads/", update_lead)
        self.assertIn("encodeURIComponent", update_lead)

    def test_nav_includes_leads(self):
        source = Path(__file__).resolve().parent.joinpath("nav.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('id: "leads"', source)
        self.assertIn("leads.html", source)
        self.assertIn("Leads", source)

    def test_leads_html_has_add_button_and_modal(self):
        source = Path(__file__).resolve().parent.joinpath("leads.html").read_text(
            encoding="utf-8"
        )
        self.assertIn('id="add-lead-btn"', source)
        self.assertIn('id="lead-modal"', source)
        self.assertIn("Next Follow-up", source)
        self.assertIn('id="filter-followup"', source)
        self.assertIn("Needs Follow-up", source)
        self.assertIn("Last Updated", source)
        self.assertIn('id="field-nextFollowUp"', source)
        self.assertIn("EstimatedSavings", source)
        source_select = source.split('id="field-source"', 1)[1].split("</select>", 1)[0]
        for option in (
            "Carlos",
            "Cam",
            "Cold Call",
            "Katia",
            "PHEEP",
            "Steve",
            "Referral",
            "Website",
            "Rinnai",
            "Trade Show",
            "Other",
        ):
            self.assertIn('value="' + option + '"', source_select)

    def test_leads_js_followup_urgency_and_filter(self):
        source = Path(__file__).resolve().parent.joinpath("leads.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("function followUpUrgency", source)
        self.assertIn("function needsFollowUp", source)
        self.assertIn("DUE_SOON_DAYS = 7", source)
        self.assertIn('followup-badge-overdue', source)
        self.assertIn('followup-badge-due-soon', source)
        self.assertIn("filterFollowUp", source)
        self.assertIn('followUpFilter === "needs"', source)
        self.assertIn("formatUpdatedAt", source)
        self.assertIn("setLastUpdatedDisplay", source)
        # Edit mode focuses Next Follow-up so the date is easy to update.
        open_modal = source.split("function openModal", 1)[1].split(
            "function closeModal", 1
        )[0]
        self.assertIn('field-nextFollowUp', open_modal)

    def test_health(self):
        status, payload = novara_api.route_request("GET", "/api/health", {})
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["table"], "NOVARAReadings")
        self.assertEqual(payload["sitesTable"], "NOVARASites")
        self.assertEqual(payload["systemsTable"], "NOVARASystems")
        self.assertEqual(payload["ownersTable"], "NOVARAOwners")
        self.assertEqual(payload["mgmtCompaniesTable"], "NOVARAMgmtCompanies")
        self.assertEqual(payload["leadsTable"], "NOVARALeads")

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
