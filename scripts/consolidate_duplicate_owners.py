#!/usr/bin/env python3
"""Reassign Sites off duplicate Owners 01 and 14, then delete those Owners.

Live NOVARAOwners IDs are OWN###. This script:

  1. Resolves Owner 01 / 14 / 15 to the actual OwnerID values (OWN001, OWN014,
     OWN015) by numeric suffix — OWN010 is not Owner 01.
  2. Updates every NOVARASites row whose Owner (or OwnerID) field points at
     OWN001 or OWN014, or at the shared duplicate name, to Owner = OWN015.
  3. Deletes OWN001 and OWN014.
  4. Leaves OWN015 untouched.

Safe to re-run: already-reassigned sites and already-deleted owners are skipped.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Any, Iterable

# Allow importing novara_api helpers when run from repo root or scripts/.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from novara_api import (  # noqa: E402
    OWNERS_TABLE_NAME,
    SITES_TABLE_NAME,
    dynamodb_resource,
    sanitize_aws_env,
)

# User-facing Owner numbers: delete 01 and 14, keep 15.
DELETE_OWNER_NUMBERS = frozenset({1, 14})
KEEP_OWNER_NUMBER = 15

# OWN001 / 01 / 1 → 1; OWN014 / 14 → 14; OWN010 → 10 (not 1).
_OWNER_NUMBER_RE = re.compile(r"^(?:OWN)?0*(\d+)$", re.IGNORECASE)
_SITE_OWNER_KEYS = ("Owner", "owner", "OwnerID", "ownerId")


def owner_number(value: Any) -> int | None:
    """Return the numeric suffix of an OwnerID, or None if it is not OWN### / digits."""
    text = str(value or "").strip()
    if not text:
        return None
    match = _OWNER_NUMBER_RE.fullmatch(text)
    if not match:
        return None
    return int(match.group(1))


def scan_all(table) -> list[dict]:
    items: list[dict] = []
    kwargs: dict[str, Any] = {}
    while True:
        response = table.scan(**kwargs)
        items.extend(response.get("Items", []))
        last = response.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    return items


def site_owner_values(item: dict) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for key in _SITE_OWNER_KEYS:
        if key not in item or item[key] is None:
            continue
        text = str(item[key]).strip()
        if text and text not in seen:
            seen.add(text)
            values.append(text)
    return values


def resolve_owners_by_number(
    owner_items: Iterable[dict], numbers: Iterable[int]
) -> dict[int, dict]:
    wanted = set(numbers)
    found: dict[int, dict] = {}
    for item in owner_items:
        owner_id = str(item.get("OwnerID") or item.get("ownerId") or "").strip()
        number = owner_number(owner_id)
        if number not in wanted:
            continue
        previous = found.get(number)
        if previous is not None:
            prev_id = str(previous.get("OwnerID") or "")
            raise RuntimeError(
                f"Multiple owners match number {number:02d}: {prev_id!r} and {owner_id!r}"
            )
        found[number] = item
    return found


def site_needs_reassign(
    item: dict,
    *,
    delete_ids: set[str],
    delete_names: set[str],
    keep_id: str,
) -> bool:
    """True when this site still references a duplicate owner (ID or shared name)."""
    values = site_owner_values(item)
    if not values:
        return False
    if keep_id in values and not (set(values) & delete_ids):
        return False
    for value in values:
        if value in delete_ids:
            return True
        if owner_number(value) in DELETE_OWNER_NUMBERS:
            return True
        if value in delete_names:
            return True
    return False


