/* =========================================================================
   ATLAS Utility Web — udq.js
   The UDQ engine. Faithful port of:
     - core/udq_reader.py      (section/row discovery, header maps)
     - services/ci_reader.py   (full SRF data model)
     - ui/validators.py        (detect_udq_type)

   Improvements over desktop v4.4:
     - Captures the Intermediate Consignee party (was skipped before)
     - Captures per-item UN Code, HAZMAT class, temperature control,
       shelf life, purchase order, vendor, manufacturer
       (fixes the silent hazmat-detection bug in the old SLI pipeline)
     - Captures shipment-level fields the new tools will want
       (request title, mode of transit, special handling, contract #)

   Everything operates on a Grid: a plain array-of-arrays of strings,
   so the parser is testable in Node and independent of SheetJS.
   ========================================================================= */

/* ---- Grid helpers (1-based rows/cols, like openpyxl) ---- */

const SHIP_HDR_ROW = 1;
const SHIP_VAL_ROW = 2;
const OLD_INV_HDR_ROW = 4; // legacy fallback when "Inventory List" title is absent

const SECTION_STOP_TITLES = [
  "Cost List",
  "Shipping Activity & History",
  "Request Estimate List",
  "Attachment List",
  // Added with the ATLAS "Linked Request List" export section. In current
  // exports this title sits *after* "Shipping Activity & History" (so the
  // inventory scan already stops before reaching it), but listing it here is
  // cheap insurance: if a future export ever reorders sections and places the
  // Linked Request List between the Inventory List and the other stop titles,
  // the inventory reader still won't mistake its rows for line items.
  "Linked Request List",
  // In a PR / property UDQ the Inventory List is followed *directly* by the
  // "Workflow Logs" section (no Cost List / Shipping Activity between them), so
  // the inventory scan must stop here or it reads the workflow rows as phantom
  // line items. In a shipping SRF an earlier stop (Cost List, …) still wins, so
  // adding it here is a no-op for SRF. (The linked-request reader already had
  // this via its own extra-stops list; this makes the inventory scan agree.)
  "Workflow Logs",
];

/* ---- Linked Request List (new ATLAS export section) ----
   A titled sub-table ("Linked Request List" in col B) with its own header row,
   listing other ATLAS requests linked to this WMTR. In an SRF UDQ there is one
   section (for the single WMTR); in a Metrics UDQ each WMTR block may carry its
   own. Header labels are mapped to stable snake_case keys; any unmapped header
   is preserved under its normalized label so nothing is silently dropped. */
const LINKED_REQUEST_TITLE = "Linked Request List";
const LINKED_REQUEST_FIELD_MAP = {
  "request type": "request_type",
  "request number": "request_number",
  "linkage type": "linkage_type",
  "linkage comment": "linkage_comment",
  "status": "status",
  "request title": "request_title",
  "ctr program": "ctr_program",
  "requestor name": "requestor_name",
  "ctr project manager name": "ctr_pm_name",
  "tti poc": "tti_poc",
  "origin country": "origin_country",
  "destination country": "destination_country",
  "nlt completion date": "nlt_date",
  "link created by": "link_created_by",
  "link created at": "link_created_at",
};

function gridCell(grid, r, c) {
  const row = grid[r - 1];
  if (!row) return "";
  const v = row[c - 1];
  return v === null || v === undefined ? "" : String(v);
}

function gridMaxRow(grid) { return grid.length; }
function gridMaxCol(grid) {
  let m = 0;
  for (const row of grid) if (row && row.length > m) m = row.length;
  return m;
}

/** Build {normalized header -> 1-based column} for a header row. */
function buildHeaderMap(grid, headerRow) {
  const map = {};
  const maxCol = gridMaxCol(grid);
  for (let c = 1; c <= maxCol; c++) {
    const v = gridCell(grid, headerRow, c);
    const key = normWs(v);
    if (key) map[key] = c;
  }
  return map;
}

/** Find the row containing a section title (e.g. "Inventory List"). 0 if absent. */
function findSectionTitleRow(grid, title, maxScan = 300) {
  const limR = Math.min(gridMaxRow(grid), maxScan);
  const limC = Math.min(gridMaxCol(grid), 25);
  const want = normKey(title);
  for (let r = 1; r <= limR; r++) {
    for (let c = 1; c <= limC; c++) {
      if (normKey(gridCell(grid, r, c)) === want) return r;
    }
  }
  return 0;
}

function inventoryHeaderRow(grid) {
  const sectionRow = findSectionTitleRow(grid, "Inventory List");
  return sectionRow ? sectionRow + 1 : OLD_INV_HDR_ROW;
}

function inventoryStartRow(grid) {
  return inventoryHeaderRow(grid) + 1;
}

function inventoryEndRow(grid) {
  const start = inventoryStartRow(grid);
  const stops = SECTION_STOP_TITLES.map(normKey);
  const limC = Math.min(gridMaxCol(grid), 25);
  for (let r = start; r <= gridMaxRow(grid); r++) {
    for (let c = 1; c <= limC; c++) {
      if (stops.includes(normKey(gridCell(grid, r, c)))) return r - 1;
    }
  }
  return gridMaxRow(grid);
}

/** Shipment-level lookup: header in row 1, value in row 2. */
function shipValue(grid, shipMap, header) {
  const c = shipMap[normWs(header)];
  if (!c) return "";
  return norm(gridCell(grid, SHIP_VAL_ROW, c));
}

/* AWB/BoL (Air Waybill / Bill of Lading) lookup. The exact ATLAS header
   spelling/case for this field isn't pinned down in the desktop reader, so we
   try a few common spellings — first as a shipment-header field (row 1 / row 2,
   matched case-insensitively) and then inside the "Shipping Activity & History"
   section table. Returns "" when absent, which simply leaves the CI "Shipment
   Ref No" field blank for manual entry. */
const AWB_BOL_LABELS = [
  "AWB/BoL", "AWB / BoL", "AWB/BoL #", "AWB/BoL Number",
  "Air Waybill/Bill of Lading", "Air Waybill / Bill of Lading",
];
function readAwbBol(grid, shipMap) {
  const wanted = AWB_BOL_LABELS.map(normKey);
  // 1) Shipment header (shipMap keys are whitespace-normalized; compare lowercased)
  for (const key in shipMap) {
    if (wanted.includes(normKey(key))) {
      const v = norm(gridCell(grid, SHIP_VAL_ROW, shipMap[key]));
      if (v) return v;
    }
  }
  // 2) "Shipping Activity & History" section table (already case-insensitive)
  for (const label of AWB_BOL_LABELS) {
    const v = sectionTableValue(grid, "Shipping Activity & History", label);
    if (v) return v;
  }
  return "";
}

/**
 * Look up a value from a titled sub-table, e.g.
 * INCOTERMS inside "Shipping Activity & History"
 * (title row -> header row -> value row). Port of _get_from_section_table.
 */
