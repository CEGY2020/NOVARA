"""Permanent NOVARA master-data API for companies, sites, and contacts.

This module intentionally keeps lookup/master data separate from Leads.
Companies and Contacts have dedicated DynamoDB tables. Sites are stored in
NOVARASites with the cross-record MasterID and CompanyID preserved.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import novara_api

COMPANIES_TABLE_NAME = os.environ.get("NOVARA_COMPANIES_TABLE", "NOVARACompanies")
CONTACTS_TABLE_NAME = os.environ.get("NOVARA_CONTACTS_TABLE", "NOVARAContacts")
SITES_TABLE_NAME = os.environ.get("NOVARA_SITES_TABLE", "NOVARASites")

_companies_ready = False
_contacts_ready = False


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ensure_table(table_name: str, key_name: str, ready_name: str) -> None:
    global _companies_ready, _contacts_ready
    if ready_name == "companies" and _companies_ready:
        return
    if ready_name == "contacts" and _contacts_ready:
        return

    from botocore.exceptions import ClientError

    client = novara_api.dynamodb_resource().meta.client
    try:
        client.describe_table(TableName=table_name)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code != "ResourceNotFoundException":
            raise
        try:
            client.create_table(
                TableName=table_name,
                AttributeDefinitions=[{"AttributeName": key_name, "AttributeType": "S"}],
                KeySchema=[{"AttributeName": key_name, "KeyType": "HASH"}],
                BillingMode="PAY_PER_REQUEST",
            )
        except ClientError as create_exc:
            create_code = (create_exc.response.get("Error") or {}).get("Code")
            if create_code != "ResourceInUseException":
                raise
        client.get_waiter("table_exists").wait(
            TableName=table_name,
            WaiterConfig={"Delay": 2, "MaxAttempts": 30},
        )

    if ready_name == "companies":
        _companies_ready = True
    else:
        _contacts_ready = True


def ensure_companies_table() -> str:
    _ensure_table(COMPANIES_TABLE_NAME, "CompanyID", "companies")
    return COMPANIES_TABLE_NAME


def ensure_contacts_table() -> str:
    _ensure_table(CONTACTS_TABLE_NAME, "ContactID", "contacts")
    return CONTACTS_TABLE_NAME


def _scan(table_name: str) -> list[dict]:
    table = novara_api.dynamodb_table(table_name)
    rows: list[dict] = []
    kwargs: dict[str, Any] = {}
    while True:
        response = table.scan(**kwargs)
        rows.extend(response.get("Items", []))
        last = response.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    return [novara_api.json_safe(row) for row in rows]


def _yn(body: dict, name: str) -> str:
    raw = body.get(name)
    if raw is None:
        raw = body.get(name[0].lower() + name[1:])
    return "YES" if _text(raw).upper() in {"YES", "Y", "TRUE", "1"} else "NO"


def _company_item(body: dict) -> dict:
    company_id = _text(body.get("CompanyID") or body.get("companyId"))
    name = _text(body.get("CompanyName") or body.get("companyName") or body.get("Name"))
    if not company_id:
        raise ValueError("CompanyID is required")
    if not name:
        raise ValueError("CompanyName is required")
    return {
        "CompanyID": company_id,
        "MasterID": _text(body.get("MasterID") or body.get("masterId")),
        "CompanyName": name,
        "RelationshipType": _text(body.get("RelationshipType") or body.get("Relationship Type")),
        "ProgramPool": _yn(body, "ProgramPool"),
        "ProgramDHW": _yn(body, "ProgramDHW"),
        "ProgramHVAC": _yn(body, "ProgramHVAC"),
        "ProgramRestaurant": _yn(body, "ProgramRestaurant"),
        "ProgramOther": _yn(body, "ProgramOther"),
        "ExampleSite": _text(body.get("ExampleSite") or body.get("exampleSite")),
        "ImportAsLead": "NO",
        "NeedsReview": _yn(body, "NeedsReview"),
        "ReviewReason": _text(body.get("ReviewReason") or body.get("reviewReason")),
        "UpdatedAt": _now(),
    }


def _contact_item(body: dict) -> dict:
    contact_id = _text(body.get("ContactID") or body.get("contactId"))
    site_id = _text(body.get("SiteID") or body.get("siteId"))
    name = _text(body.get("ContactName") or body.get("contactName") or body.get("Name"))
    if not contact_id:
        raise ValueError("ContactID is required")
    if not site_id:
        raise ValueError("SiteID is required")
    if not name:
        raise ValueError("ContactName is required")
    return {
        "ContactID": contact_id,
        "MasterID": _text(body.get("MasterID") or body.get("masterId")),
        "SiteID": site_id,
        "CompanyID": _text(body.get("CompanyID") or body.get("companyId")),
        "SiteKey": _text(body.get("SiteKey") or body.get("siteKey")),
        "SiteName": _text(body.get("SiteName") or body.get("siteName")),
        "ContactName": name,
        "Email": _text(body.get("Email") or body.get("email")),
        "Phone": _text(body.get("Phone") or body.get("phone")),
        "ProgramPool": _yn(body, "ProgramPool"),
        "ProgramDHW": _yn(body, "ProgramDHW"),
        "ProgramHVAC": _yn(body, "ProgramHVAC"),
        "ProgramRestaurant": _yn(body, "ProgramRestaurant"),
        "ProgramOther": _yn(body, "ProgramOther"),
        "Source": _text(body.get("Source") or body.get("source")),
        "ImportAsLead": "NO",
        "NeedsReview": _yn(body, "NeedsReview"),
        "ReviewReason": _text(body.get("ReviewReason") or body.get("reviewReason")),
        "UpdatedAt": _now(),
    }


def _site_item(body: dict) -> dict:
    site_id = _text(body.get("SiteID") or body.get("siteId"))
    site_name = _text(body.get("SiteName") or body.get("siteName"))
    if not site_id:
        raise ValueError("SiteID is required")
    if not site_name:
        raise ValueError("SiteName is required")
    return {
        "SiteID": site_id,
        "MasterID": _text(body.get("MasterID") or body.get("masterId")),
        "CompanyID": _text(body.get("CompanyID") or body.get("companyId")),
        "SiteKey": _text(body.get("SiteKey") or body.get("siteKey")),
        "SiteName": site_name,
        "Address": _text(body.get("Address") or body.get("address")),
        "City": _text(body.get("City") or body.get("city")),
        "State": _text(body.get("State") or body.get("state")),
        "Zip": _text(body.get("Zip") or body.get("zip")),
        "Phone": _text(body.get("Phone") or body.get("phone")),
        "CustomerNumber": _text(body.get("CustomerNumber") or body.get("customerNumber")),
        "ProgramPool": _yn(body, "ProgramPool"),
        "ProgramDHW": _yn(body, "ProgramDHW"),
        "ProgramHVAC": _yn(body, "ProgramHVAC"),
        "ProgramRestaurant": _yn(body, "ProgramRestaurant"),
        "ProgramOther": _yn(body, "ProgramOther"),
        "RelatedCompany": _text(body.get("RelatedCompany") or body.get("relatedCompany")),
        "SourceCount": _text(body.get("SourceCount") or body.get("sourceCount")),
        "SourceRefs": _text(body.get("SourceRefs") or body.get("sourceRefs")),
        "ImportAsLead": "NO",
        "NeedsReview": _yn(body, "NeedsReview"),
        "ReviewReason": _text(body.get("ReviewReason") or body.get("reviewReason")),
        "Status": _text(body.get("Status") or body.get("status")) or "Needs Review",
        "Systems": 0,
        "UpdatedAt": _now(),
    }


def _put(table_name: str, key_name: str, item: dict, *, create_only: bool) -> tuple[int, dict]:
    from botocore.exceptions import ClientError

    table = novara_api.dynamodb_table(table_name)
    kwargs: dict[str, Any] = {"Item": item}
    if create_only:
        kwargs["ConditionExpression"] = f"attribute_not_exists({key_name})"
    try:
        table.put_item(**kwargs)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            return 409, {"error": f"{key_name} '{item[key_name]}' already exists"}
        raise
    return 200 if not create_only else 201, {"ok": True, "item": novara_api.json_safe(item)}


def _filter_rows(rows: list[dict], query: dict | None) -> list[dict]:
    query = query or {}
    filters = {
        "MasterID": _text((query.get("masterId") or [""])[0]),
        "CompanyID": _text((query.get("companyId") or [""])[0]),
        "SiteID": _text((query.get("siteId") or [""])[0]),
    }
    q = _text((query.get("q") or [""])[0]).lower()
    result = rows
    for key, value in filters.items():
        if value:
            result = [row for row in result if _text(row.get(key)).lower() == value.lower()]
    if q:
        result = [row for row in result if q in " ".join(_text(v).lower() for v in row.values())]
    return result


def route(method: str, path: str, *, query: dict | None = None, body: dict | None = None) -> tuple[int, dict]:
    method = (method or "GET").upper()
    normalized = "/" + (path or "").strip("/")
    body = body or {}

    if normalized == "/api/master-data/companies":
        ensure_companies_table()
        if method == "GET":
            rows = _filter_rows(_scan(COMPANIES_TABLE_NAME), query)
            rows.sort(key=lambda r: (_text(r.get("CompanyName")).lower(), _text(r.get("CompanyID"))))
            return 200, {"table": COMPANIES_TABLE_NAME, "count": len(rows), "companies": rows}
        if method in {"POST", "PUT"}:
            try:
                item = _company_item(body)
            except ValueError as exc:
                return 400, {"error": str(exc)}
            return _put(COMPANIES_TABLE_NAME, "CompanyID", item, create_only=method == "POST")
        return 405, {"error": "Method not allowed"}

    if normalized == "/api/master-data/sites":
        if method == "GET":
            rows = _filter_rows(_scan(SITES_TABLE_NAME), query)
            rows.sort(key=lambda r: (_text(r.get("SiteName")).lower(), _text(r.get("SiteID"))))
            return 200, {"table": SITES_TABLE_NAME, "count": len(rows), "sites": rows}
        if method in {"POST", "PUT"}:
            try:
                item = _site_item(body)
            except ValueError as exc:
                return 400, {"error": str(exc)}
            return _put(SITES_TABLE_NAME, "SiteID", item, create_only=method == "POST")
        return 405, {"error": "Method not allowed"}

    if normalized == "/api/master-data/contacts":
        ensure_contacts_table()
        if method == "GET":
            rows = _filter_rows(_scan(CONTACTS_TABLE_NAME), query)
            rows.sort(key=lambda r: (_text(r.get("ContactName")).lower(), _text(r.get("ContactID"))))
            return 200, {"table": CONTACTS_TABLE_NAME, "count": len(rows), "contacts": rows}
        if method in {"POST", "PUT"}:
            try:
                item = _contact_item(body)
            except ValueError as exc:
                return 400, {"error": str(exc)}
            return _put(CONTACTS_TABLE_NAME, "ContactID", item, create_only=method == "POST")
        return 405, {"error": "Method not allowed"}

    return 404, {"error": f"Unknown master-data path '{path}'"}
