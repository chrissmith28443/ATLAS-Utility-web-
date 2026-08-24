/* =========================================================================
   ATLAS Utility Web — data/history_index.js
   Bundled compliance-history search index — INTENTIONALLY EMPTY.

   This file used to ship a pre-built index of the TRLS I / TRLS II history
   (≈17,900 line items across ≈1,860 requests) so Compliance Search worked
   without uploading a workbook. That data has been removed: shipped in the
   app bundle it carried request titles (program / end-user context), ITAR
   USML categories and SME flags, serial numbers, and vendor/PO detail, all
   of which could surface through a plain search of the site's JS.

   Compliance Search is hidden from the tool rail while this is empty (see the
   commented-out "search" entry in js/app.js). If a sanitized bundle is built
   later, set window.ATLAS_HISTORY_BUNDLE_JSON here again and re-enable the
   tool — search.js needs no other change. Uploading a history workbook by
   hand still builds an index at runtime, exactly as before.
   ========================================================================= */

/* No bundled index. window.ATLAS_HISTORY_BUNDLE_JSON is deliberately unset,
   so bundledHistoryAvailable() in search.js returns false. */
