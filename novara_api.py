"""Shared NOVARA DynamoDB API helpers (local server + Amplify Lambda)."""

from __future__ import annotations

import base64
import hashlib
import html
import json
import logging
import os
import re
import secrets
import traceback
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from email import policy
from email.parser import BytesParser
from typing import Any
from urllib.parse import parse_qs, unquote, urlencode

TABLE_NAME = os.environ.get("NOVARA_READINGS_TABLE", "NOVARAReadings")
SITES_TABLE_NAME = os.environ.get("NOVARA_SITES_TABLE", "NOVARASites")
SYSTEMS_TABLE_NAME = os.environ.get("NOVARA_SYSTEMS_TABLE", "NOVARASystems")
PHOTOS_TABLE_NAME = os.environ.get("NOVARA_PHOTOS_TABLE", "NOVARAPhotos")
PHOTOS_BUCKET_NAME = (os.environ.get("NOVARA_PHOTOS_BUCKET") or "").strip()
PHOTOS_LOCAL_DIR = os.environ.get(
    "NOVARA_PHOTOS_LOCAL_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".novara-photos"),
)
OWNERS_TABLE_NAME = os.environ.get("NOVARA_OWNERS_TABLE", "NOVARAOwners")
MGMT_COMPANIES_TABLE_NAME = os.environ.get(
    "NOVARA_MGMT_COMPANIES_TABLE", "NOVARAMgmtCompanies"
)
LEADS_TABLE_NAME = os.environ.get("NOVARA_LEADS_TABLE", "NOVARALeads")
USERS_TABLE_NAME = os.environ.get("NOVARA_USERS_TABLE", "NOVARAUsers")
PREAPPROVED_TABLE_NAME = os.environ.get(
    "NOVARA_PREAPPROVED_TABLE", "NOVARAPreapprovedEmails"
)
DEFAULT_SITE_ID = "SITE001"
MAX_POINTS = int(os.environ.get("NOVARA_MAX_CHART_POINTS", "720"))
ADMIN_ALERT_EMAIL = (
    os.environ.get("NOVARA_ADMIN_ALERT_EMAIL") or "steve@cegy.us"
).strip().lower()
SES_FROM_EMAIL = (
    os.environ.get("NOVARA_SES_FROM_EMAIL") or ADMIN_ALERT_EMAIL or "steve@cegy.us"
).strip()
APP_BASE_URL = (os.environ.get("NOVARA_APP_BASE_URL") or "").rstrip("/")
_LOGGER = logging.getLogger("novara_api")

SYSTEM_TYPES = ("DHW", "Pool", "HVAC")
SITE_STATUSES = ("Online", "Offline", "Needs Review")
SYSTEM_RECORD_TYPES = ("DHW", "Pool", "HVAC", "Boiler")
SYSTEM_RECORD_STATUSES = ("Online", "Offline", "Needs Review", "Maintenance")
PHOTO_TYPES = ("Property", "System", "Equipment", "Nameplate", "Other")
PHOTO_CONTENT_TYPES = (
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
    "image/heif",
)
PRESIGNED_UPLOAD_TTL_SECONDS = int(
    os.environ.get("NOVARA_PHOTOS_UPLOAD_TTL", "900")
)
PRESIGNED_VIEW_TTL_SECONDS = int(
    os.environ.get("NOVARA_PHOTOS_VIEW_TTL", "3600")
)
LEAD_SOURCES = (
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
)
LEAD_SYSTEM_TYPES = ("DHW NG", "DHW kW", "Pool", "HVAC", "Other")
LEAD_STAGES = (
    "New Lead",
    "Contacted",
    "Qualified",
    "Proposal Sent",
    "Won",
    "Lost",
)
USER_ROLES = ("aem", "owner", "contractor", "sales")
USER_STATUSES = ("Pending", "Active", "Rejected")
USER_ROLE_LABELS = {
    "aem": "AEM",
    "owner": "Owner",
    "contractor": "Contractor",
    "sales": "Sales",
}
# Seed emails for NOVARAPreapprovedEmails (lowercase).
# Override/extend via NOVARA_PREAPPROVED_EMAILS (comma-separated).
_DEFAULT_PREAPPROVED_EMAILS = (
    "steve@aemenergy.com",
    "admin@novara.com",
    "ops@novara.com",
)
_PREAPPROVED_SEED_MARKER = "__novara_seeded__"


def _env_preapproved_emails() -> frozenset[str]:
    raw = (os.environ.get("NOVARA_PREAPPROVED_EMAILS") or "").strip()
    if not raw:
        return frozenset(_DEFAULT_PREAPPROVED_EMAILS)
    emails = {part.strip().lower() for part in raw.split(",") if part.strip()}
    return frozenset(emails) if emails else frozenset(_DEFAULT_PREAPPROVED_EMAILS)


# Backward-compatible snapshot used by tests / env-only fallbacks.
PREAPPROVED_EMAILS = _env_preapproved_emails()
PASSWORD_HASH_ITERATIONS = 120_000
# Browser sessions stay valid for 30 days (Remember me / localStorage).
SESSION_TTL_SECONDS = int(os.environ.get("NOVARA_SESSION_TTL_SECONDS", str(30 * 24 * 3600)))
_USER_ID_PATTERN = re.compile(r"^USR(\d+)$", re.IGNORECASE)
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_systems_table_ready = False
_photos_table_ready = False
_owners_table_ready = False
_mgmt_companies_table_ready = False
_leads_table_ready = False
_users_table_ready = False
_preapproved_table_ready = False
_readings_table_ready = False
# Multi-system readings use TimestampUTC sort keys like 2026-08-05T07:00:00Z#SYS001
_READING_SORT_SYSTEM_RE = re.compile(r"#(SYS\d+)$", re.IGNORECASE)
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_aws_env() -> None:
    """Drop placeholder/invalid session tokens that break long-term IAM keys."""
    access_key = (os.environ.get("AWS_ACCESS_KEY_ID") or "").strip()
    session_token = (os.environ.get("AWS_SESSION_TOKEN") or "").strip()
    if not session_token:
        os.environ.pop("AWS_SESSION_TOKEN", None)
        return
    if access_key.startswith("AKIA") or len(session_token) < 100:
        os.environ.pop("AWS_SESSION_TOKEN", None)


def dynamodb_resource():
    import boto3

    sanitize_aws_env()
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    if region:
        region = region.strip()
    if not region:
        # Lambda always provides AWS_REGION; local/dev must set it explicitly.
        raise RuntimeError(
            "AWS_REGION (or AWS_DEFAULT_REGION) must be set to query DynamoDB."
        )
    return boto3.resource("dynamodb", region_name=region)


def dynamodb_table(table_name: str = TABLE_NAME):
    return dynamodb_resource().Table(table_name)


def reading_sort_key(timestamp_utc: str, system_id: str | None) -> str:
    """Build DynamoDB TimestampUTC sort key; append #SystemID when present."""
    ts = (timestamp_utc or "").strip()
    system = (system_id or "").strip().upper()
    if system:
        return f"{ts}#{system}"
    return ts


def split_reading_sort_key(sort_key: str) -> tuple[str, str | None]:
    """Split ``{iso}#{SystemID}`` back into timestamp + system (or plain iso)."""
    text = "" if sort_key is None else str(sort_key)
    match = _READING_SORT_SYSTEM_RE.search(text)
    if not match:
        return text, None
    return text[: match.start()], match.group(1).upper()