function sectionTableValue(grid, sectionTitle, headerName, maxScanRows = 500) {
  const wantTitle = normWs(sectionTitle).toUpperCase();
  const wantHeader = normWs(headerName).toUpperCase();
  const maxRow = Math.min(gridMaxRow(grid), maxScanRows);
  const maxCol = gridMaxCol(grid);

  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      if (normWs(gridCell(grid, r, c)).toUpperCase() === wantTitle) {
        const headerRow = r + 1;
        const valueRow = r + 2;
        for (let hc = 1; hc <= maxCol; hc++) {
          if (normWs(gridCell(grid, headerRow, hc)).toUpperCase() === wantHeader) {
            return norm(gridCell(grid, valueRow, hc));
          }
        }
      }
    }
  }
  return "";
}

/* ---- UDQ type detection (port of validators.detect_udq_type) ---- */

function detectUdqType(grid) {
  try {
    const maxRow = Math.min(gridMaxRow(grid), 300);
    const maxCol = Math.min(gridMaxCol(grid), 30);

    // Row 1 headers
    const row1 = [];
    for (let c = 1; c <= gridMaxCol(grid); c++) row1.push(normWs(gridCell(grid, 1, c)));

    const a2 = normWs(gridCell(grid, 2, 1));

    // --- Metrics: 2+ "WMTR-...-SRF" values in column A ---
    let wmtrCount = 0;
    for (let r = 1; r <= maxRow; r++) {
      const val = normWs(gridCell(grid, r, 1)).toUpperCase();
      if (val.startsWith("WMTR-") && val.endsWith("-SRF")) {
        wmtrCount++;
        if (wmtrCount >= 2) return "metrics";
      }
    }

    // --- Property / procurement: unique inventory-list headers, located at the
    //     REAL Inventory List header row. An Attachment section before the
    //     inventory list can push it well below row 4 (e.g. a PR UDQ with the
    //     inventory headers on row 8), so scan the header row we actually find
    //     rather than assuming row 4. These headers never appear in a shipping SRF.
    const propertyHeaders = ["Purchasing Instructions", "Recommended Vendor", "Recommended Manufacturer"];
    const propHdrRow = (typeof inventoryHeaderRow === "function") ? inventoryHeaderRow(grid) : 4;
    for (let c = 1; c <= maxCol; c++) {
      if (propertyHeaders.includes(normWs(gridCell(grid, propHdrRow, c)))) return "property";
    }

    // --- SRF: WMTR Number header + WMTR- value in A2 ---
    if (row1.includes("WMTR Number") && a2.startsWith("WMTR-")) return "srf";

    // --- Secondary SRF fallback: "Inventory List" anywhere in the upper-left ---
    const limR = Math.min(gridMaxRow(grid), 200);
    for (let r = 1; r <= limR; r++) {
      for (let c = 1; c <= 20; c++) {
        if (normWs(gridCell(grid, r, c)) === "Inventory List") return "srf";
      }
    }

    return "unknown";
  } catch (e) {
    return "unknown";
  }
}

/* ---- Party + LineItem factories ---- */

function makeParty(o = {}) {
  return {
    contact: o.contact || "",
    phone: o.phone || "",
    email: o.email || "",
    tax_id: o.tax_id || "",
    addr_lines: o.addr_lines && o.addr_lines.length ? o.addr_lines : [""],
    country: o.country || "",
    // City kept as its own field (in addition to being folded into addr_lines)
    // so tools can use it directly — e.g. the CI's "DAP / <destination city>"
    // default IncoTerms. Optional; blank when the UDQ has no City value.
    city: o.city || "",
  };
}

function makeLineItem(o = {}) {
  return {
    line: o.line || "",
    units: o.units || "",
    uom: o.uom || "",
    desc: o.desc || "",
    model: o.model || "",
    hts: o.hts || "",
    eccn: o.eccn || "",
    auth: o.auth || "",
    coo: o.coo || "",
    unit_value: o.unit_value || "",
    total_value: o.total_value || "",
    weight_lbs: o.weight_lbs || "",
    weight_kg: o.weight_kg || "",
    // New in web version (previously dropped on the floor):
    un_code: o.un_code || "",
    hazmat_class: o.hazmat_class || "",
    temp_control: o.temp_control || "",
    shelf_life: o.shelf_life || "",
    purchase_order: o.purchase_order || "",
    vendor: o.vendor || "",
    manufacturer: o.manufacturer || "",
    serial: o.serial || "",
    ship_group: o.ship_group || "",
  };
}

/** Read a 10-field party block by its UDQ header prefix, e.g. "Shipment Origin Organization". */
function readPartyBlock(grid, shipMap, prefix) {
  const g = (suffix) => shipValue(grid, shipMap, suffix ? `${prefix} ${suffix}` : prefix);
  const org = g("");
  const addr0 = g("Address");
  const addr1 = g("Address1");
  const country = g("Country");
  const state = g("State");
  const city = g("City");
  const zip = g("Zip");
  const poc = g("POC Name");
  const email = g("Email");
  const phone = g("Cell");

  return makeParty({
    contact: poc || org,
    phone, email,
    addr_lines: safeLines([org, addr0, addr1, cityStateZip(city, state, zip)]),
    country,
    city,
  });
}

/* ---- Main SRF reader (port of ci_reader.read_udq) ---- */

