#!/usr/bin/env python3
"""Deploy NOVARA Lambda + HTTP API and wire frontend/Amplify to it."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _run(cmd: list[str], *, env: dict | None = None) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, env=env, check=True)


def _aws_json(cmd: list[str], *, env: dict) -> dict:
    out = subprocess.check_output(cmd, cwd=ROOT, env=env, text=True)
    return json.loads(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stack-name", default=os.environ.get("NOVARA_API_STACK", "novara-api"))
    parser.add_argument(
        "--region",
        default=os.environ.get("NOVARA_AWS_REGION")
        or os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "us-west-2",
    )
    parser.add_argument(
        "--readings-table",
        default=os.environ.get("NOVARA_READINGS_TABLE", "NOVARAReadings"),
    )
    parser.add_argument(
        "--sites-table",
        default=os.environ.get("NOVARA_SITES_TABLE", "NOVARASites"),
    )
    parser.add_argument(
        "--systems-table",
        default=os.environ.get("NOVARA_SYSTEMS_TABLE", "NOVARASystems"),
    )
    parser.add_argument(
        "--owners-table",
        default=os.environ.get("NOVARA_OWNERS_TABLE", "NOVARAOwners"),
    )
    parser.add_argument(
        "--mgmt-companies-table",
        default=os.environ.get(
            "NOVARA_MGMT_COMPANIES_TABLE", "NOVARAMgmtCompanies"
        ),
    )
    parser.add_argument(
        "--leads-table",
        default=os.environ.get("NOVARA_LEADS_TABLE", "NOVARALeads"),
    )
    parser.add_argument(
        "--app-id",
        default=os.environ.get("AWS_APP_ID") or os.environ.get("AMPLIFY_APP_ID"),
    )
    parser.add_argument(
        "--skip-amplify-rewrite",
        action="store_true",
        help="Do not update Amplify customRules",
    )
    parser.add_argument(
        "--prefer-function-url",
        action="store_true",
        help="Prefer Lambda Function URL over HTTP API URL in api-config.js",
    )
    args = parser.parse_args(argv)

    env = os.environ.copy()
    env["AWS_REGION"] = args.region
    env["AWS_DEFAULT_REGION"] = args.region
    # Drop invalid session tokens that break long-term IAM user keys.
    access = (env.get("AWS_ACCESS_KEY_ID") or "").strip()
    token = (env.get("AWS_SESSION_TOKEN") or "").strip()
    if token and (access.startswith("AKIA") or len(token) < 100):
        env.pop("AWS_SESSION_TOKEN", None)

    if not shutil.which("sam"):
        print("ERROR: AWS SAM CLI (sam) is required on PATH", file=sys.stderr)
        return 2
    if not shutil.which("aws"):
        print("ERROR: AWS CLI (aws) is required on PATH", file=sys.stderr)
        return 2

    identity = _aws_json(["aws", "sts", "get-caller-identity", "--output", "json"], env=env)
    print(f"Deploying as {identity.get('Arn')} in {args.region}")

    _run(["sam", "build", "--template-file", "template.yaml"], env=env)
    _run(
        [
            "sam",
            "deploy",
            "--stack-name",
            args.stack_name,
            "--resolve-s3",
            "--capabilities",
            "CAPABILITY_IAM",
            "--no-confirm-changeset",
            "--no-fail-on-empty-changeset",
            "--region",
            args.region,
            "--parameter-overrides",
            f"ReadingsTableName={args.readings_table}",
            f"SitesTableName={args.sites_table}",
            f"SystemsTableName={args.systems_table}",
            f"OwnersTableName={args.owners_table}",
            f"MgmtCompaniesTableName={args.mgmt_companies_table}",
            f"LeadsTableName={args.leads_table}",
        ],
        env=env,
    )

    outputs = _aws_json(
        [
            "aws",
            "cloudformation",
            "describe-stacks",
            "--stack-name",
            args.stack_name,
            "--region",
            args.region,
            "--query",
            "Stacks[0].Outputs",
            "--output",
            "json",
        ],
        env=env,
    )
    by_key = {item["OutputKey"]: item["OutputValue"] for item in outputs or []}
    http_api = by_key.get("HttpApiUrl", "").rstrip("/")
    function_url = by_key.get("FunctionUrl", "").rstrip("/")
    api_url = function_url if args.prefer_function_url and function_url else http_api or function_url
    if not api_url:
        print("ERROR: No HttpApiUrl/FunctionUrl stack output", file=sys.stderr)
        return 1

    print(f"HttpApiUrl={http_api}")
    print(f"FunctionUrl={function_url}")
    print(f"Using api base={api_url}")

    # Write api-config for local/build artifacts only. Do not rely on committing
    # region-specific API URLs to git (Amplify same-origin rewrite is preferred).
    _run(
        [
            sys.executable,
            "scripts/write_api_config.py",
            "--api-url",
            api_url,
            "--output",
            str(ROOT / "api-config.js"),
        ],
        env=env,
    )
    print(
        "Note: api-config.js was updated locally/in-build. "
        "Keep the committed copy empty when Amplify /api rewrite is configured."
    )

    app_id = args.app_id
    if not app_id and not args.skip_amplify_rewrite:
        try:
            apps = _aws_json(
                ["aws", "amplify", "list-apps", "--region", args.region, "--output", "json"],
                env=env,
            ).get("apps", [])
            matches = [
                app
                for app in apps
                if "novara" in (app.get("name") or "").lower()
                or "novara" in (app.get("repository") or "").lower()
            ]
            if len(matches) == 1:
                app_id = matches[0]["appId"]
                print(f"Discovered Amplify app id {app_id} ({matches[0].get('name')})")
            elif matches:
                print(
                    "Multiple Amplify apps matched NOVARA; set AWS_APP_ID explicitly: "
                    + ", ".join(f"{a.get('name')}={a.get('appId')}" for a in matches)
                )
            elif apps:
                print(
                    "No Amplify app name matched NOVARA; available: "
                    + ", ".join(f"{a.get('name')}={a.get('appId')}" for a in apps[:10])
                )
        except Exception as exc:  # noqa: BLE001
            print(f"Amplify list-apps skipped: {exc}")

    if app_id and not args.skip_amplify_rewrite and http_api:
        _run(
            [
                sys.executable,
                "scripts/configure_amplify_api_rewrites.py",
                "--app-id",
                app_id,
                "--api-url",
                http_api,
                "--region",
                args.region,
            ],
            env=env,
        )
    elif not app_id:
        print("AWS_APP_ID not set; skipped Amplify rewrite update.")

    # Smoke-test endpoints against the chosen base URL.
    import urllib.error
    import urllib.request

    for path in (
        "/api/health",
        "/api/sites",
        "/api/systems",
        "/api/owners",
        "/api/mgmt-companies",
        "/api/leads",
        "/api/readings?siteId=SITE001&days=7",
        "/api/savings?days=30",
    ):
        url = f"{api_url}{path}"
        print(f"GET {url}")
        with urllib.request.urlopen(url, timeout=30) as resp:
            body = resp.read()[:300]
            ctype = resp.headers.get("Content-Type", "")
            print(f"  -> {resp.status} {ctype} {body!r}")
            if "json" not in ctype.lower() and not body[:1] in (b"{", b"["):
                print("ERROR: endpoint did not return JSON", file=sys.stderr)
                return 1

    # Verify Owners create + path update persist to NOVARAOwners.
    smoke_id = "OWN_SMOKE_DEPLOY"
    create_url = f"{api_url}/api/owners"
    create_body = json.dumps(
        {
            "OwnerID": smoke_id,
            "Name": "Deploy Smoke Owner",
            "City": "Denver",
            "State": "CO",
        }
    ).encode("utf-8")
    print(f"POST {create_url}")
    create_req = urllib.request.Request(
        create_url,
        data=create_body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(create_req, timeout=30) as resp:
            created = json.loads(resp.read().decode("utf-8"))
            print(f"  -> {resp.status} {created}")
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        # Idempotent re-deploy: allow already-exists, then update.
        if exc.code != 409:
            print(f"ERROR: POST /api/owners failed: {exc.code} {err_body}", file=sys.stderr)
            return 1
        print(f"  -> {exc.code} {err_body} (ok for redeploy)")

    update_url = f"{api_url}/api/owners/{smoke_id}"
    update_body = json.dumps(
        {
            "OwnerID": smoke_id,
            "Name": "Deploy Smoke Owner Updated",
            "City": "Boulder",
            "State": "CO",
        }
    ).encode("utf-8")
    print(f"PUT {update_url}")
    update_req = urllib.request.Request(
        update_url,
        data=update_body,
        method="PUT",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(update_req, timeout=30) as resp:
        updated = json.loads(resp.read().decode("utf-8"))
        print(f"  -> {resp.status} {updated}")
        if not updated.get("ok"):
            print("ERROR: PUT /api/owners/{id} did not return ok", file=sys.stderr)
            return 1

    # Verify Management Companies create + path update persist to NOVARAMgmtCompanies.
    mgmt_smoke_id = "MGT_SMOKE_DEPLOY"
    mgmt_create_url = f"{api_url}/api/mgmt-companies"
    mgmt_create_body = json.dumps(
        {
            "MgmtCompanyID": mgmt_smoke_id,
            "Name": "Deploy Smoke Mgmt Company",
            "City": "Denver",
            "State": "CO",
        }
    ).encode("utf-8")
    print(f"POST {mgmt_create_url}")
    mgmt_create_req = urllib.request.Request(
        mgmt_create_url,
        data=mgmt_create_body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(mgmt_create_req, timeout=30) as resp:
            mgmt_created = json.loads(resp.read().decode("utf-8"))
            print(f"  -> {resp.status} {mgmt_created}")
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        if exc.code != 409:
            print(
                f"ERROR: POST /api/mgmt-companies failed: {exc.code} {err_body}",
                file=sys.stderr,
            )
            return 1
        print(f"  -> {exc.code} {err_body} (ok for redeploy)")

    mgmt_update_url = f"{api_url}/api/mgmt-companies/{mgmt_smoke_id}"
    mgmt_update_body = json.dumps(
        {
            "MgmtCompanyID": mgmt_smoke_id,
            "Name": "Deploy Smoke Mgmt Company Updated",
            "City": "Boulder",
            "State": "CO",
        }
    ).encode("utf-8")
    print(f"PUT {mgmt_update_url}")
    mgmt_update_req = urllib.request.Request(
        mgmt_update_url,
        data=mgmt_update_body,
        method="PUT",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(mgmt_update_req, timeout=30) as resp:
        mgmt_updated = json.loads(resp.read().decode("utf-8"))
        print(f"  -> {resp.status} {mgmt_updated}")
        if not mgmt_updated.get("ok"):
            print(
                "ERROR: PUT /api/mgmt-companies/{id} did not return ok",
                file=sys.stderr,
            )
            return 1

    # Verify Leads create + path update persist to NOVARALeads.
    lead_smoke_id = "LD_SMOKE_DEPLOY"
    lead_create_url = f"{api_url}/api/leads"
    lead_create_body = json.dumps(
        {
            "LeadID": lead_smoke_id,
            "CompanyName": "Deploy Smoke Lead",
            "Stage": "New Lead",
            "Source": "Other",
        }
    ).encode("utf-8")
    print(f"POST {lead_create_url}")
    lead_create_req = urllib.request.Request(
        lead_create_url,
        data=lead_create_body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(lead_create_req, timeout=30) as resp:
            lead_created = json.loads(resp.read().decode("utf-8"))
            print(f"  -> {resp.status} {lead_created}")
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        if exc.code != 409:
            print(
                f"ERROR: POST /api/leads failed: {exc.code} {err_body}",
                file=sys.stderr,
            )
            return 1
        print(f"  -> {exc.code} {err_body} (ok for redeploy)")

    lead_update_url = f"{api_url}/api/leads/{lead_smoke_id}"
    lead_update_body = json.dumps(
        {
            "LeadID": lead_smoke_id,
            "CompanyName": "Deploy Smoke Lead Updated",
            "Stage": "Contacted",
            "Source": "Website",
            "NextFollowUp": "2026-09-01",
        }
    ).encode("utf-8")
    print(f"PUT {lead_update_url}")
    lead_update_req = urllib.request.Request(
        lead_update_url,
        data=lead_update_body,
        method="PUT",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(lead_update_req, timeout=30) as resp:
        lead_updated = json.loads(resp.read().decode("utf-8"))
        print(f"  -> {resp.status} {lead_updated}")
        if not lead_updated.get("ok"):
            print(
                "ERROR: PUT /api/leads/{id} did not return ok",
                file=sys.stderr,
            )
            return 1

    print("Deploy complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
