/* =========================================================================
   ATLAS Utility Web — tools/mct.js
   MCT Entry Letter, ported from desktop v4.4:
     services/mct_service.py  (placeholder mapping, date formats, filename)
     ui/mct_dialog.py         (field set, port-of-entry list, validation)
     templates/mct_template.docx  (embedded base64 in tools/mct_template.js)

   The letter is a fixed CBP duty-free-entry certificate (19 CFR 10.103) with
   five fillable fields. Like the desktop tool it produces an editable Word
   document; like every other web tool it also offers a print-to-PDF path. The
   .docx is built in-browser by JSZip string-replacing the five placeholders in
   the embedded template's word/document.xml — no server, no upload. The HTML
   preview reproduces the same body text for an at-a-glance check before saving.

   No UDQ is required (needs: "any"): the WMTR is an editable field, prefilled
   from a loaded SRF when one is present, exactly as the desktop dialog's
   default_wmtr behaves.
   ========================================================================= */

/* Port-of-entry suggestions (verbatim from ui/mct_dialog.PORT_OF_ENTRY_OPTIONS).
   Offered through a <datalist> so the field stays free-text — any value the user
   types is accepted, matching the desktop AutoCompleteEntry. */
const MCT_PORTS = [
  "Hartsfield–Jackson Atlanta International Airport (ATL)",
  "Los Angeles International Airport (LAX)",
  "O’Hare International Airport (ORD)",
  "Dallas/Fort Worth International Airport (DFW)",
  "Denver International Airport (DEN)",
  "John F. Kennedy International Airport (JFK)",
  "Newark Liberty International Airport (EWR)",
  "Miami International Airport (MIA)",
  "San Francisco International Airport (SFO)",
  "Seattle–Tacoma International Airport (SEA)",
  "Washington Dulles International Airport (IAD)",
  "George Bush Intercontinental Airport (IAH)",
  "Orlando International Airport (MCO)",
  "Boston Logan International Airport (BOS)",
  "Chicago Midway International Airport (MDW)",
  "Las Vegas Harry Reid International Airport (LAS)",
  "Phoenix Sky Harbor International Airport (PHX)",
  "Minneapolis–Saint Paul International Airport (MSP)",
  "Detroit Metropolitan Wayne County Airport (DTW)",
  "Philadelphia International Airport (PHL)",
  "San Diego International Airport (SAN)",
  "Tampa International Airport (TPA)",
  "Fort Lauderdale–Hollywood International Airport (FLL)",
  "Palm Beach International Airport (PBI)",
  "Baltimore/Washington International Airport (BWI)",
  "Charlotte Douglas International Airport (CLT)",
  "Salt Lake City International Airport (SLC)",
  "Portland International Airport (PDX)",
  "San Jose International Airport (SJC)",
  "Oakland International Airport (OAK)",
  "Honolulu Daniel K. Inouye International Airport (HNL)",
  "Anchorage Ted Stevens International Airport (ANC)",
  "Port of Los Angeles (LAX)",
  "Port of Long Beach (LGB)",
  "Port of New York and New Jersey (NYC)",
  "Port of Savannah (SAV)",
  "Port of Houston (HOU)",
  "Port of Oakland (OAK)",
  "Port of Seattle (SEA)",
  "Port of Tacoma (TCM)",
  "Port of Charleston (CHS)",
  "Port of Norfolk / Port of Virginia (ORF)",
  "Port of Miami (MIA)",
  "Port Everglades / Fort Lauderdale (FLL)",
  "Port of Jacksonville (JAX)",
  "Port of Tampa (TPA)",
  "Port of New Orleans (MSY)",
  "Port of Mobile (MOB)",
  "Port of Gulfport (GPT)",
  "Port of Pascagoula (PGL)",
  "Port of San Diego (SAN)",
  "Port of San Francisco (SFO)",
  "Port of Portland (PDX)",
  "Port of Anchorage (ANC)",
  "Port of Honolulu (HNL)",
  "Port of Hilo (ITO)",
  "Port of Dutch Harbor / Unalaska (DUT)",
  "Port of Baltimore (BWI)",
  "Port of Philadelphia (PHL)",
  "Port of Wilmington, Delaware (ILG)",
  "Port of Boston (BOS)",
  "Port of Providence (PVD)",
  "Port of San Juan (SJU)",
  "Port of Mayagüez (MAZ)",
  "Port of Guam (GUM)",
];