function readUdq(grid) {
  const shipMap = buildHeaderMap(grid, SHIP_HDR_ROW);

  const invHdrRow = inventoryHeaderRow(grid);
  const invStartRow = inventoryStartRow(grid);
  const invEndRow = inventoryEndRow(grid);
  const invMap = buildHeaderMap(grid, invHdrRow);

  const wmtr = shipValue(grid, shipMap, "WMTR Number");

  // Parties — all six (Intermediate Consignee is new in the web version)
  const pickup = readPartyBlock(grid, shipMap, "Pickup Location Organization");
  const origin = readPartyBlock(grid, shipMap, "Shipment Origin Organization");
  const deliver = readPartyBlock(grid, shipMap, "Delivery Destination Organization");
  const consignee = readPartyBlock(grid, shipMap, "Ultimate Consignee Organization");
  const intermediate = readPartyBlock(grid, shipMap, "Intermediate Consignee Organization");
  const endUser = readPartyBlock(grid, shipMap, "End-User Organization");

  // Deliver party in the desktop CI shows no POC line — preserved via template, data kept here.

  const incoterms = sectionTableValue(grid, "Shipping Activity & History", "INCOTERMS");
  const totalVol = shipValue(grid, shipMap, "Final Total Cgo Volume");
  const totalWt = shipValue(grid, shipMap, "Final Total Cgo Weight");

  // Inventory column resolver — required columns throw, optional return 0
  const invCol = (name) => {
    const c = invMap[normWs(name)];
    if (!c) throw new Error(`Inventory header not found in row ${invHdrRow}: "${name}"`);
    return c;
  };
  const invColOpt = (name) => invMap[normWs(name)] || 0;

  const cSerial = invCol("Serial #");
  const cQty = invCol("Quantity");
  const cUoi = invColOpt("Unit Of Issue");   // preferred for PL
  const cUom = invColOpt("Unit Of Measure"); // fallback
  const cDesc = invCol("Description");
  const cModel = invCol("Model/Catalog Number");
  const cHts = invCol("Schedule B/HTS Code");
  const cEccn = invCol("ECCN/USML");
  const cAuth = invCol("BIS/DDTC Authorization or Exception");
  const cCoo = invCol("Material/Equipment Manufacture Country of Origin");
  const cUnitValue = invCol("Value(USD)");
  const cFinalWtLbs = invCol("Final Weight(lbs)");
  const cFinalWtKg = invCol("Final Weight(kg)");
  const cFinalDims = invCol("Final Dimentions (L x W x H)"); // (sic — ATLAS spelling)

  // Optional columns (new captures; tolerate absence in older UDQ layouts)
  const cUn = invColOpt("UN Code");
  const cHaz = invColOpt("HAZMAT/Dangerous Goods Classification");
  const cTemp = invColOpt("Specific Temperature Control Requirements");
  const cShelf = invColOpt("Shelf Life/Expiration Date For Perishable Items");
  const cPo = invColOpt("Purchase Order");
  const cVendor = invColOpt("Vendor");
  const cMfr = invColOpt("Manufacturer");
  const cShipGrp = invColOpt("Ship Group #");

  const items = [];
  const packages = []; // NEW: keep package rows visible to tools/UI
  let lineCounter = 1;

  let pkgCount = 0;
  let pkgLbs = 0.0;
  let pkgFt3 = 0.0;

  for (let r = invStartRow; r <= invEndRow; r++) {
    const serial = norm(gridCell(grid, r, cSerial));
    const qtyRaw = gridCell(grid, r, cQty);
    const qtyN = toFloat(qtyRaw);
    const qty = qtyN ? String(Math.trunc(qtyN)) : "";
    // Prefer the "Unit Of Issue" VALUE, but fall back to "Unit Of Measure"
    // when Issue is blank (it often is for inventory items — only packages
    // carry it). Falling back on the column alone loses the UOM, dropping the
    // "EA" from SLI/CI quantities. Matches the desktop reader (Unit Of Measure).
    const uom = norm(gridCell(grid, r, cUoi)) || norm(gridCell(grid, r, cUom));
    const desc = norm(gridCell(grid, r, cDesc));
    const model = norm(gridCell(grid, r, cModel));
    const hts = norm(gridCell(grid, r, cHts));
    const eccn = norm(gridCell(grid, r, cEccn));
    const auth = norm(gridCell(grid, r, cAuth));
    const coo = norm(gridCell(grid, r, cCoo));
    const unitValRaw = gridCell(grid, r, cUnitValue);
    const finalWtLbsRaw = gridCell(grid, r, cFinalWtLbs);
    const finalWtKgRaw = gridCell(grid, r, cFinalWtKg);
    const finalDims = norm(gridCell(grid, r, cFinalDims));

    // Skip fully blank rows inside the Inventory List section
    if (![serial, qty, uom, desc, model, hts, eccn, auth, coo,
          norm(unitValRaw), norm(finalWtLbsRaw), finalDims].some(Boolean)) {
      continue;
    }

    // Package rows (Serial # == "P"): count + totals; not CI line items
    if (serial.toUpperCase() === "P") {
      const pkgUnits = qtyN || 1.0; // blank/zero qty -> 1 package
      pkgCount += Math.trunc(pkgUnits);

      const lbsN = toFloat(finalWtLbsRaw);
      if (lbsN) pkgLbs += lbsN;

      const [L, W, H] = parseDimsIn(finalDims);
      let ft3r = 0;
      if (L && W && H) {
        ft3r = roundHalfUp((L * W * H) / 1728.0, 2);
        pkgFt3 += ft3r;
      }

      packages.push({
        row: r,
        count: Math.trunc(pkgUnits),
        uoi: uom,
        weight_lbs: norm(finalWtLbsRaw),
        weight_kg: norm(finalWtKgRaw),
        dims: finalDims,
        volume_ft3: ft3r,
        description: desc,
        // Ship Group # on a parent ("P") row: the key that child inventory
        // items reference to indicate which box/pallet they were loaded into.
        ship_group: cShipGrp ? norm(gridCell(grid, r, cShipGrp)) : "",
      });
      continue;
    }

    // Normal inventory items (Serial # may be blank)
    const unitN = toFloat(unitValRaw);
    const totalN = qtyN && unitN ? qtyN * unitN : 0.0;

    items.push(makeLineItem({
      line: String(lineCounter),
      units: qty,
      uom, desc, model, hts, eccn, auth, coo,
      unit_value: unitN ? fmtMoney(unitN) : norm(unitValRaw),
      total_value: fmtMoney(totalN),
      weight_lbs: norm(finalWtLbsRaw),
      weight_kg: norm(finalWtKgRaw),
      un_code: cUn ? norm(gridCell(grid, r, cUn)) : "",
      hazmat_class: cHaz ? norm(gridCell(grid, r, cHaz)) : "",
      temp_control: cTemp ? norm(gridCell(grid, r, cTemp)) : "",
      shelf_life: cShelf ? norm(gridCell(grid, r, cShelf)) : "",
      purchase_order: cPo ? norm(gridCell(grid, r, cPo)) : "",
      vendor: cVendor ? norm(gridCell(grid, r, cVendor)) : "",
      manufacturer: cMfr ? norm(gridCell(grid, r, cMfr)) : "",
      serial,
      ship_group: cShipGrp ? norm(gridCell(grid, r, cShipGrp)) : "",
    }));
    lineCounter++;
  }

  const totalValueCalc = items.reduce(
    (sum, it) => sum + (it.total_value ? toFloat(it.total_value) : 0), 0);

  // Shipment-level totals from UDQ (ATLAS-calculated), matching desktop behavior
  const udqFt3 = toFloat(totalVol);
  const udqLbs = toFloat(totalWt);
  const udqM3 = udqFt3 * 0.028316846592;
  const udqKg = udqLbs * 0.45359237;

  const meta = {
    invoice_no: wmtr,
    wmtr,
    wmtr_last5: wmtrLast5(wmtr),
    request_title: shipValue(grid, shipMap, "Request Title"),
    contract_no: shipValue(grid, shipMap, "Contract #"),
    purpose: shipmentTypeToPurpose(shipValue(grid, shipMap, "Shipment Type")),
    payment_terms: "No Commercial Value",
    payment_terms_remarks: "No Charge (NC)",
    incoterm: incoterms,
    shipment_ref_no: "",
    awb_bol: readAwbBol(grid, shipMap),
    mode_of_transit: shipValue(grid, shipMap, "Identify Shipment As"),
    shipment_type: shipValue(grid, shipMap, "Shipment Type"),
    special_handling: shipValue(grid, shipMap, "Special Handling Instructions"),
    temp_requirements: shipValue(grid, shipMap, "Temperature-Control Requirements"),
    country_origin: shipValue(grid, shipMap, "Country of Origin"),
    country_destination: shipValue(grid, shipMap, "Country of Destination"),
    ctr_program: shipValue(grid, shipMap, "CTR Program"),
    nlt_date: shipValue(grid, shipMap, "NLT Completion Date"),
    value_of_cargo: shipValue(grid, shipMap, "Value of Cargo (USD)"),
    total_pkgs: pkgCount ? String(pkgCount) : "",
    total_weight: fmtWeight(udqLbs, udqKg),
    total_volume: fmtVolume(udqFt3, udqM3),
    total_value: fmtMoney(totalValueCalc),
    // raw numerics for tools that need numbers, not display strings
    totals_raw: {
      pkg_count: pkgCount,
      udq_lbs: udqLbs, udq_kg: udqKg,
      udq_ft3: udqFt3, udq_m3: udqM3,
      pkg_lbs: pkgLbs, pkg_ft3: pkgFt3,
      value_usd: totalValueCalc,
    },
  };

  return {
    meta,
    parties: {
      origin,
      consignee,
      intermediate,   // new
      end_user: endUser,
      pickup,
      deliver,
    },
    items,
    packages,         // new
  };
}

