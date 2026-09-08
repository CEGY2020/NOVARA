# NOVARA HubSpot CRM Integration — v0.7

## Purpose

HubSpot is the CRM workflow layer behind NOVARA. NOVARA remains authoritative for sites, systems, telemetry, alarms, analytics, optimization, control, energy performance, and operational history.

## System boundary

- NOVARA owns operational data and control.
- HubSpot owns CRM workflow for companies, contacts, opportunities/deals, products, tasks, calls, and one-to-one email activity.
- Raw telemetry, alarms, weather, optimization calculations, and control commands must never be pushed into HubSpot.
- NOVARA IDs remain the stable cross-system keys. HubSpot object IDs are stored as external references.
- Sync operations must be idempotent and must not create duplicates when repeated.

## Phase 1 endpoints

- `GET/POST /api/crm/companies`
- `GET/PATCH /api/crm/companies/{companyId}`
- `GET/POST /api/crm/contacts`
- `GET/PATCH /api/crm/contacts/{contactId}`
- `GET/POST /api/crm/opportunities`
- `GET/PATCH /api/crm/opportunities/{opportunityId}`
- `GET /api/crm/opportunities/{opportunityId}/activities`
- `GET/POST /api/crm/tasks`
- `POST /api/crm/sync/{entityType}/{entityId}`
- `GET /api/crm/sync/status/{entityType}/{entityId}`
- `GET /api/crm/products`

## Configuration

Server-side only:

- `HUBSPOT_ACCESS_TOKEN`
- `HUBSPOT_API_BASE` (optional, defaults to `https://api.hubapi.com`)
- `NOVARA_HUBSPOT_ENABLED` (`true` to allow live writes)

Never expose HubSpot tokens or OAuth secrets in browser JavaScript.

## Implementation status

This v0.7 package establishes the reusable HubSpot client, NOVARA CRM service layer, canonical mappings, idempotent lookup/upsert logic, retry handling, and testable route-independent service functions. Wiring these functions into `novara_api.py`, `server.py`, and `template.yaml` is the next merge step so both the local server and AWS Lambda expose the Phase 1 routes.