def ensure_readings_table() -> str:
    """Create NOVARAReadings if missing (pay-per-request, SiteID + TimestampUTC)."""
    global _readings_table_ready
    if _readings_table_ready:
        return TABLE_NAME

    from botocore.exceptions import ClientError

    client = dynamodb_resource().meta.client
    try:
        client.describe_table(TableName=TABLE_NAME)
        _readings_table_ready = True
        return TABLE_NAME
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceNotFoundException":
            raise

    try:
        client.create_table(
            TableName=TABLE_NAME,
            AttributeDefinitions=[
                {"AttributeName": "SiteID", "AttributeType": "S"},
                {"AttributeName": "TimestampUTC", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "SiteID", "KeyType": "HASH"},
                {"AttributeName": "TimestampUTC", "KeyType": "RANGE"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceInUseException":
            raise

    waiter = client.get_waiter("table_exists")
    waiter.wait(
        TableName=TABLE_NAME,
        WaiterConfig={"Delay": 2, "MaxAttempts": 30},
    )
    _readings_table_ready = True
    return TABLE_NAME


def json_safe(value: Any) -> Any:
    """Convert DynamoDB types (Decimal, sets, etc.) into JSON-serializable values."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(v) for v in value]
    return str(value)


def first_present(item: dict, keys: tuple[str, ...], default=None):
    for key in keys:
        if key in item and item[key] is not None and item[key] != "":
            return item[key]
    return default


def systems_count(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple, set)):
        return len(value)
    if isinstance(value, dict):
        return len(value)
    if isinstance(value, Decimal):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            return int(text)
    return None


def normalize_system_type(value) -> str:
    text = "" if value is None else str(value).strip()
    if not text:
        return ""
    lower = text.lower()
    if text in SYSTEM_RECORD_TYPES or text in SYSTEM_TYPES:
        return text
    if "pool" in lower:
        return "Pool"
    if "hvac" in lower:
        return "HVAC"
    if "boiler" in lower:
        return "Boiler"
    if "dhw" in lower or "domestic" in lower or "hot water" in lower:
        return "DHW"
    return text


def ensure_systems_table() -> str:
    """Create NOVARASystems if missing (pay-per-request, SystemID hash key)."""
    global _systems_table_ready
    if _systems_table_ready:
        return SYSTEMS_TABLE_NAME

    from botocore.exceptions import ClientError

    client = dynamodb_resource().meta.client
    try:
        client.describe_table(TableName=SYSTEMS_TABLE_NAME)
        _systems_table_ready = True
        return SYSTEMS_TABLE_NAME
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceNotFoundException":
            raise

    try:
        client.create_table(
            TableName=SYSTEMS_TABLE_NAME,
            AttributeDefinitions=[
                {"AttributeName": "SystemID", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "SystemID", "KeyType": "HASH"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceInUseException":
            raise

    waiter = client.get_waiter("table_exists")
    waiter.wait(
        TableName=SYSTEMS_TABLE_NAME,
        WaiterConfig={"Delay": 2, "MaxAttempts": 30},
    )
    _systems_table_ready = True
    return SYSTEMS_TABLE_NAME


def normalize_system(item: dict, *, site_name: str | None = None) -> dict:
    system_id = first_present(item, ("SystemID", "systemId", "system_id", "id"))
    site_id = first_present(item, ("SiteID", "siteId", "site_id"), default="")
    name = first_present(
        item,
        ("SystemName", "systemName", "Name", "name"),
        default=system_id or "Unknown system",
    )
    system_type = normalize_system_type(
        first_present(item, ("SystemType", "systemType", "system_type"), default="")
    )
    status = first_present(
        item,
        ("Status", "status", "SystemStatus", "systemStatus"),
        default="Online",
    )
    equipment_raw = first_present(
        item,
        ("EquipmentCount", "equipmentCount", "equipment_count", "Equipment"),
        default=0,
    )
    equipment = systems_count(equipment_raw)
    if equipment is None:
        equipment = 0
    install_date = first_present(
        item, ("InstallDate", "installDate", "install_date"), default=""
    )
    notes = first_present(item, ("Notes", "notes"), default="")
    updated_at = first_present(
        item, ("UpdatedAt", "updatedAt", "updated_at", "LastUpdate", "lastUpdate"),
        default="",
    )
    resolved_site_name = site_name
    if resolved_site_name is None:
        resolved_site_name = first_present(
            item, ("SiteName", "siteName", "site_name"), default=""
        )
    return {
        "systemId": "" if system_id is None else str(system_id),
        "siteId": "" if site_id is None else str(site_id),
        "siteName": str(resolved_site_name or ""),
        "systemName": str(name),
        "name": str(name),
        "systemType": system_type,
        "status": str(status),
        "equipmentCount": equipment,
        "installDate": str(install_date or ""),
        "notes": str(notes or ""),
        "updatedAt": str(updated_at or ""),
        "lastUpdate": str(updated_at or ""),
    }


def derive_site_status_from_systems(statuses: list[str] | tuple[str, ...]) -> str | None:
    """
    Roll up linked system statuses into a site Status (SITE_STATUSES).

    Priority: Offline > Needs Review (incl. Maintenance) > Online.
    Returns None when there are no systems to derive from.
    """
    if not statuses:
        return None
    normalized = [str(status or "").strip() for status in statuses if str(status or "").strip()]
    if not normalized:
        return None
    lowered = [status.lower() for status in normalized]
    if any("offline" in status or "critical" in status for status in lowered):
        return "Offline"
    if any(
        "review" in status
        or "maintenance" in status
        or "warn" in status
        or "alarm" in status
        for status in lowered
    ):
        return "Needs Review"
    if any(
        "online" in status or status in ("ok", "normal") for status in lowered
    ):
        return "Online"
    return "Needs Review"


def summarize_systems_by_site() -> dict[str, dict]:
    """Return {SiteID: {"count": int, "statuses": [str, ...]}} from NOVARASystems."""
    ensure_systems_table()
    table = dynamodb_table(SYSTEMS_TABLE_NAME)
    summary: dict[str, dict] = {}
    scan_kwargs = {
        "ProjectionExpression": "SiteID, #status",
        "ExpressionAttributeNames": {"#status": "Status"},
    }
    while True:
        response = table.scan(**scan_kwargs)
        for item in response.get("Items", []):
            site_id = item.get("SiteID")
            if not site_id:
                continue
            key = str(site_id)
            bucket = summary.setdefault(key, {"count": 0, "statuses": []})
            bucket["count"] += 1
            status = item.get("Status")
            if status is not None and str(status).strip():
                bucket["statuses"].append(str(status).strip())
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key
    return summary


def count_systems_by_site() -> dict[str, int]:
    """Return {SiteID: count} from NOVARASystems."""
    return {
        site_id: int(info.get("count") or 0)
        for site_id, info in summarize_systems_by_site().items()
    }


def scan_systems() -> dict:
    ensure_systems_table()
    table = dynamodb_table(SYSTEMS_TABLE_NAME)
    items = []
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    site_names: dict[str, str] = {}
    try:
        sites_payload = scan_sites(include_system_counts=False)
        for site in sites_payload.get("sites") or []:
            site_id = site.get("siteId")
            if site_id:
                site_names[str(site_id)] = site.get("name") or site.get("siteName") or ""
    except Exception:  # noqa: BLE001
        traceback.print_exc()

    systems = [
        normalize_system(
            json_safe(item),
            site_name=site_names.get(str(first_present(item, ("SiteID", "siteId"), default=""))),
        )
        for item in items
    ]
    systems.sort(
        key=lambda row: (
            (row.get("siteName") or "").lower(),
            (row.get("systemName") or "").lower(),
            (row.get("systemId") or "").lower(),
        )
    )
    return {
        "table": SYSTEMS_TABLE_NAME,
        "count": len(systems),
        "systems": systems,
    }


def parse_system_payload(body: dict | None) -> tuple[dict | None, str | None]:
    """Validate and normalize an incoming system create/update payload."""
    if not isinstance(body, dict):
        return None, "JSON body is required"

    system_id = _as_text(
        body.get("SystemID") if "SystemID" in body else body.get("systemId")
    )
    site_id = _as_text(body.get("SiteID") if "SiteID" in body else body.get("siteId"))
    system_name = _as_text(
        body.get("SystemName") if "SystemName" in body else body.get("systemName")
    )
    if not system_id:
        return None, "SystemID is required"
    if not site_id:
        return None, "SiteID is required"
    if not system_name:
        return None, "SystemName is required"
    if len(system_id) > 64:
        return None, "SystemID must be 64 characters or fewer"
    if len(site_id) > 64:
        return None, "SiteID must be 64 characters or fewer"

    system_type = _as_text(
        body.get("SystemType") if "SystemType" in body else body.get("systemType")
    )
    if system_type:
        system_type = normalize_system_type(system_type)
        if system_type not in SYSTEM_RECORD_TYPES:
            return None, "SystemType must be one of: " + ", ".join(SYSTEM_RECORD_TYPES)
    else:
        return None, "SystemType is required"

    status = _as_text(body.get("Status") if "Status" in body else body.get("status"))
    if status and status not in SYSTEM_RECORD_STATUSES:
        return None, "Status must be one of: " + ", ".join(SYSTEM_RECORD_STATUSES)

    equipment_raw = (
        body.get("EquipmentCount")
        if "EquipmentCount" in body
        else body.get("equipmentCount")
    )
    equipment = 0
    if equipment_raw is not None and equipment_raw != "":
        try:
            equipment = int(equipment_raw)
        except (TypeError, ValueError):
            return None, "EquipmentCount must be a number"
        if equipment < 0:
            return None, "EquipmentCount must be zero or greater"

    install_date = _as_text(
        body.get("InstallDate") if "InstallDate" in body else body.get("installDate")
    )
    notes = _as_text(body.get("Notes") if "Notes" in body else body.get("notes"))

    # Confirm the linked site exists in NOVARASites.
    linked = get_site_item(site_id)
    if linked is None:
        return None, f"SiteID '{site_id}' was not found in {SITES_TABLE_NAME}"

    item = {
        "SystemID": system_id,
        "SiteID": site_id,
        "SystemName": system_name,
        "SystemType": system_type,
        "Status": status or "Online",
        "EquipmentCount": equipment,
        "InstallDate": install_date,
        "Notes": notes,
        "UpdatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "SiteName": linked.get("name") or linked.get("siteName") or "",
    }
    return item, None


def get_system_item(system_id: str) -> dict | None:
    """Fetch one system by SystemID, or None if missing."""
    if not system_id:
        return None
    ensure_systems_table()
    table = dynamodb_table(SYSTEMS_TABLE_NAME)
    response = table.get_item(Key={"SystemID": system_id})
    item = response.get("Item")
    if not item:
        return None
    return normalize_system(json_safe(item))


def save_system(item: dict, *, mode: str = "upsert") -> dict:
    """Write a system to DynamoDB. mode: create | update | upsert."""
    from botocore.exceptions import ClientError

    ensure_systems_table()
    table = dynamodb_table(SYSTEMS_TABLE_NAME)

    previous_site_id = ""
    if mode in ("update", "upsert"):
        try:
            existing = table.get_item(Key={"SystemID": item["SystemID"]}).get("Item") or {}
            previous_site_id = str(existing.get("SiteID") or "")
        except Exception:  # noqa: BLE001
            traceback.print_exc()

    kwargs = {"Item": item}
    if mode == "create":
        kwargs["ConditionExpression"] = "attribute_not_exists(SystemID)"
    elif mode == "update":
        kwargs["ConditionExpression"] = "attribute_exists(SystemID)"

    try:
        table.put_item(**kwargs)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            if mode == "create":
                raise ValueError(f"SystemID '{item['SystemID']}' already exists") from exc
            if mode == "update":
                raise LookupError(f"SystemID '{item['SystemID']}' was not found") from exc
        raise

    # Keep linked site Systems count + Status in sync with NOVARASystems.
    site_ids = {str(item.get("SiteID") or "")}
    if previous_site_id:
        site_ids.add(previous_site_id)
    for site_id in site_ids:
        if not site_id:
            continue
        try:
            _sync_site_from_systems(site_id)
        except Exception:  # noqa: BLE001
            traceback.print_exc()

    return {
        "ok": True,
        "table": SYSTEMS_TABLE_NAME,
        "system": normalize_system(item, site_name=item.get("SiteName")),
    }


def delete_system(system_id: str) -> dict:
    """Delete a system from NOVARASystems and refresh the linked site."""
    from botocore.exceptions import ClientError

    system_id = _as_text(system_id)
    if not system_id:
        raise ValueError("SystemID is required")

    ensure_systems_table()
    table = dynamodb_table(SYSTEMS_TABLE_NAME)
    existing = table.get_item(Key={"SystemID": system_id}).get("Item")
    if not existing:
        raise LookupError(f"SystemID '{system_id}' was not found")

    site_id = str(existing.get("SiteID") or "")
    try:
        table.delete_item(
            Key={"SystemID": system_id},
            ConditionExpression="attribute_exists(SystemID)",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            raise LookupError(f"SystemID '{system_id}' was not found") from exc
        raise

    if site_id:
        try:
            _sync_site_from_systems(site_id)
        except Exception:  # noqa: BLE001
            traceback.print_exc()

    return {
        "ok": True,
        "table": SYSTEMS_TABLE_NAME,
        "deleted": True,
        "systemId": system_id,
        "siteId": site_id,
    }


def photos_storage_mode() -> str:
    """Return 's3' when a bucket is configured, otherwise 'local'."""
    return "s3" if PHOTOS_BUCKET_NAME else "local"


def s3_client():
    import boto3

    sanitize_aws_env()
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    if region:
        region = region.strip()
    if not region:
        raise RuntimeError(
            "AWS_REGION (or AWS_DEFAULT_REGION) must be set to use S3 photo storage."
        )
    return boto3.client("s3", region_name=region)


def ensure_photos_table() -> str:
    """Create NOVARAPhotos if missing (pay-per-request, PhotoID hash + SiteID GSI)."""
    global _photos_table_ready
    if _photos_table_ready:
        return PHOTOS_TABLE_NAME

    from botocore.exceptions import ClientError

    client = dynamodb_resource().meta.client
    try:
        client.describe_table(TableName=PHOTOS_TABLE_NAME)
        _photos_table_ready = True
        return PHOTOS_TABLE_NAME
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceNotFoundException":
            raise

    try:
        client.create_table(
            TableName=PHOTOS_TABLE_NAME,
            AttributeDefinitions=[
                {"AttributeName": "PhotoID", "AttributeType": "S"},
                {"AttributeName": "SiteID", "AttributeType": "S"},
                {"AttributeName": "SystemID", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "PhotoID", "KeyType": "HASH"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "SiteID-index",
                    "KeySchema": [
                        {"AttributeName": "SiteID", "KeyType": "HASH"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
                {
                    "IndexName": "SystemID-index",
                    "KeySchema": [
                        {"AttributeName": "SystemID", "KeyType": "HASH"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
            ],
            BillingMode="PAY_PER_REQUEST",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceInUseException":
            raise

    waiter = client.get_waiter("table_exists")
    waiter.wait(
        TableName=PHOTOS_TABLE_NAME,
        WaiterConfig={"Delay": 2, "MaxAttempts": 30},
    )
    _photos_table_ready = True
    return PHOTOS_TABLE_NAME


def _safe_filename(name: str) -> str:
    text = _as_text(name) or "photo"
    text = text.replace("\\", "/").split("/")[-1]
    text = _SAFE_FILENAME_RE.sub("-", text).strip(".-")
    if not text:
        text = "photo"
    return text[:120]


def _normalize_photo_content_type(value: str | None) -> str:
    content_type = _as_text(value).lower()
    # Strip parameters such as "image/jpeg; charset=binary".
    if ";" in content_type:
        content_type = content_type.split(";", 1)[0].strip()
    if content_type == "image/jpg":
        content_type = "image/jpeg"
    if content_type not in PHOTO_CONTENT_TYPES:
        return ""
    return content_type


def _guess_photo_content_type(
    filename: str | None = None, content_type: str | None = None
) -> str:
    """Prefer an explicit MIME type; fall back to the file extension."""
    normalized = _normalize_photo_content_type(content_type)
    if normalized:
        return normalized
    ext = os.path.splitext(_as_text(filename))[1].lower()
    by_ext = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".heic": "image/heic",
        ".heif": "image/heif",
    }
    return by_ext.get(ext, "")


def _header_content_type(headers: dict | None) -> str:
    if not isinstance(headers, dict):
        return ""
    for key, value in headers.items():
        if str(key).lower() == "content-type":
            return _as_text(value)
    return ""


def is_multipart_content_type(content_type: str | None) -> bool:
    return "multipart/form-data" in _as_text(content_type).lower()


def parse_multipart_form(
    body: bytes, content_type: str
) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """Parse multipart/form-data into text fields and file parts."""
    ctype = _as_text(content_type)
    if not is_multipart_content_type(ctype):
        raise ValueError("Content-Type must be multipart/form-data")
    if not isinstance(body, (bytes, bytearray)):
        body = b""
    header = f"Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
    message = BytesParser(policy=policy.default).parsebytes(header + bytes(body))
    fields: dict[str, str] = {}
    files: list[dict[str, Any]] = []
    if not message.is_multipart():
        return fields, files
    for part in message.iter_parts():
        disposition = part.get_content_disposition()
        if disposition not in (None, "form-data", "inline", "attachment"):
            continue
        name = part.get_param("name", header="content-disposition") or ""
        name = str(name).strip()
        filename = part.get_filename()
        payload = part.get_payload(decode=True)
        if payload is None:
            payload = b""
        elif isinstance(payload, str):
            payload = payload.encode("utf-8")
        if filename:
            files.append(
                {
                    "name": name or "file",
                    "filename": str(filename),
                    "content_type": part.get_content_type() or "",
                    "data": bytes(payload),
                }
            )
            continue
        charset = part.get_content_charset() or "utf-8"
        fields[name] = bytes(payload).decode(charset, errors="replace")
    return fields, files


def _new_photo_id() -> str:
    return "PHO" + secrets.token_hex(6).upper()


def _photo_s3_key(site_id: str, system_id: str, photo_id: str, filename: str) -> str:
    safe_name = _safe_filename(filename)
    if system_id:
        return f"sites/{site_id}/systems/{system_id}/{photo_id}/{safe_name}"
    return f"sites/{site_id}/{photo_id}/{safe_name}"


def _local_photo_path(s3_key: str) -> str:
    # Keep relative keys under the local photos directory.
    relative = s3_key.replace("\\", "/").lstrip("/")
    return os.path.join(PHOTOS_LOCAL_DIR, relative)


def _ensure_local_photo_dir(path: str) -> None:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)


def _photo_public_url(s3_key: str, photo_id: str) -> str:
    if photos_storage_mode() == "s3":
        region = (
            os.environ.get("AWS_REGION")
            or os.environ.get("AWS_DEFAULT_REGION")
            or "us-east-1"
        ).strip()
        return f"https://{PHOTOS_BUCKET_NAME}.s3.{region}.amazonaws.com/{s3_key}"
    return f"/api/photos/{photo_id}/content"


def _presigned_upload_url(s3_key: str, content_type: str) -> str:
    if photos_storage_mode() != "s3":
        return f"/api/photos/upload/{s3_key}"
    client = s3_client()
    return client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": PHOTOS_BUCKET_NAME,
            "Key": s3_key,
            "ContentType": content_type,
        },
        ExpiresIn=PRESIGNED_UPLOAD_TTL_SECONDS,
    )


def _presigned_view_url(s3_key: str, photo_id: str) -> str:
    if photos_storage_mode() != "s3":
        return f"/api/photos/{photo_id}/content"
    client = s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": PHOTOS_BUCKET_NAME,
            "Key": s3_key,
        },
        ExpiresIn=PRESIGNED_VIEW_TTL_SECONDS,
    )


def normalize_photo(item: dict, *, include_view_url: bool = True) -> dict:
    photo_id = first_present(item, ("PhotoID", "photoId", "photo_id", "id"))
    site_id = first_present(item, ("SiteID", "siteId", "site_id"), default="")
    system_id = first_present(
        item, ("SystemID", "systemId", "system_id"), default=""
    )
    photo_type = first_present(
        item, ("PhotoType", "photoType", "photo_type"), default="Other"
    )
    caption = first_present(item, ("Caption", "caption"), default="")
    s3_key = first_present(item, ("S3Key", "s3Key", "s3_key", "Key"), default="")
    uploaded_at = first_present(
        item, ("UploadedAt", "uploadedAt", "uploaded_at"), default=""
    )
    uploaded_by = first_present(
        item, ("UploadedBy", "uploadedBy", "uploaded_by"), default=""
    )
    content_type = first_present(
        item, ("ContentType", "contentType", "content_type"), default=""
    )
    file_name = first_present(
        item, ("FileName", "fileName", "file_name", "Filename"), default=""
    )
    stored_url = first_present(item, ("Url", "URL", "url"), default="")
    view_url = stored_url
    if include_view_url and s3_key:
        try:
            view_url = _presigned_view_url(str(s3_key), str(photo_id or ""))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            view_url = stored_url or _photo_public_url(
                str(s3_key), str(photo_id or "")
            )
    return {
        "photoId": "" if photo_id is None else str(photo_id),
        "siteId": "" if site_id is None else str(site_id),
        "systemId": "" if system_id is None else str(system_id),
        "photoType": str(photo_type or "Other"),
        "caption": str(caption or ""),
        "s3Key": str(s3_key or ""),
        "url": str(view_url or ""),
        "uploadedAt": str(uploaded_at or ""),
        "uploadedBy": str(uploaded_by or ""),
        "contentType": str(content_type or ""),
        "fileName": str(file_name or ""),
    }


def parse_photo_payload(body: dict | None) -> tuple[dict | None, str | None]:
    """Validate and normalize an incoming photo create payload."""
    if not isinstance(body, dict):
        return None, "JSON body is required"

    site_id = _as_text(body.get("SiteID") if "SiteID" in body else body.get("siteId"))
    system_id = _as_text(
        body.get("SystemID") if "SystemID" in body else body.get("systemId")
    )
    photo_type = _as_text(
        body.get("PhotoType") if "PhotoType" in body else body.get("photoType")
    )
    caption = _as_text(body.get("Caption") if "Caption" in body else body.get("caption"))
    uploaded_by = _as_text(
        body.get("UploadedBy") if "UploadedBy" in body else body.get("uploadedBy")
    )
    content_type = _normalize_photo_content_type(
        body.get("ContentType")
        if "ContentType" in body
        else body.get("contentType")
    )
    file_name = _safe_filename(
        body.get("FileName")
        if "FileName" in body
        else body.get("fileName") or body.get("filename") or "photo.jpg"
    )

    if not site_id:
        return None, "SiteID is required"
    if len(site_id) > 64:
        return None, "SiteID must be 64 characters or fewer"
    if system_id and len(system_id) > 64:
        return None, "SystemID must be 64 characters or fewer"
    if not photo_type:
        photo_type = "Other"
    if photo_type not in PHOTO_TYPES:
        return None, "PhotoType must be one of: " + ", ".join(PHOTO_TYPES)
    if len(caption) > 500:
        return None, "Caption must be 500 characters or fewer"
    if not content_type:
        return None, "ContentType must be an image type (jpeg, png, gif, webp, heic)"

    linked_site = get_site_item(site_id)
    if linked_site is None:
        return None, f"SiteID '{site_id}' was not found in {SITES_TABLE_NAME}"

    if system_id:
        linked_system = get_system_item(system_id)
        if linked_system is None:
            return None, f"SystemID '{system_id}' was not found in {SYSTEMS_TABLE_NAME}"
        linked_site_id = str(linked_system.get("siteId") or "")
        if linked_site_id and linked_site_id != site_id:
            return None, (
                f"SystemID '{system_id}' belongs to SiteID '{linked_site_id}', "
                f"not '{site_id}'"
            )
        # Prefer the system's parent site when provided inconsistently.
        site_id = linked_site_id or site_id

    photo_id = _new_photo_id()
    s3_key = _photo_s3_key(site_id, system_id, photo_id, file_name)
    uploaded_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    item = {
        "PhotoID": photo_id,
        "SiteID": site_id,
        "SystemID": system_id,
        "PhotoType": photo_type,
        "Caption": caption,
        "S3Key": s3_key,
        "Url": _photo_public_url(s3_key, photo_id),
        "UploadedAt": uploaded_at,
        "UploadedBy": uploaded_by,
        "ContentType": content_type,
        "FileName": file_name,
    }
    # DynamoDB GSI keys cannot be empty strings — omit SystemID when unset.
    if not system_id:
        item.pop("SystemID", None)
    return item, None


def save_photo(item: dict) -> dict:
    """Persist photo metadata and return upload instructions."""
    ensure_photos_table()
    table = dynamodb_table(PHOTOS_TABLE_NAME)
    table.put_item(Item=item)
    content_type = str(item.get("ContentType") or "image/jpeg")
    s3_key = str(item.get("S3Key") or "")
    upload_url = _presigned_upload_url(s3_key, content_type)
    photo = normalize_photo(item)
    return {
        "ok": True,
        "table": PHOTOS_TABLE_NAME,
        "storage": photos_storage_mode(),
        "photo": photo,
        "uploadUrl": upload_url,
        "uploadHeaders": {"Content-Type": content_type},
        "uploadMethod": "PUT",
    }


def store_photo_object(
    s3_key: str, body: bytes, content_type: str | None = None
) -> dict:
    """Store image bytes in S3 or local fallback storage."""
    s3_key = _as_text(s3_key).lstrip("/")
    if not s3_key or ".." in s3_key.split("/"):
        raise ValueError("Invalid S3Key")
    payload = body or b""
    content_type = _guess_photo_content_type(content_type=content_type) or (
        _as_text(content_type) or "application/octet-stream"
    )
    if photos_storage_mode() == "s3":
        if not PHOTOS_BUCKET_NAME:
            raise RuntimeError("NOVARA_PHOTOS_BUCKET is not configured")
        s3_client().put_object(
            Bucket=PHOTOS_BUCKET_NAME,
            Key=s3_key,
            Body=payload,
            ContentType=content_type,
        )
        return {
            "ok": True,
            "storage": "s3",
            "s3Key": s3_key,
            "bytes": len(payload),
            "contentType": content_type,
        }
    return store_local_photo_bytes(s3_key, payload, content_type)


def save_photo_with_file(
    item: dict, file_bytes: bytes, *, content_type: str | None = None
) -> dict:
    """Persist metadata and immediately store the uploaded image bytes."""
    ensure_photos_table()
    s3_key = _as_text(item.get("S3Key"))
    if not s3_key:
        raise ValueError("S3Key is required")
    stored = store_photo_object(s3_key, file_bytes or b"", content_type)
    table = dynamodb_table(PHOTOS_TABLE_NAME)
    table.put_item(Item=item)
    photo = normalize_photo(item)
    return {
        "ok": True,
        "table": PHOTOS_TABLE_NAME,
        "storage": stored.get("storage") or photos_storage_mode(),
        "photo": photo,
        "uploaded": True,
        "bytes": stored.get("bytes", len(file_bytes or b"")),
    }


def list_photos(
    *,
    site_id: str | None = None,
    system_id: str | None = None,
) -> dict:
    """List photos filtered by SiteID and/or SystemID."""
    ensure_photos_table()
    table = dynamodb_table(PHOTOS_TABLE_NAME)
    site_id = _as_text(site_id)
    system_id = _as_text(system_id)

    items: list[dict] = []
    if system_id:
        query_kwargs: dict[str, Any] = {
            "IndexName": "SystemID-index",
            "KeyConditionExpression": "SystemID = :system_id",
            "ExpressionAttributeValues": {":system_id": system_id},
        }
        if site_id:
            query_kwargs["FilterExpression"] = "SiteID = :site_id"
            query_kwargs["ExpressionAttributeValues"][":site_id"] = site_id
        while True:
            response = table.query(**query_kwargs)
            items.extend(response.get("Items", []))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            query_kwargs["ExclusiveStartKey"] = last_key
    elif site_id:
        query_kwargs = {
            "IndexName": "SiteID-index",
            "KeyConditionExpression": "SiteID = :site_id",
            "ExpressionAttributeValues": {":site_id": site_id},
        }
        while True:
            response = table.query(**query_kwargs)
            items.extend(response.get("Items", []))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            query_kwargs["ExclusiveStartKey"] = last_key
    else:
        scan_kwargs: dict[str, Any] = {}
        while True:
            response = table.scan(**scan_kwargs)
            items.extend(response.get("Items", []))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            scan_kwargs["ExclusiveStartKey"] = last_key

    photos = [normalize_photo(json_safe(item)) for item in items]
    photos.sort(
        key=lambda row: (
            str(row.get("uploadedAt") or ""),
            str(row.get("photoId") or ""),
        ),
        reverse=True,
    )
    return {
        "table": PHOTOS_TABLE_NAME,
        "storage": photos_storage_mode(),
        "count": len(photos),
        "siteId": site_id,
        "systemId": system_id,
        "photos": photos,
    }


def get_photo_item(photo_id: str) -> dict | None:
    photo_id = _as_text(photo_id)
    if not photo_id:
        return None
    ensure_photos_table()
    table = dynamodb_table(PHOTOS_TABLE_NAME)
    response = table.get_item(Key={"PhotoID": photo_id})
    item = response.get("Item")
    if not item:
        return None
    return json_safe(item)


def delete_photo(photo_id: str) -> dict:
    """Delete photo metadata and best-effort remove the stored object."""
    from botocore.exceptions import ClientError

    photo_id = _as_text(photo_id)
    if not photo_id:
        raise ValueError("PhotoID is required")

    existing = get_photo_item(photo_id)
    if not existing:
        raise LookupError(f"PhotoID '{photo_id}' was not found")

    s3_key = _as_text(existing.get("S3Key"))
    table = dynamodb_table(PHOTOS_TABLE_NAME)
    try:
        table.delete_item(
            Key={"PhotoID": photo_id},
            ConditionExpression="attribute_exists(PhotoID)",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            raise LookupError(f"PhotoID '{photo_id}' was not found") from exc
        raise

    if s3_key:
        try:
            if photos_storage_mode() == "s3":
                s3_client().delete_object(Bucket=PHOTOS_BUCKET_NAME, Key=s3_key)
            else:
                local_path = _local_photo_path(s3_key)
                if os.path.isfile(local_path):
                    os.remove(local_path)
        except Exception:  # noqa: BLE001
            traceback.print_exc()

    return {
        "ok": True,
        "table": PHOTOS_TABLE_NAME,
        "deleted": True,
        "photoId": photo_id,
        "siteId": _as_text(existing.get("SiteID")),
        "systemId": _as_text(existing.get("SystemID")),
    }


def store_local_photo_bytes(s3_key: str, body: bytes, content_type: str | None = None) -> dict:
    """Write uploaded bytes to local photo storage (dev fallback)."""
    s3_key = _as_text(s3_key).lstrip("/")
    if not s3_key or ".." in s3_key.split("/"):
        raise ValueError("Invalid S3Key")
    path = _local_photo_path(s3_key)
    _ensure_local_photo_dir(path)
    with open(path, "wb") as handle:
        handle.write(body or b"")
    return {
        "ok": True,
        "storage": "local",
        "s3Key": s3_key,
        "bytes": len(body or b""),
        "contentType": _as_text(content_type),
    }


def read_photo_content(photo_id: str) -> tuple[bytes, str, str]:
    """Return (bytes, content_type, filename) for a photo object."""
    item = get_photo_item(photo_id)
    if not item:
        raise LookupError(f"PhotoID '{photo_id}' was not found")
    s3_key = _as_text(item.get("S3Key"))
    content_type = _as_text(item.get("ContentType")) or "application/octet-stream"
    file_name = _as_text(item.get("FileName")) or "photo"
    if not s3_key:
        raise LookupError(f"PhotoID '{photo_id}' has no stored object key")

    if photos_storage_mode() == "s3":
        response = s3_client().get_object(Bucket=PHOTOS_BUCKET_NAME, Key=s3_key)
        data = response["Body"].read()
        content_type = response.get("ContentType") or content_type
        return data, content_type, file_name

    path = _local_photo_path(s3_key)
    if not os.path.isfile(path):
        raise LookupError(f"Photo file for '{photo_id}' was not found")
    with open(path, "rb") as handle:
        return handle.read(), content_type, file_name


def ensure_owners_table() -> str:
    """Create NOVARAOwners if missing (pay-per-request, OwnerID hash key)."""
    global _owners_table_ready
    if _owners_table_ready:
        return OWNERS_TABLE_NAME

    from botocore.exceptions import ClientError

    client = dynamodb_resource().meta.client
    try:
        client.describe_table(TableName=OWNERS_TABLE_NAME)
        _owners_table_ready = True
        return OWNERS_TABLE_NAME
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceNotFoundException":
            raise

    try:
        client.create_table(
            TableName=OWNERS_TABLE_NAME,
            AttributeDefinitions=[
                {"AttributeName": "OwnerID", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "OwnerID", "KeyType": "HASH"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceInUseException":
            raise

    waiter = client.get_waiter("table_exists")
    waiter.wait(
        TableName=OWNERS_TABLE_NAME,
        WaiterConfig={"Delay": 2, "MaxAttempts": 30},
    )
    _owners_table_ready = True
    return OWNERS_TABLE_NAME


def normalize_owner(item: dict) -> dict:
    owner_id = first_present(item, ("OwnerID", "ownerId", "owner_id", "id"))
    name = first_present(
        item,
        ("Name", "name", "OwnerName", "ownerName"),
        default=owner_id or "Unknown owner",
    )
    address = first_present(
        item, ("Address", "address", "StreetAddress", "streetAddress"), default=""
    )
    city = first_present(item, ("City", "city"), default="")
    state = first_present(item, ("State", "state"), default="")
    zip_code = first_present(item, ("Zip", "zip", "ZipCode", "zipCode"), default="")
    contact_name = first_present(
        item, ("ContactName", "contactName", "contact_name"), default=""
    )
    contact_email = first_present(
        item, ("ContactEmail", "contactEmail", "contact_email", "Email", "email"),
        default="",
    )
    contact_phone = first_present(
        item, ("ContactPhone", "contactPhone", "contact_phone", "Phone", "phone"),
        default="",
    )
    notes = first_present(item, ("Notes", "notes"), default="")
    updated_at = first_present(
        item, ("UpdatedAt", "updatedAt", "updated_at"), default=""
    )
    location = format_location(
        {"City": city, "State": state, "Address": address}
    )
    return {
        "ownerId": "" if owner_id is None else str(owner_id),
        "name": str(name),
        "ownerName": str(name),
        "address": str(address or ""),
        "city": str(city or ""),
        "state": str(state or ""),
        "zip": str(zip_code or ""),
        "location": location,
        "contactName": str(contact_name or ""),
        "contactEmail": str(contact_email or ""),
        "contactPhone": str(contact_phone or ""),
        "notes": str(notes or ""),
        "updatedAt": str(updated_at or ""),
    }


def scan_owners() -> dict:
    ensure_owners_table()
    table = dynamodb_table(OWNERS_TABLE_NAME)
    items = []
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    owners = [normalize_owner(json_safe(item)) for item in items]
    owners.sort(
        key=lambda row: (
            (row.get("name") or "").lower(),
            (row.get("ownerId") or "").lower(),
        )
    )
    return {
        "table": OWNERS_TABLE_NAME,
        "count": len(owners),
        "owners": owners,
    }


def parse_owner_payload(body: dict | None) -> tuple[dict | None, str | None]:
    """Validate and normalize an incoming owner create/update payload."""
    if not isinstance(body, dict):
        return None, "JSON body is required"

    owner_id = _as_text(
        body.get("OwnerID") if "OwnerID" in body else body.get("ownerId")
    )
    name = _as_text(
        body.get("Name")
        if "Name" in body
        else body.get("name")
        if "name" in body
        else body.get("OwnerName")
        if "OwnerName" in body
        else body.get("ownerName")
    )
    if not owner_id:
        return None, "OwnerID is required"
    if not name:
        return None, "Name is required"
    if len(owner_id) > 64:
        return None, "OwnerID must be 64 characters or fewer"
    if len(name) > 120:
        return None, "Name must be 120 characters or fewer"

    address = _as_text(
        body.get("Address") if "Address" in body else body.get("address")
    )
    city = _as_text(body.get("City") if "City" in body else body.get("city"))
    state = _as_text(body.get("State") if "State" in body else body.get("state"))
    zip_code = _as_text(body.get("Zip") if "Zip" in body else body.get("zip"))
    contact_name = _as_text(
        body.get("ContactName") if "ContactName" in body else body.get("contactName")
    )
    contact_email = _as_text(
        body.get("ContactEmail")
        if "ContactEmail" in body
        else body.get("contactEmail")
    )
    contact_phone = _as_text(
        body.get("ContactPhone")
        if "ContactPhone" in body
        else body.get("contactPhone")
    )
    notes = _as_text(body.get("Notes") if "Notes" in body else body.get("notes"))

    if contact_email and "@" not in contact_email:
        return None, "ContactEmail must be a valid email address"

    item = {
        "OwnerID": owner_id,
        "Name": name,
        "Address": address,
        "City": city,
        "State": state,
        "Zip": zip_code,
        "ContactName": contact_name,
        "ContactEmail": contact_email,
        "ContactPhone": contact_phone,
        "Notes": notes,
        "UpdatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    return item, None


def save_owner(item: dict, *, mode: str = "upsert") -> dict:
    """Write an owner to DynamoDB. mode: create | update | upsert."""
    from botocore.exceptions import ClientError

    ensure_owners_table()
    table = dynamodb_table(OWNERS_TABLE_NAME)
    kwargs = {"Item": item}
    if mode == "create":
        kwargs["ConditionExpression"] = "attribute_not_exists(OwnerID)"
    elif mode == "update":
        kwargs["ConditionExpression"] = "attribute_exists(OwnerID)"

    try:
        table.put_item(**kwargs)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            if mode == "create":
                raise ValueError(f"OwnerID '{item['OwnerID']}' already exists") from exc
            if mode == "update":
                raise LookupError(f"OwnerID '{item['OwnerID']}' was not found") from exc
        raise

    return {
        "ok": True,
        "table": OWNERS_TABLE_NAME,
        "owner": normalize_owner(item),
    }


def ensure_mgmt_companies_table() -> str:
    """Create NOVARAMgmtCompanies if missing (pay-per-request, MgmtCompanyID hash key)."""
    global _mgmt_companies_table_ready
    if _mgmt_companies_table_ready:
        return MGMT_COMPANIES_TABLE_NAME

    from botocore.exceptions import ClientError

    client = dynamodb_resource().meta.client
    try:
        client.describe_table(TableName=MGMT_COMPANIES_TABLE_NAME)
        _mgmt_companies_table_ready = True
        return MGMT_COMPANIES_TABLE_NAME
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceNotFoundException":
            raise

    try:
        client.create_table(
            TableName=MGMT_COMPANIES_TABLE_NAME,
            AttributeDefinitions=[
                {"AttributeName": "MgmtCompanyID", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "MgmtCompanyID", "KeyType": "HASH"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceInUseException":
            raise

    waiter = client.get_waiter("table_exists")
    waiter.wait(
        TableName=MGMT_COMPANIES_TABLE_NAME,
        WaiterConfig={"Delay": 2, "MaxAttempts": 30},
    )
    _mgmt_companies_table_ready = True
    return MGMT_COMPANIES_TABLE_NAME


def normalize_mgmt_company(item: dict) -> dict:
    company_id = first_present(
        item, ("MgmtCompanyID", "mgmtCompanyId", "mgmt_company_id", "id")
    )
    name = first_present(
        item,
        ("Name", "name", "MgmtCompanyName", "mgmtCompanyName"),
        default=company_id or "Unknown management company",
    )
    address = first_present(
        item, ("Address", "address", "StreetAddress", "streetAddress"), default=""
    )
    city = first_present(item, ("City", "city"), default="")
    state = first_present(item, ("State", "state"), default="")
    zip_code = first_present(item, ("Zip", "zip", "ZipCode", "zipCode"), default="")
    contact_name = first_present(
        item, ("ContactName", "contactName", "contact_name"), default=""
    )
    contact_email = first_present(
        item,
        ("ContactEmail", "contactEmail", "contact_email", "Email", "email"),
        default="",
    )
    contact_phone = first_present(
        item,
        ("ContactPhone", "contactPhone", "contact_phone", "Phone", "phone"),
        default="",
    )
    notes = first_present(item, ("Notes", "notes"), default="")
    updated_at = first_present(
        item, ("UpdatedAt", "updatedAt", "updated_at"), default=""
    )
    location = format_location(
        {"City": city, "State": state, "Address": address}
    )
    return {
        "mgmtCompanyId": "" if company_id is None else str(company_id),
        "name": str(name),
        "mgmtCompanyName": str(name),
        "address": str(address or ""),
        "city": str(city or ""),
        "state": str(state or ""),
        "zip": str(zip_code or ""),
        "location": location,
        "contactName": str(contact_name or ""),
        "contactEmail": str(contact_email or ""),
        "contactPhone": str(contact_phone or ""),
        "notes": str(notes or ""),
        "updatedAt": str(updated_at or ""),
    }


def scan_mgmt_companies() -> dict:
    ensure_mgmt_companies_table()
    table = dynamodb_table(MGMT_COMPANIES_TABLE_NAME)
    items = []
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    companies = [normalize_mgmt_company(json_safe(item)) for item in items]
    companies.sort(
        key=lambda row: (
            (row.get("name") or "").lower(),
            (row.get("mgmtCompanyId") or "").lower(),
        )
    )
    return {
        "table": MGMT_COMPANIES_TABLE_NAME,
        "count": len(companies),
        "mgmtCompanies": companies,
    }


def parse_mgmt_company_payload(body: dict | None) -> tuple[dict | None, str | None]:
    """Validate and normalize an incoming management company create/update payload."""
    if not isinstance(body, dict):
        return None, "JSON body is required"

    company_id = _as_text(
        body.get("MgmtCompanyID")
        if "MgmtCompanyID" in body
        else body.get("mgmtCompanyId")
    )
    name = _as_text(
        body.get("Name")
        if "Name" in body
        else body.get("name")
        if "name" in body
        else body.get("MgmtCompanyName")
        if "MgmtCompanyName" in body
        else body.get("mgmtCompanyName")
    )
    if not company_id:
        return None, "MgmtCompanyID is required"
    if not name:
        return None, "Name is required"
    if len(company_id) > 64:
        return None, "MgmtCompanyID must be 64 characters or fewer"
    if len(name) > 120:
        return None, "Name must be 120 characters or fewer"

    address = _as_text(
        body.get("Address") if "Address" in body else body.get("address")
    )
    city = _as_text(body.get("City") if "City" in body else body.get("city"))
    state = _as_text(body.get("State") if "State" in body else body.get("state"))
    zip_code = _as_text(body.get("Zip") if "Zip" in body else body.get("zip"))
    contact_name = _as_text(
        body.get("ContactName") if "ContactName" in body else body.get("contactName")
    )
    contact_email = _as_text(
        body.get("ContactEmail")
        if "ContactEmail" in body
        else body.get("contactEmail")
    )
    contact_phone = _as_text(
        body.get("ContactPhone")
        if "ContactPhone" in body
        else body.get("contactPhone")
    )
    notes = _as_text(body.get("Notes") if "Notes" in body else body.get("notes"))

    if contact_email and "@" not in contact_email:
        return None, "ContactEmail must be a valid email address"

    item = {
        "MgmtCompanyID": company_id,
        "Name": name,
        "Address": address,
        "City": city,
        "State": state,
        "Zip": zip_code,
        "ContactName": contact_name,
        "ContactEmail": contact_email,
        "ContactPhone": contact_phone,
        "Notes": notes,
        "UpdatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    return item, None


def save_mgmt_company(item: dict, *, mode: str = "upsert") -> dict:
    """Write a management company to DynamoDB. mode: create | update | upsert."""
    from botocore.exceptions import ClientError

    ensure_mgmt_companies_table()
    table = dynamodb_table(MGMT_COMPANIES_TABLE_NAME)
    kwargs = {"Item": item}
    if mode == "create":
        kwargs["ConditionExpression"] = "attribute_not_exists(MgmtCompanyID)"
    elif mode == "update":
        kwargs["ConditionExpression"] = "attribute_exists(MgmtCompanyID)"

    try:
        table.put_item(**kwargs)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            if mode == "create":
                raise ValueError(
                    f"MgmtCompanyID '{item['MgmtCompanyID']}' already exists"
                ) from exc
            if mode == "update":
                raise LookupError(
                    f"MgmtCompanyID '{item['MgmtCompanyID']}' was not found"
                ) from exc
        raise

    return {
        "ok": True,
        "table": MGMT_COMPANIES_TABLE_NAME,
        "mgmtCompany": normalize_mgmt_company(item),
    }


def ensure_leads_table() -> str:
    """Create NOVARALeads if missing (pay-per-request, LeadID hash key)."""
    global _leads_table_ready
    if _leads_table_ready:
        return LEADS_TABLE_NAME

    from botocore.exceptions import ClientError

    client = dynamodb_resource().meta.client
    try:
        client.describe_table(TableName=LEADS_TABLE_NAME)
        _leads_table_ready = True
        return LEADS_TABLE_NAME
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceNotFoundException":
            raise

    try:
        client.create_table(
            TableName=LEADS_TABLE_NAME,
            AttributeDefinitions=[
                {"AttributeName": "LeadID", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "LeadID", "KeyType": "HASH"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceInUseException":
            raise

    waiter = client.get_waiter("table_exists")
    waiter.wait(
        TableName=LEADS_TABLE_NAME,
        WaiterConfig={"Delay": 2, "MaxAttempts": 30},
    )
    _leads_table_ready = True
    return LEADS_TABLE_NAME


def normalize_lead(item: dict) -> dict:
    lead_id = first_present(item, ("LeadID", "leadId", "lead_id", "id"))
    company_name = first_present(
        item,
        (
            "CompanyName",
            "companyName",
            "SiteName",
            "siteName",
            "Name",
            "name",
        ),
        default=lead_id or "Unknown lead",
    )
    contact_name = first_present(
        item, ("ContactName", "contactName", "contact_name"), default=""
    )
    contact_email = first_present(
        item,
        ("ContactEmail", "contactEmail", "contact_email", "Email", "email"),
        default="",
    )
    contact_phone = first_present(
        item,
        ("ContactPhone", "contactPhone", "contact_phone", "Phone", "phone"),
        default="",
    )
    source = first_present(item, ("Source", "source"), default="")
    system_type = first_present(
        item, ("SystemType", "systemType", "system_type"), default=""
    )
    # Legacy lead value "DHW" was renamed to "DHW NG".
    if str(system_type or "").strip() == "DHW":
        system_type = "DHW NG"
    stage = first_present(item, ("Stage", "stage"), default="")
    next_follow_up = first_present(
        item,
        ("NextFollowUp", "nextFollowUp", "next_follow_up", "NextFollowup"),
        default="",
    )
    assigned_to = first_present(
        item, ("AssignedTo", "assignedTo", "assigned_to"), default=""
    )
    estimated_savings = first_present(
        item,
        ("EstimatedSavings", "estimatedSavings", "estimated_savings"),
        default=None,
    )
    if estimated_savings is not None and estimated_savings != "":
        estimated_savings = json_safe(estimated_savings)
    else:
        estimated_savings = None
    notes = first_present(item, ("Notes", "notes"), default="")
    updated_at = first_present(
        item, ("UpdatedAt", "updatedAt", "updated_at"), default=""
    )
    return {
        "leadId": "" if lead_id is None else str(lead_id),
        "companyName": str(company_name),
        "siteName": str(company_name),
        "contactName": str(contact_name or ""),
        "contactEmail": str(contact_email or ""),
        "contactPhone": str(contact_phone or ""),
        "source": str(source or ""),
        "systemType": str(system_type or ""),
        "stage": str(stage or ""),
        "nextFollowUp": str(next_follow_up or ""),
        "assignedTo": str(assigned_to or ""),
        "estimatedSavings": estimated_savings,
        "notes": str(notes or ""),
        "updatedAt": str(updated_at or ""),
    }


def scan_leads() -> dict:
    ensure_leads_table()
    table = dynamodb_table(LEADS_TABLE_NAME)
    items = []
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    leads = [normalize_lead(json_safe(item)) for item in items]
    leads.sort(
        key=lambda row: (
            (row.get("nextFollowUp") or "9999-99-99"),
            (row.get("companyName") or "").lower(),
            (row.get("leadId") or "").lower(),
        )
    )
    return {
        "table": LEADS_TABLE_NAME,
        "count": len(leads),
        "leads": leads,
    }


def parse_lead_payload(body: dict | None) -> tuple[dict | None, str | None]:
    """Validate and normalize an incoming lead create/update payload."""
    if not isinstance(body, dict):
        return None, "JSON body is required"

    lead_id = _as_text(
        body.get("LeadID") if "LeadID" in body else body.get("leadId")
    )
    company_name = _as_text(
        body.get("CompanyName")
        if "CompanyName" in body
        else body.get("companyName")
        if "companyName" in body
        else body.get("SiteName")
        if "SiteName" in body
        else body.get("siteName")
        if "siteName" in body
        else body.get("Name")
        if "Name" in body
        else body.get("name")
    )
    if not lead_id:
        return None, "LeadID is required"
    if not company_name:
        return None, "CompanyName is required"
    if len(lead_id) > 64:
        return None, "LeadID must be 64 characters or fewer"
    if len(company_name) > 160:
        return None, "CompanyName must be 160 characters or fewer"

    contact_name = _as_text(
        body.get("ContactName") if "ContactName" in body else body.get("contactName")
    )
    contact_email = _as_text(
        body.get("ContactEmail")
        if "ContactEmail" in body
        else body.get("contactEmail")
    )
    contact_phone = _as_text(
        body.get("ContactPhone")
        if "ContactPhone" in body
        else body.get("contactPhone")
    )
    source = _as_text(body.get("Source") if "Source" in body else body.get("source"))
    system_type = _as_text(
        body.get("SystemType") if "SystemType" in body else body.get("systemType")
    )
    # Legacy lead value "DHW" was renamed to "DHW NG".
    if system_type == "DHW":
        system_type = "DHW NG"
    stage = _as_text(body.get("Stage") if "Stage" in body else body.get("stage"))
    next_follow_up = _as_text(
        body.get("NextFollowUp")
        if "NextFollowUp" in body
        else body.get("nextFollowUp")
    )
    assigned_to = _as_text(
        body.get("AssignedTo") if "AssignedTo" in body else body.get("assignedTo")
    )
    notes = _as_text(body.get("Notes") if "Notes" in body else body.get("notes"))

    if contact_email and "@" not in contact_email:
        return None, "ContactEmail must be a valid email address"
    if source and source not in LEAD_SOURCES:
        return None, "Source must be one of: " + ", ".join(LEAD_SOURCES)
    if system_type and system_type not in LEAD_SYSTEM_TYPES:
        return None, "SystemType must be one of: " + ", ".join(LEAD_SYSTEM_TYPES)
    if stage and stage not in LEAD_STAGES:
        return None, "Stage must be one of: " + ", ".join(LEAD_STAGES)
    if next_follow_up:
        try:
            datetime.strptime(next_follow_up, "%Y-%m-%d")
        except ValueError:
            return None, "NextFollowUp must be a date in YYYY-MM-DD format"

    estimated_raw = (
        body.get("EstimatedSavings")
        if "EstimatedSavings" in body
        else body.get("estimatedSavings")
    )
    estimated_savings = None
    if estimated_raw is not None and estimated_raw != "":
        try:
            estimated_savings = Decimal(str(estimated_raw).strip())
        except (TypeError, ValueError, ArithmeticError):
            return None, "EstimatedSavings must be a number"
        if estimated_savings < 0:
            return None, "EstimatedSavings must be zero or greater"

    item = {
        "LeadID": lead_id,
        "CompanyName": company_name,
        "ContactName": contact_name,
        "ContactEmail": contact_email,
        "ContactPhone": contact_phone,
        "Source": source,
        "SystemType": system_type,
        "Stage": stage or "New Lead",
        "NextFollowUp": next_follow_up,
        "AssignedTo": assigned_to,
        "Notes": notes,
        "UpdatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if estimated_savings is not None:
        item["EstimatedSavings"] = estimated_savings
    else:
        item["EstimatedSavings"] = None
    return item, None


def save_lead(item: dict, *, mode: str = "upsert") -> dict:
    """Write a lead to DynamoDB. mode: create | update | upsert."""
    from botocore.exceptions import ClientError

    ensure_leads_table()
    table = dynamodb_table(LEADS_TABLE_NAME)
    # DynamoDB rejects Python None / float; omit empty optional numeric.
    write_item = {k: v for k, v in item.items() if v is not None}
    kwargs = {"Item": write_item}
    if mode == "create":
        kwargs["ConditionExpression"] = "attribute_not_exists(LeadID)"
    elif mode == "update":
        kwargs["ConditionExpression"] = "attribute_exists(LeadID)"

    try:
        table.put_item(**kwargs)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            if mode == "create":
                raise ValueError(f"LeadID '{item['LeadID']}' already exists") from exc
            if mode == "update":
                raise LookupError(f"LeadID '{item['LeadID']}' was not found") from exc
        raise

    return {
        "ok": True,
        "table": LEADS_TABLE_NAME,
        "lead": normalize_lead(write_item),
    }


def ensure_users_table() -> str:
    """Create NOVARAUsers if missing (pay-per-request, UserID hash key)."""
    global _users_table_ready
    if _users_table_ready:
        return USERS_TABLE_NAME

    from botocore.exceptions import ClientError

    client = dynamodb_resource().meta.client
    try:
        client.describe_table(TableName=USERS_TABLE_NAME)
        _users_table_ready = True
        return USERS_TABLE_NAME
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceNotFoundException":
            raise

    try:
        client.create_table(
            TableName=USERS_TABLE_NAME,
            AttributeDefinitions=[
                {"AttributeName": "UserID", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "UserID", "KeyType": "HASH"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceInUseException":
            raise

    waiter = client.get_waiter("table_exists")
    waiter.wait(
        TableName=USERS_TABLE_NAME,
        WaiterConfig={"Delay": 2, "MaxAttempts": 30},
    )
    _users_table_ready = True
    return USERS_TABLE_NAME


def ensure_preapproved_table() -> str:
    """Create NOVARAPreapprovedEmails if missing (pay-per-request, Email hash key)."""
    global _preapproved_table_ready
    if _preapproved_table_ready:
        return PREAPPROVED_TABLE_NAME

    from botocore.exceptions import ClientError

    client = dynamodb_resource().meta.client
    created = False
    try:
        client.describe_table(TableName=PREAPPROVED_TABLE_NAME)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceNotFoundException":
            raise
        try:
            client.create_table(
                TableName=PREAPPROVED_TABLE_NAME,
                AttributeDefinitions=[
                    {"AttributeName": "Email", "AttributeType": "S"},
                ],
                KeySchema=[
                    {"AttributeName": "Email", "KeyType": "HASH"},
                ],
                BillingMode="PAY_PER_REQUEST",
            )
            created = True
        except ClientError as create_exc:
            create_code = (create_exc.response.get("Error") or {}).get("Code")
            if create_code != "ResourceInUseException":
                raise

    waiter = client.get_waiter("table_exists")
    waiter.wait(
        TableName=PREAPPROVED_TABLE_NAME,
        WaiterConfig={"Delay": 2, "MaxAttempts": 30},
    )
    _preapproved_table_ready = True
    if created:
        _seed_preapproved_emails(force=True)
    else:
        _seed_preapproved_emails(force=False)
    return PREAPPROVED_TABLE_NAME


def _seed_preapproved_emails(*, force: bool = False) -> None:
    """Seed default/env pre-approved emails once (marker prevents re-seed)."""
    table = dynamodb_table(PREAPPROVED_TABLE_NAME)
    if not force:
        marker = table.get_item(Key={"Email": _PREAPPROVED_SEED_MARKER}).get("Item")
        if marker:
            return
        # If real emails already exist, just write the marker.
        existing = list_preapproved_emails(include_ensure=False)
        if existing:
            table.put_item(
                Item={
                    "Email": _PREAPPROVED_SEED_MARKER,
                    "IsMeta": True,
                    "SeededAt": datetime.now(timezone.utc).strftime(
                        "%Y-%m-%dT%H:%M:%SZ"
                    ),
                }
            )
            return

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for email in sorted(_env_preapproved_emails()):
        table.put_item(
            Item={
                "Email": email,
                "CreatedAt": now,
                "Source": "seed",
            }
        )
    table.put_item(
        Item={
            "Email": _PREAPPROVED_SEED_MARKER,
            "IsMeta": True,
            "SeededAt": now,
        }
    )


def list_preapproved_emails(*, include_ensure: bool = True) -> list[str]:
    if include_ensure:
        ensure_preapproved_table()
    table = dynamodb_table(PREAPPROVED_TABLE_NAME)
    emails: list[str] = []
    scan_kwargs: dict[str, Any] = {}
    while True:
        response = table.scan(**scan_kwargs)
        for item in response.get("Items", []):
            email = str(item.get("Email") or "").strip().lower()
            if not email or email == _PREAPPROVED_SEED_MARKER:
                continue
            if item.get("IsMeta"):
                continue
            emails.append(email)
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key
    emails.sort()
    return emails


def is_email_preapproved(email: str) -> bool:
    target = (email or "").strip().lower()
    if not target:
        return False
    # Prefer DynamoDB list; fall back to env snapshot if table unavailable.
    try:
        ensure_preapproved_table()
        table = dynamodb_table(PREAPPROVED_TABLE_NAME)
        item = table.get_item(Key={"Email": target}).get("Item")
        if item and not item.get("IsMeta"):
            return True
        return False
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return target in PREAPPROVED_EMAILS


def add_preapproved_email(email: str) -> dict:
    target = (email or "").strip().lower()
    if not target or not _EMAIL_PATTERN.match(target):
        raise ValueError("Email must be a valid email address")
    if target == _PREAPPROVED_SEED_MARKER:
        raise ValueError("Email is reserved")
    ensure_preapproved_table()
    table = dynamodb_table(PREAPPROVED_TABLE_NAME)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    table.put_item(
        Item={
            "Email": target,
            "CreatedAt": now,
            "Source": "admin",
        }
    )
    return {
        "ok": True,
        "table": PREAPPROVED_TABLE_NAME,
        "email": target,
        "preapprovedEmails": list_preapproved_emails(),
        "message": f"Pre-approved email '{target}' added.",
    }


def remove_preapproved_email(email: str) -> dict:
    target = (email or "").strip().lower()
    if not target:
        raise ValueError("Email is required")
    if target == _PREAPPROVED_SEED_MARKER:
        raise ValueError("Email is reserved")
    ensure_preapproved_table()
    table = dynamodb_table(PREAPPROVED_TABLE_NAME)
    existing = table.get_item(Key={"Email": target}).get("Item")
    if not existing or existing.get("IsMeta"):
        raise LookupError(f"Pre-approved email '{target}' was not found")
    table.delete_item(Key={"Email": target})
    return {
        "ok": True,
        "table": PREAPPROVED_TABLE_NAME,
        "email": target,
        "preapprovedEmails": list_preapproved_emails(),
        "message": f"Pre-approved email '{target}' removed.",
    }


def _role_label(role: str) -> str:
    key = str(role or "").strip().lower()
    return USER_ROLE_LABELS.get(key, key or "—")


def _app_url(path: str, query: dict[str, str] | None = None) -> str:
    clean = path if str(path).startswith("/") else f"/{path}"
    if query:
        clean = f"{clean}?{urlencode(query)}"
    if APP_BASE_URL:
        return f"{APP_BASE_URL}{clean}"
    return clean


def send_novara_email(
    *,
    to_address: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
) -> dict:
    """Send email via SES. Never raises — signup/approval must not fail on mail."""
    to_addr = (to_address or "").strip()
    if not to_addr:
        return {"ok": False, "skipped": True, "reason": "missing recipient"}
    from_addr = SES_FROM_EMAIL
    if not from_addr:
        _LOGGER.warning("NOVARA email skipped (no from address): %s", subject)
        return {"ok": False, "skipped": True, "reason": "missing from address"}

    # Local/dev escape hatch: log instead of calling SES.
    if (os.environ.get("NOVARA_EMAIL_MODE") or "").strip().lower() == "log":
        _LOGGER.info(
            "NOVARA email (log mode) to=%s subject=%s\n%s",
            to_addr,
            subject,
            text_body,
        )
        return {"ok": True, "mode": "log", "to": to_addr, "subject": subject}

    try:
        import boto3

        client = boto3.client("ses", **_aws_client_kwargs())
        body: dict[str, Any] = {"Text": {"Data": text_body, "Charset": "UTF-8"}}
        if html_body:
            body["Html"] = {"Data": html_body, "Charset": "UTF-8"}
        response = client.send_email(
            Source=from_addr,
            Destination={"ToAddresses": [to_addr]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": body,
            },
        )
        return {
            "ok": True,
            "mode": "ses",
            "to": to_addr,
            "subject": subject,
            "messageId": response.get("MessageId"),
        }
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        _LOGGER.warning("NOVARA email failed to=%s subject=%s: %s", to_addr, subject, exc)
        return {
            "ok": False,
            "mode": "ses",
            "to": to_addr,
            "subject": subject,
            "error": str(exc),
        }


def _aws_client_kwargs() -> dict[str, str]:
    kwargs: dict[str, str] = {}
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    if region:
        kwargs["region_name"] = region
    return kwargs


def _format_signup_date(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return "—"
    return text.replace("T", " ").replace("Z", " UTC")[:19]


def build_welcome_email(user: dict) -> tuple[str, str, str]:
    name = str(user.get("fullName") or "there").strip() or "there"
    role = _role_label(str(user.get("role") or ""))
    login_url = _app_url("login.html", {"role": str(user.get("role") or "aem")})
    subject = "Welcome to NOVARA — your account is active"
    text = (
        f"Hi {name},\n\n"
        "Congratulations — your NOVARA account is active. You can sign in now.\n\n"
        f"Role: {role}\n"
        f"Sign in: {login_url}\n\n"
        "— The NOVARA / AEM team\n"
    )
    safe_name = html.escape(name)
    safe_role = html.escape(role)
    safe_login = html.escape(login_url)
    html_body = (
        f"<p>Hi {safe_name},</p>"
        "<p>Congratulations — your <strong>NOVARA</strong> account is active. "
        "You can sign in now.</p>"
        f"<p><strong>Role:</strong> {safe_role}</p>"
        f'<p><a href="{safe_login}">Sign in to NOVARA</a></p>'
        "<p>— The NOVARA / AEM team</p>"
    )
    return subject, text, html_body


def build_admin_alert_email(user: dict, *, decision_token: str) -> tuple[str, str, str]:
    name = str(user.get("fullName") or "—")
    email = str(user.get("email") or "—")
    role = _role_label(str(user.get("role") or ""))
    company = str(user.get("company") or "—") or "—"
    signup_date = _format_signup_date(str(user.get("createdAt") or ""))
    user_id = str(user.get("userId") or "")
    approve_url = _app_url(
        "account-decision.html",
        {
            "userId": user_id,
            "token": decision_token,
            "decision": "approve",
        },
    )
    reject_url = _app_url(
        "account-decision.html",
        {
            "userId": user_id,
            "token": decision_token,
            "decision": "reject",
        },
    )
    users_url = _app_url("users.html", {"focus": user_id})
    subject = f"NOVARA account pending approval: {name}"
    text = (
        "A new NOVARA user signed up and needs approval.\n\n"
        f"Name: {name}\n"
        f"Email: {email}\n"
        f"Role: {role}\n"
        f"Company: {company}\n"
        f"Sign-up date: {signup_date}\n"
        f"User ID: {user_id}\n\n"
        f"Approve: {approve_url}\n"
        f"Reject: {reject_url}\n"
        f"Users admin: {users_url}\n"
    )
    html_body = (
        "<p>A new <strong>NOVARA</strong> user signed up and needs approval.</p>"
        "<table cellpadding='6' cellspacing='0' style='border-collapse:collapse'>"
        f"<tr><td><strong>Name</strong></td><td>{html.escape(name)}</td></tr>"
        f"<tr><td><strong>Email</strong></td><td>{html.escape(email)}</td></tr>"
        f"<tr><td><strong>Role</strong></td><td>{html.escape(role)}</td></tr>"
        f"<tr><td><strong>Company</strong></td><td>{html.escape(company)}</td></tr>"
        f"<tr><td><strong>Sign-up date</strong></td><td>{html.escape(signup_date)}</td></tr>"
        f"<tr><td><strong>User ID</strong></td><td>{html.escape(user_id)}</td></tr>"
        "</table>"
        "<p style='margin-top:20px'>"
        f'<a href="{html.escape(approve_url)}" '
        'style="background:#0f6b4c;color:#fff;padding:10px 16px;'
        'text-decoration:none;border-radius:6px;margin-right:10px">'
        "Approve</a>"
        f'<a href="{html.escape(reject_url)}" '
        'style="background:#b42318;color:#fff;padding:10px 16px;'
        'text-decoration:none;border-radius:6px">'
        "Reject</a>"
        "</p>"
        f'<p><a href="{html.escape(users_url)}">Open Users admin</a></p>'
    )
    return subject, text, html_body


def build_rejection_email(user: dict, reason: str) -> tuple[str, str, str]:
    name = str(user.get("fullName") or "there").strip() or "there"
    reason_text = str(reason or "").strip() or "No reason was provided."
    subject = "Update on your NOVARA account request"
    text = (
        f"Hi {name},\n\n"
        "Thank you for your interest in NOVARA. After review, we are unable to "
        "activate your account at this time.\n\n"
        f"Reason: {reason_text}\n\n"
        "If you believe this is a mistake or have questions, reply to this email "
        f"or contact {ADMIN_ALERT_EMAIL}.\n\n"
        "— The NOVARA / AEM team\n"
    )
    html_body = (
        f"<p>Hi {html.escape(name)},</p>"
        "<p>Thank you for your interest in <strong>NOVARA</strong>. After review, "
        "we are unable to activate your account at this time.</p>"
        f"<p><strong>Reason:</strong> {html.escape(reason_text)}</p>"
        "<p>If you believe this is a mistake or have questions, reply to this email "
        f"or contact {html.escape(ADMIN_ALERT_EMAIL)}.</p>"
        "<p>— The NOVARA / AEM team</p>"
    )
    return subject, text, html_body


def notify_user_welcome(user: dict) -> dict:
    subject, text, html_body = build_welcome_email(user)
    return send_novara_email(
        to_address=str(user.get("email") or ""),
        subject=subject,
        text_body=text,
        html_body=html_body,
    )


def notify_admin_pending_signup(user: dict, *, decision_token: str) -> dict:
    subject, text, html_body = build_admin_alert_email(
        user, decision_token=decision_token
    )
    return send_novara_email(
        to_address=ADMIN_ALERT_EMAIL,
        subject=subject,
        text_body=text,
        html_body=html_body,
    )


def notify_user_rejection(user: dict, reason: str) -> dict:
    subject, text, html_body = build_rejection_email(user, reason)
    return send_novara_email(
        to_address=str(user.get("email") or ""),
        subject=subject,
        text_body=text,
        html_body=html_body,
    )


def hash_password(password: str) -> str:
    """Store passwords as pbkdf2_sha256$iterations$salt$hash (stdlib only)."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PASSWORD_HASH_ITERATIONS,
    )
    return (
        f"pbkdf2_sha256${PASSWORD_HASH_ITERATIONS}${salt}${digest.hex()}"
    )


def verify_password(password: str, stored: str) -> bool:
    if not password or not stored:
        return False
    try:
        algo, iterations_s, salt, hash_hex = str(stored).split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iterations_s)
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        )
        return secrets.compare_digest(digest.hex(), hash_hex)
    except (TypeError, ValueError):
        return False