/* =========================================================================
   Property Management UDQ reader (port of the desktop TOP pipeline's UDQ
   access in services/top_documents_service.py + services/top_service.py).

   A Property Management UDQ shares the SRF shipment header layout (row 1 =
   headers, row 2 = values) but uses a different Inventory List with property
   columns ("Recommended Vendor", "Property Type", "PR Group #", …). The TOP
   Documents tool needs the six party blocks, a handful of shipment-level
   fields, and the inventory rows resolved with the desktop's fallback header
   order. Everything else (Metrics, DD1149, CoreIMS) can build on this later.
   ========================================================================= */

/** First inventory column that exists, trying each header name in order. 0 if none. */
function _propInvColFirst(invMap, ...names) {
  for (const n of names) {
    const c = invMap[normWs(n)];
    if (c) return c;
  }
  return 0;
}

/* Like _propInvColFirst, but value-aware: among the candidate headers that
   exist, return the first (in preference order) whose column actually holds a
   value across the inventory rows. This keeps a present-but-empty header from
   shadowing a populated one — e.g. a PR that was received (Quantity Received
   filled) but never "ordered" through ATLAS (Quantity Ordered header present but
   blank). Falls back to the first existing header if none hold any value. */
function _propInvColFirstWithValue(grid, invMap, startRow, endRow, ...names) {
  let firstExisting = 0;
  for (const n of names) {
    const c = invMap[normWs(n)];
    if (!c) continue;
    if (!firstExisting) firstExisting = c;
    for (let r = startRow; r <= endRow; r++) {
      if (normWs(gridCell(grid, r, c))) return c;
    }
  }
  return firstExisting;
}

/* Map the UDQ "Shipment Type" to a CI "Purpose of Shipment" choice. The two
   share a vocabulary, with one business rule: a UDQ Shipment Type of "Other"
   corresponds to "Donation" on the CI. An explicit "Other" purpose on the CI is
   only ever a manual choice made in the utility (which opens the comment field).
   Unrecognized or blank types fall back to "Donation". */
function shipmentTypeToPurpose(shipmentType) {
  const t = normWs(shipmentType);
  if (!t || /^other$/i.test(t)) return "Donation";
  const choices = (typeof PURPOSE_CHOICES !== "undefined")
    ? PURPOSE_CHOICES : ["Donation", "Return After Repair", "Return For Repair", "Other"];
  const hit = choices.find((p) => p.toLowerCase() === t.toLowerCase());
  return (hit && !/^other$/i.test(hit)) ? hit : "Donation";
}

/** First non-empty shipment value among the given headers (port of _ship_first). */
function _propShipFirst(grid, shipMap, ...headers) {
  for (const h of headers) {
    const v = shipValue(grid, shipMap, h);
    if (normWs(v)) return v;
  }
  return "";
}

/** "ETHIOPIA - ET" -> "ETHIOPIA" (port of _clean_country). */
function cleanCountry(country) {
  const s = norm(country);
  const i = s.indexOf(" - ");
  return i >= 0 ? s.slice(0, i).trim() : s;
}

