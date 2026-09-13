"""Persistent DHW/Pool site evaluations stored with the NOVARA opportunity record."""
from __future__ import annotations
import os
import re
from datetime import datetime, timezone
from decimal import Decimal

LEADS_TABLE_NAME=os.environ.get("NOVARA_LEADS_TABLE","NOVARALeads")

def _ddb():
    import boto3
    region=(os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-west-2").strip()
    return boto3.resource("dynamodb",region_name=region)

def _safe(v):
    if isinstance(v,Decimal): return int(v) if v%1==0 else float(v)
    if isinstance(v,dict): return {k:_safe(x) for k,x in v.items()}
    if isinstance(v,list): return [_safe(x) for x in v]
    return v

def _text(v): return "" if v is None else str(v).strip()
def _attr(program): return "DHW_SiteEvaluation" if program=="DHW" else "Pool_SiteEvaluation"

def _clean_fields(fields):
    clean={}
    for k,v in fields.items():
        if isinstance(v,float): clean[str(k)]=Decimal(str(v))
        elif isinstance(v,(str,int,bool,Decimal)) or v is None: clean[str(k)]=v
        else: clean[str(k)]=str(v)
    return clean

def _pool_record_key(fields):
    site_id=_text(fields.get("SiteID") or fields.get("siteId")) or "NO-SITE"
    pool_name=_text(fields.get("poolNameId") or fields.get("PoolNameID") or fields.get("PoolNameId"))
    if not pool_name: raise ValueError("Pool Name / ID is required")
    raw=f"{site_id}|{pool_name}".lower()
    return re.sub(r"[^a-z0-9._|-]+","-",raw).strip("-")

def _pool_evaluations(raw):
    values=raw.get("Pool_SiteEvaluations")
    found=list(values) if isinstance(values,list) else []
    legacy=raw.get("Pool_SiteEvaluation")
    if legacy:
        legacy_key=_text(legacy.get("RecordKey")) if isinstance(legacy,dict) else ""
        if not legacy_key or not any(_text(x.get("RecordKey"))==legacy_key for x in found if isinstance(x,dict)):
            found.append(legacy)
    return found

def save(body):
    if not isinstance(body,dict): raise ValueError("JSON body is required")
    lead_id=_text(body.get("LeadID") or body.get("leadId")); program=_text(body.get("Program") or body.get("program"))
    if not lead_id: raise ValueError("LeadID is required")
    if program not in ("DHW","Pool"): raise ValueError("Program must be DHW or Pool")
    fields=body.get("Fields") if isinstance(body.get("Fields"),dict) else body.get("fields")
    if not isinstance(fields,dict): fields={}
    item={"LeadID":lead_id,"Program":program,"Fields":_clean_fields(fields),"UpdatedAt":datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    table=_ddb().Table(LEADS_TABLE_NAME)
    from botocore.exceptions import ClientError
    try:
        if program=="Pool":
            raw=table.get_item(Key={"LeadID":lead_id}).get("Item") or {}
            if not raw: raise ValueError("Opportunity LeadID was not found")
            requested_key=_text(body.get("RecordKey") or body.get("recordKey"))
            record_key=requested_key or _pool_record_key(fields)
            item["RecordKey"]=record_key
            evaluations=_pool_evaluations(raw)
            replaced=False
            for i,existing in enumerate(evaluations):
                if isinstance(existing,dict) and _text(existing.get("RecordKey"))==record_key:
                    evaluations[i]=item; replaced=True; break
            if not replaced: evaluations.append(item)
            table.update_item(
                Key={"LeadID":lead_id},
                UpdateExpression="SET Pool_SiteEvaluations = :all, Pool_SiteEvaluation = :latest",
                ExpressionAttributeValues={":all":evaluations,":latest":item},
                ConditionExpression="attribute_exists(LeadID)"
            )
        else:
            table.update_item(Key={"LeadID":lead_id},UpdateExpression="SET #a = :v",ExpressionAttributeNames={"#a":_attr(program)},ExpressionAttributeValues={":v":item},ConditionExpression="attribute_exists(LeadID)")
    except ClientError as exc:
        if (exc.response.get("Error") or {}).get("Code")=="ConditionalCheckFailedException": raise ValueError("Opportunity LeadID was not found") from exc
        raise
    return {"ok":True,"table":LEADS_TABLE_NAME,"evaluation":_safe(item)}

def get(lead_id,program="",record_key=""):
    lead_id=_text(lead_id); program=_text(program); record_key=_text(record_key)
    if not lead_id: raise ValueError("leadId is required")
    table=_ddb().Table(LEADS_TABLE_NAME); raw=table.get_item(Key={"LeadID":lead_id}).get("Item") or {}
    if program=="Pool":
        evaluations=_pool_evaluations(raw)
        selected=None
        if record_key:
            selected=next((x for x in evaluations if isinstance(x,dict) and _text(x.get("RecordKey"))==record_key),None)
        if selected is None:
            selected=raw.get("Pool_SiteEvaluation") or (evaluations[-1] if evaluations else None)
        return {"evaluation":_safe(selected) if selected else None,"evaluations":_safe(evaluations)}
    if program=="DHW":
        value=raw.get("DHW_SiteEvaluation"); return {"evaluation":_safe(value) if value else None}
    found=[]
    dhw=raw.get("DHW_SiteEvaluation")
    if dhw: found.append(_safe(dhw))
    found.extend(_safe(_pool_evaluations(raw)))
    return {"evaluations":found}

def route(method,path,query=None,body=None):
    try:
        if path.rstrip("/")!="/api/site-evaluations": return 404,{"error":"Not found"}
        if method=="GET":
            q=query or {}
            def first(k):
                v=q.get(k); return v[0] if isinstance(v,list) and v else v or ""
            return 200,get(first("leadId"),first("program"),first("recordKey"))
        if method in ("POST","PUT"): return 200,save(body or {})
        if method=="OPTIONS": return 204,{}
        return 405,{"error":"Method not allowed"}
    except ValueError as exc: return 400,{"error":str(exc)}
    except Exception as exc: return 500,{"error":str(exc)}