def normalize_user(item: dict, *, include_sensitive: bool = False) -> dict:
    user_id = first_present(item, ("UserID", "userId", "user_id", "id"))
    full_name = first_present(
        item, ("FullName", "fullName", "full_name", "Name", "name"), default=""
    )
    email = first_present(item, ("Email", "email"), default="")
    role = first_present(item, ("Role", "role"), default="")
    company = first_present(
        item,
        ("Company", "company", "Organization", "organization", "Org", "org"),
        default="",
    )
    status = first_present(item, ("Status", "status"), default="Pending")
    created_at = first_present(
        item, ("CreatedAt", "createdAt", "created_at"), default=""
    )
    updated_at = first_present(
        item, ("UpdatedAt", "updatedAt", "updated_at"), default=""
    )
    rejection_reason = first_present(
        item,
        ("RejectionReason", "rejectionReason", "rejection_reason"),
        default="",
    )
    role_text = str(role or "").lower().strip()
    status_text = str(status or "Pending").strip()
    if status_text.lower() == "approved":
        status_text = "Active"
    payload = {
        "userId": "" if user_id is None else str(user_id),
        "fullName": str(full_name or ""),
        "email": str(email or "").strip().lower(),
        "role": role_text,
        "company": str(company or ""),
        "status": status_text,
        "rejectionReason": str(rejection_reason or ""),
        "createdAt": str(created_at or ""),
        "updatedAt": str(updated_at or ""),
    }
    if include_sensitive:
        payload["passwordHash"] = str(
            first_present(
                item, ("PasswordHash", "passwordHash", "password_hash"), default=""
            )
            or ""
        )
        payload["decisionTokenHash"] = str(
            first_present(
                item,
                ("DecisionTokenHash", "decisionTokenHash", "decision_token_hash"),
                default="",
            )
            or ""
        )
    return payload


