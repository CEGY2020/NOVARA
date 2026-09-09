from __future__ import annotations

import html
import json
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Any

import boto3

import novara_api

SETTINGS_KEY = "sales-daily-reports"
PACIFIC = ZoneInfo("America/Los_Angeles")
CLOSED = {"Won", "Lost"}


def _scan_all(table) -> list[dict]:
    items: list[dict] = []
    kwargs: dict[str, Any] = {}
    while True:
        response = table.scan(**kwargs)
        items.extend(response.get("Items") or [])
        key = response.get("LastEvaluatedKey")
        if not key:
            break
        kwargs["ExclusiveStartKey"] = key
    return items


def _settings_table():
    novara_api.ensure_settings_table()
    return novara_api.dynamodb_table(novara_api.SETTINGS_TABLE_NAME)


def _get_settings() -> dict:
    item = _settings_table().get_item(Key={"SettingKey": SETTINGS_KEY}).get("Item") or {}
    return {
        "enabled": bool(item.get("Enabled", False)),
        "deliveryHour": int(item.get("DeliveryHour", 7) or 7),
        "boardRecipients": list(item.get("BoardRecipients") or []),
        "salespeople": list(item.get("Salespeople") or []),
        "leadOrder": dict(item.get("LeadOrder") or {}),
        "lastSentDate": str(item.get("LastSentDate") or ""),
    }


