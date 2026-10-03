"""Reviewed customer-form imports. Original files stay private in the settings table.

One reviewed site per import; the same document can be linked to additional sites.
All record and attachment writes commit together, with retry and conflict protection.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import zipfile
from datetime import datetime, timezone
from decimal import Decimal
from xml.etree import ElementTree as ET

import master_data_api as master
import novara_api as api

MAX_FILE = 2 * 1024 * 1024
MAX_TEXT = 60000


def text(value):
    return "" if value is None else str(value).strip()


def norm(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]", " ", text(value).lower())).strip()


def key(prefix, value):
    return prefix + hashlib.sha256(value.encode()).hexdigest()[:32]


def file_data(body):
    name = text(body.get("fileName"))
    encoded = body.get("fileBase64", "")
    if not isinstance(encoded, str) or len(encoded) > (MAX_FILE * 4 // 3 + 8):
        raise ValueError("Each form must be 2 MB or smaller.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError("The uploaded file could not be decoded.") from exc
    if not raw or len(raw) > MAX_FILE:
        raise ValueError("Choose a nonempty form no larger than 2 MB.")
    ext = name.rsplit(".", 1)[-1].lower()
    if ext not in ("pdf", "docx", "xlsx", "csv"):
        raise ValueError("Use PDF, Word (.docx), Excel (.xlsx), or CSV.")
    if len(name) > 200:
        raise ValueError("Use a filename of 200 characters or fewer.")
    return name, ext, raw


def extract(ext, raw):
    if ext == "csv":
        return raw.decode("utf-8-sig")
    if ext == "pdf":
        from pypdf import PdfReader
        pdf = PdfReader(io.BytesIO(raw))
        if len(pdf.pages) > 100:
            raise ValueError("Split PDFs longer than 100 pages into smaller forms.")
        parts = [p.extract_text() or "" for p in pdf.pages]
        for name, field in (pdf.get_fields() or {}).items():
            if field.get("/V"):
                parts.append(f"{name}: {field['/V']}")
        return "\n".join(parts)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if sum(x.file_size for x in archive.infolist()) > 20 * 1024 * 1024:
            raise ValueError("This document expands beyond the supported size.")
        if ext == "docx":
            root = ET.fromstring(archive.read("word/document.xml"))
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            return "\n".join("".join(p.itertext()) for p in root.findall(".//w:p", ns))
        # Preserve worksheet names and cells as source text; do not guess row relationships.
        from openpyxl import load_workbook
        book = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        parts = []
        try:
            for sheet in book:
                parts.append("Worksheet: " + sheet.title)
                if sheet.max_row > 10000 or sheet.max_column > 200:
                    raise ValueError("Split large spreadsheets before uploading.")
                for row in sheet.iter_rows(values_only=True):
                    if any(v is not None for v in row):
                        parts.append(" | ".join(text(v) for v in row))
                    if sum(map(len, parts)) > MAX_TEXT:
                        raise ValueError("Split this workbook into smaller customer forms.")
        finally:
            book.close()
        return "\n".join(parts)


def preview(body):
    name, ext, raw = file_data(body)
    source = extract(ext, raw).strip()
    if len(source) > MAX_TEXT:
        raise ValueError("Split this document into smaller customer forms.")
    aliases = {"companyName": ("company name", "management company", "corporate name"),
               "siteName": ("site name", "property name", "school name"),
               "address": ("site address", "property address", "address"),
               "city": ("city",), "state": ("state",), "zip": ("zip", "zip code"),
               "contactName": ("contact name", "primary contact"),
               "email": ("email", "contact email"), "phone": ("phone", "contact phone")}
    fields = {}
    for target, names in aliases.items():
        matches = []
        for line in source.splitlines():
            match = re.match(r"^\s*(.+?)\s*:\s*(.+?)\s*$", line)
            if match and norm(match[1]) in names:
                matches.append(match[2])
        if len(set(matches)) == 1:
            fields[target] = matches[0]
    return {"fileName": name, "text": source, "fields": fields,
            "warning": "Review one site at a time. Multi-site tables and unlabeled fields require your selection."
            if source else "No readable text found. Enter the details manually; the original form will still be attached."}


def snapshot():
    master.ensure_companies_table()
    master.ensure_contacts_table()
    api.ensure_leads_table()
    api.ensure_settings_table()
    data = {"companies": master._scan(master.COMPANIES_TABLE_NAME),
            "sites": master._scan(master.SITES_TABLE_NAME),
            "leads": master._scan(api.LEADS_TABLE_NAME),
            "contacts": master._scan(master.CONTACTS_TABLE_NAME)}
    return json.loads(json.dumps(data), parse_float=Decimal)


def choose(rows, selected, id_field, candidates, label):
    if selected:
        found = [r for r in rows if text(r.get(id_field)) == selected]
        if len(found) != 1:
            raise ValueError(f"Selected {label} no longer exists. Reload records.")
        return found[0]
    if len(candidates) > 1:
        raise ValueError(f"More than one {label} matches. Select the correct record.")
    return candidates[0] if candidates else None


def commit(body, user):
    name, ext, raw = file_data(body)
    fields = body.get("fields")
    if not isinstance(fields, dict):
        raise ValueError("Reviewed fields are required.")
    f = {k: text(v) for k, v in fields.items()}
    for k, v in f.items():
        if len(v) > (MAX_TEXT if k == "notes" else 500):
            raise ValueError(f"{k} is too long.")
    data = snapshot()
    company = choose(data["companies"], f.get("companyId"), "CompanyID",
                     [r for r in data["companies"] if f.get("companyName") and norm(r.get("CompanyName")) == norm(f["companyName"])], "company")
    if not company and not f.get("companyName"):
        raise ValueError("Enter a company/customer name or select an existing company.")
    company_id = company["CompanyID"] if company else key("CO-FORM-", norm(f["companyName"]))
    master_id = text((company or {}).get("MasterID")) or key("MASTER-", company_id)
    candidates = [r for r in data["sites"] if
                  (f.get("address") and norm(r.get("Address")) == norm(f["address"]) and norm(r.get("City")) == norm(f.get("city"))) or
                  (f.get("siteName") and norm(r.get("SiteName")) == norm(f["siteName"]))]
    site = choose(data["sites"], f.get("siteId"), "SiteID", candidates, "site")
    if site and text(site.get("CompanyID")) and site["CompanyID"] != company_id:
        raise ValueError("This site belongs to a different company. Select that company or correct the relationship in Sites first.")
    if not site and not all(f.get(k) for k in ("siteName", "address", "city")):
        raise ValueError("New sites need a site name, street address, and city.")
    site_id = site["SiteID"] if site else key("SITE-FORM-", norm(f["address"]) + "|" + norm(f["city"]) + "|" + norm(f["siteName"]))
    site_name = text((site or {}).get("SiteName")) or f["siteName"]
    candidates = [r for r in data["leads"] if text(r.get("SiteID")) == site_id or
                  norm(r.get("SiteName") or r.get("CompanyName")) == norm(site_name)]
    lead = choose(data["leads"], f.get("leadId"), "LeadID", candidates, "lead")
    if lead and text(lead.get("SiteID")) and lead["SiteID"] != site_id:
        raise ValueError("Selected lead is linked to another site.")
    lead_id = lead["LeadID"] if lead else key("LD-FORM-", site_id)
    digest = hashlib.sha256(raw).hexdigest()
    form_id = key("FORM-", site_id + "|" + digest)
    settings = api.dynamodb_table(api.SETTINGS_TABLE_NAME)
    if settings.get_item(Key={"SettingKey": form_id}, ConsistentRead=True).get("Item"):
        return {"ok": True, "alreadyImported": True, "siteId": site_id, "leadId": lead_id, "formId": form_id}
    now = datetime.now(timezone.utc).isoformat()
    operations = []

    def put(table, key_field, item, old=None):
        request = {"TableName": table, "Item": item}
        if old is None:
            request["ConditionExpression"] = "attribute_not_exists(#id)"
            request["ExpressionAttributeNames"] = {"#id": key_field}
        else:
            # Compare every existing attribute so concurrent notes/metadata are not overwritten.
            names, values, conditions = {}, {}, []
            for i, (attr, value) in enumerate(old.items()):
                names[f"#a{i}"] = attr
                values[f":a{i}"] = value
                conditions.append(f"#a{i} = :a{i}")
            request.update(ConditionExpression=" AND ".join(conditions),
                           ExpressionAttributeNames=names, ExpressionAttributeValues=values)
        operations.append({"Put": request})

    if not company:
        company = master._company_item({"CompanyID": company_id, "MasterID": master_id,
            "CompanyName": f["companyName"], "ProgramPool": "YES", "NeedsReview": "YES",
            "ReviewReason": "Company relationship needs classification."})
        put(master.COMPANIES_TABLE_NAME, "CompanyID", company)
    if not site:
        site = master._site_item({"SiteID": site_id, "MasterID": master_id, "CompanyID": company_id,
            "SiteName": site_name, "Address": f["address"], "City": f["city"], "State": f.get("state", ""),
            "Zip": f.get("zip", ""), "ProgramPool": "YES", "NeedsReview": "YES", "SourceRefs": name})
        put(master.SITES_TABLE_NAME, "SiteID", site)
    else:
        updated_site = dict(site)
        for field, target in (("address", "Address"), ("city", "City"), ("state", "State"), ("zip", "Zip")):
            if f.get(field):
                updated_site[target] = f[field]
        if not updated_site.get("CompanyID"):
            updated_site["CompanyID"] = company_id
        if not updated_site.get("MasterID"):
            updated_site["MasterID"] = master_id
        if updated_site != site:
            updated_site["UpdatedAt"] = now
            put(master.SITES_TABLE_NAME, "SiteID", updated_site, site)
        site = updated_site
    contact = None
    if f.get("contactName"):
        candidates = [r for r in data["contacts"] if text(r.get("SiteID")) == site_id and
                      (norm(r.get("ContactName")) == norm(f["contactName"]) or
                       (f.get("email") and text(r.get("Email")).lower() == f["email"].lower()))]
        contact = choose(data["contacts"], "", "ContactID", candidates, "contact")
        updated = dict(contact or master._contact_item({"ContactID": key("CT-FORM-", site_id + "|" + norm(f["contactName"])),
            "MasterID": master_id, "CompanyID": company_id, "SiteID": site_id, "SiteName": site_name,
            "ContactName": f["contactName"], "ProgramPool": "YES", "Source": name}))
        for field, target in (("contactName", "ContactName"), ("email", "Email"), ("phone", "Phone")):
            if f.get(field):
                updated[target] = f[field]
        updated["UpdatedAt"] = now
        put(master.CONTACTS_TABLE_NAME, "ContactID", updated, contact)
    payload = dict(lead or {"LeadID": lead_id, "CompanyName": site_name, "Source": "PHEEP", "SystemType": "Pool", "Stage": "New Lead"})
    for field, target in (("contactName", "ContactName"), ("email", "ContactEmail"), ("phone", "ContactPhone"),
                          ("followUp", "NextFollowUp"), ("assignedTo", "AssignedTo"), ("stage", "Stage")):
        if f.get(field):
            payload[target] = f[field]
    note = f.get("notes", "")
    payload["Notes"] = (text(payload.get("Notes")) + "\n\n" + f"[{now[:10]} — {name}]\n" + note).strip()
    if len(payload["Notes"].encode()) > 150000:
        raise ValueError("Lead notes are too large; shorten the imported notes.")
    checked, error = api.parse_lead_payload(payload)
    if error:
        raise ValueError(error)
    payload.update(checked)
    payload.update(SiteID=site_id, SiteName=site_name, CompanyID=company_id, MasterID=master_id,
                   SiteAddress=site.get("Address", ""), City=site.get("City", ""), State=site.get("State", ""))
    put(api.LEADS_TABLE_NAME, "LeadID", {k: v for k, v in payload.items() if v is not None}, lead)
    encoded = base64.b64encode(raw).decode()
    chunks = [encoded[i:i+240000] for i in range(0, len(encoded), 240000)]
    put(api.SETTINGS_TABLE_NAME, "SettingKey", {"SettingKey": form_id, "FileName": name,
        "SiteID": site_id, "LeadID": lead_id, "CompanyID": company_id, "Chunks": len(chunks),
        "SHA256": digest, "UploadedBy": user.get("userId", ""), "UpdatedAt": now})
    for i, chunk in enumerate(chunks):
        put(api.SETTINGS_TABLE_NAME, "SettingKey", {"SettingKey": f"{form_id}#part#{i}", "Data": chunk})
    # DynamoDB's resource client serializes native Python values, including Decimal.
    api.dynamodb_resource().meta.client.transact_write_items(TransactItems=operations)
    return {"ok": True, "siteId": site_id, "leadId": lead_id, "formId": form_id}


def route(method, path, headers=None, query=None, body=None):
    if method == "OPTIONS":
        return 204, {}
    user, error = api.optional_auth_user(headers)
    if error or not user:
        return 401, {"error": error or "Sign in to upload customer forms."}
    if user.get("role") != "aem":
        return 403, {"error": "An AEM administrator must import customer forms."}
    try:
        if method == "POST" and path.endswith("/preview"):
            return 200, preview(body or {})
        if method == "POST" and path.endswith("/import"):
            return 200, commit(body or {}, user)
        if method == "GET" and path.endswith("/records"):
            data = snapshot()
            data["leads"] = [{k: r.get(k, "") for k in ("LeadID", "CompanyName", "SiteName", "SiteID", "Stage")} for r in data["leads"]]
            data.pop("contacts")
            return 200, api.json_safe(data)
        if method == "GET" and path.endswith("/documents"):
            api.ensure_settings_table()
            rows, params = [], {"FilterExpression": "begins_with(SettingKey, :prefix) AND attribute_exists(FileName)",
                "ExpressionAttributeValues": {":prefix": "FORM-"},
                "ProjectionExpression": "SettingKey, FileName, SiteID, LeadID, CompanyID, UploadedBy, UpdatedAt"}
            table = api.dynamodb_table(api.SETTINGS_TABLE_NAME)
            while True:
                page = table.scan(**params)
                rows.extend(page.get("Items", []))
                if not page.get("LastEvaluatedKey"):
                    break
                params["ExclusiveStartKey"] = page["LastEvaluatedKey"]
            return 200, {"documents": [r for r in rows if text(r.get("SettingKey")).startswith("FORM-") and "FileName" in r]}
        if method == "GET" and path.endswith("/download"):
            form_id = (query or {}).get("id", [""])[0]
            if not re.fullmatch(r"FORM-[0-9a-f]{32}", form_id):
                raise ValueError("Invalid document identifier.")
            table = api.dynamodb_table(api.SETTINGS_TABLE_NAME)
            item = table.get_item(Key={"SettingKey": form_id}, ConsistentRead=True).get("Item")
            if not item:
                return 404, {"error": "Document not found."}
            chunks = [table.get_item(Key={"SettingKey": f"{form_id}#part#{i}"}, ConsistentRead=True)["Item"]["Data"] for i in range(int(item["Chunks"]))]
            return 200, {"fileName": item["FileName"], "fileBase64": "".join(chunks)}
        return 404, {"error": "Unknown customer-form operation."}
    except (ValueError, UnicodeError, zipfile.BadZipFile, ET.ParseError) as exc:
        return 400, {"error": str(exc)}
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") == "TransactionCanceledException":
            return 409, {"error": "Records changed or this form was already imported. Reload records and try again; no partial import was saved."}
        api._LOGGER.exception("Customer form operation failed")
        return 500, {"error": "The form could not be processed. No success has been recorded; retry or contact your administrator."}