def _scan_user_items() -> list[dict]:
    ensure_users_table()
    table = dynamodb_table(USERS_TABLE_NAME)
    items: list[dict] = []
    scan_kwargs: dict[str, Any] = {}
    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key
    return items


def next_user_id(existing_items: list[dict] | None = None) -> str:
    items = existing_items if existing_items is not None else _scan_user_items()
    max_num = 0
    for item in items:
        user_id = first_present(item, ("UserID", "userId", "user_id", "id"))
        if not user_id:
            continue
        match = _USER_ID_PATTERN.match(str(user_id).strip())
        if match:
            max_num = max(max_num, int(match.group(1)))
    return f"USR{max_num + 1:03d}"


def find_user_by_email(email: str) -> dict | None:
    target = (email or "").strip().lower()
    if not target:
        return None
    for item in _scan_user_items():
        item_email = first_present(item, ("Email", "email"), default="")
        if str(item_email or "").strip().lower() == target:
            return json_safe(item)
    return None


def find_user_by_id(user_id: str) -> dict | None:
    target = _as_text(user_id)
    if not target:
        return None
    ensure_users_table()
    table = dynamodb_table(USERS_TABLE_NAME)
    response = table.get_item(Key={"UserID": target})
    item = response.get("Item")
    return json_safe(item) if item else None


