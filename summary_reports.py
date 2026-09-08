"""Persistent preliminary DHW/Pool summary reports stored with the NOVARA opportunity record."""
from __future__ import annotations
import os
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
def _attr(program): return "DHW_SummaryReport" if program=="DHW" else "Pool_SummaryReport"

def _clean_fields(fields):
    clean={}
    for k,v in fields.items():
        if isinstance(v,float): clean[str(k)]=Decimal(str(v))
        elif isinstance(v,(str,int,bool,Decimal)) or v is None: clean[str(k)]=v
        else: clean[str(k)]=str(v)
    return clean

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
        table.update_item(Key={"LeadID":lead_id},UpdateExpression="SET #a = :v",ExpressionAttributeNames={"#a":_attr(program)},ExpressionAttributeValues={":v":item},ConditionExpression="attribute_exists(LeadID)")
    except ClientError as exc:
        if (exc.response.get("Error") or {}).get("Code")=="ConditionalCheckFailedException": raise ValueError("Opportunity LeadID was not found") from exc
        raise
    return {"ok":True,"table":LEADS_TABLE_NAME,"summary":_safe(item)}

def get(lead_id,program):
    lead_id=_text(lead_id); program=_text(program)
    if not lead_id: raise ValueError("leadId is required")
    if program not in ("DHW","Pool"): raise ValueError("program must be DHW or Pool")
    raw=_ddb().Table(LEADS_TABLE_NAME).get_item(Key={"LeadID":lead_id}).get("Item") or {}
    value=raw.get(_attr(program)); return {"summary":_safe(value) if value else None}

def route(method,path,query=None,body=None):
    try:
        if path.rstrip("/")!="/api/summary-reports": return 404,{"error":"Not found"}
        if method=="GET":
            q=query or {}
            def first(k):
                v=q.get(k); return v[0] if isinstance(v,list) and v else v or ""
            return 200,get(first("leadId"),first("program"))
        if method in ("POST","PUT"): return 200,save(body or {})
        if method=="OPTIONS": return 204,{}
        return 405,{"error":"Method not allowed"}
    except ValueError as exc: return 400,{"error":str(exc)}
    except Exception as exc: return 500,{"error":str(exc)}
