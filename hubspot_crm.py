"""NOVARA v0.7 HubSpot CRM integration service.

HubSpot is a CRM workflow layer only. NOVARA remains authoritative for operational
sites, systems, telemetry, alarms, analytics, optimization, and control.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any
from urllib import error, parse, request

HUBSPOT_API_BASE = (os.environ.get("HUBSPOT_API_BASE") or "https://api.hubapi.com").rstrip("/")
HUBSPOT_ACCESS_TOKEN = (os.environ.get("HUBSPOT_ACCESS_TOKEN") or "").strip()
HUBSPOT_ENABLED = (os.environ.get("NOVARA_HUBSPOT_ENABLED") or "false").strip().lower() in {"1", "true", "yes", "on"}

# Canonical NOVARA fields -> HubSpot properties. Custom novara_* fields must be
# created in HubSpot before live writes that include them are enabled.
OBJECTS = {
    "companies": {
        "object": "companies",
        "id_field": "companyId",
        "novara_property": "novara_company_id",
        "properties": {
            "companyName": "name", "website": "website", "phone": "phone",
            "companyId": "novara_company_id", "companyType": "novara_company_type",
            "relationshipStatus": "novara_relationship_status",
        },
    },
    "contacts": {
        "object": "contacts",
        "id_field": "contactId",
        "novara_property": "novara_contact_id",
        "properties": {
            "firstName": "firstname", "lastName": "lastname", "email": "email",
            "phone": "phone", "jobTitle": "jobtitle", "contactId": "novara_contact_id",
            "role": "novara_role",
        },
    },
    "opportunities": {
        "object": "deals",
        "id_field": "opportunityId",
        "novara_property": "novara_opportunity_id",
        "properties": {
            "opportunityName": "dealname", "estimatedValue": "amount",
            "expectedCloseDate": "closedate", "salesStage": "dealstage",
            "opportunityId": "novara_opportunity_id", "siteId": "novara_site_id",
            "novaraProductType": "novara_product_type",
        },
    },
    "products": {
        "object": "products",
        "id_field": "productCode",
        "novara_property": "novara_product_code",
        "properties": {
            "name": "name", "description": "description", "price": "price",
            "productCode": "novara_product_code", "productFamily": "novara_product_family",
            "billingType": "novara_billing_type",
        },
    },
    "tasks": {
        "object": "tasks",
        "id_field": "taskId",
        "novara_property": None,
        "properties": {
            "subject": "hs_task_subject", "body": "hs_task_body",
            "status": "hs_task_status", "priority": "hs_task_priority",
            "dueAt": "hs_timestamp",
        },
    },
}

PRODUCT_CATALOG = [
    {"productCode": "NOVARA_DHW", "name": "NOVARA DHW", "productFamily": "DHW", "billingType": "ONE_TIME"},
    {"productCode": "NOVARA_POOL", "name": "NOVARA Pool", "productFamily": "Pool", "billingType": "ONE_TIME"},
    {"productCode": "NOVARA_HVAC", "name": "NOVARA HVAC", "productFamily": "HVAC", "billingType": "ONE_TIME"},
    {"productCode": "OPTIMA_PROLINK", "name": "Optima ProLink", "productFamily": "Software", "billingType": "RECURRING"},
]

class HubSpotError(RuntimeError):
    def __init__(self, status: int, message: str, detail: Any = None):
        super().__init__(message)
        self.status = status
        self.detail = detail


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def configured() -> bool:
    return bool(HUBSPOT_ACCESS_TOKEN)


def _headers() -> dict[str, str]:
    if not HUBSPOT_ACCESS_TOKEN:
        raise HubSpotError(503, "HubSpot is not configured. Set HUBSPOT_ACCESS_TOKEN on the server.")
    return {"Authorization": f"Bearer {HUBSPOT_ACCESS_TOKEN}", "Content-Type": "application/json"}


def _request(method: str, path: str, body: dict | None = None, *, retries: int = 2) -> dict:
    url = f"{HUBSPOT_API_BASE}{path}"
    payload = None if body is None else json.dumps(body).encode("utf-8")
    for attempt in range(retries + 1):
        req = request.Request(url, data=payload, headers=_headers(), method=method)
        try:
            with request.urlopen(req, timeout=20) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                detail = raw
            if exc.code in {429, 500, 502, 503, 504} and attempt < retries:
                retry_after = exc.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else 0.5 * (2 ** attempt)
                time.sleep(min(delay, 4.0))
                continue
            raise HubSpotError(exc.code, "HubSpot API request failed", detail) from exc
        except error.URLError as exc:
            if attempt < retries:
                time.sleep(0.5 * (2 ** attempt))
                continue
            raise HubSpotError(502, "Unable to reach HubSpot", str(exc.reason)) from exc
    raise HubSpotError(502, "Unable to reach HubSpot")


def _map_to_hubspot(entity_type: str, payload: dict) -> dict:
    cfg = OBJECTS[entity_type]
    props: dict[str, str] = {}
    for canonical, hubspot_name in cfg["properties"].items():
        value = payload.get(canonical)
        if value is None or value == "":
            continue
        if canonical == "expectedCloseDate" and len(str(value)) == 10:
            value = f"{value}T00:00:00Z"
        props[hubspot_name] = str(value)
    return props


def _normalize_result(entity_type: str, record: dict) -> dict:
    cfg = OBJECTS[entity_type]
    reverse = {v: k for k, v in cfg["properties"].items()}
    out = {"hubspotId": record.get("id"), "createdAt": record.get("createdAt"), "updatedAt": record.get("updatedAt")}
    for key, value in (record.get("properties") or {}).items():
        out[reverse.get(key, key)] = value
    return out


def list_entities(entity_type: str, *, limit: int = 100, after: str | None = None) -> dict:
    cfg = OBJECTS[entity_type]
    props = ",".join(sorted(set(cfg["properties"].values())))
    query = {"limit": max(1, min(int(limit), 100)), "properties": props}
    if after:
        query["after"] = after
    data = _request("GET", f"/crm/v3/objects/{cfg['object']}?{parse.urlencode(query)}")
    return {
        "ok": True, "entityType": entity_type,
        "results": [_normalize_result(entity_type, row) for row in data.get("results", [])],
        "paging": data.get("paging"), "sync": {"configured": configured(), "enabled": HUBSPOT_ENABLED, "at": _now()},
    }


def get_by_novara_id(entity_type: str, novara_id: str) -> dict | None:
    cfg = OBJECTS[entity_type]
    prop = cfg.get("novara_property")
    if not prop:
        return None
    body = {"filterGroups": [{"filters": [{"propertyName": prop, "operator": "EQ", "value": novara_id}]}], "limit": 1, "properties": sorted(set(cfg["properties"].values()))}
    data = _request("POST", f"/crm/v3/objects/{cfg['object']}/search", body)
    rows = data.get("results") or []
    return rows[0] if rows else None


def upsert_entity(entity_type: str, payload: dict) -> dict:
    if not HUBSPOT_ENABLED:
        raise HubSpotError(503, "HubSpot live writes are disabled. Set NOVARA_HUBSPOT_ENABLED=true after configuration is verified.")
    cfg = OBJECTS[entity_type]
    id_field = cfg["id_field"]
    novara_id = str(payload.get(id_field) or "").strip()
    if not novara_id:
        raise HubSpotError(400, f"{id_field} is required")
    props = _map_to_hubspot(entity_type, payload)
    existing = get_by_novara_id(entity_type, novara_id)
    if existing:
        data = _request("PATCH", f"/crm/v3/objects/{cfg['object']}/{existing['id']}", {"properties": props})
        action = "updated"
    else:
        data = _request("POST", f"/crm/v3/objects/{cfg['object']}", {"properties": props})
        action = "created"
    return {"ok": True, "action": action, "entityType": entity_type, "record": _normalize_result(entity_type, data), "sync": {"status": "SUCCESS", "lastSuccessfulSyncAt": _now()}}


def create_task(payload: dict) -> dict:
    if not HUBSPOT_ENABLED:
        raise HubSpotError(503, "HubSpot live writes are disabled. Set NOVARA_HUBSPOT_ENABLED=true after configuration is verified.")
    data = _request("POST", "/crm/v3/objects/tasks", {"properties": _map_to_hubspot("tasks", payload)})
    return {"ok": True, "record": _normalize_result("tasks", data)}


def products() -> dict:
    if configured():
        try:
            return list_entities("products")
        except HubSpotError:
            pass
    return {"ok": True, "entityType": "products", "results": PRODUCT_CATALOG, "source": "NOVARA", "sync": {"configured": configured(), "enabled": HUBSPOT_ENABLED}}


def activities_for_opportunity(opportunity_id: str) -> dict:
    deal = get_by_novara_id("opportunities", opportunity_id)
    if not deal:
        raise HubSpotError(404, f"Opportunity '{opportunity_id}' was not found in HubSpot")
    deal_id = deal["id"]
    activities: list[dict] = []
    for kind in ("tasks", "calls", "emails"):
        try:
            data = _request("GET", f"/crm/v4/objects/deals/{deal_id}/associations/{kind}?limit=100")
            for row in data.get("results", []):
                activities.append({"type": kind[:-1].upper(), "hubspotId": row.get("toObjectId")})
        except HubSpotError as exc:
            if exc.status not in {403, 404}:
                raise
    return {"ok": True, "opportunityId": opportunity_id, "hubspotDealId": deal_id, "activities": activities}


def route(method: str, path: str, *, query: dict[str, list[str]] | None = None, body: dict | None = None) -> tuple[int, dict]:
    """Route /api/crm requests for both local server and Lambda."""
    query = query or {}
    body = body or {}
    clean = path.rstrip("/") or "/"
    if not clean.startswith("/api/crm"):
        return 404, {"error": "Not a CRM route"}
    remainder = clean[len("/api/crm"):].strip("/")
    parts = [p for p in remainder.split("/") if p]
    try:
        if not parts:
            return 200, {"ok": True, "service": "NOVARA HubSpot CRM", "version": "0.7", "configured": configured(), "enabled": HUBSPOT_ENABLED}
        entity = parts[0]
        if entity == "products" and method == "GET" and len(parts) == 1:
            return 200, products()
        if entity in {"companies", "contacts", "opportunities", "tasks"} and len(parts) == 1:
            if method == "GET":
                return 200, list_entities(entity, limit=int((query.get("limit") or ["100"])[0]), after=(query.get("after") or [None])[0])
            if method == "POST":
                return 200, create_task(body) if entity == "tasks" else upsert_entity(entity, body)
        if entity in {"companies", "contacts", "opportunities"} and len(parts) == 2:
            entity_id = parts[1]
            if method == "GET":
                record = get_by_novara_id(entity, entity_id)
                if not record:
                    return 404, {"error": f"{entity[:-1].title()} '{entity_id}' was not found"}
                return 200, {"ok": True, "record": _normalize_result(entity, record)}
            if method in {"PATCH", "PUT"}:
                payload = dict(body); payload[OBJECTS[entity]["id_field"]] = entity_id
                return 200, upsert_entity(entity, payload)
        if entity == "opportunities" and len(parts) == 3 and parts[2] == "activities" and method == "GET":
            return 200, activities_for_opportunity(parts[1])
        if entity == "sync" and len(parts) >= 3:
            mapped = {"company": "companies", "contact": "contacts", "opportunity": "opportunities", "deal": "opportunities", "product": "products"}.get(parts[1], parts[1])
            entity_id = parts[2]
            if mapped not in OBJECTS:
                return 400, {"error": "Unsupported entity type"}
            if method == "POST":
                payload = dict(body); payload.setdefault(OBJECTS[mapped]["id_field"], entity_id)
                return 200, upsert_entity(mapped, payload)
            if method == "GET" and len(parts) == 4 and parts[3] == "status":
                record = get_by_novara_id(mapped, entity_id)
                return 200, {"ok": True, "entityType": mapped, "entityId": entity_id, "status": "SYNCED" if record else "NOT_SYNCED", "hubspotId": record.get("id") if record else None}
        return 404, {"error": "CRM route not found", "path": path, "method": method}
    except HubSpotError as exc:
        return exc.status, {"error": str(exc), "detail": exc.detail, "service": "hubspot"}
    except (TypeError, ValueError) as exc:
        return 400, {"error": str(exc)}