def update_site_owner(sites_table, item: dict, keep_id: str, *, dry_run: bool) -> str:
    site_id = str(item.get("SiteID") or "").strip()
    old_values = site_owner_values(item)
    old_display = ", ".join(old_values) if old_values else "(empty)"
    if dry_run:
        return f"site {site_id}: would set Owner {old_display!r} -> {keep_id}"

    names = {"#owner": "Owner"}
    values = {":keep": keep_id}
    update_expr = "SET #owner = :keep"
    if any(key in item for key in ("OwnerID", "ownerId")):
        names["#ownerId"] = "OwnerID"
        update_expr += ", #ownerId = :keep"

    sites_table.update_item(
        Key={"SiteID": site_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ConditionExpression="attribute_exists(SiteID)",
    )
    return f"site {site_id}: Owner {old_display!r} -> {keep_id}"


def delete_owner_record(owners_table, owner_id: str, *, dry_run: bool) -> str:
    if dry_run:
        return f"owner {owner_id}: would delete"
    owners_table.delete_item(
        Key={"OwnerID": owner_id},
        ConditionExpression="attribute_exists(OwnerID)",
    )
    return f"owner {owner_id}: deleted"


def consolidate(
    owners_table,
    sites_table,
    *,
    dry_run: bool,
) -> dict[str, Any]:
    owner_items = scan_all(owners_table)
    site_items = scan_all(sites_table)

    resolved = resolve_owners_by_number(
        owner_items, DELETE_OWNER_NUMBERS | {KEEP_OWNER_NUMBER}
    )
    keep_item = resolved.get(KEEP_OWNER_NUMBER)
    if not keep_item:
        raise RuntimeError(
            f"Keep owner {KEEP_OWNER_NUMBER:02d} (OWN{KEEP_OWNER_NUMBER:03d}) was not found"
        )
    keep_id = str(keep_item.get("OwnerID") or "").strip()
    keep_name = str(keep_item.get("Name") or keep_item.get("name") or "").strip()

    delete_items = []
    missing_delete_numbers = []
    for number in sorted(DELETE_OWNER_NUMBERS):
        item = resolved.get(number)
        if item is None:
            missing_delete_numbers.append(number)
            continue
        delete_items.append(item)

    delete_ids = {
        str(item.get("OwnerID") or "").strip()
        for item in delete_items
        if str(item.get("OwnerID") or "").strip()
    }
    # Only remap free-text names that belong to the duplicate Crystal Asset
    # Management records (same name as the owner we are keeping).
    delete_names = {
        str(item.get("Name") or item.get("name") or "").strip()
        for item in delete_items
        if str(item.get("Name") or item.get("name") or "").strip() == keep_name
    }

    site_messages: list[str] = []
    updated_site_ids: list[str] = []
    already_keep: list[str] = []
    for item in site_items:
        site_id = str(item.get("SiteID") or "").strip()
        values = site_owner_values(item)
        if keep_id in values and not site_needs_reassign(
            item, delete_ids=delete_ids, delete_names=delete_names, keep_id=keep_id
        ):
            already_keep.append(site_id)
            continue
        if not site_needs_reassign(
            item, delete_ids=delete_ids, delete_names=delete_names, keep_id=keep_id
        ):
            continue
        site_messages.append(
            update_site_owner(sites_table, item, keep_id, dry_run=dry_run)
        )
        updated_site_ids.append(site_id)

    owner_messages: list[str] = []
    deleted_owner_ids: list[str] = []
    for item in delete_items:
        owner_id = str(item.get("OwnerID") or "").strip()
        if owner_id == keep_id:
            raise RuntimeError(f"Refusing to delete keep owner {keep_id}")
        owner_messages.append(
            delete_owner_record(owners_table, owner_id, dry_run=dry_run)
        )
        deleted_owner_ids.append(owner_id)

    return {
        "keep_id": keep_id,
        "keep_name": keep_name,
        "updated_site_ids": updated_site_ids,
        "already_keep_site_ids": already_keep,
        "deleted_owner_ids": deleted_owner_ids,
        "missing_delete_numbers": missing_delete_numbers,
        "site_messages": site_messages,
        "owner_messages": owner_messages,
        "sites_scanned": len(site_items),
        "owners_scanned": len(owner_items),
    }


def print_report(result: dict[str, Any], *, dry_run: bool) -> None:
    mode = "DRY-RUN" if dry_run else "EXECUTE"
    print(f"[{mode}] Consolidate duplicate owners in {OWNERS_TABLE_NAME} / {SITES_TABLE_NAME}")
    print(f"Keep owner: {result['keep_id']} ({result['keep_name'] or 'unnamed'})")
    print(f"Owners scanned: {result['owners_scanned']}")
    print(f"Sites scanned: {result['sites_scanned']}")
    print(f"Sites already on {result['keep_id']}: {len(result['already_keep_site_ids'])}")
    if result["already_keep_site_ids"]:
        print("  " + ", ".join(result["already_keep_site_ids"]))
    print(f"Sites updated: {len(result['updated_site_ids'])}")
    for message in result["site_messages"]:
        print(f"  {message}")
    if result["missing_delete_numbers"]:
        missing = ", ".join(f"{n:02d}" for n in result["missing_delete_numbers"])
        print(f"Delete owners already absent: {missing}")
    print(f"Owners deleted: {len(result['deleted_owner_ids'])}")
    for message in result["owner_messages"]:
        print(f"  {message}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned actions without writing to DynamoDB",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Reassign sites and delete duplicate owners (required unless --dry-run)",
    )
    args = parser.parse_args(argv)
    if not args.dry_run and not args.execute:
        parser.error("Pass --dry-run or --execute")

    sanitize_aws_env()
    ddb = dynamodb_resource()
    owners_table = ddb.Table(os.environ.get("NOVARA_OWNERS_TABLE", OWNERS_TABLE_NAME))
    sites_table = ddb.Table(os.environ.get("NOVARA_SITES_TABLE", SITES_TABLE_NAME))

    result = consolidate(owners_table, sites_table, dry_run=args.dry_run)
    print_report(result, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