def scan_users(*, status: str | None = None) -> dict:
    status_filter = _as_text(status) if status else ""
    if status_filter and status_filter not in USER_STATUSES:
        raise ValueError(
            "status must be one of: " + ", ".join(USER_STATUSES)
        )
    items = _scan_user_items()
    users = [normalize_user(json_safe(item)) for item in items]
    if status_filter:
        users = [row for row in users if row.get("status") == status_filter]
    users.sort(
        key=lambda row: (
            0 if row.get("status") == "Pending" else 1,
            (row.get("createdAt") or ""),
            (row.get("fullName") or "").lower(),
            (row.get("userId") or "").lower(),
        )
    )
    try:
        preapproved = list_preapproved_emails()
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        preapproved = sorted(PREAPPROVED_EMAILS)
    return {
        "table": USERS_TABLE_NAME,
        "count": len(users),
        "users": users,
        "preapprovedEmails": preapproved,
        "adminAlertEmail": ADMIN_ALERT_EMAIL,
    }


def parse_signup_payload(body: dict | None) -> tuple[dict | None, str | None]:
    if not isinstance(body, dict):
        return None, "JSON body is required"

    full_name = _as_text(
        body.get("FullName")
        if "FullName" in body
        else body.get("fullName")
        if "fullName" in body
        else body.get("Name")
        if "Name" in body
        else body.get("name")
    )
    email = _as_text(
        body.get("Email") if "Email" in body else body.get("email")
    ).lower()
    password = body.get("Password") if "Password" in body else body.get("password")
    password_text = "" if password is None else str(password)
    role = _as_text(
        body.get("Role") if "Role" in body else body.get("role")
    ).lower()
    company = _as_text(
        body.get("Company")
        if "Company" in body
        else body.get("company")
        if "company" in body
        else body.get("Organization")
        if "Organization" in body
        else body.get("organization")
    )

    if not full_name:
        return None, "FullName is required"
    if len(full_name) > 120:
        return None, "FullName must be 120 characters or fewer"
    if not email or "@" not in email or "." not in email.split("@")[-1]:
        return None, "Email must be a valid email address"
    if len(email) > 160:
        return None, "Email must be 160 characters or fewer"
    if len(password_text) < 8:
        return None, "Password must be at least 8 characters"
    if len(password_text) > 128:
        return None, "Password must be 128 characters or fewer"
    if role not in USER_ROLES:
        return None, "Role must be one of: " + ", ".join(USER_ROLES)
    if company and len(company) > 160:
        return None, "Company must be 160 characters or fewer"

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # Status is finalized in create_user_from_signup after the pre-approved check.
    item = {
        "FullName": full_name,
        "Email": email,
        "PasswordHash": hash_password(password_text),
        "Role": role,
        "Company": company,
        "Status": "Pending",
        "CreatedAt": now,
        "UpdatedAt": now,
    }
    return item, None


def create_user_from_signup(item: dict) -> dict:
    from botocore.exceptions import ClientError

    existing = find_user_by_email(item["Email"])
    if existing:
        raise ValueError(f"Email '{item['Email']}' is already registered")

    ensure_users_table()
    table = dynamodb_table(USERS_TABLE_NAME)
    preapproved = is_email_preapproved(item["Email"])
    status = "Active" if preapproved else "Pending"
    decision_token = ""
    # Allocate IDs with a few retries in case of concurrent sign-ups.
    last_error: Exception | None = None
    for _ in range(5):
        user_id = next_user_id()
        write_item = dict(item)
        write_item["UserID"] = user_id
        write_item["Status"] = status
        if status == "Pending":
            decision_token = secrets.token_urlsafe(32)
            write_item["DecisionTokenHash"] = _hash_session_token(decision_token)
        try:
            table.put_item(
                Item=write_item,
                ConditionExpression="attribute_not_exists(UserID)",
            )
            user = normalize_user(write_item)
            email_result: dict | None = None
            if user["status"] == "Active":
                email_result = notify_user_welcome(user)
                message = "Account created and activated (pre-approved email)."
            else:
                email_result = notify_admin_pending_signup(
                    user, decision_token=decision_token
                )
                message = "Account created and pending admin approval."
            result = {
                "ok": True,
                "table": USERS_TABLE_NAME,
                "user": user,
                "message": message,
            }
            if email_result is not None:
                result["email"] = {
                    "ok": bool(email_result.get("ok")),
                    "mode": email_result.get("mode"),
                    "skipped": bool(email_result.get("skipped")),
                }
            return result
        except ClientError as exc:
            code = (exc.response.get("Error") or {}).get("Code")
            if code == "ConditionalCheckFailedException":
                last_error = ValueError(f"UserID '{user_id}' already exists")
                continue
            raise
    if last_error:
        raise last_error
    raise RuntimeError("Failed to allocate a UserID")


def _hash_session_token(token: str) -> str:
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def create_session_for_user(user_id: str) -> dict:
    """Issue a bearer session token and persist its hash on the user row."""
    target_id = _as_text(user_id)
    if not target_id:
        raise ValueError("UserID is required")

    token_secret = secrets.token_urlsafe(32)
    token = f"{target_id}.{token_secret}"
    token_hash = _hash_session_token(token)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=max(60, SESSION_TTL_SECONDS))
    now_s = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    expires_s = expires.strftime("%Y-%m-%dT%H:%M:%SZ")

    ensure_users_table()
    table = dynamodb_table(USERS_TABLE_NAME)
    table.update_item(
        Key={"UserID": target_id},
        UpdateExpression=(
            "SET SessionTokenHash = :hash, SessionExpiresAt = :expires, "
            "UpdatedAt = :updated"
        ),
        ExpressionAttributeValues={
            ":hash": token_hash,
            ":expires": expires_s,
            ":updated": now_s,
        },
        ConditionExpression="attribute_exists(UserID)",
    )
    return {"token": token, "expiresAt": expires_s}


def clear_session_for_user(user_id: str) -> None:
    target_id = _as_text(user_id)
    if not target_id:
        return
    ensure_users_table()
    table = dynamodb_table(USERS_TABLE_NAME)
    now_s = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    table.update_item(
        Key={"UserID": target_id},
        UpdateExpression=(
            "REMOVE SessionTokenHash, SessionExpiresAt SET UpdatedAt = :updated"
        ),
        ExpressionAttributeValues={":updated": now_s},
        ConditionExpression="attribute_exists(UserID)",
    )


