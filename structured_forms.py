"""Structured, reviewed portfolio imports. No customer-specific records in source."""
import base64
import hashlib
import json
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


def parse(source):
    """Recognize labeled records and the contact-directory/savings form layout.

    Unknown prose stays in the source document, never automatically in lead notes.
    Unchecked eligibility boxes mean unknown, not false or confirmed.
    """
    lines = [s.strip() for s in source.splitlines() if s.strip()]
    company = {"CompanyName": "", "RelationshipType": ""}
    sites, contacts, seen = [], [], set()
    address_re = re.compile(r"^(\d[^\n]+),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$")
    def address(value):
        m = address_re.match(value)
        return dict(zip(("Address", "City", "State", "Zip"), m.groups())) if m else {}
    for line in lines:
        m = re.match(r"^(.+?)\s*[-–—]\s*(?:Regional Contacts|Contact Directory|Site Savings Estimates)$", line)
        if m:
            company["CompanyName"] = m[1].strip()
            break
    if any("PROPERTY MANAGEMENT" in s for s in lines):
        company["RelationshipType"] = "MGMT"
    aliases = {"company name":"CompanyName", "management company":"CompanyName", "owner name":"OwnerName",
               "site name":"SiteName", "property name":"SiteName", "contact name":"ContactName",
               "email":"Email", "phone":"Phone", "title":"Title", "address":"Address",
               "site address":"Address", "city":"City", "state":"State", "zip":"Zip", "zip code":"Zip"}
    labels = {}
    for i, line in enumerate(lines):
        m = re.match(r"^([^:]+):\s*(.+)$", line)
        if m and m[1].lower() in aliases:
            labels[aliases[m[1].lower()]] = m[2]
    if labels.get("CompanyName"):
        company["CompanyName"] = labels["CompanyName"]
    if re.search(r"(?im)^management company:", source):
        company["RelationshipType"] = "MGMT"
    if labels.get("SiteName"):
        site = {k:labels[k] for k in ("SiteName","Address","City","State","Zip","OwnerName") if labels.get(k)}
        site.update(address(site.get("Address", "")))
        site["ManagementStatus"] = "Needs confirmation"
        sites.append(site);seen.add(site["SiteName"])
    for i, line in enumerate(lines):
        a = address(line)
        if not a or not i:
            continue
        previous = lines[i-1]
        if previous.lower() in ("address", "office address", "regional office") or re.search(r"\d{3}[-.) ]\d{3}[-. ]\d{4}", previous):
            company.update(a)
            continue
        if previous in seen or previous.lower().startswith(("source", "phone", "http")):
            continue
        seen.add(previous)
        sites.append({"SiteName": previous, **a, "OwnerName": labels.get("OwnerName", ""),
                      "ManagementStatus":"Needs confirmation", "NeedsReview":"YES"})
    # Primary corporate phone is a switchboard, not a person's direct number.
    for i, line in enumerate(lines):
        if line.lower() in ("phone", "office phone") and i+1 < len(lines):
            m = re.search(r"(?:\+1[ -]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}", lines[i+1])
            if m:
                company["Phone"] = m[0]
                company["PhoneType"] = "Office / switchboard"
                break
    for i, line in enumerate(lines):
        # Directory: a name followed by an explicit professional role.
        if i+1 < len(lines) and re.fullmatch(r"[A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){1,3}", line):
            title = lines[i+1]
            if re.search(r"\b(?:Manager|Director|Engineer)\b", title) and not any(c["ContactName"] == line for c in contacts):
                contacts.append({"ContactName":line, "Title":title, "Scope":"Company", "Email":"", "Phone":"",
                                 "OfficePhone":company.get("Phone", ""), "VerificationStatus":"Role and assignment need confirmation"})
    if not contacts and labels.get("ContactName"):
        contacts.append({k:labels.get(k, "") for k in ("ContactName", "Title", "Email", "Phone")})
        contacts[-1]["Scope"] = "Company" if len(sites) != 1 else "Site"
        if len(sites) == 1:
            contacts[-1]["SiteName"] = sites[0]["SiteName"]
    form_values = dict(re.findall(r"(?ms)^((?:site_\d+_(?:area|rate|monthly|annual))|progress|stage|assigned|c\d+_\w+):[ \t]*(.*?)(?=\n(?:site_\d+_\w+|progress|stage|assigned|c\d+_\w+|chk_\w+):|\Z)", source))
    form_values = {k:v.strip() for k,v in form_values.items()}
    for i, site in enumerate(sites):
        # Match indices only for the explicitly recognized savings-template layout.
        if "Site Savings Estimates" in source:
            for suffix, field in (("area","PoolAreaSqFt"),("rate","SavingsAllowanceMonthlyPer800SqFt")):
                if form_values.get(f"site_{i}_{suffix}"):
                    site[field] = form_values[f"site_{i}_{suffix}"]
            if site.get("PoolAreaSqFt"):
                site["PoolAreaStatus"] = "Source estimate; verify before quoting"
        for j, line in enumerate(lines[:-2]):
            if line != site["SiteName"]:
                continue
            finding = lines[j+1]
            if "page active" in finding.lower() or finding == "CONFIRM CURRENT MANAGER":
                site["ManagementStatus"] = "Unconfirmed" if finding == "CONFIRM CURRENT MANAGER" else "Source listing; verify current manager"
                site["PoolEvidence"] = lines[j+2]
                count = re.search(r"\b(\d+) pools\b", lines[j+2], re.I)
                if count:
                    site["PoolCount"] = count[1]
        # Old areas printed in narrative are not imported as current measurements.
        for j, line in enumerate(lines[:-1]):
            if line == site["SiteName"] and "older area" in lines[j+1].lower():
                site["ReviewReason"] = lines[j+1]
    company["Notes"] = form_values.get("progress", "")
    logs = []
    for n in sorted(set(re.findall(r"(?m)^c(\d+)_", source))):
        row = {field:form_values.get(f"c{n}_{suffix}", "") for suffix,field in
               (("datetime","DateTime"),("method","Method"),("person","Person"),("phone","PhoneEmail"),
                ("notes","Outcome"),("next","NextAction"),("followup","FollowUp"))}
        if any(row.values()):
            logs.append(row)
    return {"company":company, "contacts":contacts, "sites":sites, "contactLogs":logs,
            "warnings":["Review all records. Blank ownership and email fields remain unknown.",
                        "Pool sizes and savings are preliminary. Unconfirmed managers are not assigned to sites."]}


