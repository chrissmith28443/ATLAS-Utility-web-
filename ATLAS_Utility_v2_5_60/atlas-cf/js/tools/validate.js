/* =========================================================================
   ATLAS Utility Web — validate.js
   UDQ Pre-flight Validator (Feature #1).

   A read-only compliance/sanity pass that runs the moment a UDQ loads, BEFORE
   anyone generates a packet. It surfaces problems that cause rejected or
   non-compliant shipments: export-controlled items missing classification or
   authorization, hazmat items with incomplete classification, parties missing
   required address/POC fields, line-item values that don't reconcile to the
   shipment cargo value, weight/volume gaps, and a blank country of destination.

   DESIGN NOTES
     * ADVISORY ONLY. This panel never blocks a generate button. It reports
       findings at three severities (error / warning / info). Turning any check
       into a hard block (e.g. refuse to generate a CI when an export-controlled
       item has no ECCN) is a deliberate follow-on, intentionally not done here
       so the validator is purely additive and cannot break existing tools.
     * SELF-CONTAINED. It reuses only the shared text/number helpers (norm,
       toFloat, esc, …). The export-control rule below is an intentional mirror
       of ecm.js `_ecmAuthIsControlled` so the two tools agree on what "export
       controlled" means; it is re-declared here so load order can't matter.
     * NEVER THROWS. validateUdq() wraps its work in try/catch and always returns
       a result object, so a validator bug can never break file loading.

   Coverage by UDQ type:
     * srf       — full suite (export control, hazmat, parties, value, wt/vol,
                   country, per-item COO), using the rich SRF line-item model.
     * property  — reduced suite (inventory presence, value presence, parties,
                   country). The property reader does not parse HTS/ECCN/auth or
                   hazmat columns, so those checks are not applicable.
     * metrics   — not validated here (it's a multi-WMTR roll-up); the panel
                   points users to ECM/PMR instead.
     * unknown   — explains that the file isn't a recognized UDQ layout.
   ========================================================================= */

/* ---- severity constants ---- */
const VSEV = { ERROR: "error", WARN: "warning", INFO: "info" };

/* ---- export-control rule (mirror of ecm.js `_ecmAuthIsControlled`) ---- */
function _valAuthIsControlled(v) {
  const s = norm(v).toUpperCase();
  if (!s) return false;
  if (/\bN\s*[/_\- ]?\s*A\b/.test(s)) return false; // N/A, N A, N-A, …
  if (/\bNLR\b/.test(s)) return false;              // No License Required
  return true;
}

/* ECCN/USML values that mean "not controlled" (EAR99 is the uncontrolled
   catch-all). Anything else populated is treated as a real classification. */
const _VAL_ECCN_UNCONTROLLED = new Set(["", "EAR99", "N/A", "NA", "N\\A", "NLR", "NONE"]);
function _valEccnMeaningful(v) {
  const s = norm(v).toUpperCase();
  return !_VAL_ECCN_UNCONTROLLED.has(s);
}

function _valHas(v) { return !!normWs(v); }

/* Human-readable detail for an incomplete consolidation group. Lists the group
   members and each missing reciprocal Consol link so the user can fix it in ATLAS. */
function _valConsolDetail(c) {
  const id = (w) => normWs(w).toUpperCase().replace(/-SRF$/, "");
  const names = c.members.map((m) => id(m.wmtr)).join(", ");
  const miss = c.missing.map((x) =>
    `${id(x.fromWmtr)} does not list ${id(x.toWmtr)}${x.toInFile ? "" : " (not in this dataset)"}`);
  return `These requests are linked for consolidation under one AWB but do not all reference ` +
    `each other: ${names}. Missing reciprocal Consol link${miss.length === 1 ? "" : "s"}: ` +
    `${miss.join("; ")}. Every consolidated request should list all the others — please verify in ATLAS.`;
}

function _valSameCountry(a, b) {
  const usAliases = new Set(["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA", "AMERICA"]);
  const canon = (s) => {
    const u = normWs(s).toUpperCase().replace(/\u00A0/g, " ").replace(/\./g, "").replace(/\s+/g, " ").trim();
    return usAliases.has(u) ? "UNITED STATES" : u;
  };
  const ca = canon(a), cb = canon(b);
  return !!ca && ca === cb;
}

/* ---- finding factory ----
   `code` is a STABLE identifier for the *kind* of finding (independent of the
   dynamic line number / country in the title). It's what the configurable
   generation gate (Settings ▸ Validation gate) keys off, so the same logical
   problem on different lines shares one code. Only ERROR-severity checks carry
   codes today, since those are the only ones offered as hard blocks. */
function _vFind(sev, cat, title, detail, line, code) {
  return { sev, cat, title, detail: detail || "", line: line == null ? null : line, code: code || null };
}

/* The checks a user may promote from "advisory" to "blocks generation".
   Keep this list and the codes assigned in _validateSrf/_validateProperty/
   _valPartyChecks in sync. Order here is the order shown in Settings. */
