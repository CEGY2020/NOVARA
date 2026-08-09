#!/usr/bin/env python3
"""Import temperature readings from CSV or Excel into NOVARAReadings.

Expected columns (header names are case-insensitive; aliases accepted):

  Required:
    SiteID        — e.g. SITE001 (aliases: Site Id, site_id, Site)
    TimestampUTC  — ISO-8601 UTC preferred (aliases: Timestamp, DateTime, Time)
    T1            — supply temperature °F (aliases: t1, Supply, SupplyTemp)
    T2            — return temperature °F (aliases: t2, Return, ReturnTemp)

  Optional:
    RelayState    — numeric relay state (aliases: Relay, relay_state)

Place files under data/readings/ (recommended), then run:

  python3 scripts/import_readings.py data/readings/my_export.csv --dry-run
  python3 scripts/import_readings.py data/readings/my_export.csv --execute

DynamoDB keys are SiteID (HASH) + TimestampUTC (RANGE). By default, existing
keys are skipped so re-imports are safe. Use --overwrite to replace values.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

# Allow importing novara_api helpers when run from repo root or scripts/.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from novara_api import TABLE_NAME, dynamodb_resource, sanitize_aws_env  # noqa: E402

SITE_ID_RE = re.compile(r"^SITE\d{3,}$", re.IGNORECASE)

COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "SiteID": (
        "siteid",
        "site_id",
        "site id",
        "site",
        "siteidentifier",
        "site_identifier",
    ),
    "TimestampUTC": (
        "timestamputc",
        "timestamp_utc",
        "timestamp utc",
        "timestamp",
        "datetime",
        "date_time",
        "date time",
        "time",
        "date",
        "readingtime",
        "reading_time",
        "recordedat",
        "recorded_at",
    ),
    "T1": ("t1", "supply", "supplytemp", "supply_temp", "supply temperature", "temp1"),
    "T2": ("t2", "return", "returntemp", "return_temp", "return temperature", "temp2"),
    "RelayState": (
        "relaystate",
        "relay_state",
        "relay state",
        "relay",
        "relaystatus",
        "relay_status",
    ),
}


def normalize_header(name: str) -> str:
    text = (name or "").strip().lower()
    text = text.replace("-", " ").replace("/", " ")
    text = re.sub(r"\s+", " ", text)
    return text


def resolve_columns(headers: list[str]) -> dict[str, str]:
    """Map canonical field -> actual header name present in the file."""
    by_norm = {normalize_header(h): h for h in headers if str(h).strip()}
    resolved: dict[str, str] = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in by_norm:
                resolved[canonical] = by_norm[alias]
                break
    return resolved


def parse_site_id(value: Any, site_map: dict[str, str], default_site: str | None) -> str:
    raw = "" if value is None else str(value).strip()
    if not raw:
        if default_site:
            return default_site.upper()
        raise ValueError("SiteID is empty (provide column or --default-site-id)")
    mapped = site_map.get(raw) or site_map.get(raw.upper())
    site_id = (mapped or raw).strip().upper()
    if not SITE_ID_RE.match(site_id):
        raise ValueError(
            f"SiteID '{raw}' is not SITE### "
            f"(map it with --site-map {raw}=SITE001 or use that form in the file)"
        )
    return site_id


def _excel_serial_to_utc(serial: float) -> datetime:
    # Excel serial date: days since 1899-12-30 (Windows / openpyxl convention).
    from datetime import timedelta

    epoch = datetime(1899, 12, 30, tzinfo=timezone.utc)
    return epoch + timedelta(days=float(serial))


def parse_timestamp_utc(value: Any) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValueError("TimestampUTC is empty")

    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        # Likely an Excel serial date.
        if 20000 < float(value) < 80000:
            return _excel_serial_to_utc(float(value)).strftime("%Y-%m-%dT%H:%M:%SZ")
        raise ValueError(f"Unrecognized numeric timestamp: {value}")

    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    # Common export forms: "2026-08-01 14:30:00" / "2026-08-01T14:30:00"
    candidates = [text]
    if " " in text and "T" not in text:
        candidates.append(text.replace(" ", "T", 1))

    for candidate in candidates:
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            pass

    for fmt in (
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%m/%d/%Y",
        "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            continue

    raise ValueError(f"Unrecognized timestamp: {value!r}")


def parse_number(value: Any, field: str, *, required: bool = True) -> Decimal | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise ValueError(f"{field} is empty")
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a number")
    try:
        return Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{field} must be a number (got {value!r})") from exc


def parse_site_map(pairs: list[str] | None) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for pair in pairs or []:
        if "=" not in pair:
            raise ValueError(f"Invalid --site-map entry '{pair}' (use OLD=SITE001)")
        old, new = pair.split("=", 1)
        old = old.strip()
        new = new.strip().upper()
        if not old or not SITE_ID_RE.match(new):
            raise ValueError(f"Invalid --site-map entry '{pair}' (target must be SITE###)")
        mapping[old] = new
        mapping[old.upper()] = new
    return mapping


def row_to_item(
    row: dict[str, Any],
    columns: dict[str, str],
    *,
    site_map: dict[str, str],
    default_site: str | None,
) -> dict[str, Any]:
    missing = [name for name in ("TimestampUTC", "T1", "T2") if name not in columns]
    if "SiteID" not in columns and not default_site:
        missing.append("SiteID")
    if missing:
        raise ValueError(f"Missing required column(s): {', '.join(missing)}")

    site_raw = row.get(columns["SiteID"]) if "SiteID" in columns else None
    item: dict[str, Any] = {
        "SiteID": parse_site_id(site_raw, site_map, default_site),
        "TimestampUTC": parse_timestamp_utc(row.get(columns["TimestampUTC"])),
        "T1": parse_number(row.get(columns["T1"]), "T1"),
        "T2": parse_number(row.get(columns["T2"]), "T2"),
    }
    if "RelayState" in columns:
        relay = parse_number(row.get(columns["RelayState"]), "RelayState", required=False)
        if relay is not None:
            item["RelayState"] = relay
    return item


def _read_csv_rows(path: Path) -> tuple[list[str], list[dict[str, Any]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(4096)
        handle.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(handle, dialect=dialect)
        if not reader.fieldnames:
            raise ValueError("CSV has no header row")
        headers = [str(h) for h in reader.fieldnames]
        rows = [dict(row) for row in reader]
    return headers, rows


def _read_excel_rows(path: Path) -> tuple[list[str], list[dict[str, Any]]]:
    try:
        from openpyxl import load_workbook
    except ImportError as exc:
        raise RuntimeError(
            "Excel support requires openpyxl. Install with: pip install openpyxl\n"
            "Or export the sheet as CSV and import that instead."
        ) from exc

    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    rows_iter = sheet.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration as exc:
        raise ValueError("Excel sheet is empty") from exc

    headers = ["" if h is None else str(h).strip() for h in header_row]
    if not any(headers):
        raise ValueError("Excel sheet has no header row")

    rows: list[dict[str, Any]] = []
    for values in rows_iter:
        if values is None or all(v is None or str(v).strip() == "" for v in values):
            continue
        row: dict[str, Any] = {}
        for idx, header in enumerate(headers):
            if not header:
                continue
            row[header] = values[idx] if idx < len(values) else None
        rows.append(row)
    return headers, rows


def load_rows(path: Path) -> tuple[list[str], list[dict[str, Any]]]:
    suffix = path.suffix.lower()
    if suffix in {".csv", ".txt", ".tsv"}:
        return _read_csv_rows(path)
    if suffix in {".xlsx", ".xlsm"}:
        return _read_excel_rows(path)
    raise ValueError(
        f"Unsupported file type '{suffix}'. Use .csv or .xlsx "
        "(legacy .xls is not supported — re-save as .xlsx or .csv)."
    )


def parse_items(
    path: Path,
    *,
    site_map: dict[str, str],
    default_site: str | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    headers, rows = load_rows(path)
    columns = resolve_columns(headers)
    items: list[dict[str, Any]] = []
    errors: list[str] = []
    for index, row in enumerate(rows, start=2):  # header is row 1
        if not any(str(v).strip() for v in row.values() if v is not None):
            continue
        try:
            items.append(
                row_to_item(
                    row,
                    columns,
                    site_map=site_map,
                    default_site=default_site,
                )
            )
        except ValueError as exc:
            errors.append(f"row {index}: {exc}")
    return items, errors


def dedupe_items(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Keep the last occurrence of each SiteID+TimestampUTC within the file."""
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for item in items:
        by_key[(item["SiteID"], item["TimestampUTC"])] = item
    return list(by_key.values()), len(items) - len(by_key)


