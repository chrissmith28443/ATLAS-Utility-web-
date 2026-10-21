# NOTES — cross-session context

## COP (Common Operational Picture) — design in progress (started 2026-10-21)

New view: pipeline strip of stages on top, shipment table below, per-stage
requirement checklists. Shippers use "My shipments"; managers see all + per-POC rollup.
Built on the Metrics UDQ + existing Christmas Tree / Audit engines (same rules, same wording).
SRF only to start.

### Sources
- Sample: `Downloads\UDQ_Metrics (SRF).xlsx` (226 WMTRs, 45 active)
- `TTI\ATLAS Requests\Step by Step_24 Jul 2025.docx` (Steps 1-3: QR, RFQ, Estimate Prep)
- `TTI\ATLAS Requests\Required Docs Checklist.docx`: RC, AWB/BoL, CIV, PKL, AES/MFR (exp),
  SLI (exp), MCT (imp), VAT, Photo w/ Label, Pallet Placard/Label, POD, PO, Vendor Invoice

### Data facts
- `Status` field carries both approval statuses AND shipping-activity statuses.
- Workflow Logs record every status change incl. `(Approved)` / `(Rejected)` variants.
- Daily Status History = Date + free-text note → newest one shown on hover + table column.
- Falls off default view: Completed, Ready To Invoice, Invoiced, Cancelled (w/ or w/o charges).
  These go in a separate "Closed" view.

### Decisions (questionnaire answers)
1. Lanes (8): Draft | TTI Quality Review | DTRA Program Review | DTRA Compliance Review |
   Estimate (TTI Est Prep, CT >100K, DTRA Est Review) | Ready to Ship (DTRA Approved, Pending,
   Scheduled) | In Transit (Picked Up … Out for Delivery, incl. customs) |
   Delivered (Pending POD, POD Received). Exact ATLAS status shown on each shipment.
2. Problem statuses (Delayed, On Hold, Exception, Failed Delivery, Returned to Sender):
   red badge, shipment stays in its last real lane.
3. Drafts: shown in Draft lane; amber "stale draft" badge after N days.
4. TTI QR checks — REQUIRED (red): addresses+POCs (not Intermediate Consignee); every
   inventory line has Description, Model/Catalog #, Qty, UoM, UoI, ECCN/USML, Sched B/HTS,
   Mfr COO. RECOMMENDED (amber): Identify As / Mode / Tracing / Shipment Type filled; Value
   per line; est or final wt/dims per line; Temp Control + HAZMAT filled (N/A/TBD ok);
   Ship Group # per line; no CIV uploaded yet.
5. Denied Party Screen Result: DTRA fills at Compliance; red if blank after Compliance approved.
6. Every inventory line needs BIS/DDTC Authorization/Exception once Compliance approved (red).
7. RFQ Sent + Pack Date: not in ATLAS yet → manual dates, read from the TTI Ops Tracker
   (user enters them there). RFQ due ≤24h (1 business day) after Compliance approved.
8. Ops Tracker .xlsx is dropped alongside the UDQ (re-dropped regularly), matched by WMTR.
   Longer term the user wants it automated: move the tracker into ATLAS (request RFQ Sent /
   Pack Date fields from TTI devs) or pull it from its shared location directly.
9. Ops Tracker lives on SharePoint/Teams (auto-pull later would mean Microsoft Graph + TTI IT).
10. Estimate checks — REQUIRED: RFQ Sent ≤1 BD after Compliance approved; Cost List ≥1 line
    Rate Type "Services" with Burdened Rate; Total Cost > 0; CIV attached (Commercial/Proforma
    Invoices or Draft CIV); Estimate attached; Total Cost > $100K → CT Program > 100K Approval
    in workflow. RECOMMENDED: Vendor Bid attached; RFQ Email/Attachment uploaded; Total Cost =
    sum of Cost List Total in USD.
11. Estimate attachment: user added the Request/Estimate section to the Metrics UDQ in ATLAS
    (2026-10-21) — need a fresh sample export to get its exact section/column names.
12. Doc timing (couriers = AWB/BoL + POD only; Hand Carry exempt):
    - Due by Picked Up (leaving Ready to Ship): PO, final CIV, PKL, SLI + AES/MFR_NO AES
      (US exports), Photo w/ Label, Pallet Placard/Label, RC (if via warehouse), DG Declaration
      (if any HAZMAT/UN line), Pack Date (tracker).
    - In Transit: AWB/BoL attached + AWB/BoL & Carrier fields; VAT Exemption.
    - Before close-out (Delivered → Completed): POD, MCT (US imports), Vendor Invoice.
13. Pallet Placard: new ATLAS attachment type "Pallet Placard" (added 2026-10-21). Older
    records used "Other" → also accept Other with "placard" in the file name.
14. RDD (undelivered): amber when RDD ≤5 business days away; red once past unless an
    "Approval to Adjust RDD" attachment exists.
15. Stuck thresholds (business days in lane, amber/red; editable): Draft 10/20, TTI QR 2/3,
    DTRA Program 3/5, DTRA Compliance 3/5, Estimate-TTI prep 2/3, Estimate-DTRA review 3/5,
    Ready to Ship 10/20, In Transit none, Delivered→Completed 5/10.
