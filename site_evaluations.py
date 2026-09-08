"""Persistent DHW/Pool site evaluations for Optima ProLink."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal

TABLE_NAME = os.environ.get("NOVARA_SITE_EVALUATIONS_TABLE", "NOVARASiteEvaluations")
_ready = False


def _ddb():
    import boto3
    region = (os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-west-2").strip()
    return boto3.resource("dynamodb", region_name=region)


def ensure_table():
    global _ready
    if _ready:
        return
    from botocore.exceptions import ClientError
    client = _ddb().meta.client
    try:
        client.describe_table(TableName=TABLE_NAME)
    except ClientError as exc:
        if (exc.response.get("Error") or {}).get("Code") != "ResourceNotFoundException":
            raise
        try:
            client.create_table(TableName=TABLE_NAME,AttributeDefinitions=[{"AttributeName":"EvaluationID","AttributeType":"S"}],KeySchema=[{"AttributeName":"EvaluationID","KeyType":"HASH"}],BillingMode="PAY_PER_REQUEST")
        except ClientError as create_exc:
            if (create_exc.response.get("Error") or {}).get("Code") != "ResourceInUseException":
                raise
        client.get_waiter("table_exists").wait(TableName=TABLE_NAME,WaiterConfig={"Delay":2,"MaxAttempts":30})
    _ready=True


def _safe(v):
    if isinstance(v, Decimal):
        return int(v) if v % 1 == 0 else float(v)
    if isinstance(v, dict):
        return {k:_safe(x) for k,x in v.items()}
    if isinstance(v, list):
        return [_safe(x) for x in v]
    return v


def _text(v):
    return "" if v is None else str(v).strip()


def evaluation_id(lead_id, program):
    return f"{_text(lead_id)}#{_text(program).upper()}"


def save(body):
    if not isinstance(body, dict):
        raise ValueError("JSON body is required")
    lead_id=_text(body.get("LeadID") or body.get("leadId"))
    program=_text(body.get("Program") or body.get("program"))
    if not lead_id:
        raise ValueError("LeadID is required")
    if program not in ("DHW","Pool"):
        raise ValueError("Program must be DHW or Pool")
    fields=body.get("Fields") if isinstance(body.get("Fields"),dict) else body.get("fields")
    if not isinstance(fields,dict):
        fields={}
    clean={}
    for k,v in fields.items():
        if isinstance(v,float):
            clean[str(k)]=Decimal(str(v))
        elif isinstance(v,(str,int,bool,Decimal)) or v is None:
            clean[str(k)]=v
        else:
            clean[str(k)]=str(v)
    item={"EvaluationID":evaluation_id(lead_id,program),"LeadID":lead_id,"Program":program,"Fields":clean,"UpdatedAt":datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    ensure_table(); _ddb().Table(TABLE_NAME).put_item(Item=item)
    return {"ok":True,"table":TABLE_NAME,"evaluation":_safe(item)}


def get(lead_id, program=""):
    lead_id=_text(lead_id); program=_text(program)
    if not lead_id:
        raise ValueError("leadId is required")
    ensure_table(); table=_ddb().Table(TABLE_NAME)
    if program in ("DHW","Pool"):
        r=table.get_item(Key={"EvaluationID":evaluation_id(lead_id,program)})
        return {"evaluation":_safe(r.get("Item")) if r.get("Item") else None}
    from boto3.dynamodb.conditions import Attr
    r=table.scan(FilterExpression=Attr("LeadID").eq(lead_id))
    return {"evaluations":[_safe(x) for x in r.get("Items",[])]}


def route(method, path, query=None, body=None):
    try:
        if path.rstrip("/") != "/api/site-evaluations":
            return 404,{"error":"Not found"}
        if method=="GET":
            q=query or {}
            def first(k):
                v=q.get(k); return v[0] if isinstance(v,list) and v else v or ""
            return 200,get(first("leadId"),first("program"))
        if method in ("POST","PUT"):
            return 200,save(body or {})
        if method=="OPTIONS":
            return 204,{}
        return 405,{"error":"Method not allowed"}
    except ValueError as exc:
        return 400,{"error":str(exc)}
    except Exception as exc:
        return 500,{"error":str(exc)}
