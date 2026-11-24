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
- v2.6.17: Requestor view is ATLAS-only (user, 2026-10-22): COP_MOCKUP.requestorView = false in the
  Utility (no "View as" switch, role forced to TTI); the dashboard mockup sets it true.
- v2.6.18: Closed Audit column = copAuditItems(r) (plain-words hits; fvList filter by hit kind).
  Doc Check (CopUi.docCheck; copDocCheck/copDocRow/copFyPeriod/copExportDocCheck): closed requests
  x 8 doc columns (X / Missing / N/A), counts per type once per request, period by Delivery Date
  (Date Completed fallback), FY from 1 Oct. Required set = reqatt _raEvaluate (metric rules).
  Note: Doc Check shows all closed requests incl. pre-Oct-2025 (not scored by the audit), so
  "All closed" shows more "missing" than the audit's hits.
  Mockup now carries ALL closed requests (237 records, 4.7 MB) and a "Closed · Doc Check" view.
- 2026-10-23 dev mockup "Notes for developers" now spells out the write-back ask: dashboard is
  read-only except adding a Daily Status History entry (Date + Notes/Comments), keyed by the
  request's internal ID (not in the UDQ yet; also drives the WMTR link). Suggested endpoint
  POST /api/wmtr/<request id>/daily-status {date, notes}; Save all = one call per row; optional
  CORS for atlas-utility.net so the Utility could write those two fields. Mockup Save shows a toast
  with that call. Patched in build_dash.py too.
- v2.6.19: COP daily-update WRITE-BACK built into the Utility (user, 2026-10-23 — supersedes the
  2.6.7 "mockup-only" rule for ATLAS). Settings: ATLAS_UDQ_CONFIG.dailyStatus { url ({requestId}
  placeholder), requestIdField, requestUrl } in json_udq.js, overridable per browser/env in
  Settings > ATLAS data source > Adjust API settings (AtlasSettings.dailyStatus). ON only when both
  url + requestIdField are set AND a UDQ fetch has worked this session (AtlasLive.ok = inside
  ATLAS); atlas-utility.net stays read-only. requestIdField adds a "Request ID" column to fetched
  grids (atlasScalarColumns) -> copRequestId -> WMTR link + POST atlasPostDailyStatus(id, date,
  notes) body {date:"YYYY-MM-DD", notes}, session cookie, no API key. On success the entry is pushed
  into rec.daily (counts at once); on failure the text stays and the reason shows. Save all = one
  call per row, reports failed rows. copCanEdit() = mockup || atlasDailyStatusOn(). Tested only
  against a stubbed fetch — first real save must be tried inside ATLAS. Devs hand back: save
  address + Request ID field name (mockup dev notes say so).
- v2.6.20 (user, 2026-10-23): EDIT past daily updates + PREVIEW switch.
  Edit: copShowHistory(r, editIdx, msg) lists every entry (Date, Notes, Entered, Source) with Edit
  (copCanEditEntry / copEditDailyUpdate); History link added to each sheet row. Inside ATLAS: PUT
  ATLAS_UDQ_CONFIG.dailyStatus.editUrl ({requestId}, {entryId}) via atlasPutDailyStatus; POST reply's
  id is kept so a new entry is editable at once. Entry IDs ALREADY exist in the Metrics JSON
  (dailyPOCList[].id + createdDate) -> fetched grids now carry them in Daily Status History cols E/F
  ("Entry ID", "Entered"); every other reader stops at col D. Excel exports have no entry IDs.
  No delete of ATLAS entries (pending browser drafts can still be deleted).
  Preview: Settings > ATLAS data source > "Show COP daily-update entry & editing (preview)"
  (AtlasSettings.copDailyPreview) = mockup behaviour in the Utility (copLocalUpdates: new updates
  = browser drafts "pending", ATLAS-entry edits in memory until reload). Real ATLAS writes win when
  set up. User plan: a later release makes the feature permanent and REMOVES this switch.
  Devs now hand back 3 values: add address, edit address, Request ID field. Mockup rebuilt (dev notes
  + PUT toast). Change-tracker/email text drafted in chat was revised for add + edit.
