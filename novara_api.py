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
DEFAULT_SITE_ID = "SITE001"
MAX_POINTS = int(os.environ.get("NOVARA_MAX_CHART_POINTS", "720"))

SYSTEM_TYPES = ("DHW", "Pool", "HVAC")
SITE_STATUSES = ("Online", "Offline", "Needs Review")
SYSTEM_RECORD_TYPES = ("DHW", "Pool", "HVAC", "Boiler")
SYSTEM_RECORD_STATUSES = ("Online", "Offline", "Needs Review", "Maintenance")

_systems_table_ready = False


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


def count_systems_by_site() -> dict[str, int]:
    """Return {SiteID: count} from NOVARASystems."""
    ensure_systems_table()
    table = dynamodb_table(SYSTEMS_TABLE_NAME)
    counts: dict[str, int] = {}
    scan_kwargs = {
        "ProjectionExpression": "SiteID",
    }
    while True:
        response = table.scan(**scan_kwargs)
        for item in response.get("Items", []):
            site_id = item.get("SiteID")
            if not site_id:
                continue
            key = str(site_id)
            counts[key] = counts.get(key, 0) + 1
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key
    return counts


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


def save_system(item: dict, *, mode: str = "upsert") -> dict:
    """Write a system to DynamoDB. mode: create | update | upsert."""
    from botocore.exceptions import ClientError

    ensure_systems_table()
    table = dynamodb_table(SYSTEMS_TABLE_NAME)
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

    # Keep the linked site's Systems count in sync with NOVARASystems.
    try:
        _sync_site_systems_count(item["SiteID"])
    except Exception:  # noqa: BLE001
        traceback.print_exc()

    return {
        "ok": True,
        "table": SYSTEMS_TABLE_NAME,
        "system": normalize_system(item, site_name=item.get("SiteName")),
    }


def _sync_site_systems_count(site_id: str) -> None:
    """Update NOVARASites.Systems for site_id from live NOVARASystems rows."""
    if not site_id:
        return
    counts = count_systems_by_site()
    count = int(counts.get(str(site_id), 0))
    table = dynamodb_table(SITES_TABLE_NAME)
    table.update_item(
        Key={"SiteID": site_id},
        UpdateExpression="SET #systems = :count",
        ExpressionAttributeNames={"#systems": "Systems"},
        ExpressionAttributeValues={":count": count},
        ConditionExpression="attribute_exists(SiteID)",
    )


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
            counts = count_systems_by_site()
            for site in sites:
                site_id = site.get("siteId") or ""
                site["systems"] = int(counts.get(site_id, 0))
        except Exception:  # noqa: BLE001
            # Keep stored Systems values if NOVARASystems is unavailable.
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


def query_readings(site_id: str, days: int) -> dict:
    from boto3.dynamodb.conditions import Key

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    start_iso = start.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_iso = end.strftime("%Y-%m-%dT%H:%M:%SZ")

    table = dynamodb_table(TABLE_NAME)
    items = []
    query_kwargs = {
        "KeyConditionExpression": Key("SiteID").eq(site_id)
        & Key("TimestampUTC").between(start_iso, end_iso),
        "ScanIndexForward": True,
    }

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
        points.append(
            {
                "t": timestamp,
                "t1": to_float(item.get("T1")),
                "t2": to_float(item.get("T2")),
            }
        )

    if len(points) > MAX_POINTS:
        points = downsample(points, MAX_POINTS)

    last_update = points[-1]["t"] if points else None
    return {
        "points": points,
        "lastUpdate": last_update,
        "siteId": site_id,
        "days": days,
        "count": len(points),
    }


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
    try:
        days = int((params.get("days") or ["7"])[0])
    except ValueError:
        return 400, {"error": "days must be an integer"}
    if days not in (3, 7, 30):
        return 400, {"error": "days must be one of 3, 7, or 30"}

    try:
        return 200, query_readings(site_id, days)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return 500, {
            "error": "Failed to load readings from DynamoDB",
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


def handle_health_request() -> tuple[int, dict]:
    return 200, {
        "ok": True,
        "table": TABLE_NAME,
        "sitesTable": SITES_TABLE_NAME,
        "systemsTable": SYSTEMS_TABLE_NAME,
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
        headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,OPTIONS"
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
