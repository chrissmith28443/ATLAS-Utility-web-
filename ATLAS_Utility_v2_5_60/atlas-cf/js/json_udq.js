/* =========================================================================
   ATLAS Utility Web — json_udq.js
   Fetch UDQ data straight from the ATLAS API and feed it through the SAME
   pipeline as a dropped .xlsx export.

   HOW IT WORKS (and why it's low-risk):
     1. ATLAS /api/UDQ/{id} returns a LIST of WMTR records (named JSON fields
        + nested inventory / attachment / shipping-activity / linked-request
        arrays).
     2. atlasRecordsToGrid() rebuilds the EXACT array-of-arrays "grid" layout
        that ATLAS's Excel export produces (row-1 headers, row-2 values, the
        indented Inventory List / Attachment List / Shipping Activity & History
        / Daily Status History / Linked Request List sub-sections).
     3. atlasGridToXlsxBuffer() writes that grid to an in-memory .xlsx with
        SheetJS, and we hand it to the existing loadFile() untouched.
   => Every reader and tool (detectUdqType, readUdq, PMR, ECM, Required
      Attachments, the metrics dashboard, file naming, etc.) behaves byte-for-
      byte the same as it does for a real ATLAS export. No tool code changes.

   ONE COMBINED UDQ serves BOTH uses:
     - "Metrics"  -> build the full multi-WMTR grid (detects as "metrics").
     - "Shipping" -> slice the single WMTR the user enters, build a one-block
                     grid (detects as "srf"), then all SRF document tools run.

   Sections intentionally NOT rebuilt (no current tool reads them, keeps the
   in-browser grid smaller): "Cost List" and "Workflow Logs". If a future
   feature needs Workflow Logs, add a builder below and they'll flow through.
   ========================================================================= */

/* -------------------------------------------------------------------------
   CONFIG — UDQ IDs are environment-specific. Swap `env` to 'prod' and fill
   the prod IDs at publish time; nothing else needs to change.
   ------------------------------------------------------------------------- */
const ATLAS_UDQ_CONFIG = {
  env: "qa",                 // 'qa' | 'prod'
  baseUrl: "/api/UDQ",       // same-origin: rides the existing ATLAS session cookie.
                             // (Leave relative so there's no cross-origin/CORS issue
                             //  once the utility is published inside ATLAS. To test
                             //  against another host, set absoluteOrigin below.)
  absoluteOrigin: "",        // e.g. "https://qa-atlas.azurewebsites.net" — optional override.

  ids: {
    qa: {
      // The Metrics UDQ carries every WMTR's full detail — the combined, all-WMTR
      // dataset the Metrics dashboard and the Christmas Tree read.
      metrics:  "f3e5981e-bd54-4bb5-8b4b-3321a2c19568",
      // Shipping now has its OWN dedicated UDQ (it is no longer the same ID as
      // Metrics). A single shipment is still narrowed SERVER-SIDE via
      // requestNumberParam ("requestNumber") so it pulls ~1 record instead of the
      // whole UDQ; the client re-checks the result and shows the picker on any
      // multi-match.
      shipping: "b33fe12e-6e1f-4b25-b296-d77d0b8cf6d1",
      // Property (PR) also pulls the FULL property dataset from ATLAS (all
      // records, not a single request); the utility filters to the entered
      // WMTR / PR number client-side, exactly like Shipping.
      property: "75abb665-d493-47ab-be82-20210a09282c",
      // Christmas Tree pulls per-service UDQs in one action. SRF tracks the
      // Metrics UDQ (same combined dataset); PR / PMCT / WS have their own.
      christmasTree: {
        srf:  "f3e5981e-bd54-4bb5-8b4b-3321a2c19568",     // = Metrics UDQ (kept in sync)
        pr:   "d7636e76-d298-4e73-8a78-39848a88d0e7",
        pmct: "3f12340c-0b35-4e1d-a32c-3ae1385d425a",
        ws:   "7ce9dfef-82ee-43f2-9c24-8105a10ee909",
      },
    },
    prod: {
      metrics:  "",          // TODO: fill production UDQ IDs at publish
      shipping: "",
      property: "",
      christmasTree: { srf: "", pr: "", pmct: "", ws: "" }, // TODO: fill at publish
    },
  },

  // Server-side single-record filter. ATLAS (v2026.07) accepts ?requestNumber=<n>
  // on /api/UDQ/{id}; it's a CONTAINS match on the request number, which is the
  // numeric segment of the WMTR (e.g. requestNumber=10223 -> WMTR-26-1-P-RO-10223-SRF,
  // requestNumber=10226 -> WMTR-26-1-P-RO-10226/PR). Confirmed to work across ALL
  // service modules (SRF / PR / PMCT / WS). A BLANK value returns the FULL dataset
  // (verified byte-identical to omitting the param), so we only ever append it when
  // a value is present. The filtered record carries full nested detail
  // (inventory / attachments / activity / linked requests), so it flows through the
  // grid builders identically to a client-side slice — but pulls ~1 record (~19 KB)
  // instead of the whole UDQ (~5 MB / 187 records). Shipping AND Property both append
  // ?<param>=<wmtr>; results are still re-checked client-side and, if the filter is
  // broad enough to return more than one record, the WMTR picker is shown. Set to
  // null to revert both to the full-pull + client-slice paths.
  requestNumberParam: "requestNumber",
};

/* Minimum number of digits a shipping WMTR/request-number entry must contain
   before we fire a server query. "requestNumber" is a CONTAINS match, so a
   1–2 digit entry could match a large slice of the dataset; 3 keeps searches
   specific while still allowing the "last 3 digits" shorthand (a 3-digit entry
   that still resolves to several records simply drops into the picker). Tune or
   raise to 5 to require the full WMTR sequence. */
const ATLAS_MIN_REQUEST_DIGITS = 3;

/* Built-in IDs for the active environment (hard-coded in ATLAS_UDQ_CONFIG above). */
function atlasBuiltinIds() { return ATLAS_UDQ_CONFIG.ids[ATLAS_UDQ_CONFIG.env] || {}; }

/* Per-environment overrides the user entered in Settings ▸ ATLAS data source,
   if any. Stored per-env so QA and prod overrides never collide. A blank/absent
   field means "use the built-in default", so the hard-coded IDs stay the source
   of truth and Settings is purely a no-redeploy override for this browser. */
function atlasIdOverrides() {
  try {
    if (typeof AtlasSettings === "undefined") return {};
    const all = AtlasSettings.get().udqIds || {};
    const env = all[ATLAS_UDQ_CONFIG.env];
    return (env && typeof env === "object") ? env : {};
  } catch (e) { return {}; }
}

/* Effective IDs = built-in defaults with any non-blank Settings override applied.
   Every consumer (property / shipping / metrics / Christmas Tree) reads through
   here, so a Settings change takes effect on the next fetch — no reload. */
