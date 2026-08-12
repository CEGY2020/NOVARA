#!/usr/bin/env python3
"""Unit tests for readings CSV/Excel import helpers (no live DynamoDB)."""

from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock

from botocore.exceptions import ClientError

from scripts import import_readings as imp


class ParseHelpersTests(unittest.TestCase):
    def test_resolve_columns_aliases(self):
        columns = imp.resolve_columns(
            ["site_id", "system_id", "Timestamp", "Supply", "Return", "Relay"]
        )
        self.assertEqual(columns["SiteID"], "site_id")
        self.assertEqual(columns["SystemID"], "system_id")
        self.assertEqual(columns["TimestampUTC"], "Timestamp")
        self.assertEqual(columns["T1"], "Supply")
        self.assertEqual(columns["T2"], "Return")
        self.assertEqual(columns["RelayState"], "Relay")

    def test_resolve_vista_springs_headers(self):
        columns = imp.resolve_columns(
            ["Timestamp (UTC)", "Relay State", "T2 (F)", "T1 (F)"]
        )
        self.assertEqual(columns["TimestampUTC"], "Timestamp (UTC)")
        self.assertEqual(columns["RelayState"], "Relay State")
        self.assertEqual(columns["T2"], "T2 (F)")
        self.assertEqual(columns["T1"], "T1 (F)")

    def test_infer_vista_springs_ids(self):
        path = Path(
            "data/readings/vista-springs/"
            "DHW-Sys-3-chart-data-2026-08-11_15-04-11.csv.csv"
        )
        self.assertEqual(imp.infer_vista_springs_ids(path), ("SITE001", "SYS003"))
        self.assertIsNone(imp.infer_vista_springs_ids(Path("other.csv")))

    def test_parse_timestamp_iso_and_space(self):
        self.assertEqual(
            imp.parse_timestamp_utc("2026-08-01T14:30:00Z"),
            "2026-08-01T14:30:00Z",
        )
        self.assertEqual(
            imp.parse_timestamp_utc("2026-08-01 14:30:00"),
            "2026-08-01T14:30:00Z",
        )
        self.assertEqual(
            imp.parse_timestamp_utc(datetime(2026, 8, 1, 14, 30, tzinfo=timezone.utc)),
            "2026-08-01T14:30:00Z",
        )

    def test_parse_site_id_mapping(self):
        site_map = imp.parse_site_map(["VS001=SITE001", "hp001=SITE002"])
        self.assertEqual(imp.parse_site_id("VS001", site_map, None), "SITE001")
        self.assertEqual(imp.parse_site_id("hp001", site_map, None), "SITE002")
        self.assertEqual(imp.parse_site_id("", site_map, "SITE003"), "SITE003")
        with self.assertRaises(ValueError):
            imp.parse_site_id("Vista Springs", {}, None)

    def test_row_to_item(self):
        columns = {
            "SiteID": "SiteID",
            "SystemID": "SystemID",
            "TimestampUTC": "TimestampUTC",
            "T1": "T1",
            "T2": "T2",
            "RelayState": "RelayState",
        }
        item = imp.row_to_item(
            {
                "SiteID": "site001",
                "SystemID": "sys001",
                "TimestampUTC": "2026-08-01T00:00:00Z",
                "T1": "120.5",
                "T2": "110.2",
                "RelayState": "1",
            },
            columns,
            site_map={},
            default_site=None,
            default_system=None,
        )
        self.assertEqual(item["SiteID"], "SITE001")
        self.assertEqual(item["SystemID"], "SYS001")
        # System-scoped readings use composite sort keys to avoid collisions.
        self.assertEqual(item["TimestampUTC"], "2026-08-01T00:00:00Z#SYS001")
        self.assertEqual(item["T1"], Decimal("120.5"))
        self.assertEqual(item["T2"], Decimal("110.2"))
        self.assertEqual(item["RelayState"], Decimal("1"))

    def test_parse_system_id(self):
        self.assertEqual(imp.parse_system_id("sys001", None), "SYS001")
        self.assertEqual(imp.parse_system_id("", "SYS002"), "SYS002")
        self.assertIsNone(imp.parse_system_id("", None))
        with self.assertRaises(ValueError):
            imp.parse_system_id("System 1", None)


