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
- v2.5.95 COP built (js/tools/cop.js) — pushed 2026-10-21.
- v2.5.96 daily-update rule (PMR/Metrics/Tree/COP): required every business day from
  "left Draft" (oldest non-Draft Workflow Logs stamp; Date Submitted is unreliable) to
  delivery / yesterday; floor PMR_DAILY_LOG_START_ISO = 2026-02-24 (ATLAS daily history
  began 23–24 Feb 2026). QA impact: Q2 FY26 100%→92.6%, Q3 100%→98.7%. Pushed 2026-10-21.
- v2.5.97: COP is the hub — one big rail button; Pipeline / Metrics / PMR / Export-Controlled /
  Christmas Tree are tabs (TOOLS entries with hub:true; copHubTabs in cop.js). Management
  rail group removed; Required Attachments moved to Shipping. "Find metric hits" picker.
  Daily rule: first update due the NEXT business day after leaving Draft (QA: Q2 FY26 96.2%,
  Q3 100%). "Estimate attached" check OFF (COP_CHECK_ESTIMATE=false) — user: not everyone
  fills the Request Estimate List; estimates are uploaded as attachments.
- Request Estimate List is being added to ALL UDQs. Readers audited + hardened (ecm.js stop
  set, reqattParseUdq stop titles, pmr Workflow-Logs walk, udq.js scan caps). Tested with the
  section inserted under the record row / after attachments / inventory / workflow logs.
- v2.5.98: AES required = US export (ATLAS route), hand carry skipped; ETD = Shipping Activity
  "Departure from Origin Est. Date"; departed = "...Act. Date" or lane >= transit. MARAD due =
  Departure from Origin Act. Date + 20 working days (US origin) / 30 (foreign) per 46 CFR 381.3
  — user to double-check the rule (COP_MARAD_WORKDAYS_*). Tracker Closed tab now read too.
- Fields still needed in ATLAS to retire the Ops Tracker: RFQ Sent Date, Date Packed,
  ITN / NOEEI Citation, MARAD Submitted Date (+ optional Final Shipping / Warehouse Invoice
  Received dates). NOT needed: ETD (Departure from Origin Est. Date exists), AES class
  (derived from route), MARAD due (calculated), Reason for RDD change (in ATLAS / comments).
- v2.5.99: fetch path (json_udq.js) now rebuilds Cost List (+ nested line attachments),
  all 50 Shipping Activity columns and the Request Estimate List, mapped from the Metrics
  JSON sample (Downloads\cfb99354-...json, Oct 2026). Verified: cost lines sum to Total
  Cost on 210/210 fetched records.
- Pushed to main 2026-10-21 (2.5.95–2.5.99 live on atlas-utility.net).
- Fetch path (json_udq.js) does NOT rebuild Cost List or Request Estimate List — COP shows
  "No data" for those checks on fetched data. Need a JSON sample to add them.
- Open question for user: ~1/3 of requests past estimate review have an empty Request
  Estimate List (e.g. 10304) — QA copy, or genuinely missing?
- QA export is stale (~9 Sep 2026): daily/RDD/stuck flags on active shipments are inflated.