function atlasIds() {
  const base = atlasBuiltinIds();
  const ov = atlasIdOverrides();
  const pick = (k) => (String(ov[k] != null ? ov[k] : "").trim() || String(base[k] || "").trim());
  const bct = base.christmasTree || {};
  const oct = (ov.christmasTree && typeof ov.christmasTree === "object") ? ov.christmasTree : {};
  const pickCt = (k) => (String(oct[k] != null ? oct[k] : "").trim() || String(bct[k] || "").trim());
  return {
    metrics:  pick("metrics"),
    shipping: pick("shipping"),
    property: pick("property"),
    christmasTree: { srf: pickCt("srf"), pr: pickCt("pr"), pmct: pickCt("pmct"), ws: pickCt("ws") },
  };
}
/* Effective API base URL. Built-in default = absoluteOrigin + baseUrl from
   ATLAS_UDQ_CONFIG; a per-env override from Settings ▸ ATLAS data source
   ("Adjust API settings…") replaces the WHOLE base when present. The override
   may be a relative path ("/api/UDQ") or an absolute origin+path
   ("https://qa-atlas.azurewebsites.net/api/UDQ") — same shapes the built-in
   config supports. Blank/absent => built-in, so the hard-coded config stays
   the source of truth and Settings is a no-redeploy override for this browser. */
function atlasApiBase() {
  let ov = "";
  try {
    if (typeof AtlasSettings !== "undefined") {
      const all = AtlasSettings.get().udqApi || {};
      ov = String(all[ATLAS_UDQ_CONFIG.env] || "").trim();
    }
  } catch (e) { ov = ""; }
  const base = ov || ((ATLAS_UDQ_CONFIG.absoluteOrigin || "").replace(/\/$/, "") +
                      ATLAS_UDQ_CONFIG.baseUrl);
  return base.replace(/\/+$/, "");
}
function atlasUdqUrl(id, extraQuery) {
  let url = atlasApiBase() + "/" + encodeURIComponent(id);
  if (extraQuery) url += (url.includes("?") ? "&" : "?") + extraQuery;
  return url;
}

/* -------------------------------------------------------------------------
   FIELD MAPS — verified 1:1 against the example UDQ + its matching Excel
   export (June 2026). Header strings must match the ATLAS export exactly;
   the readers key off them.
   ------------------------------------------------------------------------- */

/* Shipment-level scalar columns, in Excel column order (col A = WMTR Number). */
const ATLAS_SCALAR_COLUMNS = [
  ["GMTRNumber", "WMTR Number"],
  ["TopRequiredDisplay", "Transfer of Property (TOP) Required?"],
  ["TopRequiredComments", "TOP Comments"],
  ["DateSubmitted", "Date Submitted"],
  ["CompletedDate", "Date Completed"],
  ["RequestTitle", "Request Title"],
  ["GmtrStatus", "Status"],
  ["RedFlag", "Red Flag"],
  ["RedFlagComments", "Red Flag Comments"],
  ["RequestorRef", "Requestor Ref.#"],
  ["NLTCompletionDate", "NLT Completion Date"],
  ["ManualStatusChangeDate", "Original RDD"],
  ["CTRProgram", "CTR Program"],
  ["CountryofOrigin", "Country of Origin"],
  ["CTRCountryOrProject", "CTR Country"],
  ["CountryofDestination", "Country of Destination"],
  ["ContractNumText", "Contract #"],
  ["TotalCostofService", "Total Cost in USD"],
  ["ContractCORName", "Contract COR Name"],
  ["ContractCOREmail", "Contract COR Email"],
  ["ContractCORPhone", "Contract COR Phone Number"],
  ["CTRProjectManagerName", "CTR Project Manager Name"],
  ["CTRProjectManagerEmail", "CTR Project Manager Email"],
  ["CTRProjectManagerPhone", "CTR Project Manager Phone Number"],
  ["RequestorName", "Requestor Name"],
  ["RequestorEmail", "Requestor Email"],
  ["RequestorPhone", "Requestor Phone Number"],
  ["TTIPOCName", "TTI POC Name"],
  ["TTIPOCEmail", "TTI POC Email"],
  ["TTIPOCPhone", "TTI POC Phone Number"],
  ["TTIAlternatePOCName", "TTI Alternate POC Name"],
  ["TTIAlternatePOCEmail", "TTI Alternate POC Email"],
  ["TTIAlternatePOCPhone", "TTI Alternate POC Phone Number"],
  ["PurposeOrRequestSummary", "Purpose/Request Summary"],
  ["GeneralComments", "General Comments"],
  ["ProgramReviewComments", "Program Review Comments"],
  ["ExportComplianceComments", "Export Compliance Comments"],
  ["Requirements_GeneralComments", "General Comments (Requirement)"],
  ["PickupLocationOrganization", "Pickup Location Organization"],
  ["PickupLocationOrganizationAddress", "Pickup Location Organization Address"],
  ["PickupLocationOrganizationAddress1", "Pickup Location Organization Address1"],
  ["PickupLocationOrganizationCountry", "Pickup Location Organization Country"],
  ["PickupLocationOrganizationState", "Pickup Location Organization State"],
  ["PickupLocationOrganizationCity", "Pickup Location Organization City"],
  ["PickupLocationOrganizationZip", "Pickup Location Organization Zip"],
  ["PickupLocationOrganizationPOCName", "Pickup Location Organization POC Name"],
  ["PickupLocationOrganizationEmail", "Pickup Location Organization Email"],
  ["PickupLocationOrganizationCell", "Pickup Location Organization Cell"],
  ["ShipmentOriginOrganization", "Shipment Origin Organization"],
  ["SOAddress", "Shipment Origin Organization Address"],
  ["SOAddress1", "Shipment Origin Organization Address1"],
  ["SOCountry", "Shipment Origin Organization Country"],
  ["SOState", "Shipment Origin Organization State"],
  ["SOCity", "Shipment Origin Organization City"],
  ["SOZip", "Shipment Origin Organization Zip"],
  ["SOPOCName", "Shipment Origin Organization POC Name"],
  ["SOEmail", "Shipment Origin Organization Email"],
  ["SOCell", "Shipment Origin Organization Cell"],
  ["DeliveryDestinationOrganization", "Delivery Destination Organization"],
  ["DDOAddress", "Delivery Destination Organization Address"],
  ["DDOAddress1", "Delivery Destination Organization Address1"],
  ["DDOCountry", "Delivery Destination Organization Country"],
  ["DDOState", "Delivery Destination Organization State"],
  ["DDOCity", "Delivery Destination Organization City"],
  ["DDOZip", "Delivery Destination Organization Zip"],
  ["DDOPOCName", "Delivery Destination Organization POC Name"],
  ["DDOEmail", "Delivery Destination Organization Email"],
  ["DDOCell", "Delivery Destination Organization Cell"],
  ["UltimateConsigneeOrganization", "Ultimate Consignee Organization"],
  ["UCDAddress", "Ultimate Consignee Organization Address"],
  ["UCDAddress1", "Ultimate Consignee Organization Address1"],
  ["UCDCountry", "Ultimate Consignee Organization Country"],
  ["UCDState", "Ultimate Consignee Organization State"],
  ["UCDCity", "Ultimate Consignee Organization City"],
  ["UCDZip", "Ultimate Consignee Organization Zip"],
  ["UCDPOCName", "Ultimate Consignee Organization POC Name"],
  ["UCDEmail", "Ultimate Consignee Organization Email"],
  ["UCDCell", "Ultimate Consignee Organization Cell"],
  ["IntermediateConsigneeOrganization", "Intermediate Consignee Organization"],
  ["ICOAddress", "Intermediate Consignee Organization Address"],
  ["ICOAddress1", "Intermediate Consignee Organization Address1"],
  ["ICOCountry", "Intermediate Consignee Organization Country"],
  ["ICOState", "Intermediate Consignee Organization State"],
  ["ICOCity", "Intermediate Consignee Organization City"],
  ["ICOZip", "Intermediate Consignee Organization Zip"],
  ["ICOPOCName", "Intermediate Consignee Organization POC Name"],
  ["ICOEmail", "Intermediate Consignee Organization Email"],
  ["ICOCell", "Intermediate Consignee Organization Cell"],
  ["EndUserOrganization", "End-User Organization"],
  ["EUOAddress", "End-User Organization Address"],
  ["EUOAddress1", "End-User Organization Address1"],
  ["EUOCountry", "End-User Organization Country"],
  ["EUOState", "End-User Organization State"],
  ["EUOCity", "End-User Organization City"],
  ["EUOZip", "End-User Organization Zip"],
  ["EUOPOCName", "End-User Organization POC Name"],
  ["EUOEmail", "End-User Organization Email"],
  ["EUOCell", "End-User Organization Cell"],
  ["EstTotalCargoVolume", "Est. Total Cgo Volume"],
  ["FinalTotalCargoVolume", "Final Total Cgo Volume"],
  ["EstTotalCargoWeight", "Est. Total Cgo Weight"],
  ["FinalTotalCargoWeight", "Final Total Cgo Weight"],
  ["TotalValueOfCargo", "Value of Cargo (USD)"],
  ["ShipmentType", "Shipment Type"],
  ["IdentifyShipmentAs", "Identify Shipment As"],
  ["TemperatureControlRequirements", "Temperature-Control Requirements"],
  ["SpecialHandlingInstructions", "Special Handling Instructions"],
  ["RequestedModeofTransit", "Requested Mode of Transit"],
  ["RequestedShipmentTracingOptions", "Requested Shipment Tracing Options"],
  ["Door2DoorMovement", "Door 2 Door Movement"],
  ["DateOrLocEquAvailforPickupatOrgn", "Date/Location Equipment is Available for Pickup at Origin"],
  ["EstiWarehouseRecptDateAtOrgn", "Estimated Warehouse Receipt Date at Origin"],
  ["PickupLocationatDestination", "Pickup Location at Destination"],
  ["DeliveryLocationatDestin", "Delivery Location at Destination"],
  ["DeliveryInstructions", "Delivery Instructions"],
  ["RevisionNumber", "Revision Number"],
  ["DeliveryDate", "Delivery Date"],
  ["DTRAOnlyImportExportComments", "DTRA-Only Import/Export Comments"],
  ["DeniedPartyScreenResult", "Denied Party Screen Result"],
  ["DeniedPartyScreenResultDate", "Denied Party Screen Result Date"],
  ["DeniedPartyScreenResultComment", "Denied Party Screen Result Comments"],
  ["ChargeCode", "Charge Code"],
];

