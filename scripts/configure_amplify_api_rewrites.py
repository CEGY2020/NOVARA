#!/usr/bin/env python3
"""Point Amplify /api/* rewrites at the deployed NOVARA HTTP API."""

from __future__ import annotations

import argparse
import json
import os
import sys


def _api_rewrite_rule(api_base_url: str) -> dict:
    base = api_base_url.rstrip("/")
    return {
        "source": "/api/<*>",
        "target": f"{base}/api/<*>",
        "status": "200",
    }


def _normalize_rule(rule: dict) -> dict:
    """Normalize Amplify customRules for UpdateApp (omit null condition)."""
    normalized = {
        "source": (rule.get("source") or rule.get("Source") or "").strip(),
        "target": rule.get("target") or rule.get("Target"),
        "status": str(rule.get("status") or rule.get("Status") or "200"),
    }
    condition = rule.get("condition") if "condition" in rule else rule.get("Condition")
    if condition:
        normalized["condition"] = condition
    return normalized


def _merge_rules(existing: list[dict], api_rule: dict) -> list[dict]:
    merged = [_normalize_rule(api_rule)]
    for rule in existing or []:
        source = (rule.get("source") or rule.get("Source") or "").strip()
        if source == "/api/<*>":
            continue
        merged.append(_normalize_rule(rule))
    return merged


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-id", default=os.environ.get("AWS_APP_ID") or os.environ.get("AMPLIFY_APP_ID"))
    parser.add_argument("--api-url", default=os.environ.get("NOVARA_API_URL"))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    if not args.app_id:
        print("ERROR: Amplify app id required (--app-id / AWS_APP_ID)", file=sys.stderr)
        return 2
    if not args.api_url:
        print("ERROR: API base URL required (--api-url / NOVARA_API_URL)", file=sys.stderr)
        return 2
    if not args.region:
        print("ERROR: AWS region required (--region / AWS_REGION)", file=sys.stderr)
        return 2

    import boto3

    client = boto3.client("amplify", region_name=args.region)
    app = client.get_app(appId=args.app_id)["app"]
    existing = app.get("customRules") or []
    rules = _merge_rules(existing, _api_rewrite_rule(args.api_url))

    print(json.dumps(rules, indent=2))
    if args.dry_run:
        print("Dry run only; Amplify app not updated.")
        return 0

    client.update_app(appId=args.app_id, customRules=rules)
    print(f"Updated Amplify app {args.app_id} custom rules for /api/* → {args.api_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
