# NOVARA
NOVARA Operational Intellegence Platform for monitoring, optimization, analytics, fault detection, AI recommendations, and energy savings for commercial and multifamily building systems

## Local server

```bash
python3 -m pip install -r requirements.txt
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-west-2   # or your table region
python3 server.py
```

Open [http://localhost:8000/system-detail.html](http://localhost:8000/system-detail.html). The Temperature Trends chart loads SiteID `VS001` from DynamoDB table `NOVARAReadings` via `GET /api/readings?siteId=VS001&days=7`.

Response shape:

```json
{
  "points": [
    { "t": "2026-08-02T20:00:00Z", "t1": 72.5, "t2": 68.1 }
  ],
  "lastUpdate": "2026-08-02T20:00:00Z"
}
```

## Amplify hosting

Static Amplify hosting cannot run `server.py`. This repo deploys a Lambda + HTTP API (`template.yaml`) and configures an Amplify rewrite so same-origin `GET /api/readings` returns JSON from DynamoDB.

In the Amplify app environment variables, set:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` (table region, e.g. `us-west-2`)
- Optional: `NOVARA_READINGS_TABLE` (default `NOVARAReadings`), `NOVARA_SITES_TABLE` (default `NOVARASites`)

On each Amplify build, `amplify.yml` runs `sam deploy` and updates the app rewrite:

`/api/<*>` → `https://{api-id}.execute-api.{region}.amazonaws.com/api/<*>`

Manual rewrite update (if needed):

```bash
export NOVARA_API_URL=$(aws cloudformation describe-stacks \
  --stack-name novara-api \
  --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" \
  --output text)
python3 scripts/configure_amplify_api_rewrites.py \
  --app-id "$AWS_APP_ID" \
  --api-url "$NOVARA_API_URL"
```