16-17. Daily updates REQUIRED every business day from the moment a request leaves Draft
    (first TTI Quality Review stamp) until delivery. This is the business rule — the
    Christmas Tree + PMR daily metric (which today only count from the first entry) must be
    changed to match. Separate change; affects reported numbers.
18. "My shipments" = primary TTI POC only (name picked once, remembered per browser).
19. Consols: separate rows (each scored), "Consol w/ …" tag, hover highlights partners.
20. Hover card: latest daily update (date + note), open red/amber items, Carrier + AWB/BoL
    (+ tracking link).
21. Table columns: WMTR, lane + ATLAS status, latest daily update, flag count, TTI POC (hidden
    in My shipments), RDD + countdown, days in lane, destination + mode, CTR Program + title.
22. Manager extras: per-POC rollup grid (click to filter), Excel export, print/PDF snapshot,
    copy-as-text summary.
23. Overrides: per-check "Acknowledge", browser-local, sharing the Christmas Tree ignore list.
24. Menu: rename "Metrics" section → "Management", move it to the TOP of the menu (above
    Shipping). COP is the first item in it. Loading/fetching a Metrics UDQ opens COP by default.
25. Closed view: every closed shipment (Completed, Ready To Invoice, Invoiced, Cancelled*),
    filterable — no date window.
Defaults I chose (not asked): Red Flag field shown prominently; status still "Delivered -
Pending POD" with a POD attached → amber "update status"; RC needed if workflow shows
Arrived Warehouse or the warehouse actual date is filled.

### Ops Tracker (sample: Downloads\Current_Ops_Tracker_AES.xlsx)
- Sheet "Active MTR", header row 1. Key col A "MTR" = WMTR without the -SRF suffix
  (section-divider rows like "New MTRs as of …" mixed in → skip non-WMTR rows).
- Columns used: "Date Packed", "RFQ Sent", "Estimated Export Date/Time", "AES Class"
  (Yes / F2F / Import / No), "ITN / NOEEI Citation", "MARAD Due Date", "MARAD Submitted".
- Tracker's own formulas: AES Alert (AES NOT SET / OK - F2F / OK - IMPORT / EXCEPTION MISSING /
  OK / ETD REQUIRED / CRITICAL - PAST ETD / RED - <72 HOURS / YELLOW - <5 DAYS / PENDING) and
  Shipment Release (HOLD - CONFIRM AES / HOLD - ITN REQUIRED / HOLD - ADD EXEMPTION / RELEASED…).
- Also "Closed MTR Tracker" tab (same layout-ish, ITN col 20) and "Closed MTR Audit".
- ITN matters: TTI was hit before for a shipment departing before AES was filed.

### Request Estimate List (new UDQ section, confirmed in 21 Oct QA export)
- Title "Request Estimate List" in col B; header row: Revision | Request | Request Date |
  Estimate | Estimate Date | Layout Date | Layout. Estimate = PDF filename.
- Check json_udq.js rebuilds this section on fetch.

26. AES/ITN (tracker AES Class / ITN / Estimated Export Date): blank class on a US export →
    red "Confirm AES"; "No" + no citation → red "Exemption missing"; "Yes" + no ITN → amber
    "ETD required" (no ETD), amber ETD ≤5 days, red ETD ≤72 h, red past ETD, and HARD RED
    "Departed without ITN" once ATLAS status is Picked Up or later. F2F/Import/ITN → clear.
    Cross-checks (amber): AES class doesn't fit ATLAS route (US→US "Yes", foreign→foreign
    "Yes", X→US "F2F"…); active in ATLAS but not on tracker Active MTR tab.
27. MARAD: only when mode is sealift (Ocean Freight). Amber if no MARAD Due Date; amber ≤5
    days before due; red past due with no MARAD Submitted.
28. Claude permissions: .claude/settings.local.json trimmed to broad rules (2026-10-21);
    git push still asks. Old list backed up as .claude/settings.local.backup-2026-10-21.json.

### Status (2026-10-21)
- v2.5.95 COP built (js/tools/cop.js) — committed locally, NOT pushed yet.
- v2.5.96 daily-update rule (PMR/Metrics/Tree/COP): required every business day from
  "left Draft" (oldest non-Draft Workflow Logs stamp; Date Submitted is unreliable) to
  delivery / yesterday; floor PMR_DAILY_LOG_START_ISO = 2026-02-24 (ATLAS daily history
  began 23–24 Feb 2026). QA impact: Q2 FY26 100%→92.6%, Q3 100%→98.7%. Not pushed yet.
- Fetch path (json_udq.js) does NOT rebuild Cost List or Request Estimate List — COP shows
  "No data" for those checks on fetched data. Need a JSON sample to add them.
- Open question for user: ~1/3 of requests past estimate review have an empty Request
  Estimate List (e.g. 10304) — QA copy, or genuinely missing?
- QA export is stale (~9 Sep 2026): daily/RDD/stuck flags on active shipments are inflated.