const VAL_BLOCKABLE = [
  { code: "routing.no_dest_country", label: "Destination country is blank" },
  { code: "ec.eccn_missing",         label: "Export-controlled item with no ECCN/USML" },
  { code: "ec.auth_missing",         label: "Classified item (ECCN/USML) with no export determination (blank BIS/DDTC)" },
  { code: "hazmat.class_missing",    label: "UN code with no hazard class" },
  { code: "party.no_address",        label: "A required party has no address" },
  { code: "party.no_country",        label: "A required party has no country" },
  { code: "inventory.empty",         label: "No inventory line items" },
];
function _valBlockableLabel(code) {
  const e = VAL_BLOCKABLE.find((x) => x.code === code);
  return e ? e.label : code;
}

/* =========================================================================
   Party checks (shared by srf + property; both use the makeParty shape)
   ========================================================================= */
function _valPartyChecks(findings, parties) {
  const hasAddr = (p) => p && p.addr_lines && p.addr_lines.some((l) => normWs(l));
  const hasCountry = (p) => p && normWs(p.country);
  const hasContact = (p) => p && normWs(p.contact);
  const hasReach = (p) => p && (normWs(p.phone) || normWs(p.email));
  const anyData = (p) => hasAddr(p) || hasCountry(p) || hasContact(p) || hasReach(p);

  // [label, party, required?]  — required parties hard-error on missing core fields.
  const defs = [
    ["Shipment origin", parties.origin, true],
    ["Ultimate consignee", parties.consignee, true],
    ["End user", parties.end_user, true],
    ["Delivery destination", parties.deliver, false],
    ["Pickup location", parties.pickup, false],
    ["Intermediate consignee", parties.intermediate, false],
  ];

  for (const [label, party, required] of defs) {
    if (required) {
      if (!hasAddr(party)) findings.push(_vFind(VSEV.ERROR, "Parties", `${label} has no address`,
        "A required party is missing its street/address lines.", null, "party.no_address"));
      if (!hasCountry(party)) findings.push(_vFind(VSEV.ERROR, "Parties", `${label} has no country`,
        "Country is required for customs and routing.", null, "party.no_country"));
      if (!hasContact(party)) findings.push(_vFind(VSEV.WARN, "Parties", `${label} has no point of contact`,
        "No POC/contact name captured for this party."));
      if (!hasReach(party)) findings.push(_vFind(VSEV.WARN, "Parties", `${label} has no phone or email`,
        "Neither a phone nor an email is present for this party."));
    } else {
      // Optional party: only flag if it's partially filled (started but incomplete).
      if (anyData(party)) {
        if (!hasAddr(party)) findings.push(_vFind(VSEV.WARN, "Parties", `${label} is partially filled`,
          "Some data is present but the address is missing."));
        else if (!hasCountry(party)) findings.push(_vFind(VSEV.WARN, "Parties", `${label} is missing its country`,
          "Address is present but country is blank."));
      }
    }
  }
}

/* =========================================================================
   SRF validation (full suite)
   ========================================================================= */
