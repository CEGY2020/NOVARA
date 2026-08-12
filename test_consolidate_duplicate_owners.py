#!/usr/bin/env python3
"""Unit tests for duplicate-owner consolidation (no live DynamoDB)."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from scripts import consolidate_duplicate_owners as cons


class OwnerNumberTests(unittest.TestCase):
    def test_own_prefixed_ids(self):
        self.assertEqual(cons.owner_number("OWN001"), 1)
        self.assertEqual(cons.owner_number("OWN014"), 14)
        self.assertEqual(cons.owner_number("OWN015"), 15)
        self.assertEqual(cons.owner_number("own010"), 10)

    def test_bare_and_padded_digits(self):
        self.assertEqual(cons.owner_number("01"), 1)
        self.assertEqual(cons.owner_number("1"), 1)
        self.assertEqual(cons.owner_number("14"), 14)
        self.assertEqual(cons.owner_number("15"), 15)

    def test_does_not_treat_own010_as_owner_01(self):
        self.assertEqual(cons.owner_number("OWN010"), 10)
        self.assertNotEqual(cons.owner_number("OWN010"), 1)
        self.assertNotIn(cons.owner_number("OWN010"), cons.DELETE_OWNER_NUMBERS)

    def test_non_numeric_ids(self):
        self.assertIsNone(cons.owner_number("OWN_SMOKE_DEPLOY"))
        self.assertIsNone(cons.owner_number(""))
        self.assertIsNone(cons.owner_number(None))


class SiteMatchTests(unittest.TestCase):
    def test_matches_duplicate_owner_ids(self):
        self.assertTrue(
            cons.site_needs_reassign(
                {"SiteID": "SITE009", "Owner": "OWN001"},
                delete_ids={"OWN001", "OWN014"},
                delete_names={"Crystal Asset Management"},
                keep_id="OWN015",
            )
        )
        self.assertTrue(
            cons.site_needs_reassign(
                {"SiteID": "SITE009", "Owner": "14"},
                delete_ids={"OWN001", "OWN014"},
                delete_names={"Crystal Asset Management"},
                keep_id="OWN015",
            )
        )

    def test_matches_shared_duplicate_name(self):
        self.assertTrue(
            cons.site_needs_reassign(
                {"SiteID": "SITE002", "Owner": "Crystal Asset Management"},
                delete_ids={"OWN001", "OWN014"},
                delete_names={"Crystal Asset Management"},
                keep_id="OWN015",
            )
        )

    def test_skips_keep_owner_and_unrelated_sites(self):
        self.assertFalse(
            cons.site_needs_reassign(
                {"SiteID": "SITE001", "Owner": "OWN015"},
                delete_ids={"OWN001", "OWN014"},
                delete_names={"Crystal Asset Management"},
                keep_id="OWN015",
            )
        )
        self.assertFalse(
            cons.site_needs_reassign(
                {"SiteID": "SITE009", "Owner": "OWN010"},
                delete_ids={"OWN001", "OWN014"},
                delete_names={"Crystal Asset Management"},
                keep_id="OWN015",
            )
        )
        self.assertFalse(
            cons.site_needs_reassign(
                {"SiteID": "SITE009", "Owner": "Carlos Enterprises"},
                delete_ids={"OWN001", "OWN014"},
                delete_names={"Crystal Asset Management"},
                keep_id="OWN015",
            )
        )


class ConsolidateTests(unittest.TestCase):
    def _tables(self, owners, sites):
        owners_table = MagicMock()
        sites_table = MagicMock()
        owners_table.scan.return_value = {"Items": owners}
        sites_table.scan.return_value = {"Items": sites}
        return owners_table, sites_table

    def test_execute_updates_named_site_and_deletes_duplicates(self):
        owners = [
            {"OwnerID": "OWN001", "Name": "Crystal Asset Management"},
            {"OwnerID": "OWN010", "Name": "Carlos Enterprises"},
            {"OwnerID": "OWN014", "Name": "Crystal Asset Management"},
            {"OwnerID": "OWN015", "Name": "Crystal Asset Management"},
        ]
        sites = [
            {"SiteID": "SITE001", "Owner": "OWN015", "SiteName": "Vista Springs"},
            {
                "SiteID": "SITE002",
                "Owner": "Crystal Asset Management",
                "SiteName": "Highlander Pointe",
            },
        ]
        owners_table, sites_table = self._tables(owners, sites)

        result = cons.consolidate(owners_table, sites_table, dry_run=False)

        self.assertEqual(result["keep_id"], "OWN015")
        self.assertEqual(result["updated_site_ids"], ["SITE002"])
        self.assertEqual(result["already_keep_site_ids"], ["SITE001"])
        self.assertEqual(result["deleted_owner_ids"], ["OWN001", "OWN014"])
        sites_table.update_item.assert_called_once()
        update_kwargs = sites_table.update_item.call_args.kwargs
        self.assertEqual(update_kwargs["Key"], {"SiteID": "SITE002"})
        self.assertEqual(update_kwargs["ExpressionAttributeValues"][":keep"], "OWN015")
        deleted = [
            call.kwargs["Key"]["OwnerID"]
            for call in owners_table.delete_item.call_args_list
        ]
        self.assertEqual(deleted, ["OWN001", "OWN014"])

    def test_dry_run_does_not_write(self):
        owners = [
            {"OwnerID": "OWN001", "Name": "Crystal Asset Management"},
            {"OwnerID": "OWN014", "Name": "Crystal Asset Management"},
            {"OwnerID": "OWN015", "Name": "Crystal Asset Management"},
        ]
        sites = [{"SiteID": "SITE002", "Owner": "OWN001"}]
        owners_table, sites_table = self._tables(owners, sites)

        result = cons.consolidate(owners_table, sites_table, dry_run=True)

        self.assertEqual(result["updated_site_ids"], ["SITE002"])
        self.assertEqual(result["deleted_owner_ids"], ["OWN001", "OWN014"])
        sites_table.update_item.assert_not_called()
        owners_table.delete_item.assert_not_called()

    def test_missing_keep_owner_raises(self):
        owners = [{"OwnerID": "OWN001", "Name": "Crystal Asset Management"}]
        owners_table, sites_table = self._tables(owners, [])
        with self.assertRaisesRegex(RuntimeError, "Keep owner"):
            cons.consolidate(owners_table, sites_table, dry_run=True)

    def test_refuses_to_delete_keep_owner(self):
        owners = [{"OwnerID": "OWN015", "Name": "Crystal Asset Management"}]
        owners_table, sites_table = self._tables(owners, [])
        result = cons.consolidate(owners_table, sites_table, dry_run=False)
        self.assertEqual(result["deleted_owner_ids"], [])
        owners_table.delete_item.assert_not_called()
        sites_table.update_item.assert_not_called()


if __name__ == "__main__":
    unittest.main()