def put_items(
    table,
    items: Iterable[dict[str, Any]],
    *,
    overwrite: bool,
    dry_run: bool,
) -> dict[str, int]:
    written = 0
    skipped = 0
    overwritten = 0
    errors = 0

    for item in items:
        if dry_run:
            written += 1
            continue
        try:
            if overwrite:
                table.put_item(Item=item)
                overwritten += 1
            else:
                table.put_item(
                    Item=item,
                    ConditionExpression=(
                        "attribute_not_exists(SiteID) AND attribute_not_exists(TimestampUTC)"
                    ),
                )
                written += 1
        except Exception as exc:  # noqa: BLE001 — treat conditional failures as skips
            error_code = ""
            response = getattr(exc, "response", None)
            if isinstance(response, dict):
                error_code = str((response.get("Error") or {}).get("Code") or "")
            if (
                error_code == "ConditionalCheckFailedException"
                or type(exc).__name__ == "ConditionalCheckFailedException"
                or "ConditionalCheckFailed" in str(exc)
            ):
                skipped += 1
                continue
            errors += 1
            print(
                f"ERROR writing {item.get('SiteID')}/{item.get('TimestampUTC')}: {exc}",
                file=sys.stderr,
            )

    return {
        "written": written,
        "skipped": skipped,
        "overwritten": overwritten,
        "errors": errors,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "files",
        nargs="+",
        type=Path,
        help="CSV or Excel files to import (place under data/readings/)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and validate without writing to DynamoDB",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Write items to DynamoDB (required unless --dry-run)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing SiteID+TimestampUTC items (default: skip duplicates)",
    )
    parser.add_argument(
        "--default-site-id",
        help="SiteID to use when the file has no SiteID column (e.g. SITE001)",
    )
    parser.add_argument(
        "--site-map",
        action="append",
        default=[],
        metavar="OLD=SITE001",
        help="Map a source site identifier to SITE### (repeatable)",
    )
    parser.add_argument(
        "--table",
        default=os.environ.get("NOVARA_READINGS_TABLE", TABLE_NAME),
        help=f"DynamoDB table name (default: {TABLE_NAME})",
    )
    args = parser.parse_args(argv)

    if not args.dry_run and not args.execute:
        parser.error("Pass --dry-run or --execute")

    try:
        site_map = parse_site_map(args.site_map)
    except ValueError as exc:
        parser.error(str(exc))

    default_site = args.default_site_id.strip().upper() if args.default_site_id else None
    if default_site and not SITE_ID_RE.match(default_site):
        parser.error("--default-site-id must look like SITE001")

    all_items: list[dict[str, Any]] = []
    had_errors = False
    for path in args.files:
        if not path.is_file():
            print(f"ERROR: file not found: {path}", file=sys.stderr)
            had_errors = True
            continue
        print(f"Reading {path} …")
        try:
            items, errors = parse_items(
                path,
                site_map=site_map,
                default_site=default_site,
            )
        except (ValueError, RuntimeError) as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            had_errors = True
            continue
        for err in errors[:20]:
            print(f"  {err}", file=sys.stderr)
        if len(errors) > 20:
            print(f"  … and {len(errors) - 20} more row errors", file=sys.stderr)
        if errors:
            had_errors = True
        print(f"  parsed {len(items)} row(s), {len(errors)} error(s)")
        all_items.extend(items)

    if not all_items:
        print("No valid readings to import.")
        return 1 if had_errors else 0

    unique_items, file_dupes = dedupe_items(all_items)
    if file_dupes:
        print(f"Collapsed {file_dupes} duplicate key(s) within input (kept last).")

    sites = sorted({item["SiteID"] for item in unique_items})
    print(
        f"Ready: {len(unique_items)} item(s) across site(s) {', '.join(sites)} "
        f"→ table {args.table}"
    )
    if unique_items:
        sample = unique_items[0]
        print(
            "Sample item:",
            {
                "SiteID": sample["SiteID"],
                "TimestampUTC": sample["TimestampUTC"],
                "T1": float(sample["T1"]),
                "T2": float(sample["T2"]),
                **(
                    {"RelayState": float(sample["RelayState"])}
                    if "RelayState" in sample
                    else {}
                ),
            },
        )

    if args.dry_run:
        print("[DRY-RUN] No writes performed.")
        return 1 if had_errors else 0

    sanitize_aws_env()
    table = dynamodb_resource().Table(args.table)
    stats = put_items(
        table,
        unique_items,
        overwrite=args.overwrite,
        dry_run=False,
    )
    if args.overwrite:
        print(f"Wrote/overwrote {stats['overwritten']} item(s); errors={stats['errors']}")
    else:
        print(
            f"Wrote {stats['written']} new item(s); "
            f"skipped {stats['skipped']} existing; errors={stats['errors']}"
        )
    if stats["errors"] or had_errors:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