function _validateSrf(data) {
  const findings = [];
  const m = data.meta || {};
  const items = data.items || [];
  const packages = data.packages || [];
  const raw = m.totals_raw || {};

  // Track per-line problem cells so the table can highlight them.
  const flags = {}; // line -> Set of column keys
  const flag = (line, col) => {
    if (line == null) return;
    (flags[line] = flags[line] || new Set()).add(col);
  };

  /* --- Country of destination / origin --- */
  if (!_valHas(m.country_destination)) {
    findings.push(_vFind(VSEV.ERROR, "Routing", "Country of destination is blank",
      "Every shipment needs an explicit country of destination.", null, "routing.no_dest_country"));
  }
  if (!_valHas(m.country_origin)) {
    findings.push(_vFind(VSEV.WARN, "Routing", "Country of origin is blank",
      "Country of origin is not populated on the shipment header."));
  }

  /* --- Per-item: export control, hazmat, COO --- */
  let hazmatCount = 0;
  const missingCoo = [];
  const missingHtsControlled = [];

  for (const it of items) {
    const line = it.line;

    // Export control
    const authControlled = _valAuthIsControlled(it.auth);
    const eccnMeaningful = _valEccnMeaningful(it.eccn);
    const controlled = authControlled || eccnMeaningful;

    if (controlled) {
      if (!eccnMeaningful) {
        // Controlled by authorization, but no classification given.
        findings.push(_vFind(VSEV.ERROR, "Export control",
          `Line ${line}: export-controlled, but ECCN/USML is blank`,
          `Authorization "${norm(it.auth)}" indicates control, yet no ECCN/USML classification is recorded.`,
          line, "ec.eccn_missing"));
        flag(line, "eccn");
      }
      if (!authControlled && !_valHas(it.auth)) {
        // Classified item with NO export determination recorded at all.
        // NOTE: an explicit "NLR" (No License Required) or "N/A" is a VALID
        // determination for many CCL classifications (e.g. 5A991/5A992 mass-
        // market items), so those are accepted here and no longer flagged.
        // Only a genuinely blank BIS/DDTC field is treated as a gap.
        findings.push(_vFind(VSEV.ERROR, "Export control",
          `Line ${line}: classified (ECCN/USML ${norm(it.eccn)}) with no export determination`,
          "An ECCN/USML is present but the BIS/DDTC field is blank — no license, license exception, or NLR/N-A determination is recorded.",
          line, "ec.auth_missing"));
        flag(line, "auth");
      }
      if (!_valHas(it.hts)) {
        missingHtsControlled.push(line);
        flag(line, "hts");
      }
    }

    // Hazmat (also feeds the future DGD flag, feature #8)
    const unHas = _valHas(it.un_code);
    const clHas = _valHas(it.hazmat_class);
    if (unHas || clHas) hazmatCount++;
    if (unHas && !clHas) {
      findings.push(_vFind(VSEV.ERROR, "Hazmat",
        `Line ${line}: UN code ${norm(it.un_code)} with no hazard class`,
        "A UN number is present but the HAZMAT/Dangerous Goods classification is blank.",
        line, "hazmat.class_missing"));
      flag(line, "hazmat_class");
    } else if (clHas && !unHas) {
      findings.push(_vFind(VSEV.WARN, "Hazmat",
        `Line ${line}: hazard class "${norm(it.hazmat_class)}" with no UN code`,
        "A hazard class is present but no UN identification number was captured.",
        line));
      flag(line, "un_code");
    }

    // Country of origin (per item, used on the CI)
    if (!_valHas(it.coo)) { missingCoo.push(line); flag(line, "coo"); }

    // --- Format sanity (cheap data-entry checks) ---
    // Accept one OR MORE UN numbers, each "UN####" or just "####", separated by
    // a comma, space, or semicolon (e.g. "UN1203, 1090" or "UN1203; UN1090").
    // The optional space inside "UN ####" is tolerated and not treated as a
    // separator. Only flag when the whole field can't be read as UN numbers.
    if (unHas && !/^(?:UN\s?)?\d{4}(?:(?:\s*[,;]\s*|\s+)(?:UN\s?)?\d{4})*$/i.test(norm(it.un_code))) {
      findings.push(_vFind(VSEV.WARN, "Hazmat",
        `Line ${line}: UN code "${norm(it.un_code)}" is not in UN#### form`,
        'Expected UN numbers like "UN1203" (or just "1203"); multiple codes may be separated by a comma, space, or semicolon.',
        line));
      flag(line, "un_code");
    }
    if (eccnMeaningful) {
      const ev = norm(it.eccn);
      // ECCN: 5-character base (category digit + product-group letter A-E +
      // three digits), optionally followed by one or more period-separated
      // subparagraphs.  ok: 5A991 · 5A991.g · 5A991.g.1 · 3A992.a
      const eccnRe = /^\d[A-E]\d{3}(?:\.[A-Za-z0-9]+)*$/i;
      // USML: a Roman-numeral category, optionally followed by subparagraphs
      // delimited by periods and/or parentheses (one or more, may be mixed).
      //   ok: XII · XII.e · XII(e) · XII(e)(1) · XII.e.1
      const usmlRe = /^[IVXLC]+(?:\.[A-Za-z0-9]+|\([A-Za-z0-9]+\))*$/i;
      const eccnOk =
        eccnRe.test(ev) ||
        /^EAR99$/i.test(ev) ||
        usmlRe.test(ev) ||
        /\b(?:USML|CATEGORY)\b/i.test(ev);   // tolerate an explicit "USML ..." label
      if (!eccnOk) {
        findings.push(_vFind(VSEV.INFO, "Export control",
          `Line ${line}: ECCN/USML "${ev}" has an unexpected format`,
          "Expected an ECCN like 5A991.g (5-character base plus period-separated " +
          "subparagraphs) or a USML category like XII, XII.e, or XII(e).",
          line));
        flag(line, "eccn");
      }
    }
    if (_valHas(it.hts)) {
      const d = String(it.hts).replace(/\D/g, "");
      if (d.length && [6, 8, 10].indexOf(d.length) === -1) {
        findings.push(_vFind(VSEV.WARN, "Commercial invoice",
          `Line ${line}: HTS/Schedule B has ${d.length} digit${d.length === 1 ? "" : "s"}`,
          "Schedule B / HTS codes are normally 6, 8, or 10 digits — verify the number.",
          line));
        flag(line, "hts");
      }
    }
  }

  if (missingHtsControlled.length) {
    findings.push(_vFind(VSEV.WARN, "Export control",
      `${missingHtsControlled.length} export-controlled item${missingHtsControlled.length === 1 ? "" : "s"} missing Schedule B/HTS`,
      `Lines: ${missingHtsControlled.join(", ")}.`));
  }
  if (missingCoo.length) {
    findings.push(_vFind(VSEV.WARN, "Commercial invoice",
      `${missingCoo.length} item${missingCoo.length === 1 ? "" : "s"} missing country of origin (COO)`,
      `The Commercial Invoice lists COO per line. Lines: ${missingCoo.join(", ")}.`));
  }
  if (hazmatCount) {
    findings.push(_vFind(VSEV.INFO, "Hazmat",
      `${hazmatCount} item${hazmatCount === 1 ? "" : "s"} flagged with hazmat data`,
      "These items carry a UN code and/or hazard class — a separate Dangerous Goods Declaration may be required."));
  }

  if (_valHas(m.country_origin) && _valHas(m.country_destination) &&
      _valSameCountry(m.country_origin, m.country_destination)) {
    findings.push(_vFind(VSEV.WARN, "Routing",
      "Origin and destination are the same country",
      `Both are "${norm(m.country_destination)}". For an export shipment this usually points to a data-entry error.`));
  }

  /* --- Value reconciliation --- */
  const itemSum = Number(raw.value_usd || 0);
  const cargo = toFloat(m.value_of_cargo);
  if (!cargo) {
    findings.push(_vFind(VSEV.INFO, "Value",
      "Cannot reconcile line-item values",
      `Shipment header "Value of Cargo (USD)" is blank; line items total ${fmtMoney(itemSum) || "0.00"}.`));
  } else {
    const diff = Math.abs(itemSum - cargo);
    const tol = Math.max(0.01, cargo * 0.005); // 0.5% or one cent, whichever is larger
    if (diff > tol) {
      findings.push(_vFind(VSEV.WARN, "Value",
        "Line-item total doesn't reconcile to cargo value",
        `Line items sum to ${fmtMoney(itemSum)} but the shipment header "Value of Cargo" is ${fmtMoney(cargo)} ` +
        `(difference ${fmtMoney(diff)}).`));
    }
  }

  /* --- Weight / volume sanity --- */
  const udqLbs = Number(raw.udq_lbs || 0);
  const pkgLbs = Number(raw.pkg_lbs || 0);
  const udqFt3 = Number(raw.udq_ft3 || 0);
  const pkgFt3 = Number(raw.pkg_ft3 || 0);

  if (udqLbs <= 0) {
    findings.push(_vFind(VSEV.WARN, "Weight/volume", "No total cargo weight",
      'The shipment header "Final Total Cgo Weight" is blank or zero.'));
  }
  if (packages.length && pkgLbs <= 0) {
    findings.push(_vFind(VSEV.WARN, "Weight/volume", "Package rows have no weight",
      `${packages.length} package row${packages.length === 1 ? "" : "s"} present but their weights total zero.`));
  }
  if (udqLbs > 0 && pkgLbs > 0) {
    const wdiff = Math.abs(udqLbs - pkgLbs);
    if (wdiff > Math.max(1, udqLbs * 0.05)) {
      findings.push(_vFind(VSEV.INFO, "Weight/volume", "Header vs package weights differ",
        `Header total ${fmtFixed2(udqLbs)} lb vs package rows ${fmtFixed2(pkgLbs)} lb ` +
        `(difference ${fmtFixed2(wdiff)} lb). Tare/gross differences can be normal.`));
    }
  }
  if (packages.length && pkgFt3 <= 0) {
    const noDims = packages.filter((p) => !_valHas(p.dims)).length;
    findings.push(_vFind(VSEV.WARN, "Weight/volume", "No package volume",
      noDims
        ? `${noDims} package row${noDims === 1 ? "" : "s"} have no dimensions, so volume can't be computed.`
        : "Package dimensions did not yield a usable volume."));
  } else if (udqFt3 <= 0 && !packages.length) {
    findings.push(_vFind(VSEV.INFO, "Weight/volume", "No volume captured",
      "No total volume on the header and no package rows to derive it from."));
  }

  /* --- Inventory presence --- */
  if (!items.length) {
    findings.push(_vFind(VSEV.ERROR, "Inventory", "No inventory line items",
      "The Inventory List produced no shippable line items.", null, "inventory.empty"));
  }

  /* --- Parties --- */
  _valPartyChecks(findings, data.parties || {});

  return { findings, flags, itemFlags: flags };
}

