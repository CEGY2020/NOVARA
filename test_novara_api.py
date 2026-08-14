#!/usr/bin/env python3
"""Unit tests for API routing (no live DynamoDB required)."""

from __future__ import annotations

import base64
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

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

    def test_reading_sort_key_helpers(self):
        self.assertEqual(
            novara_api.reading_sort_key("2026-08-05T07:00:00Z", "sys001"),
            "2026-08-05T07:00:00Z#SYS001",
        )
        self.assertEqual(
            novara_api.reading_sort_key("2026-08-05T07:00:00Z", None),
            "2026-08-05T07:00:00Z",
        )
        self.assertEqual(
            novara_api.split_reading_sort_key("2026-08-05T07:00:00Z#SYS002"),
            ("2026-08-05T07:00:00Z", "SYS002"),
        )
        self.assertEqual(
            novara_api.split_reading_sort_key("2026-08-05T07:00:00Z"),
            ("2026-08-05T07:00:00Z", None),
        )

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

    def test_normalize_site_exposes_stored_owner_id(self):
        """Owner ID on the site list comes from OwnerID, falling back to Owner."""
        from_owner_id = novara_api.normalize_site(
            {
                "SiteID": "SITE001",
                "SiteName": "Vista Springs",
                "Owner": "Crystal Asset Management",
                "OwnerID": "OWN015",
            }
        )
        self.assertEqual(from_owner_id["owner"], "Crystal Asset Management")
        self.assertEqual(from_owner_id["ownerId"], "OWN015")

        from_owner_field = novara_api.normalize_site(
            {
                "SiteID": "SITE002",
                "SiteName": "Highlander",
                "Owner": "OWN001",
            }
        )
        self.assertEqual(from_owner_field["ownerId"], "OWN001")

        numeric_id = novara_api.normalize_site(
            {
                "SiteID": "SITE003",
                "SiteName": "Numeric Owner",
                "OwnerID": "15",
            }
        )
        self.assertEqual(numeric_id["ownerId"], "15")

    def test_parse_site_payload_stores_owner_id(self):
        item, error = novara_api.parse_site_payload(
            {
                "SiteID": "SITE001",
                "SiteName": "Vista Springs",
                "Owner": "OWN015",
            }
        )
        self.assertIsNone(error)
        self.assertEqual(item["Owner"], "OWN015")
        self.assertEqual(item["OwnerID"], "OWN015")

        item, error = novara_api.parse_site_payload(
            {
                "SiteID": "SITE001",
                "SiteName": "Vista Springs",
                "Owner": "Crystal Asset Management",
                "OwnerID": "15",
            }
        )
        self.assertIsNone(error)
        self.assertEqual(item["Owner"], "Crystal Asset Management")
        self.assertEqual(item["OwnerID"], "15")

    def test_sites_table_includes_owner_id_column(self):
        """Sites list shows stored OwnerID next to the Owner name."""
        html = Path(__file__).resolve().parent.joinpath("sites.html").read_text(
            encoding="utf-8"
        )
        source = Path(__file__).resolve().parent.joinpath("sites.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("<th>Owner</th>", html)
        self.assertIn("<th>Owner ID</th>", html)
        owner_at = html.find("<th>Owner</th>")
        owner_id_at = html.find("<th>Owner ID</th>")
        self.assertNotEqual(owner_at, -1)
        self.assertNotEqual(owner_id_at, -1)
        self.assertLess(
            owner_at,
            owner_id_at,
            "Owner ID column should sit next to the Owner name column",
        )
        self.assertIn("siteOwnerId", source)
        self.assertIn("site.ownerId || site.owner", source)
        self.assertIn("OwnerID: ownerId", source)

    def test_owner_scope_id_and_site_filter(self):
        self.assertIsNone(novara_api.owner_scope_id(None))
        self.assertIsNone(novara_api.owner_scope_id({"role": "aem", "ownerId": "OWN015"}))
        self.assertEqual(
            novara_api.owner_scope_id({"role": "owner", "ownerId": "OWN015"}),
            "OWN015",
        )
        self.assertEqual(novara_api.owner_scope_id({"role": "owner"}), "")
        self.assertEqual(
            novara_api.owner_scope_id({"role": "contractor", "ownerId": "OWN001"}),
            "OWN001",
        )

        vista = {"siteId": "SITE001", "ownerId": "OWN015", "owner": "OWN015"}
        other = {"siteId": "SITE002", "ownerId": "OWN001", "owner": "OWN001"}
        named = {
            "siteId": "SITE003",
            "ownerId": "OWN015",
            "owner": "Crystal Asset Management",
        }
        self.assertTrue(novara_api.site_belongs_to_owner(vista, "OWN015"))
        self.assertTrue(novara_api.site_belongs_to_owner(named, "OWN015"))
        self.assertFalse(novara_api.site_belongs_to_owner(other, "OWN015"))

        filtered = novara_api.filter_sites_by_owner_id(
            {"table": "NOVARASites", "count": 3, "sites": [vista, other, named]},
            "OWN015",
        )
        self.assertEqual(filtered["count"], 2)
        self.assertEqual(
            [row["siteId"] for row in filtered["sites"]],
            ["SITE001", "SITE003"],
        )
        self.assertEqual(filtered["scopedOwnerId"], "OWN015")

        empty = novara_api.filter_sites_by_owner_id(
            {"table": "NOVARASites", "count": 3, "sites": [vista, other, named]},
            "",
        )
        self.assertEqual(empty["count"], 0)
        self.assertEqual(empty["sites"], [])

    def test_resolve_owner_id_from_email_company_or_stored_id(self):
        owners = {
            "owners": [
                {
                    "ownerId": "OWN015",
                    "name": "Crystal Asset Management",
                    "contactEmail": "pat@crystal.com",
                },
                {
                    "ownerId": "OWN010",
                    "name": "Carlos Enterprises",
                    "contactEmail": "carlos@example.com",
                },
            ]
        }
        with patch.object(novara_api, "scan_owners", return_value=owners):
            from_email = novara_api.enrich_user_owner_id(
                {"role": "owner", "email": "pat@crystal.com", "company": ""}
            )
            self.assertEqual(from_email["ownerId"], "OWN015")

            from_company = novara_api.enrich_user_owner_id(
                {
                    "role": "owner",
                    "email": "other@example.com",
                    "company": "Carlos Enterprises",
                }
            )
            self.assertEqual(from_company["ownerId"], "OWN010")

            stored = novara_api.enrich_user_owner_id(
                {"role": "owner", "ownerId": "OWN015", "email": "x@y.com"}
            )
            self.assertEqual(stored["ownerId"], "OWN015")

            aem = novara_api.enrich_user_owner_id(
                {"role": "aem", "email": "pat@crystal.com"}
            )
            self.assertEqual(aem["ownerId"], "")

    def test_sites_route_scopes_owner_and_not_aem(self):
        fake = {
            "table": "NOVARASites",
            "count": 2,
            "sites": [
                {
                    "siteId": "SITE001",
                    "name": "Vista Springs",
                    "ownerId": "OWN015",
                    "owner": "OWN015",
                },
                {
                    "siteId": "SITE002",
                    "name": "Highlander",
                    "ownerId": "OWN001",
                    "owner": "OWN001",
                },
            ],
        }
        owner_user = {
            "userId": "USR009",
            "role": "owner",
            "ownerId": "OWN015",
            "email": "pat@example.com",
            "status": "Active",
        }
        aem_user = {
            "userId": "USR001",
            "role": "aem",
            "ownerId": "",
            "email": "admin@example.com",
            "status": "Active",
        }
        with patch.object(novara_api, "scan_sites", return_value=fake), patch.object(
            novara_api, "resolve_session_token", return_value=owner_user
        ):
            status, payload = novara_api.route_request(
                "GET",
                "/api/sites",
                {},
                None,
                headers={"Authorization": "Bearer USR009.secret"},
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["sites"][0]["siteId"], "SITE001")
        self.assertEqual(payload["scopedOwnerId"], "OWN015")

        with patch.object(novara_api, "scan_sites", return_value=fake), patch.object(
            novara_api, "resolve_session_token", return_value=aem_user
        ):
            status, payload = novara_api.route_request(
                "GET",
                "/api/sites",
                {},
                None,
                headers={"Authorization": "Bearer USR001.secret"},
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 2)
        self.assertNotIn("scopedOwnerId", payload)

        unlinked = dict(owner_user)
        unlinked["ownerId"] = ""
        with patch.object(novara_api, "scan_sites", return_value=fake), patch.object(
            novara_api, "resolve_session_token", return_value=unlinked
        ):
            status, payload = novara_api.route_request(
                "GET",
                "/api/sites",
                {},
                None,
                headers={"Authorization": "Bearer USR009.secret"},
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 0)
        self.assertEqual(payload["sites"], [])

    def test_owner_site_write_is_forced_to_own_owner_id(self):
        owner_user = {
            "userId": "USR009",
            "role": "owner",
            "ownerId": "OWN015",
            "status": "Active",
        }
        saved = {"ok": True, "site": {"siteId": "SITE009"}}
        with patch.object(
            novara_api, "resolve_session_token", return_value=owner_user
        ), patch.object(novara_api, "save_site", return_value=saved) as mocked_save:
            status, payload = novara_api.route_request(
                "POST",
                "/api/sites",
                {},
                {
                    "SiteID": "SITE009",
                    "SiteName": "New Property",
                    "Owner": "OWN001",
                    "OwnerID": "OWN001",
                },
                headers={"Authorization": "Bearer USR009.secret"},
            )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        written = mocked_save.call_args.args[0]
        self.assertEqual(written["OwnerID"], "OWN015")
        self.assertEqual(written["Owner"], "OWN015")

        with patch.object(
            novara_api, "resolve_session_token", return_value=owner_user
        ), patch.object(
            novara_api,
            "get_site_item",
            return_value={"siteId": "SITE002", "ownerId": "OWN001"},
        ):
            status, payload = novara_api.route_request(
                "PUT",
                "/api/sites",
                {},
                {"SiteID": "SITE002", "SiteName": "Not Yours"},
                headers={"Authorization": "Bearer USR009.secret"},
            )
        self.assertEqual(status, 403)

    def test_sites_page_has_owner_empty_state_and_keeps_aem_forms(self):
        html = Path(__file__).resolve().parent.joinpath("sites.html").read_text(
            encoding="utf-8"
        )
        source = Path(__file__).resolve().parent.joinpath("sites.js").read_text(
            encoding="utf-8"
        )
        auth = Path(__file__).resolve().parent.joinpath("auth.js").read_text(
            encoding="utf-8"
        )
        nav = Path(__file__).resolve().parent.joinpath("nav.js").read_text(
            encoding="utf-8"
        )
        owner_home = Path(__file__).resolve().parent.joinpath(
            "owner-home.html"
        ).read_text(encoding="utf-8")
        owner_js = Path(__file__).resolve().parent.joinpath(
            "owner-home.js"
        ).read_text(encoding="utf-8")
        self.assertIn("No properties linked to your account yet", html)
        self.assertIn("sites-empty-state", html)
        self.assertIn("OWNER_EMPTY_MESSAGE", source)
        self.assertIn("filterSitesForCurrentUser", source)
        self.assertIn("isOwnerScoped", source)
        self.assertIn("addBtn.hidden = scoped", source)
        self.assertIn("ownerSelect.disabled = Boolean(isOwnerScoped())", source)
        self.assertIn('id="field-ownerIdDisplay"', html)
        self.assertIn("syncLookupIdDisplay", source)
        self.assertIn("ownerId", auth)
        self.assertIn("isOwnerUser", auth)
        self.assertIn("getOwnerId", auth)
        self.assertIn('href: "sites.html"', nav)
        self.assertIn("No properties linked to your account yet", owner_home)
        self.assertIn("owner-sites-empty", owner_home)
        self.assertIn("OWNER_EMPTY_MESSAGE", owner_js)
        self.assertIn("api.getSites", owner_js)

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
        self.assertIn("populateOwnerOptions(site.ownerId || site.owner)", source)
        self.assertIn("populateMgmtCompanyOptions(site.mgmtCompany)", source)
        self.assertIn('id="field-ownerIdDisplay"', html)
        self.assertIn('id="field-mgmtCompanyIdDisplay"', html)
        self.assertIn("readonly", html.split('id="field-ownerIdDisplay"', 1)[1].split(">", 1)[0])
        self.assertIn(
            "readonly",
            html.split('id="field-mgmtCompanyIdDisplay"', 1)[1].split(">", 1)[0],
        )
        self.assertIn("syncLookupIdDisplay", source)
        self.assertIn("ownerSelect.addEventListener(\"change\"", source)
        self.assertIn("mgmtCompanySelect.addEventListener(\"change\"", source)

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
        self.assertIn("closeModal()", save_system)
        self.assertIn("loadSystems()", save_system)

    def test_systems_table_includes_site_and_site_id_columns(self):
        """Systems list shows Site name next to stored SiteID, like Sites/Owner ID."""
        html = Path(__file__).resolve().parent.joinpath("systems.html").read_text(
            encoding="utf-8"
        )
        source = Path(__file__).resolve().parent.joinpath("systems.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("<th>System ID</th>", html)
        self.assertIn("<th>Site</th>", html)
        self.assertIn("<th>Site ID</th>", html)
        self.assertIn("<th>System Name</th>", html)
        self.assertIn("<th>System Type</th>", html)
        self.assertIn("<th>Status</th>", html)
        self.assertIn('id="add-system-btn"', html)
        self.assertIn("+ Add System", html)
        site_at = html.find("<th>Site</th>")
        site_id_at = html.find("<th>Site ID</th>")
        name_at = html.find("<th>System Name</th>")
        self.assertLess(site_at, site_id_at)
        self.assertLess(site_id_at, name_at)
        self.assertIn("systemSiteId", source)
        self.assertIn("systemSiteName", source)

    def test_systems_form_uses_site_dropdown_and_site_id_display(self):
        """Site is a name dropdown that stores SiteID, with a readonly SiteID field."""
        html = Path(__file__).resolve().parent.joinpath("systems.html").read_text(
            encoding="utf-8"
        )
        source = Path(__file__).resolve().parent.joinpath("systems.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('<select id="field-siteId" name="SiteID" required>', html)
        self.assertIn(">Site <em>*</em></span>", html)
        self.assertIn('id="field-siteIdDisplay"', html)
        self.assertIn(
            "readonly",
            html.split('id="field-siteIdDisplay"', 1)[1].split(">", 1)[0],
        )
        self.assertIn('id="field-systemId"', html)
        self.assertIn("readonly", html.split('id="field-systemId"', 1)[1].split(">", 1)[0])
        self.assertIn("nextSystemId", source)
        self.assertIn("populateSiteOptions", source)
        self.assertIn("syncLookupIdDisplay", source)
        self.assertIn("resolveLookupId", source)
        self.assertIn("siteSelect.addEventListener(\"change\"", source)
        self.assertIn("api.getSites()", source)
        self.assertIn("siteOptionLabel", source)
        self.assertNotIn(' + " (" + id + ")"', source)
        self.assertIn("openSystemModal", source)
        self.assertIn('openSystemModal("edit"', source)

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
        self.assertEqual(item["Status"], "Active")

    def test_parse_owner_payload_accepts_inactive_status(self):
        item, error = novara_api.parse_owner_payload(
            {"OwnerID": "OWN002", "Name": "Summit Holdings", "Status": "Inactive"}
        )
        self.assertIsNone(error)
        self.assertEqual(item["Status"], "Inactive")

    def test_parse_owner_payload_rejects_invalid_status(self):
        item, error = novara_api.parse_owner_payload(
            {"OwnerID": "OWN002", "Name": "Summit Holdings", "Status": "Paused"}
        )
        self.assertIsNone(item)
        self.assertIn("Status", error)

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
        self.assertEqual(owner["status"], "Active")

    def test_normalize_owner_preserves_inactive_status(self):
        owner = novara_api.normalize_owner(
            {
                "OwnerID": "OWN001",
                "Name": "Crystal Asset Management",
                "Status": "Inactive",
            }
        )
        self.assertEqual(owner["status"], "Inactive")

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

    def test_owners_page_has_status_filter_and_actions(self):
        html = Path(__file__).resolve().parent.joinpath("owners.html").read_text(
            encoding="utf-8"
        )
        source = Path(__file__).resolve().parent.joinpath("owners.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('id="owners-filter-active"', html)
        self.assertIn('id="owners-filter-inactive"', html)
        self.assertIn("<th>Status</th>", html)
        self.assertIn("deactivate-owner-btn", source)
        self.assertIn("activate-owner-btn", source)
        self.assertIn("delete-owner-btn", source)
        self.assertIn('setOwnerStatus(deactivateId, "Inactive")', source)
        self.assertIn('setOwnerStatus(activateId, "Active")', source)
        self.assertIn("api.deleteOwner", source)
        self.assertIn(
            "This owner is still linked to one or more sites. Reassign those sites first.",
            source,
        )
        self.assertIn('statusFilter = "Active"', source)

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

    def test_api_client_exposes_delete_owner(self):
        source = Path(__file__).resolve().parent.joinpath("api-client.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("deleteOwner:", source)
        delete_owner = source.split("deleteOwner:", 1)[1][:400]
        self.assertIn("/api/owners/", delete_owner)
        self.assertIn('"DELETE"', delete_owner)

    def test_delete_owner_route(self):
        fake = {
            "ok": True,
            "table": "NOVARAOwners",
            "deleted": True,
            "ownerId": "OWN001",
        }
        with patch.object(novara_api, "delete_owner", return_value=fake) as mocked:
            status, payload = novara_api.route_request(
                "DELETE", "/api/owners/OWN001", {}
            )
        self.assertEqual(status, 200)
        self.assertTrue(payload["deleted"])
        mocked.assert_called_once_with("OWN001")

    def test_delete_owner_route_blocks_linked_sites(self):
        with patch.object(
            novara_api,
            "delete_owner",
            side_effect=ValueError(novara_api.OWNER_LINKED_SITES_ERROR),
        ):
            status, payload = novara_api.route_request(
                "DELETE", "/api/owners/OWN001", {}
            )
        self.assertEqual(status, 409)
        self.assertEqual(
            payload["error"],
            "This owner is still linked to one or more sites. Reassign those sites first.",
        )

    def test_delete_owner_checks_linked_sites(self):
        fake_table = MagicMock()
        fake_table.get_item.return_value = {
            "Item": {"OwnerID": "OWN001", "Name": "Acme"}
        }
        with patch.object(novara_api, "ensure_owners_table", return_value="NOVARAOwners"):
            with patch.object(novara_api, "dynamodb_table", return_value=fake_table):
                with patch.object(
                    novara_api,
                    "scan_sites",
                    return_value={
                        "sites": [
                            {
                                "siteId": "SITE001",
                                "ownerId": "OWN001",
                                "owner": "OWN001",
                            }
                        ]
                    },
                ):
                    with self.assertRaises(ValueError) as ctx:
                        novara_api.delete_owner("OWN001")
        self.assertEqual(str(ctx.exception), novara_api.OWNER_LINKED_SITES_ERROR)
        fake_table.delete_item.assert_not_called()

    def test_delete_owner_when_no_sites_linked(self):
        fake_table = MagicMock()
        fake_table.get_item.return_value = {
            "Item": {"OwnerID": "OWN001", "Name": "Acme"}
        }
        with patch.object(novara_api, "ensure_owners_table", return_value="NOVARAOwners"):
            with patch.object(novara_api, "dynamodb_table", return_value=fake_table):
                with patch.object(
                    novara_api, "scan_sites", return_value={"sites": []}
                ):
                    result = novara_api.delete_owner("OWN001")
        self.assertTrue(result["deleted"])
        self.assertEqual(result["ownerId"], "OWN001")
        fake_table.delete_item.assert_called_once()

    def test_sites_owner_dropdown_only_lists_active_owners(self):
        source = Path(__file__).resolve().parent.joinpath("sites.js").read_text(
            encoding="utf-8"
        )
        populate = source.split("function populateOwnerOptions", 1)[1].split(
            "function populateMgmtCompanyOptions", 1
        )[0]
        self.assertIn("ownerIsActive", source)
        self.assertIn("ownerIsActive(owner)", populate)

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
                "systemType": "DHW NG",
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
        self.assertEqual(item["SystemType"], "DHW NG")
        self.assertEqual(item["Stage"], "Qualified")
        self.assertEqual(item["NextFollowUp"], "2026-10-15")
        self.assertEqual(item["AssignedTo"], "Steve Nold")
        self.assertEqual(item["EstimatedSavings"], Decimal("12500.5"))
        self.assertEqual(item["Notes"], "Interested in pool retrofit")

    def test_parse_lead_payload_maps_legacy_dhw_and_accepts_dhw_kw(self):
        legacy, legacy_error = novara_api.parse_lead_payload(
            {
                "LeadID": "LD010",
                "CompanyName": "Legacy DHW Co",
                "SystemType": "DHW",
            }
        )
        self.assertIsNone(legacy_error)
        self.assertEqual(legacy["SystemType"], "DHW NG")

        kw_item, kw_error = novara_api.parse_lead_payload(
            {
                "LeadID": "LD011",
                "CompanyName": "DHW kW Co",
                "SystemType": "DHW kW",
            }
        )
        self.assertIsNone(kw_error)
        self.assertEqual(kw_item["SystemType"], "DHW kW")

    def test_normalize_lead_maps_legacy_dhw(self):
        lead = novara_api.normalize_lead(
            {"LeadID": "LD012", "CompanyName": "Old DHW", "SystemType": "DHW"}
        )
        self.assertEqual(lead["systemType"], "DHW NG")

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
        system_select = source.split('id="field-systemType"', 1)[1].split(
            "</select>", 1
        )[0]
        self.assertIn('value="DHW NG"', system_select)
        self.assertIn('value="DHW kW"', system_select)
        self.assertIn('value="Pool"', system_select)
        self.assertIn('value="HVAC"', system_select)
        self.assertIn('value="Other"', system_select)
        self.assertNotIn('value="DHW">', system_select)
        self.assertIn("phone-format.js", source)

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

    def test_users_list_route(self):
        fake = {
            "table": "NOVARAUsers",
            "count": 1,
            "users": [
                {
                    "userId": "USR001",
                    "fullName": "Pat Pending",
                    "email": "pat@example.com",
                    "role": "owner",
                    "status": "Pending",
                }
            ],
            "preapprovedEmails": ["admin@novara.com"],
        }
        with patch.object(novara_api, "scan_users", return_value=fake) as mocked:
            status, payload = novara_api.route_request(
                "GET", "/api/users", {"status": ["Pending"]}
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["users"][0]["userId"], "USR001")
        mocked.assert_called_once_with(status="Pending")

    def test_signup_route_pending_and_preapproved(self):
        pending_body = {
            "FullName": "Pat Pending",
            "Email": "pat.pending@example.com",
            "Password": "Password1!",
            "Role": "owner",
            "Company": "Acme",
        }
        fake_pending = {
            "ok": True,
            "table": "NOVARAUsers",
            "user": {
                "userId": "USR001",
                "email": "pat.pending@example.com",
                "status": "Pending",
            },
            "message": "pending",
        }
        with patch.object(
            novara_api, "create_user_from_signup", return_value=fake_pending
        ) as mocked:
            status, payload = novara_api.route_request(
                "POST", "/api/users/signup", {}, pending_body
            )
        self.assertEqual(status, 201)
        self.assertEqual(payload["user"]["status"], "Pending")
        mocked.assert_called_once()
        created_item = mocked.call_args.args[0]
        self.assertEqual(created_item["Status"], "Pending")
        self.assertTrue(created_item["PasswordHash"].startswith("pbkdf2_sha256$"))
        self.assertNotIn("Password", created_item)

        item, error = novara_api.parse_signup_payload(
            {
                "FullName": "Admin User",
                "Email": "admin@novara.com",
                "Password": "Password1!",
                "Role": "aem",
            }
        )
        self.assertIsNone(error)
        self.assertEqual(item["Status"], "Pending")

        with patch.object(novara_api, "is_email_preapproved", return_value=True), patch.object(
            novara_api, "find_user_by_email", return_value=None
        ), patch.object(novara_api, "ensure_users_table", return_value="NOVARAUsers"), patch.object(
            novara_api, "next_user_id", return_value="USR099"
        ), patch.object(
            novara_api, "dynamodb_table"
        ) as mocked_table, patch.object(
            novara_api, "notify_user_welcome", return_value={"ok": True, "mode": "log"}
        ) as mocked_welcome:
            table = mocked_table.return_value
            table.put_item.return_value = {}
            result = novara_api.create_user_from_signup(item)
        self.assertEqual(result["user"]["status"], "Active")
        mocked_welcome.assert_called_once()

    def test_signup_validation(self):
        status, payload = novara_api.route_request(
            "POST",
            "/api/users/signup",
            {},
            {"Email": "bad", "Password": "short", "Role": "owner"},
        )
        self.assertEqual(status, 400)
        self.assertIn("FullName", payload["error"])

        status, payload = novara_api.route_request(
            "POST",
            "/api/users/signup",
            {},
            {
                "FullName": "Pat",
                "Email": "pat@example.com",
                "Password": "short",
                "Role": "owner",
            },
        )
        self.assertEqual(status, 400)
        self.assertIn("Password", payload["error"])

    def test_login_requires_active_status(self):
        pending_user = {
            "UserID": "USR001",
            "FullName": "Pat Pending",
            "Email": "pat@example.com",
            "Role": "owner",
            "Status": "Pending",
            "PasswordHash": novara_api.hash_password("Password1!"),
        }
        with patch.object(novara_api, "find_user_by_email", return_value=pending_user):
            status, payload = novara_api.route_request(
                "POST",
                "/api/users/login",
                {},
                {"Email": "pat@example.com", "Password": "Password1!"},
            )
        self.assertEqual(status, 403)
        self.assertIn("pending", payload["error"].lower())

        active_user = dict(pending_user)
        active_user["Status"] = "Active"
        fake_session = {
            "token": "USR001.session-token",
            "expiresAt": "2099-01-01T00:00:00Z",
        }
        with patch.object(novara_api, "find_user_by_email", return_value=active_user), patch.object(
            novara_api, "create_session_for_user", return_value=fake_session
        ) as mocked_session, patch.object(
            novara_api, "scan_owners", return_value={"owners": []}
        ):
            status, payload = novara_api.route_request(
                "POST",
                "/api/users/login",
                {},
                {"Email": "pat@example.com", "Password": "Password1!"},
            )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["user"]["status"], "Active")
        self.assertEqual(payload["user"]["ownerId"], "")
        self.assertEqual(payload["token"], "USR001.session-token")
        self.assertEqual(payload["expiresAt"], "2099-01-01T00:00:00Z")
        self.assertNotIn("passwordHash", payload["user"])
        mocked_session.assert_called_once_with("USR001")

        with patch.object(novara_api, "find_user_by_email", return_value=active_user):
            status, payload = novara_api.route_request(
                "POST",
                "/api/users/login",
                {},
                {"Email": "pat@example.com", "Password": "WrongPass1!"},
            )
        self.assertEqual(status, 403)
        self.assertIn("Invalid", payload["error"])

    def test_signup_alias_post_users(self):
        fake = {
            "ok": True,
            "table": "NOVARAUsers",
            "user": {"userId": "USR002", "status": "Pending"},
            "message": "pending",
        }
        with patch.object(novara_api, "create_user_from_signup", return_value=fake):
            status, payload = novara_api.route_request(
                "POST",
                "/api/users",
                {},
                {
                    "FullName": "Alias User",
                    "Email": "alias@example.com",
                    "Password": "Password1!",
                    "Role": "sales",
                },
            )
        self.assertEqual(status, 201)
        self.assertEqual(payload["user"]["userId"], "USR002")

    def test_session_route_validates_bearer_token(self):
        active_user = {
            "UserID": "USR001",
            "FullName": "Active User",
            "Email": "active@example.com",
            "Role": "aem",
            "Status": "Active",
            "SessionTokenHash": novara_api._hash_session_token("USR001.secret"),
            "SessionExpiresAt": "2099-01-01T00:00:00Z",
        }
        with patch.object(novara_api, "find_user_by_id", return_value=active_user):
            status, payload = novara_api.route_request(
                "GET",
                "/api/users/session",
                {},
                None,
                headers={"Authorization": "Bearer USR001.secret"},
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["user"]["userId"], "USR001")

        with patch.object(novara_api, "find_user_by_id", return_value=active_user):
            status, payload = novara_api.route_request(
                "GET",
                "/api/users/session",
                {},
                None,
                headers={"Authorization": "Bearer USR001.wrong"},
            )
        self.assertEqual(status, 401)

    def test_update_user_status_route(self):
        fake = {
            "ok": True,
            "table": "NOVARAUsers",
            "user": {"userId": "USR001", "status": "Active"},
            "message": "User status set to Active.",
        }
        with patch.object(
            novara_api, "update_user_status", return_value=fake
        ) as mocked:
            status, payload = novara_api.route_request(
                "PUT",
                "/api/users/USR001/status",
                {},
                {"Status": "Active"},
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["user"]["status"], "Active")
        mocked.assert_called_once_with(
            "USR001",
            "Active",
            rejection_reason=None,
            send_rejection_email=True,
            decision_token=None,
        )

        fake_reject = {
            "ok": True,
            "table": "NOVARAUsers",
            "user": {
                "userId": "USR001",
                "status": "Rejected",
                "rejectionReason": "Incomplete company info",
            },
            "message": "User status set to Rejected.",
        }
        with patch.object(
            novara_api, "update_user_status", return_value=fake_reject
        ) as mocked_reject:
            status, payload = novara_api.route_request(
                "PUT",
                "/api/users/USR001/status",
                {},
                {
                    "Status": "Rejected",
                    "RejectionReason": "Incomplete company info",
                    "SendRejectionEmail": False,
                },
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["user"]["status"], "Rejected")
        mocked_reject.assert_called_once_with(
            "USR001",
            "Rejected",
            rejection_reason="Incomplete company info",
            send_rejection_email=False,
            decision_token=None,
        )

    def test_preapproved_routes(self):
        with patch.object(
            novara_api,
            "list_preapproved_emails",
            return_value=["admin@novara.com"],
        ):
            status, payload = novara_api.route_request(
                "GET", "/api/users/preapproved", {}
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["preapprovedEmails"], ["admin@novara.com"])

        with patch.object(
            novara_api,
            "add_preapproved_email",
            return_value={
                "ok": True,
                "email": "new@novara.com",
                "preapprovedEmails": ["admin@novara.com", "new@novara.com"],
            },
        ) as mocked_add:
            status, payload = novara_api.route_request(
                "POST",
                "/api/users/preapproved",
                {},
                {"Email": "new@novara.com"},
            )
        self.assertEqual(status, 201)
        mocked_add.assert_called_once_with("new@novara.com")

        with patch.object(
            novara_api,
            "remove_preapproved_email",
            return_value={
                "ok": True,
                "email": "new@novara.com",
                "preapprovedEmails": ["admin@novara.com"],
            },
        ) as mocked_remove:
            status, payload = novara_api.route_request(
                "DELETE", "/api/users/preapproved/new@novara.com", {}
            )
        self.assertEqual(status, 200)
        mocked_remove.assert_called_once_with("new@novara.com")

    def test_admin_alert_email_includes_applicant_details(self):
        user = {
            "userId": "USR010",
            "fullName": "Pat Pending",
            "email": "pat@example.com",
            "role": "owner",
            "company": "Acme Co",
            "createdAt": "2026-08-11T12:00:00Z",
        }
        subject, text, html_body = novara_api.build_admin_alert_email(
            user, decision_token="secret-token"
        )
        self.assertIn("Pat Pending", subject)
        self.assertIn("pat@example.com", text)
        self.assertIn("Acme Co", text)
        self.assertIn("Owner", text)
        self.assertIn("Approve", html_body)
        self.assertIn("Reject", html_body)
        self.assertIn("account-decision.html", text)
        self.assertIn("secret-token", text)
        self.assertIn("08-11-26 12:00 PM", text)
        self.assertIn("08-11-26 12:00 PM", html_body)

    def test_format_signup_date_uses_mm_dd_yy(self):
        self.assertEqual(
            novara_api._format_signup_date("2026-08-14T09:44:00Z"),
            "08-14-26 09:44 AM",
        )
        self.assertEqual(
            novara_api._format_signup_date("2026-08-14T14:30:00Z"),
            "08-14-26 02:30 PM",
        )
        self.assertEqual(novara_api._format_signup_date("2026-08-14"), "08-14-26")
        self.assertEqual(novara_api._format_signup_date(""), "—")

    def test_datetime_pages_include_shared_formatter(self):
        root = Path(__file__).resolve().parent
        pages = [
            "system-detail.html",
            "energy-savings.html",
            "users.html",
            "bills.html",
            "leads.html",
        ]
        for name in pages:
            source = root.joinpath(name).read_text(encoding="utf-8")
            self.assertIn("formatDateTime.js", source, name)

    def test_reject_requires_reason(self):
        existing = {
            "UserID": "USR001",
            "FullName": "Pat Pending",
            "Email": "pat@example.com",
            "Role": "owner",
            "Status": "Pending",
        }
        with patch.object(novara_api, "find_user_by_id", return_value=existing):
            with self.assertRaises(ValueError) as ctx:
                novara_api.update_user_status("USR001", "Rejected")
        self.assertIn("RejectionReason", str(ctx.exception))

    def test_password_hash_roundtrip(self):
        stored = novara_api.hash_password("SecretPass1!")
        self.assertTrue(novara_api.verify_password("SecretPass1!", stored))
        self.assertFalse(novara_api.verify_password("other", stored))

    def test_next_user_id(self):
        self.assertEqual(novara_api.next_user_id([]), "USR001")
        self.assertEqual(
            novara_api.next_user_id([{"UserID": "USR002"}, {"UserID": "USR010"}]),
            "USR011",
        )

    def test_directory_links_to_signup(self):
        source = Path(__file__).resolve().parent.joinpath("directory.html").read_text(
            encoding="utf-8"
        )
        self.assertIn("signup.html?role=aem", source)
        self.assertIn("signup.html?role=owner", source)
        self.assertIn('href="login.html"', source)

    def test_nav_includes_users_for_aem(self):
        source = Path(__file__).resolve().parent.joinpath("nav.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('id: "users"', source)
        self.assertIn("users.html", source)
        # Users link is shown only for logged-in AEM accounts.
        self.assertIn("isLoggedInAem", source)
        self.assertIn('item.id !== "users"', source)
        self.assertNotIn("TEMPORARY bootstrap", source)

    def test_users_html_has_pending_table(self):
        source = Path(__file__).resolve().parent.joinpath("users.html").read_text(
            encoding="utf-8"
        )
        users_js = Path(__file__).resolve().parent.joinpath("users.js").read_text(
            encoding="utf-8"
        )
        login_html = Path(__file__).resolve().parent.joinpath("login.html").read_text(
            encoding="utf-8"
        )
        self.assertIn("pending-users-tbody", source)
        self.assertIn("preapproved-list", source)
        self.assertIn("reject-modal", source)
        self.assertNotIn("users-bootstrap-banner", source)
        self.assertIn("Approve", users_js)
        self.assertIn("rejectionReason", users_js)
        self.assertIn("addPreapprovedEmail", users_js)
        self.assertIn("ensureAemAccess", users_js)
        self.assertIn("Access denied", users_js)
        self.assertNotIn("ALLOW_USERS_ADMIN_BOOTSTRAP", users_js)
        self.assertNotIn("Approve pending users", login_html)
        self.assertNotIn("bootstrap-admin-link", login_html)

    def test_api_client_exposes_user_methods(self):
        source = Path(__file__).resolve().parent.joinpath("api-client.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("signupUser", source)
        self.assertIn("loginUser", source)
        self.assertIn("getSession", source)
        self.assertIn("updateUserStatus", source)
        self.assertIn("getPreapprovedEmails", source)
        self.assertIn("addPreapprovedEmail", source)
        self.assertIn("removePreapprovedEmail", source)
        self.assertIn("/api/users/signup", source)
        self.assertIn("/api/users/login", source)
        self.assertIn("/api/users/preapproved", source)
        self.assertIn("Authorization", source)

    def test_account_decision_page_exists(self):
        html = Path(__file__).resolve().parent.joinpath(
            "account-decision.html"
        ).read_text(encoding="utf-8")
        js = Path(__file__).resolve().parent.joinpath(
            "account-decision.js"
        ).read_text(encoding="utf-8")
        self.assertIn("decisionActions", html)
        self.assertIn("decisionToken", js)
        self.assertIn("updateUserStatus", js)

    def test_login_page_wires_remember_me_and_token(self):
        app_source = Path(__file__).resolve().parent.joinpath("app.js").read_text(
            encoding="utf-8"
        )
        auth_source = Path(__file__).resolve().parent.joinpath("auth.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("NovaraApi.loginUser", app_source)
        self.assertIn("rememberMe", app_source)
        self.assertIn("result.token", app_source)
        self.assertIn("localStorage", auth_source)
        self.assertIn("TOKEN_KEY", auth_source)

    def test_health(self):
        status, payload = novara_api.route_request("GET", "/api/health", {})
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["table"], "NOVARAReadings")
        self.assertEqual(payload["sitesTable"], "NOVARASites")
        self.assertEqual(payload["systemsTable"], "NOVARASystems")
        self.assertEqual(payload["photosTable"], "NOVARAPhotos")
        self.assertIn(payload["photosStorage"], ("s3", "local"))
        self.assertEqual(payload["ownersTable"], "NOVARAOwners")
        self.assertEqual(payload["mgmtCompaniesTable"], "NOVARAMgmtCompanies")
        self.assertEqual(payload["leadsTable"], "NOVARALeads")
        self.assertEqual(payload["usersTable"], "NOVARAUsers")
        self.assertEqual(payload["preapprovedTable"], "NOVARAPreapprovedEmails")
        self.assertEqual(payload["settingsTable"], "NOVARASettings")
        self.assertEqual(payload["utilityBillsTable"], "NOVARAUtilityBills")

    def test_photos_list_route(self):
        fake = {
            "table": "NOVARAPhotos",
            "storage": "local",
            "count": 1,
            "siteId": "SITE001",
            "systemId": "",
            "photos": [
                {
                    "photoId": "PHOABC123",
                    "siteId": "SITE001",
                    "systemId": "",
                    "photoType": "Property",
                    "caption": "Front elevation",
                    "s3Key": "sites/SITE001/PHOABC123/front.jpg",
                    "url": "/api/photos/PHOABC123/content",
                    "uploadedAt": "2026-08-12T00:00:00Z",
                    "uploadedBy": "USR001",
                }
            ],
        }
        with patch.object(novara_api, "list_photos", return_value=fake) as mocked:
            status, payload = novara_api.route_request(
                "GET", "/api/photos", {"siteId": ["SITE001"]}
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["photos"][0]["photoId"], "PHOABC123")
        mocked.assert_called_once_with(site_id="SITE001", system_id="")

    def test_photos_create_route(self):
        body = {
            "SiteID": "SITE001",
            "PhotoType": "Property",
            "Caption": "Lobby",
            "ContentType": "image/jpeg",
            "FileName": "lobby.jpg",
        }
        item = {
            "PhotoID": "PHOTEST001",
            "SiteID": "SITE001",
            "PhotoType": "Property",
            "Caption": "Lobby",
            "S3Key": "sites/SITE001/PHOTEST001/lobby.jpg",
            "ContentType": "image/jpeg",
            "FileName": "lobby.jpg",
        }
        fake = {
            "ok": True,
            "table": "NOVARAPhotos",
            "storage": "local",
            "photo": {"photoId": "PHOTEST001", "siteId": "SITE001"},
            "uploadUrl": "/api/photos/upload/sites/SITE001/PHOTEST001/lobby.jpg",
            "uploadMethod": "PUT",
            "uploadHeaders": {"Content-Type": "image/jpeg"},
        }
        with patch.object(novara_api, "save_photo", return_value=fake) as mocked:
            with patch.object(
                novara_api, "parse_photo_payload", return_value=(item, None)
            ):
                status, payload = novara_api.route_request(
                    "POST", "/api/photos", {}, body
                )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertIn("uploadUrl", payload)
        mocked.assert_called_once_with(item)

    def test_photos_create_validation(self):
        status, payload = novara_api.route_request(
            "POST", "/api/photos", {}, {"PhotoType": "Property"}
        )
        self.assertEqual(status, 400)
        self.assertIn("SiteID", payload["error"])

    def _build_multipart(
        self, fields: dict[str, str], files: list[tuple[str, str, str, bytes]]
    ) -> tuple[str, bytes]:
        boundary = "----NovaraTestBoundary7MA4YWxkTrZu0gW"
        chunks: list[bytes] = []
        for name, value in fields.items():
            chunks.append(f"--{boundary}\r\n".encode("utf-8"))
            chunks.append(
                (
                    f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                    f"{value}\r\n"
                ).encode("utf-8")
            )
        for field_name, filename, content_type, data in files:
            chunks.append(f"--{boundary}\r\n".encode("utf-8"))
            chunks.append(
                (
                    f'Content-Disposition: form-data; name="{field_name}"; '
                    f'filename="{filename}"\r\n'
                    f"Content-Type: {content_type}\r\n\r\n"
                ).encode("utf-8")
            )
            chunks.append(data)
            chunks.append(b"\r\n")
        chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
        return f"multipart/form-data; boundary={boundary}", b"".join(chunks)

    def test_parse_multipart_form_extracts_fields_and_files(self):
        content_type, body = self._build_multipart(
            {
                "SiteID": "SITE001",
                "PhotoType": "Property",
                "Caption": "Lobby",
            },
            [("file", "lobby.jpg", "image/jpeg", b"fake-jpeg-bytes")],
        )
        fields, files = novara_api.parse_multipart_form(body, content_type)
        self.assertEqual(fields["SiteID"], "SITE001")
        self.assertEqual(fields["PhotoType"], "Property")
        self.assertEqual(fields["Caption"], "Lobby")
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0]["filename"], "lobby.jpg")
        self.assertEqual(files[0]["data"], b"fake-jpeg-bytes")

    def test_photos_multipart_create_stores_file(self):
        item = {
            "PhotoID": "PHOTEST002",
            "SiteID": "SITE001",
            "PhotoType": "Property",
            "Caption": "Lobby",
            "S3Key": "sites/SITE001/PHOTEST002/lobby.jpg",
            "ContentType": "image/jpeg",
            "FileName": "lobby.jpg",
            "UploadedAt": "2026-08-12T00:00:00Z",
            "UploadedBy": "USR001",
        }
        fake = {
            "ok": True,
            "table": "NOVARAPhotos",
            "storage": "local",
            "photo": {"photoId": "PHOTEST002", "siteId": "SITE001"},
            "uploaded": True,
            "bytes": 15,
        }
        with patch.object(
            novara_api, "parse_photo_payload", return_value=(item, None)
        ):
            with patch.object(
                novara_api, "save_photo_with_file", return_value=fake
            ) as mocked:
                status, payload = novara_api.handle_photo_multipart_create(
                    {
                        "SiteID": "SITE001",
                        "PhotoType": "Property",
                        "Caption": "Lobby",
                        "UploadedBy": "USR001",
                    },
                    [
                        {
                            "name": "file",
                            "filename": "lobby.jpg",
                            "content_type": "image/jpeg",
                            "data": b"fake-jpeg-bytes",
                        }
                    ],
                )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["uploaded"])
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["photo"]["photoId"], "PHOTEST002")
        mocked.assert_called_once()

    def test_photos_multipart_requires_file(self):
        status, payload = novara_api.handle_photo_multipart_create(
            {"SiteID": "SITE001", "PhotoType": "Property"}, []
        )
        self.assertEqual(status, 400)
        self.assertIn("file", payload["error"].lower())

    def test_lambda_multipart_photo_create(self):
        content_type, body = self._build_multipart(
            {
                "SiteID": "SITE001",
                "PhotoType": "Equipment",
                "Caption": "Nameplate",
            },
            [("file", "plate.png", "image/png", b"png-bytes")],
        )
        fake = {
            "ok": True,
            "table": "NOVARAPhotos",
            "storage": "local",
            "count": 1,
            "photos": [{"photoId": "PHOMP001"}],
            "photo": {"photoId": "PHOMP001"},
            "uploaded": True,
        }
        with patch.object(
            novara_api, "handle_photo_multipart_create", return_value=(200, fake)
        ) as mocked:
            response = novara_api.handle_lambda_event(
                {
                    "requestContext": {"http": {"method": "POST"}},
                    "rawPath": "/api/photos",
                    "headers": {"content-type": content_type},
                    "body": base64.b64encode(body).decode("ascii"),
                    "isBase64Encoded": True,
                }
            )
        self.assertEqual(response["statusCode"], 200)
        payload = json.loads(response["body"])
        self.assertTrue(payload["uploaded"])
        mocked.assert_called_once()
        args = mocked.call_args[0]
        self.assertEqual(args[0]["SiteID"], "SITE001")
        self.assertEqual(args[1][0]["filename"], "plate.png")

    def test_photos_delete_route(self):
        fake = {
            "ok": True,
            "table": "NOVARAPhotos",
            "deleted": True,
            "photoId": "PHOTEST001",
            "siteId": "SITE001",
            "systemId": "",
        }
        with patch.object(novara_api, "delete_photo", return_value=fake) as mocked:
            status, payload = novara_api.route_request(
                "DELETE", "/api/photos/PHOTEST001", {}
            )
        self.assertEqual(status, 200)
        self.assertTrue(payload["deleted"])
        mocked.assert_called_once_with("PHOTEST001")

    def test_parse_photo_payload_requires_existing_site(self):
        with patch.object(novara_api, "get_site_item", return_value=None):
            item, error = novara_api.parse_photo_payload(
                {
                    "SiteID": "SITE999",
                    "PhotoType": "Equipment",
                    "ContentType": "image/png",
                    "FileName": "plate.png",
                }
            )
        self.assertIsNone(item)
        self.assertIn("SITE999", error)

    def test_parse_photo_payload_links_system_to_site(self):
        with patch.object(
            novara_api,
            "get_site_item",
            return_value={"siteId": "SITE001", "name": "Vista"},
        ):
            with patch.object(
                novara_api,
                "get_system_item",
                return_value={"systemId": "SYS001", "siteId": "SITE001"},
            ):
                item, error = novara_api.parse_photo_payload(
                    {
                        "SiteID": "SITE001",
                        "SystemID": "SYS001",
                        "PhotoType": "System",
                        "Caption": "Panel",
                        "ContentType": "image/jpeg",
                        "FileName": "panel.jpg",
                        "UploadedBy": "USR001",
                    }
                )
        self.assertIsNone(error)
        self.assertEqual(item["SiteID"], "SITE001")
        self.assertEqual(item["SystemID"], "SYS001")
        self.assertEqual(item["PhotoType"], "System")
        self.assertEqual(item["UploadedBy"], "USR001")
        self.assertTrue(item["PhotoID"].startswith("PHO"))
        self.assertIn("sites/SITE001/systems/SYS001/", item["S3Key"])

    def test_sites_and_systems_html_include_photos_section(self):
        sites_html = Path(__file__).resolve().parent.joinpath("sites.html").read_text(
            encoding="utf-8"
        )
        systems_html = Path(__file__).resolve().parent.joinpath(
            "systems.html"
        ).read_text(encoding="utf-8")
        for html in (sites_html, systems_html):
            self.assertIn('id="photo-section"', html)
            self.assertIn('id="photo-gallery"', html)
            self.assertIn('id="photo-files"', html)
            self.assertIn("photos-ui.js", html)
            self.assertIn("auth.js", html)

    def test_api_client_exposes_photo_methods(self):
        source = Path(__file__).resolve().parent.joinpath("api-client.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("getPhotos:", source)
        self.assertIn("createPhoto:", source)
        self.assertIn("uploadPhoto:", source)
        self.assertIn("deletePhoto:", source)
        self.assertIn("uploadPhotoFile:", source)
        self.assertIn('"/api/photos"', source)
        self.assertIn("FormData", source)

    def test_photos_ui_uses_multipart_upload(self):
        source = Path(__file__).resolve().parent.joinpath("photos-ui.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("uploadPhoto", source)
        self.assertIn("Failed to upload photos", source)
        self.assertIn("loadPhotos", source)

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

    def test_mask_secret_never_returns_full_value(self):
        self.assertEqual(novara_api.mask_secret(""), "")
        self.assertEqual(novara_api.mask_secret("abcd"), "••••")
        self.assertEqual(novara_api.mask_secret("utility-secret-key"), "••••-key")
        self.assertTrue(novara_api.looks_like_masked_secret("••••-key"))
        self.assertFalse(novara_api.looks_like_masked_secret("utility-secret-key"))

    def test_normalize_utilityapi_settings_masks_key(self):
        settings = novara_api.normalize_utilityapi_settings(
            {
                "SettingKey": "utilityapi",
                "ApiKey": "super-secret-token",
                "BaseUrl": "https://utilityapi.com/api/v2",
                "AccountId": "acct-1",
                "AuthorizationId": "auth-9",
            }
        )
        self.assertTrue(settings["apiKeyConfigured"])
        self.assertEqual(settings["apiKeyMasked"], "••••oken")
        self.assertNotIn("ApiKey", settings)
        self.assertNotIn("apiKey", settings)
        self.assertNotEqual(settings["apiKeyMasked"], "super-secret-token")
        self.assertEqual(settings["accountId"], "acct-1")
        self.assertEqual(settings["authorizationId"], "auth-9")

    def test_parse_utilityapi_settings_keeps_existing_key_when_blank(self):
        existing = {
            "ApiKey": "stored-token-1234",
            "BaseUrl": "https://utilityapi.com/api/v2",
            "AccountId": "acct-1",
            "AuthorizationId": "auth-9",
        }
        item, error = novara_api.parse_utilityapi_settings_payload(
            {"BaseUrl": "https://utilityapi.com/api/v2", "AccountId": "acct-2"},
            existing,
        )
        self.assertIsNone(error)
        self.assertEqual(item["ApiKey"], "stored-token-1234")
        self.assertEqual(item["AccountId"], "acct-2")
        self.assertEqual(item["AuthorizationId"], "auth-9")

        masked, masked_error = novara_api.parse_utilityapi_settings_payload(
            {"ApiKey": "••••1234", "AuthorizationId": "auth-10"},
            existing,
        )
        self.assertIsNone(masked_error)
        self.assertEqual(masked["ApiKey"], "stored-token-1234")
        self.assertEqual(masked["AuthorizationId"], "auth-10")

        cleared, cleared_error = novara_api.parse_utilityapi_settings_payload(
            {"clearApiKey": True},
            existing,
        )
        self.assertIsNone(cleared_error)
        self.assertEqual(cleared["ApiKey"], "")

        replaced, replaced_error = novara_api.parse_utilityapi_settings_payload(
            {"ApiKey": "new-token-value"},
            existing,
        )
        self.assertIsNone(replaced_error)
        self.assertEqual(replaced["ApiKey"], "new-token-value")

    def test_parse_utilityapi_settings_rejects_bad_base_url(self):
        item, error = novara_api.parse_utilityapi_settings_payload(
            {"BaseUrl": "not-a-url"}
        )
        self.assertIsNone(item)
        self.assertIn("BaseUrl", error)

    def test_utilityapi_settings_get_route(self):
        fake = {
            "ok": True,
            "table": "NOVARASettings",
            "settings": {
                "apiKeyConfigured": True,
                "apiKeyMasked": "••••abcd",
                "baseUrl": "https://utilityapi.com/api/v2",
                "accountId": "",
                "authorizationId": "",
                "updatedAt": "2026-08-12T00:00:00Z",
            },
        }
        with patch.object(novara_api, "get_utilityapi_settings", return_value=fake):
            status, payload = novara_api.route_request(
                "GET", "/api/settings/utilityapi", {}
            )
        self.assertEqual(status, 200)
        self.assertTrue(payload["settings"]["apiKeyConfigured"])
        self.assertEqual(payload["settings"]["apiKeyMasked"], "••••abcd")
        self.assertNotIn("apiKey", payload["settings"])

    def test_utilityapi_settings_put_route(self):
        body = {
            "ApiKey": "new-secret",
            "BaseUrl": "https://utilityapi.com/api/v2",
            "AccountId": "acct-1",
            "AuthorizationId": "auth-1",
        }
        fake = {
            "ok": True,
            "table": "NOVARASettings",
            "settings": {
                "apiKeyConfigured": True,
                "apiKeyMasked": "••••h-1",
                "baseUrl": body["BaseUrl"],
                "accountId": "acct-1",
                "authorizationId": "auth-1",
            },
        }
        with patch.object(novara_api, "get_utilityapi_settings_item", return_value=None):
            with patch.object(
                novara_api, "save_utilityapi_settings", return_value=fake
            ) as mocked:
                status, payload = novara_api.route_request(
                    "PUT", "/api/settings/utilityapi", {}, body
                )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        saved = mocked.call_args.args[0]
        self.assertEqual(saved["ApiKey"], "new-secret")
        self.assertNotIn("new-secret", json.dumps(payload))

    def test_utility_bills_list_route(self):
        fake = {
            "table": "NOVARAUtilityBills",
            "count": 0,
            "siteId": None,
            "bills": [],
        }
        with patch.object(novara_api, "scan_utility_bills", return_value=fake):
            status, payload = novara_api.route_request("GET", "/api/utility-bills", {})
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 0)
        self.assertEqual(payload["bills"], [])

    def test_utility_bills_list_filters_site(self):
        fake = {
            "table": "NOVARAUtilityBills",
            "count": 1,
            "siteId": "SITE001",
            "bills": [{"recordId": "BILL001", "siteId": "SITE001"}],
        }
        with patch.object(
            novara_api, "scan_utility_bills", return_value=fake
        ) as mocked:
            status, payload = novara_api.route_request(
                "GET", "/api/utility-bills", {"siteId": ["SITE001"]}
            )
        self.assertEqual(status, 200)
        mocked.assert_called_once_with(site_id="SITE001")
        self.assertEqual(payload["bills"][0]["recordId"], "BILL001")

    def test_create_utility_bill_route(self):
        body = {
            "SiteID": "SITE001",
            "UtilityAccountID": "UA-100",
            "PeriodStart": "2026-07-01",
            "PeriodEnd": "2026-07-31",
            "UsageAmount": 1200,
            "UsageUnit": "kWh",
            "Cost": 180.5,
        }
        fake = {
            "ok": True,
            "table": "NOVARAUtilityBills",
            "bill": {"recordId": "BILL001", "siteId": "SITE001"},
        }
        with patch.object(novara_api, "save_utility_bill", return_value=fake) as mocked:
            status, payload = novara_api.route_request(
                "POST", "/api/utility-bills", {}, body
            )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        mocked.assert_called_once()
        self.assertEqual(mocked.call_args.kwargs["mode"], "create")

    def test_create_utility_bill_requires_site(self):
        status, payload = novara_api.route_request(
            "POST", "/api/utility-bills", {}, {"UsageAmount": 10}
        )
        self.assertEqual(status, 400)
        self.assertIn("SiteID", payload["error"])

    def test_normalize_utility_bill(self):
        bill = novara_api.normalize_utility_bill(
            {
                "RecordID": "BILL001",
                "SiteID": "SITE001",
                "UtilityAccountID": "UA-100",
                "PeriodStart": "2026-07-01",
                "PeriodEnd": "2026-07-31",
                "UsageAmount": Decimal("1200.5"),
                "UsageUnit": "kWh",
                "Cost": Decimal("180.50"),
                "Currency": "USD",
                "RawData": '{"kwh": 1200.5}',
                "LastSyncedAt": "2026-08-12T00:00:00Z",
            }
        )
        self.assertEqual(bill["recordId"], "BILL001")
        self.assertEqual(bill["siteId"], "SITE001")
        self.assertEqual(bill["utilityAccountId"], "UA-100")
        self.assertEqual(bill["usageAmount"], 1200.5)
        self.assertEqual(bill["usageUnit"], "kWh")
        self.assertEqual(bill["cost"], 180.5)
        self.assertEqual(bill["rawData"], {"kwh": 1200.5})
        self.assertEqual(bill["lastSyncedAt"], "2026-08-12T00:00:00Z")

    def test_parse_utility_bill_payload(self):
        item, error = novara_api.parse_utility_bill_payload(
            {
                "SiteID": "SITE001",
                "UtilityAccountID": "UA-100",
                "PeriodStart": "2026-07-01",
                "PeriodEnd": "2026-07-31",
                "UsageAmount": "1500",
                "UsageUnit": "therms",
                "Cost": "99.10",
                "RawData": {"summary": "ok"},
            }
        )
        self.assertIsNone(error)
        self.assertEqual(item["SiteID"], "SITE001")
        self.assertEqual(item["UsageUnit"], "therms")
        self.assertEqual(item["UsageAmount"], Decimal("1500"))
        self.assertEqual(item["Cost"], Decimal("99.10"))
        self.assertIn("summary", item["RawData"])

        bad, bad_error = novara_api.parse_utility_bill_payload(
            {"SiteID": "SITE001", "PeriodStart": "July 1"}
        )
        self.assertIsNone(bad)
        self.assertIn("PeriodStart", bad_error)

    def test_next_utility_bill_id(self):
        self.assertEqual(novara_api.next_utility_bill_id([]), "BILL001")
        self.assertEqual(
            novara_api.next_utility_bill_id(
                [{"RecordID": "BILL002"}, {"RecordID": "BILL010"}]
            ),
            "BILL011",
        )

    def test_nav_includes_utility_data(self):
        source = Path(__file__).resolve().parent.joinpath("nav.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('id: "bills"', source)
        self.assertIn("bills.html", source)
        self.assertIn("Utility Data", source)

    def test_bills_page_has_empty_list(self):
        html = Path(__file__).resolve().parent.joinpath("bills.html").read_text(
            encoding="utf-8"
        )
        js = Path(__file__).resolve().parent.joinpath("bills.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('data-page="bills"', html)
        self.assertIn("bills-tbody", html)
        self.assertIn("bills-empty-state", html)
        self.assertIn("No utility bills have been synced yet", html)
        self.assertIn("getUtilityBills", js)
        self.assertNotIn("utilityapi.com/api", js)

    def test_settings_page_has_utilityapi_form(self):
        html = Path(__file__).resolve().parent.joinpath("settings.html").read_text(
            encoding="utf-8"
        )
        js = Path(__file__).resolve().parent.joinpath("settings.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("utilityapi-form", html)
        self.assertIn("field-utilityapi-key", html)
        self.assertIn('type="password"', html)
        self.assertIn("field-utilityapi-base-url", html)
        self.assertIn("field-utilityapi-account-id", html)
        self.assertIn("field-utilityapi-authorization-id", html)
        self.assertIn("getUtilityApiSettings", js)
        self.assertIn("saveUtilityApiSettings", js)
        self.assertIn("Leave blank to keep the saved key", js)

    def test_api_client_exposes_utility_methods(self):
        source = Path(__file__).resolve().parent.joinpath("api-client.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("getUtilityApiSettings", source)
        self.assertIn("saveUtilityApiSettings", source)
        self.assertIn("getUtilityBills", source)
        self.assertIn("createUtilityBill", source)
        self.assertIn("/api/settings/utilityapi", source)
        self.assertIn("/api/utility-bills", source)

    def test_unknown_api_path_mentions_utility_routes(self):
        status, payload = novara_api.route_request("POST", "/api/missing", {})
        self.assertEqual(status, 404)
        self.assertIn("/api/settings/utilityapi", payload.get("hint", ""))
        self.assertIn("/api/utility-bills", payload.get("hint", ""))


if __name__ == "__main__":
    unittest.main()
