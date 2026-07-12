/* =========================================================================
   ATLAS Utility Web — util.js
   Text/number helpers ported from services/ci_document.py & ci_reader.py
   ========================================================================= */

/** Normalize a cell value to a clean string (port of _norm). */
function norm(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  s = s.replace(/\u00A0/g, " ");                 // nbsp
  s = s.replace(/\u2013|\u2014/g, "-");          // en/em dash
  s = s.replace(/\u2018|\u2019/g, "'");          // smart quotes
  s = s.replace(/\u201C|\u201D/g, '"');
  return s.trim();
}

/** Collapse internal whitespace too (port of rfq_norm). */
function normWs(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/\u00A0/g, " ");
  return s.trim().split(/\s+/).join(" ");
}

function normKey(v) {
  return normWs(v).toLowerCase();
}

/** Port of _to_float: strip everything but digits . - then parse. */
function toFloat(v) {
  const s = norm(v);
  if (!s) return 0.0;
  let cleaned = "";
  for (const ch of s) {
    if ((ch >= "0" && ch <= "9") || ch === "." || ch === "-") cleaned += ch;
  }
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0.0;
}

/** Round-half-up to n digits (port of _round_half_up; JS toFixed is unreliable). */
function roundHalfUp(x, ndigits = 2) {
  const f = Math.pow(10, ndigits);
  // Use a tiny epsilon-free approach via string math on the scaled value
  const scaled = x * f;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  const rounded = frac >= 0.5 - 1e-9 ? floor + 1 : floor;
  return rounded / f;
}

/** "1,234.56" money format; "" for 0/blank (port of _fmt_money). */
function fmtMoney(n) {
  if (!n) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtFixed2(n) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1,000.00 lb (453.59 kg)" (port of _fmt_weight). */
function fmtWeight(lbs, kg) {
  if (!lbs && !kg) return "";
  if (!kg && lbs) kg = lbs * 0.45359237;
  if (!lbs && kg) lbs = kg / 0.45359237;
  return `${fmtFixed2(lbs)} lb (${fmtFixed2(kg)} kg)`;
}

/** "1,234.00 ft³ (34.94 m³)" (port of _fmt_volume). */
function fmtVolume(ft3, m3) {
  if (!ft3 && !m3) return "";
  if (!m3 && ft3) m3 = ft3 * 0.028316846592;
  if (!ft3 && m3) ft3 = m3 / 0.028316846592;
  ft3 = roundHalfUp(ft3, 2);
  m3 = roundHalfUp(m3, 2);
  return `${fmtFixed2(ft3)} ft³ (${fmtFixed2(m3)} m³)`;
}

/** "City, ST 12345" builder (port of _city_state_zip). */
function cityStateZip(city, state, zip) {
  city = norm(city); state = norm(state); zip = norm(zip);
  if (city && state && zip) return `${city}, ${state} ${zip}`;
  if (city && state) return `${city}, ${state}`;
  if (city && zip) return `${city} ${zip}`;
  return city || state || zip;
}

/** Keep up to maxLines non-empty lines; never empty array (port of _safe_lines). */
function safeLines(parts, maxLines = 6) {
  const lines = [];
  for (let p of parts) {
    p = norm(p);
    if (p) lines.push(p);
  }
  return lines.length ? lines.slice(0, maxLines) : [""];
}

/** Parse "240x96x96" style dims into [L, W, H] inches (port of _parse_dims_in). */
function parseDimsIn(dimText) {
  const s = norm(dimText);
  if (!s) return [0, 0, 0];
  const nums = s.match(/[0-9]+(?:\.[0-9]+)?/g) || [];
  if (nums.length < 3) return [0, 0, 0];
  return [parseFloat(nums[0]), parseFloat(nums[1]), parseFloat(nums[2])];
}

/** Last 5 digits of the WMTR number, e.g. "WMTR-26-1-B-ET-10256-SRF" -> "10256". */
function wmtrLast5(wmtr) {
  const m = String(wmtr || "").match(/(\d{5})(?!.*\d)/);
  return m ? m[1] : "";
}

/** YYYY-MM-DD for today (local). */
function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Timestamp for filenames: YYYYMMDD_HHMMSS. */
function fileStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** HTML-escape (Jinja autoescape equivalent). */
function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape, then convert newlines to <br/> (for remarks/comments). */
function escBr(v) {
  return esc(v).replace(/\n/g, "<br/>");
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    norm, normWs, normKey, toFloat, roundHalfUp, fmtMoney, fmtWeight, fmtVolume,
    cityStateZip, safeLines, parseDimsIn, wmtrLast5, todayISO, fileStamp, esc, escBr,
  };
}