function readPropertyUdq(grid) {
  const shipMap = buildHeaderMap(grid, SHIP_HDR_ROW);

  const invHdrRow = inventoryHeaderRow(grid);   // "Inventory List" -> row+1 (4 here)
  const invStartRow = inventoryHeaderRow(grid) + 1;
  const invEndRow = inventoryEndRow(grid);
  const invMap = buildHeaderMap(grid, invHdrRow);

  const wmtr = shipValue(grid, shipMap, "WMTR Number");

  // Raw 10-field block for a party prefix, so the TOP tool can reproduce the
  // desktop's _party_block exactly (drops the org line, cleans the country,
  // optional POC). Attached as party.raw alongside the display party object.
  const partyRaw = (prefix) => {
    const g = (suffix) => shipValue(grid, shipMap, suffix ? `${prefix} ${suffix}` : prefix);
    return {
      org: g(""), addr0: g("Address"), addr1: g("Address1"),
      city: g("City"), state: g("State"), zip: g("Zip"), country: g("Country"),
      poc_name: g("POC Name"), email: g("Email"), phone: g("Cell"),
    };
  };
  const withRaw = (prefix) => {
    const p = readPartyBlock(grid, shipMap, prefix);
    p.raw = partyRaw(prefix);
    return p;
  };

  // Six party blocks (same header prefixes as the SRF layout)
  const pickup = withRaw("Pickup Location Organization");
  const origin = withRaw("Shipment Origin Organization");
  const deliver = withRaw("Delivery Destination Organization");
  const consignee = withRaw("Ultimate Consignee Organization");
  const intermediate = withRaw("Intermediate Consignee Organization");
  const endUser = withRaw("End-User Organization");

  // Inventory columns — desktop fallback order (first existing header wins,
  // by NAME presence, not by whether the column holds values). Faithful to
  // services/top_documents_service._read_udq_inventory_rows.
  const cDesc = _propInvColFirst(invMap, "Description");
  const cModel = _propInvColFirst(invMap, "Model/Catalog Number", "Model / Catalog No");
  const cMfr = _propInvColFirst(invMap,
    "Actual Manufacturer", "Recommended Manufacturer", "Manufacturer",
    "Original Equipment Manufacturer");
  const cSerial = _propInvColFirst(invMap, "Serial #");
  const cQty = _propInvColFirstWithValue(grid, invMap, invStartRow, invEndRow,
    "Quantity Received", "Quantity Ordered", "Quantity Requested",
    "Qty Received", "Quantity");
  const cUom = _propInvColFirst(invMap,
    "Unit Of Measure Ordered", "Unit Of Measure Requested", "Unit Of Issue",
    "Unit Of Measure", "U/M");
  const cValue = _propInvColFirst(invMap, "Value(USD)", "Value (USD)");

  const missing = [];
  if (!cDesc) missing.push("Description");
  if (!cQty) missing.push("Quantity");
  if (!cValue) missing.push("Value(USD)");
  if (missing.length) {
    throw new Error(`UDQ is missing expected inventory headers: ${missing.join(", ")}`);
  }

  const items = [];
  let blankStreak = 0;
  for (let r = invStartRow; r <= invEndRow; r++) {
    const desc = cDesc ? norm(gridCell(grid, r, cDesc)) : "";
    const model = cModel ? norm(gridCell(grid, r, cModel)) : "";
    const mfr = cMfr ? norm(gridCell(grid, r, cMfr)) : "";
    const serial = cSerial ? norm(gridCell(grid, r, cSerial)) : "";
    const qtyRaw = cQty ? gridCell(grid, r, cQty) : "";
    const uom = cUom ? norm(gridCell(grid, r, cUom)) : "";
    const valRaw = cValue ? gridCell(grid, r, cValue) : "";

    if (![normWs(desc), normWs(model), normWs(serial), normWs(qtyRaw), normWs(valRaw)].some(Boolean)) {
      blankStreak++;
      if (blankStreak >= 5) break;
      continue;
    }
    blankStreak = 0;

    if (normWs(desc).toLowerCase() === "description") continue;
    if (["model/catalog number", "model / catalog no"].includes(normWs(model).toLowerCase())) continue;
    if (serial.toUpperCase() === "P") continue;

    const qtyN = toFloat(qtyRaw);
    const unitN = toFloat(valRaw);

    items.push({
      item_no: items.length + 1,
      desc, model, mfr, serial, uom,
      qty: qtyN,                                   // numeric (whole-rounded at write)
      unit_value: unitN,                           // numeric
      qty_raw: norm(qtyRaw),
      value_raw: norm(valRaw),
    });
  }

  const program = _propShipFirst(grid, shipMap, "CTR Program");
  const country = cleanCountry(_propShipFirst(grid, shipMap, "Country of Destination", "CTR Country"));

  const meta = {
    wmtr,
    wmtr_last5: wmtrLast5(wmtr),
    request_title: shipValue(grid, shipMap, "Request Title"),
    ctr_program: program,
    country_destination: _propShipFirst(grid, shipMap, "Country of Destination", "CTR Country"),
    partner_country: country,
    contract_no: shipValue(grid, shipMap, "Contract #"),
    purchasing_instructions: shipValue(grid, shipMap, "Purchasing Instructions"),
    value_of_cargo: shipValue(grid, shipMap, "Value of Cargo (USD)"),
    nlt_date: shipValue(grid, shipMap, "NLT Completion Date"),
  };

  return {
    meta,
    parties: { origin, consignee, intermediate, end_user: endUser, pickup, deliver },
    items,
  };
}

/* =========================================================================
   LINKED REQUEST LIST readers

   readLinkedRequestSections(grid)  -> every "Linked Request List" section in
       the file, each paired with the WMTR record row it belongs to. Works for
       both single-WMTR SRF UDQs (one section) and multi-WMTR Metrics UDQs
       (one section per block).
   readLinkedRequests(grid)         -> flat list of all linked requests (SRF
       dashboard convenience).
   readConsolGroups(grid)           -> one entry per WMTR that has Consol-type
       links, carrying that WMTR's headline fields plus its Consol links
       (Metrics "consolidated shipments" view).

   These are descriptive readers only; they never affect inventory/type parsing.
   ========================================================================= */

/** True if a cell is an ATLAS WMTR record key (col-A row marker). */
function _isWmtrRecordCell(v) {
  const s = normWs(v).toUpperCase();
  return s.startsWith("WMTR-") && s.endsWith("-SRF");
}

/* ATLAS sub-section titles that can follow a Linked Request List and must
   terminate it. Confirmed in real SRF exports: a "Workflow Logs" section (the
   DTRA program-review / status history) sits directly after the Linked Request
   List, and because it wasn't recognized as a boundary its rows were being read
   in as bogus "linked requests" (the whole workflow was showing on the
   dashboard). The rest are the other titled ATLAS sections — cheap insurance,
   mirroring the boundary set already used in xmastree.js, so none of them can
   leak into the linked-request list either. "Workflow Logs" is now also a global
   section stop (a PR/property Inventory List is followed directly by it); the
   other two remain scoped to this reader. */
const LINKED_REQUEST_EXTRA_STOPS = [
  "Workflow Logs",
  "Daily Status History",
  "Activity Tracker List",
];

/** Titles (besides a new WMTR record row) that terminate a Linked Request List. */
function _linkedRequestStopKeys() {
  return ["Inventory List", LINKED_REQUEST_TITLE]
    .concat(SECTION_STOP_TITLES)
    .concat(LINKED_REQUEST_EXTRA_STOPS)
    .map(normKey);
}

/** Read the rows of one Linked Request List, given its (local) header row. */
function _readLinkedRequestRows(grid, headerRow) {
  const maxCol = gridMaxCol(grid);
  const cols = [];                 // ordered {key, label, col}
  const seen = {};
  for (let c = 1; c <= maxCol; c++) {
    const label = normWs(gridCell(grid, headerRow, c));
    if (!label) continue;
    const nk = normKey(label);
    const key = LINKED_REQUEST_FIELD_MAP[nk] || nk;  // map known headers; keep others by label
    if (seen[key]) continue;
    seen[key] = true;
    cols.push({ key, label, col: c });
  }

  const stops = _linkedRequestStopKeys();
  const scanC = Math.min(maxCol, 25);
  const links = [];
  let blankStreak = 0;

  for (let r = headerRow + 1; r <= gridMaxRow(grid); r++) {
    // The next WMTR record row starts a new block (Metrics) -> section ends.
    if (_isWmtrRecordCell(gridCell(grid, r, 1))) break;
    // A new section title (incl. another Linked Request List) -> section ends.
    let hitStop = false;
    for (let c = 1; c <= scanC; c++) {
      if (stops.includes(normKey(gridCell(grid, r, c)))) { hitStop = true; break; }
    }
    if (hitStop) break;

    const rec = {};
    let anyVal = false;
    for (const { key, col } of cols) {
      const v = norm(gridCell(grid, r, col));
      rec[key] = v;
      if (v) anyVal = true;
    }
    if (!anyVal) {
      blankStreak++;
      if (blankStreak >= 3) break;
      continue;
    }
    blankStreak = 0;

    // A genuine link row carries a request number or request type.
    if (!(rec.request_number || rec.request_type)) continue;
    rec._row = r;
    links.push(rec);
  }
  return { cols, links };
}