class CsvImportTests(unittest.TestCase):
    def test_parse_sample_csv(self):
        path = Path(__file__).resolve().parent / "data" / "readings" / "sample_readings.csv"
        items, errors = imp.parse_items(path, site_map={}, default_site=None)
        self.assertEqual(errors, [])
        self.assertEqual(len(items), 3)
        self.assertEqual(items[0]["SiteID"], "SITE001")
        self.assertEqual(items[0]["T1"], Decimal("120.5"))
        self.assertNotIn("SystemID", items[0])

    def test_default_site_when_column_missing(self):
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as handle:
            handle.write("TimestampUTC,T1,T2\n")
            handle.write("2026-08-02T12:00:00Z,100,90\n")
            path = Path(handle.name)
        try:
            items, errors = imp.parse_items(
                path, site_map={}, default_site="SITE002"
            )
            self.assertEqual(errors, [])
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]["SiteID"], "SITE002")
        finally:
            path.unlink(missing_ok=True)

    def test_default_site_and_system_when_columns_missing(self):
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as handle:
            handle.write("TimestampUTC,T1,T2,RelayState\n")
            handle.write("2026-08-02T12:00:00Z,100,90,1\n")
            path = Path(handle.name)
        try:
            items, errors = imp.parse_items(
                path,
                site_map={},
                default_site="SITE001",
                default_system="SYS001",
            )
            self.assertEqual(errors, [])
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]["SiteID"], "SITE001")
            self.assertEqual(items[0]["SystemID"], "SYS001")
            self.assertEqual(items[0]["TimestampUTC"], "2026-08-02T12:00:00Z#SYS001")
            self.assertEqual(items[0]["RelayState"], Decimal("1"))
        finally:
            path.unlink(missing_ok=True)

    def test_parse_vista_springs_sample_row(self):
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as handle:
            handle.write("Timestamp (UTC),Relay State,T2 (F),T1 (F)\n")
            handle.write("2026-08-05T07:00:00Z,1,101.14,113.21\n")
            path = Path(handle.name)
        try:
            items, errors = imp.parse_items(
                path,
                site_map={},
                default_site="SITE001",
                default_system="SYS002",
            )
            self.assertEqual(errors, [])
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]["SiteID"], "SITE001")
            self.assertEqual(items[0]["SystemID"], "SYS002")
            self.assertEqual(items[0]["TimestampUTC"], "2026-08-05T07:00:00Z#SYS002")
            self.assertEqual(items[0]["T1"], Decimal("113.21"))
            self.assertEqual(items[0]["T2"], Decimal("101.14"))
            self.assertEqual(items[0]["RelayState"], Decimal("1"))
        finally:
            path.unlink(missing_ok=True)

    def test_expand_input_paths_directory(self):
        folder = (
            Path(__file__).resolve().parent / "data" / "readings" / "vista-springs"
        )
        expanded = imp.expand_input_paths([folder])
        self.assertEqual(len(expanded), 7)
        self.assertTrue(all(p.name.startswith("DHW-Sys-") for p in expanded))

    def test_dry_run_vista_springs_directory(self):
        folder = (
            Path(__file__).resolve().parent / "data" / "readings" / "vista-springs"
        )
        rc = imp.main([str(folder), "--dry-run"])
        self.assertEqual(rc, 0)

    def test_dedupe_keeps_last(self):
        items = [
            {
                "SiteID": "SITE001",
                "TimestampUTC": "2026-08-01T00:00:00Z",
                "T1": Decimal("1"),
                "T2": Decimal("2"),
            },
            {
                "SiteID": "SITE001",
                "TimestampUTC": "2026-08-01T00:00:00Z",
                "T1": Decimal("3"),
                "T2": Decimal("4"),
            },
        ]
        unique, dupes = imp.dedupe_items(items)
        self.assertEqual(dupes, 1)
        self.assertEqual(len(unique), 1)
        self.assertEqual(unique[0]["T1"], Decimal("3"))

    def test_dedupe_keeps_same_timestamp_across_systems(self):
        items = [
            {
                "SiteID": "SITE001",
                "SystemID": "SYS001",
                "TimestampUTC": "2026-08-01T00:00:00Z#SYS001",
                "T1": Decimal("1"),
                "T2": Decimal("2"),
            },
            {
                "SiteID": "SITE001",
                "SystemID": "SYS002",
                "TimestampUTC": "2026-08-01T00:00:00Z#SYS002",
                "T1": Decimal("3"),
                "T2": Decimal("4"),
            },
        ]
        unique, dupes = imp.dedupe_items(items)
        self.assertEqual(dupes, 0)
        self.assertEqual(len(unique), 2)

    def test_summarize_by_system(self):
        counts = imp.summarize_by_system(
            [
                {"SystemID": "SYS001"},
                {"SystemID": "SYS001"},
                {"SystemID": "SYS002"},
                {},
            ]
        )
        self.assertEqual(counts["SYS001"], 2)
        self.assertEqual(counts["SYS002"], 1)
        self.assertEqual(counts["(none)"], 1)


class PutItemsTests(unittest.TestCase):
    def test_skips_conditional_check_failed(self):
        table = MagicMock()

        def put_item(**kwargs):
            if "ConditionExpression" in kwargs:
                raise ClientError(
                    {
                        "Error": {
                            "Code": "ConditionalCheckFailedException",
                            "Message": "exists",
                        }
                    },
                    "PutItem",
                )

        table.put_item.side_effect = put_item
        stats = imp.put_items(
            table,
            [
                {
                    "SiteID": "SITE001",
                    "TimestampUTC": "2026-08-01T00:00:00Z",
                    "T1": Decimal("1"),
                    "T2": Decimal("2"),
                }
            ],
            overwrite=False,
            dry_run=False,
        )
        self.assertEqual(stats["skipped"], 1)
        self.assertEqual(stats["written"], 0)


if __name__ == "__main__":
    unittest.main()
