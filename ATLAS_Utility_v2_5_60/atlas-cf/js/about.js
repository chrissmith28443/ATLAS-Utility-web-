/* =========================================================================
   ATLAS Utility Web — about.js
   About / changelog panel (Feature #7).

   Surfaces the current version and a short, honest feature history. Opened by
   clicking the version chip in the top bar. The changelog lives here as data so
   each release just prepends an entry (and bumps APP_VERSION in constants.js).

   Per-version dates before 2.4.0 weren't tracked individually, so the earlier
   feature set is summarized as one "2.3.0 and earlier" entry rather than
   inventing dates/version numbers.
   ========================================================================= */

const ATLAS_CHANGELOG = [
  {
    version: "2.5.60",
    title: "Metrics \u2014 every card drills down, docs folded in, tables reordered",
    notes: [
      "Every metric card now clicks through to a breakdown. WMTR Workflow QC, Shipping docs, Tracking (AWB/BoL), and Cost accuracy used to be dead status tiles \u2014 each now jumps to its own detail section that lists the busting WMTRs (QC shows the rejection reason, Tracking the missing AWB/BoL, Cost the approved-vs-actual variance). The section totals are computed from the exact same metric rules as the cards, so a section can never disagree with its tile.",
      "Required Attachments left the side menu on a Metrics UDQ \u2014 it\u2019s now the \u201cShipping docs\u201d section inside the Metrics view (the full window, period picker and all), reached by clicking the Shipping docs card. On an SRF UDQ it stays on the menu as the single-WMTR audit, which has no dashboard home.",
      "The detail tables were reordered to follow the cards \u2014 On-time delivery first, Consolidated last \u2014 and split into two clearly separated groups: \u201cMetric breakdowns\u201d (the scored metrics) and \u201cReference & detail\u201d (counts, cost, geography, canceled, consolidated), so it\u2019s obvious where one ends and the other begins as you scroll.",
    ],
  },
  {
    version: "2.5.59",
    title: "Metrics view cleanup",
    notes: [
      "The Metrics view now reads top-to-bottom: navy title bar, reporting window, then straight into the metric cards. The flagged-WMTR boxes (daily gaps and manual flags) moved down into the Detailed breakdowns, and the \u201call daily logs up to date\u201d note is gone \u2014 the Daily updates card already says so.",
      "The Ignored control is now a button next to Export summary. It opens a dedicated window for managing acknowledged / hidden flags \u2014 add one by WMTR and category, or remove existing ones \u2014 and the button shows the current count.",
    ],
  },
  {
    version: "2.5.58",
    title: "Manually-entered metric flags (SRF)",
    notes: [
      "SRF only: the (DTRA-unused) \u201cDTRA-Only Import/Export Comments\u201d field is now a manual metric flag. Put any text on a WMTR to flag it as having busted a metric the utility can\u2019t detect on its own \u2014 a lost package, damage, a return, and so on \u2014 and the text becomes the reason. It scores alongside the other SRF metrics (Christmas Tree rollup and the Metrics dashboard card \u201cManual flags\u201d), and a new box near the top of the Metrics view lists every flagged WMTR with its note.",
      "Each flag can be acknowledged and hidden through the shared Ignored list (like the daily-gap flags), and in the Christmas Tree it\u2019s ignorable per-WMTR as \u201cManually-entered Metrics.\u201d As with every ignore, that only hides the reminder \u2014 the underlying counts and exports are unchanged.",
      "Note: this field is being repurposed, so any older notes already sitting in it (hand-carry, domestic-move, and return explanations) will show up as flags until you either clear the field in ATLAS or acknowledge them in the Ignored list.",
    ],
  },
  {
    version: "2.5.57",
    title: "CI purpose from Shipment Type, and PR TOP inventory qty",
    notes: [
      "SRF: the Commercial Invoice\u2019s Purpose of Shipment now pre-fills from the UDQ\u2019s Shipment Type. A Shipment Type of \u201cOther\u201d maps to \u201cDonation\u201d on the CI; the other types carry straight across. You can still override it in the utility, and choosing \u201cOther\u201d there (a manual choice) opens the comment field next to it.",
      "PR: the TOP inventory sheet now takes its Qty from the Quantity Received field. Previously it read Quantity Ordered, which is often blank on a received PR, leaving the quantity empty. The column is now chosen by which one actually holds values, preferring Quantity Received.",
    ],
  },
  {
    version: "2.5.56",
    title: "RFQ \u2014 EAR/ITAR auto-fill, and no authorization nag",
    notes: [
      "The RFQ tool now pre-fills the EAR / ITAR checkboxes from the inventory\u2019s ECCN/USML column: an ECCN or EAR99 marks EAR, a USML category marks ITAR. A short note shows what was detected, and you can still override before drafting.",
      "The pre-flight no longer flags a blank BIS/DDTC authorization while the RFQ tool is active. An RFQ solicits a freight quote before the export determination is made, so that field isn\u2019t required yet \u2014 it still flags for CI / SLI / export documents and in the full Validate audit.",
    ],
  },
  {
    version: "2.5.55",
    title: "Metrics dashboard \u2014 full SRF metric set, and tool sections open cleanly",
    notes: [
      "The status row now tracks the full SRF metric set the Christmas Tree scores \u2014 On-time delivery, Daily updates, WMTR QC, Shipping docs, AWB/BoL tracking, and Cost accuracy \u2014 scoped to the reporting window. Each is scored with the exact same calculation the Tree and the PMR / Required Attachments tools use, so the numbers can never disagree; the only difference is Metrics is Shipping-only while the Tree spans SRF/PR/PMCT/WS. Green/yellow/red use the PMR deck\u2019s own per-metric thresholds.",
      "\u201cLate deliveries\u201d is gone as its own card \u2014 it was just the flip side of On-time delivery, so the late count now rides along in the On-time card\u2019s subtitle. On-time and Daily still jump to their detail sections; QC, docs, tracking, and cost are status tiles whose full breakdowns live in PMR and Required Attachments.",
      "Fixed: clicking PMR, Required Attachments, or Metrics now collapses the dashboard, shows just that section, and lands you \u2014 with keyboard focus \u2014 on the section\u2019s title bar instead of leaving you scrolled to the top of the old dashboard.",
    ],
  },
  {
    version: "2.5.54",
    title: "Metrics dashboard \u2014 status cards split out from reference cards",
    notes: [
      "The Metrics dashboard now separates the two kinds of cards. The metric cards \u2014 the ones tied to a hit you act on (On-time rate, Late deliveries, Daily updates) \u2014 sit in their own larger row at the top, all sharing one status scheme: green when everything\u2019s good, yellow for anything to be warned about, red for an issue. Each carries a small OK / Warning / Issue badge.",
      "Everything else (Delivered SRFs, Line items, Pieces, Service cost, Cargo value, Destinations, CTR programs, Shipping modes, Canceled, Consolidated) is now a smaller \u201cReference\u201d card below, in neutral navy / orange / steel accents \u2014 never green, yellow, or red, so color now means only one thing on this dashboard.",
      "Canceled moved to the reference row: it\u2019s a status count that\u2019s excluded from scoring, not a metric hit. Tapping any card still jumps to its detail section as before. The scheme adapts to dark and Orchid themes.",
    ],
  },
  {
    version: "2.5.53",
    title: "Metrics tools (PMR, Required Attachments, ECM) open properly again",
    notes: [
      "On a Metrics UDQ, selecting PMR, Required Attachments, or Export-Controlled Materials looked like it did nothing \u2014 it just left the full Metrics dashboard up and scrolled you back to its top. The tool\u2019s own view was in fact rendering, but underneath the tall dashboard, so it sat off-screen below the fold.",
      "Now, whenever a tool with its own workspace is active on a Metrics UDQ, the dashboard steps aside entirely (the same way the Christmas Tree already does) so the tool opens at the top of the view. Deselect the tool to bring the dashboard back. The plain Metrics button still shows the dashboard, since that IS its view.",
    ],
  },
  {
    version: "2.5.52",
    title: "PR / property UDQs are recognized correctly again",
    notes: [
      "Dropping a PR / property UDQ (e.g. a Warehouse or procurement request) was being misread as an incomplete SRF. Two fixes: the type check now looks for the property/procurement inventory headers (Recommended Vendor / Manufacturer, Purchasing Instructions) on the actual Inventory List row wherever it falls, instead of assuming row 4 \\u2014 an Attachment section before the inventory list had been pushing it down to row 8 and hiding it. And the property inventory reader now stops at the \\u201cWorkflow Logs\\u201d section, which in these UDQs sits directly below the inventory list; previously it read all the workflow rows in as phantom line items (one real item was showing as 14).",
      "Shipping SRF UDQs and the metrics export are unaffected \\u2014 verified against real files that they still classify exactly as before.",
    ],
  },
  {
    version: "2.5.51",
    title: "Christmas Tree \\u2014 red rollup boxes jump straight to the problem requests",
    notes: [
      "Clicking a rollup box now differentiates by color. A quarter heading or a green box just scopes the reporting window to that quarter. A flagged (red or yellow) box scopes the window AND switches the tracker to Issues-only, then drills the metric \\u2014 so you land directly on the specific requests that made the box red. The Total column works the same way, scoping to all quarters.",
      "Every scored box is clickable now (previously only flagged ones were), so a green box is a quick way to pull the whole quarter up. Turn Issues-only back off with the Show control when you\\u2019re done.",
    ],
  },
  {
    version: "2.5.50",
    title: "Christmas Tree \\u2014 clicking a quarter now filters, as intended",
    notes: [
      "Selecting a fiscal quarter in the rollup now actually scopes the reporting window. Previously only the small column heading text was wired, so clicking a score cell drilled in but left the window unchanged. Now the quarter headings are clear filter buttons, and clicking a flagged score cell also scopes the window to that quarter \\u2014 so clicking a quarter does what you\\u2019d expect wherever you click. Click the active quarter again (or use the reporting-window bar) to clear back to All time.",
    ],
  },
  {
    version: "2.5.49",
    title: "Christmas Tree \\u2014 shipping documents are now ignorable per WMTR",
    notes: [
      "\\u201cShipping Documents Attached to WMTR\\u201d is now in the Christmas Tree ignore dropdown, so you can acknowledge a specific WMTR and stop it flagging for missing documents \\u2014 the same way you already can for delivery, ready-to-invoice, estimate, and the rest.",
      "A WMTR that\\u2019s scored for shipping documents and is missing one now flags in the tracker itself (the row shades, and it appears in the Issues panel), not just in the rollup drill-down \\u2014 so it lines up with every other metric. As always, ignoring is display-only: the fiscal-quarter rollup percentage and the Summary exports still count every record at its true value.",
    ],
  },
  {
    version: "2.5.48",
    title: "Christmas Tree \\u2014 cleaner, standalone workspace",
    notes: [
      "The Christmas Tree is now standalone. When you open it, the loaded shipping / PR / Metrics request dashboard is hidden entirely (the UDQ stays in memory \\u2014 it just gets out of the way), and the title bar is the same dark-navy \\u201csection start\\u201d bar as the shipping documents.",
      "Section headers are shaded so they\\u2019re easy to tell apart while scrolling \\u2014 the \\u201cPMR Metrics \\u2014 Fiscal Quarter Rollup\\u201d and \\u201cReporting window\\u201d bars now stand out instead of blending into the page.",
      "The rollup\\u2019s fiscal-quarter column headers are now the primary way to pick a reporting window: click a quarter to scope the tracker (and the results table) to it; click it again to go back to All time. The manual date picker is collapsed by default \\u2014 expand \\u201cReporting window\\u201d only if you want a custom range. The filter bar stays visible at all times.",
      "Flagged rows are now shaded end-to-end \\u2014 light pink for a hard issue, light yellow for a warning \\u2014 so you can spot which WMTRs need attention without scrolling right to find the flagged cell.",
      "The big UDQ dropzone is gone (fetching from ATLAS is the primary path). Use \\u201cLoad file\\u2026\\u201d to browse, or just drag files onto the panel. The loaded-service boxes are now compact chips, right-aligned on the same row as Fetch / Load / Ignored.",
    ],
  },
  {
    version: "2.5.47",
    title: "Default signer now actually defaults \\u2014 and stays authoritative",
    notes: [
      "The Packing List signer now starts on the Settings \\u201cDefault signer\\u201d instead of blank. Previously the Packing List ignored that setting: the field opened blank the first time and thereafter just showed whoever signed last. Custom signers are matched too.",
      "The signer no longer sticks as a \\u201clast used\\u201d value. It always follows the current Default signer, so changing the default in Settings takes effect on the next document \\u2014 it will not revert to whoever signed a given shipment last time. (Auto-save still preserves all your other in-progress form fields; only the signer is exempt, and this also neutralizes any stale signer left in an older browser cache.) Applies to the Packing List and the Packet builder; the MCT letter keeps its own template-baked signer list by design.",
    ],
  },
  {
    version: "2.5.46",
    title: "Ignore any flagged metric \\u2014 now including missing documents",
    notes: [
      "Required Attachments can now ignore flagged records, using the SAME shared list as PMR and Metrics. Two new categories were added \\u2014 \\u201cMissing documents\\u201d and \\u201cMissing country / unclassifiable\\u201d \\u2014 so a WMTR you\\u2019ve reviewed can be acknowledged and hidden from the missing-documents table (per-row \\u00d7, or from the \\u201cIgnored\\u2026\\u201d box) instead of re-reading it every run.",
      "As with PMR/Metrics, ignoring is display-only: the \\u201cMissing Attachments\\u201d count, the category breakdown, and every Copy / Export stay complete \\u2014 a \\u201c+N acknowledged & hidden\\u201d note keeps it honest. The new categories are selectable from the Ignored box wherever it appears (PMR, Metrics, Required Attachments), so you can pre-acknowledge a WMTR from any of them.",
      "Coverage is now complete across the reporting tools: PMR, Metrics, Required Attachments (shared list) and the Christmas Tree (its own list) can each suppress any metric they flag. Note the Christmas Tree keeps its own separate ignore list by design (it spans PR/PMCT/WS with a different metric set); a single unified list across all four would be a larger change.",
    ],
  },
  {
    version: "2.5.45",
    title: "Updated default ATLAS UDQ IDs (QA)",
    notes: [
      "Pointed the built-in QA defaults at the current UDQs: the Metrics UDQ is now f3e5981e\\u2026, and Shipping now has its OWN dedicated UDQ (b33fe12e\\u2026) rather than reusing the Metrics UDQ. Single-shipment fetches still narrow server-side via ?requestNumber=, so shipment document generation is unchanged \\u2014 it just reads from the correct UDQ.",
      "The Christmas Tree\\u2019s SRF source was kept in sync with the Metrics UDQ (f3e5981e\\u2026), preserving its \\u201cSRF = Metrics UDQ\\u201d relationship. Property and the PR / PMCT / WS Christmas Tree IDs are unchanged. These are the built-in QA defaults; any per-browser Settings \\u25b8 ATLAS data source overrides still take precedence.",
    ],
  },
  {
    version: "2.5.44",
    title: "Fix \\u2014 Linked Requests no longer show the whole workflow",
    notes: [
      "The dashboard\\u2019s Linked Requests panel was listing the entire request workflow (the DTRA Program/Compliance/Estimate Review history) alongside the actual linked requests. In current ATLAS exports a \\u201cWorkflow Logs\\u201d section sits directly after the Linked Request List, and the reader wasn\\u2019t treating that title as a section boundary \\u2014 so it kept reading the workflow rows in as bogus links.",
      "The Linked Request List now stops at Workflow Logs (and the other trailing ATLAS section titles), so the panel shows only genuine linked requests and their linkage type. Verified against real UDQs: what previously read as 12 rows now correctly reads as the single Consol link. Scoped to the linked-request reader only \\u2014 inventory and every other section parse exactly as before.",
    ],
  },
  {
    version: "2.5.43",
    title: "Cleaner request view \\u2014 collapsible dashboard + section focus",
    notes: [
      "Selecting a tool (CI, Packing List, etc.) now collapses the request dashboard down to just the navy WMTR bar, so the section you\\u2019re working in isn\\u2019t buried under the full request details. The bar keeps a one-line summary of what was folded away (item and package counts, weight, value, program, and a consolidation flag), and a Details / Collapse button on the bar re-opens the full inventory, parties, and linked-request panels any time. Deselecting the tool restores the full dashboard. Actionable validation flags stay visible even while collapsed.",
      "The active tool\\u2019s title bar (the top panel header) is now a dark navy bar with an orange underline, matching the WMTR strip \\u2014 the working section is easy to spot at a glance as you scroll.",
      "Consolidation: the Assign ship groups / split items window now shows the source WMTR on each line, so when several WMTRs are merged you can see which request a line item came from while grouping it onto a crate.",
    ],
  },
  {
    version: "2.5.42",
    title: "Property fetch \\u2014 same server-side single-record filter as Shipping",
    notes: [
      "Fetching a single property (PR) request from ATLAS now narrows the query server-side via ?requestNumber=, the same filter Shipping uses \\u2014 confirmed to work on the PR UDQ (and across PMCT / WS). A single WMTR/request-number entry pulls roughly one record with full detail (procurement inventory, attachments, linked requests) instead of the whole property dataset.",
      "The same safeguards apply: entries must include at least 3 digits, and if a broad entry matches more than one record the WMTR picker is shown rather than loading the first match. If the server ignores the filter, it falls back to the previous full-pull-and-slice behavior, so nothing can regress.",
      "Internal: the data-source setting that names this filter was renamed from shippingWmtrParam to requestNumberParam, since it now serves every module, not just Shipping.",
    ],
  },
  {
    version: "2.5.41",
    title: "Shipping fetch \\u2014 server-side single-record filter (requestNumber)",
    notes: [
      "Fetching a single shipment from ATLAS now narrows the query on the server via the new ?requestNumber= filter instead of pulling the whole combined UDQ and slicing it in the browser. A single WMTR/request-number entry retrieves roughly one record with its full detail (inventory, attachments, shipping activity, linked requests), so shipment document generation is unchanged but much lighter over the wire.",
      "requestNumber is a \\u201ccontains\\u201d match on the WMTR\\u2019s numeric segment (e.g. 10223 \\u2192 WMTR-26-1-P-RO-10223-SRF). If an entry is broad enough to match more than one record, the WMTR picker is shown so you choose the right one rather than generating off the first match. Entries must include at least 3 digits so the search is specific enough.",
      "Metrics and Christmas Tree still pull all records unchanged \\u2014 the filter is only applied to single-shipment fetches.",
    ],
  },
  {
    version: "2.5.40",
    title: "Settings — editable API base URL; ATLAS data source collapsed",
    notes: [
      "Settings \u25b8 ATLAS data source now includes an editable API base URL (the base every UDQ ID is appended to). Accepts a relative path (e.g. /api/UDQ) or an absolute https:// URL; leave it blank to use the built-in default. Like the UDQ IDs, it\u2019s a per-environment override saved in this browser only.",
      "The whole ATLAS data source section is now collapsed behind an \u201cAdjust API settings\u2026\u201d button, with a one-line summary of the effective API URL and any active UDQ ID overrides, so Settings isn\u2019t dominated by fields most people never touch.",
    ],
  },
  {
    version: "2.5.39",
    title: "Christmas Tree — invoicing timelines flag yellow, not red",
    notes: [
      "The Ready-to-Invoice and Invoicing past-due flags now highlight yellow instead of red, and no longer turn the whole row red. Invoicing timelines are closeout housekeeping, so red is reserved for actual metric issues (delivery, daily-update, docs, QC, cost, PR estimate). The \u201cdue soon\u201d invoicing reminders stay blue. These still appear under Issues Only \u2014 just in yellow.",
    ],
  },
  {
    version: "2.5.38",
    title: "Christmas Tree — fetch default relabeled \u201cAll WMTR\u201d",
    notes: [
      "Renamed the ATLAS fetch picker\u2019s default option to \u201cAll WMTR\u201d (it fetches all four services). \u201cSRF only\u201d is back as a regular option alongside PR/PMCT/WS only. Corrects the \u201cAll SRF\u201d label from 2.5.37.",
    ],
  },
  {
    version: "2.5.37",
    title: "Christmas Tree — upper-section restyle, per-slot clear, FY-half default",
    notes: [
      "Restyled the four service slots (rounder card corners, orange accent + subtle shadow when a UDQ is loaded) to match the rest of the app, and gave each loaded slot an \u00d7 to clear just that one service without clearing all four.",
      "Restyled the ATLAS fetch picker and changed its default to \u201cAll SRF\u201d (fetches the SRF UDQ); \u201cAll four\u201d is now the second option.",
      "The tracker\u2019s date picker now defaults to the current fiscal half (matching the Metrics/PMR date pickers) instead of \u201cAll time.\u201d The PMR rollup above it still shows every quarter.",
    ],
  },
  {
    version: "2.5.36",
    title: "Christmas Tree — Active view, FY-quarter grouping, delivery-date window",
    notes: [
      "The date/period selector now scopes by delivery date (SRF) / completed date (PR/PMCT/WS) instead of the unreliable submitted date. The full metric set applies to this delivered/completed body.",
      "Two new controls. Grouping: Flat, or By FY qtr (a section header for each quarter of delivery/completion, in chronological order). Active: Hidden (default), At bottom, or Active only. Active/undelivered requests are their own category \u2014 never touched by the date window, always rendered in a labelled \u201cActive / Undelivered\u201d section at the bottom (or as the whole table in \u201cActive only\u201d), sorted by WMTR last-5.",
      "Active requests are evaluated only on the metrics that apply while active \u2014 daily-update, PR estimate timeliness, rejected, and the cost-over-approved reapproval flag. Because Active defaults to Hidden, active issues are counted in the Issues button/filter and export only when Active is shown (At bottom / Active only).",
    ],
  },
  {
    version: "2.5.35",
    title: "Christmas Tree — active cost flag means \u201cexceeds DTRA-approved amount\u201d",
    notes: [
      "For active (undelivered) requests, the cost flag now fires only when the request has a DTRA Estimate Review (Approved) amount and the current total cost has climbed above it \u2014 the signal to seek reapproval from DTRA. Active requests still in TTI/DTRA review (no approved amount yet) have a cost but nothing to compare against, so they no longer flag. Delivered/completed requests keep the existing estimate-vs-actual accuracy check (\u00b110%). On the loaded data this flags one active request (10129 \u2014 current $3,331.25 vs approved $2,747.33).",
    ],
  },
  {
    version: "2.5.34",
    title: "Christmas Tree — SRF Completed Date left blank (Delivery Date is its completion)",
    notes: [
      "For SRF, the Delivery Date is the date of completion, so the \u201cCompleted Date\u201d column is now blank for SRF \u2014 no separate completed date (manual field or workflow stamp) is referenced. PR/PMCT/WS continue to show the Date Completed field there (from 2.5.33). Display-only; no scoring impact.",
    ],
  },
  {
    version: "2.5.33",
    title: "Christmas Tree — Completed Date uses the Date Completed field for PR/PMCT/WS",
    notes: [
      "The \u201cCompleted Date\u201d column for PR, PMCT, and WS now reads the Date Completed field instead of the workflow-history \u201cCompleted\u201d stamp. That stamp is system-generated and often lags the real completion (a coordinator may mark the request complete days later, and it can\u2019t be edited), so it isn\u2019t a reliable reference for those metrics. Their metric bucketing already keyed off the Date Completed field \u2014 this aligns the displayed column to match. SRF\u2019s Completed Date is unchanged (its timeliness keys off Delivery Date, not completion).",
    ],
  },
  {
    version: "2.5.32",
    title: "Christmas Tree — AWB relief before Mar 2026; main drop zone hidden while active",
    notes: [
      "The Shipment Tracking Details (AWB/BoL) metric now exempts anything delivered before Mar 2026 \u2014 that field wasn\u2019t added to ATLAS until Feb 2026, so earlier deliveries can\u2019t be held to it. On the loaded data the scored population drops to the 44 SRFs delivered on/after Mar 1, 2026 (earlier quarters show 0/0 for this metric).",
      "Opening the Christmas Tree now hides the main UDQ drop zone at the top of the window, so UDQs can\u2019t be accidentally dropped there instead of the Christmas Tree\u2019s per-service targets. The drop zone returns when you switch to another tool, and this doesn\u2019t change your loader-view (show/hide) preference.",
    ],
  },
  {
    version: "2.5.31",
    title: "Christmas Tree — delivery-vs-RDD timeliness is now SRF-only",
    notes: [
      "The \u201cDelivered after RDD\u201d late flag and the RDD Helper (On Time / Late) now apply to SRF records only. \u201cNLT vs. Actual Delivery Timeliness\u201d is a shipping metric; PR, WS, and PMCT records have no delivery-vs-RDD concept \u2014 only a completion date \u2014 so they were being compared against their NLT Completion Date and wrongly flagged late. Example: WMTR 10128 (WS) completed 1/27/2026 was flagged against an NLT of 12/31/2025, even though its Completed Date matched the completion. PR/WS/PMCT now just carry their Completed date with no on-time/late judgment (RDD Helper blank). SRF delivery timeliness is unchanged.",
    ],
  },
  {
    version: "2.5.30",
    title: "Christmas Tree — daily-update flag now catches every missing working day",
    notes: [
      "Replaced the daily-update check with true gap detection. From the first daily-history entry onward, every working day (weekends and holidays exempt, per the editable holiday list) must have an entry. A missing past working day flags the record \u201cDaily update missed\u201d (red); if only today\u2019s entry is still outstanding, it shows a softer \u201cdue today\u201d reminder (blue). This supersedes the looser trailing-3-working-day check from 2.5.29 \u2014 e.g. an entry on the 1st and again on the 3rd now flags the missing 2nd. Applies to active (undelivered) SRF and PR requests; a request with no daily entries yet isn\u2019t flagged.",
    ],
  },
  {
    version: "2.5.29",
    title: "Christmas Tree — daily-update flag rebased on daily history; Submitted to DTRA column",
    notes: [
      "The \u201cdaily update missing\u201d flag no longer keys off the manually-entered Submitted Date (which is unreliable \u2014 it differs from the real workflow date on ~66% of records). It now starts the clock at the first daily-history entry: once the coordinator has begun updating, an active SRF/PR request is flagged only if its most recent entry has gone stale (>3 working days). A request with no daily entries yet isn\u2019t flagged, since there\u2019s no dependable date for when updates should have started.",
      "Added a \u201cSubmitted to DTRA\u201d column derived from the first \u201cDTRA Program Review\u201d workflow stamp \u2014 the point TTI confirmed the request good and it entered DTRA review. The manual \u201cSubmitted Date\u201d column is left as-is for reference.",
    ],
  },
  {
    version: "2.5.28",
    title: "Christmas Tree — Export tracker respects the active filters",
    notes: [
      "The Export tracker (.xlsx) button now exports exactly what\u2019s shown \u2014 honoring the reporting-window (Date Submitted) range, the service filter, the current sort, and the Issues-only toggle \u2014 instead of always dumping every WMTR. To export everything, clear the filters first. A filtered export is named Christmas_Tree_filtered_<timestamp>.xlsx and the status line lists which filters were applied, so a subset is never mistaken for the full set. If the active filter matches no records, the export is skipped with a note instead of producing an empty file.",
    ],
  },
  {
    version: "2.5.27",
    title: "Christmas Tree — Ready-to-Invoice / Invoiced flags are now forward-looking",
    notes: [
      "Reworked how the tracker flags the Ready-to-Invoice and Invoiced milestones so Issues Only focuses on what can still be acted on. Each target is flagged only while it\u2019s still open (no date yet) and is either coming due (within 7 days) or already past due. Completed milestones are no longer flagged \u2014 including ones that landed late, since there\u2019s nothing to be done once they\u2019ve happened \u2014 and once a record has been Invoiced, neither target is flagged (the record is closed). Coming-due records get a calm blue highlight rather than the red \u201cmiss\u201d treatment. The completed-late history is still visible in the record\u2019s date columns; it\u2019s just no longer raised as an actionable issue. The coming-due window (7 days) is easy to adjust.",
    ],
  },
  {
    version: "2.5.26",
    title: "Christmas Tree — Issues button shows both counts",
    notes: [
      "The Issues button now shows the issue total and the affected-WMTR count together \u2014 e.g. \u201cIssues 160 \u00b7 99 WMTRs\u201d \u2014 to make clear the two numbers measure different things: total individual issues vs. the number of WMTRs affected (the latter is what the Issues Only filter count shows, since a single WMTR can miss several metrics at once). Display only; the counts themselves are unchanged.",
    ],
  },
  {
    version: "2.5.25",
    title: "Christmas Tree — relieved SRF records fully excluded from Issues Only",
    notes: [
      "Building on 2.5.24: a relieved SRF record (delivered before Oct 1, 2025, except WMTR 10095) is now treated as fully outside the measurement window, so it carries no Issues-Only flags at all \u2014 including the operational Ready-to-Invoice / Invoiced milestones that 2.5.24 still left in. Records like \u202610006 and \u202610022, which remained under Issues Only only because of those late-invoicing flags, now drop out. Non-relieved records and WMTR 10095 are unaffected, and computed metric totals and exports are unchanged (relief was already applied there).",
    ],
  },
  {
    version: "2.5.24",
    title: "Christmas Tree — Issues Only now honors the Oct-1 SRF relief",
    notes: [
      "The tracker\u2019s issue flags (and the Issues Only filter) now apply the same Oct-1 SRF relief the metric rollup uses. A relieved SRF record \u2014 delivered before Oct 1, 2025, except WMTR 10095 \u2014 no longer lights up for the metric-mapped flags it\u2019s relieved from: delivered-late, daily-update, cost variance, and rejected/QC. Previously relief was only applied to the rollup percentages, so relieved WMTRs still appeared under Issues Only. Operational milestones that aren\u2019t PMR metrics (Ready-to-Invoice, Invoiced) are intentionally left in place.",
    ],
  },
  {
    version: "2.5.23",
    title: "Christmas Tree — collapsible non-scored metrics",
    notes: [
      "The list of WMTR metrics ATLAS can\u2019t score (the pending-a-field and not-tracked sections added in 2.5.22) is now collapsible and collapsed by default, so the rollup opens on just the scored metrics. A single toggle row \u2014 \u201cMetrics not scored by ATLAS (14)\u201d \u2014 expands or hides both sections. Display-only; the .xlsx and .pdf summaries still include every metric regardless of the toggle state.",
    ],
  },
  {
    version: "2.5.22",
    title: "Christmas Tree — full PMR metric coverage in the rollup",
    notes: [
      "The PMR rollup now lists every WMTR metric from the PMR deck, not just the eight ATLAS can score. Two date-comparison metrics that are one field away \u2014 Transportation Quote (\u22641 business day of completed WMTR) and Procurement Purchased (\u22641 business day of Gov\u2019t Approval) \u2014 now appear as their own rows stating the exact ATLAS field being awaited. Below them, a \u201cNot tracked in ATLAS\u201d section lists the remaining WMTR metrics (shipment-indicator violations, freight rates, VAT/customs, ECM & HAZMAT handling, ESOH, packaging, lost/damaged cargo, warehouse receipt updates, procurement sourcing, and the eliminated consolidation metric); these are inspection- or reporting-based, so the UDQ carries no date or field to compute them. Both sections are included in the .xlsx and .pdf summaries. The point is to acknowledge the metrics exist while making clear ATLAS would need additional data fields to track them.",
    ],
  },
  {
    version: "2.5.21",
    title: "Christmas Tree — side padding fix",
    notes: [
      "Added the standard left/right (and top/bottom) padding to the Christmas Tree panel so it matches every other tool. The tool was using custom header/body classes that were never given any padding, so the \u201cChristmas Tree\u201d title and all content sat flush against the edges. The nested PMR rollup panel\u2019s header had the same gap and is fixed too. Display-only change; no effect on data, scoring, or exports.",
    ],
  },
  {
    version: "2.5.20",
    title: "Christmas Tree — ignore zero approved costs in cost accuracy",
    notes: [
      "Cost-estimate accuracy now treats an approved cost of zero the same as a blank one: not scored. These are records where cost wasn\u2019t being captured at that step in the workflow, and were previously producing a spurious ~100% variance. Records with a real (non-zero) approved cost are unaffected.",
    ],
  },
  {
    version: "2.5.19",
    title: "Christmas Tree — PR cost-accuracy fix + single-service ATLAS fetch",
    notes: [
      "Fixed PR (and unified SRF) cost-estimate accuracy scoring. The variance was gated on a \u201cDTRA Approved\u201d workflow stamp, which is SRF-only \u2014 PRs never carry it, so every PR came out unscored. It now keys off the approved cost from \u201cDTRA Estimate Review (Approved)\u201d (the same event/date), so PRs with an approved cost are scored. Records with an approved stamp but no captured cost are simply not scored. Actual cost is still the current Total Cost until invoiced amounts are in the UDQ.",
      "SRF cost-accuracy numbers are unchanged by this (SRFs already carried the approval stamp) \u2014 the fix only lights up PRs that were previously blank.",
      "Added a service picker to the Christmas Tree\u2019s ATLAS fetch: you can now pull just one service (SRF / PR / PMCT / WS) instead of always fetching all four. \u201cAll four\u201d remains the default.",
    ],
  },
  {
    version: "2.5.18",
    title: "Christmas Tree — Tracking Details rule simplified to AWB/BoL",
    notes: [
      "Simplified the Shipment Tracking Details metric: a WMTR now passes as long as the AWB/BoL field has a value. The carrier and tracking-link fields are still read but no longer required. Since tracking is built into every request, this is effectively 100% on complete (production) data.",
    ],
  },
  {
    version: "2.5.17",
    title: "Christmas Tree — Shipment Tracking Details metric",
    notes: [
      "Added the eighth scored PMR metric: “Shipment Tracking Details Input” (SRF). For each delivered SRF it checks the Shipping Activity & History section for a carrier/freight forwarder plus a tracking identifier (AWB/BoL or tracking link), scored Green ≥98% / Yellow ≥95% / Red <95% per the deck. It reads the section the same way the Commercial Invoice tool does (via the shared section-table reader), so the value matches elsewhere in the app.",
      "This removes “tracking details” from the not-yet-scored list, leaving only the two metrics that genuinely need new ATLAS fields (transportation-quote and PO-execution timeliness).",
      "Note on QA data: shipping-activity is only fully populated for recent records in the QA snapshot, so on QA this metric reads high for the newest quarter and low for older ones. Production data is complete, where it will reflect actual tracking entry. Like every SRF metric, it honors the Oct-1 relief.",
    ],
  },
  {
    version: "2.5.16",
    title: "Christmas Tree — click-to-drill-down + PDF export fix",
    notes: [
      "Fixed the PMR metrics PDF export, which failed with a font-encoding error (\u201cWinAnsi cannot encode \u2264\u201d) because metric labels contain characters like \u2264. All PDF text is now converted to the font\u2019s supported set (e.g. \u2264 \u2192 <=), so the export completes; accented letters in names and countries are preserved.",
      "The rollup scorecard is now interactive: any cell with flags shows a \u26a0 count and is clickable. Clicking it expands the exact records behind that metric/quarter and what each was flagged for. Click a WMTR in that list to isolate it in the tracker below; click the cell again or the \u00d7 to close.",
      "The drill-down reads the same per-cell flagged-record detail that drives the Excel/PDF worklist, so the on-screen view and the exports always agree.",
    ],
  },
  {
    version: "2.5.15",
    title: "Christmas Tree — PMR metrics summary export (Excel + PDF)",
    notes: [
      "Added “Summary (.xlsx)” and “Summary (.pdf)” buttons to the PMR Metrics rollup. Both produce the same report: the fiscal-quarter scorecard (per-metric pass/total, %, Green/Yellow/Red) plus a flagged-records worklist listing every record that missed a metric, which quarter it falls in, and exactly what it was flagged for.",
      "The Excel workbook has two tabs — “PMR Metrics” (the scorecard) and “Flagged Records” (the filterable worklist). The PDF renders the scorecard with Green/Yellow/Red cells and the worklist grouped by metric.",
      "The worklist reasons are specific: delivered-late with day count, missing daily-status days, the actual rejection reason from the workflow log, the exact missing documents (from the Required Attachments rules), and cost-variance percentage. This is the same flagged-record detail that will drive click-to-drill-down next.",
    ],
  },
  {
    version: "2.5.14",
    title: "Christmas Tree — only flag delivered-late, not undelivered past-RDD",
    notes: [
      "The Issues worklist no longer flags an undelivered record just for being past its RDD. In practice the RDD is normally approved to move to the eventual delivery date, so a not-yet-delivered request isn’t a metric hit.",
      "A delivery hit is now raised only when a record has a delivery/completed date later than its (un-adjusted) RDD — i.e. it was delivered late without the RDD being moved. Adjusting the RDD to cover the delivery clears the flag automatically.",
      "This changes only the on-screen worklist. No metric count moves: the PMR-metrics rollup already scored delivery on delivered records only, so the two were already aligned on the numbers — this just stops the tracker surfacing false to-do items.",
    ],
  },
  {
    version: "2.5.13",
    title: "Christmas Tree — PMR metric rollup dashboard",
    notes: [
      "Added a “PMR Metrics — Fiscal Quarter Rollup” panel to the Christmas Tree. It scores the seven metrics the UDQ can actually answer — NLT-vs-actual delivery, near-real-time (daily) status updates, WMTR QC issues (rejected in/after Compliance Review), shipping documents attached, SRF and PR cost-estimate accuracy, and PR estimate timeliness — by fiscal quarter, Green/Yellow/Red against the PMR deck thresholds.",
      "Every scored line reuses an existing calculation so numbers can’t drift: delivery and daily updates come straight from the PMR tool’s own run, and shipping-documents reuses the Required Attachments rules (category, courier and hand-carry handling included). SRF lines honor the shared Oct-1 relief. Records bucket by fiscal quarter of Delivery Date (SRF) / Date Completed (others).",
      "Metrics whose ATLAS fields don’t exist yet (transportation-quote and PO-execution timeliness) are listed as “not yet scored” rather than guessed. Cost accuracy uses current total cost as the actual-cost proxy until invoiced amounts are in the UDQ. Excel/PDF summary export is next.",
    ],
  },
  {
    version: "2.5.12",
    title: "Shared SRF metric-relief logic (PMR ↔ Christmas Tree parity)",
    notes: [
      "Factored the SRF metric-relief rule into one shared calculation so the PMR tool and the Christmas Tree tracker can never disagree. TTI was relieved of metrics on SRFs delivered before Oct 1 2025 (they still count in every total, just not against any metric) — with the one exception that was actually reviewed in the Apr–Sep FY25 half PMR, which is scored normally.",
      "The relief now covers all SRF metric scoring, not just on-time delivery. In particular, the PMR Daily Update Check no longer flags a relieved SRF, matching the delivery metric’s long-standing behavior. Non-SRF services and not-yet-delivered requests are never relieved.",
      "No change to any delivered total, destination, mode, cost, value, or program figure — only which SRFs are eligible to be scored on a metric. This is the shared foundation the upcoming Christmas Tree PMR-metrics rollup builds on.",
    ],
  },
  {
    version: "2.5.11",
    title: "Edit ATLAS UDQ IDs from Settings (no redeploy)",
    notes: [
      "Added Settings ▸ “ATLAS data source — UDQ IDs”. You can now update the UDQ IDs the “Fetch from ATLAS” buttons use — Metrics, Shipping (SR), Property (PR), and the four Christmas Tree services (SRF / PR / PMCT / WS) — without a code change or redeploy.",
      "These are overrides, not replacements: leave a field blank to use the built-in default (shown in grey), or enter a GUID to override it. IDs are validated as GUIDs on save, and overrides are scoped to the active environment (QA/Prod) so they won’t collide when the build is flipped to production.",
      "Overrides are stored in your browser only — the built-in defaults compiled into the app remain the source of truth for everyone else, so an un-configured machine behaves exactly as before. Overrides are included in Settings ▸ Export backup if you want to move them between machines.",
    ],
  },
  {
    version: "2.5.10",
    title: "Live ATLAS UDQ IDs wired; “Ignored” list added to PMR & Metrics",
    notes: [
      "Fetch from ATLAS now points at the live UDQ IDs. Shipping (SR) reuses the Metrics UDQ and filters to the WMTR you enter inside the utility — no server-side WMTR filter is needed. Property (PR) works the same way: it pulls the full property dataset from ATLAS and filters to the PR/WMTR number in the utility, rather than expecting a single pre-filtered record.",
      "The Christmas Tree tracker’s ATLAS fetch is wired to its per-service UDQs (SRF reuses the Metrics UDQ; PR, PMCT and WS each have their own), so all four services can be pulled in one action instead of dropping four exports.",
      "Added a shared “Ignored” list to the PMR and Metrics tools. Use it to hide data-quality reminders you’ve already reviewed — the red “Action required” banners in PMR and the flagged-WMTR / data-quality strips in Metrics. Click the “×” on any flagged item to acknowledge just that one, or manage the whole list (by WMTR and category) from the “Ignored…” panel. This is purely a review aid: it never changes a delivered total, on-time %, any breakdown, the Daily Update Check table, or an exported workbook — the underlying figures always stay true. The list is shared between PMR and Metrics (they’re two views of the same report) and persists in your browser.",
    ],
  },
  {
    version: "2.5.9",
    title: "Compare fixes: caught identifier changes & correct package matching",
    notes: [
      "Fixed a bug where a change to an inventory value made of letters and numbers — a model/catalog number, HTS code, or ECCN — could go undetected if the two values shared a leading run of digits (e.g. a model number changing from \"…-75FT\" to \"…-100FT\"). The number-tolerant comparison (which lets \"$1,000.00\" match \"1000\") now only applies to values that are wholly numeric; identifiers are compared as text.",
      "Fixed package (parent \"P\" row) comparison so that removing one pallet from the middle of the list no longer mis-reports the pallets after it. Previously, when every pallet shared a blank ship group and the same generic label, they were matched by position, so dropping one made a later pallet look \"changed.\" Packages are now matched by content first — identical pallets cancel out and only genuinely added or removed pallets are reported.",
      "Inventory items are matched the same robust way, so an unchanged line can't be mistaken for a change when a duplicate line above it is removed.",
    ],
  },
  {
    version: "2.5.8",
    title: "Compare: two-slot loading, ATLAS fetch & full inventory diff",
    notes: [
      "Compare now opens with two side-by-side slots — UDQ A (\"was\") and UDQ B (\"now\"). If an SRF UDQ is already loaded it pre-fills slot A, but either slot can be replaced at any time by dropping or browsing to a different file, so any two SRF UDQs can be compared without touching what's loaded.",
      "Each slot can also fetch an SRF straight from ATLAS by WMTR number — the same session-cookie path as the header ATLAS button, read in memory only. The combined Shipping UDQ is fetched once per Compare session and reused for both slots, so pulling two WMTRs costs a single network trip.",
      "The inventory diff now covers every captured line-item data element — adding Weight (kg), Temp control, Shelf life, Vendor, and Ship group to the fields already compared — and items whose Description or Model/Catalog Number was edited are matched up and reported as changed instead of appearing as one removed + one added.",
      "Package (\"P\") rows are compared too: count, unit of issue, weights, dims, and description, in a new Packages section with its own summary chip. Both exports (.xlsx and Word .doc) include the Packages section and the two-slot \"UDQ A (Was) / UDQ B (Now)\" labeling.",
      "Service-worker precache list re-synced to the file versions the page actually loads (it had drifted over several releases, and js/json_udq.js was missing), so offline installs cache the correct assets.",
    ],
  },
  {
    version: "2.5.7",
    title: "ATLAS-first loader, Compare upgrades & UI polish",
    notes: [
      "New header \"ATLAS / UDQ\" button opens a popover to fetch a UDQ straight from ATLAS — dedicated Shipping (SR), Metrics, and Property (PR) buttons, with a WMTR prompt only for the single-WMTR (SR/PR) pulls. A drop zone in the same popover still accepts a manual UDQ file, and a \"Keep UDQ drop zone visible\" toggle controls the compact drop strip in the main window.",
      "The left tool menu can now be collapsed; when collapsed, the main view is centered on wide monitors instead of pinned left.",
      "Compare UDQs: the \"choose other UDQ\" control is now a drop zone, the summary chips jump to their section, and results can be exported to .xlsx or a Word (.doc) styled like the on-screen view.",
      "PMR now opens on the current fiscal-year half by default, and the Metrics-group date pickers (PMR, Required Attachments, ECM) share the Metrics tool's look.",
      "Purchase Order \"Quote PDF\" picker restyled, and the Install app action moved into Settings ▸ Application.",
    ],
  },
  {
    version: "2.5.6",
    title: "Line-item & piece counts on the Metrics dashboard",
    notes: [
      "New \"Line items\" and \"Pieces\" cards on the Metrics dashboard, next to Delivered SRFs. Both are scoped to the same delivered, in-window WMTRs as the rest of the dashboard, so they update with the reporting window.",
      "Line items counts distinct items: when the same item is listed on several rows instead of using the Quantity column, those rows collapse to one (identity = Description + Model/Catalog Number, de-duplicated within each WMTR).",
      "Pieces is the total Quantity shipped, summed across those same rows.",
      "Package/parent (\u201cP\u201d) rows \u2014 the boxes and pallets themselves \u2014 are excluded from both counts, matching how the shipment reader already treats packages as not line items.",
      "A \"Shipment contents\" detail panel (which the two cards scroll to) documents these rules, and both figures are added to the Export summary (.xlsx) so it matches the dashboard.",
    ],
  },
  {
    version: "2.5.4",
    title: "Commercial Invoice auto-fill from the UDQ",
    notes: [
      "Commercial Invoice \u2014 Shipment Comments now pre-fills automatically from the UDQ's CTR Program field as \"Defense Threat Reduction Agency (DTRA) - <program spelled out> (<acronym>)\" (e.g. \"\u2026 - Biological Threat Reduction Program (BTRP)\"). The program is spelled out using the same map the TOP Documents tool uses; a blank program leaves the field empty. The field stays editable.",
      "Commercial Invoice \u2014 Shipment Ref No now pre-fills from the UDQ's AWB/BoL field when present, and remains editable so it can be overwritten.",
      "Removed the \"all processing happens in your browser\" tagline from the header.",
    ],
  },
  {
    version: "2.5.1",
    title: "Metrics dashboard overhaul + Daily Update Check",
    notes: [
      "Reworked the top of the Metrics view into an at-a-glance dashboard: every metric is a compact card with its number plus a small inline chart, all grouped in one area. Tap any card to smooth-scroll to its expanded section, which now sits clearly below the dashboard.",
      "New \"Daily Update Check\": for every WMTR with a Daily Status History, the tool confirms a daily entry exists for each business day in the logged span (weekends and US federal holidays are skipped). WMTRs missing a business-day entry are flagged in a box pinned to the very top of the Metrics view.",
      "The Metrics view shows the check as a compliance donut with a per-WMTR detail table; the PMR tool adds it as another report section (table) with Copy and Export (.xlsx) — a plain table, no embedded chart, and the charted full-PMR workbook is unchanged.",
      "Metrics UDQ now tolerates non-delivered records: ATLAS no longer filters them out on export, so the app explicitly counts only delivered WMTRs (those with a Delivery Date) for every delivered metric. The Daily Update Check is the deliberate exception — it still checks in-progress, not-yet-delivered shipments.",
      "New \"Canceled\" metric: WMTRs with a Canceled status are reported on their own (dashboard card, detail table, PMR section, and a sheet in the Excel summary). They're never counted as delivered or scored for on-time/late, and they're excluded from the Daily Update Check. Canceled WMTRs show in every view regardless of the selected reporting window.",
      "On-Time Rate / Late Deliveries now exclude any WMTR delivered before Oct 1, 2025 (TTI was relieved of the NLT Completion Date requirement before that date). Those WMTRs still count toward delivered totals, destinations, modes, cost, value, and programs — only the on-time metric ignores them.",
      "The \"first entry within N days of the Date Submitted\" check is intentionally disabled for now, since Date Submitted is user-entered (a request can be drafted long before it is actually submitted). The logic is retained, commented out, to re-enable once a reliable submission timestamp is available.",
    ],
  },
  {
    version: "2.4.5",
    title: "Accessibility pass (Section 508 / WCAG)",
    notes: [
      "All dialogs now trap keyboard focus, move focus in on open, restore it on close, and mark the background inert for screen readers.",
      "Added a polite screen-reader announcement of the file type and pre-flight result when a UDQ loads, and a consistent visible focus outline across controls (including the dark header).",
    ],
  },
  {
    version: "2.4.3",
    title: "RFQ email draft (.eml)",
    notes: [
      "New \"Create email draft (.eml)\" button on the RFQ tool: downloads a ready-to-send draft with the subject, recipients, and full formatted RFQ in the body. Double-click to open in Outlook / Thunderbird / Apple Mail — no clipboard paste step.",
      "The previous clipboard + mailto flow remains as a fallback (\"Open draft (mailto)\"), now worded for any mail client rather than Outlook specifically.",
      "RFQ drafts are recorded in run history.",
    ],
  },
  {
    version: "2.4.2",
    title: "UDQ parse diagnostics + inventory CSV",
    notes: [
      "New \"Diagnose layout\" report (under the load status line): shows which type-detection signals, section titles, shipment headers and inventory columns were found vs missing — handy when a file detects as the wrong type or won't fully parse.",
      "New \"Export inventory (CSV)\" action: dumps the parsed line items (SRF or Property) to a spreadsheet-ready CSV for ad-hoc analysis.",
      "A file that reads but fails to parse now keeps enough state to run diagnostics instead of erroring out blankly.",
    ],
  },
  {
    version: "2.4.1",
    title: "Configurable validation gate",
    notes: [
      "New Settings ▸ Validation gate: turn selected pre-flight errors into hard blocks (e.g. export-controlled item with no ECCN, missing destination country, required party with no address).",
      "Blocked generation shows the offending issues and a one-click override with an optional reason — recorded in run history — for when a draft is needed before every detail is in hand.",
      "Off by default; the validator stays advisory unless you enable it.",
    ],
  },
  {
    version: "2.4.0",
    title: "Backup/restore + this About panel",
    notes: [
      "Export all settings, reference data, run history and recents to a single JSON file, and re-import it (Replace or Merge). Lets you move data to a new machine or share curated reference data with teammates.",
      "Added this About / changelog panel — click the version chip any time.",
    ],
  },
  {
    version: "2.3.0 and earlier",
    title: "Established feature set",
    summary: true,
    notes: [
      "Pre-flight validator with UN / ECCN / HTS format checks and origin/destination sanity.",
      "One-click Generate Packet (CI / PL / Placards / IPC / SLI) with a required freight-forwarder selection.",
      "Editable Settings & reference data: signers, freight forwarders, default contract and purpose.",
      "Installable offline PWA with locally-vendored libraries plus CDN fallback, and an \"update available\" toast.",
      "Run history / audit log, recent-UDQs list, UDQ compare/diff, dangerous-goods flag, auto-saved form inputs, and dark mode.",
    ],
  },
];

