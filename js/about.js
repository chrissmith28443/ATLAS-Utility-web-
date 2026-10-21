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
    version: "2.6.8",
    title: "COP: the board follows every filter",
    notes: [
      "The WMTR bubbles now show only what's in the table — driven by the filters up top, the search box, Needs attention, RDD, or any column filter in the table. Step counts and the missed / attention / on-track tallies follow.",
      "Developer mockup (daily-update sheet): each WMTR row has its own Save button so updates can be saved one at a time (ATLAS can time out), plus Save all updates. Typed-but-unsaved updates stay put when another row is saved.",
    ],
  },
  {
    version: "2.6.7",
    title: "COP: sortable / filterable table, column picker, cleaner board",
    notes: [
      "Shipment table: click any column header to sort (again to reverse); a filter box or pick-list under each header narrows the list (the board fades what's filtered out). Reset clears them.",
      "Columns button: add or remove columns. Days in Step is now optional, alongside Request Title, Requestor, CTR Program, Mode, Carrier, AWB/BoL #, Est. Departure, Total Cost and the Ops Tracker's Date Packed, RFQ Sent and ITN. Your choice is saved in this browser.",
      "Origin now shows above Destination in the same column.",
      "Board: Estimate reads TTI Estimate Preparation → CT Program > $100K Approval → DTRA Estimate Review; \"Pending Pre-clearance\" replaces Pre-clearance / green light. The $100K and Delivery boxes only appear when a shipment is in them.",
      "Entering daily updates is removed from the Utility (it can't write to ATLAS) — it's kept for the developer mockup, now with a Save daily updates button. Shipment details link to the full update history.",
    ],
  },
  {
    version: "2.6.6",
    title: "COP: fewer flags on active shipments",
    notes: [
      "The Metric hits filter is now on the Closed tab only — on Active shipments, \"Needs attention only\" does the job.",
      "Denied Party Screen result is no longer checked (the field isn't used).",
      "\"Draft AWB / BoL uploaded before In Transit\" removed — it's always uploaded before then. Carrier and AWB/BoL # are still checked.",
      "Cost over the DTRA-approved amount is flagged only when it's more than 10% over the approved cost.",
    ],
  },
  {
    version: "2.6.5",
    title: "COP: Closed tab is metric hits only; RDD only when monitored",
    notes: [
      "RDD isn't checked or flagged at all unless \"Monitor RDD for this request\" is ticked (then amber 5 business days out, red once passed). The Past RDD filter still works.",
      "Active shipments: the Cost List check is replaced by \"Total Cost above $0 before DTRA Estimate Review\" (Total Cost is auto-calculated from the Cost List).",
      "Closed tab (post-shipment audit) now checks metric hits only: RFQ sent on time (1 business day after the later of Compliance approval and the pack date), daily updates, shipping documents (Commercial Invoice, Packing List, SLI/AES for US exports, VAT exemption, POD, MCT for US imports), AWB/BoL + carrier, AES/ITN and MARAD filing, Delivery Date / delivered vs RDD, cost variance, rejections, manual metric flags and invoicing.",
      "Removed from Closed: addresses/POCs, inventory fields, weights and dims, temp control / HAZMAT, Ship Group, Identify As, Denied Party Screen, BIS/DDTC, cost list, Total Cost, cost-list match, $100K approval, vendor quotes and invoice, RFQ email, Purchase Order, photo, pallet placard, warehouse receipt, Dangerous Goods Declaration, pack date and Red Flag.",
    ],
  },
  {
    version: "2.6.4",
    title: "COP: Program/Compliance and Estimate split by stage",
    notes: [
      "DTRA Program / Compliance Review is split into DTRA Program Review and DTRA Compliance Review boxes; Estimate into TTI Estimate Preparation, DTRA Estimate Review / cost approval, and CT Program > $100K Approval — the same inner boxes Execution already had.",
    ],
  },
  {
    version: "2.6.3",
    title: "COP: daily updates from the board, request links, requestor view",
    notes: [
      "Daily updates: enter them right from the COP — in a shipment's details (\"Add daily update\") or with \"Enter daily updates\" above the table, which lists every shipment you can update in one sheet. \"History\" opens the full daily-status log, styled like ATLAS's Daily Status Activity. Until the COP is built into ATLAS, entries are saved in this browser and marked \"pending\"; they count toward the daily check, are included in Backup, and drop off once the same day's update shows up in a fresh ATLAS pull.",
      "Request link: the WMTR in the table and details has an \"open in ATLAS\" link. It's a placeholder for the developer mockup — once the COP lives in ATLAS it opens the request.",
      "Requestor view: \"View as Requestor\" shows a clean page — your active requests by step in plain language, the latest update, destination, RDD and your TTI POC's contact, with a progress bar and update history per request. No compliance checks or metric flags. (In ATLAS this shows the signed-in requestor's requests; here a picker stands in for that.)",
    ],
  },
  {
    version: "2.6.2",
    title: "COP: RDD optional per request, AES deadlines, cleaner filters and layout",
    notes: [
      "RDD: no longer policed by default. A passed RDD is amber only once the shipment is in Execution. For a request with a firm date (a training event, travellers), tick \"Monitor RDD for this request\" in its details — then it turns amber 5 business days out and red once passed. (The switch is saved in this browser.) New \"Past RDD\" choice in the RDD filter.",
      "AES filed (ITN): now checked against the 15 CFR 30.4 filing deadline — sealift 24 hours before loading (the day before Departure from Origin Est. Date), air 2 hours before departure (8 for USML items), truck 1 hour before the border. Amber within 2 days of the deadline, red once it passes or if the shipment departs without an ITN.",
      "Cost List check: a cost line with a total now counts (some lines carry only the total; ATLAS leaves the burdened rate blank).",
      "Quality Review gaps after the request has moved on now say \"Incomplete\" instead of \"Late\" — they're complete-or-not, not a timing thing.",
      "Daily updates (COP, Metrics, PMR, Christmas Tree) are required from 1 March 2026.",
      "Layout: smaller oval WMTR tags; step headers without step numbers, with the WMTR count in a circle; TTI POC, Metric hits, Search and Needs attention always in view (TTI POC lists only the people with shipments in this view), RDD and the Ops Tracker / Day limits links under More filters; \"My shipments only\" removed. Hover shows which daily-update days are missing. Shipment details are three columns: request + last 10 daily updates, the steps in order, and the throughout checks.",
    ],
  },
  {
    version: "2.6.1",
    title: "COP: the RFQ is the only timeline flagged by default",
    notes: [
      "Time-in-step flags (\"sitting in a step too long\") are now off by default. The only hard timeline the COP flags out of the box is the RFQ: sent within 1 business day of both Compliance approval and the pack date.",
      "Management can still switch time-in-step flags on — Filter › Day limits › \"Flag shipments that sit in a step longer than these limits\" — and set the limits for each step. The Days in Step column still shows the count either way, without colouring it.",
    ],
  },
  {
    version: "2.6.0",
    title: "COP redesign: four steps, a bubble per shipment, ATLAS styling",
    notes: [
      "The COP's Shipments tab is redesigned in the ATLAS look (white cards, blue table headers, the light-blue Filter bar, navy tabs). Each active shipment is a bubble showing the last five digits of its WMTR, in one of four steps: TTI Quality Review, DTRA Program / Compliance Review, Estimate (TTI preparation and DTRA review), and Execution — which is split by where the shipment is: pre-clearance / green light, booked / picked up, in transit, customs, delivery.",
      "Bubble colours: green = on track, amber = needs attention, red = missed or overdue. A small red number on a bubble is how many business days it's missing a daily update. Hover a bubble for the latest daily update, whether a daily update is missing, and any other open items; click it to jump to its row and step-by-step checklist.",
      "Drafts aren't shown. \"Delivered - POD Received\" now counts as complete and moves the shipment to the Closed tab, which is the post-shipment audit (every required document, metrics and close-out checks).",
      "Day-to-day checks only: daily updates; problem status, Red Flag, RDD and time in step; at Quality Review the minimum inventory fields (Description, Qty, U/M, U/I, ECCN/USML, Schedule B/HTS, Cntry of Mfg, Value), addresses / POCs and countries matching the addresses; after Compliance, DTRA's BIS/DDTC authorization and Denied Party Screen; the RFQ within 1 business day of both Compliance approval and the pack date; Cost List, draft CIV and Packing List before DTRA Estimate Review; a draft AWB before In Transit; carrier and AWB/BoL # once moving; ITN before departure; MARAD. Temp control / HAZMAT, PO, VAT, POD and other close-out documents are no longer flagged while a shipment is active.",
      "\"To do\" items (what's left in the current step) don't colour a bubble. Gaps from a step the shipment has already passed are shown as \"Late\" in its checklist but don't keep it amber.",
      "Time in step: TTI Estimate Preparation now counts from the pack date (4 days amber, 6 red), so a request waiting for cargo to arrive isn't flagged. Program and Compliance Review are one step (6 / 10 days). Day limits saved in an earlier version are reset to the new defaults.",
      "Filter bar: TTI POC, My shipments only, Metric hits, RDD window, search, Needs attention only, Reset; the Ops Tracker and Day limits links live there too. The COP's tab is now called Shipments.",
    ],
  },
  {
    version: "2.5.99",
    title: "Fetch from ATLAS now brings the Cost List, full shipping activity and estimates",
    notes: [
      "Fetching a UDQ from ATLAS now rebuilds everything the Excel export has that the tools read: the Cost List (with each line's attached quotes), all 50 Shipping Activity & History columns (warehouse, departure from origin, arrival, customs and delivery dates) and the Request Estimate List. Before, only carrier, AWB/BoL, INCOTERMS and tracking link came through.",
      "So on fetched data the COP now runs its cost-list, vendor-quote, total-cost, ITN (departure dates) and MARAD checks instead of showing \"No data\" — the same results as dropping the .xlsx export.",
    ],
  },
  {
    version: "2.5.98",
    title: "COP: AES and MARAD worked out from ATLAS",
    notes: [
      "AES / ITN: every US export (US origin, foreign destination) now needs an ITN — decided from the ATLAS route, not the tracker's AES Class column. Hand carry is skipped. The export date is ATLAS \"Departure from Origin Est. Date\", and a shipment with a \"Departure from Origin Act. Date\" (or status Picked Up or later) and no ITN is a hard red. The ITN / NOEEI citation still comes from the Ops Tracker until ATLAS has a field for it.",
      "MARAD (sealift): the due date is now calculated from ATLAS \"Departure from Origin Act. Date\" — 20 working days for cargo leaving the US, 30 for cargo leaving anywhere else (46 CFR 381.3). The submitted date still comes from the Ops Tracker.",
      "Removed the \"AES class matches the route\" check — the route is now the rule.",
      "Ops Tracker: the Closed MTR Tracker tab is read too, so the COP's Closed view shows RFQ, pack, ITN and MARAD results for closed shipments. An RFQ cell with text instead of a date (\"Hand Carry\", \"FEDEX\") counts as no RFQ needed.",
    ],
  },
  {
    version: "2.5.97",
    title: "COP is the hub for Metrics, PMR, Export-Controlled and the Christmas Tree",
    notes: [
      "The menu now starts with one big COP button. Metrics, PMR, Export-Controlled and the Christmas Tree moved inside it as tabs along the top (Pipeline · Metrics · PMR · Export-Controlled · Christmas Tree), so the separate Management / Metrics / Christmas Tree menu entries are gone. Required Attachments (single SRF) moved to the Shipping group.",
      "COP Pipeline: new \"Find metric hits\" picker. It lists every check that's red or amber in the current view with how many shipments miss it — pick one and the table shows just those shipments.",
      "If no Metrics UDQ is loaded, the COP offers Fetch and Browse buttons; the Christmas Tree tab still works on its own UDQs.",
      "Daily updates: the first required update is the business day after the request leaves Draft (not the same day).",
      "The \"Estimate attached\" check is switched off for now (the approved amount is always in the Workflow Logs and the estimate is uploaded as an attachment).",
      "UDQ readers are ready for the Request Estimate List section now being added to every UDQ: Export-Controlled Materials, Required Attachments and the PMR daily check stop at it instead of reading its rows, and section searches look further down long UDQs.",
    ],
  },
  {
    version: "2.5.96",
    title: "Daily updates are required from the day a request leaves Draft",
    notes: [
      "Daily Update Check (Metrics, PMR, Christmas Tree and COP all use the same rule): a daily entry is now required every business day from the business day after the request left Draft until it's delivered. Before, the check only started at the first entry someone made and stopped at the last one, so a slow start or a request that stopped being updated was never counted.",
      "\"Left Draft\" is the request's first Workflow Logs stamp after Draft (Date Submitted is typed in by the requestor and can be months off, so it isn't used). A request that has left Draft but has no daily entries at all is now flagged too.",
      "Nothing is required before 24 Feb 2026, when ATLAS started recording daily updates, and a request delivered before then isn't checked. Open requests are checked through yesterday (today's entry isn't late yet). Requests sent back to Draft, cancelled ones and pre-Oct 2025 deliveries are treated as before.",
      "Expect lower \"clean\" percentages for past quarters where a request's first update came a day or two after it was submitted.",
      "COP: the daily-update check now counts from the same \"left Draft\" stamp (it was using Date Submitted).",
    ],
  },
  {
    version: "2.5.95",
    title: "COP — Common Operational Picture",
    notes: [
      "New: COP. A Metrics UDQ now opens on a picture of every active shipment: eight workflow steps across the top (Draft, TTI Quality Review, DTRA Program Review, DTRA Compliance Review, Estimate, Ready to Ship, In Transit, Delivered) with how many shipments sit in each and how many have a missed (red) or attention (amber) item, and a table of the shipments underneath. Click a step to show only those shipments.",
      "Each shipment has a step-by-step checklist (click its row): what has to be done at each step before it moves on — addresses, POCs and inventory fields at Quality Review; Denied Party Screen and BIS/DDTC authorization after Compliance; RFQ within 1 business day, cost list, CIV and estimate at the Estimate step; PO, final CIV, packing list, SLI/AES, label photo, pallet placard, RC, DG declaration and pack date before pickup; AWB/BoL and VAT in transit; POD, MCT and vendor invoice before close-out. An item still to do in the current step shows as a box; once the shipment has moved past it, a missed required item turns red.",
      "Throughout: daily status updates are required every business day from the moment a request enters TTI Quality Review until delivery; RDD turns amber 5 business days out and red once passed (unless an Approval to Adjust RDD is attached); and each step has a limit on how long a shipment can sit there (Day limits — editable). Rejections, manual metric flags and cost over the approved amount come straight from the Christmas Tree.",
      "Hover over a shipment for its latest daily status update, carrier and AWB/BoL and its open items. The latest update is also a column in the table. Consolidated shipments are tagged and highlight each other.",
      "My shipments / All: pick your name once and the COP shows your shipments; All adds a by-POC grid (shipments per step, red counts) for managers. Filters for TTI POC, RDD, at-risk and stuck. Copy as text, Export (.xlsx with a full checklist tab) and Print / PDF.",
      "Ops Tracker: drop the tracker .xlsx onto the COP (or the main drop zone) to add RFQ Sent, Date Packed, AES / ITN and MARAD checks — including a hard red when a shipment that needs AES has been picked up without an ITN. The last tracker loaded is kept in this browser; load an updated one any time. Also flags shipments active in ATLAS but missing from the tracker, and AES classes that don't match the route.",
      "Closed view lists every completed, invoiced, ready-to-invoice or cancelled shipment with its final checklist.",
      "Settings › Backup now also saves the Christmas Tree acknowledgements, the holiday list, the PMR ignore list, line-item splits and your COP settings.",
    ],
  },
  {
    version: "2.5.94",
    title: "Fetch / UDQ menu; packet saves separate PDFs; faster consolidation fetch",
    notes: [
      "Generate packet: \"Merged PDF\" is now \"Save PDFs\". Each selected document is saved as its own PDF (CI_…, PL_…, Placards_…) instead of one combined file. They print one after another in a single window, already named, and you choose \"Save as PDF\" in each dialog. The Packing List is now a PDF in the packet (it was Excel), including in the .zip download. CI, PL and Placards stay checked by default.",
      "PMR, Export-Controlled Materials and Required Attachments: switching tools and coming back no longer shows a \"from memory\" warning that the fiscal year or quarter was changed from the UDQ value. Those are just report-period choices, not UDQ data, so they aren't remembered or flagged any more. Each tool opens on its normal default period.",
      "The orange ATLAS / UDQ button is now \"Fetch / UDQ\". Opening it shows the WMTR number box straight away, ready to type in. There's no Shipping or Property button to press first, since the lookup already works out whether the number is an SR or a PR. Metrics, the UDQ drop zone and Manual entry are still in the same menu.",
      "Consolidation: adding a WMTR from ATLAS now asks ATLAS for just that one request, the same way the main ATLAS / UDQ button does, instead of downloading the entire Shipping UDQ (every record, about 5 MB) and searching it in the browser. Each WMTR you add now comes back in about the time a single fetch takes. Enter at least 3 digits of the WMTR number.",
      "Commercial Invoice: Shipment Comments can now run to two lines on the CI instead of being cut off after one. Long text wraps onto the second line, and a line break you type in the comments box is kept. Anything past two lines is cut off with \"…\".",
    ],
  },
  {
    version: "2.5.93",
    title: "Inventory Crosswalk: fix \"atob\" error after updating",
    notes: [
      "Fixed: after the 2.5.92 update, converting could fail with \"Failed to execute 'atob'… not correctly encoded\". The browser had paired the new converter with a cached copy of the old template file. The templates now live inside the converter file itself, so the two can't get out of step again. Inventory Crosswalk and Inventory List Export both benefit.",
      "If the app's files are ever out of date again, the tool now says so plainly and asks you to reopen the Utility, instead of showing that error.",
    ],
  },
  {
    version: "2.5.92",
    title: "Inventory tools now use the real SRF template",
    notes: [
      "Fixed: Inventory Crosswalk and Inventory List Export treated SRF and PR as the same layout, because the SRF template they were built from was actually a copy of the PR one. They now use the real Shipping and Delivery (SRF) import template: 45 columns with single Vendor / Manufacturer / Qty / U/M, UN Code, Current Custody Name / Country / City, Comments and Ship Group #.",
      "A PR export dropped into Inventory Crosswalk is now detected as PR (not \"already in SRF format\") and converts to SRF. Inventory List Export on a PR request now builds the real SRF layout.",
      "PR to SRF: Vendor, Manufacturer and U/M take the Actual/Ordered value (or Recommended/Requested when blank), and Qty takes Qty Ordered (or Qty Requested). PR-only columns like Brand Name Only? and Reorder? go to the Crosswalk Carryover tab. Going SRF to PR, the single values fill both sides; UN Code goes to the carryover tab.",
      "Also reads the header spellings in current PR exports (\"Gen. Comments\", \"Temp Storage Req.\", \"Original Wquipment Manu.\").",
    ],
  },
  {
    version: "2.5.91",
    title: "New: Inventory List Export, from a fetched WMTR",
    notes: [
      "New \"Inventory List Export\" tool in both Shipping and Property management. It turns the loaded or fetched WMTR's inventory into an ATLAS Inventory List template (SRF, PR, WS or PMCT), ready to upload into another request.",
      "Defaults to SRF on a Property (PR) WMTR, the usual case of shipping what was procured, and to PR on a Shipping (SRF) WMTR. Pick another format if you need one.",
      "Fills the template from the request's own inventory columns. Combined \"L x W x H\" dimensions are split into the separate Ln / Wd / Ht (in) columns, and dates and Brand Name Only? come through as real dates and checkboxes. Package rows (Serial # = P) on an SRF are left out unless you tick the box to include them.",
      "Anything the chosen template has no column for (e.g. UN Code) is kept on a \"Crosswalk Carryover\" tab, the same as Inventory Crosswalk.",
      "\"Shipping documents\" in the menu is now just \"Shipping\".",
    ],
  },
  {
    version: "2.5.90",
    title: "New: Inventory Crosswalk (General Tools)",
    notes: [
      "New \"General Tools\" section in the menu, with its first tool: Inventory Crosswalk. It converts an ATLAS Inventory List export from one service type to another, so a PR inventory can be uploaded into an SRF, WS or PMCT (and back) without the columns getting jumbled.",
      "Drop one or more inventory exports (or click to browse). The utility detects which template each one is, then you tick the format(s) you want, or All. One result downloads as an .xlsx; several come as a .zip.",
      "PR and SRF use the identical layout, so those two need no conversion. WS and PMCT differ only by PMCT's Transfer Date column. Going PR/SRF to WS/PMCT, Vendor, Manufacturer and U/M take the Actual/Ordered value (or Recommended/Requested when blank), and Qty takes Qty Ordered (or Qty Requested). Going the other way, the single value fills both sides.",
      "Columns with no home in the target (e.g. Brand Name Only?, Lead Time, Property Type, Transfer Date) are kept on a second tab, \"Crosswalk Carryover\". Converting that file again restores them, so a PR to WS to PR round trip loses nothing.",
    ],
  },
  {
    version: "2.5.89",
    title: "Christmas Tree: fetched data now includes Workflow Logs",
    notes: [
      "Fixed: a Christmas Tree fetched from ATLAS reported \"No WMTR in the SRF UDQ carries a Workflow Logs section\", even though the records have them. Fetch now reads each WMTR's Workflow Logs, the same as the Excel export, so the DTRA review dates, the approved estimate amount, the Ready-to-Invoice / Invoiced dates and SRF Cost Estimate Accuracy fill in. Record Audit benefits the same way. Dragging in the Excel export already worked and is unchanged.",
      "New ATLAS UDQ IDs: the Christmas Tree's SRF fetch now uses the new dedicated SRF UDQ, and the Metrics dashboard uses the new Metrics (SRF) UDQ.",
      "Christmas Tree: a WMTR with a metric hit that also has a manual metric note (DTRA-Only Import/Export Comments or Revision Number) now shows in purple instead of red: the cell, the row shading, the ⚑ flag and the card view. Hover the ⚑ to read the note. Red now means a hit with no note to explain it. The hit still counts against the metric percentages; only the color changes.",
      "Manually-entered metric flags can now go in the Revision Number field as well as DTRA-Only Import/Export Comments, which is locked after compliance review. A note in either field flags the WMTR on the Christmas Tree, the Metrics dashboard and Record Audit, and the note is shown as the reason. If both fields have a note, both are shown. Placeholder entries like \"N/A\" or \"-\" don't count as a flag. Six SRF WMTRs currently have \"N/A\" in Revision Number. The drill-down, Excel and PDF exports now label the note \"Manual metric note\".",
      "PR, PMCT and WS fetches now also read each WMTR's Activity Tracker List. The PR \"TTI POC Status Check\" entries drive the Last Update to Activity Tracker and Is Activity Tracker Update Late? columns, so fetched PR records no longer show every WMTR as having no status checks.",
    ],
  },
  {
    version: "2.5.88",
    title: "Property UDQs: Activity Tracker rows no longer show up as inventory",
    notes: [
      "Fixed. In a Property (PR) UDQ export the Activity Tracker List can sit directly under the Inventory List. The utility didn't treat that heading as the end of the inventory, so the Activity Tracker's heading, column titles and status entries (\"TTI POC Status Check\" with a date) were read as extra line items on the Inventory Sheet, DD1149, TOP Documents and CoreIMS export. The inventory now stops at the Activity Tracker.",
      "Fixed: the U/I (unit) column was blank on property documents when ATLAS exports an empty \"Unit Of Measure Ordered\" column alongside a filled \"Unit Of Measure Requested\". The utility now uses the first unit column that actually has values, the same way it already picks the quantity.",
    ],
  },
  {
    version: "2.5.87",
    title: "One fetch button for Shipping and Property",
    notes: [
      "ATLAS / UDQ now has a single \"Shipping or Property\" button instead of separate Shipping and Property buttons. Type the WMTR number and the utility finds which one it is — WMTR numbers are unique across services, so there's nothing to choose.",
      "A bare number (e.g. 10097) searches Shipping and Property at the same time and loads whichever has it. A full WMTR ending in -SRF or /PR goes straight to the right one. If a partial number matches several requests, the pick list labels each one SR or PR.",
      "Fixed along the way: typing a full WMTR (rather than just the number) could come back \"not found\", and choosing from the pick list could fail the same way — ATLAS's search matches only the request number. Both now work. If Shipping or Property can't be searched (for example a permissions error), the utility says which one and asks you to confirm instead of loading the other's closest match.",
      "Metrics is unchanged (it still pulls every record).",
    ],
  },
  {
    version: "2.5.86",
    title: "Signer picks itself again; details forms start folded",
    notes: [
      "Fixed: the Commercial Invoice ignored the Default signer from Settings and always started blank. The Commercial Invoice, Packing List and Packet now all start with the Settings \"Default signer\" when one is set.",
      "New: when no Default signer is set, those three documents start with whoever you picked last on any of them — on any shipment — instead of blank.",
      "The \"Step 1 · Enter details\" section of the Commercial Invoice, Packing List, Placards and RFQ Email now starts folded, so the preview is right there. Click the Step 1 bar to open or close it; once opened it stays open while you work. The RFQ's Requested response date stays visible even when folded. Folded fields still feed the documents, and a section opens by itself if any field in it is flagged FROM MEMORY.",
    ],
  },
  {
    version: "2.5.85",
    title: "RFQ Email works offline again",
    notes: [
      "Fixed. The app's offline copy listed an older version of the RFQ Email tool than the one the page actually loads, so the RFQ tool wasn't saved for offline use. It's now saved with everything else, and every other tool was checked and already matched.",
    ],
  },
  {
    version: "2.5.84",
    title: "Commercial Invoice: cleaner design",
    notes: [
      "The Commercial Invoice has a cleaner look. Same layout, same content, same page breaks — only the styling changed.",
      "Heavy black boxes are now soft outlines with slightly rounded corners, labels are small spaced capitals on a light tint, and the top grid has dividers so its fields no longer run together.",
      "The line-item table has light row lines and gentle alternate-row shading so rows are easier to follow across the page. The totals sit in one tidy band, and Printed Name, Signature, Title and Date now have lines to write on.",
      "Every page still fits on one landscape sheet; dense invoices are, if anything, a hair shorter than before. The red customs declaration is unchanged. The soft shading now prints the way it looks on screen.",
    ],
  },
  {
    version: "2.5.83",
    title: "Override any UDQ value on every document — or build documents with no UDQ at all",
    notes: [
      "Every Shipping and Property document now has an \"Override UDQ values\" bar at the top: Packet, CI, Packing List, Placards, SLI, RFQ, IPC, DD1149, TOP Documents, CoreIMS and the Inventory Sheet. Before, only the CI and Placards had it.",
      "The most common fixes come first: all six party blocks (organization, address, city/state/ZIP, country, POC name, phone, e-mail, and Tax ID on Shipping), plus the CI's payment terms and IncoTerms. Each field shows the UDQ value in grey. Leave it blank to keep that value, or type a single \"-\" to print the field blank.",
      "\"Every other field\" opens the rest: every shipment detail the documents print (WMTR, title, contract #, countries, mode, special handling, NLT date, total packages, gross weight, volume and so on) and a full line-item table. Switch the table on and it starts as a copy of the UDQ items, which you can edit, add to or delete. Packages and package weights are still set in Manual Parents, which the dialog links to.",
      "New: Manual entry. ATLAS / UDQ ▸ \"No UDQ? Manual entry\" starts a blank request. Type in the details once and every Shipping and Property document can be generated from them with no UDQ loaded; the line-item table has one column per value, and the CoreIMS-only columns are labelled. Enter a WMTR number and the entry is saved under it — together with its packages — so you can pick it up again later. The picker at the top of the form opens a saved entry or starts a new blank one, and clicking \"No UDQ? Manual entry\" again just reopens the form. Audit and Required Attachments stay off in manual entry because they read the UDQ spreadsheet itself.",
      "While WMTRs are consolidated, the line-item table is paused (it describes one WMTR); your saved table comes back when consolidation is turned off.",
      "Document forms now remember only the fields you actually changed, and never remember dates — every date starts at its normal default (usually today). A field still showing its pre-filled value (for example the DD1149 consignee block) picks up the latest value, including a new override, instead of an old remembered one.",
      "Anything filled in from memory is now impossible to miss. When a remembered value doesn't match the UDQ (or the form's default), the field is outlined in yellow and a yellow FROM MEMORY banner at the top of the document lists each one beside the UDQ value, with a one-click \"Use UDQ value\" (or \"Use UDQ values for all\"). Saved manual overrides get the same yellow list on the dashboard and on every document, showing only the values that actually differ from the UDQ.",
      "Overrides are still saved per WMTR and come back when you reopen the UDQ. Overrides you saved before this version carry over.",
      "Fixed: manual details saved for one WMTR could carry over onto the next UDQ you loaded.",
    ],
  },
  {
    version: "2.5.82",
    title: "Packing List shows weights in both units",
    notes: [
      "In Imperial view, every weight on the Packing List now shows kilograms in parentheses after pounds — for example \"1,250 lbs (566.99 kg)\". In Metric view it's the reverse: \"566.99 kg (1,250 lbs)\".",
      "This covers each package's gross weight, the gross weight summary at the top, and the totals at the bottom — in the preview, the printout and the Excel download.",
    ],
  },
  {
    version: "2.5.81",
    title: "Purchase Orders can be issued in any currency",
    notes: [
      "Both Purchase Order forms (Shipping and Property Management) have a new Currency dropdown. USD is still the default; the common currencies (EUR, GBP, CAD, AUD, JPY, CHF, KRW, SGD, AED) are listed first, followed by every other ISO currency.",
      "The price prints on the PO in the chosen currency — for example \"EUR €4,250.50\", \"JPY ¥425,000\" or \"CHF 4,250.00\" — in the preview, the PDF, the Word file and the print view. Currencies that don't use cents (JPY, KRW) print without decimals.",
      "For a non-USD PO, an \"Approx. USD value\" box appears. It's required, isn't printed, and is what the $50,000 / $100,000 approval warnings check against, so a ¥600,000 PO doesn't trigger a CFO warning meant for $600,000.",
    ],
  },
  {
    version: "2.5.80",
    title: "Cost accuracy now scores against the latest approval, not the first one",
    notes: [
      "Fixed. When a request's cost went up and DTRA re-approved it at the new figure, the Utility kept comparing the actual cost to the ORIGINAL approved estimate — so a properly re-approved request reported as a >10% overrun forever. It was reading the oldest \"DTRA Estimate Review (Approved)\" entry in the workflow instead of the newest.",
      "SRF and PR Cost Estimate Accuracy, and the tracker's own cost flags, now score against the governing approval: the most recent approval entry that carries a cost. A request re-approved at $13,000 whose actual is $13,000 now passes at 0% instead of failing at 23%. One that was re-approved at $13,000 but ran to $16,000 still flags — at 19% against the revision, not 37% against the original figure.",
      "The same fix applies to in-flight requests. \"Cost exceeds DTRA-approved amount — reapproval needed\" no longer fires on a request that has already been re-approved at the higher cost.",
      "Flag wording now names which figure it used, so \"Revised estimate vs. actual off by 19%\" and \"Estimate vs. actual off by 23%\" are told apart in the drill-down and both summary exports. The Audit window agrees, marking the original-estimate line as superseded and scoring on the revision.",
      "The two tracker columns are unchanged: \"Estimate vs. Actual %\" still reports the original approval and \"Revised Estimate vs. Actual %\" the revision, exactly as the Christmas Tree workbook lays them out. Only the scoring changed. Requests that were never re-approved score exactly as before.",
    ],
  },
  {
    version: "2.5.79",
    title: "Christmas Tree: the daily-update metric was being blanked, and dashed rows now explain themselves",
    notes: [
      "Fixed a real bug. The rollup scored delivery timeliness and daily status updates from a single run of the PMR engine. That engine refuses to run when the SRF UDQ is missing any of the eight columns it requires (Country of Destination, CTR Program, Value of Cargo, and so on) — and when it refused, it took the daily-update score down with it, even though the daily check doesn't use any of those columns. The row just showed dashes.",
      "Daily updates are now scored on their own pass over the SRF UDQ, reading each WMTR's \"Daily Status History\" section directly. A UDQ missing a delivery-only column now scores daily updates normally, with the same business-day gap rules and the same click-through to the offending days as before.",
      "Checked the three cost/estimate metrics too — SRF Cost Estimate Accuracy, PR Cost Estimate Submitted ≤3 Business Days, and PR Cost Estimate Accuracy. Their math is correct; they dash only when the data genuinely isn't there. All three read their dates and the DTRA-approved amount out of each WMTR's Workflow Logs, so a UDQ exported without that section blanks them, and the two PR lines need the PR UDQ loaded.",
      "So a dashed row no longer leaves you guessing. The panel now names the reason: the service UDQ isn't loaded, its Workflow Logs section is missing, the approved-estimate cost isn't recorded on the workflow entry, no Daily Status History section is present, or the delivery metric is missing a specific column. \"Nothing to report\" and \"couldn't check\" finally look different.",
      "The flagged-records list under the rollup table now shows the request's TTI POC next to the reason it was flagged, so you can see who to chase without cross-referencing the tracker. Records with no POC on them say so rather than showing a blank.",
      "It also prints whatever is in the DTRA-Only Import/Export Comments field — the field currently used to capture manual metric notes — in a highlighted box under the reason, labelled with the field it came from. The note is left off the \"Manually-entered Metrics\" row, where it's already the reason, so it never prints twice. Both the TTI POC and the comments are new columns on the Excel summary and new fields on the PDF summary.",
    ],
  },
  {
    version: "2.5.78",
    title: "Packing List can print a third address block",
    notes: [
      "New \"Consignee details\" dropdown on the Packing List, next to Ship From and Ship To. Leave it on \"Don't include\" (the default) and nothing changes. Pick Ultimate Consignee, Intermediate Consignee or End User and that party prints as a third address block, so a request where the delivery destination isn't the party that ultimately takes the goods can show both instead of making you choose one.",
      "The PDF and the preview put the three side by side across the route strip — Ship From → Ship To → the consignee. The Excel export keeps Ship From / Ship To where they are and adds the consignee as a full-width band underneath, because the right-hand columns are too narrow to hold an address.",
      "If the party you pick is blank in the UDQ, the block is left off rather than printing an empty box; the dropdown marks which parties are blank. The legacy spreadsheet export is unchanged — its template has no room for a third block.",
    ],
  },
  {
    version: "2.5.77",
    title: "Audit — a close-out checklist for the request you have open",
    notes: [
      "New \"Audit\" button at the bottom of the Shipping documents list. Pull up a request, press it, and you get the Christmas Tree's checks run against that one WMTR — QC rejections, shipping documents attached, AWB/BoL, daily status updates, delivery vs. RDD, cost against the DTRA-approved amount, and the Ready-to-Invoice / Invoiced milestones. It's the list the TTI POC who owns the request can walk before calling it done.",
      "Each line says where it stands, not just whether it failed: Action needed, Due soon, Not yet due, Clear, or No data. So a request still in flight reads as a to-do list rather than a wall of red.",
      "The failures come from the Christmas Tree's own engine and the Required Attachments rules — same rules, same wording — so the single-record audit and the tracker can never disagree. Anything you've already acknowledged in the Christmas Tree shows here as acknowledged. Copy and Export (.xlsx) buttons are underneath.",
    ],
  },
  {
    version: "2.5.76",
    title: "Inventory Sheet previews before it downloads",
    notes: [
      "Both versions now show the sheet on screen first instead of dropping a file straight into Downloads. On a shipping request the Inventory Sheet button opens a preview panel below the Packing List; on a property request the preview is the window itself. Download Excel is a separate button underneath.",
      "The warehouse write-in columns are now optional on the shipping version — a dropdown switches between \"Include RC/RCR # and Date Arrived\" (the default, for a sheet the warehouse fills in) and \"Leave them off\", which gives a narrower status-only sheet to send a customer. The preview updates as you switch.",
      "The property version drops those two columns entirely. A PR sheet reports what has arrived; it isn't a form to write on.",
    ],
  },
  {
    version: "2.5.75",
    title: "Inventory Sheet now works from Property Management UDQs too",
    notes: [
      "Property (PR) UDQs get their own \"Inventory Sheet\" window under Property management, producing the same document the Packing List window produces for shipping requests — identical layout, identical green/red rules. A PR UDQ already carries Quantity Requested and Quantity Received as separate columns, so both feed the sheet directly.",
      "Those two quantities are now read separately for PR UDQs. DD1149 and TOP Documents still collapse them into the single quantity they've always used, so nothing about those documents changed — the Inventory Sheet just reads the columns on its own terms.",
      "A PR UDQ carrying only one quantity column still works: that value becomes Qty Requested and the received column stays blank.",
    ],
  },
  {
    version: "2.5.74",
    title: "Inventory Sheet now shows what has actually arrived",
    notes: [
      "The sheet reads the UDQ's \"Qty Received\" column. Columns are now #, Description, Model #, U/I, Qty Requested, Qty Received, RC/RCR # and Date Arrived — U/I moved ahead of the quantities, and the old \"Qty\" is now \"Qty Requested\".",
      "Qty Received is color-coded: dark green when the full requested quantity has arrived, red when the counts don't match (short or over). A blank or zero received quantity leaves the cell empty rather than printing a 0, so a sheet handed to the warehouse before anything ships still reads as a clean checklist. The summary strip gained a Total Qty Received figure next to Total Qty Requested.",
      "That makes one sheet serve three jobs: a heads-up of what's inbound, a worksheet for the warehouse's own inventory count, and a status page you can send a customer asking what has arrived so far.",
      "Older UDQs without a \"Qty Received\" column still load — those lines simply show blank.",
    ],
  },
  {
    version: "2.5.73",
    title: "Inventory Sheet no longer stops for missing compliance data",
    notes: [
      "The Inventory Sheet was running the same hard-block validation as the shipping documents, so a request with ECCNs but no license or exception data refused to export. That check exists to keep incomplete export paperwork from going out — but the Inventory Sheet is an internal receiving list with no ECCN, license, HTS or hazmat fields on it, so none of it applies. The sheet now exports regardless. The Packing List, Commercial Invoice and the rest are unchanged and still validate as before.",
    ],
  },
  {
    version: "2.5.72",
    title: "New: Inventory Sheet for the warehouse",
    notes: [
      "The Packing List window (now \"Packing List/Inventory\" on the menu) has a new dark \"Inventory Sheet (.xlsx)\" button alongside the existing exports. It builds a receiving sheet the warehouse can work from — same look as the Packing List, but a pre-packing document: no ship-from/ship-to block, no HS codes, no package rows and no signature block. Just a flat, numbered list of every line item with Description, Model #, Qty and U/I.",
      "Each line ends in two blank write-in columns — RC/RCR # (the warehouse receipt number) and Date Arrived — so the sheet doubles as the tracker for what has actually shown up. Excel only; the PDF and Excel buttons next to it still produce the Packing List as before.",
    ],
  },
  {
    version: "2.5.71",
    title: "RFQ email: signature should land at the bottom, not mid-message",
    notes: [
      "Outlook was dropping the signature between the intro text and the RFQ details table. The email ended with the table and had no paragraph after it, so Outlook attached the signature to the last paragraph it could find — the intro. Two blank paragraphs now sit below the table to give it somewhere to go at the bottom.",
    ],
  },
  {
    version: "2.5.70",
    title: "Christmas Tree: missed days are named, and the Ignored list now counts",
    notes: [
      "A WMTR flagged for missing daily updates used to say only how many business days were missed. It now lists the actual dates — e.g. \"3 missing business days: Aug 4, 5; Sep 1\" — so there's no need to go hunting for them. The dates carry through to the drill-down list and to both Summary exports (.xlsx and .pdf).",
      "Putting a record on the Ignored list now also clears it from the metrics rollup. It used to only hide the flag in the tracker, so the record kept counting against the red/yellow percentages. An ignored record now scores as a pass for that metric and still counts in the totals — the request is included, it just isn't held to the requirement you've relieved it of. The panel header and the note underneath say how many results were scored this way, so a relieved 100% is never silent.",
      "Shipment Tracking (AWB/BoL) was added to the Ignore dropdown. It's a scored metric but previously couldn't be ignored on its own — only via \"All metrics\".",
    ],
  },
  {
    version: "2.5.69",
    title: "\"N/A\" no longer counts as hazmat data; RFQ date stops going stale",
    notes: [
      "A UN Code or hazard class of \"N/A\", \"None\", \"-\", \"NIL\" or \"TBD\" is now read as blank instead of as a real classification. Those lines no longer raise \"UN code with no hazard class\" errors, no longer appear in the Dangerous Goods panel, and no longer inflate the \"items flagged with hazmat data\" count. A genuine UN code paired with an \"N/A\" hazard class still shows as an incomplete classification, which is the case worth catching.",
      "The RFQ's Requested Response Date now always opens on tomorrow's date. It used to be remembered per WMTR, so re-opening an RFQ started days earlier brought back that old date — already in the past.",
      "Checked the SLI's $2,500 listing rule against the Foreign Trade Regulations again. No change was needed: the domestic/foreign split under a single Schedule B number is handled correctly, and the Country Group E:1 rule is right. Comments in the code now cite the exact provisions.",
    ],
  },
  {
    version: "2.5.68",
    title: "RFQ cargo-insurance line is now conditional",
    notes: [
      "The RFQ email's quote checklist used to ask every vendor for cargo insurance outright. It now reads \"When requested, cargo insurance in accordance with FAR 52.247-22 and DFARS 252.247-7007\" — the same FAR/DFARS citations, but it no longer implies insurance is required on every shipment.",
    ],
  },
  {
    version: "2.5.67",
    title: "Compliance Search paused — bundled TRLS history removed",
    notes: [
      "The TRLS I and TRLS II history that shipped with the app has been removed. It was stored in the app's own JavaScript, which meant the request titles, ITAR/USML categories, serial numbers and vendor detail it contained could turn up in a plain search of the site's files. None of that data is in the app any more.",
      "Compliance Search is hidden from the tool menu while there's no bundled dataset behind it. Nothing else changed — every other tool works exactly as before. The tool can be switched back on if a sanitized dataset is built later.",
    ],
  },
  {
    version: "2.5.66",
    title: "SLI $2,500 rule fixed — domestic/foreign split now handled correctly",
    notes: [
      "The SLI generator was over-listing commodity lines. When a single Schedule B number was split into a domestic and a foreign line, it added the two together before applying the $2,500 test, so a small line (e.g. a $322 domestic portion) got listed just because the foreign portion under the same number was large. Under 15 CFR 30.37(a) the $2,500 threshold applies to each origin separately, so those small lines are now correctly dropped and the \"remaining Schedule B/HTS $2,500 or less, not listed\" box (26) ticks itself when that happens.",
      "Added a safeguard for embargoed destinations: shipments to Country Group E:1 (Cuba, Iran, North Korea, Syria) now list every commodity line regardless of value, since the $2,500 exemption doesn't apply to those countries.",
    ],
  },
  {
    version: "2.5.65",
    title: "New signatory + PO approval prompts over $50k / $100k",
    notes: [
      "Shawn Ryan (Transportation Coordinator) was added to the Printed Name / signatory dropdown, so she's selectable on every document that has one (DD1149, SLI, packing lists, POs, etc.).",
      "Issuing a Purchase Order now runs a spend check first. Over $50,000, a prompt asks you to confirm the TRLS II PM or DPM has approved the PO; over $100,000, it instead asks you to confirm the TTI CFO approved it. Cancel stops the PO from being generated; $50,000 and under is unaffected. The check runs on both the shipping and property POs and on all three outputs (PDF, Word, Print).",
    ],
  },
  {
    version: "2.5.64",
    title: "RFQ — auto-fill EAR/ITAR, dangerous goods & temperature control from the UDQ",
    notes: [
      "The RFQ used to make you hand-select dangerous goods and temperature control and type the comments. Now the utility reads them straight from the request: EAR/ITAR ticks the boxes and lists the ECCN/USML codes it found; Dangerous goods flips to Yes and lists the UN numbers and hazard classes (e.g. “UN1263 (Class 3)”); Temperature control flips to Yes and pulls the requirement text (ambient/room-temp counts as No). A short “Auto-detected …” note under each shows exactly what was pulled, and every value is still yours to override before drafting.",
    ],
  },
  {
    version: "2.5.63",
    title: "SLI — pull the Freight Location straight from the request",
    notes: [
      "The SLI's Freight location dropdown now offers “Origin Address” and “Pickup Location” alongside the saved locations and “Other (manual)”. Pick one and the Freight Location name/address (and the State of Origin) fill in automatically from the request's Shipment Origin or Pickup Location party — no retyping. The two options only appear when the request actually has that address; anything the request can't supply (e.g. a missing state) is highlighted yellow for you to check.",
    ],
  },
  {
    version: "2.5.62",
    title: "Commercial Invoice — pick a currency (no longer USD-only)",
    notes: [
      "The CI now has a Currency dropdown (defaults to USD). Whatever you pick labels the “Total Value” line on page 1 and the “Subtotal” strip on continuation pages — e.g. “Total Value (EUR)”. The amounts themselves aren’t converted; the invoice just states which currency they’re in.",
    ],
  },
  {
    version: "2.5.61",
    title: "Landing page — file hint now mentions .xlsm",
    notes: [
      "The drop-zone hint said the browse button only took .xlsx, but the picker has always accepted .xlsm too. Updated the text to read “.xlsx or .xlsm” so nobody assumes a macro-enabled ATLAS export is unsupported.",
    ],
  },
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
