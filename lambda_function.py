"""AWS Lambda entrypoint for Amplify / API Gateway / Function URL."""

from __future__ import annotations

import base64
import json
from decimal import Decimal
from urllib.parse import parse_qs

import hubspot_crm
import novara_api
import sales_reports
import site_evaluations
import summary_reports
import workflow_documents


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


def _normalize_crm_path(path: str) -> str:
    prefix = "/api/crm/sync/status/"
    if path.startswith(prefix):
        remainder = path[len(prefix):].strip("/")
        parts = remainder.split("/")
        if len(parts) == 2 and all(parts):
            return f"/api/crm/sync/{parts[0]}/{parts[1]}/status"
    return path


def _normalize_sales_report_path(path: str) -> str:
    marker = "/api/sales-reports"
    idx = path.find(marker)
    return path[idx:] if idx >= 0 else path


_OPPORTUNITY_LINK_FIELDS = (
    "OwnerID",
    "OwnerName",
    "SiteID",
    "SiteName",
    "MgmtCompanyID",
    "MgmtCompanyName",
    "EstimatedSystemCount",
    "ExternalCustomerNumber",
    "SiteAddress",
    "City",
    "State",
    "ImportSource",
    "CustomerType",
)


def _response_json(response: dict) -> dict:
    try:
        body = response.get("body") or "{}"
        return body if isinstance(body, dict) else json.loads(body)
    except (TypeError, json.JSONDecodeError):
        return {}


def _set_response_json(response: dict, payload: dict) -> dict:
    response = dict(response)
    response["body"] = json.dumps(payload)
    return response


def _persist_opportunity_links(event: dict, response: dict) -> dict:
    status = int(response.get("statusCode") or 500)
    if status < 200 or status >= 300:
        return response
    body = _event_body(event)
    lead_id = str(body.get("LeadID") or body.get("leadId") or "").strip()
    if not lead_id:
        payload = _response_json(response)
        lead = payload.get("lead") if isinstance(payload, dict) else None
        lead_id = str((lead or {}).get("leadId") or "").strip()
    if not lead_id:
        return response

    values = {}
    for field in _OPPORTUNITY_LINK_FIELDS:
        raw = body.get(field)
        if raw is None:
            raw = body.get(field[0].lower() + field[1:])
        if raw is None:
            continue
        if field == "EstimatedSystemCount":
            if raw == "":
                values[field] = None
            else:
                try:
                    values[field] = Decimal(str(raw))
                except Exception:
                    continue
        else:
            values[field] = str(raw).strip()

    if not values:
        return response

    novara_api.ensure_leads_table()
    table = novara_api.dynamodb_table(novara_api.LEADS_TABLE_NAME)
    set_parts = []
    remove_parts = []
    names = {}
    attrs = {}
    for idx, (field, value) in enumerate(values.items()):
        nk = f"#f{idx}"
        names[nk] = field
        if value is None or value == "":
            remove_parts.append(nk)
        else:
            vk = f":v{idx}"
            attrs[vk] = value
            set_parts.append(f"{nk} = {vk}")

    expression = []
    if set_parts:
        expression.append("SET " + ", ".join(set_parts))
    if remove_parts:
        expression.append("REMOVE " + ", ".join(remove_parts))
    if expression:
        kwargs = {
            "Key": {"LeadID": lead_id},
            "UpdateExpression": " ".join(expression),
            "ExpressionAttributeNames": names,
        }
        if attrs:
            kwargs["ExpressionAttributeValues"] = attrs
        table.update_item(**kwargs)
    return response


def _enrich_lead_list(response: dict) -> dict:
    status = int(response.get("statusCode") or 500)
    if status < 200 or status >= 300:
        return response
    payload = _response_json(response)
    leads = payload.get("leads") if isinstance(payload, dict) else None
    if not isinstance(leads, list) or not leads:
        return response

    novara_api.ensure_leads_table()
    table = novara_api.dynamodb_table(novara_api.LEADS_TABLE_NAME)
    for lead in leads:
        lead_id = str(lead.get("leadId") or "").strip()
        if not lead_id:
            continue
        raw = table.get_item(Key={"LeadID": lead_id}).get("Item") or {}
        lead["ownerId"] = str(raw.get("OwnerID") or "")
        lead["ownerName"] = str(raw.get("OwnerName") or "")
        lead["siteId"] = str(raw.get("SiteID") or "")
        lead["siteName"] = str(raw.get("SiteName") or "")
        lead["mgmtCompanyId"] = str(raw.get("MgmtCompanyID") or "")
        lead["mgmtCompanyName"] = str(raw.get("MgmtCompanyName") or "")
        lead["externalCustomerNumber"] = str(raw.get("ExternalCustomerNumber") or "")
        lead["siteAddress"] = str(raw.get("SiteAddress") or "")
        lead["city"] = str(raw.get("City") or "")
        lead["state"] = str(raw.get("State") or "")
        lead["importSource"] = str(raw.get("ImportSource") or "")
        lead["customerType"] = str(raw.get("CustomerType") or "")
        count = raw.get("EstimatedSystemCount")
        lead["estimatedSystemCount"] = novara_api.json_safe(count) if count is not None else None
    return _set_response_json(response, payload)


def handler(event, context):
    event = event or {}

    if event.get("source") == "aws.events" or event.get("detail-type") == "Scheduled Event":
        return sales_reports.send_daily_reports(force=False)

    request_context = event.get("requestContext") or {}
    http = request_context.get("http") or {}
    method = (http.get("method") or event.get("httpMethod") or "GET").upper()
    path = http.get("path") or event.get("rawPath") or event.get("path") or "/"
    query = parse_qs(event.get("rawQueryString") or "")
    if not query and isinstance(event.get("queryStringParameters"), dict):
        query = {k: [v] for k, v in event["queryStringParameters"].items() if v is not None}

    if path.startswith("/api/crm"):
        if method == "OPTIONS":
            return _crm_lambda_response(204, {})
        status, payload = hubspot_crm.route(method, _normalize_crm_path(path), query=query, body=_event_body(event))
        return _crm_lambda_response(status, payload)

    if "/api/sales-reports" in path:
        if method == "OPTIONS":
            return _crm_lambda_response(204, {})
        sales_path = _normalize_sales_report_path(path)
        status, payload = sales_reports.route(method, sales_path, headers=event.get("headers") or {}, body=_event_body(event))
        return _crm_lambda_response(status, payload)

    if path.rstrip("/") == "/api/site-evaluations":
        status, payload = site_evaluations.route(method, path, query=query, body=_event_body(event))
        return _crm_lambda_response(status, payload)

    if path.rstrip("/") == "/api/summary-reports":
        status, payload = summary_reports.route(method, path, query=query, body=_event_body(event))
        return _crm_lambda_response(status, payload)

    if path.rstrip("/") == "/api/workflow-documents":
        status, payload = workflow_documents.route(method, path, query=query, body=_event_body(event))
        return _crm_lambda_response(status, payload)

    response = novara_api.handle_lambda_event(event, context)
    if path == "/api/leads" and method == "GET":
        return _enrich_lead_list(response)
    if path == "/api/leads" and method == "POST":
        return _persist_opportunity_links(event, response)
    if path.startswith("/api/leads/") and method in ("PUT", "PATCH"):
        return _persist_opportunity_links(event, response)
    return response