/* Inventory List columns (start at col B in the export). Order = export order. */
const ATLAS_INVENTORY_COLUMNS = [
  ["serialNumber", "Serial #"],
  ["purchaseOrder", "Purchase Order"],
  ["description", "Description"],
  ["modelNumber", "Model/Catalog Number"],
  ["vendor", "Vendor"],
  ["manufacturer", "Manufacturer"],
  ["quantity", "Quantity"],
  ["quantityReceived", "Qty Received"],
  ["unitOfMeasureText", "Unit Of Measure"],
  ["unitOfIssueText", "Unit Of Issue"],
  ["valueUsd", "Value(USD)"],
  ["weight_Est", "Estimated Weight(lbs)"],
  ["weightKG_Est", "Estimated Weight(kg)"],
  ["estimatedDimentions", "Estimated Dimentions (L x W x H)"],
  ["weight", "Final Weight(lbs)"],
  ["weightKG", "Final Weight(kg)"],
  ["finalDimentions", "Final Dimentions (L x W x H)"],
  ["expContolClassific", "ECCN/USML"],
  ["schNumOrHarCode", "Schedule B/HTS Code"],
  ["meCountryOfOrg", "Material/Equipment Manufacture Country of Origin"],
  ["spcTempControlReq", "Specific Temperature Control Requirements"],
  ["slExpirationDate", "Shelf Life/Expiration Date For Perishable Items"],
  ["hdGoodsClassification", "HAZMAT/Dangerous Goods Classification"],
  ["unCode", "UN Code"],
  ["mhRequirement", "Material Handling Requirements"],
  ["currentCustody", "Current Custody"],
  ["countryText", "Country"],
  ["cityText", "City"],
  ["genComments", "General Comments"],
  ["shipGroup", "Ship Group #"],
  ["licenceOrExceptionExemption", "BIS/DDTC Authorization or Exception"],
];

/* Attachment List columns (start at col B). reqatt reads Type + Attachment Notes. */
const ATLAS_ATTACH_COLUMNS = [
  ["slNo", "SL NO"],
  ["fileName", "File Name"],
  ["type", "Type"],
  ["attachmentNotes", "Attachment Notes"],
  ["createdBy", "Created By"],
  ["createdDate", "Created At"],
];

/* Shipping Activity & History header (start at col B). INCOTERMS + AWB/BoL live here. */
const ATLAS_SHIPACT_COLUMNS = [
  ["carrierFreight", "Carrier / Freight Forwarder"],
  ["awlBol", "AWB/BoL"],
  ["incoterms", "INCOTERMS"],
  ["trackingLink", "Tracking Link"],
];

/* Linked Request List columns (start at col B). Drives consolidation analysis. */
const ATLAS_LINKED_COLUMNS = [
  ["mappedRequestCategory", "Request Type"],
  ["mappedRequestNumber", "Request Number"],
  ["linkTypeText", "Linkage Type"],
  ["comments", "Linkage Comment"],
  ["statusName", "Status"],
  ["requestTitle", "Request Title"],
  ["ctrProgramName", "CTR Program"],
  ["ctRequestorName", "Requestor Name"],
  ["ctProjectManagerName", "CTR Project Manager Name"],
  ["ttipocName", "TTI POC"],
  ["countryofOriginText", "Origin Country"],
  ["countryofDestinationText", "Destination Country"],
  ["nltCompletionDate", "NLT Completion Date"],
  ["createdByName", "Link Created By"],
  ["createdDate", "Link Created At"],
];

/* -------------------------------------------------------------------------
   PROPERTY MANAGEMENT UDQ — a DIFFERENT schema (verified June 2026 against the
   Property UDQ + its matching Excel export):
     - 101 scalar columns (no Pickup party; UCO* keys; "Oraganization" typo).
     - Inventory array is `ProcurementInventory` with property-specific columns
       ("Recommended Vendor/Manufacturer", "Property Type", "PR Group #", …),
       NOT ShipDeliveryInventory.
   The Property document tools (TOP, DD1149, CoreIMS) work on ONE WMTR, so the
   Property fetch slices a single WMTR and builds a one-block property grid that
   detectUdqType recognises as "property" (the inventory header row lands on
   row 4, carrying "Recommended Vendor"/"Recommended Manufacturer").
   ------------------------------------------------------------------------- */