/* =========================================================================
   Property validation (reduced suite)
   ========================================================================= */
function _validateProperty(data) {
  const findings = [];
  const m = data.meta || {};
  const items = data.items || [];
  const flags = {};
  const flag = (line, col) => { if (line == null) return; (flags[line] = flags[line] || new Set()).add(col); };

  if (!_valHas(m.country_destination) && !_valHas(m.partner_country)) {
    findings.push(_vFind(VSEV.ERROR, "Routing", "Partner / destination country is blank",
      "No Country of Destination or CTR Country on the shipment header.", null, "routing.no_dest_country"));
  }

  if (!items.length) {
    findings.push(_vFind(VSEV.ERROR, "Inventory", "No inventory items",
      "The Property Management Inventory List produced no items.", null, "inventory.empty"));
  }

  let missingDesc = 0, missingVal = 0, valueSum = 0;
  for (const it of items) {
    const line = it.item_no;
    if (!_valHas(it.desc)) { missingDesc++; flag(line, "desc"); }
    const v = Number(it.unit_value || 0) * Number(it.qty || 0);
    if (!Number(it.unit_value)) { missingVal++; flag(line, "value"); }
    if (Number.isFinite(v)) valueSum += v;
  }
  if (missingDesc) {
    findings.push(_vFind(VSEV.WARN, "Inventory",
      `${missingDesc} item${missingDesc === 1 ? "" : "s"} missing a description`, ""));
  }
  if (missingVal) {
    findings.push(_vFind(VSEV.WARN, "Value",
      `${missingVal} item${missingVal === 1 ? "" : "s"} have no unit value`,
      "Items with no value won't contribute to the cargo total."));
  }

  const cargo = toFloat(m.value_of_cargo);
  if (cargo && valueSum) {
    const diff = Math.abs(valueSum - cargo);
    const tol = Math.max(0.01, cargo * 0.005);
    if (diff > tol) {
      findings.push(_vFind(VSEV.WARN, "Value", "Inventory total doesn't reconcile to cargo value",
        `Inventory (qty × unit value) sums to ${fmtMoney(valueSum)} vs header "Value of Cargo" ${fmtMoney(cargo)} ` +
        `(difference ${fmtMoney(diff)}).`));
    }
  } else if (!cargo) {
    findings.push(_vFind(VSEV.INFO, "Value", "Cannot reconcile inventory values",
      `Shipment header "Value of Cargo (USD)" is blank; inventory totals ${fmtMoney(valueSum) || "0.00"}.`));
  }

  _valPartyChecks(findings, data.parties || {});

  return { findings, flags, itemFlags: flags };
}