def commit(body, user):
    import customer_forms as forms
    api, master = forms.api, forms.master
    name, ext, raw = forms.file_data(body)
    bundle = body.get("structured")
    if not isinstance(bundle, dict) or body.get("reviewed") is not True:
        raise ValueError("Review the structured records before saving.")
    company_in, sites_in, contacts_in = bundle.get("company", {}), bundle.get("sites", []), bundle.get("contacts", [])
    if not isinstance(company_in, dict) or not isinstance(sites_in, list) or not isinstance(contacts_in, list):
        raise ValueError("Invalid structured records.")
    if len(sites_in) > 30 or len(contacts_in) > 20:
        raise ValueError("Import at most 30 sites and 20 contacts per document.")
    def clean(row, fields):
        if not isinstance(row, dict):
            raise ValueError("Each record must be an object.")
        result = {}
        for field in fields:
            value = forms.text(row.get(field))
            if len(value) > (5000 if field in ("Notes", "PoolEvidence", "ReviewReason") else 500):
                raise ValueError(field + " is too long.")
            if value:
                result[field] = value
        if result.get("Email") and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", result["Email"]):
            raise ValueError("Enter a valid email or leave it blank.")
        return result
    company = clean(company_in, ("CompanyName","RelationshipType","Address","City","State","Zip","Phone","Email","Notes"))
    if not company.get("CompanyName"):
        raise ValueError("Company name is required.")
    relationship = company.get("RelationshipType", "")
    if relationship not in ("", "MGMT", "OWNER"):
        raise ValueError("Company relationship must be MGMT, OWNER, or blank.")
    data = forms.snapshot()
    api.ensure_owners_table(); api.ensure_mgmt_companies_table()
    def scan(table):
        return json.loads(json.dumps(master._scan(table)), parse_float=Decimal)
    owners, managers = scan(api.OWNERS_TABLE_NAME), scan(api.MGMT_COMPANIES_TABLE_NAME)
    old_company = forms.choose(data["companies"], forms.text(company_in.get("CompanyID")), "CompanyID",
        [r for r in data["companies"] if forms.norm(r.get("CompanyName")) == forms.norm(company["CompanyName"])], "company")
    company_id = old_company["CompanyID"] if old_company else forms.key("CO-FORM-", forms.norm(company["CompanyName"]))
    master_id = (old_company or {}).get("MasterID") or forms.key("MASTER-", company_id)
    digest = hashlib.sha256(raw).hexdigest()
    form_id = forms.key("FORM-", "structured-v2|" + company_id + "|" + digest)
    settings = api.dynamodb_table(api.SETTINGS_TABLE_NAME)
    existing_form = settings.get_item(Key={"SettingKey":form_id}, ConsistentRead=True).get("Item")
    if existing_form:
        return {"ok":True,"alreadyImported":True,"formId":form_id,"siteIds":existing_form.get("SiteIDs", [])}
    now = datetime.now(timezone.utc).isoformat()
    pending = {}
    def put(table, pk, row, old=None):
        token = (table, row[pk])
        if token in pending:
            raise ValueError("Duplicate records in this review. Remove duplicates before saving.")
        item = dict(old or {}); item.update(row); item["UpdatedAt"] = now
        request = {"TableName":table,"Item":item}
        if old:
            request["ExpressionAttributeNames"] = {f"#a{i}":k for i,k in enumerate(old)}
            request["ExpressionAttributeValues"] = {f":a{i}":v for i,v in enumerate(old.values())}
            request["ConditionExpression"] = " AND ".join(f"#a{i} = :a{i}" for i in range(len(old)))
        else:
            request.update(ConditionExpression="attribute_not_exists(#id)",ExpressionAttributeNames={"#id":pk})
        pending[token] = {"Put":request}
        return item
    def entity(table, rows, pk, entity_name, extras=None):
        old = forms.choose(rows, "", pk, [r for r in rows if forms.norm(r.get("Name") or r.get("OwnerName") or r.get("MgmtCompanyName")) == forms.norm(entity_name)], "owner/manager")
        eid = old[pk] if old else forms.key("OWN-FORM-" if pk == "OwnerID" else "MG-FORM-", forms.norm(entity_name))
        if (table,eid) not in pending:
            put(table,pk,{pk:eid,"Name":entity_name,**(extras or {})},old)
        return eid
    company["CompanyID"] = company_id; company["MasterID"] = master_id
    company["SourceRefs"] = name
    previous_notes = forms.text((old_company or {}).get("Notes"))
    if previous_notes and company.get("Notes") and company["Notes"] not in previous_notes:
        company["Notes"] = previous_notes + "\n\n" + company["Notes"]
    if not old_company:
        company.update(ProgramPool="YES",NeedsReview="YES")
    mgmt_id = owner_id = ""
    office = {k:company[k] for k in ("Address","City","State","Zip") if company.get(k)}
    if company.get("Phone"): office["ContactPhone"] = company["Phone"]
    if company.get("Email"): office["ContactEmail"] = company["Email"]
    if relationship == "MGMT":
        mgmt_id = entity(api.MGMT_COMPANIES_TABLE_NAME,managers,"MgmtCompanyID",company["CompanyName"],office)
        company["MgmtCompanyID"] = mgmt_id
    if relationship == "OWNER":
        owner_id = entity(api.OWNERS_TABLE_NAME,owners,"OwnerID",company["CompanyName"],office)
        company["OwnerID"] = owner_id
    put(master.COMPANIES_TABLE_NAME,"CompanyID",company,old_company)
    site_ids, lead_ids, site_names = [], [], {}
    for raw_site in sites_in:
        site = clean(raw_site,("SiteName","Address","City","State","Zip","Phone","OwnerName","ManagementStatus",
            "PoolAreaStatus","PoolEvidence","ReviewReason","Notes"))
        if not all(site.get(k) for k in ("SiteName","Address","City")):
            raise ValueError("Each site needs a name, address, and city.")
        old = forms.choose(data["sites"],forms.text(raw_site.get("SiteID")),"SiteID",[r for r in data["sites"] if
            forms.norm(r.get("SiteName")) == forms.norm(site["SiteName"]) or
            (forms.norm(r.get("Address")) == forms.norm(site["Address"]) and forms.norm(r.get("City")) == forms.norm(site["City"]))],"site")
        sid = old["SiteID"] if old else forms.key("SITE-FORM-", forms.norm(site["Address"])+"|"+forms.norm(site["City"])+"|"+forms.norm(site["SiteName"]))
        if old and old.get("CompanyID") and old["CompanyID"] != company_id:
            raise ValueError(site["SiteName"] + " is linked to another company. Correct its relationship first.")
        unconfirmed = site.get("ManagementStatus", "").lower() in ("unconfirmed", "needs confirmation")
        site.update(SiteID=sid,SourceRefs=name,NeedsReview="YES",SourceCompanyID=company_id)
        if not unconfirmed or relationship == "OWNER":
            site.update(CompanyID=company_id,MasterID=master_id)
        if mgmt_id and not unconfirmed:
            if old and old.get("MgmtCompanyID") and old["MgmtCompanyID"] != mgmt_id:
                raise ValueError(site["SiteName"] + " has a different manager; resolve before importing.")
            site.update(MgmtCompanyID=mgmt_id,MgmtCompany=company["CompanyName"])
        named_owner = site.pop("OwnerName", "")
        site_owner = entity(api.OWNERS_TABLE_NAME,owners,"OwnerID",named_owner) if named_owner else owner_id
        if site_owner:
            if old and old.get("OwnerID") and old["OwnerID"] != site_owner:
                raise ValueError(site["SiteName"] + " has a different owner; resolve before importing.")
            site.update(OwnerID=site_owner,Owner=named_owner or company["CompanyName"])
        for field in ("PoolAreaSqFt","SavingsAllowanceMonthlyPer800SqFt","PoolCount"):
            val = forms.text(raw_site.get(field))
            if val:
                try: number = Decimal(val.replace(",", ""))
                except InvalidOperation: raise ValueError(field + " must be a number.")
                if not number.is_finite() or number < 0 or number > 10000000:
                    raise ValueError(field + " is outside the supported range.")
                if field == "PoolCount" and number != number.to_integral_value():
                    raise ValueError("Pool count must be a whole number.")
                site[field] = number
        if site.get("PoolAreaSqFt") and site.get("SavingsAllowanceMonthlyPer800SqFt"):
            monthly = site["PoolAreaSqFt"] / Decimal(800) * site["SavingsAllowanceMonthlyPer800SqFt"]
            site["EstimatedMonthlySavings"] = monthly.quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
            site["EstimatedAnnualSavings"] = (monthly*12).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
            site["SavingsStatus"] = "Preliminary estimate; not guaranteed"
        if not old: site.update(ProgramPool="YES",Systems=0,Status="Needs Review")
        put(master.SITES_TABLE_NAME,"SiteID",site,old)
        site_ids.append(sid); site_names[forms.norm(site["SiteName"])] = sid
        matches = [r for r in data["leads"] if r.get("SiteID") == sid or (not r.get("SiteID") and forms.norm(r.get("CompanyName")) == forms.norm(site["SiteName"]))]
        lead = forms.choose(data["leads"],"","LeadID",matches,"lead")
        lid = lead["LeadID"] if lead else forms.key("LD-FORM-",sid)
        payload = {"LeadID":lid,"SiteID":sid,"SiteName":site["SiteName"],"SourceCompanyID":company_id}
        if not unconfirmed or relationship == "OWNER": payload.update(CompanyID=company_id,MasterID=master_id)
        if not lead: payload.update(CompanyName=site["SiteName"],Source="PHEEP",SystemType="Pool",Stage="New Lead")
        if site.get("Notes"):
            payload["Notes"] = (forms.text((lead or {}).get("Notes"))+"\n"+site["Notes"]).strip()
        if site.get("EstimatedAnnualSavings") is not None: payload["EstimatedSavings"] = site["EstimatedAnnualSavings"]
        put(api.LEADS_TABLE_NAME,"LeadID",payload,lead); lead_ids.append(lid)
    contact_ids = []
    for raw_contact in contacts_in:
        contact = clean(raw_contact,("ContactName","Title","Scope","SiteName","Email","Phone","OfficePhone","VerificationStatus","Notes"))
        if not contact.get("ContactName"): raise ValueError("Each contact needs a name.")
        scope = contact.get("Scope", "Company")
        if scope not in ("Company","Site"): raise ValueError("Contact scope must be Company or Site.")
        sid = site_names.get(forms.norm(contact.pop("SiteName", "")), "") if scope == "Site" else ""
        if scope == "Site" and not sid: raise ValueError("Site contact must name one of the reviewed sites.")
        matches = [r for r in data["contacts"] if r.get("CompanyID") == company_id and forms.text(r.get("SiteID")) == sid and
                   (forms.norm(r.get("ContactName")) == forms.norm(contact["ContactName"]) or (contact.get("Email") and forms.text(r.get("Email")).lower() == contact["Email"].lower()))]
        old = forms.choose(data["contacts"],forms.text(raw_contact.get("ContactID")),"ContactID",matches,"contact")
        if old and (old.get("CompanyID") != company_id or forms.text(old.get("SiteID")) != sid):
            raise ValueError("Selected contact belongs to a different company or site.")
        cid = old["ContactID"] if old else forms.key("CT-FORM-",(sid or company_id)+"|"+forms.norm(contact["ContactName"]))
        contact.update(ContactID=cid,CompanyID=company_id,MasterID=master_id,SiteID=sid,Scope=scope,Source=name)
        if sid:
            contact["SiteName"] = next(s["SiteName"] for s in sites_in if forms.norm(s["SiteName"]) in site_names and site_names[forms.norm(s["SiteName"]) ] == sid)
        put(master.CONTACTS_TABLE_NAME,"ContactID",contact,old); contact_ids.append(cid)
    logs = bundle.get("contactLogs", [])
    if not isinstance(logs,list) or len(logs)>30: raise ValueError("Invalid contact history.")
    history = [clean(row,("DateTime","Method","Person","PhoneEmail","Outcome","NextAction","FollowUp")) for row in logs]
    if history:
        company_item = pending[(master.COMPANIES_TABLE_NAME,company_id)]["Put"]["Item"]
        company_item["ContactHistory"] = list((old_company or {}).get("ContactHistory") or []) + [dict(row, SourceFormID=form_id) for row in history]
    encoded = base64.b64encode(raw).decode()
    chunks = [encoded[i:i+240000] for i in range(0,len(encoded),240000)]
    metadata = {"SettingKey":form_id,"FileName":name,"CompanyID":company_id,"SiteID":"", "LeadID":"",
        "SiteIDs":site_ids,"LeadIDs":lead_ids,"ContactIDs":contact_ids,"ContactHistory":history,"ImportVersion":2,
        "SHA256":digest,"Chunks":len(chunks),"UploadedBy":user.get("userId", ""),"UpdatedAt":now}
    put(api.SETTINGS_TABLE_NAME,"SettingKey",metadata)
    for i,chunk in enumerate(chunks): put(api.SETTINGS_TABLE_NAME,"SettingKey",{"SettingKey":f"{form_id}#part#{i}","Data":chunk})
    if len(pending)>100 or len(json.dumps(list(pending.values()),default=str).encode()) > 3800000:
        raise ValueError("This import is too large for one save; use a smaller document.")
    api.dynamodb_resource().meta.client.transact_write_items(TransactItems=list(pending.values()))
    return {"ok":True,"formId":form_id,"companyId":company_id,"siteIds":site_ids,"contactIds":contact_ids,"leadIds":lead_ids}