/* Shipment-level scalar columns (Property), in Excel column order. */
const ATLAS_PROP_SCALAR_COLUMNS = [
  ["GMTRNumber", "WMTR Number"],
  ["TopRequiredDisplay", "Transfer of Property (TOP) Required?"],
  ["TopRequiredComments", "TOP Comments"],
  ["DateSubmitted", "Date Submitted"],
  ["CompletedDate", "Date Completed"],
  ["RequestTitle", "Request Title"],
  ["GmtrStatus", "Status"],
  ["RedFlag", "Red Flag"],
  ["RedFlagComments", "Red Flag Comments"],
  ["RequestorRef", "Requestor Ref.#"],
  ["NLTCompletionDate", "NLT Completion Date"],
  ["ManualStatusChangeDate", "Original RDD"],
  ["CTRProgram", "CTR Program"],
  ["CountryofOrigin", "Country of Origin"],
  ["CTRCountryOrProject", "CTR Country"],
  ["CountryofDestination", "Country of Destination"],
  ["ContractNumText", "Contract #"],
  ["TotalCostofService", "Total Cost in USD"],
  ["ContractCORName", "Contract COR Name"],
  ["ContractCOREmail", "Contract COR Email"],
  ["ContractCORPhone", "Contract COR Phone Number"],
  ["CTRProjectManagerName", "CTR Project Manager Name"],
  ["CTRProjectManagerEmail", "CTR Project Manager Email"],
  ["CTRProjectManagerPhone", "CTR Project Manager Phone Number"],
  ["RequestorName", "Requestor Name"],
  ["RequestorEmail", "Requestor Email"],
  ["RequestorPhone", "Requestor Phone Number"],
  ["TTIPOCName", "TTI POC Name"],
  ["TTIPOCEmail", "TTI POC Email"],
  ["TTIPOCPhone", "TTI POC Phone Number"],
  ["TTIAlternatePOCName", "TTI Alternate POC Name"],
  ["TTIAlternatePOCEmail", "TTI Alternate POC Email"],
  ["TTIAlternatePOCPhone", "TTI Alternate POC Phone Number"],
  ["PurposeOrRequestSummary", "Purpose/Request Summary"],
  ["GeneralComments", "General Comments"],
  ["ProgramReviewComments", "Program Review Comments"],
  ["ExportComplianceComments", "Export Compliance Comments"],
  ["Requirements_GeneralComments", "General Comments (Requirement)"],
  ["ShipmentOriginOrganization", "Shipment Origin Organization"],
  ["SOAddress", "Shipment Origin Organization Address"],
  ["SOAddress1", "Shipment Origin Organization Address1"],
  ["SOCountry", "Shipment Origin Organization Country"],
  ["SOState", "Shipment Origin Organization State"],
  ["SOCity", "Shipment Origin Organization City"],
  ["SOZip", "Shipment Origin Organization Zip"],
  ["SOPOCName", "Shipment Origin Organization POC Name"],
  ["SOEmail", "Shipment Origin Organization Email"],
  ["SOCell", "Shipment Origin Organization Cell"],
  ["DeliveryDestinationOraganization", "Delivery Destination Organization"],
  ["DDOAddress", "Delivery Destination Organization Address"],
  ["DDOAddress1", "Delivery Destination Organization Address1"],
  ["DDOCountry", "Delivery Destination Organization Country"],
  ["DDOState", "Delivery Destination Organization State"],
  ["DDOCity", "Delivery Destination Organization City"],
  ["DDOZip", "Delivery Destination Organization Zip"],
  ["DDOPOCName", "Delivery Destination Organization POC Name"],
  ["DDOEmail", "Delivery Destination Organization Email"],
  ["DDOCell", "Delivery Destination Organization Cell"],
  ["UltimateConsigneeOrganization", "Ultimate Consignee Organization"],
  ["UCOAddress", "Ultimate Consignee Organization Address"],
  ["UCOAddress1", "Ultimate Consignee Organization Address1"],
  ["UCOCountry", "Ultimate Consignee Organization Country"],
  ["UCOState", "Ultimate Consignee Organization State"],
  ["UCOCity", "Ultimate Consignee Organization City"],
  ["UCOZip", "Ultimate Consignee Organization Zip"],
  ["UCOPOCName", "Ultimate Consignee Organization POC Name"],
  ["UCOEmail", "Ultimate Consignee Organization Email"],
  ["UCOCell", "Ultimate Consignee Organization Cell"],
  ["IntermediateConsigneeOrganization", "Intermediate Consignee Organization"],
  ["ICOAddress", "Intermediate Consignee Organization Address"],
  ["ICOAddress1", "Intermediate Consignee Organization Address1"],
  ["ICOCountry", "Intermediate Consignee Organization Country"],
  ["ICOState", "Intermediate Consignee Organization State"],
  ["ICOCity", "Intermediate Consignee Organization City"],
  ["ICOZip", "Intermediate Consignee Organization Zip"],
  ["ICOPOCName", "Intermediate Consignee Organization POC Name"],
  ["ICOEmail", "Intermediate Consignee Organization Email"],
  ["ICOCell", "Intermediate Consignee Organization Cell"],
  ["EndUserOrganization", "End-User Organization"],
  ["EUOAddress", "End-User Organization Address"],
  ["EUOAddress1", "End-User Organization Address1"],
  ["EUOCountry", "End-User Organization Country"],
  ["EUOState", "End-User Organization State"],
  ["EUOCity", "End-User Organization City"],
  ["EUOZip", "End-User Organization Zip"],
  ["EUOPOCName", "End-User Organization POC Name"],
  ["EUOEmail", "End-User Organization Email"],
  ["EUOCell", "End-User Organization Cell"],
  ["EstTotalCargoVolume", "Est. Total Cgo Volume"],
  ["FinalTotalCargoVolume", "Final Total Cgo Volume"],
  ["EstTotalCargoWeight", "Est. Total Cgo Weight"],
  ["FinalTotalCargoWeight", "Final Total Cgo Weight"],
  ["TotalValueOfCargo", "Value of Cargo (USD)"],
  ["PurchasingInstructions", "Purchasing Instructions"],
  ["RevisionNumber", "Revision Number"],
  ["DeliveryDate", "Delivery Date"],
  ["DTRAOnlyImportExportComments", "DTRA-Only Import/Export Comments"],
  ["DeniedPartyScreenResult", "Denied Party Screen Result"],
  ["DeniedPartyScreenResultDate", "Denied Party Screen Result Date"],
  ["DeniedPartyScreenResultComment", "Denied Party Screen Result Comments"],
  ["ChargeCode", "Charge Code"],
];

/* Procurement Inventory columns (Property), start at col B. Explicit map: the
   JSON carries extra decomposed-dimension keys the export doesn't column out. */