/** Every Linked Request List section, tied to its parent WMTR record row. */
function readLinkedRequestSections(grid) {
  const sections = [];
  if (!grid || !grid.length) return sections;
  const scanC = Math.min(gridMaxCol(grid), 25);
  const wantTitle = normKey(LINKED_REQUEST_TITLE);

  for (let r = 1; r <= gridMaxRow(grid); r++) {
    let titleHere = false;
    for (let c = 1; c <= scanC; c++) {
      if (normKey(gridCell(grid, r, c)) === wantTitle) { titleHere = true; break; }
    }
    if (!titleHere) continue;

    const headerRow = r + 1;
    const { cols, links } = _readLinkedRequestRows(grid, headerRow);

    // Parent = nearest WMTR record row above the title.
    let parentRow = 0;
    for (let pr = r - 1; pr >= 1; pr--) {
      if (_isWmtrRecordCell(gridCell(grid, pr, 1))) { parentRow = pr; break; }
    }
    sections.push({ titleRow: r, headerRow, parentRow, cols, links });
  }
  return sections;
}

/** Flat list of all linked requests (single-WMTR SRF dashboard use). */
function readLinkedRequests(grid) {
  const out = [];
  for (const s of readLinkedRequestSections(grid)) {
    for (const l of s.links) out.push(l);
  }
  return out;
}

/**
 * Consolidation groups for a Metrics UDQ: one entry per WMTR whose block lists
 * Consol-type links. Parent headline fields come from that WMTR's record row
 * (row-1 header layout); the links are the Consol rows from its section.
 */
function readConsolGroups(grid) {
  const shipMap = buildHeaderMap(grid, SHIP_HDR_ROW);
  const pField = (row, label) => {
    const c = shipMap[normWs(label)];
    return c ? norm(gridCell(grid, row, c)) : "";
  };

  const groups = [];
  for (const s of readLinkedRequestSections(grid)) {
    const consol = s.links.filter((l) => normKey(l.linkage_type || "") === "consol");
    if (!consol.length) continue;
    const prow = s.parentRow;
    groups.push({
      parent_row: prow,
      parent_wmtr: prow ? (pField(prow, "WMTR Number") || norm(gridCell(grid, prow, 1))) : "",
      parent_title: prow ? pField(prow, "Request Title") : "",
      parent_program: prow ? pField(prow, "CTR Program") : "",
      parent_dest: prow ? pField(prow, "Country of Destination") : "",
      parent_nlt: prow ? pField(prow, "NLT Completion Date") : "",
      links: consol,
    });
  }
  return groups;
}

/* =========================================================================
   INVENTORY LINE-ITEM READER (descriptive; for the Metrics dashboard)

   readInventorySections(grid) -> every "Inventory List" section in the file,
   each tied to the WMTR record row it belongs to, with its line-item rows read
   as light records: { serial, qty, desc, model, row }.

   Works for both single-WMTR SRF UDQs (one section) and multi-WMTR Metrics
   UDQs (one section per WMTR block), mirroring readLinkedRequestSections. It is
   deliberately lightweight — it maps only the four columns the dashboard's
   line-item / piece counts need (Serial #, Quantity, Description, Model/Catalog
   Number) from each section's OWN header row, so it does not require the fuller
   SRF-only inventory columns (ECCN, HTS, Final Weight, …) that a Metrics-export
   inventory doesn't carry. It never affects inventory/type parsing used by the
   document tools; readUdq() remains the authority for SRF document generation.

   "P" (package/parent) rows are surfaced with serial === "P" so callers can
   exclude them, matching readUdq()'s treatment of packages as NOT line items.
   ========================================================================= */

/** Titles (besides a new WMTR record row) that terminate an Inventory List. */
function _inventoryStopKeys() {
  // Every stop title, plus another "Inventory List" as cheap insurance against
  // two adjacent sections. SECTION_STOP_TITLES already lists the real stops.
  return SECTION_STOP_TITLES.concat(["Inventory List"]).map(normKey);
}

/** Read the line-item rows of one Inventory List, given its (local) header row. */
function _readInventoryRows(grid, headerRow) {
  const invMap = buildHeaderMap(grid, headerRow);
  const cSerial = invMap[normWs("Serial #")] || 0;
  const cQty = invMap[normWs("Quantity")] || 0;
  const cDesc = invMap[normWs("Description")] || 0;
  const cModel = invMap[normWs("Model/Catalog Number")] || 0;

  const stops = _inventoryStopKeys();
  const scanC = Math.min(gridMaxCol(grid), 25);
  const items = [];
  let blankStreak = 0;

  for (let r = headerRow + 1; r <= gridMaxRow(grid); r++) {
    // The next WMTR record row starts a new block (Metrics) -> section ends.
    if (_isWmtrRecordCell(gridCell(grid, r, 1))) break;
    // A new section title (Cost List, Shipping Activity & History, …) -> end.
    let hitStop = false;
    for (let c = 1; c <= scanC; c++) {
      if (stops.includes(normKey(gridCell(grid, r, c)))) { hitStop = true; break; }
    }
    if (hitStop) break;

    const serial = cSerial ? norm(gridCell(grid, r, cSerial)) : "";
    const qty = cQty ? toFloat(gridCell(grid, r, cQty)) : 0.0;
    const desc = cDesc ? norm(gridCell(grid, r, cDesc)) : "";
    const model = cModel ? norm(gridCell(grid, r, cModel)) : "";

    // Skip fully blank rows inside the section (defensive; some exports pad).
    if (!serial && !desc && !model && !qty) {
      blankStreak++;
      if (blankStreak >= 3) break;
      continue;
    }
    blankStreak = 0;

    items.push({ serial, qty, desc, model, row: r });
  }
  return items;
}

/** Every Inventory List section, tied to its parent WMTR record row. */
function readInventorySections(grid) {
  const sections = [];
  if (!grid || !grid.length) return sections;
  const scanC = Math.min(gridMaxCol(grid), 25);
  const wantTitle = normKey("Inventory List");

  for (let r = 1; r <= gridMaxRow(grid); r++) {
    let titleHere = false;
    for (let c = 1; c <= scanC; c++) {
      if (normKey(gridCell(grid, r, c)) === wantTitle) { titleHere = true; break; }
    }
    if (!titleHere) continue;

    const headerRow = r + 1;
    const items = _readInventoryRows(grid, headerRow);

    // Parent = nearest WMTR record row above the title.
    let parentRow = 0;
    for (let pr = r - 1; pr >= 1; pr--) {
      if (_isWmtrRecordCell(gridCell(grid, pr, 1))) { parentRow = pr; break; }
    }
    const parentWmtr = parentRow ? norm(gridCell(grid, parentRow, 1)) : "";
    sections.push({ titleRow: r, headerRow, parentRow, parentWmtr, items });
  }
  return sections;
}

