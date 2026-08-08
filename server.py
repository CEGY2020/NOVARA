#!/usr/bin/env python3
"""NOVARA local server: static files + DynamoDB readings/sites APIs."""

from __future__ import annotations

import json
import os
import traceback
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TABLE_NAME = os.environ.get("NOVARA_READINGS_TABLE", "NOVARAReadings")
SITES_TABLE_NAME = os.environ.get("NOVARA_SITES_TABLE", "NOVARASites")
DEFAULT_SITE_ID = "VS001"
DEFAULT_PORT = int(os.environ.get("PORT", "8000"))
MAX_POINTS = int(os.environ.get("NOVARA_MAX_CHART_POINTS", "720"))


def _sanitize_aws_env() -> None:
    """Drop placeholder/invalid session tokens that break long-term IAM keys."""
    access_key = (os.environ.get("AWS_ACCESS_KEY_ID") or "").strip()
    session_token = (os.environ.get("AWS_SESSION_TOKEN") or "").strip()
    # Long-term keys (AKIA...) must not send a session token. Short placeholders
    # like "none"/"n/a" also produce InvalidClientTokenId from STS/DynamoDB.
    if not session_token:
        os.environ.pop("AWS_SESSION_TOKEN", None)
        return
    if access_key.startswith("AKIA") or len(session_token) < 100:
        os.environ.pop("AWS_SESSION_TOKEN", None)


def _dynamodb_resource():
    import boto3

    _sanitize_aws_env()
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    if region:
        region = region.strip()
    if not region:
        raise RuntimeError(
            "AWS_REGION (or AWS_DEFAULT_REGION) must be set to query DynamoDB."
        )
    return boto3.resource("dynamodb", region_name=region)


def _dynamodb_table(table_name: str = TABLE_NAME):
    return _dynamodb_resource().Table(table_name)


def _json_safe(value):
    """Convert DynamoDB types (Decimal, sets, etc.) into JSON-serializable values."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value
    try:
        from decimal import Decimal

        if isinstance(value, Decimal):
            if value % 1 == 0:
                return int(value)
            return float(value)
    except Exception:  # noqa: BLE001
        pass
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    return str(value)


def _first_present(item: dict, keys: tuple[str, ...], default=None):
    for key in keys:
        if key in item and item[key] is not None and item[key] != "":
            return item[key]
    return default


def _systems_count(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple, set)):
        return len(value)
    if isinstance(value, dict):
        return len(value)
    try:
        from decimal import Decimal

        if isinstance(value, Decimal):
            return int(value)
    except Exception:  # noqa: BLE001
        pass
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            return int(text)
    return None


def _normalize_site(item: dict) -> dict:
    site_id = _first_present(item, ("SiteID", "siteId", "site_id", "id", "PK"))
    name = _first_present(
        item,
        ("SiteName", "siteName", "Name", "name", "site", "Site"),
        default=site_id or "Unknown site",
    )
    location = _first_present(
        item,
        ("Location", "location", "City", "city", "Address", "address"),
        default="—",
    )
    systems_raw = _first_present(
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
    systems = _systems_count(systems_raw)
    if systems is None:
        systems = "—"
    status = _first_present(
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


def _scan_sites() -> dict:
    table = _dynamodb_table(SITES_TABLE_NAME)
    items = []
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    sites = [_normalize_site(_json_safe(item)) for item in items]
    sites.sort(key=lambda site: (site.get("name") or "").lower())
    return {
        "table": SITES_TABLE_NAME,
        "count": len(sites),
        "sites": sites,
    }


def _to_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _query_readings(site_id: str, days: int) -> dict:
    from boto3.dynamodb.conditions import Key

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    start_iso = start.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_iso = end.strftime("%Y-%m-%dT%H:%M:%SZ")

    table = _dynamodb_table()
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
                "t1": _to_float(item.get("T1")),
                "t2": _to_float(item.get("T2")),
                "relayState": _to_float(item.get("RelayState")),
            }
        )

    if len(points) > MAX_POINTS:
        points = _downsample(points, MAX_POINTS)

    last_update = points[-1]["t"] if points else None
    return {
        "siteId": site_id,
        "days": days,
        "count": len(points),
        "lastUpdate": last_update,
        "points": points,
    }


def _downsample(points: list[dict], max_points: int) -> list[dict]:
    if len(points) <= max_points:
        return points
    # Keep first/last and evenly sample the middle for chart readability.
    if max_points < 3:
        return points[:max_points]
    step = (len(points) - 1) / (max_points - 1)
    sampled = []
    for i in range(max_points):
        idx = round(i * step)
        sampled.append(points[idx])
    return sampled


class NovaraHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/readings":
            self._handle_readings(parsed)
            return
        if parsed.path == "/api/sites":
            self._handle_sites()
            return
        if parsed.path == "/api/health":
            self._send_json(
                200,
                {
                    "ok": True,
                    "table": TABLE_NAME,
                    "sitesTable": SITES_TABLE_NAME,
                },
            )
            return
        super().do_GET()

    def _handle_readings(self, parsed):
        params = parse_qs(parsed.query)
        site_id = (params.get("siteId") or [DEFAULT_SITE_ID])[0] or DEFAULT_SITE_ID
        try:
            days = int((params.get("days") or ["7"])[0])
        except ValueError:
            self._send_json(400, {"error": "days must be an integer"})
            return
        if days not in (3, 7, 30):
            self._send_json(400, {"error": "days must be one of 3, 7, or 30"})
            return

        try:
            payload = _query_readings(site_id, days)
            self._send_json(200, payload)
        except Exception as exc:  # noqa: BLE001 - surface DynamoDB/config errors to UI
            traceback.print_exc()
            self._send_json(
                500,
                {
                    "error": "Failed to load readings from DynamoDB",
                    "detail": str(exc),
                },
            )

    def _handle_sites(self):
        try:
            payload = _scan_sites()
            self._send_json(200, payload)
        except Exception as exc:  # noqa: BLE001 - surface DynamoDB/config errors to UI
            traceback.print_exc()
            self._send_json(
                500,
                {
                    "error": "Failed to load sites from DynamoDB",
                    "detail": str(exc),
                },
            )

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main():
    _sanitize_aws_env()
    os.chdir(os.path.dirname(os.path.abspath(__file__)) or ".")
    server = ThreadingHTTPServer(("0.0.0.0", DEFAULT_PORT), NovaraHandler)
    print(
        "NOVARA server on http://0.0.0.0:%s (readings=%s sites=%s)"
        % (DEFAULT_PORT, TABLE_NAME, SITES_TABLE_NAME)
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
