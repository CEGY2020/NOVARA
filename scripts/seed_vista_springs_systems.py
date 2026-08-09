#!/usr/bin/env python3
"""Ensure Vista Springs (SITE001) has System 1 / System 2 records.

Creates or updates:

  SYS001 — Vista Springs System 1 (DHW, Online)
  SYS002 — Vista Springs System 2 (DHW, Online)

Uses the same payload validation path as POST/PUT /api/systems.
"""

from __future__ import annotations

import argparse
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from novara_api import parse_system_payload, sanitize_aws_env, save_system  # noqa: E402

VISTA_SPRINGS_SYSTEMS = (
    {
        "SystemID": "SYS001",
        "SiteID": "SITE001",
        "SystemName": "Vista Springs System 1",
        "SystemType": "DHW",
        "Status": "Online",
        "EquipmentCount": 0,
        "Notes": "Vista Springs System 1",
    },
    {
        "SystemID": "SYS002",
        "SiteID": "SITE001",
        "SystemName": "Vista Springs System 2",
        "SystemType": "DHW",
        "Status": "Online",
        "EquipmentCount": 0,
        "Notes": "Vista Springs System 2",
    },
)


def seed(*, dry_run: bool = False) -> int:
    sanitize_aws_env()
    for body in VISTA_SPRINGS_SYSTEMS:
        item, error = parse_system_payload(body)
        if error:
            print(f"ERROR {body['SystemID']}: {error}", file=sys.stderr)
            return 1
        if dry_run:
            print(
                f"[DRY-RUN] would upsert {item['SystemID']} → {item['SiteID']} "
                f"({item['SystemName']}, {item['SystemType']}, {item['Status']})"
            )
            continue
        result = save_system(item, mode="upsert")
        system = result["system"]
        print(
            f"Upserted {system['systemId']} → {system['siteId']} "
            f"({system['systemName']}, {system['systemType']}, {system['status']})"
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate payloads without writing to DynamoDB",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Write systems to DynamoDB (required unless --dry-run)",
    )
    args = parser.parse_args(argv)
    if not args.dry_run and not args.execute:
        parser.error("Pass --dry-run or --execute")
    return seed(dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
