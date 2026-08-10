"""Shared NOVARA DynamoDB API helpers (local server + Amplify Lambda)."""

from __future__ import annotations

import base64
import json
import os
import traceback
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import parse_qs

TABLE_NAME = os.environ.get("NOVARA_READINGS_TABLE", "NOVARAReadings")
SITES_TABLE_NAME = os.environ.get("NOVARA_SITES_TABLE", "NOVARASites")
SYSTEMS_TABLE_NAME = os.environ.get("NOVARA_SYSTEMS_TABLE", "NOVARASystems")
OWNERS_TABLE_NAME = os.environ.get("NOVARA_OWNERS_TABLE", "NOVARAOwners")
MGMT_COMPANIES_TABLE_NAME = os.environ.get(
    "NOVARA_MGMT_COMPANIES_TABLE", "NOVARAMgmtCompanies"
)
LEADS_TABLE_NAME = os.environ.get("NOVARA_LEADS_TABLE", "NOVARALeads")
DEFAULT_SITE_ID = "SITE001"
MAX_POINTS = int(os.environ.get("NOVARA_MAX_CHART_POINTS", "720"))

SYSTEM_TYPES = ("DHW", "Pool", "HVAC")
SITE_STATUSES = ("Online", "Offline", "Needs Review")
SYSTEM_RECORD_TYPES = ("DHW", "Pool", "HVAC", "Boiler")
SYSTEM_RECORD_STATUSES = ("Online", "Offline", "Needs Review", "Maintenance")
LEAD_SOURCES = ("Referral", "Website", "Rinnai", "Trade Show", "Other")
LEAD_SYSTEM_TYPES = ("DHW", "Pool", "HVAC", "Other")
LEAD_STAGES = (
    "New Lead",
    "Contacted",
    "Qualified",
    "Proposal Sent",
    "Won",
    "Lost",
)

_systems_table_ready = False
_owners_table_ready = False
_mgmt_companies_table_ready = False
_leads_table_ready = False


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
    return {
        "siteId": "" if site_id is None else str(site_id),
        "name": str(name),
        "siteName": str(name),
        "owner": str(first_present(item, ("Owner", "owner"), default="") or ""),
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

    item = {
        "SiteID": site_id,
        "SiteName": site_name,
        "Owner": _as_text(body.get("Owner") if "Owner" in body else body.get("owner")),
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

    table = dynamodb_table(TABLE_NAME)
    items = []
    query_kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("SiteID").eq(site_id)
        & Key("TimestampUTC").between(start_iso, end_iso),
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
        timestamp = item.get("TimestampUTC")
        if not timestamp:
            continue
        point = {
            "t": timestamp,
            "t1": to_float(item.get("T1")),
            "t2": to_float(item.get("T2")),
        }
        item_system = item.get("SystemID") or item.get("systemId")
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
    # Strip stage prefixes such as /prod/api/sites
    if path.startswith("/prod/") or path.startswith("/Stage/"):
        path = "/" + path.split("/", 2)[-1]
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


def handle_health_request() -> tuple[int, dict]:
    return 200, {
        "ok": True,
        "table": TABLE_NAME,
        "sitesTable": SITES_TABLE_NAME,
        "systemsTable": SYSTEMS_TABLE_NAME,
        "ownersTable": OWNERS_TABLE_NAME,
        "mgmtCompaniesTable": MGMT_COMPANIES_TABLE_NAME,
        "leadsTable": LEADS_TABLE_NAME,
    }


def route_request(
    method: str,
    path: str,
    params: dict[str, list[str]],
    body: dict | None = None,
) -> tuple[int, dict]:
    method = (method or "GET").upper()
    if method == "OPTIONS":
        return 204, {}

    normalized = path if path.startswith("/") else f"/{path}"
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
    if normalized.endswith("/api/health") or normalized == "/health":
        if method != "GET":
            return 405, {"error": "Method not allowed"}
        return handle_health_request()
    return 404, {"error": "Not found", "path": path}


def api_response(status: int, payload: dict, *, cors: bool = True) -> dict:
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    }
    if cors:
        headers["Access-Control-Allow-Origin"] = "*"
        headers["Access-Control-Allow-Headers"] = "Content-Type"
        headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    body = "" if status == 204 else json.dumps(payload)
    return {
        "statusCode": status,
        "headers": headers,
        "body": body,
    }


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
    try:
        body = _request_body(event)
    except json.JSONDecodeError:
        return api_response(400, {"error": "Invalid JSON body"})
    status, payload = route_request(method, path, params, body)
    return api_response(status, payload)