/* =========================================================================
   CONSOLIDATION ANALYSIS (de-duplicated groups + reciprocity check)

   A "Consol" link means separate ATLAS requests ship together under one AWB.
   Consolidation is meant to be transitive and fully reciprocal: if A lists B
   and B lists C, then A, B and C all ship together and each should list the
   other two. analyzeConsolidation() builds that picture from every WMTR's
   Linked Request List:

     - Clusters: the transitive closure (union-find) of all Consol links, so a
       single AWB group is reported once no matter how many members reference it.
     - Reciprocity: within each cluster, every in-file member's list is checked
       for all the other members. Any member it fails to list back is reported
       as a discrepancy for a human to verify (people can mis-enter links in
       ATLAS). Members only referenced from elsewhere (not present as a WMTR
       record in this dataset) are noted but not themselves checked, since we
       can't read a list they didn't export.
   ========================================================================= */

/** Canonical request key for matching parents (…-SRF) against link numbers. */
function _consolKey(wmtr) {
  return normWs(wmtr).toUpperCase().replace(/-SRF$/, "");
}

function analyzeConsolidation(grid) {
  const result = { clusters: [], discrepancies: [] };
  if (!grid || !grid.length) return result;

  const shipMap = buildHeaderMap(grid, SHIP_HDR_ROW);
  const pField = (row, label) => {
    const c = shipMap[normWs(label)];
    return c ? norm(gridCell(grid, row, c)) : "";
  };

  // Every in-file WMTR record (col A "…-SRF") -> its row + canonical key.
  const recordRowByKey = {}, recordWmtrByKey = {};
  for (let r = 1; r <= gridMaxRow(grid); r++) {
    const a = gridCell(grid, r, 1);
    if (!_isWmtrRecordCell(a)) continue;
    const k = _consolKey(a);
    if (!(k in recordRowByKey)) { recordRowByKey[k] = r; recordWmtrByKey[k] = norm(a); }
  }

  // Walk each WMTR's Linked Request List; collect Consol edges + link-row info.
  const consolOut = {};       // key -> Set of keys it lists as Consol
  const linkInfoByKey = {};   // key -> {wmtr,title,program,dest,nlt,status} (fallback details)
  const edges = [];

  for (const s of readLinkedRequestSections(grid)) {
    if (!s.parentRow) continue;
    const parentKey = _consolKey(gridCell(grid, s.parentRow, 1));
    consolOut[parentKey] = consolOut[parentKey] || new Set();  // mark "list was read"
    for (const l of s.links) {
      if (normKey(l.linkage_type || "") !== "consol") continue;
      const tk = _consolKey(l.request_number);
      if (!tk) continue;
      consolOut[parentKey].add(tk);
      edges.push([parentKey, tk]);
      if (!(tk in linkInfoByKey)) {
        linkInfoByKey[tk] = {
          wmtr: norm(l.request_number), title: l.request_title || "",
          program: l.ctr_program || "", dest: l.destination_country || "",
          nlt: l.nlt_date || "", status: l.status || "",
        };
      }
    }
  }

  if (!edges.length) return result;

  // Union-find over every key seen in an edge.
  const parent = {};
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const [a, b] of edges) { if (!(a in parent)) parent[a] = a; if (!(b in parent)) parent[b] = b; }
  for (const [a, b] of edges) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

  const comps = {};
  for (const k of Object.keys(parent)) (comps[find(k)] = comps[find(k)] || []).push(k);

  const memberInfo = (k) => {
    const row = recordRowByKey[k];
    if (row) {
      return {
        key: k, wmtr: recordWmtrByKey[k] || k, inFile: true,
        program: pField(row, "CTR Program"), dest: pField(row, "Country of Destination"),
        nlt: pField(row, "NLT Completion Date"), title: pField(row, "Request Title"),
        status: pField(row, "Status"),
      };
    }
    const li = linkInfoByKey[k] || {};
    return {
      key: k, wmtr: li.wmtr || k, inFile: false,
      program: li.program || "", dest: li.dest || "", nlt: li.nlt || "",
      title: li.title || "", status: li.status || "",
    };
  };

  for (const root of Object.keys(comps)) {
    const keys = comps[root];
    if (keys.length < 2) continue; // a consolidation needs 2+ requests
    const members = keys.map(memberInfo).sort((a, b) => a.wmtr.localeCompare(b.wmtr));

    // Each in-file member should list every other member back.
    const missing = [];
    for (const m of members) {
      if (!m.inFile) continue;                 // can't read an external member's list
      const out = consolOut[m.key] || new Set();
      for (const other of members) {
        if (other.key === m.key || out.has(other.key)) continue;
        missing.push({
          fromKey: m.key, fromWmtr: m.wmtr,
          toKey: other.key, toWmtr: other.wmtr, toInFile: other.inFile,
        });
      }
    }
    const cluster = {
      members,
      externals: members.filter((m) => !m.inFile),
      complete: missing.length === 0,
      missing,
    };
    result.clusters.push(cluster);
    if (!cluster.complete) result.discrepancies.push(cluster);
  }

  result.clusters.sort((a, b) =>
    b.members.length - a.members.length || a.members[0].wmtr.localeCompare(b.members[0].wmtr));
  return result;
}

/* =========================================================================
   UDQ PARSE DIAGNOSTICS (Feature #5)

   When a file doesn't parse, or detects as the "wrong" type, the diagnostics
   report shows which layout signals, sections, and inventory columns were found
   vs. missing — so a user can see *why* and fix the export (or spot that it was
   edited/renamed). This is descriptive only; it never changes parsing.

   The column specs below mirror the resolvers in readUdq / readPropertyUdq.
   Keep them in sync if those readers change.
   ========================================================================= */

/* SRF inventory columns (names exactly as resolved in readUdq). */
const SRF_REQUIRED_INV_COLS = [
  "Serial #", "Quantity", "Description", "Model/Catalog Number",
  "Schedule B/HTS Code", "ECCN/USML", "BIS/DDTC Authorization or Exception",
  "Material/Equipment Manufacture Country of Origin", "Value(USD)",
  "Final Weight(lbs)", "Final Weight(kg)", "Final Dimentions (L x W x H)",
];
const SRF_OPTIONAL_INV_COLS = [
  "Unit Of Issue", "Unit Of Measure", "UN Code",
  "HAZMAT/Dangerous Goods Classification",
  "Specific Temperature Control Requirements",
  "Shelf Life/Expiration Date For Perishable Items",
  "Purchase Order", "Vendor", "Manufacturer", "Ship Group #",
];
/* Property inventory columns — each entry is an alias group (first present wins,
   matching _propInvColFirst). required flags those readPropertyUdq throws on. */