/* =========================================================================
   Public entry — never throws.
   ========================================================================= */
function validateUdq(state) {
  const out = {
    type: state ? state.udqType : "none",
    ran: false,
    counts: { error: 0, warning: 0, info: 0 },
    findings: [],
    itemFlags: {},
    note: "",
  };
  try {
    const type = state && state.udqType;
    if (type === "srf" && state.data) {
      const r = _validateSrf(state.data);
      out.findings = r.findings; out.itemFlags = r.itemFlags; out.ran = true;
    } else if (type === "property" && state.data) {
      const r = _validateProperty(state.data);
      out.findings = r.findings; out.itemFlags = r.itemFlags; out.ran = true;
    } else if (type === "metrics") {
      // Metrics isn't a single-shipment compliance pass, but we can verify one
      // structural invariant: Consol (consolidation) links must be reciprocal
      // across every member of a consolidation group. Surface any that aren't.
      try {
        const analysis = (typeof analyzeConsolidation === "function")
          ? analyzeConsolidation(state.grid) : { discrepancies: [] };
        for (const c of analysis.discrepancies) {
          out.findings.push(_vFind(VSEV.WARN, "Consolidation",
            `Consolidation group may be incomplete (${c.members.length} requests)`,
            _valConsolDetail(c)));
        }
      } catch (e) { /* never breaks loading */ }
      out.ran = true;
      out.note = "Metrics UDQs are a multi-WMTR roll-up, not a single shipment, so " +
        "per-shipment checks (export control, hazmat, parties) run on SRF and Property " +
        "UDQs instead. For Metrics, the pre-flight verifies that Consol (consolidation) " +
        "links are reciprocal across all members of each group. Use the Export-Controlled " +
        "Materials and PMR tools for the rest of the Metrics analysis.";
    } else if (type === "unknown") {
      out.note = "This file doesn't match a recognized UDQ layout, so it can't be validated. " +
        "Check that it's an unmodified ATLAS export.";
    } else {
      out.note = "Load a UDQ to run pre-flight validation.";
    }
  } catch (e) {
    // A validator bug must never break the app — report it as a finding.
    out.findings = [_vFind(VSEV.WARN, "Validator", "Validation could not complete",
      String((e && e.message) || e))];
    out.ran = true;
  }
  for (const f of out.findings) {
    if (out.counts[f.sev] != null) out.counts[f.sev]++;
  }
  return out;
}

/* Recompute + cache on AppState. Safe to call anytime. */
function ensureValidation() {
  try {
    AppState.validation = validateUdq(AppState);
  } catch (e) {
    AppState.validation = { type: AppState.udqType, ran: false, counts: { error: 0, warning: 0, info: 0 }, findings: [], itemFlags: {}, note: "" };
  }
  return AppState.validation;
}

/* =========================================================================
   Dashboard banner — compact verdict shown atop the dashboard on load.
   ========================================================================= */
