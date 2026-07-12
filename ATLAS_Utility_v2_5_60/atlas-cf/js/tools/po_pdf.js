/* =========================================================================
   ATLAS Utility Web — tools/po_pdf.js
   Real PDF output + Quote-PDF attachment for the Purchase Order tools.

   Why this file exists
   --------------------
   The desktop app (services/po_service.py + core/pdf_utils.py) generated the
   PO as an actual PDF file, then — if the user picked a Quote PDF in the PO
   dialog — inserted ALL of the quote's pages immediately after page 1 of the
   PO (core.pdf_utils._append_quote_starting_page2). The first web port lost
   that step because it relied on the browser's "Save as PDF" print dialog,
   which never hands JavaScript any PDF bytes to merge into.

   This module restores parity. It builds the PO as a genuine PDF in the
   browser with pdf-lib (one library that both creates and merges PDFs), and
   reproduces the desktop page order exactly:

       PO page 1  ->  ALL quote pages  ->  any remaining PO pages

   Both PO tools use it: tools/po.js (shipping) and tools/propo.js (property).
   The model/HTML/Word builders in those files are reused unchanged; this file
   only adds the PDF render + merge + download path. The page layout below is
   drawn to match templates/po.css (the same look the HTML preview shows), with
   vector text rather than a rasterised screenshot so the output stays crisp
   and searchable.
   ========================================================================= */

/** Resolve the pdf-lib global, or throw a message the UI can show as-is. */
function poEnsurePdfLib() {
  if (typeof PDFLib !== "undefined" && PDFLib && PDFLib.PDFDocument) return PDFLib;
  throw new Error(
    "PDF engine (pdf-lib) isn't loaded. If you're offline, add js/vendor/pdf-lib.min.js " +
    "(see js/vendor/README.txt), then reload the app once online to cache it."
  );
}

