"""AWS Lambda entrypoint for Amplify / API Gateway / Function URL."""

from __future__ import annotations

import base64
import json
from urllib.parse import parse_qs

import hubspot_crm
import novara_api


def _crm_lambda_response(status: int, payload: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        },
        "body": json.dumps(payload),
    }


def _event_body(event: dict) -> dict:
    raw = event.get("body")
    if not raw:
        return {}
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def handler(event, context):
    event = event or {}
    request_context = event.get("requestContext") or {}
    http = request_context.get("http") or {}
    method = (http.get("method") or event.get("httpMethod") or "GET").upper()
    path = http.get("path") or event.get("rawPath") or event.get("path") or "/"

    if path.startswith("/api/crm"):
        if method == "OPTIONS":
            return _crm_lambda_response(204, {})
        query = parse_qs(event.get("rawQueryString") or "")
        # REST API Gateway may provide already-decoded query parameters.
        if not query and isinstance(event.get("queryStringParameters"), dict):
            query = {k: [v] for k, v in event["queryStringParameters"].items() if v is not None}
        status, payload = hubspot_crm.route(
            method,
            path,
            query=query,
            body=_event_body(event),
        )
        return _crm_lambda_response(status, payload)

    return novara_api.handle_lambda_event(event, context)
