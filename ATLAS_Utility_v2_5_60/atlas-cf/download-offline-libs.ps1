# Downloads SheetJS + JSZip into js\vendor so ATLAS Utility runs fully offline
# without depending on the CDN. Run once on a machine with internet, then redeploy.
$ErrorActionPreference = 'Stop'
$vendor = Join-Path $PSScriptRoot 'js\vendor'
New-Item -ItemType Directory -Force -Path $vendor | Out-Null

$files = [ordered]@{
  'xlsx.full.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  'jszip.min.js'     = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
  'pdf-lib.min.js'   = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
}
foreach ($name in $files.Keys) {
  $out = Join-Path $vendor $name
  Write-Host "Downloading $name ..."
  Invoke-WebRequest -Uri $files[$name] -OutFile $out -UseBasicParsing
}
Write-Host ""
Write-Host "Done. Saved to $vendor"
Write-Host "Now redeploy the atlas-cf folder and load the app once online to cache it."
