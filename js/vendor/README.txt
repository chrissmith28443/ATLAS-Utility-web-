ATLAS Utility — bundled libraries (offline backup)
==================================================

The app uses three JavaScript libraries:
  * SheetJS  -> xlsx.full.min.js   (reads/writes the UDQ Excel files)
  * JSZip    -> jszip.min.js       (builds .xlsx and .zip output)
  * pdf-lib  -> pdf-lib.min.js     (builds the Purchase Order PDF and merges an attached Quote PDF)

By default these load from the cdnjs CDN. To make the app work OFFLINE without
depending on the CDN (recommended for restricted networks), place official
copies of the files in THIS folder:

    js/vendor/xlsx.full.min.js
    js/vendor/jszip.min.js
    js/vendor/pdf-lib.min.js

When these files are present, the app loads them instead of the CDN. If they are
absent, the app automatically falls back to the CDN (so nothing breaks either
way). After adding them, redeploy the atlas-cf folder and load the app once
online so the service worker caches everything; from then on it works offline
with no CDN at all.

HOW TO GET THE FILES
--------------------
Option A — run the helper (needs internet, run once):
    Windows : double-click / run  download-offline-libs.ps1   (in the atlas-cf root)
    Mac/Linux: bash download-offline-libs.sh

Option B — download manually in a browser, then Save As into this folder:
    https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
    https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
    https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js

Keep the exact filenames above.