const ATLAS_PROP_INVENTORY_COLUMNS = [
  ["serialNumber", "Serial #"],
  ["purchaseOrder", "Purchase Order"],
  ["description", "Description"],
  ["modelNumber", "Model/Catalog Number"],
  ["rcVendor", "Recommended Vendor"],
  ["rcManufacturer", "Recommended Manufacturer"],
  ["bneAccept", "Brand name only?"],
  ["oeManufacturer", "Original Equipment Manufacturer"],
  ["emCountyOrgin", "Equipment Manufacture Country Of Origin"],
  ["unitOfMeasureText", "Unit Of Measure Requested"],
  ["unitOfIssueText", "Unit Of Issue"],
  ["valueUsd", "Value(USD)"],
  ["weight_Est", "Estimated Weight(lbs)"],
  ["weightKG_Est", "Estimated Weight(kg)"],
  ["estimatedDimentions", "Estimated Dimentions (L x W x H)"],
  ["weight", "Final Weight(lbs)"],
  ["weightKG", "Final Weight(kg)"],
  ["finalDimentions", "Final Dimentions (L x W x H)"],
  ["qtyRequested", "Quantity Requested"],
  ["quantityReceived", "Quantity Received"],
  ["eccnCategory", "ECCN/USML"],
  ["schNumOrHarCode", "Schedule B/HTS Code"],
  ["propertyType", "Property Type"],
  ["installationRequirements", "Installation Requirements"],
  ["mhRequirement", "Material Handling Requirements"],
  ["interimEnRouteTSR", "Interim,En-Route,or Term Storage Requirements"],
  ["tempControlReq", "Temperature Control Requirements"],
  ["slExpirationDate", "Shelf Life/Expiration Date For Perishable Items"],
  ["hazmatClassification", "HAZMAT Classification"],
  ["actualVendor", "Actual Vendor"],
  ["actualManufacturer", "Actual Manufacturer"],
  ["qtyOrdered", "Quantity Ordered"],
  ["unitOfMeasureOrderedText", "Unit Of Measure Ordered"],
  ["estShipingCostTRLSWH", "Estimated Shipping Cost to TRLS Warehouse"],
  ["leadTime", "LeadTime/Estimated Deliver to TRLS Warehouse after receipt of an approved PR"],
  ["actualTRLSWHDate", "Actual TRLS Warehouse Delivery Date"],
  ["currentCustody", "Current Custody"],
  ["countryText", "Country"],
  ["cityText", "City"],
  ["genComments", "General Comments"],
  ["group", "PR Group #"],
  ["licenceOrExceptionExemption", "BIS/DDTC Authorization or Exception"],
];

/* -------------------------------------------------------------------------
   VALUE FORMATTING — match how values appear in the ATLAS Excel export so the
   readers/date-parsers behave identically.
   ------------------------------------------------------------------------- */

/** ISO datetime ("2025-09-02T00:00:00[.fff]") -> "M/D/YYYY h:mm:ss AM/PM". */
function atlasFmtDate(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return String(iso);
  const y = +m[1], mo = +m[2], d = +m[3];
  let h = m[4] ? +m[4] : 0;
  const mi = m[5] ? +m[5] : 0, s = m[6] ? +m[6] : 0;
  const ampm = h < 12 ? "AM" : "PM";
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return `${mo}/${d}/${y} ${h12}:${pad(mi)}:${pad(s)} ${ampm}`;
}

/** Convert one JSON scalar to its export-cell string (null -> blank cell). */
function atlasCell(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return atlasFmtDate(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return atlasFmtDate(s + "T00:00:00");
  return s;
}

/* -------------------------------------------------------------------------
   GRID BUILDER — JSON records -> array-of-arrays grid (1 block per WMTR).
   A single record yields a one-block grid that detects as "srf"; many records
   yield a multi-block grid that detects as "metrics".
   ------------------------------------------------------------------------- */

/** Build one row with values placed at given 1-based columns. */
function atlasRow(pairs) {
  // pairs: [[colIndex1Based, value], ...]
  let maxC = 0;
  for (const [c] of pairs) if (c > maxC) maxC = c;
  const row = new Array(maxC).fill(null);
  for (const [c, v] of pairs) row[c - 1] = v;
  return row;
}

function atlasHeaderRow(columns, startCol) {
  return atlasRow(columns.map((pair, i) => [startCol + i, pair[1]]));
}
function atlasValueRow(obj, columns, startCol) {
  return atlasRow(columns.map((pair, i) => [startCol + i, atlasCell(obj ? obj[pair[0]] : null)]));
}

/** The 122 shipment headers, in order (row 1 of the grid). */
function atlasShipmentHeaderRow() {
  return ATLAS_SCALAR_COLUMNS.map((p) => p[1]);
}

/** Append a titled sub-section (title at `titleCol`, header + data at `startCol`). */
function atlasPushSection(rows, title, titleCol, columns, startCol, items) {
  rows.push(atlasRow([[titleCol, title]]));
  rows.push(atlasHeaderRow(columns, startCol));
  for (const it of items) rows.push(atlasValueRow(it, columns, startCol));
}

/**
 * Convert ATLAS API records to the export-equivalent grid.
 * Records with a blank WMTR number are skipped (they can't anchor a block).
 */
function atlasRecordsToGrid(records) {
  const grid = [];
  grid.push(atlasShipmentHeaderRow());          // row 1: shipment headers

  for (const rec of records) {
    const wmtr = rec && rec.GMTRNumber ? String(rec.GMTRNumber).trim() : "";
    if (!wmtr) continue;                          // skip blank-WMTR anomalies

    // --- record row (col A = WMTR) ---
    grid.push(ATLAS_SCALAR_COLUMNS.map((p) => atlasCell(rec[p[0]])));

    // --- Inventory List (always emit header so SRF required columns exist) ---
    const inv = Array.isArray(rec.ShipDeliveryInventory) ? rec.ShipDeliveryInventory : [];
    atlasPushSection(grid, "Inventory List", 2, ATLAS_INVENTORY_COLUMNS, 2, inv);

    // --- Attachment List (Required Attachments tool) ---
    const att = Array.isArray(rec.ShipDeliveryAttach) ? rec.ShipDeliveryAttach : [];
    if (att.length) atlasPushSection(grid, "Attachment List", 2, ATLAS_ATTACH_COLUMNS, 2, att);

    // --- Shipping Activity & History (INCOTERMS / AWB-BoL) + nested Daily Status History ---
    const sah = Array.isArray(rec.ShippingActivityHistory) ? rec.ShippingActivityHistory : [];
    if (sah.length) {
      const first = sah[0];
      grid.push(atlasRow([[2, "Shipping Activity & History"]]));
      grid.push(atlasHeaderRow(ATLAS_SHIPACT_COLUMNS, 2));
      grid.push(atlasValueRow(first, ATLAS_SHIPACT_COLUMNS, 2));
      // Daily Status History — title in col C, Date/Notes in cols C/D (PMR daily check)
      const daily = Array.isArray(first.dailyPOCList) ? first.dailyPOCList : [];
      if (daily.length) {
        grid.push(atlasRow([[3, "Daily Status History"]]));
        grid.push(atlasRow([[3, "Date"], [4, "Notes/Comments"]]));
        for (const dp of daily) {
          const dStr = dp.pocDate_UDQ || atlasCell(dp.pocDate);
          grid.push(atlasRow([[3, dStr], [4, dp.pocNotesComments == null ? null : String(dp.pocNotesComments)]]));
        }
      }
    }

    // --- Linked Request List (consolidation analysis) ---
    const lr = Array.isArray(rec.LinkedRequests) ? rec.LinkedRequests : [];
    if (lr.length) atlasPushSection(grid, "Linked Request List", 2, ATLAS_LINKED_COLUMNS, 2, lr);

    // NOTE: "Cost List" and "Workflow Logs" are intentionally not rebuilt — no
    // current tool reads them. Add a builder here if a future feature needs them.
  }
  return grid;
}

/**
 * Build a single-WMTR PROPERTY grid:
 *   row 1  = 101 property headers
 *   row 2  = property scalar values
 *   row 3  = "Inventory List" (col B)
 *   row 4  = property inventory headers (col B..)  <- detectUdqType keys on this
 *   row 5+ = ProcurementInventory item rows
 * One record only (the inventory header must land on row 4 for detection).
 */
function atlasPropertyRecordToGrid(rec) {
  const grid = [];
  grid.push(ATLAS_PROP_SCALAR_COLUMNS.map((p) => p[1]));        // row 1: headers
  grid.push(ATLAS_PROP_SCALAR_COLUMNS.map((p) => atlasCell(rec[p[0]]))); // row 2: values
  grid.push(atlasRow([[2, "Inventory List"]]));                 // row 3: title (col B)
  grid.push(atlasHeaderRow(ATLAS_PROP_INVENTORY_COLUMNS, 2));   // row 4: inv headers
  const inv = Array.isArray(rec.ProcurementInventory) ? rec.ProcurementInventory : [];
  for (const it of inv) grid.push(atlasValueRow(it, ATLAS_PROP_INVENTORY_COLUMNS, 2));
  return grid;
}

/** Write a grid to an in-memory .xlsx (so it flows through the existing loadFile). */
function atlasGridToXlsxBuffer(grid) {
  const aoa = grid.map((row) => (row || []).map((c) => (c === null || c === undefined ? "" : c)));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "UserDefinedQuery");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

/* -------------------------------------------------------------------------
   WMTR matching (for the Shipping single-WMTR slice)
   ------------------------------------------------------------------------- */
function atlasLast5(s) {
  const m = String(s || "").match(/(\d{5})(?!.*\d)/);
  return m ? m[1] : "";
}
function atlasFindRecords(records, query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const qUpper = q.toUpperCase();
  const qLast5 = atlasLast5(q);
  const seen = new Set();
  const out = [];
  for (const r of records) {
    const g = String(r.GMTRNumber || "");
    if (!g || seen.has(g)) continue;
    const hit = (qLast5 && atlasLast5(g) === qLast5) || g.toUpperCase().includes(qUpper);
    if (hit) { seen.add(g); out.push(r); }
  }
  return out;
}

/* -------------------------------------------------------------------------
   FETCH — rides the ATLAS session cookie (same-origin). Detects the common
   "logged-out returns the HTML login page" case and reports it clearly.
   ------------------------------------------------------------------------- */
async function atlasFetchUdqJson(id, extraQuery) {
  const url = atlasUdqUrl(id, extraQuery);
  let resp;
  try {
    resp = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  } catch (e) {
    throw new Error(`Couldn't reach ATLAS (${e.message}). Make sure you're signed in to ATLAS and on the network.`);
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`ATLAS denied the request (HTTP ${resp.status}). Sign in to ATLAS and try again.`);
  }
  if (resp.redirected && /login|signin|sign-in/i.test(resp.url)) {
    throw new Error("Your ATLAS session looks expired (it redirected to the login page). Refresh ATLAS, sign in, then try again.");
  }
  const ctype = (resp.headers.get("content-type") || "").toLowerCase();
  const text = await resp.text();
  if (!resp.ok) throw new Error(`ATLAS returned HTTP ${resp.status}.`);
  if (ctype.includes("text/html") || /^\s*<(?:!doctype|html)/i.test(text)) {
    throw new Error("ATLAS returned a web page instead of data — usually an expired session. Refresh ATLAS, sign in, then try again.");
  }
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error(`Couldn't read the ATLAS response as JSON (${e.message}).`); }
  if (!Array.isArray(data)) {
    if (data && Array.isArray(data.data)) data = data.data;       // tolerate {data:[...]}
    else throw new Error("Unexpected ATLAS response shape — expected a list of UDQ records.");
  }
  return data;
}