- v2.6.21 (2026-10-27) faster COP pull. Click Dashboard -> copAutoFetch: when nothing is loaded, shows the
  SAVED COPY of the last Metrics pull at once (IndexedDB "atlas-udq-cache", key metrics|env|id; records +
  ATLAS stamp), then pulls in the background (atlasPullMetricsRecords) and swaps in via copSwapInMetrics
  (keeps hub tab incl. Metrics, dashCollapsed, MetricsUi window; never replaces a shipment opened mid-pull).
  Fetched grids skip the xlsx write/read: atlasGridAsRead() = exact SheetJS round-trip shape (fuzz-tested
  equal) -> loadFile(file, preGrid). Side effect: notes > 32,767 chars no longer break a fetch.
  Christmas Tree: SRF slot reuses the Metrics records (user: same search), PR/PMCT/WS pull in parallel.
  "Changed since" refresh READY but OFF: ATLAS_UDQ_CONFIG.changes {param, stampHeader|stampField,
  fullEveryHours 12}. ATLAS returns a token from its OWN clock with every UDQ response; Utility saves it and
  sends it back untouched (no client clock, no user entry); merges changed records by WMTR; full pull at
  least every 12 h (catches deletions). With it on, every Dashboard click pulls (no 10-min wait).
  Dev ask drafted in chat (user picked "modified since"; must refresh many times a day -> full date+time
  token from ATLAS's clock, inclusive, small overlap OK, nested changes count).
  Saved copy caveat: shared browser profile = next user briefly sees previous user's last pull.

## Offline mode + Air Waybill (v2.7.0, 2026-10-27)
- Purpose: let a non-ATLAS user (Chris's buddy) make CIV / PL / Placards / AWB by hand. Toggle = "Offline mode"
  box in the About window header (version chip); per browser (localStorage atlas.offline). Reloads on switch.
- js/offline.js: rail = Shipment details, CI, PL, Placards, AWB; hides Fetch/Compare/History/Consol/COP/dashboard.
  Shipment model -> manual entry (AppState.manualOnly + manualDetails) + manual parents (packages). Party map:
  Shipper=origin, Notify=intermediate; End user/Pickup/Deliver "same as". Shipments saved in
  atlas.offline.shipments keyed by Shipment #. Company name + logo (PNG, resized <=600px) in atlas.offline.company.
  offlineBrand() is what CI / PL / Placards read (no TTI/DTRA logos, Prepared-by, DTRA USPPI box, default contract #;
  no-charge declaration + US export-control statement are Yes/No). Pre-flight hard block skipped in offline mode.
- Excel template (offBuildTemplate / offParseTemplate): tabs Shipment (A label, B value, C help, D hidden key),
  Items, Packages, How to use, Lists (drop-downs). Marker "OFFLINE SHIPMENT TEMPLATE" in Shipment!A1.
  Dropping one with offline mode off offers to switch it on.
- js/tools/awb.js: fillable PDF (pdf-lib form fields, Courier), IATA-style layout, Letter portrait. Blank box =
  auto value from the shipment (chargeable = max(gross, cm3/6000) rounded up to 0.5 kg). OFFLINE MODE ONLY
  (user, 2026-10-27 — not on the normal Shipping menu). Copy label incl. "All 3 originals"; optional flatten.
- User direction (2026-10-27): offline mode = an "app within the app" for a friend who will NEVER have ATLAS.
  Keep it super simple. Hidden in offline: Settings gear, drop zone, status line, Fetch/Compare/History/Consol,
  COP/dashboard, FormCache ("FROM MEMORY" flags off). About window shows plain help (offlineAboutHelpHtml) +
  the toggle instead of the changelog. Shipment details = 3-step strip, Shipment / Excel cards, numbered
  sections 1-5; extra item columns (serial, license, UN #, hazard class) behind "Show extra columns".
  Offline mode persists across close/reopen (localStorage flag read on load).
- OPEN: buddy access — atlas-utility.net is behind Cloudflare Access and ships the full TTI build; giving him
  access means adding his email (he could untick offline mode). A separate stripped build/hostname would avoid that.
- v2.7.2 (2026-11-04) Deltek PO Lines export (js/tools/deltek.js + deltek_template.js = base64 of the
  package's templates/deltek_po_lines.xlsx, CostPoint's line-grid export, 121 inline-string headers A1:DQ1).
  Rail tool "deltek" (Property management, needs property + needsGrid, hideOn every other udqType).
  Writes F Item (DELTEK_DEFAULT_ITEM), L U/M (Ordered -> Requested, through DELTEK_UM_MAP, unmapped
  upper-cased + flagged), S Quantity (Ordered -> Requested, numeric), U Gross Unit Cost (Value(USD), numeric),
  CG Notes (Description, trimmed). Columns found by template header name. Skips blank Description.
  API field names (json_udq ATLAS_PROP_INVENTORY_COLUMNS): description, qtyOrdered, qtyRequested,
  unitOfMeasureOrderedText, unitOfMeasureText ("Unit Of Measure Requested"), valueUsd.
  Tested vs package oracle expected_lines_10027.csv (57 lines, 150,100.38) from the xlsx and from a JSON
  fixture through the Property fetch path; identical sheet XML. DELTEK_UM_MAP is still only {EA}:
  DELTEK_UM_MAP filled 2026-11-04 from CostPoint U/M lookup screenshots: EA, Each->EA, Box->BOX, Case->CS,
  Dozen->DZ, Package->PKG. ATLAS values with NO CostPoint code yet: Set, KT, Ounce, Bottle, Pint, Bag, Gallon,
  Pound, Meter, Liter, Foot, Pallet, Roll, Quart, Other, Milliliter -> Chris: send as EA (DELTEK_UM_AS_EA, noted in panel).
  CostPoint U/M = 3 chars max (preprocessor PO_LN.PO_LN_UM_CD): longer values get a "too long" notice.
- v2.7.3 (2026-11-04, user): rail lists only USABLE tools — renderRail skips any tool that isn't enabled
  (was: greyed-out/disabled buttons) and section headings appear lazily; Packet header button only with an
  SRF. Deltek's own hideOn list removed (redundant now). Nothing loaded = Shipping: Purchase Order, MCT;
  Property: Purchase Order; General: Inventory Crosswalk.
- v2.7.4 (2026-11-05, user) Deltek export rebuilt on purchasing's UPDATED CostPoint layout (their file
  UPDATED_Deltek_PO_10348_…xlsx). Template (deltek_template.js) = row 1 PO header-table headers (118, A–DN;
  their row 19), row 4 Lines headers (116, A–DL; their row 1); styles from their file (xf 2 = date).
  Output: row 2 PO header values, row 3 blank, rows 5+ lines. User said header "column 1 and 2" — read as
  ROWS 1–2 (CostPoint paste is row-wise); confirm with user if a vertical layout was meant.
  Header: Type=Purchase Order, Buyer=picker code (DELTEK_BUYERS; Toby Hurdle/TRLS II 03 — more to come),
  Order Date=date picker, PO Status=picker (Pending|Open, more to come), Project=UDQ Charge Code (JSON
  ChargeCode), Account 5201-035, Organization CONUS 1.40.01.02.0009 / OCONUS 1.40.03.02.0009 (radio, required),
  Ship ID SGL, Taxable Status "All Items Non-Taxable". Their sample also had " " in BU/BV (Vendor Address
  Line 2/3) — NOT written; ask if needed.
  Lines: PO Line 1..n (PR inventory has no line-number column), Status (picker for all + per-line select),
  Item, Description "on XX/XX/XX", U/M, Due/Desired/Order/Original Due Date = date picker, Quantity, Gross
  Unit Cost, Ship ID SGL, Ord Ref Type N, Notes. Picker state = DeltekUi, per request, not saved.
- v2.7.5 (2026-11-05, user): Deltek buyer list = Toby Hurdle (TRLS II 03), Georges Elkhoury, Hap Smith, Jonathan
  Cowart, Wendy Doiron, Adnan Tahir — IDs pending from Chris (code "" -> header Buyer blank + panel note).
  Default = request's "TTI POC Name" (JSON TTIPOCName), name match ignoring case/spacing; else first + note.
  User confirmed layout (header rows 1–2, lines header row 4, lines from row 5) and NO spaces in BU/BV.
- v2.7.6 (2026-11-05, user): Deltek PO header Print Buyer Signature (DF) = "False" (text; DELTEK_PRINT_BUYER_SIGNATURE).
  Georges Elkhoury = TRLS II 04 (2026-11-05). Still no IDs: Hap Smith, Jonathan Cowart, Wendy Doiron, Adnan Tahir.
- v2.7.7 (2026-11-05, user): SLI .xlsx gets tab 2 "Inventory List" = request inventory on the ATLAS SRF
  Inventory List template (invgenAddSrfSheet in invgen.js, called at the end of sliWriteWorkbook, so the
  packet SLI has it too). Same rows as Inventory List Export + SRF, package rows excluded; no tab without a
  UDQ grid (manual entry / offline). Template sheet copied in: shared strings -> inline, styles appended
  (_invgenMergeStyles: fonts/fills/borders/custom numFmts/cellXfs, s= offset). NB use function replacers —
  number formats contain "$". Crosswalk carryover tab is NOT copied. Shipping "Inventory List Export" rail
  entry removed (user); Property one kept. Tested with a synthetic SRF (no real SRF export in the session).

## Procurement + Property dashboards, DPM weekly slide (v2.8.0, 2026-11-06) — pushed 2026-11-06 (merged after 2.7.2–2.7.7)
- For Jon (new DPM on tRLS II, replacing Hap). Source files: Desktop\PR Dashboard\ (PM Weekly Update.pptx = his
  quad slide; UDQ_WMTR_PR / UDQ_WMTR_PMCT samples; PR Tracker.xlsx = ops tracker, sheets Active / Closed).
- js/tools/pmdash.js: hub tabs "proc" (Procurement) + "prop" (Property (TOP)) after Shipments. Data = XTree.slots.PR /
  .PMCT grids (same UDQs as the Christmas Tree). Opening a tab -> pmAutoPull -> loadFromAtlasXmasTree({services:["PR","PMCT"]})
  (slots now carry `at`; no re-pull within 10 min; dropped files (no `at`) are never auto-replaced; Refresh forces).
- Active vs Closed = COP rule (Completed / RTI / Invoiced / Cancelled*). Drafts hidden unless ticked.
- PR rules: estimate due = WORKDAY(max(compliance approved, status since), 3, holidays) while TTI Estimate Preparation;
  PO due = WORKDAY(estimate approved, 1) while Sourcing with no Purchase Order attachment (Christmas Tree rules).
  PO date = first Purchase Order attachment; POD = first Proof of Delivery attachment. Flags: red flag, est/PO overdue,
  past RDD / RDD <=14d, PO attached but still Sourcing, no Activity Tracker update >14d, TOP required + POD but no PMCT.
- PMCT rules: value = Value of Cargo (USD) else inventory qty x value; delivered = OLDEST "Delivered - POD Received"
  stamp; backlog buckets <=15 / 16-30 / >30 days since delivery + >= $200K. PMCT -> source PR/SRF = 5-digit numbers in
  Request Title + Requestor Ref.# ("TOP-TTI-10092", "PR 10092", "...-10064-SRF"). "TOP required, no PMCT" list only
  looks at PRs delivered/closed since PM_TOP_LINK_FROM (2026-01-01).
- Weekly slide: pptxgenjs 3.12.0 (pptxgen.min.js, uses the app's JSZip) loaded on click from js/vendor then
  cdn.jsdelivr.net (NOT on cdnjs; jsdelivr added to sw.js RUNTIME_HOSTS + offline downloader). User approved the new
  dependency 2026-11-06. Quads: Procurement + Property auto + notes; PLS + Significant Program Actions = Jon's notes
  (user: Jon can type notes into EVERY quadrant). Notes in localStorage atlas.pmdash.slide (in Backup). Export sizes
  text to fit (font step-down, then "+N more"). Verified by rendering the real .pptx through PowerPoint COM.
- Ops tracker vs UDQ (answered in chat): ATLAS has Operator, Description, Compliance/Estimate dates, PO (attachment),
  TOP Required, status notes (Activity Tracker). Missing from ATLAS: PO Execution Date field, POD Received Date field,
  PMCT ID link on the PR, TOP Sent to End User Date, TOP Receipt Date, DTRA Acceptance Date.

## Dashboard feature review decisions (v2.8.1, 2026-11-07)
- Full feature-by-feature review (every element, UDQ field, formula + a review tracker) is a Claude Doc:
  https://claude.ai/artifact/6zevdCKvG6QnKBDZiaDw8C — keep it in sync when dashboard rules change.
- User decisions: Ready To Invoice = closed. TTI Quality Review = review step (report current status as-is).
  CT Program > 100K stays in the estimate step, renamed "Estimate / Approval". RDD = NLT Completion Date.
  Slide notes per-browser is fine (Backup export/import to move). Value of Cargo is always filled when inventory is
  priced (ATLAS computes qty x unit value) — inventory fallback kept only as a safety net.
- PO issued = earlier of Activity Tracker stage "PR – PO Issued" and the first Purchase Order attachment (tracker
  is usually earlier; 2 sample PRs logged it after the upload). POD = PR "Delivery Date" field, else Activity Tracker
  "Delivered - POD Received", else POD attachment. User: for other missing dates, use Activity Tracker entries.
  PMCT Activity Tracker stages Transfer Scheduled / Acknowledged by Receiving Party / Transfer Completed show in TOP
  details + export.
- "TOP required — no PMCT": no start date (PM_TOP_LINK_FROM removed). Every PR with TOP Required = Yes needs a PMCT
  (user rule; CTRIC-procured equipment has its TOP done by the CTRIC, so no PMCT). Records get cleaned up if listed.
- TOP backlog panel + slide: $200K card removed (it counted undelivered TOPs). Delivered TOP with no date anywhere ->
  bucket "unk" ("Delivered – date unknown", amber flag, card shown only when > 0).
- Slide: "Use the dashboard filters" checkbox (PmUi.slideFiltered, session only) builds from each tab's filters;
  footer lists them. "Past RDD" tile filter now red-only (matches its count).

## v2.8.2 decisions (2026-11-07) — NOT yet committed/pushed at time of writing
- Supersedes parts of 2.8.1: PO issued = Activity Tracker "PR – PO Issued" ONLY (mandated entry; past-Sourcing PR
  without one = record fix). PO due skips holidays. Country = CTR Country. Slide footer removed. Info bubbles (ⓘ) on
  every tile/step/chart/table, off via Settings › General (dashInfo). Refresh = icon.
- PR↔PMCT link = a row in the Linked Request List (either side). NO other field checked (Linkage Type check dropped).
  Every PR with TOP Required = Yes, any status except Draft/Cancelled, needs a linked PMCT, else record fix.
- PMCT process (user, 2026-11-07): PMCTs skip DTRA review (auto DTRA Approved) — just a TOP-document repository.
  Two dates, from Activity entries only (status dates unreliable): "PMCT – TOP submitted for signature" (package to
  gov; status set to Delivered) and "PMCT – Signed TOP returned to TTI" (signed TOP back; status set to Completed).
  Open steps: "TOP being prepared" -> "Out for signature" (entry present or status Delivered). Backlog ages = days out
  for signature. Flags: Delivered/closed with no submitted entry; Completed with no Signed TOP returned entry; signed
  back but PMCT still open. PMCT Delivery Date field no longer used. Sample data has no "submitted" entries yet.
- Dashboard tabs: Christmas Tree hidden (TOOLS hubHidden; code kept). PMR + Export-Controlled = sub-tabs under
  Metrics (TOOLS hubUnder: "metrics"; copHubTabs draws the sub-row). Future idea: a Christmas Tree view/export under
  Metrics for Wendy.
- New PLS tab (TOOLS "pls"; pmRenderPls in pmdash.js). PLS UDQ: record ids "PLS-…", title = Team/Event Name,
  Destination Country/City, Start/End Date, Total Cost in USD, col-B lists (Participants, Itinerary, one list per
  vendor service, TTI-procured Ticket, Workflow Logs, Linked Request List); no Activity Tracker / attachments.
  Steps: DTRA Program Review -> TTI Estimate Preparation -> DTRA Estimate Review / Fulfillment Review -> In
  Progress -> Completed / Ready To Invoice / Invoiced. Slide PLS quadrant fills from it when loaded (else notes only).
- PLS estimates NOT tracked for now (user, 2026-11-07): no estimate due dates, on-time rate or "trip soon, estimate
  not approved". PLS flags: Trip ended still In Progress, missing dates / cost / TTI POC, red flag.
- PLS ATLAS pull: Settings › ATLAS UDQ IDs has a PLS field (atlasIds().pls, empty built-in). pmPullPls() lays the
  JSON out like the export (pmPlsJsonToGrid: PM_PLS_JSON_COLS field->column map, PM_PLS_JSON_SVCS list->section
  title; workflow status = statusDisplay, e.g. "DTRA Program Review (Approved)"). v2.8.3: checked against a 374-record
  JSON sample (2026-11-07) — every record matches the export (status, dates, cost, travelers, links, workflow).
  JSON keys: CurrentStatus, TeamOrEventName, TotalCost, TTIPOCName, ContractCLINId, LinkedRequests
  (mappedRequestCategory/Number, statusName), WorkflowLogs (statusDisplay, createdDate, totalCostHist).
  Built-in QA PLS ID = 6ef19319-e7ad-4726-9c41-7d19f1961844 (taken from the sample's file name = the /api/UDQ/{id}
  it was saved from). Prod PLS ID still empty.
- Dashboard rail button now starts every dashboard pull at once: copAutoFetch (Metrics/SRF) + pmAutoPull (PR, PMCT,
  PLS). Christmas Tree UDQ IDs stay in Settings but aren't pulled (WS no longer pulled).
- T-R4 dropped: TOP package = cover letter (Word/PDF) + inventory (Excel), PDF once signed. DD1149 = consumables,
  not a TOP. No form guess on PMCTs.
- View settings ("less is more"): View button on Procurement / Property / PLS. localStorage atlas.pmdash.view =
  { kind: { "t:id" | "p:id" | "c:colKey": bool } } — overrides only; PM_VIEW_OFF holds the recommended hidden set.
  v2.8.4/2.8.5 (user, 2026-11-07) changed the recommended view: Proc = everything except the Past RDD tile; Prop = everything except the Red flags tile; PLS = everything except Trip ended
  (tile + list). The 2.8.2 recommended set below is superseded: Proc tiles Open / Estimates due / POs expected / Need
  attention, buyer chart + Next 7 days; Prop tiles Open / Out for signature / Out > 30 / Need attention, owner chart +
  backlog; PLS tiles Open / Trips 30 days / Traveling now / Estimate with DTRA / Need attention, timeline only (full
  width). Lanes off everywhere. Hidden columns: Proc In status / RDD / Latest update; Prop Country / Latest update;
  PLS In status. PR / title columns are locked on. Backed up via backup.js.
- Weekly slide v2.8.6 (user, 2026-11-07): UL Procurement = buyer column chart across the top, estimates | POs below,
  notes last. UR Property = owner chart + backlog cards on top, notes lower half. BL PLS = cards across, trips ≤14 days,
  notes. BR Program notes. NEVER "+N more" on the slide; min text 10 pt. pmSlidePlan() builds one layout (inches/pt)
  that pmSlideHtml (preview) and pmBuildPptx both draw. Lists fall back: full -> grouped (buyer / country) -> one
  inline line -> count; text is measured in Calibri via canvas (pmsWidth). Full lists go in the slide notes
  (s.addNotes). Charts: top 7 + one "N others" bar. Left column wider (6.95"), top row taller (3.5").
- Activity Tracker stages left in ATLAS (user, 2026-11-07): PR – RFQ/RFP Issued, TTI POC Status Check, PMCT – TOP
  submitted for signature, PMCT – Signed TOP returned to TTI, PR – Completed, PR – PO Issued. Older stages still on
  open records in the sample: PR – In Production / Fulfillment (81 entries), PR – On Hold, PR – Received, PR – Vendor
  Selected, PR – Shipped by Vendor, SR - Delivered - POD Received (PMCT 10179).
- PR delivery = the PR's Delivery Date field ONLY (user, 2026-11-07). No POD logic: a PR can have many PODs (one per
  PO). Column / detail / export say "Delivered"; Past RDD stops once Delivery Date is filled.

## v2.8.8 Dashboard drop box (2026-11-07)
- One drop box under the Dashboard tab bar (cop.js copHubDropBox / copHubIngest), part of copHubTabs()'s
  `.cop-hub-top` wrapper so copHubRefreshTabs() can redraw tabs + box after a drop or a background pull.
  Routing: PLS grid -> PmPls; xtClassifyService PR / PMCT / WS -> XTree slots (via pmIngest); everything else
  (Metrics reads as SRF, shipment UDQs, Ops Tracker) -> loadFile, Metrics last so it stays loaded. Then it opens
  the tab that got data (stays put if the current tab's UDQ was in the drop).
- Setting dashDrop (default ON; Settings › General). ON: Procurement / Property / PLS tabs are disabled until
  their UDQ loads (copHubHas), main #dropzone hidden on all Dashboard views. OFF (inside ATLAS, auto-pull):
  every tab always clickable, the old per-tab empty-card drop zones are still the fallback.
- PLS got the same green refresh button + "pulled HH:MM" as Proc / Prop (pmRefreshBtn); "Load newer PLS UDQ" removed.
- PLS "Trips in next" picker 30 / 60 / 90 (PmUi.pls.tripDays, default 30, not saved): drives the trips tile +
  its filter (quick key "trips"), the timeline span, and the slide's trips card. The slide's "starting within
  14 days" list is unchanged.
- v2.8.9 (user, 2026-11-07): weekly slide UL Procurement = buyer chart across the top; below it split in half —
  estimates over POs on the left, Jon's notes on the right. No notes typed -> estimates | POs side by side full width.
  The half-width left side is tight (~1.3"), so POs often fall back to the "By buyer" one-liner; full lists stay in the slide notes.

## v2.8.11 Service worker fix (2026-11-10)
- sw.js APP_SHELL had apple-touch-icon.png and favicon-32.png listed twice since at
  least the July repo flatten. Cache.addAll() rejects duplicate requests, so EVERY
  new service worker failed to install (went "redundant") -> no offline shell and no
  "new version" toast. Keep APP_SHELL free of duplicates.
- Navigations now fetch with cache:"no-cache" (always revalidate index.html) and the
  install precache uses cache:"reload", so a server that lets index.html sit in the
  browser's HTTP cache (suspected on the ATLAS-hosted copy) can't pin users to an old
  release. Proper server-side fix to ask TTI for: `Cache-Control: no-cache` on
  index.html and sw.js.

## v2.9.0 Shipping Operations — Ops Tracker retired, new look (2026-11-22) — pushed 2026-11-22
- User (2026-11-22): the tracker fields are in ATLAS now (SRF UDQ, Shipping Activity & History, right after Tracking
  Link): Date Packed, RFQ Sent Date, ITN / NOEEI Citation, MARAD Submitted Date, Warehouse Invoice Received, Final
  Shipping Invoice Received, Monitor this RDD, Shipping Team Notes; plus top-level "Original RDD" (after NLT Completion
  Date; revised RDD = NLT Completion Date). Fields are still being back-filled for everything delivered since 1 Oct 2026.
- Ops Tracker upload REMOVED (cop.js: copParseTrackerWorkbook / copMaybeTrackerFile / atlas.cop.tracker all gone; the
  old localStorage copy is deleted on load). Checks read ATLAS: copMsFor(rec, ds) -> { trk, why, na }. trk = null when
  the export has no milestone columns (ds.hasMilestones false -> "No data") or the shipment was delivered before
  COP_FIELDS_FROM_ISO = 2026-10-01 (-> N/A, "tracked on the archived Ops Tracker"). Until the back-fill is done, the
  Closed audit shows RFQ / ITN misses on shipments delivered since 1 Oct whose fields are still blank.
- "Monitor this RDD" = True in ATLAS switches RDD monitoring on (per-browser prefs.rddWatch still works too).
- New TRACKER view (CopUi.view "tracker"; copTrackerRows / copTrkCols / copRenderTracker / copExportTracker): rows =
  active + closed delivered on/after 1 Oct (cancelled left out). copTimeline(rec): submitted = Date Submitted (always <=
  first non-Draft stamp in the sample), toDtra = first "DTRA Program Review", compliance = "DTRA Compliance Review
  (Approved)", quoteSub = first "DTRA Estimate Review", quoteAppr = "... (Approved)", departed = Departure from Origin
  Act. Date. RFQ status: due = 1 business day after later(compliance, packed); active past Estimate Preparation with no
  RFQ date = "Not recorded" (not overdue). EEI: US export, not hand carry — filed / hold (in Execution) / later / missed.
  Tiles = COP_TRK_PICK filters; step strip = COP_TL_STEPS average business days + longest shipment.
- In progress view: KPI tiles (copTodayStrip) incl. new quick filters rfq / eei (COP_QUICK).
- NEW LOOK = the "2.9.0 look" block at the END of COPX_CSS in cop.js (overrides the older rules above it; Inter /
  Segoe UI, white cards, hairline borders, light table headers, colour only for exceptions). User plans to roll this
  styling out to the other Dashboard tabs and then the whole Utility — when that happens, move the tokens into
  css/app.css and delete the overridden rules. Hub tab bar (.cop-hub in app.css) and the Metrics / Procurement /
  Property / PLS tabs are NOT restyled yet.
- Dashboard pull: no saved copy shown any more (user: it wasn't apparent the data was stale). copAutoFetch(force):
  blank "Getting the latest from ATLAS…" card until the pull finishes; header chip (copFreshChip) says "Live from
  ATLAS · pulled <time>" or "From a file · <name>"; Refresh button = copAutoFetch(true). IndexedDB "atlas-udq-cache"
  is only written while "changed since" pulls are on (atlasChangesOn), otherwise deleted.
- FETCH PATH — CONFIRMED 2026-11-22 against Downloads\cfb99354-…(1).json (250 records): the new fields are on
  ShippingActivityHistory[0] as datePacked(_UDQ), rfqSentDate(_UDQ), itN_NoEEI_Citation, maradSubmittedDate(_UDQ),
  warehouseInvoiceReceivedDate(_UDQ), finalShippingInvoiceReceivedDate(_UDQ), monitorThisRDD(_UDQ), shippingTeamNotes —
  pinned in ATLAS_SHIPACT_COLUMNS (json_udq.js; the guess-by-name matcher is gone). Original RDD = top-level
  ManualStatusChangeDate (confirmed). Fetched grid vs. the 08:21 Excel export: all 8 fields + Original RDD + RDD
  identical on 243/243 requests; Tracker numbers identical. monitorThisRDD is null everywhere so far — the value a
  ticked box sends (true / "Yes") is unseen; copIsYes accepts true / yes / y / 1.
- New UDQ types: "ir" (IR Number / IR-…) and "dtr" (DTR Number / DTR-…) — detectUdqType + readRequestUdq (udq.js),
  renderRequestDashboard (app.js): summary only, no tools yet. appMaybeDashboardUdq (app.js): a PLS export or a
  multi-request PR / PMCT / WS export dropped on the MAIN drop zone is handed to the Dashboard (copHubIngest). WS goes
  to the Christmas Tree slot (tab hidden). A single-request PMCT / WS UDQ still loads as "SRF" (pre-existing).
- Removed everywhere: "Diagnose layout" (udqDiagnose) and "Recent UDQs" (js/recents.js deleted).
- Local testing tip: the page re-registers the service worker, which then serves STALE js — unregister it and clear
  caches before every reload (navigator.serviceWorker.getRegistrations + caches.keys), or edits don't show.
- COST RULE (user, 2026-11-22): a cost difference is an issue ONLY when actual (current Total Cost) is MORE than 10%
  over the governing DTRA-approved amount; under-runs never count. One helper: xtCostOver / xtCostOverPct
  (xmastree.js, XT_COST_OVER_TOL = 0.10, % of the APPROVED amount). Used by xtRowIssues (delivered AND undelivered —
  the undelivered "any amount over = reapproval" flag is gone, superseding the 2.6.6 "COP only" note), the cost_srf /
  cost_pr rollup metrics, the COP and the Metrics tab's Cost accuracy section (now shows the governing amount +
  "Over by"). The Christmas Tree's "Estimate vs. Actual %" COLUMNS still use the workbook formula (1 - est/actual).
  22 Nov SRF export: 10 delivered shipments were flagged (8 under, 2 over) -> 2 now; Cost accuracy all-time 130/132.

## v2.9.1 quieter Shipments dashboard (2026-11-22) — pushed 2026-11-22
- User feedback on 2.9.0: too busy. Direction for the whole restyle: LESS in the default view — small helper text goes
  to hover (title attributes), fewer data points by default, more made configurable; "let me know before you remove
  any data elements" (ask before turning columns / tiles off by default). A few more subtle colours are welcome.
- Done: one-line header (copFreshChip = dot + "From file" / pull time, details on hover; a failed pull shows only
  when the data on screen is an earlier ATLAS pull); small text tabs; icon-only Refresh / Print / Export; compact
  tiles (number + name, hint on hover); search box removed (In progress / Closed / Tracker) — Tracker got a column
  filter row (CopUi.trkF); "Needs attention only" tick box only on Closed (the tile does it on In progress); card
  sub-titles, board step sub-labels, legend tip, drop-box instructions and "Loaded …" lines hidden (body.cop-quiet hides
  #loadStatus unless .err; CopDrop.status = errors only). Browse button only when the drop box is off.
- Tracker: default scope "active"; "Latest update" column = newest daily update (that IS what the Ops Tracker's notes
  column held); "Team notes" = Shipping Team Notes, separate column. Columns button -> prefs.trk { off: [col ids],
  flow } (only what's OFF is stored).
- OPEN, waiting on the user: (1) which columns / tiles to switch off by default (proposal given in chat);
  (2) RELIEF CODES in Shipping Team Notes — that field will carry codes that relieve a shipment from a metric; the
  Utility must read them and override the flag. Code format not decided (proposal given in chat: [RELIEF: RFQ] etc.,
  mapped onto the existing acknowledge keys so it's shared by everyone instead of per browser). Nothing built yet.
- v2.9.2 (user, 2026-11-22): Dashboard drop box is AUTOMATIC — copHubDropOn() is false once AtlasLive.ok (a pull has
  worked = connected to ATLAS; copAtlasConnected), copHubDropShown() also hides it while CopPull / PmPull is busy.
  Setting dashDrop = hard off. Main #dropzone is hidden on Dashboard views when the box is on OR connected. NB the
  user says "offline version" for atlas-utility.net (not connected to ATLAS) — NOT the 2.7.0 "Offline mode" app.
  Refresh = green icon (.copx-ibtn.go) right after the title + data-source dot. Tracker seg label "Delivered".
  Pushed 2026-11-22.
- v2.9.3 RELIEF CODES (user approved the bracket format 2026-11-22): [RELIEF: CODE] reason in ATLAS "Shipping Team
  Notes". cop.js: COP_RELIEF_CODES (RFQ->cop.rfq, EEI->cop.itn, DAILY->activity, RDD->delivery+cop.rdd,
  COST->variance_est/rev, DOCS->docs, MARAD->cop.marad, ALL->*), aliases AES/ITN->EEI etc., copParseRelief /
  copReliefFor(rec) / copReliefHit(relief, ackKeys). Both evaluators' add(): a relief hit turns any state except ok/na
  into "relief" ("Relieved (CODE) — reason. …"); DAILY relief also clears daily.missed/dueToday. Tracker pills show
  "Relieved" (reason on hover); Team notes shows tags as pills. Legend = copReliefLegend() hover chip in the page
  header (+ Team notes column title). Unknown codes are ignored silently (relief.unknown is kept but not shown).
  NOT done / OPEN QUESTION for the user: Metrics tab percentages, Christmas Tree rollup, Record Audit and the PMR
  export do NOT read relief codes yet — need to know whether a relieved shipment counts as a PASS or is LEFT OUT of
  the count (the Tree's browser "ignore" list counts as a pass). Tested by injecting tags into loaded records (
  real tags in the data yet). Pushed 2026-11-22 with 2.9.4.
- Default-view trimming: user asked for a LIST of suggested fields to hide (given in chat 2026-11-22) — nothing has
  been switched off by default; wait for his picks.
- v2.9.4 (user, 2026-11-22): RELIEVED = STILL COUNTED, SCORED AS A PASS for that metric (never dropped from totals).
  Engines read the codes from the grid: copReliefByRequest(grid) (cop.js, WeakMap cache) -> xtRelievedBy(grid, wmtr,
  rollupKey) (xmastree.js, via XT_ROLLUP_IGNORE_KEYS). Applied in pmrRun (late + [RELIEF: RDD] -> on time, not in
  late_rows), pmrDailyUpdateCheck (missing cleared), Metrics-tab docs / cost loops (mxRelieved), and the rollup's
  ignoredFor. So the Metrics tab, PMR export and rollup agree. NOT wired: xtAnnotateIssues row flags (hidden
  Christmas Tree), Record Audit, the Required Attachments on-screen list. Nothing on the Metrics tab says WHICH
  shipments were relieved (possible follow-up).
  RDD: monitored only via ATLAS "Monitor this RDD" (per-browser prefs.rddWatch no longer read; tick box removed);
  RDD column opt-in on In progress; date coloured only when monitored. The Closed audit still flags "delivered after
  RDD" for every shipment (that's the on-time delivery metric) — not changed.
  Daily column removed from Shipment Details -> bubble in Latest Daily Update (Current / Due today / Missing n /
  Relieved). Board .ch min-height 54px (equal header heights).
  Pushed 2026-11-22.
- v2.9.5 (user, 2026-11-22: "apply the styling tweaks across the rest of the dashboard modules"): the look now covers
  the hub tab bar (.cop-hub, app.css), Metrics + PMR + Export-Controlled (app.css block "Dashboard look (2.9.5)",
  ALL scoped to body.cop-quiet = a Dashboard view is showing, so the rest of the Utility is untouched), and
  Procurement / Property / PLS (block at the END of PMX_CSS in pmdash.js; pmSrcChip = data-source dot; refresh =
  .copx-ibtn.go; .pmx-status.quiet hidden unless .err; tile sub-line -> title). Metrics: "Shipping Metrics" title line
  replaces the navy manifest strip (file name = hover), hints hidden in #dashboard (notes moved to h2 titles), cards
  compact (sub + mini chart hidden -> title). Nothing removed from the data; only helper text / decoration hidden.
  NOT restyled: Christmas Tree (hidden tab), the weekly-slide card, detail drill-downs inside PMR. When the look goes
  Utility-wide: lift these tokens into :root and drop the body.cop-quiet scope.
  Relief legend: click a code -> copCopyText("[RELIEF: CODE] ") (clipboard API, execCommand fallback), "Copied ✓".
  Pushed 2026-11-22.
- v2.9.6 (user, 2026-11-22): BLANK = FLAG. User expected the un-back-filled fields to show as flags "so we know which
  records need to be fixed"; before, a blank RFQ Sent Date past the estimate was grey "No data" / "Not recorded".
  Now: active past TTI Estimate Preparation (pastPrep) with blank RFQ Sent Date or Date Packed -> amber warn
  (checks "rfq", new "packed", ack key cop.packed); Closed audit (delivered >= 1 Oct) adds "Date Packed entered"
  (warn) beside the existing RFQ / ITN fails; Tracker: amber "Missing" pill in Packed / RFQ sent, tile + filter
  "records to fix" (COP_TRK_PICK.fix). Hand carry + courier (sc.handCarry || sc.courier) are N/A for both — MY
  assumption (no forwarder RFQ), told to the user; undo if he disagrees.
  Confirmed to the user: the Ops Tracker is NOT read for anything (reader removed in 2.9.0); pre-1-Oct deliveries =
  N/A, they do NOT pull old tracker values. He said tracker data "should only be applied to shipments delivered
  prior to 1 Oct" — if he wants pre-Oct shipments scored from the archived tracker, that reader would have to come
  back for those only (asked him).
  Also (user, same day): an RFQ SENT LATE is a red "fail" on In progress too (was the grey "late" state, counted only
  in the Closed audit). Clears with Acknowledge or [RELIEF: RFQ].
  Pushed 2026-11-22.
- v2.9.7 (user, 2026-11-22): hand carry is the ONLY exemption from the Date Packed / RFQ Sent Date flags — courier
  shipments DO need both (supersedes my 2.9.6 assumption). Columns buttons (#copCols, #copTrkView) are an icon now
  (copColsBtn, a columns glyph; user was offered three dots / the pmdash sliders icon as alternatives). Pushed 2026-11-22.
- v2.9.8 (user, 2026-11-22): PLS "Trips — next N days" chart (pmPlsTimeline): no 18-row cap / "+N more" — every trip
  shows; drawn 1:1 at the panel's measured width (draw(W) + rAF paint + ResizeObserver; tips re-wired with
  pmWireTips(host)) so text is 11px like its surroundings (the old fixed 720-wide viewBox was stretched ~1.6x on a
  wide screen). Rows 17px, bars 7px. The Procurement dot plot / Property bars still use stretched viewBoxes — same
  fix would apply if he says they look oversized.
  PLS details table (same request): pmTable(kind, rows, isActive, { cf: true, pool }) adds a column filter row
  (PmUi[kind].cf; PM_CF_PICK = pick-lists for poc / lane / status / dest, text for the rest; pmColFilter runs in the
  PLS render so the count + Excel export follow it); search box moved from the filter bar into the table header
  (pmWireSearch); columns icon (copColsBtn) + pmColsPicker write the same "c:<col>" keys as View settings. Generic
  by `kind` but switched on for PLS only — Procurement / Property tables are unchanged until he asks.
  PLS step colours (user: dark blues indistinguishable): PM_PLS_LANES now 4 hues — review violet #6250d6, estimate
  yellow #eda100, approval blue #2a78d6, booked green #1baf7a (dark theme: #9085e9 / #c98500 / #3987e5 / #199e70 via
  the `color` getter, pmLaneDef). Validated with the dataviz skill's validate_palette.py (python -I -X utf8) on
  #ffffff and #17212c. PR lanes (PM_PR_LANES) still use the blue ramp — same change would apply if he asks.
  PLS tiles: PM_VIEW_OFF.pls += t:open, t:dtra (duplicates of the step cards; user: no need for both). Anyone who
  already customised their PLS view keeps their own choices.
  METRICS reporting window (user, same day): chips — FY (current / previous) -> Full year / Half / Quarter -> which
  half / quarter; All time + Custom at the right; date boxes only for Custom. MetricsUi.sel = { fy, span, part };
  mxWindowFor(sel) -> { start, end, label, quick }; default mxCurrentSel() = current FY, current half. quick stays
  "h1" / "h2" for the current FY's halves (xmastree reads mxCurrentHalfDefault().quick). app.js load-default and
  cop.js copSwapInMetrics carry `sel`. He first asked to rename "FY First/Second Half" to "Current / Previous FY
  Half" — superseded by the chips in the same message.
  Pushed 2026-11-22.
- v2.9.9 (user, 2026-11-22): TOP BAR — #compareBtn / #historyBtn removed (Settings > new "Tools" section opens
  openCompare / openHistory after closing Settings); #consolBtn removed (Fetch menu button #apConsol -> openConsol).
  Fetch menu: no Metrics button. PMR + Export-Controlled use the shared mxDrawWindowPicker(host, st, onChange)
  (metrics_dashboard.js; state in PmrUi.win / EcmUi.win, default mxCurrentHalfDefault(); every pick runs; PMR now
  runs on open; the old FY / Quarter selects, date boxes and Run buttons are gone). Procurement lanes = the PLS four
  hues (PM_PR_LANES via pmLaneDef; weekly slide uses the light value `lt`). Procurement / Property tables got the
  PLS tools (filter row, search in the table heading, columns icon); the filter-bar search box is gone on all three.
  PLS small tiles: all off by default (PM_VIEW_OFF.pls).
  Shipments filter row (same day): "More" <details> + RDD filter removed (CopUi.rddDays forced to 0); Day limits =
  gear icon #copLimits at the right of the row (In progress only) -> .copx-limbox panel. Rail button says just "Dashboard".
  Tile rule (user): a small tile and a larger card must never show the same thing at once. PM_VIEW_OFF now also
  hides proc t:open and prop t:open / t:out / t:o30 (duplicates of the heading, a step card, the TOP backlog panel).
  Pushed 2026-11-22.

## v2.9.10 (2026-11-22) — Settings window restyle, Day limits card, open offers
- User direction (repeat, applies to the WHOLE Utility restyle to come): clean, less-is-more; small instruction text
  belongs in a hover, not on screen. He called the old Settings window "ugly" and the Day limits panel "basic, not
  aligned, not creative".
- SETTINGS (settings.js): new SETTINGS_STYLE + _setDecorate(overlay), called right after the overlay is appended.
  It builds a left nav from the section <h3>s (one section shown at a time; _setLastSec remembers which), and moves
  every .settings-note / .ref-builtin WITHOUT an id into an "i" hover (.set-tip) on the preceding label / button row /
  heading. Markup of the fields, ids and save logic untouched. A Save that is refused jumps to the section with
  .udq-bad / #setUdqErr. New sections added later get a nav entry automatically.
- DAY LIMITS: .copx-lim pop-up card under the gear (switch .copx-sw + table: Step | Amber | Red), inputs disabled
  while off.
- "Yes to all open offers" — I took that as: the rest of the hide-by-default list, Closed-audit RDD tied to Monitor
  this RDD, and toning down the Metrics cards:
  In progress: zero tiles hidden (except "In progress" / the active one); Departing tile removed; empty step boxes
  not drawn (copShowSub = n > 0); legend = "Legend" hover (.copx-help.up).
  Tracker: COP_TRK_OFF_DEFAULT = poc, toDtra, quoteSub, origRdd, marad, delivered, inv (prefs.trk now { off, flow,
  v: 2 }; unversioned saved lists are ignored; delivered + inv auto-show on Delivered / All until the user customises;
  "Recommended" link clears prefs.trk).
  Closed audit: Status column opt-in; "late" check is N/A unless Monitor this RDD = yes (Metrics on-time % NOT changed).
  Metrics cards: white with coloured left edge + soft badge (app.css, body.cop-quiet).
  Lane colours (user: dark blue vs dark purple too similar): blue step -> light sky blue #6da7ec (dark theme #256abf)
  on PM_PR_LANES "sourcing" and PM_PLS_LANES "approval"; violet / yellow / green unchanged. Pink was tried and rejected
  (fails vs green for red-green colour-blindness).
  Pushed 2026-11-22.

## v2.9.11 (2026-11-22) — pick a shipment from the full UDQ; restyle of the rest of the Utility starts (CIV first)
- User: the 2.9.10 Settings window "is the kind of look/style revamp I'm looking for". Dashboard is done for now; he
  wants the REST of the Utility restyled the same way, tool by tool, starting with the Shipping section; CIV page
  first. UI only — never change the output documents (CIV / PL / SLI layouts stay exactly as they are).
- "ui2" = the opt-in new look for a tool page: give the panel class "ui2" (styles at the end of app.css) and call
  uiQuiet(panel) (app.js) — converts .hint / .note into hover "i" tips (uiTipHtml for hand-placed ones; hints <= 12
  chars become a quiet word after the label). Put the tool's action buttons in the header inside <span class="ui-acts">.
  Done so far: Commercial Invoice (renderCiWorkspace in app.js): actions in the header, 4-across form, signer moved
  after the remarks so the grid fills evenly, "Invoice details" fold. NEXT: the other Shipping tools (Packing List,
  Placards, SLI, RFQ, DD1149, IPC, Packet…), same recipe.
- PICK A SHIPMENT (app.js): AppFull { grid, name } keeps the full SRF UDQ aside; appShipmentList(grid) /
  appOpenShipment(wmtr) slices [header row + that record's rows] and loads it through loadFile({ name, _keepFull },
  grid) so it detects as "srf"; appBackToFull() reloads the full grid. Rail box = appShipmentPicker (shown while
  udqType is "metrics" or AppFull.grid is set). Dashboard rail button restores the full UDQ first. Shipments tab
  detail panel has a "Create documents" link (data-openship). Any other load clears AppFull.
  appOpenShipment returns "" when it opened, else a plain reason for the screen. It test-reads the slice with
  readUdq first: a shipment with no inventory lines yet can't feed the document tools (readUdq throws), so it stays
  on the full UDQ and says so (5 of 250 in the 22 Nov export). Tested with the 22 Nov SRF export: 245 open fine.
- ui2 also restyles the two "manual" bars (.md-docbar / .mp-docbar) via app.css only. Dark mode: the highlighted
  tool in the left menu was unreadable (peach box, light text) — fixed with one rule in app.css.
- Not checked by me: real mouse hover on the "i" marks (preview tab is in the background), Save as PDF print window.
  Pushed 2026-11-22.

## v2.9.12 (2026-11-22) — new look everywhere outside the Dashboard hub; quiet pre-flight; update-message fix
- User liked the CIV restyle ("great") and asked for it on the rest of the tools, plus the header, left menu and the
  dark blue request bar; possum smaller; pre-flight banner gone when all clear, inconspicuous when flagged.
- HOW THE LOOK IS APPLIED (app.js, block above loadFile): uiApply(root, isTool) adds class "ui2" to every panel;
  for tool pages it also runs uiLift (moves the first plain .btnrow into the header as .ui-acts: status, Refresh as
  an icon, buttons reversed so the main one is far right; rows with an id or non-button children stay put) and
  uiQuiet (.hint -> "i" on the field label; a page's .note -> one "i" at the end of the heading; skips anything with
  an id, hidden, holding a control, or a note that is the page's only content; content is MOVED so links keep
  working). Called at the end of renderWorkspace (not for hub tools) and from renderDashboard (now a wrapper around
  renderDashboardInner). uiWatch = MutationObserver that gives late-drawn panels the class. A new tool gets the
  look automatically if it uses the usual .panel > header + .body > .formgrid/.btnrow/.note/.previewwrap layout.
- Styles: block "2.9.12" at the end of app.css (header, rail, drop zone, request bar .manifest, .valbanner chip,
  .panel.ui2, Fetch pop-up). Header is now light (was navy + orange stripe); Fetch / Dashboard buttons navy
  #1e2a4a, active things blue #1e5aa8 (dark mode #8fbaf0 / #3d5a8c). Orange --accent is unchanged as a variable
  and still used inside dialogs, the Dashboard hub and the output documents.
- Pre-flight (validate.js validationBanner): returns null unless there is an error or warning (notes-only = clear);
  otherwise a small chip button "N errors · N warnings" that renderDashboard moves into .manifest-head. Click =
  the Pre-flight validation page, as before.
- "A new version is available" kept showing: a plain refresh loads the newest page (navigation is network-first)
  but leaves the new service worker waiting — only the toast's Reload button activated it. Now pwa.js asks the
  waiting worker its version (sw.js answers "GET_VERSION" with CACHE): same as the page (or no answer = pre-2.9.12
  worker) -> it takes over quietly, no toast, no reload; newer than the page -> toast as before. Tested both
  paths locally by temporarily renaming CACHE.
- Tested in the preview with real exports: every Shipping tool, Packet, Audit, Required Attachments, Pre-flight
  page, Inventory Crosswalk, all Property tools (DD1149, TOP, CoreIMS, Deltek, Inventory Sheet, Inventory List
  Export, PO), IR request view, dark mode, and the Dashboard hub (unchanged). NOT checked: Offline mode pages
  (couldn't switch it on from the test), AWB page, real mouse hover, live site.
  Pushed 2026-11-22.

## v2.9.13 (2026-11-22) — colour back in header / request bar; colour schemes; possum removed
- User on 2.9.12: "a little too much white now" (header, request bar, left pane). Wants colour back in the header and
  request bar; possum picture removed; the colour-scheme choice moved to Settings > Appearance with "a handful of
  boy and girl colors" for fun; Dashboard + Fetch buttons a different colour from the navy page buttons. He was
  "not a huge fan of the orange with the dark blue". Asked to see a preview of button-colour alternatives.
- COLOUR SCHEMES (app.js, block before "Rendering: tool workspace"): ATLAS_SCHEMES [{id,label,hdr,brand,ink}],
  applyScheme sets --sch / --brand / --brand-ink on <body> (+ data-scheme, + the theme-color meta); setScheme saves
  to localStorage "atlas.scheme" (added to backup.js). Light/Dark is separate ("atlas.theme", class theme-dark).
  The old possum-nose purple ("atlas.theme" = "purple", class theme-purple) migrates to Light + scheme "orchid";
  theme-purple is never applied any more (its CSS is dead but left in place). toggleTheme is gone.
- CSS: header = var(--sch) (dark mode: mixed 55% toward #0b1219); Fetch + .rail-cop = var(--brand);
  request bar .manifest = 8% wash of --sch + 5px solid left edge + solid badge; rail = 4% wash; active tool = 12%
  wash with --sch text. Page buttons stay navy #1e2a4a / links blue #1e5aa8.
- Settings > Appearance: Light / Dark + a row of two-tone swatches (#setSchemes, .set-sch); applies at once.
- DEFAULT (Navy scheme): user picked GOLD #f2b01e (ink #1b2b4b) for Dashboard + Fetch and asked for a lighter navy header (#2f4f86; #1b2b4b was "too dark again"). Was teal #0a7f7b at first — the user was shown six alternatives (teal, green,
  sky blue, violet, gold, raspberry) and asked to pick; change ATLAS_SCHEMES[0].brand / .ink and the three
  "var(--brand, #0a7f7b)" fallbacks stay harmless.
  Pushed 2026-11-22.

## v2.9.14 (2026-11-22) — header lighter again, request bar darker
- User on 2.9.13: header "a little lighter still"; request bar "a little darker — too close to the gray background".
- Navy scheme hdr #2f4f86 -> #3d63a5. Request bar wash 8% -> 24% of --sch (border 45%); WMTR / mode text are now
  --sch mixed 65% toward --ink so they stay readable on the deeper tint; summary chips are translucent white.
  History of the default header: #16283C (original) -> white (2.9.12, "too white") -> #1b2b4b ("too dark again")
  -> #2f4f86 -> #3d63a5. Applies to every scheme (percentages are shared).
  Pushed 2026-11-22.

## v2.9.15 (2026-11-22) — header: more grey in the blue
- User on 2.9.14: "More gray in the blue header color." Navy scheme hdr #3d63a5 -> #516890 (same lightness, about
  40% less saturation). The request bar tint, its edge / badge and the highlighted tool follow --sch, so they went
  slate too. Header history: #16283C -> white -> #1b2b4b -> #2f4f86 -> #3d63a5 -> #516890.
  Pushed 2026-11-22.

## v2.9.16 (2026-11-22) — header colour picked by the user
- User on 2.9.15: "I'm not digging it", asked for a palette of light-to-dark blue / grey shades. Shown an inline
  swatch picker (4 rows x 7, hue 216) with a live mini header; he chose #2f496f (steel-blue row, second darkest).
  Navy scheme hdr is now #2f496f. If he asks again, show the picker again rather than guessing.
  Header history: #16283C -> white -> #1b2b4b -> #2f4f86 -> #3d63a5 -> #516890 -> #2f496f (his pick).
  Pushed 2026-11-22.

## v2.9.17 (2026-11-22) — RFQ preview on a white sheet; Required Attachments under Audit
- User: "the rfq preview looks jacked up a bit. Has some off color boxes." Cause: updateRfqPreview set the email
  body to transparent, so the grey .previewwrap showed between the email's own white blocks (it was like this before
  the restyle too). The other previews draw their own white page; the RFQ email has none. Fix (app.js
  updateRfqPreview): body background #fff + padding 18px 24px, applied to the preview iframe only — rfqRenderHtml,
  the .eml and Copy email are untouched.
- User: "move required attachments tool to be under the audit feature in the menu" — done as a reorder in TOOLS
  (Audit, then Required Attachments). I read it as position, not nesting; offered nesting as an alternative.
- SAME VERSION (2.9.17 was never pushed before the next request came in). User then asked to revamp the RFQ
  template ("see what you can come up with that looks good") and recolour PL, IPC and Inventory Sheet: no orange
  stripe with dark blue; steel blue of the header as the dark line, the request-bar grey where dark blue was.
  This is the first time he asked to change OUTPUT documents (earlier rule was UI only) — only these four.
  * Document palette: steel #2F496F (line, labels, tags), band #CDD3DC (was navy; dark text #16283C on it),
    band-2 #DDE2E9, sub-text #44566B.
  * RFQ: js/tools/rfq_template.js is now a readable String.raw HTML template (was base64 of the desktop Word
    HTML). One 700px table, 7 columns 250/100/60/65/65/65/95, Outlook-safe (bgcolor + inline styles, no classes).
    rfq.js rfqRenderItemRows rewritten to match those 7 cells. Wording / fields / order unchanged; emoji ticks
    became a green check mark character; totals highlight is pale gold #FFF4CC (was bright yellow).
  * PL (pl.js PL_CSS screen + print, and _plXlsxStyles for Excel) and Inventory Sheet (INV_CSS; its Excel shares
    the PL styles). IPC: IPC_CSS bar + the workbook inside ipc_template.js (xl/styles.xml fill 1F3A5F -> CDD3DC,
    white font -> 16283C; repacked with Python zipfile and re-encoded).
  * Checked in the preview: all four previews; IPC workbook re-opens with SheetJS; PL / Inventory Excel parts build.
    NOT checked: the files opened in real Excel, the RFQ .eml opened in real Outlook, Save-as-PDF print of the PL.
  * Not touched (still navy / orange in places): CIV, SLI, Placards, DD1149, TOP, PO — offered.
  Pushed 2026-11-22.

## v2.9.18 (2026-11-22) — CIV header redone (no DTRA seal); Required Attachments folded into Audit
- User: "Remove the DTRA symbol from the CIV, and go ahead and update the header overall on the CIV."
  ci.js: logo_left is "" in the standard (non-offline) build, so LOGO_LEFT no longer prints on the CIV (Placards
  still use it). Header is now a flex row: .header-main (title 17pt steel blue #2f496f, red declaration under it)
  + .header-logos at the right, with a 2px steel-blue rule. Mid-task the user added: "Don't use the TRLS II logo
  image in the CIV. Just create a nice looking TRLS II label in its place." -> logo_right is "" too; the page
  gets brand_label "TRLS II" / brand_sub "TechTrans International", drawn as .header-brand (white on a steel-blue
  chip + small spaced caption). Offline mode passes brand_label "" and keeps the user's own logo / company name. Continuation header matches (left-aligned title + rule). Body of the invoice untouched.
- User: "I meant to fold required attachments check under audit. It can just be another one of the audit
  checks. Doesn't need to be its own thing in the menu." The Audit already had a "Shipping documents attached"
  check (record_audit.js, reuses reqattAuditSrf). Now: that check carries c.docs and its row shows a chip per
  required document (present / missing) + category, mode and what is attached; Copy and Export list them too.
  Menu: TOOLS entry "reqatt" has hideOn ["metrics","srf"] so it never shows (entry kept so the id resolves;
  reqatt.js is still used by the Audit and by the Metrics dashboard's shipping-docs card).
  Pushed 2026-11-22.

## v2.9.19 (2026-11-22) — CIV header centred
- User on 2.9.18: doesn't like the title + "value is declared" text left-aligned while the foot of the page is
  centred. "Keep them centered. Find a good way to cleanly incorporate the TRLS II label in there to designate
  the contract." -> ci.js header is a centred stack: .header-brandline (the "TRLS II" steel-blue block on a
  hairline that runs out to both sides; Offline mode puts the user's logo / company name there instead), then the
  title, then the red declaration, then the 2px steel-blue rule. Continuation header centred again too.
  Lesson: on the CIV keep the header symmetrical with the centred footer.
  Pushed 2026-11-22.

## v2.9.20 (2026-11-22) — PL / Inventory Sheet header in the app's blue; placards lose their logos
- User: "Use the same blue color from the main utility header in the PL and Inv Sheet headers." -> .pl-head /
  .inv-head background #2F496F with white text (screen + print); no line under it. Excel: title-band styles 1-5
  now use fill 5 (steel blue) with white / light fonts; package (group) headers keep fill 2 blue-grey + dark text.
  Package headers in the preview stay blue-grey — he said "headers", read as the top band only.
- User: "Remove the DTRA logo and TRLS II label from the placard." -> placards.js: the standard header has no
  images (preview / PDF), and the Word export embeds none (srcL only for an Offline-mode company logo; the two
  _pkFloatLogo calls removed). LOGO_LEFT / LOGO_RIGHT are now unused by CIV and Placards (PO still uses LOGO_TTI).
- CHRISTMAS THEME (same version). User asked for a Christmas theme: reds and whites, watercolour-type images in
  the background (reindeer / sleigh), holiday themes listed under Settings > Appearance, and to see options
  before anything is pushed. Shown three mock-ups; he picked B, "Snowfall".
  * Scheme "xmas" in ATLAS_SCHEMES (app.js) with holiday:true, hdr #ffffff, hdrInk #7d1622, tint #b3202f,
    brand #b3202f. applyScheme now sets --hdr-bg / --hdr-ink / --sch (= tint or hdr) and calls holidayApply.
    Header CSS uses var(--hdr-ink) so a light header gets dark text.
  * js/holiday.js (NEW file, in index.html + sw.js shell list): ATLAS_HOLIDAY_ART[id] = { rail, main, snow } as
    SVG text (shapes through feTurbulence + feDisplacementMap = watercolour look); holidayApply sets
    --art-rail / --art-main / --art-snow as data-URI backgrounds, or clears them for normal schemes.
  * app.css: .rail / .main paint those variables; body[data-scheme=xmas] adds the candy-cane stripe under the
    header, white rail, 210px of room at the foot of the page for the sleigh (background-attachment: local, so
    it shows on short pages and at the end of long ones), 100px under the menu for the sprig; dark-mode header
    is deep red.
  * Settings > Appearance: second swatch row labelled Holiday (striped swatch).
  * The artwork generator (Python) lived in the session scratchpad and is gone after the session; to add another
    holiday, hand-write or regenerate SVG and add it to holiday.js. Reindeer art was drawn for options A / C but
    is not in the app.
- Also same version: user said the PL / Inventory Sheet header bands were too tall for the overall look ->
  padding 18px -> 10px, brand 30 -> 22px, title 32 -> 23px (screen; print sizes were already small).
  Pushed 2026-11-22.

## v2.9.21 (2026-11-22) — reindeer in Snowfall; CIV label; Inventory Sheet button
- "Add the reindeer to the Snowfall theme." -> holiday.js xmas.main is now one scene: reindeer (left, facing left)
  pulling the sleigh, joined by two rein lines; drawn 520px wide (400px under 1100px), page foot padding 230px.
- "Make the CIV label at the top say both TRLS II and TechTrans Intl." -> ci.js brand_sub "TechTrans Intl";
  .hb-pill = solid steel-blue "TRLS II" block + outlined "TECHTRANS INTL" beside it, centred on the hairline.
- "Shipment Comments field in the header section should be able to expand to two rows" -> NOT changed: the CIV's
  Shipment Comments cell already wraps to two lines (line-clamp 2, tested with a long comment). Asked him where he
  saw it cut off — could be another field / tool.
- "Make the Inventory Sheet button that same blue as the header, except a few shades lighter, and move it to be
  next to the Save as PDF button." -> pl.js: #plInvExcel is class "btn steel" and now second in the row (uiLift
  reverses the row, so it lands just left of Save as PDF). .ui2 .btn.steel = --sch mixed 76% with white.
  Pushed 2026-11-22.

## v2.9.27 security fixes — Benson's QA baseline (2026-11-24)
- Benson (TTI) security-fixed v2.9.27; that copy is now in ATLAS QA and is the baseline for ALL future changes.
  Unpacked from Downloads\ATLAS_Utility_v2.9.27_secfix_base.zip and committed as "Benson security fixes (v2.9.27
  QA baseline)". Version number NOT bumped (still 2.9.27); sw.js CACHE renamed to atlas-cache-v2.9.27-sec-fix.
- sw.js: SCOPE_PATH check — same-origin requests outside the Utility's folder (ATLAS /api/UDQ, daily status) are
  never cached; renaming CACHE wipes any API responses older versions stored. Vendor libs added to APP_SHELL;
  cdn.sheetjs.com added to RUNTIME_HOSTS.
- backup.js: ATLAS_BACKUP_LOCAL_ONLY = udqApi, udqIds, dailyStatus — a backup import (merge or replace) never
  changes them (atlasKeepLocalSettings).
- util.js: esc() also escapes ' ; new safeImgSrc() allows only base64 data:image png/jpeg/gif/webp URLs. Used for
  logos in offline.js (offlineCompany drops anything else), ci.js (esc), pl.js and placards.js.
- js/vendor/: xlsx (SheetJS 0.20.3, was 0.18.5 from cdnjs), jszip 3.10.1, pdf-lib 1.17.1, pptxgen 3.12.0 now
  committed. index.html loads them with SRI integrity hashes (CDN fallback carries the same hash); pmdash.js
  PM_PPTX_SRI for PptxGenJS. download-offline-libs.ps1/.sh and js/vendor/README.txt point at cdn.sheetjs.com.
- Rules to keep these fixes are in CLAUDE.md > "Security rules".

## v2.9.28 (2026-11-24) — Request ID column in UDQ exports
- ATLAS (CR 401, daily-update write-back) added "Request ID" (a GUID) as column A of SRF-related UDQ exports;
  WMTR Number moved to B. User: it will be in every SRF-related UDQ from now on, always first. Only row 1 and the
  record rows shifted; sub-section rows (Inventory List, Daily Status History…) stayed in their columns.
- Without a fix the 24-Nov Metrics export read as a single "srf" with 0 shipments (everything finds records by
  "WMTR-" in column A). Fix: app.js udqMoveRequestIdLast() — in workbookToGrid / workbookAllSheets and the
  appMaybeDashboardUdq header peek — moves Request ID to the END of row 1 and of every row with column A filled,
  the same spot json_udq.js puts it for fetched data. cop.js copRequestId() reads it by header ("request id").
- Tested with Downloads\UDQ_WMTR_SRF_23-Nov / 24-Nov exports: both read as metrics, 251 shipments, header identical
  apart from Request ID at the end (col 123); opening a shipment (10097) works.
- The Excel export's Daily Status History still has only Date + Notes/Comments (no entry ID) — editing an entry
  needs the JSON fetch's dailyPOCList id. dailyStatus url / editUrl / requestIdField still blank: waiting on
  Benson's CR 401 details (add/edit URLs + methods, body, JSON field name for Request ID).

## v2.9.29 (2026-11-24) — daily-update write-back switched on (CR 401)
- Benson's API notes: Downloads\wmtr_api_atlass_utility_help.md. QA base https://qa-atlas.azurewebsites.net, same
  ATLAS sign-in as the UDQ API. POST /api/wmtr/{requestId}/daily-status and PUT .../daily-status/{entryId}, body
  { date: "YYYY-MM-DD", notes } (notes required, <= 3000 chars, trimmed); 200 returns { id, pocDate, pocDate_UDQ,
  pocNotesComments, createdDate }. No delete. Errors: JSON { message } — 400 bad body / entry not in request,
  401 not signed in, 403 no rights or past DTRA Compliance Review without Restricted Access, 404 unknown id.
  Rights: Shipping & Delivery Modify + Daily Status Add (or Edit/Archive); Restricted Access past Compliance Review;
  sign out/in after a role change. requestId = UDQ JSON "Id" (= Excel "Request ID" column).
- The Utility's existing code (json_udq.js atlasSendDailyStatus, cop.js copSaveDailyUpdate / copEditDailyUpdate)
  already matched this exactly — only ATLAS_UDQ_CONFIG.dailyStatus was filled in: url, editUrl, requestIdField "Id".
  Side effect (planned): fetched grids now carry "Request ID" at the end, so inside ATLAS COP WMTR numbers link to
  /wmtr/request/edit/{Id}/SRF.
- Tested in the local preview with the 10097 JSON sample and a stubbed ATLAS: POST / PUT go to the right URLs with
  the right body and credentials, the new id is kept and the entry is editable, a 403 shows ATLAS's message.
  NOT yet tested against real ATLAS QA — needs Benson to load 2.9.29 into QA. Same paths assumed for prod.
- Utility note boxes still cap at 1000 characters (maxlength in cop.js); the API allows 3000.
- User can test 2.9.29's write-back on QA's 2.9.27 now: Settings > ATLAS data source > Adjust API settings, enter
  the two addresses + Request ID field "Id", save, fetch again (browser-only override; clear once 2.9.29 is in QA).

## v2.9.30 (2026-11-24) — same-day daily updates newest first
- User (testing write-back in QA): several updates on one day — History didn't put the newest at the top.
  Cause: copReadDaily parsed "Entered" (dailyPOCList createdDate) with xtParseDate = date only, so same-day
  entries tied and kept list order; a just-saved entry was pushed at the end of the day.
- Fix (cop.js): copParseStamp keeps the time; copDailyNewer = date desc, then entries saved from here this session
  (fresh, a rising counter) first, then Entered desc. Used by copUpdatesFor and the 3 "latest update" spots.
  Just-saved entries aren't compared by clock because ATLAS's createdDate may be UTC without a "Z".
  Excel drops have no Entered column -> same-day order stays as ATLAS lists it.
- Tested with synthetic same-day entries (with and without "Z") + stubbed saves: newest first in every case.

## v2.9.31 (2026-11-24) — "Open a shipment" removed
- User: "we don't need to have the feature where you can open a shipment from Dashboard. That was only needed for
  testing outside of ATLAS. Pulling a single shipment is always easier doing it directly from the fetch button."
- Removed the whole 2.9.11 feature: app.js AppFull / appShipmentList / appFullUdq / appOpenShipment /
  appBackToFull / appShipmentPicker (+ the rail box in renderRail and the _keepFull reset in loadFile); cop.js
  "Create documents" link in shipment details + its click handler + the appBackToFull step on the Dashboard
  button; app.css .rail-pick / .rail-back styles. The 2.9.11 About entry stays as history.
- Tested: full UDQ -> Dashboard, details open with no Create documents link, Dashboard button OK, a single
  fetched shipment loads as SRF. Don't bring this back unless asked.

## LATER — "active only" Dashboard pull (parked 2026-11-24)
- User wants the Dashboard fetch to pull only active requests (Status not Cancelled / Completed / Ready To
  Invoice / Invoiced) to speed it up, like ?requestNumber= does for one shipment. Must be filtered by ATLAS:
  (1) an active-only copy of the Metrics UDQ with a Status filter (user can build UDQs) -> point the Dashboard
  fetch at its ID, or (2) ask Benson for an API option (e.g. ?activeOnly=true). Closed tab, Closed audit,
  Metrics and PMR need closed records -> pull the full UDQ only when one of those is opened. User: "We'll worry
  about the active only filter later."
