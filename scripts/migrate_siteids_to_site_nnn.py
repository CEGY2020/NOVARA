#!/usr/bin/env python3
"""Rename legacy SiteIDs in NOVARASites / NOVARAReadings to SITE###.

Copies each site (and its readings) to the new partition key, verifies the
copy, then deletes the old items. Safe to re-run: already-migrated pairs are
skipped, and deletes only happen after a verified copy.
"""

from __future__ import annotations

import argparse
import os
import sys
from copy import deepcopy
from decimal import Decimal
from typing import Any

# Allow importing novara_api helpers when run from repo root or scripts/.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from novara_api import (  # noqa: E402
    SITES_TABLE_NAME,
    TABLE_NAME,
    dynamodb_resource,
    sanitize_aws_env,
)

# Ordered mapping: legacy SiteID -> standardized SiteID
DEFAULT_RENAMES = (
    ("VS001", "SITE001"),
    ("HP001", "SITE002"),
)


def _items_equal_ignoring_keys(a: dict, b: dict, ignore: set[str]) -> bool:
    def norm(item: dict) -> dict:
        out = {}
        for key, value in item.items():
            if key in ignore:
                continue
            if isinstance(value, Decimal):
                out[key] = float(value) if value % 1 else int(value)
            else:
                out[key] = value
        return out

    return norm(a) == norm(b)


def _query_all_readings(table, site_id: str) -> list[dict]:
    from boto3.dynamodb.conditions import Key

    items: list[dict] = []
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("SiteID").eq(site_id),
        "ScanIndexForward": True,
    }
    while True:
        response = table.query(**kwargs)
        items.extend(response.get("Items", []))
        last = response.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    return items


def migrate_site(sites_table, old_id: str, new_id: str, *, dry_run: bool) -> str:
    old_resp = sites_table.get_item(Key={"SiteID": old_id})
    new_resp = sites_table.get_item(Key={"SiteID": new_id})
    old_item = old_resp.get("Item")
    new_item = new_resp.get("Item")

    if not old_item and new_item:
        return f"sites {old_id} -> {new_id}: already migrated (old gone)"
    if not old_item and not new_item:
        return f"sites {old_id} -> {new_id}: SKIP (neither item exists)"
    if old_item and new_item:
        if not _items_equal_ignoring_keys(old_item, new_item, {"SiteID"}):
            raise RuntimeError(
                f"Conflict: both {old_id} and {new_id} exist with different attributes"
            )
        if dry_run:
            return f"sites {old_id} -> {new_id}: would delete old (new already matches)"
        sites_table.delete_item(
            Key={"SiteID": old_id},
            ConditionExpression="attribute_exists(SiteID)",
        )
        return f"sites {old_id} -> {new_id}: deleted old (new already matched)"

    # old exists, new does not
    copied = deepcopy(old_item)
    copied["SiteID"] = new_id
    if dry_run:
        attrs = sorted(k for k in copied if k != "SiteID")
        return f"sites {old_id} -> {new_id}: would copy attrs={attrs} then delete old"

    sites_table.put_item(
        Item=copied,
        ConditionExpression="attribute_not_exists(SiteID)",
    )
    verify = sites_table.get_item(Key={"SiteID": new_id}).get("Item")
    if not verify or not _items_equal_ignoring_keys(old_item, verify, {"SiteID"}):
        raise RuntimeError(f"Verification failed after copying site {old_id} -> {new_id}")

    sites_table.delete_item(
        Key={"SiteID": old_id},
        ConditionExpression="attribute_exists(SiteID)",
    )
    return f"sites {old_id} -> {new_id}: copied + deleted old"