const PROP_INV_COL_GROUPS = [
  { label: "Description", required: true, aliases: ["Description"] },
  { label: "Quantity", required: true, aliases: ["Quantity Ordered", "Quantity Received", "Quantity Requested", "Qty Received", "Quantity"] },
  { label: "Value (USD)", required: true, aliases: ["Value(USD)", "Value (USD)"] },
  { label: "Model / Catalog", required: false, aliases: ["Model/Catalog Number", "Model / Catalog No"] },
  { label: "Manufacturer", required: false, aliases: ["Actual Manufacturer", "Recommended Manufacturer", "Manufacturer", "Original Equipment Manufacturer"] },
  { label: "Serial #", required: false, aliases: ["Serial #"] },
  { label: "Unit of measure", required: false, aliases: ["Unit Of Measure Ordered", "Unit Of Measure Requested", "Unit Of Issue", "Unit Of Measure", "U/M"] },
];

/** Build a diagnostics report for a grid. Never throws. */
function udqDiagnose(grid) {
  const report = {
    detectedType: "unknown",
    signals: [],
    sections: [],
    shipment: { headerCount: 0, keyHeaders: [], partyBlocks: [] },
    inventory: null,
    parseError: "",
  };
  if (!grid || !grid.length) {
    report.parseError = "No worksheet rows were read from the file.";
    return report;
  }
  try {
    report.detectedType = detectUdqType(grid);

    /* ---- type-detection signals ---- */
    const row1 = [];
    for (let c = 1; c <= gridMaxCol(grid); c++) row1.push(normWs(gridCell(grid, 1, c)));
    const a2 = normWs(gridCell(grid, 2, 1));
    let wmtrCount = 0;
    const limR = Math.min(gridMaxRow(grid), 300);
    for (let r = 1; r <= limR; r++) {
      const v = normWs(gridCell(grid, r, 1)).toUpperCase();
      if (v.startsWith("WMTR-") && v.endsWith("-SRF")) wmtrCount++;
    }
    const propHeaders = ["Purchasing Instructions", "Recommended Vendor", "Recommended Manufacturer"];
    const propHdrRow = inventoryHeaderRow(grid);
    let propHit = "";
    for (let c = 1; c <= Math.min(gridMaxCol(grid), 30); c++) {
      const h = normWs(gridCell(grid, propHdrRow, c));
      if (propHeaders.includes(h)) { propHit = h; break; }
    }
    const invTitleRow = findSectionTitleRow(grid, "Inventory List");

    const sig = (label, found, detail) => report.signals.push({ label, found: !!found, detail: detail || "" });
    sig('Column A has 2+ "WMTR-…-SRF" values (Metrics)', wmtrCount >= 2, `${wmtrCount} found`);
    sig('Inventory-list Property header present', !!propHit, propHit ? `matched "${propHit}" on row ${propHdrRow}` : "none of: " + propHeaders.join(", "));
    sig('"WMTR Number" header in row 1 (SRF)', row1.includes("WMTR Number"), "");
    sig('Cell A2 begins with "WMTR-" (SRF)', a2.toUpperCase().startsWith("WMTR-"), a2 ? `A2 = "${a2}"` : "A2 empty");
    sig('"Inventory List" section title present', invTitleRow > 0, invTitleRow > 0 ? `row ${invTitleRow}` : "not found in first 300 rows");

    /* ---- section titles ---- */
    const sects = ["Inventory List"].concat(SECTION_STOP_TITLES);
    for (const t of sects) {
      const row = findSectionTitleRow(grid, t);
      report.sections.push({ title: t, found: row > 0, row: row || null });
    }

    /* ---- shipment header row ---- */
    const shipMap = buildHeaderMap(grid, SHIP_HDR_ROW);
    report.shipment.headerCount = Object.keys(shipMap).length;
    const keyHeaders = ["WMTR Number", "Final Total Cgo Weight", "Value of Cargo (USD)", "Country of Destination"];
    report.shipment.keyHeaders = keyHeaders.map((h) => ({ name: h, found: !!shipMap[normWs(h)] }));
    const partyPrefixes = [
      "Shipment Origin Organization", "Ultimate Consignee Organization",
      "End-User Organization", "Delivery Destination Organization",
      "Pickup Location Organization", "Intermediate Consignee Organization",
    ];
    report.shipment.partyBlocks = partyPrefixes.map((p) => ({
      name: p.replace(" Organization", ""),
      // a party block "exists" if its Organization header OR its Country header is present
      found: !!(shipMap[normWs(p)] || shipMap[normWs(p + " Country")]),
    }));

    /* ---- inventory columns (per detected/attempted layout) ---- */
    const treatAsProperty = report.detectedType === "property";
    const invHdrRow = inventoryHeaderRow(grid);
    const invMap = buildHeaderMap(grid, invHdrRow);
    const cols = [];
    if (treatAsProperty) {
      for (const g of PROP_INV_COL_GROUPS) {
        let matched = "", col = 0;
        for (const a of g.aliases) { if (invMap[normWs(a)]) { matched = a; col = invMap[normWs(a)]; break; } }
        cols.push({ label: g.label, required: g.required, found: !!col, col: col || null, matched, aliases: g.aliases });
      }
    } else {
      for (const name of SRF_REQUIRED_INV_COLS) cols.push({ label: name, required: true, found: !!invMap[normWs(name)], col: invMap[normWs(name)] || null });
      for (const name of SRF_OPTIONAL_INV_COLS) cols.push({ label: name, required: false, found: !!invMap[normWs(name)], col: invMap[normWs(name)] || null });
    }
    report.inventory = {
      layout: treatAsProperty ? "property" : "srf",
      headerRow: invHdrRow || null,
      columnCount: Object.keys(invMap).length,
      columns: cols,
      missingRequired: cols.filter((c) => c.required && !c.found).map((c) => c.label),
    };

    /* ---- attempt the real parse to capture any throw ---- */
    try {
      if (report.detectedType === "srf") readUdq(grid);
      else if (report.detectedType === "property") readPropertyUdq(grid);
    } catch (e) {
      report.parseError = String((e && e.message) || e);
    }
  } catch (e) {
    report.parseError = report.parseError || String((e && e.message) || e);
  }
  return report;
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    gridCell, buildHeaderMap, findSectionTitleRow,
    inventoryHeaderRow, inventoryStartRow, inventoryEndRow,
    shipValue, sectionTableValue, detectUdqType, readUdq, readPropertyUdq,
    cleanCountry, makeParty, makeLineItem,
    readLinkedRequestSections, readLinkedRequests, readConsolGroups,
    readInventorySections,
    analyzeConsolidation, _consolKey,
    LINKED_REQUEST_TITLE, LINKED_REQUEST_FIELD_MAP,
    udqDiagnose, SRF_REQUIRED_INV_COLS, SRF_OPTIONAL_INV_COLS, PROP_INV_COL_GROUPS,
  };
  // Pull util fns into scope for Node
  const u = require("./util.js");
  for (const k of Object.keys(u)) global[k] = u[k];
}
