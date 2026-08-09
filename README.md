# NOVARA
NOVARA Operational Intellegence Platform for monitoring, optimization, analytics, fault detection, AI recommendations, and energy savings for commercial and multifamily building systems

## Local server

```bash
python3 -m pip install -r requirements.txt
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-west-2   # DynamoDB table region
python3 server.py
```

Open [http://localhost:8000/system-detail.html](http://localhost:8000/system-detail.html). The Temperature Trends chart loads SiteID `VS001` from DynamoDB table `NOVARAReadings` via `GET /api/readings?siteId=VS001&days=7`.

Sites page: [http://localhost:8000/sites.html](http://localhost:8000/sites.html) → `GET /api/sites` from `NOVARASites`.

### Readings response shape

```json
{
  "points": [
    { "t": "2026-08-02T20:00:00Z", "t1": 72.5, "t2": 68.1 }
  ],
  "lastUpdate": "2026-08-02T20:00:00Z"
}
```

### Sites response shape

```json
{
  "table": "NOVARASites",
  "count": 1,
  "sites": [
    {
      "siteId": "VS001",
      "name": "Vista Springs",
      "location": "—",
      "systems": 1,
      "status": "Online"
    }
  ]
}
```

## Why static hosting alone fails

Amplify (and GitHub Pages) static hosting cannot run `server.py`. Requests to `/api/readings` and `/api/sites` fall through to HTML (`<!DOCTYPE …`), which produces browser errors like `Unexpected token '<'`.

## Backend: Lambda + API Gateway (Amplify-compatible)

This repo deploys a Python Lambda + HTTP API (`template.yaml`) that queries:

| Endpoint | DynamoDB table |
| --- | --- |
| `GET /api/readings?siteId=VS001&days=3\|7\|30` | `NOVARAReadings` (`SiteID` + `TimestampUTC`, fields `T1`/`T2`) |
| `GET /api/sites` | `NOVARASites` |
| `POST /api/sites` | Create site in `NOVARASites` (JSON body) |
| `PUT /api/sites` | Update existing site in `NOVARASites` (JSON body) |
| `GET /api/health` | health check |

Sites create/update body fields: `SiteID` (required), `SiteName` (required), `Owner`, `MgmtCompany`, `Address`, `City`, `State`, `Zip`, `SystemType` (`DHW`/`Pool`/`HVAC`), `Status` (`Online`/`Offline`/`Needs Review`), `Systems` (number).

Frontend pages load `api-config.js` + `api-client.js`. When `window.NOVARA_API_BASE` is set, browsers call the absolute API URL (CORS enabled). When empty, they use same-origin `/api/...` (local server or Amplify reverse-proxy rewrite).

### Deploy from a workstation / Cloud Agent

```bash
python3 -m pip install -r requirements.txt awscli aws-sam-cli
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-west-2
# optional: export AWS_APP_ID=xxxx  # Amplify app id for /api rewrite
python3 scripts/deploy_novara_api.py
```

This runs `sam deploy`, writes `api-config.js`, optionally updates Amplify rewrites, and smoke-tests the JSON endpoints.

### Amplify Hosting build (`amplify.yml`)

On each Amplify build (when AWS credentials / service role can call STS):

1. `sam deploy` stack `novara-api` in the table region (`NOVARA_AWS_REGION` or `AWS_REGION`, default `us-west-2`)
2. Write `api-config.js` with the HTTP API URL
3. Set Amplify rewrite (uses built-in `AWS_APP_ID`):

`/api/<*>` → `https://{api-id}.execute-api.{region}.amazonaws.com/api/<*>`

Recommended Amplify app settings:

- Service role with permission to deploy CloudFormation/Lambda/API Gateway/IAM/S3 (or set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`)
- Env vars: `NOVARA_AWS_REGION=us-west-2` (if the Amplify app region differs from the DynamoDB region)
- Optional: `NOVARA_READINGS_TABLE`, `NOVARA_SITES_TABLE`, `NOVARA_API_STACK`

### GitHub Actions

Workflow [`.github/workflows/deploy-novara-api.yml`](.github/workflows/deploy-novara-api.yml) deploys the API on relevant pushes to `main` and commits an updated `api-config.js` so GitHub Pages also receives JSON.

Repository secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- Optional: `AWS_SESSION_TOKEN`, `AWS_APP_ID`

Optional repository variables: `AWS_REGION` / `NOVARA_AWS_REGION` (default `us-west-2`).

## Manual Amplify rewrite

```bash
export NOVARA_API_URL=$(aws cloudformation describe-stacks \
  --stack-name novara-api \
  --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" \
  --output text)
python3 scripts/configure_amplify_api_rewrites.py \
  --app-id "$AWS_APP_ID" \
  --api-url "$NOVARA_API_URL"
```
