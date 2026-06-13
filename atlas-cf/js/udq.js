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
];

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

    // --- Property Management: unique row-4 headers ---
    const propertyHeaders = ["Purchasing Instructions", "Recommended Vendor", "Recommended Manufacturer"];
    for (let c = 1; c <= maxCol; c++) {
      if (propertyHeaders.includes(normWs(gridCell(grid, 4, c)))) return "property";
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
    purpose: "Donation",
    payment_terms: "No Commercial Value",
    payment_terms_remarks: "No Charge (NC)",
    incoterm: incoterms,
    shipment_ref_no: "",
    mode_of_transit: shipValue(grid, shipMap, "Requested Mode of Transit"),
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
  const cQty = _propInvColFirst(invMap,
    "Quantity Ordered", "Quantity Received", "Quantity Requested",
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
  for (let r = invStartRow; r <= gridMaxRow(grid); r++) {
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

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    gridCell, buildHeaderMap, findSectionTitleRow,
    inventoryHeaderRow, inventoryStartRow, inventoryEndRow,
    shipValue, sectionTableValue, detectUdqType, readUdq, readPropertyUdq,
    cleanCountry, makeParty, makeLineItem,
  };
  // Pull util fns into scope for Node
  const u = require("./util.js");
  for (const k of Object.keys(u)) global[k] = u[k];
}