const ABOUT_STYLE = `
  .ab-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1050;padding:6vh 16px;overflow:auto;}
  .ab-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:540px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .ab-dialog header{display:flex;align-items:baseline;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line);}
  .ab-dialog header h2{margin:0;font-family:var(--disp);}
  .ab-dialog header .ab-ver{font-family:var(--mono);font-size:.8rem;color:var(--steel);}
  .ab-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .ab-body{padding:16px 18px;}
  .ab-lede{color:var(--steel);font-size:.9rem;margin:0 0 16px;}
  .ab-entry{margin-bottom:16px;}
  .ab-entry:last-child{margin-bottom:0;}
  .ab-entry .ab-head{display:flex;align-items:baseline;gap:8px;margin-bottom:4px;}
  .ab-entry .ab-vtag{font:600 .78rem var(--mono);background:var(--accent);color:#fff;border-radius:6px;padding:1px 7px;}
  .ab-entry.ab-old .ab-vtag{background:var(--steel);}
  .ab-entry .ab-title{font-weight:600;}
  .ab-entry ul{margin:4px 0 0;padding-left:18px;}
  .ab-entry li{margin:3px 0;color:var(--ink);font-size:.92rem;}
  .ab-foot{display:flex;align-items:center;padding:14px 18px;border-top:1px solid var(--line);}
  .ab-foot .spacer{margin-left:auto;}
  .ab-meta{color:var(--steel);font-size:.78rem;}
`;