/* ---- Signers ----
   The template's letterhead and body are authored with Mike Skidan's name,
   phone, and email as fixed text (not placeholders). The signer dropdown swaps
   those exact strings for the selected signer. Both signers share the same
   title, so only name/phone/email vary. MCT_SIGNER_DEFAULT holds the strings as
   they appear verbatim in mct_template.docx (used as the find-targets for the
   .docx swap). */
const MCT_SIGNERS = [
  { id: "skidan", name: "Michael Skidan", phone: "571-616-5311", email: "michael.skidan.civ@mail.mil" },
  { id: "moore",  name: "Laurie Moore",   phone: "571-616-4905", email: "laurie.a.moore26.civ@mail.mil" },
];
const MCT_SIGNER_TITLE = "International Program Manager";
const MCT_SIGNER_DEFAULT = MCT_SIGNERS[0]; // values baked into the template

/** Look up a signer by id; falls back to the template default. */
function mctSigner(id) {
  return MCT_SIGNERS.find((s) => s.id === id) || MCT_SIGNER_DEFAULT;
}

/* ---- Date formatting (ports of mct_service._fmt_* helpers) ---- */

const MCT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Parse a yyyy-mm-dd value into a local Date (no timezone drift). */
function mctParseISO(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Letter date — "Jul 12, 2026" (leading zero on the day removed). */
function mctFmtLetterDate(iso) {
  const d = mctParseISO(iso);
  if (!d) return "";
  return `${MCT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Date of entry — "12 Aug 2026" (two-digit day kept). */
function mctFmtEntryDate(iso) {
  const d = mctParseISO(iso);
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd} ${MCT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Last run of exactly five digits in the WMTR (port of mct_service._last5). */
function mctLast5(wmtr) {
  const matches = String(wmtr || "").match(/\d{5}/g);
  return matches ? matches[matches.length - 1] : "";
}

/** Build the substitution model from the form options. */
function mctBuildModel(opts) {
  const o = opts || {};
  const wmtr = (o.wmtr || "").trim();
  const signer = mctSigner(o.signerId);
  return {
    letter_date: mctFmtLetterDate(o.letterDateISO),
    port_of_entry: (o.port || "").trim(),
    entry_date: mctFmtEntryDate(o.entryDateISO),
    bol_awb: (o.bolAwb || "").trim(),
    wmtr: wmtr,
    last5: mctLast5(wmtr),
    signer_name: signer.name,
    signer_title: MCT_SIGNER_TITLE,
    signer_phone: signer.phone,
    signer_email: signer.email,
  };
}

/** Placeholder -> value map (mirrors mct_service.run_mct_pipeline mapping). */
function mctMapping(model) {
  return {
    "{date}": model.letter_date,
    "{port of entry}": model.port_of_entry,
    "{date of entry}": model.entry_date,
    "{bol_awb}": model.bol_awb,
    "{wmtr#}": model.wmtr,
  };
}

/** Output filename (port of mct_service: MCT_Entry_Letter_<last5>.docx). */
function mctDocxName(model) {
  return model.last5 ? `MCT_Entry_Letter_${model.last5}.docx` : "MCT_Entry_Letter.docx";
}

/** XML-escape a replacement value before it goes into document.xml. */
function mctXmlEsc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ---- HTML preview / print rendition (faithful to the Word template) ----
   This reproduces templates/mct_template.docx as closely as the browser allows:
   the DTRA letterhead (DoD seal + centered blue address block from header1.xml),
   the right-tabbed {date} on the ATTN line, the 1–5 numbered list with the a/b
   sub-items under item 2, justified Times body, and the indented signature block.
   It is NOT the source of the .docx (that comes from the real template via
   JSZip) — it's the on-screen/PDF twin, filling the same five fields. Unfilled
   fields render as the red placeholder so it's obvious what's outstanding. */
function mctRenderHtml(model, docTitle) {
  const filled = (s, ph) => s ? `<b>${esc(s)}</b>` : `<span class="ph">${esc(ph)}</span>`;
  const seal = (typeof MCT_SEAL_B64 !== "undefined")
    ? `<img class="seal" src="data:image/png;base64,${MCT_SEAL_B64}" alt="DoD seal">`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(docTitle || "MCT Entry Letter")}</title>
<style>
${MCT_CSS}
</style>
</head>
<body>
  <div class="page">

    <header class="letterhead">
      ${seal}
      <div class="agency">
        <div class="agency-name">DEFENSE THREAT REDUCTION AGENCY</div>
        <div class="agency-addr">8725 JOHN J. KINGMAN ROAD, STOP 6201</div>
        <div class="agency-addr">FORT BELVOIR, VA 22060-6201</div>
      </div>
    </header>

    <div class="attn">ATTN:&nbsp;&nbsp;U.S. Customs &amp; Border Protection<span class="date">${filled(model.letter_date, "{date}")}</span></div>

    <p class="flush">Dear Sir/Madam,</p>

    <p>In accordance with 19 CFR 10.103, please accept this certificate on the official letterhead
       of the Department of Defense Threat Reduction Agency.</p>

    <p>I hereby certify:</p>

    <ol class="lvl1">
      <li>The articles being imported at the port of ${filled(model.port_of_entry, "{port of entry}")},
          on/about ${filled(model.entry_date, "{date of entry}")}, consist of returned products which are
          the growth, produce, or manufacture of the United States, and have been returned to the United
          States without having been advanced in value or improved in condition by any process or
          manufacture or other means, and that no drawback has been or will be claimed on such articles,
          and that the articles currently belonging to and are for the further use of the Defense Threat
          Reduction Agency.</li>
      <li>Bill of Lading/Air Waybill: ${filled(model.bol_awb, "{bol_awb}")}
        <ol class="lvl2">
          <li>Contract Number: HDTRA125D0002</li>
          <li>Reference Number: ${filled(model.wmtr, "{wmtr#}")}</li>
        </ol>
      </li>
      <li>The shipment does not contain military scrap.</li>
      <li>The shipment is entitled to entry under subheading 9801.00.10, Harmonized Tariff Schedule
          of the United States (HTSUS) free of duty.</li>
      <li>I am an officer or official authorized by the Defense Threat Reduction Agency to execute
          this certificate.</li>
    </ol>

    <p>Additionally, I stipulate and agree that all applicable provisions of the Tariff Act of 1930,
       as amended, and the regulations thereunder, and all other laws and regulations relating to the
       release and entry of merchandise will be observed and complied with in all respects.</p>

    <p>I respectfully request the issuance of a duty-free entry and Customs release of the cargo
       reflected on the documents attached.&nbsp; If you have any questions, please do not hesitate to
       contact me at ${esc(model.signer_phone)} or <a href="mailto:${esc(model.signer_email)}">${esc(model.signer_email)}</a>.</p>

    <div class="sig">
      <div class="sincerely">Sincerely,</div>
      <div class="signame">${esc(model.signer_name)}</div>
      <div>${esc(model.signer_title)}</div>
      <div>Defense Threat Reduction Agency</div>
    </div>
  </div>
</body>
</html>`;
}

const MCT_CSS = `
@page { size: letter; margin: 1in; }
html, body { margin: 0; padding: 0; }
body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000; line-height: 1.3; background: #fff; }
* { box-sizing: border-box; }
.page { width: 100%; }

/* Letterhead: seal at left, address block centered in the remaining width */
.letterhead { display: flex; align-items: center; min-height: 1.0in; margin-bottom: 18px; }
.letterhead .seal { width: 0.95in; height: 0.95in; flex: 0 0 auto; }
.letterhead .agency { flex: 1 1 auto; text-align: center; }
.agency-name { color: #215E99; font-weight: bold; font-size: 13pt; letter-spacing: 0.2px; white-space: nowrap; }
.agency-addr { color: #215E99; font-size: 9pt; line-height: 1.25; }

/* ATTN line: label left, date pushed to the right margin (template tab ~5.4in) */
.attn { font-weight: bold; display: flex; justify-content: space-between; margin: 0 0 12px; }
.attn .date { font-weight: normal; white-space: nowrap; padding-left: 0.5in; }

p { margin: 11px 0; text-align: justify; text-indent: 0.5in; }
p.flush { text-indent: 0; }

/* Numbered list, justified, with a lettered sub-list under item 2 */
ol.lvl1 { margin: 11px 0; padding-left: 0.4in; }
ol.lvl1 > li { text-align: justify; margin: 11px 0; padding-left: 6px; }
ol.lvl2 { list-style: lower-alpha; margin: 4px 0 4px 0; padding-left: 0.35in; }
ol.lvl2 > li { text-align: left; margin: 2px 0; }

/* Signature block indented toward center; lines kept on one row each */
.sig { margin-top: 26px; padding-left: 2.9in; }
.sig > div { white-space: nowrap; }
.sig .signame { margin-top: 54px; }

a { color: #0563C1; }
.ph { color: #b00000; font-style: italic; font-weight: normal; }

/* Preview-only paper look (does not affect the printed PDF) */
@media screen {
  body { background: transparent; }
  .page {
    width: 6.5in;            /* Letter portrait minus 1in margins */
    min-height: 9in;
    margin: 0 auto;
    padding: 0.75in;
    background: #fff;
    box-shadow: 0 0 10px rgba(0,0,0,0.25);
  }
}
`;

/* ---- .docx builder (desktop-parity editable Word output) ----
   Loads the embedded template with JSZip, string-replaces the five (now
   single-run) placeholders in word/document.xml, and repacks. Returns a Blob.
   Mirrors mct_service.run_mct_pipeline's replacement + naming. */
async function mctBuildDocxBlob(model) {
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip isn't loaded on this page");
  }
  // Decode the embedded template (base64 -> bytes).
  const bin = atob(MCT_TEMPLATE_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const zip = await JSZip.loadAsync(bytes);
  const docXmlPath = "word/document.xml";
  let xml = await zip.file(docXmlPath).async("string");

  const mapping = mctMapping(model);
  for (const [ph, val] of Object.entries(mapping)) {
    // Global replace; values are XML-escaped. Placeholders were consolidated to
    // single text nodes in the embedded template, so a plain replace is safe.
    xml = xml.split(ph).join(mctXmlEsc(val));
  }

  // Signer swap: the template carries the default signer's name, phone, and
  // email as fixed text. Replace each with the selected signer's value (no-ops
  // when the default signer is chosen). The email's mailto target lives in the
  // rels part, so swap that too — otherwise the visible address and the link
  // would disagree.
  const def = MCT_SIGNER_DEFAULT;
  const sub = (s, find, repl) => find === repl ? s : s.split(find).join(repl);
  xml = sub(xml, mctXmlEsc(def.name),  mctXmlEsc(model.signer_name));
  xml = sub(xml, mctXmlEsc(def.phone), mctXmlEsc(model.signer_phone));
  xml = sub(xml, mctXmlEsc(def.email), mctXmlEsc(model.signer_email));
  zip.file(docXmlPath, xml);

  const relsPath = "word/_rels/document.xml.rels";
  const relsFile = zip.file(relsPath);
  if (relsFile) {
    let rels = await relsFile.async("string");
    rels = sub(rels, "mailto:" + def.email, "mailto:" + model.signer_email);
    zip.file(relsPath, rels);
  }

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/* Node test support (ignored by the browser) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MCT_PORTS, MCT_SIGNERS, mctFmtLetterDate, mctFmtEntryDate, mctLast5,
    mctBuildModel, mctMapping, mctDocxName, mctRenderHtml, mctXmlEsc,
  };
}