def resolve_session_token(token: str) -> dict:
    """Validate a bearer token and return the Active user it belongs to."""
    raw = _as_text(token)
    if not raw or "." not in raw:
        raise PermissionError("Invalid or expired session")

    user_id, _sep, _secret = raw.partition(".")
    if not user_id or not _secret:
        raise PermissionError("Invalid or expired session")

    item = find_user_by_id(user_id)
    if not item:
        raise PermissionError("Invalid or expired session")

    stored_hash = first_present(
        item, ("SessionTokenHash", "sessionTokenHash", "session_token_hash"), default=""
    )
    if not stored_hash or not secrets.compare_digest(
        str(stored_hash), _hash_session_token(raw)
    ):
        raise PermissionError("Invalid or expired session")

    expires_raw = first_present(
        item, ("SessionExpiresAt", "sessionExpiresAt", "session_expires_at"), default=""
    )
    expires_text = str(expires_raw or "").strip()
    if not expires_text:
        raise PermissionError("Invalid or expired session")
    try:
        expires_at = datetime.strptime(expires_text, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError as exc:
        raise PermissionError("Invalid or expired session") from exc
    if datetime.now(timezone.utc) >= expires_at:
        raise PermissionError("Invalid or expired session")

    user = normalize_user(item)
    if (user.get("status") or "Pending") != "Active":
        raise PermissionError("Your account is not active.")
    return user


def authenticate_user(email: str, password: str) -> dict:
    item = find_user_by_email(email)
    # Use a generic failure for missing users / bad passwords.
    if not item or not verify_password(password, item.get("PasswordHash") or ""):
        raise PermissionError("Invalid email or password")

    user = normalize_user(item)
    status = user.get("status") or "Pending"
    if status == "Pending":
        raise PermissionError(
            "Your account is pending approval. An AEM admin must activate it before you can sign in."
        )
    if status == "Rejected":
        raise PermissionError(
            "Your account request was rejected. Contact an AEM admin for help."
        )
    if status != "Active":
        raise PermissionError("Your account is not active.")

    session = create_session_for_user(user["userId"])
    return {
        "ok": True,
        "table": USERS_TABLE_NAME,
        "user": user,
        "token": session["token"],
        "expiresAt": session["expiresAt"],
        "message": "Signed in successfully.",
    }


def update_user_status(
    user_id: str,
    status: str,
    *,
    rejection_reason: str | None = None,
    send_rejection_email: bool = True,
    decision_token: str | None = None,
) -> dict:
    from botocore.exceptions import ClientError

    target_id = _as_text(user_id)
    next_status = _as_text(status)
    if not target_id:
        raise ValueError("UserID is required")
    if next_status not in ("Active", "Rejected"):
        raise ValueError("Status must be Active or Rejected")

    existing = find_user_by_id(target_id)
    if not existing:
        raise LookupError(f"UserID '{target_id}' was not found")

    if decision_token:
        stored_hash = first_present(
            existing,
            ("DecisionTokenHash", "decisionTokenHash", "decision_token_hash"),
            default="",
        )
        if not stored_hash or not secrets.compare_digest(
            str(stored_hash), _hash_session_token(str(decision_token))
        ):
            raise PermissionError("Invalid or expired decision token")
        current_status = str(
            first_present(existing, ("Status", "status"), default="Pending") or "Pending"
        )
        if current_status != "Pending":
            raise ValueError("Only Pending accounts can be decided via email link")

    reason_text = _as_text(rejection_reason)
    if next_status == "Rejected" and not reason_text:
        raise ValueError("RejectionReason is required when rejecting a user")
    if reason_text and len(reason_text) > 500:
        raise ValueError("RejectionReason must be 500 characters or fewer")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ensure_users_table()
    table = dynamodb_table(USERS_TABLE_NAME)

    update_expression = "SET #status = :status, UpdatedAt = :updated"
    names = {"#status": "Status"}
    values: dict[str, Any] = {":status": next_status, ":updated": now}
    remove_parts: list[str] = ["DecisionTokenHash"]

    if next_status == "Rejected":
        update_expression += ", RejectionReason = :reason"
        values[":reason"] = reason_text
    else:
        remove_parts.append("RejectionReason")

    if remove_parts:
        update_expression += " REMOVE " + ", ".join(remove_parts)

    try:
        response = table.update_item(
            Key={"UserID": target_id},
            UpdateExpression=update_expression,
            ConditionExpression="attribute_exists(UserID)",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            raise LookupError(f"UserID '{target_id}' was not found") from exc
        raise

    updated = json_safe(response.get("Attributes") or existing)
    updated["Status"] = next_status
    updated["UpdatedAt"] = now
    if next_status == "Rejected":
        updated["RejectionReason"] = reason_text
    else:
        updated.pop("RejectionReason", None)
    user = normalize_user(updated)

    email_result: dict | None = None
    if next_status == "Active":
        email_result = notify_user_welcome(user)
    elif next_status == "Rejected" and send_rejection_email:
        email_result = notify_user_rejection(user, reason_text)

    result = {
        "ok": True,
        "table": USERS_TABLE_NAME,
        "user": user,
        "message": f"User status set to {next_status}.",
    }
    if email_result is not None:
        result["email"] = {
            "ok": bool(email_result.get("ok")),
            "mode": email_result.get("mode"),
            "skipped": bool(email_result.get("skipped")),
        }
    return result


def _sync_site_from_systems(site_id: str) -> None:
    """Update NOVARASites.Systems (+ Status when derivable) from live NOVARASystems."""
    if not site_id:
        return
    summary = summarize_systems_by_site().get(str(site_id), {"count": 0, "statuses": []})
    count = int(summary.get("count") or 0)
    derived_status = derive_site_status_from_systems(summary.get("statuses") or [])

    table = dynamodb_table(SITES_TABLE_NAME)
    update_expression = "SET #systems = :count"
    names = {"#systems": "Systems"}
    values: dict[str, Any] = {":count": count}
    if derived_status:
        update_expression += ", #status = :status"
        names["#status"] = "Status"
        values[":status"] = derived_status

    table.update_item(
        Key={"SiteID": site_id},
        UpdateExpression=update_expression,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ConditionExpression="attribute_exists(SiteID)",
    )


# Back-compat alias used by older call sites / tests.
_sync_site_systems_count = _sync_site_from_systems


def format_location(item: dict) -> str:
    city = first_present(item, ("City", "city"))
    state = first_present(item, ("State", "state"))
    if city and state:
        return f"{city}, {state}"
    if city:
        return str(city)
    if state:
        return str(state)
    location = first_present(
        item,
        ("Location", "location", "Address", "address", "StreetAddress", "streetAddress"),
    )
    return str(location) if location is not None else "—"


def normalize_site(item: dict) -> dict:
    site_id = first_present(item, ("SiteID", "siteId", "site_id", "id", "PK"))
    name = first_present(
        item,
        ("SiteName", "siteName", "Name", "name", "site", "Site"),
        default=site_id or "Unknown site",
    )
    address = first_present(
        item,
        ("Address", "address", "StreetAddress", "streetAddress"),
        default="",
    )
    systems_raw = first_present(
        item,
        (
            "Systems",
            "systems",
            "SystemCount",
            "systemCount",
            "NumSystems",
            "numSystems",
        ),
    )
    systems = systems_count(systems_raw)
    if systems is None:
        systems = 0
    status = first_present(
        item,
        ("Status", "status", "SiteStatus", "siteStatus"),
        default="Online",
    )
    system_type = normalize_system_type(
        first_present(item, ("SystemType", "systemType", "system_type"), default="")
    )
    owner = str(first_present(item, ("Owner", "owner"), default="") or "")
    owner_id = first_present(item, ("OwnerID", "ownerId"), default="")
    owner_id = str(owner_id or owner or "")
    return {
        "siteId": "" if site_id is None else str(site_id),
        "name": str(name),
        "siteName": str(name),
        "owner": owner,
        "ownerId": owner_id,
        "mgmtCompany": str(
            first_present(item, ("MgmtCompany", "mgmtCompany", "mgmt_company"), default="")
            or ""
        ),
        "address": str(address or ""),
        "city": str(first_present(item, ("City", "city"), default="") or ""),
        "state": str(first_present(item, ("State", "state"), default="") or ""),
        "zip": str(first_present(item, ("Zip", "zip", "ZIP"), default="") or ""),
        "systemType": system_type,
        "status": str(status),
        "systems": systems,
        "location": format_location(item),
    }


def scan_sites(*, include_system_counts: bool = True) -> dict:
    table = dynamodb_table(SITES_TABLE_NAME)
    items = []
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    sites = [normalize_site(json_safe(item)) for item in items]
    if include_system_counts:
        try:
            summary = summarize_systems_by_site()
            for site in sites:
                site_id = site.get("siteId") or ""
                info = summary.get(site_id) or {"count": 0, "statuses": []}
                site["systems"] = int(info.get("count") or 0)
                derived = derive_site_status_from_systems(info.get("statuses") or [])
                if derived:
                    site["status"] = derived
                elif site["systems"] == 0 and not site.get("status"):
                    site["status"] = "Online"
        except Exception:  # noqa: BLE001
            # Keep stored Systems/Status values if NOVARASystems is unavailable.
            traceback.print_exc()
    sites.sort(key=lambda site: (site.get("name") or "").lower())
    return {
        "table": SITES_TABLE_NAME,
        "count": len(sites),
        "sites": sites,
    }


def get_site_item(site_id: str) -> dict | None:
    table = dynamodb_table(SITES_TABLE_NAME)
    response = table.get_item(Key={"SiteID": site_id})
    item = response.get("Item")
    if not item:
        return None
    return normalize_site(json_safe(item))


def _as_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def parse_site_payload(body: dict | None) -> tuple[dict | None, str | None]:
    """Validate and normalize an incoming site create/update payload."""
    if not isinstance(body, dict):
        return None, "JSON body is required"

    site_id = _as_text(body.get("SiteID") if "SiteID" in body else body.get("siteId"))
    site_name = _as_text(
        body.get("SiteName") if "SiteName" in body else body.get("siteName")
    )
    if not site_id:
        return None, "SiteID is required"
    if not site_name:
        return None, "SiteName is required"
    if len(site_id) > 64:
        return None, "SiteID must be 64 characters or fewer"

    system_type = _as_text(
        body.get("SystemType") if "SystemType" in body else body.get("systemType")
    )
    if system_type:
        system_type = normalize_system_type(system_type)
        if system_type not in SYSTEM_TYPES:
            return None, "SystemType must be one of: " + ", ".join(SYSTEM_TYPES)

    status = _as_text(body.get("Status") if "Status" in body else body.get("status"))
    if status and status not in SITE_STATUSES:
        return None, "Status must be one of: " + ", ".join(SITE_STATUSES)

    systems_raw = body.get("Systems") if "Systems" in body else body.get("systems")
    systems = 0
    if systems_raw is not None and systems_raw != "":
        try:
            systems = int(systems_raw)
        except (TypeError, ValueError):
            return None, "Systems must be a number"
        if systems < 0:
            return None, "Systems must be zero or greater"

    owner = _as_text(body.get("Owner") if "Owner" in body else body.get("owner"))
    owner_id = _as_text(
        body.get("OwnerID") if "OwnerID" in body else body.get("ownerId")
    )
    if not owner_id:
        owner_id = owner

    item = {
        "SiteID": site_id,
        "SiteName": site_name,
        "Owner": owner,
        "OwnerID": owner_id,
        "MgmtCompany": _as_text(
            body.get("MgmtCompany")
            if "MgmtCompany" in body
            else body.get("mgmtCompany")
        ),
        "Address": _as_text(
            body.get("Address") if "Address" in body else body.get("address")
        ),
        "City": _as_text(body.get("City") if "City" in body else body.get("city")),
        "State": _as_text(body.get("State") if "State" in body else body.get("state")),
        "Zip": _as_text(body.get("Zip") if "Zip" in body else body.get("zip")),
        "SystemType": system_type,
        "Status": status or "Online",
        "Systems": systems,
    }
    return item, None


def save_site(item: dict, *, mode: str = "upsert") -> dict:
    """Write a site to DynamoDB. mode: create | update | upsert."""
    from botocore.exceptions import ClientError

    # Prefer live NOVARASystems count/status over any client-supplied Systems value.
    try:
        summary = summarize_systems_by_site().get(
            str(item.get("SiteID") or ""), {"count": 0, "statuses": []}
        )
        item["Systems"] = int(summary.get("count") or 0)
        derived = derive_site_status_from_systems(summary.get("statuses") or [])
        if derived:
            item["Status"] = derived
    except Exception:  # noqa: BLE001
        traceback.print_exc()

    table = dynamodb_table(SITES_TABLE_NAME)
    kwargs = {"Item": item}
    if mode == "create":
        kwargs["ConditionExpression"] = "attribute_not_exists(SiteID)"
    elif mode == "update":
        kwargs["ConditionExpression"] = "attribute_exists(SiteID)"

    try:
        table.put_item(**kwargs)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            if mode == "create":
                raise ValueError(f"SiteID '{item['SiteID']}' already exists") from exc
            if mode == "update":
                raise LookupError(f"SiteID '{item['SiteID']}' was not found") from exc
        raise

    return {
        "ok": True,
        "table": SITES_TABLE_NAME,
        "site": normalize_site(item),
    }


def to_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def downsample(points: list[dict], max_points: int) -> list[dict]:
    if len(points) <= max_points:
        return points
    if max_points < 3:
        return points[:max_points]
    step = (len(points) - 1) / (max_points - 1)
    sampled = []
    for i in range(max_points):
        idx = round(i * step)
        sampled.append(points[idx])
    return sampled


def query_readings(site_id: str, days: int, system_id: str | None = None) -> dict:
    from boto3.dynamodb.conditions import Attr, Key

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    start_iso = start.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_iso = end.strftime("%Y-%m-%dT%H:%M:%SZ")
    # Include composite keys like ``{end_iso}#SYS001`` (lexicographically after end_iso).
    end_bound = end_iso + "\uffff"

    table = dynamodb_table(TABLE_NAME)
    items = []
    query_kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("SiteID").eq(site_id)
        & Key("TimestampUTC").between(start_iso, end_bound),
        "ScanIndexForward": True,
    }
    if system_id:
        # Prefer exact SystemID match; also keep legacy rows that lack SystemID
        # only when no system filter is requested.
        query_kwargs["FilterExpression"] = Attr("SystemID").eq(system_id)

    while True:
        response = table.query(**query_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        query_kwargs["ExclusiveStartKey"] = last_key

    points = []
    for item in items:
        raw_timestamp = item.get("TimestampUTC")
        if not raw_timestamp:
            continue
        timestamp, key_system = split_reading_sort_key(str(raw_timestamp))
        if not timestamp:
            continue
        point = {
            "t": timestamp,
            "t1": to_float(item.get("T1")),
            "t2": to_float(item.get("T2")),
        }
        item_system = item.get("SystemID") or item.get("systemId") or key_system
        if item_system:
            point["systemId"] = str(item_system)
        points.append(point)

    if len(points) > MAX_POINTS:
        points = downsample(points, MAX_POINTS)

    last_update = points[-1]["t"] if points else None
    result = {
        "points": points,
        "lastUpdate": last_update,
        "siteId": site_id,
        "days": days,
        "count": len(points),
    }
    if system_id:
        result["systemId"] = system_id
    return result


def _query_params(event: dict) -> dict[str, list[str]]:
    params = event.get("queryStringParameters") or {}
    if params:
        # API Gateway / Function URL may provide a flat dict of strings.
        return {k: [str(v)] for k, v in params.items() if v is not None}

    raw = event.get("rawQueryString") or ""
    if raw:
        return parse_qs(raw, keep_blank_values=True)

    multi = event.get("multiValueQueryStringParameters") or {}
    if multi:
        return {k: [str(x) for x in values] for k, values in multi.items()}
    return {}


def _request_path(event: dict) -> str:
    path = (
        event.get("rawPath")
        or event.get("path")
        or (event.get("requestContext") or {}).get("http", {}).get("path")
        or ""
    )
    # Some proxies put the mapped path under pathParameters.proxy.
    if (not path or path == "/") and isinstance(event.get("pathParameters"), dict):
        proxy = event["pathParameters"].get("proxy")
        if proxy:
            path = str(proxy)
            if not path.startswith("/"):
                path = f"/{path}"
            # Prefer /api/... when the proxy value omitted the prefix.
            if not path.startswith("/api/") and path.split("/", 2)[1] in {
                "users",
                "user",
                "login",
                "session",
                "sites",
                "systems",
                "owners",
                "leads",
                "readings",
                "savings",
                "health",
                "mgmt-companies",
            }:
                path = f"/api{path}"
    # Strip stage prefixes such as /prod/api/sites
    for prefix in ("/prod/", "/Stage/", "/stage/", "/$default/"):
        if path.startswith(prefix):
            path = "/" + path.split("/", 2)[-1]
            break
    return path.rstrip("/") or "/"


def _request_body(event: dict) -> Any:
    body = event.get("body")
    if body is None or body == "":
        return {}
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    if isinstance(body, (bytes, bytearray)):
        body = body.decode("utf-8")
    if isinstance(body, dict):
        return body
    if isinstance(body, str):
        trimmed = body.strip()
        if not trimmed:
            return {}
        return json.loads(trimmed)
    return {}


def handle_readings_request(params: dict[str, list[str]]) -> tuple[int, dict]:
    site_id = (params.get("siteId") or [DEFAULT_SITE_ID])[0] or DEFAULT_SITE_ID
    system_id = (params.get("systemId") or params.get("SystemID") or [""])[0] or ""
    system_id = str(system_id).strip()
    try:
        days = int((params.get("days") or ["7"])[0])
    except ValueError:
        return 400, {"error": "days must be an integer"}
    if days not in (3, 7, 30):
        return 400, {"error": "days must be one of 3, 7, or 30"}

    try:
        return 200, query_readings(site_id, days, system_id or None)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to load readings from DynamoDB",
            "detail": str(exc),
        }


# Demo portfolio used until verified savings are calculated from NOVARAReadings.
DEMO_SAVINGS_SITES = (
    {
        "siteId": "SITE001",
        "name": "Vista Springs",
        "systemType": "Domestic Hot Water",
        "savingsPct": 34.2,
        "verifiedSavings": 42850.0,
        "period": "Rolling 12 months",
    },
    {
        "siteId": "SITE002",
        "name": "Highlander Pointe",
        "systemType": "Boiler System",
        "savingsPct": 31.8,
        "verifiedSavings": 38920.0,
        "period": "Rolling 12 months",
    },
    {
        "siteId": "SITE003",
        "name": "La Verne Pool",
        "systemType": "Pool Heating",
        "savingsPct": 28.4,
        "verifiedSavings": 21450.0,
        "period": "Rolling 12 months",
    },
    {
        "siteId": "SITE004",
        "name": "Solar Thermal Demo",
        "systemType": "Solar Thermal",
        "savingsPct": 22.1,
        "verifiedSavings": 12480.0,
        "period": "Rolling 12 months",
    },
)

SAVINGS_ALLOWED_DAYS = (30, 90, 365)


def build_demo_savings(days: int) -> dict:
    """Build a clean portfolio savings series for charts (demo until calc exists)."""
    end = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    sites = [dict(site) for site in DEMO_SAVINGS_SITES]
    annual_total = sum(float(site["verifiedSavings"]) for site in sites)
    # Scale annual verified savings into the selected window with mild daily variation.
    window_total = annual_total * (days / 365.0)
    baseline_daily = window_total / max(days, 1)

    points: list[dict] = []
    cumulative = 0.0
    for offset in range(days, 0, -1):
        day = end - timedelta(days=offset - 1)
        # Deterministic variation so charts look professional and stable across reloads.
        wave = 1.0 + 0.12 * ((offset % 7) - 3) / 3.0
        weekend = 0.92 if day.weekday() >= 5 else 1.0
        seasonal = 1.0 + 0.08 * ((day.timetuple().tm_yday % 45) - 22) / 22.0
        daily = round(baseline_daily * wave * weekend * seasonal, 2)
        if daily < 0:
            daily = 0.0
        cumulative = round(cumulative + daily, 2)
        points.append(
            {
                "t": day.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "daily": daily,
                "cumulative": cumulative,
            }
        )

    # Align site window totals to the chart window while preserving annual % / dollars.
    scale = days / 365.0
    for site in sites:
        site["windowSavings"] = round(float(site["verifiedSavings"]) * scale, 2)

    avg_pct = round(
        sum(float(site["savingsPct"]) for site in sites) / max(len(sites), 1),
        1,
    )
    last_update = points[-1]["t"] if points else None
    return {
        "points": points,
        "sites": sites,
        "summary": {
            "totalSavings": round(cumulative, 2),
            "annualSavings": round(annual_total, 2),
            "avgSavingsPct": avg_pct,
            "siteCount": len(sites),
        },
        "lastUpdate": last_update,
        "days": days,
        "count": len(points),
        "source": "demo",
    }


def handle_savings_request(params: dict[str, list[str]]) -> tuple[int, dict]:
    try:
        days = int((params.get("days") or ["30"])[0])
    except ValueError:
        return 400, {"error": "days must be an integer"}
    if days not in SAVINGS_ALLOWED_DAYS:
        return 400, {"error": "days must be one of 30, 90, or 365"}

    try:
        # Verified savings calculation from NOVARAReadings is not available yet.
        # Serve deterministic demo data so Savings Graphs render usefully.
        return 200, build_demo_savings(days)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to load savings data",
            "detail": str(exc),
        }


