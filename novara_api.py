"""Shared NOVARA DynamoDB API helpers (local server + Amplify Lambda)."""

from __future__ import annotations

import json
import os
import traceback
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import parse_qs

TABLE_NAME = os.environ.get("NOVARA_READINGS_TABLE", "NOVARAReadings")
SITES_TABLE_NAME = os.environ.get("NOVARA_SITES_TABLE", "NOVARASites")
DEFAULT_SITE_ID = "VS001"
MAX_POINTS = int(os.environ.get("NOVARA_MAX_CHART_POINTS", "720"))


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


def normalize_site(item: dict) -> dict:
    site_id = first_present(item, ("SiteID", "siteId", "site_id", "id", "PK"))
    name = first_present(
        item,
        ("SiteName", "siteName", "Name", "name", "site", "Site"),
        default=site_id or "Unknown site",
    )
    location = first_present(
        item,
        ("Location", "location", "City", "city", "Address", "address"),
        default="—",
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
        systems = "—"
    status = first_present(
        item,
        ("Status", "status", "SiteStatus", "siteStatus"),
        default="Unknown",
    )
    return {
        "siteId": "" if site_id is None else str(site_id),
        "name": str(name),
        "location": str(location),
        "systems": systems,
        "status": str(status),
    }


def scan_sites() -> dict:
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
    sites.sort(key=lambda site: (site.get("name") or "").lower())
    return {
        "table": SITES_TABLE_NAME,
        "count": len(sites),
        "sites": sites,
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
    # Strip stage prefixes such as /prod/api/readings
    if path.startswith("/prod/") or path.startswith("/Stage/"):
        path = "/" + path.split("/", 2)[-1]
    return path.rstrip("/") or "/"


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


def handle_health_request() -> tuple[int, dict]:
    return 200, {
        "ok": True,
        "table": TABLE_NAME,
        "sitesTable": SITES_TABLE_NAME,
    }


def route_request(method: str, path: str, params: dict[str, list[str]]) -> tuple[int, dict]:
    method = (method or "GET").upper()
    if method == "OPTIONS":
        return 204, {}
    if method != "GET":
        return 405, {"error": "Method not allowed"}

    normalized = path if path.startswith("/") else f"/{path}"
    if normalized.endswith("/api/readings") or normalized == "/readings":
        return handle_readings_request(params)
    if normalized.endswith("/api/sites") or normalized == "/sites":
        return handle_sites_request()
    if normalized.endswith("/api/health") or normalized == "/health":
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
        headers["Access-Control-Allow-Methods"] = "GET,OPTIONS"
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
    status, payload = route_request(method, path, params)
    return api_response(status, payload)
