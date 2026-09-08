import unittest
from unittest.mock import patch

import hubspot_crm


class HubSpotCrmRouteTests(unittest.TestCase):
    def test_service_status_does_not_require_token(self):
        status, payload = hubspot_crm.route("GET", "/api/crm")
        self.assertEqual(status, 200)
        self.assertEqual(payload["version"], "0.7")
        self.assertIn("configured", payload)
        self.assertIn("enabled", payload)

    def test_products_fall_back_to_novara_catalog_without_token(self):
        with patch.object(hubspot_crm, "HUBSPOT_ACCESS_TOKEN", ""):
            status, payload = hubspot_crm.route("GET", "/api/crm/products")
        self.assertEqual(status, 200)
        self.assertEqual(payload["source"], "NOVARA")
        codes = {row["productCode"] for row in payload["results"]}
        self.assertEqual(codes, {"NOVARA_DHW", "NOVARA_POOL", "NOVARA_HVAC", "OPTIMA_PROLINK"})

    def test_write_is_blocked_until_live_sync_enabled(self):
        with patch.object(hubspot_crm, "HUBSPOT_ENABLED", False):
            status, payload = hubspot_crm.route(
                "POST",
                "/api/crm/contacts",
                body={"contactId": "NOV-CONT-000001", "email": "test@example.com"},
            )
        self.assertEqual(status, 503)
        self.assertIn("disabled", payload["error"].lower())

    def test_contact_upsert_uses_novara_id(self):
        fake = {
            "ok": True,
            "action": "created",
            "entityType": "contacts",
            "record": {"hubspotId": "123", "contactId": "NOV-CONT-000001"},
        }
        with patch.object(hubspot_crm, "upsert_entity", return_value=fake) as upsert:
            status, payload = hubspot_crm.route(
                "POST",
                "/api/crm/contacts",
                body={"contactId": "NOV-CONT-000001", "email": "test@example.com"},
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["record"]["hubspotId"], "123")
        upsert.assert_called_once()

    def test_opportunity_activities_route(self):
        expected = {"ok": True, "opportunityId": "NOV-OPP-000001", "activities": []}
        with patch.object(hubspot_crm, "activities_for_opportunity", return_value=expected):
            status, payload = hubspot_crm.route(
                "GET", "/api/crm/opportunities/NOV-OPP-000001/activities"
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["opportunityId"], "NOV-OPP-000001")


if __name__ == "__main__":
    unittest.main()