function _aboutVersionString() {
  return (typeof APP_VERSION !== "undefined" ? APP_VERSION : "");
}

function closeAbout() {
  const o = document.getElementById("aboutOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _aboutEsc);
}
function _aboutEsc(e) { if (e.key === "Escape") closeAbout(); }

function openAbout() {
  closeAbout();
  const entries = ATLAS_CHANGELOG.map((e) => `
    <div class="ab-entry ${e.summary ? "ab-old" : ""}">
      <div class="ab-head">
        <span class="ab-vtag">${esc(e.version)}</span>
        <span class="ab-title">${esc(e.title || "")}</span>
      </div>
      <ul>${e.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    </div>`).join("");

  const overlay = el(`
    <div class="ab-overlay" id="aboutOverlay">
      <div class="ab-dialog" role="dialog" aria-modal="true" aria-label="About ATLAS Utility">
        <style>${ABOUT_STYLE}</style>
        <header>
          <h2>ATLAS Utility</h2>
          <span class="ab-ver">${esc(_aboutVersionString())}</span>
          <button class="x" id="aboutClose" title="Close" aria-label="Close">×</button>
        </header>
        <div class="ab-body">
          <p class="ab-lede">Browser-only tool for generating transportation &amp; logistics documents from a UDQ
          Excel export. All processing happens on this device — UDQ data never leaves your computer.</p>
          ${entries}
        </div>
        <div class="ab-foot">
          <span class="ab-meta">Per-browser storage · no backend</span>
          <span class="spacer"></span>
          <button class="btn primary" id="aboutOk" type="button">Close</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeAbout(); });
  overlay.querySelector("#aboutClose").addEventListener("click", closeAbout);
  overlay.querySelector("#aboutOk").addEventListener("click", closeAbout);
  document.addEventListener("keydown", _aboutEsc);
}

function initAboutButton() {
  const btn = document.getElementById("aboutBtn");
  if (btn) {
    // Keep the chip showing the live version from constants.js.
    const v = _aboutVersionString();
    if (v) btn.textContent = v.toUpperCase().indexOf("WEB") === 0 ? v.toUpperCase() : ("WEB " + v.replace(/^web\s*/i, ""));
    btn.addEventListener("click", openAbout);
  }
}
document.addEventListener("DOMContentLoaded", initAboutButton);

/* ---------- Node test support ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ATLAS_CHANGELOG };
}
