#!/usr/bin/env bash
# Downloads SheetJS + JSZip into js/vendor so ATLAS Utility runs fully offline
# without depending on the CDN. Run once with internet, then redeploy.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/js/vendor"
mkdir -p "$DIR"
curl -fSL "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" -o "$DIR/xlsx.full.min.js"
curl -fSL "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"    -o "$DIR/jszip.min.js"
curl -fSL "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js" -o "$DIR/pdf-lib.min.js"
echo "Done -> $DIR"
echo "Redeploy the atlas-cf folder and load the app once online to cache it."