### v2.6.0 COP redesign (2026-10-21)
- User feedback: drafts out; Program + Compliance combined; simple day-to-day view; ATLAS
  styling (screenshots of dtra-logistics.com + ATLAS_PR_Activity_History_Mockup_v1.4.html:
  Poppins, navy #1e2a4a, white cards, blue table headers, light-blue Filter accordion).
- Board: 4 step columns (qr / review / estimate / exec), exec split by phase (pre, booked,
  transit, customs, delivery); bubble = last 5, colour = health, red badge = missed daily days.
  Hover: latest update, daily status, other open items (c.brief). Click → row + checklist.
- Active rules = copActiveEvaluate (lean). Closed = copEvaluate (full audit). "Delivered - POD
  Received" is closed. Past-QR gaps = "late" (not counted). TTI Est Prep stuck clock starts at
  pack date (4/6). Prefs stuckV=2 resets old day limits.
- RFQ due = 1 BD after later of Compliance approval and pack date.
- Next (user's plan): standalone HTML mockup of just this COP for the TTI dev team to build
  into the ATLAS WMTR dashboard (no fetch/UDQ — reads ATLAS data directly). Poppins isn't
  loaded by the utility (falls back to Segoe UI) — adding the Google Fonts link would be a
  new external dependency; not done.
- v2.6.1: time-in-step flags OFF by default (prefs.stuckOn); RFQ is the only default timeline.
  Toggle under Filter › Day limits for management.
- v2.6.2: RDD off by default — passed RDD amber in Execution only; per-request "Monitor RDD"
  (prefs.rddWatch, browser-only) makes it amber 5 BD out / red when passed. Candidate ATLAS
  field: "Firm RDD" checkbox. AES deadline per 15 CFR 30.4 (ocean ETD-1 day; air/truck ETD).
  Cost list = any line with a total. QR gaps after QR = "Incomplete". Daily updates required
  from 2026-03-01 (PMR_DAILY_LOG_START_ISO). Filters: POC/hits/search/attention always shown;
  RDD under More filters; My shipments removed. Detail = 3 columns, 10 updates.
- v2.6.3: Daily updates entered on the COP (detail form + "Enter daily updates" sheet + History
  modal). Saved to localStorage atlas.cop.dailydrafts (in Backup) as "pending"; pruned when the
  same WMTR/date appears in ATLAS data. ONE write hook: copSaveDailyUpdate(wmtr, dateIso, note)
  — in ATLAS this becomes the POST to Daily Status. Request link: copRequestUrl(r) returns null
  until the data carries the ATLAS request ID (devs fill in the URL pattern). Requestor view
  (CopUi.role) = plain-language step, progress bar, latest update, POC contact; no checks.
  NEXT: standalone HTML COP mockup for TTI devs (no fetch/UDQ), top of each service dashboard,
  shipping first.
- v2.6.4: Board sub-boxes for Review (program / compliance) and Estimate (TTI prep / DTRA estimate
  review / CT > $100K) via COP_STEP_SUBS + r.sub (copStepInfo). Requestor view unchanged.
- v2.6.5: Unmonitored RDD = no check at all. Active cost gate = Total Cost > 0 before DTRA
  Estimate Review (Total Cost is auto-calc'd; no cost-list or cost-sum checks anywhere).
  Closed audit (copEvaluate) trimmed to metric hits: RFQ (later of compliance approval / pack
  date + 1 BD), daily, required docs = reqatt metric set (CIV, PKL, SLI, AES, VAT, POD, MCT) +
  AWB/carrier, ITN, MARAD, delivery date / late vs RDD, variance, rejected, manual, RTI/invoiced.
  User: placards/photos are an internal SOP check, vendor invoice lives on the cost line.
- v2.6.6: Active tab: no Metric hits filter (Needs attention covers it); no DPS check (field unused);
  no draft-AWB gate (always uploaded pre-transit). Cost over DTRA-approved flags only when >10%
  over (COP only — Christmas Tree's own reapproval flag is unchanged).
- v2.6.7: Daily-update entry is MOCKUP-ONLY: COP_MOCKUP.editUpdates = false in the Utility (no
  form, no sheet, drafts ignored). The mockup sets it true; its sheet has one "Save daily updates"
  button (top + bottom) that saves every filled row via copSaveDailyUpdate. Table = COP column
  defs (copColDefs): header-click sort, per-column filter row, Columns picker (prefs.cols per
  view; Days in Step + reference fields optional). Board inner boxes with `optional` (CT >$100K,
  Delivery) hide when empty. Origin over Destination in one column.
- v2.6.8: Board = exactly the table's rows (top filters, search, attention, RDD, column filters).
  Mockup sheet: per-row Save (ATLAS times out on long sessions) + "Save all updates"; unsaved
  typed text kept in CopUi.sheetText across re-renders.
- v2.6.9: Step headers navy (--ax-navy); step 3 = "Estimate Preparation".
- PLAN (user, 2026-10-21): Phase 1 = COP in the Utility only (read-only, no update entry) — test
  thoroughly. Phase 2 = move to the ATLAS WMTR dashboard and add daily-update editing (the
  COP_MOCKUP.editUpdates code: per-row Save + Save all). The standalone dev mockup waits for Phase 2.
- v2.6.10: copDueTodayOnly(r) (dueToday && no missed days) → bubble .due (purple fill, health border
  kept), purple "Today's due" pill, purple hover line, legend entry.
- v2.6.11: COP rail click → copAutoFetch(): atlasLoadMetrics() (new, throws) then
  loadFromAtlasXmasTree({ quiet: true }) in the background (no redraw unless Christmas Tree tab
  is open). No re-pull within COP_AUTO_PULL_MIN (10) min. Keeps the current hub tab. Only works
  inside ATLAS; on atlas-utility.net it shows "couldn't pull" and keeps the dropped UDQ.
- v2.6.12: COP_MOCKUP.links (false in the Utility): copWmtrLink(r, text) makes the WMTR number the
  link to the request (copRequestUrl needs the ATLAS request ID); plain text in the Utility.
  "Open in ATLAS" / ↗ links removed.
- v2.6.13: Rail button = "Dashboard" / "Common Operational Picture (COP)". BIS/DDTC auth gap:
  amber through Estimate Preparation, "Incomplete" (no flag) in Execution.
  User decision: "Monitor RDD" stays a per-user (browser) setting — NOT an ATLAS field.
  ATLAS fields to retire the Ops Tracker: RFQ Sent Date, Date Packed, ITN / NOEEI Citation,
  MARAD Submitted Date (optional: Final Shipping / Warehouse Invoice Received dates).
- v2.6.14: Hover (TTI + requestor) names consol partners (r.consol, from Linked Request List
  "Consol" linkage).
- v2.6.15: Bubbles neutral when on track (--ax-neutral); colour = exceptions only. "Today" strip
  (copTodayStrip): active / due today / missed / attention (= CopUi.atRisk) / departing ≤7 days
  (COP_QUICK, CopUi.quick; Active view only). Bubbles sorted by r.statusSince (oldest first).
  Consol = teal chain icon (COP_CONSOL_ICON) on bubble + teal hover line + teal table pill.
- 2026-10-22 field mockup for TTI devs (Downloads\ATLAS_ShipActivity_NewFields_Mockup.png): new
  "Shipment Milestones" group under Daily Status Update / Carrier row in Shipping Activity &
  History: Date Packed, RFQ Sent Date, ITN / NOEEI Citation, MARAD Submitted Date, Warehouse
  Invoice Received (opt), Final Shipping Invoice Received (opt), Monitor this RDD checkbox.
  No ITN Filed Date. User decision (supersedes 2.6.13 note): Monitor RDD becomes an ATLAS
  REQUEST field for everyone, not per user. Until it exists, the Utility keeps it per browser.
- v2.6.16: requestor-view fix — stacked inner-box layout scoped to `.cb.subs` (Estimate bubbles
  were stretching full width where the requestor board has no inner boxes).
- 2026-10-22 DEV MOCKUP of the dashboard: Downloads\ATLAS_WMTR_Dashboard_Mockup.html (2.4 MB,
  self-contained, opens offline). Real COP code (util, udq, xmastree, pmr, reqatt, cop.js) +
  embedded data (all 43 active + 60 most recent closed from the 21 Oct QA Metrics JSON, tracker
  rows). Mockup switches: COP_MOCKUP.editUpdates/links = true; copToday fixed to 22 Oct 2026
  (so today's updates are due/purple); export/link clicks show a toast; Ops Tracker UI hidden.
  View buttons + deep links #view=tti|sheet|closed|req. Collapsible "Notes for developers".
  REBUILD: files in .claude/mockup/ (untracked). Serve repo (atlas-static), copy the Metrics
  JSON to .claude/tmp_test/m.json and the Ops Tracker to t.xlsx, headless Chrome
  --dump-dom http://localhost:8777/.claude/tmp_test/extract.html > extract_dom.html, then
  python build_dash.py <out.html> (update its SCR path to where extract_dom.html is).
  Now built from Downloads/UDQ_Metrics (SRF)_22 Oct.xlsx (copy to .claude/tmp_test/m.xlsx): 44 active,
  24 not yet updated on 22 Oct = purple. extract.html reads the xlsx like app.js workbookAllSheets.