function validationBanner() {
  const v = AppState.validation;
  if (!v || !v.ran) return null;

  // Some findings are stage-specific. An RFQ solicits a freight quote *before*
  // the export determination is made, so a blank BIS/DDTC authorization ("no
  // export determination") is expected at that stage and isn't required for the
  // RFQ — suppress it from the pre-flight while the RFQ tool is active. It still
  // flags for CI / SLI / export documents and in the full Validate audit.
  const RFQ_SUPPRESS = new Set(["ec.auth_missing"]);
  const suppress = (AppState.activeTool === "rfq") ? RFQ_SUPPRESS : null;
  const findings = suppress ? v.findings.filter((f) => !suppress.has(f.code)) : v.findings;
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) if (counts[f.sev] != null) counts[f.sev]++;

  const { error, warning, info } = counts;
  let cls, icon, text;
  if (error) {
    cls = "vb-error"; icon = "\u2715";
    text = `${error} error${error === 1 ? "" : "s"}` +
      (warning ? `, ${warning} warning${warning === 1 ? "" : "s"}` : "");
  } else if (warning) {
    cls = "vb-warn"; icon = "\u26A0";
    text = `${warning} warning${warning === 1 ? "" : "s"}` +
      (info ? `, ${info} note${info === 1 ? "" : "s"}` : "");
  } else {
    cls = "vb-ok"; icon = "\u2713";
    text = info ? `All clear · ${info} note${info === 1 ? "" : "s"}` : "All clear — no issues found";
  }
  const node = el(`
    <div class="valbanner ${cls}" role="status">
      <span class="vb-ico">${icon}</span>
      <span class="vb-text">Pre-flight: ${esc(text)}</span>
      <button class="btn ghost vb-open" type="button">View details</button>
    </div>`);
  node.querySelector(".vb-open").addEventListener("click", () => {
    AppState.activeTool = "validate";
    renderRail();
    renderWorkspace();
    const ws = document.getElementById("workspace");
    if (ws) ws.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  return node;
}

/* =========================================================================
   Workspace panel
   ========================================================================= */
const VAL_STYLE = `
  .valpanel .vsum{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;margin-bottom:14px;font-weight:600;}
  .valpanel .vsum .big{font-size:1.05rem;}
  .valpanel .vsum.ok{background:rgba(46,160,67,.12);border:1px solid rgba(46,160,67,.45);}
  .valpanel .vsum.warn{background:rgba(210,153,34,.14);border:1px solid rgba(210,153,34,.5);}
  .valpanel .vsum.err{background:rgba(218,54,51,.13);border:1px solid rgba(218,54,51,.5);}
  .valpanel .vsum .pill{font-weight:600;font-size:.8rem;padding:2px 9px;border-radius:999px;border:1px solid var(--line);}
  .valpanel .vsum .pill.e{color:#b32424;border-color:rgba(218,54,51,.5);}
  .valpanel .vsum .pill.w{color:#9a6a00;border-color:rgba(210,153,34,.55);}
  .valpanel .vsum .pill.i{color:#5a6472;}
  .valpanel .vnote{color:var(--steel);padding:8px 0 4px;}
  .valpanel .vgroup{margin:14px 0 4px;font:600 .82rem/1 var(--disp);letter-spacing:.04em;text-transform:uppercase;color:var(--steel);}
  .valpanel .vlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;}
  .valpanel .vrow{display:flex;gap:10px;align-items:flex-start;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--card,transparent);}
  .valpanel .vrow .sev{flex:0 0 auto;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:#fff;margin-top:1px;}
  .valpanel .vrow.error .sev{background:#da3633;}
  .valpanel .vrow.warning .sev{background:#d29922;}
  .valpanel .vrow.info .sev{background:#6b7785;}
  .valpanel .vrow .cat{flex:0 0 auto;font-size:.72rem;color:var(--steel);border:1px solid var(--line);border-radius:6px;padding:1px 6px;margin-top:1px;white-space:nowrap;}
  .valpanel .vrow .vmsg{flex:1 1 auto;}
  .valpanel .vrow .vmsg .t{font-weight:600;}
  .valpanel .vrow .vmsg .d{color:var(--steel);font-size:.9em;margin-top:2px;}
  .valpanel .cell-bad{background:rgba(218,54,51,.16);outline:1px solid rgba(218,54,51,.45);}
  .valpanel .advisory{color:var(--steel);font-size:.82rem;margin-top:14px;font-style:italic;}
`;

function _valSevIcon(sev) {
  return sev === VSEV.ERROR ? "\u2715" : sev === VSEV.WARN ? "\u26A0" : "i";
}

function renderValidateWorkspace(container) {
  ensureValidation();
  const v = AppState.validation || { ran: false, counts: { error: 0, warning: 0, info: 0 }, findings: [], note: "" };
  const wmtr = (AppState.data && AppState.data.meta && AppState.data.meta.wmtr) || "";

  const gateOn = (typeof atlasHardBlockActive === "function") && atlasHardBlockActive();
  const gateLine = gateOn
    ? `<strong>Validation gate is ON</strong> — selected errors will block document generation until fixed or overridden. Manage it in Settings ▸ Validation gate.`
    : `<strong>Advisory only</strong> — it never blocks document generation. You can turn selected errors into hard blocks in Settings ▸ Validation gate.`;

  const panel = el(`
    <div class="panel valpanel">
      <style>${VAL_STYLE}</style>
      <header><h2>Pre-flight validation</h2><span class="count">${esc(wmtr || (AppState.udqType || "").toUpperCase() || "—")}</span></header>
      <div class="body">
        <div class="note">
          Runs automatically when a UDQ loads. Checks export-controlled items for missing HTS / ECCN-USML /
          authorization, hazmat items for incomplete classification, parties for required address &amp; POC fields,
          line-item values against the shipment cargo value, weight/volume sanity, and the country of destination.
          ${gateLine}
        </div>
        <div id="valBody"></div>
        <div class="btnrow" style="margin-top:14px;">
          <button class="btn ghost" id="valRerun">Re-run</button>
        </div>
      </div>
    </div>`);
  container.appendChild(panel);
  panel.querySelector("#valRerun").addEventListener("click", () => {
    ensureValidation();
    _valRenderBody(document.getElementById("valBody"));
    // keep the dashboard banner in sync
    if (typeof renderDashboard === "function") renderDashboard();
  });

  _valRenderBody(panel.querySelector("#valBody"));
}

function _valRenderBody(body) {
  if (!body) return;
  const v = AppState.validation || { ran: false, counts: { error: 0, warning: 0, info: 0 }, findings: [], note: "" };
  body.innerHTML = "";

  if (!v.ran) {
    body.appendChild(el(`<div class="vnote">${esc(v.note || "Nothing to validate yet.")}</div>`));
    return;
  }

  const { error, warning, info } = v.counts;
  const cls = error ? "err" : warning ? "warn" : "ok";
  const verdict = error ? "Errors found" : warning ? "Warnings found" : "All clear";
  body.appendChild(el(`
    <div class="vsum ${cls}">
      <span class="big">${esc(verdict)}</span>
      <span class="pill e">${error} error${error === 1 ? "" : "s"}</span>
      <span class="pill w">${warning} warning${warning === 1 ? "" : "s"}</span>
      <span class="pill i">${info} note${info === 1 ? "" : "s"}</span>
    </div>`));

  if (!v.findings.length) {
    body.appendChild(el(`<div class="vnote">No issues detected. This UDQ looks ready to generate from.</div>`));
  } else {
    const order = [VSEV.ERROR, VSEV.WARN, VSEV.INFO];
    const labels = { error: "Errors", warning: "Warnings", info: "Notes" };
    for (const sev of order) {
      const rows = v.findings.filter((f) => f.sev === sev);
      if (!rows.length) continue;
      body.appendChild(el(`<div class="vgroup">${labels[sev]}</div>`));
      const ul = el(`<ul class="vlist"></ul>`);
      for (const f of rows) {
        ul.appendChild(el(`
          <li class="vrow ${f.sev}">
            <span class="sev">${_valSevIcon(f.sev)}</span>
            <span class="cat">${esc(f.cat)}</span>
            <span class="vmsg">
              <span class="t">${esc(f.title)}</span>
              ${f.detail ? `<span class="d">${esc(f.detail)}</span>` : ""}
            </span>
          </li>`));
      }
      body.appendChild(ul);
    }
  }

  // Per-item table with highlighted problem cells (SRF only — richest model)
  if (AppState.udqType === "srf" && AppState.data && AppState.data.items.length) {
    body.appendChild(_valItemTable(v.itemFlags || {}));
  }

  const gateOn2 = (typeof atlasHardBlockActive === "function") && atlasHardBlockActive();
  body.appendChild(el(`<div class="advisory">${gateOn2
    ? "Findings marked as blocking (Settings \u25B8 Validation gate) will stop generation until fixed or overridden. Other findings remain advisory."
    : "Findings are advisory. None of them prevent generating any document."}</div>`));
}

function _valItemTable(itemFlags) {
  const items = AppState.data.items;
  const bad = (line, col) => itemFlags[line] && itemFlags[line].has(col) ? "cell-bad" : "";
  const rows = items.map((it) => `
    <tr>
      <td class="num">${esc(it.line)}</td>
      <td>${esc(it.desc)}</td>
      <td class="mono ${bad(it.line, "hts")}">${esc(it.hts) || "—"}</td>
      <td class="mono ${bad(it.line, "eccn")}">${esc(it.eccn) || "—"}</td>
      <td class="mono ${bad(it.line, "auth")}">${esc(it.auth) || "—"}</td>
      <td class="${bad(it.line, "coo")}">${esc(it.coo) || "—"}</td>
      <td class="mono ${bad(it.line, "un_code")}">${esc(it.un_code) || "—"}</td>
      <td class="${bad(it.line, "hazmat_class")}">${esc(it.hazmat_class) || "—"}</td>
    </tr>`).join("");

  return el(`
    <div style="margin-top:16px;">
      <div class="vgroup">Line items</div>
      <div class="scrollwrap" style="max-height:420px;">
        <table class="data">
          <thead><tr>
            <th>#</th><th>Description</th><th>HTS</th><th>ECCN/USML</th>
            <th>Auth</th><th>COO</th><th>UN code</th><th>Hazard class</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`);
}

/* =========================================================================
   Configurable hard-block GATE (Feature #3)

   By default the validator is advisory and never blocks generation (parity with
   the desktop app). A user can opt specific ERROR findings into "blocking" via
   Settings ▸ Validation gate. When enabled and a blocking finding is present,
   the document generators route through a confirmation dialog that lets the
   user either fix the data or OVERRIDE — because sometimes a draft is needed
   before every detail is in hand. Overrides are recorded to the run history.

   Integration contract: every document generator calls, as its first line,
       if (!atlasGenerateGate(toolId, thisFnOrClosure)) return;
   The gate returns true to proceed. If it returns false it has opened the
   dialog; on "Generate anyway" it sets a one-shot bypass and re-invokes the
   supplied proceed callback, which calls back into the same generator — this
   time the gate sees the bypass and returns true.
   ========================================================================= */

function atlasHardBlockConfig() {
  try {
    const s = (typeof AtlasSettings !== "undefined") ? AtlasSettings.get() : {};
    const hb = s.hardBlock || {};
    return { enabled: !!hb.enabled, codes: hb.codes || {} };
  } catch (e) { return { enabled: false, codes: {} }; }
}

/** Is the gate active AND at least one code actually turned on? */
function atlasHardBlockActive() {
  const hb = atlasHardBlockConfig();
  if (!hb.enabled) return false;
  return Object.keys(hb.codes).some((k) => hb.codes[k]);
}

/** Findings in the current validation that match enabled blocking codes. */
function atlasBlockingFindings() {
  const hb = atlasHardBlockConfig();
  if (!hb.enabled) return [];
  if (typeof ensureValidation === "function") ensureValidation();
  const findings = (AppState && AppState.validation && AppState.validation.findings) || [];
  return findings.filter((f) => f && f.code && hb.codes[f.code]);
}

let _atlasGateBypass = false;

function atlasGenerateGate(toolId, proceedFn) {
  if (_atlasGateBypass) { _atlasGateBypass = false; return true; } // one-shot override
  const blocking = atlasBlockingFindings();
  if (!blocking.length) return true;
  _openHardBlockDialog(toolId, blocking, () => {
    _atlasGateBypass = true;
    try { if (typeof proceedFn === "function") proceedFn(); }
    finally { _atlasGateBypass = false; } // clear if proceedFn returned synchronously without re-gating
  });
  return false;
}

const HARDBLOCK_STYLE = `
  .hb-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1200;padding:7vh 16px;overflow:auto;}
  .hb-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:520px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .hb-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);}
  .hb-dialog header h2{margin:0;font:600 1.05rem var(--disp);}
  .hb-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .hb-body{padding:16px 18px;}
  .hb-body p{margin:0 0 10px;}
  .hb-list{list-style:none;margin:8px 0 12px;padding:0;display:flex;flex-direction:column;gap:7px;}
  .hb-list li{display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border:1px solid rgba(218,54,51,.5);border-radius:9px;background:rgba(218,54,51,.10);}
  .hb-list .sev{flex:0 0 auto;width:18px;height:18px;border-radius:50%;background:#da3633;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;margin-top:1px;}
  .hb-list .t{font-weight:600;}
  .hb-list .d{color:var(--steel);font-size:.9em;margin-top:2px;}
  .hb-reason{width:100%;margin-top:4px;}
  .hb-reason label{font-size:.82rem;font-weight:600;display:block;margin-bottom:4px;}
  .hb-foot{display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid var(--line);flex-wrap:wrap;}
  .hb-foot .spacer{margin-left:auto;}
  .hb-warnbtn{background:#b32424;border-color:#b32424;color:#fff;}
  .hb-warnbtn:hover{background:#9a1f1f;}
  .hb-note{font-size:.8rem;color:var(--steel);margin-top:6px;}
`;

function _closeHardBlockDialog() {
  const o = document.getElementById("hbOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _hbEsc);
}
function _hbEsc(e) { if (e.key === "Escape") _closeHardBlockDialog(); }

function _hbToolLabel(toolId) {
  try {
    if (typeof TOOLS !== "undefined") {
      const t = TOOLS.find((x) => x.id === toolId);
      if (t) return t.label;
    }
  } catch (e) { /* ignore */ }
  return "this document";
}

function _openHardBlockDialog(toolId, blocking, onOverride) {
  _closeHardBlockDialog();
  const items = blocking.map((f) => `
    <li>
      <span class="sev">\u2715</span>
      <span>
        <span class="t">${esc(f.title)}</span>
        ${f.detail ? `<span class="d">${esc(f.detail)}</span>` : ""}
      </span>
    </li>`).join("");

  const label = _hbToolLabel(toolId);
  const overlay = el(`
    <div class="hb-overlay" id="hbOverlay">
      <div class="hb-dialog" role="dialog" aria-modal="true" aria-label="Validation gate">
        <style>${HARDBLOCK_STYLE}</style>
        <header><h2>Generation blocked</h2><button class="x" id="hbX" title="Close" aria-label="Close">×</button></header>
        <div class="hb-body">
          <p>The validation gate is set to block <strong>${esc(label)}</strong> on the following
          ${blocking.length === 1 ? "issue" : "issues"}:</p>
          <ul class="hb-list">${items}</ul>
          <p>Fix the data in the UDQ and reload it, or override to generate a draft anyway.</p>
          <div class="hb-reason">
            <label for="hbReason">Override reason (optional — recorded in run history)</label>
            <input type="text" id="hbReason" placeholder="e.g. draft for review; ECCN pending from program office">
          </div>
        </div>
        <div class="hb-foot">
          <button class="btn ghost" id="hbCancel" type="button">Cancel</button>
          <span class="spacer"></span>
          <button class="btn hb-warnbtn" id="hbOverride" type="button">Generate anyway</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) _closeHardBlockDialog(); });
  overlay.querySelector("#hbX").addEventListener("click", _closeHardBlockDialog);
  overlay.querySelector("#hbCancel").addEventListener("click", _closeHardBlockDialog);
  document.addEventListener("keydown", _hbEsc);
  const reasonInput = overlay.querySelector("#hbReason");
  if (reasonInput) setTimeout(() => reasonInput.focus(), 0);

  overlay.querySelector("#hbOverride").addEventListener("click", () => {
    const reason = (reasonInput && reasonInput.value || "").trim();
    _closeHardBlockDialog();
    // Record the override before generation so the audit trail captures it even
    // if the user closes the resulting print tab.
    try {
      if (typeof AuditLog !== "undefined" && AuditLog.record) {
        AuditLog.record({
          kind: "override",
          type: "Validation gate override",
          format: _hbToolLabel(toolId),
          filename: "",
          wmtr: (AppState.data && AppState.data.meta && (AppState.data.meta.wmtr_last5 || AppState.data.meta.wmtr)) || "",
          note: (reason ? reason + " — " : "") + "bypassed: " +
            blocking.map((f) => _valBlockableLabel(f.code)).join("; "),
        });
      }
    } catch (e) { /* never let logging block the override */ }
    if (typeof onOverride === "function") onOverride();
  });
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    validateUdq, _valAuthIsControlled, _valEccnMeaningful,
    VAL_BLOCKABLE, _vFind, atlasBlockingFindings, atlasHardBlockActive,
  };
}