def migrate_readings(readings_table, old_id: str, new_id: str, *, dry_run: bool) -> str:
    old_items = _query_all_readings(readings_table, old_id)
    new_items = _query_all_readings(readings_table, new_id)

    if not old_items and new_items:
        return f"readings {old_id} -> {new_id}: already migrated ({len(new_items)} rows)"
    if not old_items and not new_items:
        return f"readings {old_id} -> {new_id}: none"

    new_by_ts = {item["TimestampUTC"]: item for item in new_items}
    to_copy = []
    for item in old_items:
        ts = item["TimestampUTC"]
        existing = new_by_ts.get(ts)
        if existing is None:
            to_copy.append(item)
            continue
        if not _items_equal_ignoring_keys(item, existing, {"SiteID"}):
            raise RuntimeError(
                f"Conflict: reading {old_id}/{ts} differs from {new_id}/{ts}"
            )

    if dry_run:
        return (
            f"readings {old_id} -> {new_id}: would copy {len(to_copy)} "
            f"(already {len(new_items)}), then delete {len(old_items)} old"
        )

    for item in to_copy:
        copied = deepcopy(item)
        copied["SiteID"] = new_id
        readings_table.put_item(
            Item=copied,
            ConditionExpression="attribute_not_exists(SiteID) AND attribute_not_exists(TimestampUTC)",
        )

    # Verify every old reading exists under the new SiteID with matching attrs.
    verified = {item["TimestampUTC"]: item for item in _query_all_readings(readings_table, new_id)}
    for item in old_items:
        ts = item["TimestampUTC"]
        if ts not in verified or not _items_equal_ignoring_keys(item, verified[ts], {"SiteID"}):
            raise RuntimeError(f"Verification failed for reading {old_id}/{ts} -> {new_id}")

    for item in old_items:
        readings_table.delete_item(
            Key={"SiteID": old_id, "TimestampUTC": item["TimestampUTC"]},
            ConditionExpression="attribute_exists(SiteID) AND attribute_exists(TimestampUTC)",
        )

    return (
        f"readings {old_id} -> {new_id}: copied {len(to_copy)}, "
        f"deleted {len(old_items)} old (total at new id: {len(verified)})"
    )


def next_site_id_preview(sites_table) -> str:
    """Mirror client nextSiteId() over SITE### keys."""
    max_num = 0
    kwargs: dict[str, Any] = {"ProjectionExpression": "SiteID"}
    while True:
        response = sites_table.scan(**kwargs)
        for item in response.get("Items", []):
            site_id = str(item.get("SiteID") or "").strip()
            if len(site_id) < 5 or not site_id.upper().startswith("SITE"):
                continue
            digits = site_id[4:]
            if not digits.isdigit():
                continue
            max_num = max(max_num, int(digits))
        last = response.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    next_num = max_num + 1
    width = max(3, len(str(next_num)))
    return f"SITE{next_num:0{width}d}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned actions without writing to DynamoDB",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Perform the migration (required unless --dry-run)",
    )
    args = parser.parse_args()
    if not args.dry_run and not args.execute:
        parser.error("Pass --dry-run or --execute")

    sanitize_aws_env()
    ddb = dynamodb_resource()
    sites_table = ddb.Table(os.environ.get("NOVARA_SITES_TABLE", SITES_TABLE_NAME))
    readings_table = ddb.Table(os.environ.get("NOVARA_READINGS_TABLE", TABLE_NAME))

    mode = "DRY-RUN" if args.dry_run else "EXECUTE"
    print(f"[{mode}] Migrating SiteIDs in {sites_table.name} / {readings_table.name}")

    for old_id, new_id in DEFAULT_RENAMES:
        print(migrate_site(sites_table, old_id, new_id, dry_run=args.dry_run))
        print(migrate_readings(readings_table, old_id, new_id, dry_run=args.dry_run))

    # Surface any leftover legacy SiteIDs in readings.
    leftover = set()
    kwargs: dict[str, Any] = {"ProjectionExpression": "SiteID"}
    while True:
        response = readings_table.scan(**kwargs)
        for item in response.get("Items", []):
            sid = str(item.get("SiteID") or "")
            if sid and not (sid.upper().startswith("SITE") and sid[4:].isdigit()):
                leftover.add(sid)
        last = response.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    if leftover:
        print("WARNING: non-SITE### SiteIDs still present in readings:", sorted(leftover))
    else:
        print("Readings SiteIDs: all SITE### (or empty)")

    preview = next_site_id_preview(sites_table)
    print(f"Next auto-generated SiteID would be: {preview}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