/** Decode a base64 data URI (e.g. the embedded logo) to raw bytes. */
function poDataUriToBytes(uri) {
  const m = /^data:[^;]+;base64,(.*)$/.exec(String(uri || ""));
  if (!m) return null;
  const bin = atob(m[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Read a File (the quote upload) into a Uint8Array. */
function poFileToBytes(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(new Error("Couldn't read the selected file."));
    r.readAsArrayBuffer(file);
  });
}

/** Map characters the PDF standard fonts (WinAnsi) can't encode to safe
 *  equivalents, so user notes with smart quotes/dashes never break rendering.
 *  The bullet (U+2022, used in the footer) is kept — WinAnsi supports it. */
function poAnsi(s) {
  return String(s == null ? "" : s)
    .replace(/[\u2018\u2019\u201A\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\u0000-\u00FF\u2022]/g, "?");
}

/** Greedy word-wrap to a max width (points). Returns an array of lines. */
function poWrapLines(text, font, size, maxWidth) {
  const words = poAnsi(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (!cur || font.widthOfTextAtSize(trial, size) <= maxWidth) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/* ---- low-level draw helpers (baseline cursor `y`, top-down) ------------- */

/** Draw a plain wrapped paragraph; returns the next baseline y. */
function poDrawParagraph(page, o) {
  let y = o.y;
  const lineGap = o.lineGap || 1.2;
  for (const ln of poWrapLines(o.text, o.font, o.size, o.maxW)) {
    page.drawText(ln, { x: o.x, y, size: o.size, font: o.font, color: o.color });
    y -= o.size * lineGap;
  }
  return y;
}

/** Draw a bold label followed by a wrapped value (value reflows under the
 *  label's left edge on continuation lines). Returns the next baseline y. */
function poDrawLabeled(page, o) {
  const size = o.size, lineGap = o.lineGap || 1.2;
  page.drawText(o.label, { x: o.x, y: o.y, size, font: o.bold, color: o.color });
  const lw = o.bold.widthOfTextAtSize(o.label, size);
  let y = o.y, lineX = o.x + lw, avail = o.maxW - lw, cur = "";
  const flush = (txt, bx) => { if (txt) page.drawText(txt, { x: bx, y, size, font: o.font, color: o.color }); };
  const words = poAnsi(o.value).split(/\s+/).filter(Boolean);
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (!cur || o.font.widthOfTextAtSize(trial, size) <= avail) {
      cur = trial;
    } else {
      flush(cur, lineX); y -= size * lineGap; lineX = o.x; avail = o.maxW; cur = w;
    }
  }
  flush(cur, lineX);
  return y - size * lineGap;
}

/** Right-aligned "boldLabel + normalValue" on one line (header date/PO #). */
function poDrawRightTwoSeg(page, o) {
  const wb = o.bold.widthOfTextAtSize(o.label, o.size);
  const wr = o.font.widthOfTextAtSize(o.value, o.size);
  const x = o.right - (wb + wr);
  page.drawText(o.label, { x, y: o.y, size: o.size, font: o.bold, color: o.color });
  page.drawText(o.value, { x: x + wb, y: o.y, size: o.size, font: o.font, color: o.color });
}

/**
 * Build the single-page PO as a pdf-lib PDFDocument, laid out to match
 * templates/po.css. `parts` mirrors poWordParts/proPoWordParts:
 *   { intro, priceLabel, justification }
 * so the shipping and property variants share one renderer.
 */
async function poRenderPdfDoc(model, parts, docTitle) {
  const PL = poEnsurePdfLib();
  const { PDFDocument, StandardFonts, rgb } = PL;

  const doc = await PDFDocument.create();
  if (docTitle) { try { doc.setTitle(String(docTitle)); } catch (e) { /* non-fatal */ } }

  const page = doc.addPage([612, 792]);          // US Letter, portrait (points)
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0, 0, 0);
  const red = rgb(0xb0 / 255, 0, 0);             // FAR note (#b00000)
  const blue = rgb(0x1f / 255, 0x4e / 255, 0x79 / 255); // footer (#1f4e79)
  const grey = rgb(0.8, 0.8, 0.8);               // footer rule (#ccc)

  const M = 54, left = M, right = 612 - M, contentW = 612 - 2 * M; // 0.75in margins
  const indent = left + 24, indentW = contentW - 24;               // .desc/.vendor-block
  const top = 792 - M;

  // --- Header: logo (left) + date / PO number (right) ---
  let logoBottom = top - 90;
  try {
    const bytes = poDataUriToBytes(model.logo_uri);
    if (bytes) {
      const png = await doc.embedPng(bytes);
      let w = 135, h = 90;                        // ~ the Word export's 180x120px box
      const arBox = w / h, ar = png.width / png.height;
      if (ar > arBox) h = w / ar; else w = h * ar;
      page.drawImage(png, { x: left, y: top - h, width: w, height: h });
      logoBottom = top - h;
    }
  } catch (e) { /* missing/invalid logo: continue without it */ }

  const hs = 11;
  poDrawRightTwoSeg(page, { right, y: top - hs - 2, size: hs, bold, font, color: black, label: "Date: ", value: poAnsi(model.date) });
  poDrawRightTwoSeg(page, { right, y: top - hs - 2 - hs * 1.4, size: hs, bold, font, color: black, label: "Purchase Order: ", value: poAnsi(model.po_number) });

  let y = logoBottom - 18;                         // .header margin-bottom

  // --- Subject ---
  page.drawText("Subject: ", { x: left, y, size: 11, font: bold, color: black });
  page.drawText(poAnsi(typeof PO_SUBJECT !== "undefined" ? PO_SUBJECT : ""),
    { x: left + bold.widthOfTextAtSize("Subject: ", 11), y, size: 11, font, color: black });
  y -= 11 * 1.7;

  // --- 1. Description of Product or Service ---
  page.drawText("1. Description of Product or Service", { x: left, y, size: 11, font: bold, color: black });
  y -= 11 * 1.4;
  y = poDrawParagraph(page, { page, x: indent, y, maxW: indentW, size: 11, font, color: black, text: parts.intro });
  y -= 2;
  y = poDrawParagraph(page, { x: indent, y, maxW: indentW, size: 11, font, color: black, text: parts.priceLabel + " " + model.cost_amount });
  if (model.notes) {
    y -= 2;
    const segs = poAnsi(model.notes).split("\n");
    y = poDrawLabeled(page, { x: indent, y, maxW: indentW, size: 11, font, bold, color: black, label: "Comments: ", value: segs[0] || "" });
    for (let i = 1; i < segs.length; i++) {
      y = poDrawParagraph(page, { x: indent, y, maxW: indentW, size: 11, font, color: black, text: segs[i] });
    }
  }
  y -= 10;

  // --- 2. Vendor Information ---
  page.drawText("2. Vendor Information", { x: left, y, size: 11, font: bold, color: black });
  y -= 11 * 1.4;
  y = poDrawLabeled(page, { x: indent, y, maxW: indentW, size: 11, font, bold, color: black, label: "Vendor Name: ", value: model.vendor || "" });
  y -= 2;
  const addrLines = poAnsi(model.vendor_address || "").split("\n").map((s) => s.trim()).filter(Boolean);
  y = poDrawLabeled(page, { x: indent, y, maxW: indentW, size: 11, font, bold, color: black, label: "Address: ", value: addrLines[0] || "" });
  for (let i = 1; i < addrLines.length; i++) {
    y = poDrawParagraph(page, { x: indent, y, maxW: indentW, size: 11, font, color: black, text: addrLines[i] });
  }
  y -= 10;

  // --- 3. Justification ---
  y = poDrawParagraph(page, { x: left, y, maxW: contentW, size: 11, font: bold, color: black,
    text: "3. Justification: The following circumstances justify this Purchase Order:" });
  y -= 2;
  y = poDrawParagraph(page, { x: left, y, maxW: contentW, size: 11, font, color: black, text: parts.justification });

  // --- Signature ---
  y -= 30;
  page.drawText("_____________________", { x: left, y, size: 11, font, color: black });
  y -= 11 * 1.3;
  page.drawText("TTI TRLS II Signature", { x: left, y, size: 11, font, color: black });
  y -= 16;

  // --- FAR 47.403 note (9pt, red) ---
  poDrawParagraph(page, { x: left, y, maxW: contentW, size: 9, font, color: red,
    text: (typeof PO_FAR_NOTE !== "undefined" ? PO_FAR_NOTE : ""), lineGap: 1.25 });

  // --- Footer (pinned near the bottom margin, centered, blue, with a rule) ---
  const footer = poAnsi(typeof PO_FOOTER !== "undefined" ? PO_FOOTER : "");
  const fy = 46;
  page.drawLine({ start: { x: left, y: fy + 12 }, end: { x: right, y: fy + 12 }, thickness: 0.75, color: grey });
  const fw = font.widthOfTextAtSize(footer, 11);
  page.drawText(footer, { x: (612 - fw) / 2, y: fy, size: 11, font, color: blue });

  return doc;
}

/**
 * Insert ALL pages of a quote PDF immediately after page 1 of the PO doc,
 * preserving any remaining PO pages after them — the exact ordering of the
 * desktop's core.pdf_utils._append_quote_starting_page2.
 * Returns the number of quote pages inserted.
 */
async function poInsertQuoteAfterPage1(poDoc, quoteBytes) {
  const PL = poEnsurePdfLib();
  let quoteDoc;
  try {
    quoteDoc = await PL.PDFDocument.load(quoteBytes, { ignoreEncryption: true });
  } catch (e) {
    throw new Error("The attached Quote file couldn't be read as a PDF. Make sure it's a valid .pdf.");
  }
  const copied = await poDoc.copyPages(quoteDoc, quoteDoc.getPageIndices());
  let at = 1;                                      // right after PO page 1
  for (const p of copied) poDoc.insertPage(at++, p);
  return copied.length;
}

/**
 * Build the PO PDF and, if a quote File is supplied, merge it in.
 * Returns { bytes: Uint8Array, mergedCount: number }.
 */
async function poBuildAndMergePdfBytes(model, parts, docTitle, quoteFile) {
  const doc = await poRenderPdfDoc(model, parts, docTitle);
  let mergedCount = 0;
  if (quoteFile) {
    const qBytes = await poFileToBytes(quoteFile);
    mergedCount = await poInsertQuoteAfterPage1(doc, qBytes);
  }
  const bytes = await doc.save();
  return { bytes, mergedCount };
}

/** Trigger a browser download of the given PDF bytes. */
function poDownloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* Node test support (ignored by the browser) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    poAnsi, poWrapLines, poDataUriToBytes,
    poRenderPdfDoc, poInsertQuoteAfterPage1, poBuildAndMergePdfBytes, poFileToBytes,
  };
}