def _save_settings(data: dict) -> dict:
    delivery_hour = int(data.get("deliveryHour", 7) or 7)
    if delivery_hour < 0 or delivery_hour > 23:
        raise ValueError("deliveryHour must be between 0 and 23")

    board_recipients = []
    for value in data.get("boardRecipients") or []:
        email = str(value or "").strip().lower()
        if email and "@" in email and email not in board_recipients:
            board_recipients.append(email)

    salespeople = []
    for row in data.get("salespeople") or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        email = str(row.get("email") or "").strip().lower()
        if not name:
            continue
        salespeople.append({
            "name": name,
            "email": email,
            "enabled": bool(row.get("enabled", True)),
        })

    lead_order = {}
    for lead_id, raw in (data.get("leadOrder") or {}).items():
        key = str(lead_id or "").strip()
        if not key:
            continue
        try:
            lead_order[key] = int(raw)
        except (TypeError, ValueError):
            continue

    item = {
        "SettingKey": SETTINGS_KEY,
        "Enabled": bool(data.get("enabled", False)),
        "DeliveryHour": delivery_hour,
        "BoardRecipients": board_recipients,
        "Salespeople": salespeople,
        "LeadOrder": lead_order,
        "UpdatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    existing = _get_settings()
    if existing.get("lastSentDate"):
        item["LastSentDate"] = existing["lastSentDate"]
    _settings_table().put_item(Item=item)
    return _get_settings()


def _active_sales_users() -> list[dict]:
    novara_api.ensure_users_table()
    rows = _scan_all(novara_api.dynamodb_table(novara_api.USERS_TABLE_NAME))
    users = []
    for item in rows:
        user = novara_api.normalize_user(item)
        if str(user.get("status") or "") != "Active":
            continue
        if str(user.get("role") or "") != "sales":
            continue
        users.append(user)
    users.sort(key=lambda u: str(u.get("fullName") or "").lower())
    return users


def _all_leads() -> list[dict]:
    novara_api.ensure_leads_table()
    rows = _scan_all(novara_api.dynamodb_table(novara_api.LEADS_TABLE_NAME))
    return [novara_api.normalize_lead(item) for item in rows]


def _daily_sort_key(lead: dict, lead_order: dict) -> tuple:
    lead_id = str(lead.get("leadId") or "")
    assigned_order = lead_order.get(lead_id)
    if assigned_order is not None:
        return (0, int(assigned_order), "", lead_id)
    next_date = str(lead.get("nextFollowUp") or "")
    return (1, 999999, next_date or "9999-12-31", str(lead.get("companyName") or "").lower())


def _salesperson_list(name: str, leads: list[dict], lead_order: dict) -> list[dict]:
    target = name.strip().lower()
    rows = [
        lead for lead in leads
        if str(lead.get("assignedTo") or "").strip().lower() == target
        and str(lead.get("stage") or "") not in CLOSED
    ]
    rows.sort(key=lambda lead: _daily_sort_key(lead, lead_order))
    return rows


def _progress_rows(leads: list[dict], salespeople: list[dict]) -> list[dict]:
    result = []
    for person in salespeople:
        name = str(person.get("name") or "").strip()
        target = name.lower()
        assigned = [l for l in leads if str(l.get("assignedTo") or "").strip().lower() == target]
        counts = {stage: 0 for stage in novara_api.LEAD_STAGES}
        for lead in assigned:
            stage = str(lead.get("stage") or "New Lead")
            counts[stage] = counts.get(stage, 0) + 1
        active = sum(counts.get(stage, 0) for stage in novara_api.LEAD_STAGES if stage not in CLOSED)
        won = counts.get("Won", 0)
        lost = counts.get("Lost", 0)
        closed = won + lost
        result.append({
            "name": name,
            "email": str(person.get("email") or ""),
            "total": len(assigned),
            "active": active,
            "new": counts.get("New Lead", 0),
            "contacted": counts.get("Contacted", 0),
            "qualified": counts.get("Qualified", 0),
            "proposal": counts.get("Proposal Sent", 0),
            "won": won,
            "lost": lost,
            "closeRate": round((won / closed) * 100, 1) if closed else 0,
        })
    return result


def _configured_salespeople(settings: dict) -> list[dict]:
    configured = settings.get("salespeople") or []
    if configured:
        return configured
    return [
        {"name": u.get("fullName") or "", "email": u.get("email") or "", "enabled": True}
        for u in _active_sales_users()
        if u.get("fullName")
    ]


def report_payload() -> dict:
    settings = _get_settings()
    leads = _all_leads()
    salespeople = _configured_salespeople(settings)
    daily_lists = {}
    for person in salespeople:
        name = str(person.get("name") or "").strip()
        if not name:
            continue
        daily_lists[name] = _salesperson_list(name, leads, settings.get("leadOrder") or {})
    return {
        "settings": settings,
        "salespeople": salespeople,
        "dailyLists": daily_lists,
        "progress": _progress_rows(leads, salespeople),
    }


def _email(to_addr: str, subject: str, text_body: str, html_body: str) -> dict:
    from_addr = (os.environ.get("NOVARA_SES_FROM_EMAIL") or novara_api.SES_FROM_EMAIL or "").strip()
    if not to_addr or not from_addr:
        return {"ok": False, "skipped": True}
    client = boto3.client("ses", region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"))
    return client.send_email(
        Source=from_addr,
        Destination={"ToAddresses": [to_addr]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {
                "Text": {"Data": text_body, "Charset": "UTF-8"},
                "Html": {"Data": html_body, "Charset": "UTF-8"},
            },
        },
    )


def _lead_line(lead: dict, index: int) -> str:
    company = lead.get("companyName") or lead.get("siteName") or "Lead"
    contact = lead.get("contactName") or ""
    phone = lead.get("contactPhone") or ""
    date = lead.get("nextFollowUp") or "No date"
    return f"{index}. {company} | {contact} | {phone} | Next contact: {date}"


def _send_salesperson_email(person: dict, rows: list[dict]) -> dict:
    name = str(person.get("name") or "Salesperson")
    email = str(person.get("email") or "").strip()
    if not email or not bool(person.get("enabled", True)):
        return {"ok": False, "skipped": True, "name": name}
    today = datetime.now(PACIFIC).strftime("%B %d, %Y")
    lines = [f"NOVARA Daily Lead List — {name}", today, ""]
    for idx, lead in enumerate(rows, 1):
        lines.append(_lead_line(lead, idx))
    if not rows:
        lines.append("No active leads are currently assigned.")
    html_rows = "".join(
        "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>".format(
            idx,
            html.escape(str(lead.get("companyName") or lead.get("siteName") or "")),
            html.escape(str(lead.get("contactName") or "")),
            html.escape(str(lead.get("contactPhone") or "")),
            html.escape(str(lead.get("nextFollowUp") or "No date")),
        )
        for idx, lead in enumerate(rows, 1)
    )
    html_body = (
        f"<h2>NOVARA Daily Lead List — {html.escape(name)}</h2><p>{today}</p>"
        "<table border='1' cellpadding='6' cellspacing='0'><thead><tr><th>#</th><th>Company / Site</th><th>Contact</th><th>Phone</th><th>Next Contact</th></tr></thead>"
        f"<tbody>{html_rows}</tbody></table>"
    )
    response = _email(email, f"NOVARA Daily Lead List — {name}", "\n".join(lines), html_body)
    return {"ok": True, "name": name, "email": email, "response": novara_api.json_safe(response)}


def _send_board_summary(recipients: list[str], progress: list[dict]) -> list[dict]:
    if not recipients:
        return []
    text_lines = ["NOVARA Sales Progress Report", ""]
    for row in progress:
        text_lines.append(
            f"{row['name']}: Active {row['active']} | Contacted {row['contacted']} | Qualified {row['qualified']} | Proposal {row['proposal']} | Won {row['won']} | Lost {row['lost']} | Close Rate {row['closeRate']}%"
        )
    html_rows = "".join(
        "<tr><td>{name}</td><td>{active}</td><td>{contacted}</td><td>{qualified}</td><td>{proposal}</td><td>{won}</td><td>{lost}</td><td>{closeRate}%</td></tr>".format(**{k: html.escape(str(v)) for k, v in row.items()})
        for row in progress
    )
    html_body = (
        "<h2>NOVARA Sales Progress Report</h2>"
        "<table border='1' cellpadding='6' cellspacing='0'><thead><tr><th>Salesperson</th><th>Active</th><th>Contacted</th><th>Qualified</th><th>Proposal</th><th>Won</th><th>Lost</th><th>Close Rate</th></tr></thead>"
        f"<tbody>{html_rows}</tbody></table>"
    )
    results = []
    for recipient in recipients:
        response = _email(recipient, "NOVARA Sales Progress Report", "\n".join(text_lines), html_body)
        results.append({"email": recipient, "response": novara_api.json_safe(response)})
    return results


def send_daily_reports(force: bool = False) -> dict:
    payload = report_payload()
    settings = payload["settings"]
    now = datetime.now(PACIFIC)
    today = now.strftime("%Y-%m-%d")
    if not settings.get("enabled") and not force:
        return {"ok": True, "skipped": True, "reason": "disabled"}
    if not force:
        if now.hour != int(settings.get("deliveryHour", 7)):
            return {"ok": True, "skipped": True, "reason": "not delivery hour"}
        if settings.get("lastSentDate") == today:
            return {"ok": True, "skipped": True, "reason": "already sent"}

    sales_results = []
    for person in payload["salespeople"]:
        name = str(person.get("name") or "").strip()
        sales_results.append(_send_salesperson_email(person, payload["dailyLists"].get(name, [])))

    board_results = _send_board_summary(settings.get("boardRecipients") or [], payload["progress"])
    _settings_table().update_item(
        Key={"SettingKey": SETTINGS_KEY},
        UpdateExpression="SET LastSentDate = :d, LastSentAt = :t",
        ExpressionAttributeValues={":d": today, ":t": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
    )
    return {"ok": True, "sales": sales_results, "board": board_results, "date": today}


def _require_aem(headers: dict | None) -> tuple[dict | None, str | None]:
    user, error = novara_api.optional_auth_user(headers or {})
    if error:
        return None, error
    if not user:
        return None, "Authentication required"
    if str(user.get("role") or "") != "aem":
        return None, "AEM access required"
    return user, None


def route(method: str, path: str, *, headers: dict | None = None, body: dict | None = None) -> tuple[int, dict]:
    user, error = _require_aem(headers)
    if error:
        return 403, {"error": error}
    method = method.upper()
    body = body or {}
    if method == "GET":
        return 200, report_payload()
    if method == "PUT":
        try:
            return 200, {"settings": _save_settings(body)}
        except (TypeError, ValueError) as exc:
            return 400, {"error": str(exc)}
    if method == "POST" and path.endswith("/send-now"):
        return 200, send_daily_reports(force=True)
    return 405, {"error": "Method not allowed"}
