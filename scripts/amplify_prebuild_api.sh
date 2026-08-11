#!/usr/bin/env bash
# Amplify Hosting preBuild helper: deploy NOVARA Lambda/API when possible.
# Must never fail the static site publish (Sites UI / Add Site button).

set -u
export SAM_CLI_TELEMETRY=0

echo "Publishing NOVARA static site with DynamoDB JSON API"

# Prefer explicit table region; Amplify's AWS_REGION is the app region.
export AWS_DEFAULT_REGION="${NOVARA_AWS_REGION:-${AWS_REGION:-}}"
if [ -n "${AWS_DEFAULT_REGION}" ]; then
  export AWS_REGION="${AWS_DEFAULT_REGION}"
fi

# Long-term IAM keys must not carry a stale/placeholder session token.
if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ "${AWS_ACCESS_KEY_ID#AKIA}" != "${AWS_ACCESS_KEY_ID}" ]; then
  unset AWS_SESSION_TOKEN || true
fi

if ! aws sts get-caller-identity >/tmp/novara-caller.json 2>/tmp/novara-caller.err; then
  echo "AWS credentials not available in this build; skipping API deploy."
  cat /tmp/novara-caller.err || true
  echo "Configure Amplify service role (or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY),"
  echo "Set AWS_REGION/NOVARA_AWS_REGION to the DynamoDB table region, then rebuild."
  exit 0
fi

echo "AWS identity:"
cat /tmp/novara-caller.json

python3 -m pip install --user aws-sam-cli boto3 >/tmp/sam-install.log 2>&1 || {
  echo "WARN: sam install failed; see /tmp/sam-install.log"
  tail -n 50 /tmp/sam-install.log || true
  exit 0
}
export PATH="${HOME}/.local/bin:${PATH}"

if ! command -v sam >/dev/null 2>&1; then
  echo "WARN: sam CLI not available; leaving api-config.js unchanged."
  exit 0
fi

RUNTIME_PATCHED=0
TEMPLATE="template.yaml"
if ! command -v python3.12 >/dev/null 2>&1; then
  if command -v python3.10 >/dev/null 2>&1 || python3 -c 'import sys; raise SystemExit(0 if sys.version_info[:2]==(3,10) else 1)'; then
    echo "WARN: python3.12 not on PATH; building Lambda as python3.10 for this Amplify image."
    # Avoid embedding colon-bearing YAML fragments in amplify.yml by patching here.
    python3 -c '
from pathlib import Path
path = Path("template.yaml")
text = path.read_text()
src = "Runtime: " + "python3.12"
dst = "Runtime: " + "python3.10"
updated = text.replace(src, dst)
if updated == text:
    raise SystemExit("template.yaml did not contain " + src)
path.write_text(updated)
print("Patched template.yaml runtime to python3.10")
'
    RUNTIME_PATCHED=1
  else
    echo "WARN: Neither python3.12 nor python3.10 available for SAM build; skipping API deploy."
    exit 0
  fi
fi

restore_template() {
  if [ "${RUNTIME_PATCHED}" = "1" ]; then
    git checkout -- "${TEMPLATE}" 2>/dev/null || true
  fi
}

echo "Deploying NOVARA API (Lambda + HTTP API)..."
if ! sam build --template-file "${TEMPLATE}"; then
  echo "WARN: sam build failed; continuing so the static Sites UI still publishes."
  restore_template
  exit 0
fi

if ! sam deploy \
  --stack-name "${NOVARA_API_STACK:-novara-api}" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --region "${AWS_REGION}" \
  --parameter-overrides \
    "ReadingsTableName=${NOVARA_READINGS_TABLE:-NOVARAReadings}" \
    "SitesTableName=${NOVARA_SITES_TABLE:-NOVARASites}" \
    "SystemsTableName=${NOVARA_SYSTEMS_TABLE:-NOVARASystems}" \
    "OwnersTableName=${NOVARA_OWNERS_TABLE:-NOVARAOwners}" \
    "MgmtCompaniesTableName=${NOVARA_MGMT_COMPANIES_TABLE:-NOVARAMgmtCompanies}" \
    "LeadsTableName=${NOVARA_LEADS_TABLE:-NOVARALeads}" \
    "UsersTableName=${NOVARA_USERS_TABLE:-NOVARAUsers}" \
    "PreapprovedTableName=${NOVARA_PREAPPROVED_TABLE:-NOVARAPreapprovedEmails}" \
    "AdminAlertEmail=${NOVARA_ADMIN_ALERT_EMAIL:-steve@cegy.us}" \
    "SesFromEmail=${NOVARA_SES_FROM_EMAIL:-${NOVARA_ADMIN_ALERT_EMAIL:-steve@cegy.us}}" \
    "AppBaseUrl=${NOVARA_APP_BASE_URL:-}"; then
  echo "ERROR: sam deploy failed after AWS auth succeeded."
  echo "Static site will still publish, but /api/users/login and other API routes"
  echo "may keep serving a stale Lambda until novara-api is redeployed."
  echo "Check Amplify service-role permissions / NOVARA_AWS_REGION, or run:"
  echo "  python3 scripts/deploy_novara_api.py"
  restore_template
  exit 0
fi

restore_template

NOVARA_API_URL=$(aws cloudformation describe-stacks \
  --stack-name "${NOVARA_API_STACK:-novara-api}" \
  --region "${AWS_REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" \
  --output text)
NOVARA_FUNCTION_URL=$(aws cloudformation describe-stacks \
  --stack-name "${NOVARA_API_STACK:-novara-api}" \
  --region "${AWS_REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" \
  --output text)

echo "NOVARA_API_URL=${NOVARA_API_URL}"
echo "NOVARA_FUNCTION_URL=${NOVARA_FUNCTION_URL}"

if [ -n "${NOVARA_API_URL}" ] && [ "${NOVARA_API_URL}" != "None" ]; then
  python3 scripts/write_api_config.py --api-url "${NOVARA_API_URL}"
elif [ -n "${NOVARA_FUNCTION_URL}" ] && [ "${NOVARA_FUNCTION_URL}" != "None" ]; then
  python3 scripts/write_api_config.py --api-url "${NOVARA_FUNCTION_URL}"
fi

if [ -n "${AWS_APP_ID:-}" ] && [ -n "${NOVARA_API_URL}" ] && [ "${NOVARA_API_URL}" != "None" ]; then
  python3 scripts/configure_amplify_api_rewrites.py \
    --app-id "${AWS_APP_ID}" \
    --api-url "${NOVARA_API_URL}" \
    --region "${AWS_REGION}"
else
  echo "Skipping Amplify rewrite update (AWS_APP_ID or API URL missing)."
fi

exit 0