def handle_sites_request() -> tuple[int, dict]:
    try:
        return 200, scan_sites()
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to load sites from DynamoDB",
            "detail": str(exc),
        }


def handle_site_write_request(body: dict | None, *, mode: str) -> tuple[int, dict]:
    item, error = parse_site_payload(body)
    if error:
        return 400, {"error": error}
    try:
        return 200, save_site(item, mode=mode)
    except ValueError as exc:
        return 409, {"error": str(exc)}
    except LookupError as exc:
        return 404, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to save site to DynamoDB",
            "detail": str(exc),
        }


def handle_systems_request() -> tuple[int, dict]:
    try:
        return 200, scan_systems()
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to load systems from DynamoDB",
            "detail": str(exc),
        }


def handle_system_write_request(body: dict | None, *, mode: str) -> tuple[int, dict]:
    item, error = parse_system_payload(body)
    if error:
        return 400, {"error": error}
    try:
        return 200, save_system(item, mode=mode)
    except ValueError as exc:
        return 409, {"error": str(exc)}
    except LookupError as exc:
        return 404, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to save system to DynamoDB",
            "detail": str(exc),
        }


def _system_id_from_path(path: str) -> str | None:
    """Extract SystemID from /api/systems/{id} (or /systems/{id})."""
    normalized = path if path.startswith("/") else f"/{path}"
    for marker in ("/api/systems/", "/systems/"):
        if marker not in normalized:
            continue
        system_id = normalized.split(marker, 1)[1]
        if system_id and "/" not in system_id:
            return system_id
    return None


def handle_system_delete_request(system_id: str | None) -> tuple[int, dict]:
    system_id = _as_text(system_id)
    if not system_id:
        return 400, {"error": "SystemID is required"}
    try:
        return 200, delete_system(system_id)
    except LookupError as exc:
        return 404, {"error": str(exc)}
    except ValueError as exc:
        return 400, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to delete system from DynamoDB",
            "detail": str(exc),
        }


def handle_photos_request(params: dict[str, list[str]]) -> tuple[int, dict]:
    site_id = first_query_value(params, ("siteId", "SiteID", "site_id"))
    system_id = first_query_value(params, ("systemId", "SystemID", "system_id"))
    try:
        return 200, list_photos(site_id=site_id, system_id=system_id)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to load photos from DynamoDB",
            "detail": str(exc),
        }


def handle_photo_create_request(body: dict | None) -> tuple[int, dict]:
    """JSON create: metadata only + uploadUrl for a follow-up PUT."""
    item, error = parse_photo_payload(body)
    if error:
        return 400, {"error": error}
    try:
        return 200, save_photo(item)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to create photo metadata",
            "detail": str(exc),
        }


def handle_photo_multipart_create(
    fields: dict[str, str] | None,
    files: list[dict[str, Any]] | None,
) -> tuple[int, dict]:
    """
    Multipart create: accept file(s) + PhotoType + Caption + SiteID + optional SystemID.

    Stores each file immediately (S3 or local) and writes NOVARAPhotos metadata.
    """
    fields = fields or {}
    files = [
        part
        for part in (files or [])
        if isinstance(part, dict) and (part.get("data") is not None)
    ]
    if not files:
        return 400, {
            "error": (
                "At least one image file is required "
                "(form field name: file, files, or photo)"
            )
        }

    created: list[dict] = []
    for part in files:
        filename = _as_text(part.get("filename")) or "photo.jpg"
        content_type = _guess_photo_content_type(
            filename, part.get("content_type")
        )
        if not content_type:
            return 400, {
                "error": (
                    "Each file must be an image type "
                    "(jpeg, png, gif, webp, heic)"
                )
            }
        payload = {
            "SiteID": fields.get("SiteID") or fields.get("siteId"),
            "SystemID": fields.get("SystemID") or fields.get("systemId"),
            "PhotoType": fields.get("PhotoType") or fields.get("photoType"),
            "Caption": fields.get("Caption") or fields.get("caption"),
            "UploadedBy": fields.get("UploadedBy") or fields.get("uploadedBy"),
            "ContentType": content_type,
            "FileName": filename,
        }
        item, error = parse_photo_payload(payload)
        if error:
            return 400, {"error": error}
        try:
            result = save_photo_with_file(
                item,
                bytes(part.get("data") or b""),
                content_type=content_type,
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return 500, {
                "error": "Failed to upload photo",
                "detail": str(exc),
            }
        created.append(result["photo"])

    return 200, {
        "ok": True,
        "table": PHOTOS_TABLE_NAME,
        "storage": photos_storage_mode(),
        "count": len(created),
        "photos": created,
        "photo": created[0],
        "uploaded": True,
    }


def handle_photo_delete_request(photo_id: str | None) -> tuple[int, dict]:
    photo_id = _as_text(photo_id)
    if not photo_id:
        return 400, {"error": "PhotoID is required"}
    try:
        return 200, delete_photo(photo_id)
    except LookupError as exc:
        return 404, {"error": str(exc)}
    except ValueError as exc:
        return 400, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to delete photo",
            "detail": str(exc),
        }


def _photo_id_from_path(path: str) -> str | None:
    """Extract PhotoID from /api/photos/{id} (not /content or /upload)."""
    normalized = path if path.startswith("/") else f"/{path}"
    for marker in ("/api/photos/", "/photos/"):
        if marker not in normalized:
            continue
        remainder = normalized.split(marker, 1)[1]
        if not remainder or "/" in remainder:
            return None
        return unquote(remainder).strip()
    return None


def _photo_content_id_from_path(path: str) -> str | None:
    """Extract PhotoID from /api/photos/{id}/content."""
    normalized = path if path.startswith("/") else f"/{path}"
    for marker in ("/api/photos/", "/photos/"):
        if marker not in normalized:
            continue
        remainder = normalized.split(marker, 1)[1]
        if not remainder.endswith("/content"):
            continue
        photo_id = remainder[: -len("/content")]
        if photo_id and "/" not in photo_id:
            return unquote(photo_id).strip()
    return None


def _local_upload_key_from_path(path: str) -> str | None:
    """Extract S3 key from /api/photos/upload/{key...}."""
    normalized = path if path.startswith("/") else f"/{path}"
    for marker in ("/api/photos/upload/", "/photos/upload/"):
        if marker not in normalized:
            continue
        key = normalized.split(marker, 1)[1]
        key = unquote(key).lstrip("/")
        if not key or ".." in key.split("/"):
            return None
        return key
    return None


def first_query_value(params: dict[str, list[str]], keys: tuple[str, ...]) -> str:
    for key in keys:
        values = params.get(key)
        if not values:
            continue
        value = _as_text(values[0] if isinstance(values, list) else values)
        if value:
            return value
    return ""


def handle_owners_request() -> tuple[int, dict]:
    try:
        return 200, scan_owners()
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to load owners from DynamoDB",
            "detail": str(exc),
        }


def _owner_id_from_path(path: str) -> str | None:
    """Extract OwnerID from /api/owners/{id} (or /owners/{id})."""
    normalized = path if path.startswith("/") else f"/{path}"
    for marker in ("/api/owners/", "/owners/"):
        if marker not in normalized:
            continue
        owner_id = normalized.split(marker, 1)[1]
        if owner_id and "/" not in owner_id:
            return owner_id
    return None


def handle_owner_write_request(
    body: dict | None,
    *,
    mode: str,
    owner_id: str | None = None,
) -> tuple[int, dict]:
    payload = dict(body or {}) if isinstance(body, dict) else body
    if owner_id:
        if not isinstance(payload, dict):
            payload = {}
        else:
            payload = dict(payload)
        body_id = _as_text(
            payload.get("OwnerID") if "OwnerID" in payload else payload.get("ownerId")
        )
        if body_id and body_id != owner_id:
            return 400, {"error": "OwnerID in path and body must match"}
        payload["OwnerID"] = owner_id

    item, error = parse_owner_payload(payload)
    if error:
        return 400, {"error": error}
    try:
        return 200, save_owner(item, mode=mode)
    except ValueError as exc:
        return 409, {"error": str(exc)}
    except LookupError as exc:
        return 404, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to save owner to DynamoDB",
            "detail": str(exc),
        }


def handle_mgmt_companies_request() -> tuple[int, dict]:
    try:
        return 200, scan_mgmt_companies()
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to load management companies from DynamoDB",
            "detail": str(exc),
        }


def _mgmt_company_id_from_path(path: str) -> str | None:
    """Extract MgmtCompanyID from /api/mgmt-companies/{id} (or /mgmt-companies/{id})."""
    normalized = path if path.startswith("/") else f"/{path}"
    for marker in ("/api/mgmt-companies/", "/mgmt-companies/"):
        if marker not in normalized:
            continue
        company_id = normalized.split(marker, 1)[1]
        if company_id and "/" not in company_id:
            return company_id
    return None


def handle_mgmt_company_write_request(
    body: dict | None,
    *,
    mode: str,
    company_id: str | None = None,
) -> tuple[int, dict]:
    payload = dict(body or {}) if isinstance(body, dict) else body
    if company_id:
        if not isinstance(payload, dict):
            payload = {}
        else:
            payload = dict(payload)
        body_id = _as_text(
            payload.get("MgmtCompanyID")
            if "MgmtCompanyID" in payload
            else payload.get("mgmtCompanyId")
        )
        if body_id and body_id != company_id:
            return 400, {"error": "MgmtCompanyID in path and body must match"}
        payload["MgmtCompanyID"] = company_id

    item, error = parse_mgmt_company_payload(payload)
    if error:
        return 400, {"error": error}
    try:
        return 200, save_mgmt_company(item, mode=mode)
    except ValueError as exc:
        return 409, {"error": str(exc)}
    except LookupError as exc:
        return 404, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to save management company to DynamoDB",
            "detail": str(exc),
        }


def handle_leads_request() -> tuple[int, dict]:
    try:
        return 200, scan_leads()
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to load leads from DynamoDB",
            "detail": str(exc),
        }


def _lead_id_from_path(path: str) -> str | None:
    """Extract LeadID from /api/leads/{id} (or /leads/{id})."""
    normalized = path if path.startswith("/") else f"/{path}"
    for marker in ("/api/leads/", "/leads/"):
        if marker not in normalized:
            continue
        lead_id = normalized.split(marker, 1)[1]
        if lead_id and "/" not in lead_id:
            return lead_id
    return None


def handle_lead_write_request(
    body: dict | None,
    *,
    mode: str,
    lead_id: str | None = None,
) -> tuple[int, dict]:
    payload = dict(body or {}) if isinstance(body, dict) else body
    if lead_id:
        if not isinstance(payload, dict):
            payload = {}
        else:
            payload = dict(payload)
        body_id = _as_text(
            payload.get("LeadID") if "LeadID" in payload else payload.get("leadId")
        )
        if body_id and body_id != lead_id:
            return 400, {"error": "LeadID in path and body must match"}
        payload["LeadID"] = lead_id

    item, error = parse_lead_payload(payload)
    if error:
        return 400, {"error": error}
    try:
        return 200, save_lead(item, mode=mode)
    except ValueError as exc:
        return 409, {"error": str(exc)}
    except LookupError as exc:
        return 404, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to save lead to DynamoDB",
            "detail": str(exc),
        }


def handle_users_request(params: dict[str, list[str]] | None = None) -> tuple[int, dict]:
    params = params or {}
    status_values = params.get("status") or params.get("Status") or []
    status = status_values[0] if status_values else None
    try:
        return 200, scan_users(status=status)
    except ValueError as exc:
        return 400, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to load users from DynamoDB",
            "detail": str(exc),
        }


def handle_signup_request(body: dict | None) -> tuple[int, dict]:
    item, error = parse_signup_payload(body)
    if error:
        return 400, {"error": error}
    try:
        return 201, create_user_from_signup(item)
    except ValueError as exc:
        return 409, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to create user in DynamoDB",
            "detail": str(exc),
        }


def handle_login_request(body: dict | None) -> tuple[int, dict]:
    if not isinstance(body, dict):
        return 400, {"error": "JSON body is required"}
    email = _as_text(body.get("Email") if "Email" in body else body.get("email")).lower()
    password = body.get("Password") if "Password" in body else body.get("password")
    password_text = "" if password is None else str(password)
    if not email:
        return 400, {"error": "Email is required"}
    if not password_text:
        return 400, {"error": "Password is required"}
    try:
        return 200, authenticate_user(email, password_text)
    except PermissionError as exc:
        return 403, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to authenticate user",
            "detail": str(exc),
        }


