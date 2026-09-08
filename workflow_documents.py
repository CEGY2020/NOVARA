"""Persistent workflow documents stored in NOVARASettings."""
from __future__ import annotations

from datetime import datetime, timezone

import novara_api

_ALLOWED_TYPES = {"LOI", "UtilityVerification"}


def _text(v):
    return "" if v is None else str(v).strip()


def _key(lead_id, program, document_type):
    return f"workflow#{document_type.lower()}#{program.lower()}#{lead_id}"


def _table():
    novara_api.ensure_settings_table()
    return novara_api.dynamodb_table(novara_api.SETTINGS_TABLE_NAME)


def save(body):
    if not isinstance(body, dict):
        raise ValueError("JSON body is required")
    lead_id = _text(body.get("LeadID") or body.get("leadId"))
    program = _text(body.get("Program") or body.get("program"))
    document_type = _text(body.get("DocumentType") or body.get("documentType"))
    if not lead_id:
        raise ValueError("LeadID is required")
    if program not in ("DHW", "Pool"):
        raise ValueError("Program must be DHW or Pool")
    if document_type not in _ALLOWED_TYPES:
        raise ValueError("DocumentType must be LOI or UtilityVerification")
    fields = body.get("Fields") if isinstance(body.get("Fields"), dict) else body.get("fields")
    if not isinstance(fields, dict):
        fields = {}
    clean = {str(k): v if isinstance(v, (str, int, float, bool)) or v is None else str(v) for k, v in fields.items()}
    item = {
        "SettingKey": _key(lead_id, program, document_type),
        "LeadID": lead_id,
        "Program": program,
        "DocumentType": document_type,
        "Fields": clean,
        "UpdatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    # Convert floats recursively using the same DynamoDB-safe helper pattern used elsewhere.
    from decimal import Decimal
    def ddb_safe(v):
        if isinstance(v, float):
            return Decimal(str(v))
        if isinstance(v, dict):
            return {k: ddb_safe(x) for k, x in v.items()}
        if isinstance(v, list):
            return [ddb_safe(x) for x in v]
        return v
    _table().put_item(Item=ddb_safe(item))
    return {"ok": True, "document": novara_api.json_safe(item)}


def get(lead_id, program, document_type):
    lead_id = _text(lead_id)
    program = _text(program)
    document_type = _text(document_type)
    if not lead_id:
        raise ValueError("leadId is required")
    if program not in ("DHW", "Pool"):
        raise ValueError("program must be DHW or Pool")
    if document_type not in _ALLOWED_TYPES:
        raise ValueError("documentType must be LOI or UtilityVerification")
    item = _table().get_item(Key={"SettingKey": _key(lead_id, program, document_type)}).get("Item")
    return {"document": novara_api.json_safe(item) if item else None}


def route(method, path, query=None, body=None):
    try:
        if path.rstrip("/") != "/api/workflow-documents":
            return 404, {"error": "Not found"}
        if method == "GET":
            q = query or {}
            def first(k):
                v = q.get(k)
                return v[0] if isinstance(v, list) and v else v or ""
            return 200, get(first("leadId"), first("program"), first("documentType"))
        if method in ("POST", "PUT"):
            return 200, save(body or {})
        if method == "OPTIONS":
            return 204, {}
        return 405, {"error": "Method not allowed"}
    except ValueError as exc:
        return 400, {"error": str(exc)}
    except Exception as exc:
        return 500, {"error": str(exc)}