/* -------------------------------------------------------------------------
   ORCHESTRATION — fetch -> (slice) -> grid -> xlsx -> existing loadFile()
   ------------------------------------------------------------------------- */

/** Load a grid through the normal pipeline by wrapping it as an in-memory file. */
async function atlasLoadGridAsFile(grid, label) {
  const buf = atlasGridToXlsxBuffer(grid);
  const file = new File([buf], label, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await loadFile(file);   // unchanged existing path: detect type, read, render
}

function atlasSetStatus(msg, isErr) {
  const status = document.getElementById("loadStatus");
  if (!status) return;
  status.classList.toggle("err", !!isErr);
  status.textContent = msg;
}

/**
 * Fetch + load.
 *   opts.dataset : "metrics" | "shipping" | "property"
 *   opts.wmtr    : WMTR number (last-5 or full) — required for "shipping"
 */
async function loadFromAtlasUdq(opts) {
  const ids = atlasIds();
  const dataset = opts.dataset;

  if (dataset === "property") {
    const wmtr = String(opts.wmtr || "").trim();
    if (!wmtr) { atlasSetStatus("Enter a WMTR number to fetch a property request.", true); return; }
    if ((wmtr.replace(/\D/g, "").length) < ATLAS_MIN_REQUEST_DIGITS) {
      atlasSetStatus(`Enter at least ${ATLAS_MIN_REQUEST_DIGITS} digits of the WMTR/request number so the search is specific enough.`, true);
      return;
    }
    const id = ids.property;
    if (!id) { atlasSetStatus(`No ${ATLAS_UDQ_CONFIG.env.toUpperCase()} Property UDQ ID configured. Set it in Settings ▸ ATLAS data source, or in ATLAS_UDQ_CONFIG.`, true); return; }
    try {
      // Server-side filter (same ?requestNumber= as Shipping; confirmed on the PR
      // UDQ). Falls back to a full pull + client slice if the param is cleared.
      const q = ATLAS_UDQ_CONFIG.requestNumberParam
        ? `${encodeURIComponent(ATLAS_UDQ_CONFIG.requestNumberParam)}=${encodeURIComponent(wmtr)}`
        : undefined;
      atlasSetStatus(q ? `Fetching Property WMTR ${wmtr} from ATLAS…` : "Fetching Property UDQ from ATLAS…");
      const recs = await atlasFetchUdqJson(id, q);
      const matches = atlasFindRecords(recs, wmtr);
      const chosen = matches.length ? matches : recs;   // server already filtered
      if (!chosen.length) {
        atlasSetStatus(`WMTR "${wmtr}" wasn't found in the Property UDQ. Check the number, or your ATLAS permissions for that request.`, true);
        return;
      }
      // More than one record in play -> disambiguate rather than silently loading
      // the first (mirrors the Shipping guard).
      if (chosen.length > 1) { atlasRenderWmtrPicker(matches.length ? matches : chosen, "property"); return; }
      await atlasLoadGridAsFile(atlasPropertyRecordToGrid(chosen[0]), `ATLAS API — Property WMTR ${atlasLast5(chosen[0].GMTRNumber) || wmtr}`);
    } catch (e) {
      console.error(e);
      atlasSetStatus(e.message || String(e), true);
    }
    return;
  }

  const id = ids[dataset];
  if (!id) {
    atlasSetStatus(`No ${ATLAS_UDQ_CONFIG.env.toUpperCase()} UDQ ID configured for "${dataset}". Set it in Settings ▸ ATLAS data source, or in ATLAS_UDQ_CONFIG.`, true);
    return;
  }

  try {
    if (dataset === "shipping") {
      const wmtr = String(opts.wmtr || "").trim();
      if (!wmtr) { atlasSetStatus("Enter a WMTR number to fetch a single shipment.", true); return; }
      if ((wmtr.replace(/\D/g, "").length) < ATLAS_MIN_REQUEST_DIGITS) {
        atlasSetStatus(`Enter at least ${ATLAS_MIN_REQUEST_DIGITS} digits of the WMTR/request number so the search is specific enough.`, true);
        return;
      }

      // Server-side filter wired: pull just the matching record(s).
      if (ATLAS_UDQ_CONFIG.requestNumberParam) {
        atlasSetStatus(`Fetching WMTR ${wmtr} from ATLAS…`);
        const recs = await atlasFetchUdqJson(id, `${encodeURIComponent(ATLAS_UDQ_CONFIG.requestNumberParam)}=${encodeURIComponent(wmtr)}`);
        const matches = atlasFindRecords(recs, wmtr);
        const chosen = matches.length ? matches : recs;   // server already filtered
        if (!chosen.length) { atlasSetStatus(`ATLAS returned no records for "${wmtr}". Check the number, or your ATLAS permissions for that request.`, true); return; }
        // More than one record in play (e.g. a broad contains-match, or the combined
        // Metrics UDQ holding the same number across services) -> disambiguate rather
        // than silently loading the first. Prefer the client-matched subset when we
        // have one; otherwise show whatever the server returned.
        if (chosen.length > 1) { atlasRenderWmtrPicker(matches.length ? matches : chosen); return; }
        await atlasLoadGridAsFile(atlasRecordsToGrid([chosen[0]]), `ATLAS API — WMTR ${atlasLast5(chosen[0].GMTRNumber) || wmtr}`);
        return;
      }

      // Client-side slice of the combined UDQ.
      atlasSetStatus("Fetching from ATLAS…");
      const recs = await atlasFetchUdqJson(id);
      const matches = atlasFindRecords(recs, wmtr);
      if (!matches.length) {
        atlasSetStatus(`WMTR "${wmtr}" wasn't found in the UDQ (it returned ${recs.length} record${recs.length === 1 ? "" : "s"}). Check the number, or your ATLAS permissions for that request.`, true);
        return;
      }
      if (matches.length > 1) { atlasRenderWmtrPicker(matches); return; }
      await atlasLoadGridAsFile(atlasRecordsToGrid([matches[0]]), `ATLAS API — WMTR ${atlasLast5(matches[0].GMTRNumber) || wmtr}`);
      return;
    }

    // dataset === "metrics"
    atlasSetStatus("Fetching Metrics UDQ from ATLAS…");
    const recs = await atlasFetchUdqJson(id);
    const usable = recs.filter((r) => r && String(r.GMTRNumber || "").trim());
    if (!usable.length) { atlasSetStatus("ATLAS returned no usable records.", true); return; }
    await atlasLoadGridAsFile(atlasRecordsToGrid(usable), `ATLAS API — Metrics (${usable.length} records)`);
  } catch (e) {
    console.error(e);
    atlasSetStatus(e.message || String(e), true);
  }
}

/* -------------------------------------------------------------------------
   Christmas Tree — fetch all FOUR per-service UDQs in one action.
   Stubbed: returns a friendly "not wired yet" message until the four QA UDQ
   IDs are filled in ATLAS_UDQ_CONFIG.ids.<env>.christmasTree. The loop below is
   structurally complete so finishing it is just (1) fill IDs and (2) confirm the
   Workflow-Logs JSON shape in atlasXmasTreeGrid().
   ------------------------------------------------------------------------- */

/**
 * Build a Christmas-Tree-ready grid from ATLAS JSON records.
 * atlasRecordsToGrid() already emits the scalar row, Inventory, Attachments and
 * (SRF) Daily Status History — but NOT Workflow Logs, which the tracker needs
 * for its review/estimate/invoice dates. TODO(chris): once a live UDQ response
 * is available, append a "Workflow Logs" section per WMTR block here (title in
 * col B; header Status|Date/Time|User|Rejected Reason|Total Cost; newest-first),
 * plus the "Activity Tracker List" (Date in col E) for PR/PMCT/WS.
 */
function atlasXmasTreeGrid(records) {
  return atlasRecordsToGrid(records); // scalar + inventory + daily; workflow TODO
}

async function loadFromAtlasXmasTree(opts) {
  const cfg = atlasIds().christmasTree || {};
  const all = [["SRF", "srf"], ["PR", "pr"], ["PMCT", "pmct"], ["WS", "ws"]];
  const want = opts && opts.service ? String(opts.service).toUpperCase() : null;
  const services = want ? all.filter(([svc]) => svc === want) : all;
  const configured = services.filter(([, key]) => String(cfg[key] || "").trim());

  const status = (m, err) => (typeof xtSetStatus === "function" ? xtSetStatus(m, err) : atlasSetStatus(m, err));

  if (!configured.length) {
    const which = want ? `the ${want} Christmas Tree UDQ ID is` : "any Christmas Tree UDQ IDs are";
    status(`No ${ATLAS_UDQ_CONFIG.env.toUpperCase()} ${which} configured. Set the SRF / PR / PMCT / WS IDs in Settings \u25b8 ATLAS data source (or in ATLAS_UDQ_CONFIG). For now, drag the UDQ exports onto the drop zone above.`, true);
    return;
  }

  let ok = 0;
  for (const [svc, key] of configured) {
    try {
      status(`Fetching ${svc} UDQ from ATLAS…`, false);
      const recs = await atlasFetchUdqJson(String(cfg[key]).trim());
      const usable = (recs || []).filter((r) => r && String(r.GMTRNumber || "").trim());
      if (!usable.length) { status(`ATLAS returned no records for the ${svc} UDQ.`, true); continue; }
      const grid = atlasXmasTreeGrid(usable);
      const { records, untagged } = xtParseRecords(grid, svc);
      XTree.slots[svc] = { fileName: `ATLAS ${svc} UDQ`, records, untagged, grid };
      ok++;
    } catch (e) {
      console.error(e);
      status(`Couldn't fetch the ${svc} UDQ: ${e.message || e}`, true);
    }
  }
  if (ok) {
    status(`Fetched ${ok} service UDQ${ok === 1 ? "" : "s"} from ATLAS.`, false);
    if (typeof renderWorkspace === "function") renderWorkspace();
  }
}

/* -------------------------------------------------------------------------
   UI — a "Fetch from ATLAS" popover anchored under the topbar button.

   ATLAS is becoming the primary data path, so Fetch lives in the header and the
   manual UDQ drop zone is de-emphasised (see loaderView). The popover offers a
   dedicated button per dataset instead of a dropdown; the WMTR entry appears
   ONLY for the two single-WMTR datasets (Shipping/SR and Property/PR). Metrics
   pulls every record and needs no WMTR.
   ------------------------------------------------------------------------- */

/** Where the multi-match WMTR picker renders (inside the header popover). */
function atlasPickHost() { return document.getElementById("atlasFetchPop"); }

function atlasRenderWmtrPicker(matches, dataset) {
  const ds = dataset || "shipping";
  const host = atlasPickHost();
  if (!host) return;
  const list = host.querySelector(".atlas-pick-list");
  if (!list) return;
  const rows = matches.map((r) => {
    const g = String(r.GMTRNumber || "");
    const t = String(r.RequestTitle || "");
    return `<button class="btn ghost atlas-pick" data-wmtr="${g.replace(/"/g, "&quot;")}" style="display:block;width:100%;text-align:left;margin:4px 0">${g} — ${t.replace(/</g, "&lt;")}</button>`;
  }).join("");
  list.innerHTML = `<div class="dz-sub" style="margin:6px 0">Several WMTRs match — pick one:</div>${rows}`;
  list.querySelectorAll(".atlas-pick").forEach((b) => {
    b.addEventListener("click", () => {
      list.innerHTML = "";
      loadFromAtlasUdq({ dataset: ds, wmtr: b.getAttribute("data-wmtr") });
    });
  });
}

/* Datasets that require a WMTR number (single-WMTR slices). Metrics is omitted. */
const ATLAS_WMTR_DATASETS = { shipping: "Shipping (SR)", property: "Property (PR)" };

function atlasBuildPop() {
  const host = document.getElementById("atlasFetchPop");
  if (!host) return;
  const showDrop = (typeof AtlasSettings === "undefined") ||
    (AtlasSettings.get().loaderView !== "hide");   // default: checked/visible
  host.innerHTML = `
    <span class="ap-label">Fetch from ATLAS / UDQ</span>
    <div class="ap-types">
      <button class="ap-type ap-small" type="button" data-ds="metrics">Metrics<span class="ap-sub">all records</span></button>
      <button class="ap-type ap-small" type="button" data-ds="property">Property<span class="ap-sub">PR · single WMTR</span></button>
      <button class="ap-type ap-big" type="button" data-ds="shipping">Shipping<span class="ap-sub">SR · single WMTR</span></button>
    </div>
    <div class="ap-wmtr hidden" id="apWmtr">
      <label for="apWmtrInput" id="apWmtrLabel">WMTR number</label>
      <div class="ap-wmtr-row">
        <input id="apWmtrInput" type="text" inputmode="numeric" placeholder="e.g. 10097" autocomplete="off">
        <button class="btn primary" id="apGo" type="button">Fetch</button>
      </div>
    </div>
    <div class="atlas-pick-list"></div>
    <div class="ap-drop" id="apDrop" tabindex="0" role="button" aria-label="Drop a UDQ Excel file, or click to browse">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
      <div class="ap-drop-title">Drop a UDQ</div>
      <div class="ap-drop-sub">or click to browse (.xlsx)</div>
    </div>
    <div class="ap-foot">
      <input type="checkbox" id="apShowDrop" ${showDrop ? "checked" : ""}>
      <label for="apShowDrop">Keep UDQ drop zone visible</label>
    </div>`;

  const wmtrWrap = host.querySelector("#apWmtr");
  const wmtrLabel = host.querySelector("#apWmtrLabel");
  const wmtrInput = host.querySelector("#apWmtrInput");
  const pickList = host.querySelector(".atlas-pick-list");
  let selectedDs = null;

  const fireWmtr = () => {
    if (!selectedDs) return;
    pickList.innerHTML = "";
    loadFromAtlasUdq({ dataset: selectedDs, wmtr: wmtrInput.value });
  };

  host.querySelectorAll(".ap-type").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ds = btn.getAttribute("data-ds");
      pickList.innerHTML = "";
      if (!ATLAS_WMTR_DATASETS[ds]) {
        // Metrics — no WMTR needed; fetch immediately and close.
        host.querySelectorAll(".ap-type").forEach((b) => b.classList.remove("active"));
        wmtrWrap.classList.add("hidden");
        selectedDs = null;
        atlasClosePop();
        loadFromAtlasUdq({ dataset: ds });
        return;
      }
      // Shipping/Property — reveal the WMTR entry (the "PR or SR" case).
      selectedDs = ds;
      host.querySelectorAll(".ap-type").forEach((b) => b.classList.toggle("active", b === btn));
      wmtrLabel.textContent = `${ATLAS_WMTR_DATASETS[ds]} — WMTR number`;
      wmtrWrap.classList.remove("hidden");
      wmtrInput.focus();
    });
  });

  host.querySelector("#apGo").addEventListener("click", fireWmtr);
  wmtrInput.addEventListener("keydown", (e) => { if (e.key === "Enter") fireWmtr(); });

  // In-popover manual UDQ drop zone — reuses the main #fileInput plumbing for
  // browse, and the global loadFile() pipeline for drops.
  const drop = host.querySelector("#apDrop");
  const browse = () => { const fi = document.getElementById("fileInput"); if (fi) fi.click(); };
  drop.addEventListener("click", browse);
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); browse(); }
  });
  for (const evt of ["dragover", "dragenter"]) {
    drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  }
  for (const evt of ["dragleave", "drop"]) {
    drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
  }
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && typeof loadFile === "function") { loadFile(f); atlasClosePop(); }
  });

  // View setting: checked -> compact drop zone visible in the main window;
  // unchecked -> main drop zone removed (drop into this popover instead).
  host.querySelector("#apShowDrop").addEventListener("change", (e) => {
    const view = e.target.checked ? "show" : "hide";
    if (typeof AtlasSettings !== "undefined") AtlasSettings.save({ loaderView: view });
    if (typeof applyLoaderView === "function") applyLoaderView(view);
  });
}

