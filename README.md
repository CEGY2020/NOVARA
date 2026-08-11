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

Open [http://localhost:8000/system-detail.html](http://localhost:8000/system-detail.html). The Temperature Trends chart loads SiteID `SITE001` from DynamoDB table `NOVARAReadings` via `GET /api/readings?siteId=SITE001&days=7`. Pass `?siteId=SITE001&systemId=SYS001` (or open a system from the Systems page) to chart one system.

Sites page: [http://localhost:8000/sites.html](http://localhost:8000/sites.html) → `GET /api/sites` from `NOVARASites`.

Systems page: [http://localhost:8000/systems.html](http://localhost:8000/systems.html) → `GET/POST/PUT /api/systems` from `NOVARASystems` (table is created automatically if missing).

Owners page: [http://localhost:8000/owners.html](http://localhost:8000/owners.html) → `GET/POST/PUT /api/owners` from `NOVARAOwners` (table is created automatically if missing).

Management Companies page: [http://localhost:8000/mgmt-companies.html](http://localhost:8000/mgmt-companies.html) → `GET/POST/PUT /api/mgmt-companies` from `NOVARAMgmtCompanies` (table is created automatically if missing).

Leads page: [http://localhost:8000/leads.html](http://localhost:8000/leads.html) → `GET/POST/PUT /api/leads` from `NOVARALeads` (table is created automatically if missing).

### Readings response shape

```json
{
  "points": [
    { "t": "2026-08-02T20:00:00Z", "t1": 72.5, "t2": 68.1 }
  ],
  "lastUpdate": "2026-08-02T20:00:00Z"
}
```

## Importing readings into NOVARAReadings

Use `scripts/import_readings.py` to load exported temperature data into DynamoDB. Place files under `data/readings/` (recommended).

### Exact CSV columns

| Column | Required | Description |
| --- | --- | --- |
| `SiteID` | Yes\* | Partition key, e.g. `SITE001`. Aliases: `Site Id`, `site_id`, `Site` |
| `SystemID` | No\* | Stored on each reading for per-system charts, e.g. `SYS001`. Aliases: `System Id`, `system_id`, `System` |
| `TimestampUTC` | Yes | Sort key, ISO-8601 UTC preferred (`2026-08-01T14:30:00Z`). Aliases: `Timestamp`, `DateTime`, `Time` |
| `T1` | Yes | Supply temperature °F. Aliases: `Supply`, `SupplyTemp` |
| `T2` | Yes | Return temperature °F. Aliases: `Return`, `ReturnTemp` |
| `RelayState` | No | Numeric relay state. Aliases: `Relay`, `relay_state` |

\*Or omit `SiteID` / `SystemID` and pass `--site-id SITE001` / `--system-id SYS001` (aliases: `--default-site-id`, `--default-system-id`).

Example (`data/readings/sample_readings.csv`):

```csv
SiteID,TimestampUTC,T1,T2,RelayState
SITE001,2026-08-01T00:00:00Z,120.5,110.2,1
SITE001,2026-08-01T01:00:00Z,121.0,110.8,1
```

Per-system file (IDs supplied on the command line):

```csv
TimestampUTC,T1,T2,RelayState
2026-08-01T00:00:00Z,120.5,110.2,1
```

### Where to put files

```text
data/readings/your_export.csv
data/readings/your_export.xlsx   # optional; needs: pip install openpyxl
```

### Import commands

```bash
# Validate only
python3 scripts/import_readings.py data/readings/your_export.csv --dry-run

# Write to DynamoDB (skips existing SiteID+TimestampUTC keys)
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=[REDACTED]
python3 scripts/import_readings.py data/readings/your_export.csv --execute

# Per-system import (CSV may be TimestampUTC,T1,T2,RelayState only)
python3 scripts/import_readings.py data/readings/vista_sys001.csv --execute \
  --site-id SITE001 --system-id SYS001

# Map a legacy / friendly site name, or set a default site
python3 scripts/import_readings.py data/readings/vista.csv --execute \
  --site-map VS001=SITE001 --default-site-id SITE001

# Replace values when the same key already exists
python3 scripts/import_readings.py data/readings/your_export.csv --execute --overwrite
```

Seed Vista Springs systems (`SYS001` / `SYS002` on `SITE001`) if needed:

```bash
python3 scripts/seed_vista_springs_systems.py --execute
```

After import, open Temperature Trends for that system (e.g. `system-detail.html?siteId=SITE001&systemId=SYS001`). The chart reads `T1`/`T2` via `GET /api/readings?siteId=…&systemId=…`. Energy Savings graphs use `GET /api/savings?days=30|90|365` (demo portfolio series until verified savings are calculated from readings).

### Sites response shape

```json
{
  "table": "NOVARASites",
  "count": 1,
  "sites": [
    {
      "siteId": "SITE001",
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
| `GET /api/readings?siteId=SITE001&days=3\|7\|30[&systemId=SYS001]` | `NOVARAReadings` (`SiteID` + `TimestampUTC`, fields `T1`/`T2`, optional `SystemID` filter) |
| `GET /api/savings?days=30\|90\|365` | Demo portfolio savings series for Energy Savings graphs (until verified calc exists) |
| `GET /api/sites` | `NOVARASites` (systems count from linked `NOVARASystems`) |
| `POST /api/sites` | Create site in `NOVARASites` (JSON body) |
| `PUT /api/sites` | Update existing site in `NOVARASites` (JSON body) |
| `GET /api/systems` | `NOVARASystems` |
| `POST /api/systems` | Create system in `NOVARASystems` (JSON body) |
| `PUT /api/systems` | Update existing system in `NOVARASystems` (JSON body) |
| `PUT /api/systems/{id}` | Update system by `SystemID` path (JSON body) |
| `DELETE /api/systems/{id}` | Delete system; refreshes linked site `Systems` count + status |
| `GET /api/owners` | `NOVARAOwners` |
| `POST /api/owners` | Create owner in `NOVARAOwners` (JSON body) |
| `PUT /api/owners` | Update existing owner in `NOVARAOwners` (JSON body) |
| `PUT /api/owners/{id}` | Update owner by `OwnerID` path (JSON body) |
| `GET /api/mgmt-companies` | `NOVARAMgmtCompanies` |
| `POST /api/mgmt-companies` | Create management company in `NOVARAMgmtCompanies` (JSON body) |
| `PUT /api/mgmt-companies` | Update existing management company in `NOVARAMgmtCompanies` (JSON body) |
| `PUT /api/mgmt-companies/{id}` | Update management company by `MgmtCompanyID` path (JSON body) |
| `GET /api/leads` | `NOVARALeads` |
| `POST /api/leads` | Create lead in `NOVARALeads` (JSON body) |
| `PUT /api/leads` | Update existing lead in `NOVARALeads` (JSON body) |
| `PUT /api/leads/{id}` | Update lead by `LeadID` path (JSON body) |
| `GET /api/health` | health check |

Sites create/update body fields: `SiteID` (required), `SiteName` (required), `Owner` (`OwnerID` from `NOVARAOwners`), `MgmtCompany` (`MgmtCompanyID` from `NOVARAMgmtCompanies`), `Address`, `City`, `State`, `Zip`, `SystemType` (`DHW`/`Pool`/`HVAC`), `Status` (`Online`/`Offline`/`Needs Review`), `Systems` (number; display count is derived from linked systems).

Systems create/update body fields: `SystemID` (required, `SYS###`), `SiteID` (required, must exist in `NOVARASites`), `SystemName` (required), `SystemType` (`DHW`/`Pool`/`HVAC`/`Boiler`), `Status` (`Online`/`Offline`/`Needs Review`/`Maintenance`), `EquipmentCount` (number), `InstallDate` (optional), `Notes` (optional). Creating, updating, or deleting a system refreshes the linked site’s `Systems` count and derives site `Status` from linked systems (`Offline` > `Needs Review`/`Maintenance` > `Online`).

Owners create/update body fields: `OwnerID` (required, `OWN###`), `Name` (required), `Address`, `City`, `State`, `Zip`, `ContactName`, `ContactEmail`, `ContactPhone`, `Notes` (optional).

Management Companies create/update body fields: `MgmtCompanyID` (required, `MGT###`), `Name` (required), `Address`, `City`, `State`, `Zip`, `ContactName`, `ContactEmail`, `ContactPhone`, `Notes` (optional).

Leads create/update body fields: `LeadID` (required, `LD###`), `CompanyName` / `SiteName` (required), `ContactName`, `ContactEmail`, `ContactPhone`, `Source` (`Carlos`/`Cam`/`Cold Call`/`Katia`/`PHEEP`/`Steve`/`Referral`/`Website`/`Rinnai`/`Trade Show`/`Other`), `SystemType` (`DHW`/`Pool`/`HVAC`/`Other`), `Stage` (`New Lead`/`Contacted`/`Qualified`/`Proposal Sent`/`Won`/`Lost`), `NextFollowUp` (`YYYY-MM-DD`), `AssignedTo`, `EstimatedSavings` (number, optional), `Notes` (optional).

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