def _bearer_token_from_headers(headers: dict | None) -> str:
    if not isinstance(headers, dict):
        return ""
    # API Gateway may lowercase header names.
    for key, value in headers.items():
        if str(key).lower() != "authorization":
            continue
        text = str(value or "").strip()
        if text.lower().startswith("bearer "):
            return text[7:].strip()
        return text
    return ""


def handle_session_request(
    *, headers: dict | None = None, params: dict | None = None
) -> tuple[int, dict]:
    token = _bearer_token_from_headers(headers)
    if not token and isinstance(params, dict):
        token = _as_text((params.get("token") or [""])[0])
    if not token:
        return 401, {"error": "Authorization bearer token is required"}
    try:
        user = resolve_session_token(token)
        return 200, {
            "ok": True,
            "table": USERS_TABLE_NAME,
            "user": user,
            "message": "Session is valid.",
        }
    except PermissionError as exc:
        return 401, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to validate session",
            "detail": str(exc),
        }


def _user_id_from_path(path: str) -> str | None:
    """Extract UserID from /api/users/{id} (not signup/login/status suffixes)."""
    normalized = path if path.startswith("/") else f"/{path}"
    for marker in ("/api/users/", "/users/"):
        if marker not in normalized:
            continue
        remainder = normalized.split(marker, 1)[1]
        if not remainder or "/" in remainder:
            return None
        if remainder in ("signup", "login"):
            return None
        return unquote(remainder)
    return None


def _user_status_path_id(path: str) -> str | None:
    """Extract UserID from /api/users/{id}/status."""
    normalized = path if path.startswith("/") else f"/{path}"
    for marker in ("/api/users/", "/users/"):
        if marker not in normalized:
            continue
        remainder = normalized.split(marker, 1)[1]
        if not remainder.endswith("/status"):
            return None
        user_id = remainder[: -len("/status")]
        if not user_id or "/" in user_id:
            return None
        if user_id in ("signup", "login"):
            return None
        return unquote(user_id)
    return None


def handle_user_status_request(
    body: dict | None, *, user_id: str
) -> tuple[int, dict]:
    if not isinstance(body, dict):
        return 400, {"error": "JSON body is required"}
    status = _as_text(
        body.get("Status") if "Status" in body else body.get("status")
    )
    rejection_reason = body.get("RejectionReason")
    if rejection_reason is None:
        rejection_reason = body.get("rejectionReason")
    if rejection_reason is None:
        rejection_reason = body.get("reason")
    decision_token = _as_text(
        body.get("DecisionToken")
        if "DecisionToken" in body
        else body.get("decisionToken")
        if "decisionToken" in body
        else body.get("token")
    )
    send_flag = body.get("SendRejectionEmail")
    if send_flag is None:
        send_flag = body.get("sendRejectionEmail")
    if send_flag is None:
        send_rejection_email = True
    else:
        send_rejection_email = bool(send_flag)
    try:
        return 200, update_user_status(
            user_id,
            status,
            rejection_reason=(
                None if rejection_reason is None else str(rejection_reason)
            ),
            send_rejection_email=send_rejection_email,
            decision_token=decision_token or None,
        )
    except PermissionError as exc:
        return 403, {"error": str(exc)}
    except ValueError as exc:
        return 400, {"error": str(exc)}
    except LookupError as exc:
        return 404, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to update user status in DynamoDB",
            "detail": str(exc),
        }


def handle_preapproved_list_request() -> tuple[int, dict]:
    try:
        emails = list_preapproved_emails()
        return 200, {
            "ok": True,
            "table": PREAPPROVED_TABLE_NAME,
            "count": len(emails),
            "preapprovedEmails": emails,
            "adminAlertEmail": ADMIN_ALERT_EMAIL,
        }
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to load pre-approved emails",
            "detail": str(exc),
        }


def handle_preapproved_add_request(body: dict | None) -> tuple[int, dict]:
    if not isinstance(body, dict):
        return 400, {"error": "JSON body is required"}
    email = _as_text(body.get("Email") if "Email" in body else body.get("email"))
    try:
        return 201, add_preapproved_email(email)
    except ValueError as exc:
        return 400, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to add pre-approved email",
            "detail": str(exc),
        }


def handle_preapproved_remove_request(email: str) -> tuple[int, dict]:
    try:
        return 200, remove_preapproved_email(email)
    except ValueError as exc:
        return 400, {"error": str(exc)}
    except LookupError as exc:
        return 404, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to remove pre-approved email",
            "detail": str(exc),
        }


def _preapproved_email_from_path(path: str) -> str | None:
    """Extract email from /api/users/preapproved/{email}."""
    normalized = path if path.startswith("/") else f"/{path}"
    for marker in ("/api/users/preapproved/", "/users/preapproved/"):
        if marker not in normalized:
            continue
        remainder = normalized.split(marker, 1)[1]
        if not remainder or "/" in remainder:
            return None
        return unquote(remainder).strip().lower()
    return None


def handle_health_request() -> tuple[int, dict]:
    return 200, {
        "ok": True,
        "table": TABLE_NAME,
        "sitesTable": SITES_TABLE_NAME,
        "systemsTable": SYSTEMS_TABLE_NAME,
        "photosTable": PHOTOS_TABLE_NAME,
        "photosBucket": PHOTOS_BUCKET_NAME or None,
        "photosStorage": photos_storage_mode(),
        "ownersTable": OWNERS_TABLE_NAME,
        "mgmtCompaniesTable": MGMT_COMPANIES_TABLE_NAME,
        "leadsTable": LEADS_TABLE_NAME,
        "usersTable": USERS_TABLE_NAME,
        "preapprovedTable": PREAPPROVED_TABLE_NAME,
    }


def route_request(
    method: str,
    path: str,
    params: dict[str, list[str]],
    body: dict | None = None,
    *,
    headers: dict | None = None,
) -> tuple[int, dict]:
    method = (method or "GET").upper()
    if method == "OPTIONS":
        return 204, {}

    normalized = path if path.startswith("/") else f"/{path}"
    # Tolerate accidental trailing path noise from proxies.
    while "//" in normalized:
        normalized = normalized.replace("//", "/")
    normalized = normalized.rstrip("/") or "/"
    if normalized.endswith("/api/readings") or normalized == "/readings":
        if method != "GET":
            return 405, {"error": "Method not allowed"}
        return handle_readings_request(params)
    if normalized.endswith("/api/savings") or normalized == "/savings":
        if method != "GET":
            return 405, {"error": "Method not allowed"}
        return handle_savings_request(params)
    if normalized.endswith("/api/sites") or normalized == "/sites":
        if method == "GET":
            return handle_sites_request()
        if method == "POST":
            return handle_site_write_request(body, mode="create")
        if method == "PUT":
            return handle_site_write_request(body, mode="update")
        return 405, {"error": "Method not allowed"}
    if normalized.endswith("/api/systems") or normalized == "/systems":
        if method == "GET":
            return handle_systems_request()
        if method == "POST":
            return handle_system_write_request(body, mode="create")
        if method == "PUT":
            return handle_system_write_request(body, mode="update")
        return 405, {"error": "Method not allowed"}
    system_path_id = _system_id_from_path(normalized)
    if system_path_id is not None:
        if method == "DELETE":
            return handle_system_delete_request(system_path_id)
        if method == "PUT":
            payload = dict(body or {}) if isinstance(body, dict) else {}
            payload["SystemID"] = system_path_id
            return handle_system_write_request(payload, mode="update")
        return 405, {"error": "Method not allowed"}
    if normalized.endswith("/api/photos") or normalized == "/photos":
        if method == "GET":
            return handle_photos_request(params)
        if method == "POST":
            return handle_photo_create_request(body)
        return 405, {"error": "Method not allowed"}
    photo_content_id = _photo_content_id_from_path(normalized)
    if photo_content_id is not None:
        # Binary content is handled by the HTTP adapters; JSON route returns metadata.
        if method != "GET":
            return 405, {"error": "Method not allowed"}
        item = get_photo_item(photo_content_id)
        if not item:
            return 404, {"error": f"PhotoID '{photo_content_id}' was not found"}
        return 200, {
            "ok": True,
            "photo": normalize_photo(item),
            "contentPath": True,
        }
    photo_path_id = _photo_id_from_path(normalized)
    if photo_path_id is not None:
        if method == "DELETE":
            return handle_photo_delete_request(photo_path_id)
        if method == "GET":
            item = get_photo_item(photo_path_id)
            if not item:
                return 404, {"error": f"PhotoID '{photo_path_id}' was not found"}
            return 200, {
                "ok": True,
                "photo": normalize_photo(item),
            }
        return 405, {"error": "Method not allowed"}
    if normalized.endswith("/api/owners") or normalized == "/owners":
        if method == "GET":
            return handle_owners_request()
        if method == "POST":
            return handle_owner_write_request(body, mode="create")
        if method == "PUT":
            return handle_owner_write_request(body, mode="update")
        return 405, {"error": "Method not allowed"}
    owner_path_id = _owner_id_from_path(normalized)
    if owner_path_id is not None:
        if method == "PUT":
            return handle_owner_write_request(
                body, mode="update", owner_id=owner_path_id
            )
        return 405, {"error": "Method not allowed"}
    if (
        normalized.endswith("/api/mgmt-companies")
        or normalized == "/mgmt-companies"
    ):
        if method == "GET":
            return handle_mgmt_companies_request()
        if method == "POST":
            return handle_mgmt_company_write_request(body, mode="create")
        if method == "PUT":
            return handle_mgmt_company_write_request(body, mode="update")
        return 405, {"error": "Method not allowed"}
    mgmt_company_path_id = _mgmt_company_id_from_path(normalized)
    if mgmt_company_path_id is not None:
        if method == "PUT":
            return handle_mgmt_company_write_request(
                body, mode="update", company_id=mgmt_company_path_id
            )
        return 405, {"error": "Method not allowed"}
    if normalized.endswith("/api/leads") or normalized == "/leads":
        if method == "GET":
            return handle_leads_request()
        if method == "POST":
            return handle_lead_write_request(body, mode="create")
        if method == "PUT":
            return handle_lead_write_request(body, mode="update")
        return 405, {"error": "Method not allowed"}
    lead_path_id = _lead_id_from_path(normalized)
    if lead_path_id is not None:
        if method == "PUT":
            return handle_lead_write_request(
                body, mode="update", lead_id=lead_path_id
            )
        return 405, {"error": "Method not allowed"}
    if (
        normalized.endswith("/api/users/signup")
        or normalized == "/users/signup"
        or normalized.endswith("/api/user/signup")
        or normalized == "/user/signup"
    ):
        if method != "POST":
            return 405, {"error": "Method not allowed"}
        return handle_signup_request(body)
    if (
        normalized.endswith("/api/users/login")
        or normalized == "/users/login"
        or normalized.endswith("/api/user/login")
        or normalized == "/user/login"
        or normalized.endswith("/api/login")
        or normalized == "/login"
    ):
        if method != "POST":
            return 405, {"error": "Method not allowed"}
        return handle_login_request(body)
    if (
        normalized.endswith("/api/users/session")
        or normalized == "/users/session"
        or normalized.endswith("/api/session")
        or normalized == "/session"
    ):
        if method != "GET":
            return 405, {"error": "Method not allowed"}
        return handle_session_request(headers=headers, params=params)
    if (
        normalized.endswith("/api/users/preapproved")
        or normalized == "/users/preapproved"
    ):
        if method == "GET":
            return handle_preapproved_list_request()
        if method == "POST":
            return handle_preapproved_add_request(body)
        return 405, {"error": "Method not allowed"}
    preapproved_email = _preapproved_email_from_path(normalized)
    if preapproved_email is not None:
        if method == "DELETE":
            return handle_preapproved_remove_request(preapproved_email)
        return 405, {"error": "Method not allowed"}
    user_status_id = _user_status_path_id(normalized)
    if user_status_id is not None:
        if method != "PUT":
            return 405, {"error": "Method not allowed"}
        return handle_user_status_request(body, user_id=user_status_id)
    if normalized.endswith("/api/users") or normalized == "/users":
        if method == "GET":
            return handle_users_request(params)
        # Alias: POST /api/users creates an account (same as /api/users/signup).
        if method == "POST":
            return handle_signup_request(body)
        return 405, {"error": "Method not allowed"}
    user_path_id = _user_id_from_path(normalized)
    if user_path_id is not None:
        return 405, {"error": "Method not allowed"}
    if normalized.endswith("/api/health") or normalized == "/health":
        if method != "GET":
            return 405, {"error": "Method not allowed"}
        return handle_health_request()
    return 404, {
        "error": f"Unknown API path '{path}' for {method}",
        "path": path,
        "method": method,
        "hint": (
            "Supported routes include /api/sites, /api/systems, /api/photos, "
            "/api/owners, /api/mgmt-companies, /api/leads, /api/users, "
            "/api/users/signup, /api/users/login, /api/users/session, "
            "/api/users/preapproved, /api/readings, /api/savings, and /api/health. "
            "Redeploy novara-api if a known route returns this."
        ),
    }


def api_response(status: int, payload: dict, *, cors: bool = True) -> dict:
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    }
    if cors:
        headers["Access-Control-Allow-Origin"] = "*"
        headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    body = "" if status == 204 else json.dumps(payload)
    return {
        "statusCode": status,
        "headers": headers,
        "body": body,
    }


def binary_api_response(
    status: int,
    data: bytes,
    *,
    content_type: str = "application/octet-stream",
    file_name: str | None = None,
    cors: bool = True,
) -> dict:
    headers = {
        "Content-Type": content_type or "application/octet-stream",
        "Cache-Control": "private, max-age=300",
    }
    if file_name:
        headers["Content-Disposition"] = f'inline; filename="{_safe_filename(file_name)}"'
    if cors:
        headers["Access-Control-Allow-Origin"] = "*"
        headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    return {
        "statusCode": status,
        "headers": headers,
        "body": base64.b64encode(data or b"").decode("ascii"),
        "isBase64Encoded": True,
    }


def _request_raw_body(event: dict) -> bytes:
    body = event.get("body")
    if body is None:
        return b""
    if isinstance(body, bytes):
        return body
    if event.get("isBase64Encoded"):
        return base64.b64decode(body)
    if isinstance(body, str):
        return body.encode("utf-8")
    return b""


def handle_lambda_event(event: dict, _context=None) -> dict:
    """API Gateway HTTP API / REST / Lambda Function URL entrypoint."""
    sanitize_aws_env()
    request_context = event.get("requestContext") or {}
    http = request_context.get("http") or {}
    method = (
        event.get("httpMethod")
        or http.get("method")
        or event.get("requestContext", {}).get("httpMethod")
        or "GET"
    )
    path = _request_path(event)
    params = _query_params(event)
    headers = event.get("headers") or {}
    normalized = path if path.startswith("/") else f"/{path}"
    while "//" in normalized:
        normalized = normalized.replace("//", "/")
    normalized = normalized.rstrip("/") or "/"

    # Local-storage photo binary upload (PUT /api/photos/upload/{key}).
    upload_key = _local_upload_key_from_path(normalized)
    if upload_key is not None:
        if method == "OPTIONS":
            return api_response(204, {})
        if method != "PUT":
            return api_response(405, {"error": "Method not allowed"})
        try:
            content_type = ""
            for key, value in headers.items():
                if str(key).lower() == "content-type":
                    content_type = _as_text(value)
                    break
            result = store_local_photo_bytes(
                upload_key, _request_raw_body(event), content_type
            )
            return api_response(200, result)
        except ValueError as exc:
            return api_response(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return api_response(
                500, {"error": "Failed to store photo", "detail": str(exc)}
            )

    # Photo binary download (GET /api/photos/{id}/content).
    photo_content_id = _photo_content_id_from_path(normalized)
    if photo_content_id is not None and method == "GET":
        try:
            data, content_type, file_name = read_photo_content(photo_content_id)
            return binary_api_response(
                200, data, content_type=content_type, file_name=file_name
            )
        except LookupError as exc:
            return api_response(404, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return api_response(
                500, {"error": "Failed to load photo content", "detail": str(exc)}
            )

    # Multipart photo upload (POST /api/photos with multipart/form-data).
    content_type = _header_content_type(headers)
    if (
        method == "POST"
        and (normalized.endswith("/api/photos") or normalized == "/photos")
        and is_multipart_content_type(content_type)
    ):
        try:
            fields, files = parse_multipart_form(
                _request_raw_body(event), content_type
            )
            status, payload = handle_photo_multipart_create(fields, files)
            return api_response(status, payload)
        except ValueError as exc:
            return api_response(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return api_response(
                500, {"error": "Failed to parse multipart upload", "detail": str(exc)}
            )

    try:
        body = _request_body(event)
    except json.JSONDecodeError:
        return api_response(400, {"error": "Invalid JSON body"})
    status, payload = route_request(
        method, path, params, body, headers=headers
    )
    return api_response(status, payload)