function atlasClosePop() {
  const btn = document.getElementById("atlasFetchBtn");
  const pop = document.getElementById("atlasFetchPop");
  if (pop) pop.classList.add("hidden");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function atlasInitFetchUi() {
  const btn = document.getElementById("atlasFetchBtn");
  const pop = document.getElementById("atlasFetchPop");
  if (!btn || !pop) return;
  let built = false;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const showing = !pop.classList.contains("hidden");
    if (showing) { atlasClosePop(); return; }
    if (!built) { atlasBuildPop(); built = true; }
    // Reset transient state each open (type selection, WMTR entry, picker).
    pop.querySelectorAll(".ap-type").forEach((b) => b.classList.remove("active"));
    const w = pop.querySelector("#apWmtr"); if (w) w.classList.add("hidden");
    const pl = pop.querySelector(".atlas-pick-list"); if (pl) pl.innerHTML = "";
    const cb = pop.querySelector("#apShowDrop");
    if (cb && typeof AtlasSettings !== "undefined") cb.checked = (AtlasSettings.get().loaderView !== "hide");
    pop.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
  });

  // Click-away / Esc closes the popover.
  document.addEventListener("click", (e) => {
    if (pop.classList.contains("hidden")) return;
    if (e.target === btn || btn.contains(e.target) || pop.contains(e.target)) return;
    atlasClosePop();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.classList.contains("hidden")) atlasClosePop();
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", atlasInitFetchUi);
}

/* Node/Jest export hook (browser ignores this) for offline testing. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    atlasRecordsToGrid, atlasGridToXlsxBuffer, atlasFindRecords,
    atlasCell, atlasFmtDate, atlasLast5, ATLAS_SCALAR_COLUMNS,
    // UDQ-ID resolution (built-in defaults + Settings overrides):
    ATLAS_UDQ_CONFIG, atlasBuiltinIds, atlasIdOverrides, atlasIds,
  };
}
