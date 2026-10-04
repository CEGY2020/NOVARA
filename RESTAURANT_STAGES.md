# Restaurant hot water implementation stages

Source: Optima_ProLink_Handbook_Final 1.docx and Optima_ProLink_Handbook_Final_Summary2.docx supplied October 3, 2026.

## Stage 1: review workspace (implemented)

Entry: RHW > Restaurant Workspace. Nine sections cover restaurant demand, DHW and kitchen inventory, Core commissioning and proposed schedules, Alert rules and recipient channels, leak protection with/without a pump, complete contractor cost and maintenance records, Advise sizing and financial review, typed/dictated editable report requests, and per-user access requests.

Browser-local drafts are keyed by signed-in user ID (guest drafts have their own namespace). This is a draft editor, not production authorization. JSON import/export supports moving drafts between devices. Print/save PDF includes every section; these printed PDFs do not contain AcroForm fields and cannot yet be imported automatically. No draft settings are applied to controllers or sent as notifications. No default operational temperatures or fabricated telemetry are supplied.

Core alarm review flags missing dependency points. Exact models and verified points remain required. Alert owns leak configuration; Core owns heater conditions. Contractor cost sums all categories, tax and contingency. An incentive is counted only when marked verified with a source, date and unexpired program. Sizing is a screening calculation (500 × GPM × temperature rise / efficiency); final system selection, model capacity at design rise, redundancy, storage and commissioning require contractor verification. Payback uses entered annual gas and repair values and complete installed cost, never estimated savings labeled as measured.

Report brief preparation is a deterministic drafting helper, with basic Friday/daily and runtime recognition. Browser speech recognition is optional; it is not a connected AI report agent. Briefs remain editable. No real telemetry report is generated or scheduled. Access requests do not grant user rights.

## Stage 2: shared records and executive-admin grants (review first)

Add restaurant/site child records, equipment, commissioned points, schedules, recipients, quotes, maintenance history and report definitions to the authenticated API. Enforce explicit per-user store visibility and capabilities on the server. Add audit history, conflict handling, file storage and multi-device persistence. Migrate approved drafts with schema validation; never infer grants from role alone. Configure consent/recipient verification and utility access permissions.

## Stage 3: Core and Alert integration

Connect the actual supported controller and per-model points. Gate rules by verified dependencies per asset. Use correct site time zones and holiday/overnight schedules. Validate and approve control changes before applying writes. Implement event creation, acknowledgements, repeats, escalation and same-roster all-clear. Connect email, SMS and voice providers with delivery receipts and failures. Test leak sensors, optional pumps/valves and power failures separately. Replace generic system-status badges with scoped event state when the event API is ready.

## Stage 4: Advise, report agent and fillable PDFs

Build evidence-based keep/repair/replace comparisons using measured kitchen demand, model performance curves, complete contractor cost, reliability and verified incentives. Add a report agent that clarifies typed/spoken requests, previews scope/dates/days/windows/recipients, queries authorized telemetry and produces editable results with evidence and missing-data coverage. Implement daily/Friday delivery with time-zone-aware scheduling. Provide versioned fillable PDF packs with real text fields and dropdowns, phone-compatible filling guidance, attachments and authenticated upload/review; never silently treat a scanned PDF as verified structured input. PDF dictation relies on device input capability. Include one-page leave-behind and monthly/quarterly Core savings reports, with UtilityAPI only where authorized.

## Review checklist

- Complete one restaurant with a storage tank and one with a two-unit rack.
- Confirm all kitchen fixture demand fields and contractor quote categories.
- Confirm leak protection pump purpose and response options.
- Confirm alarm escalation and report scope requirements.
- Review stage one before activating integrations.

## Expanded inputs and UtilityAPI gas setup

Added demand changes/expansion, sanitation specifications, photos and piping references, loaded gas pressure, water treatment/scale history, sensor accuracy and missing-data response, acknowledgement/closure/delivery-failure procedures, protective-action approval, downtime impact, capital priorities, report interpretation review, and change approval records.

A tenth section records UtilityAPI customer authorization, gas meter UIDs, site mapping, billing history, refresh preference, collection cost approval, tariff/rate basis, gas units/conversion, other connected gas loads, DHW allocation and sync health. The Load stored gas records action reads authenticated existing ProLink records for the entered site, only when fuel or units identify gas. It does not initiate collection or monitoring, and does not label manually entered sync metadata as verified.

Existing backend settings and bills endpoints do not perform live UtilityAPI calls. Next implementation: authenticated server-side client using a protected token; explicit authorization-to-site meter mapping; gas-only meter discovery; paginated bill and available interval retrieval; idempotent records; unit preservation; data coverage; status/errors and authorized revocation. Paid historical/ongoing collections require a reviewed collection cost decision. Scheduled telemetry sync and UtilityAPI data availability are different cadences. Do not put the API token or customer credentials into browser drafts, exports or the public repository.
