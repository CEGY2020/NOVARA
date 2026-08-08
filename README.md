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
