/* =========================================================================
   ATLAS Utility Web — sw.js  (service worker)
   Precaches the same-origin app shell so the app loads offline, and
   runtime-caches the CDN libraries (SheetJS, JSZip) and Google Fonts on
   first online load. Bump CACHE on every release to refresh the cache.
   ========================================================================= */
const CACHE = "atlas-cache-v2.5.61-dropzone-hint";
const RUNTIME_HOSTS = ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];
const APP_SHELL = [
  "./", "./index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png", "icons/apple-touch-icon.png", "icons/favicon-32.png", "icons/atlas-logo.png?v=62",
  "css/app.css?v=86",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "js/app.js?v=81",
  "js/assets.js?v=64",
  "js/about.js?v=101",
  "js/a11y.js?v=61",
  "js/backup.js?v=63",
  "js/constants.js?v=97",
  "js/dangerous_goods.js?v=61",
  "js/metrics_dashboard.js?v=85",
  "js/pwa.js?v=62",
  "js/audit.js?v=62",
  "js/recents.js?v=62",
  "js/formcache.js?v=62",
  "js/compare.js?v=65",
  "js/json_udq.js?v=14",
  "js/settings.js?v=67",
  "js/tools/ci.js?v=62",
  "js/tools/coreims.js?v=61",
  "js/tools/coreims_template.js?v=61",
  "js/tools/dd1149.js?v=61",
  "js/tools/dd1149_template.js?v=61",
  "js/tools/ecm.js?v=62",
  "js/tools/ecm_template.js?v=61",
  "js/tools/ipc.js?v=61",
  "js/tools/ipc_template.js?v=61",
  "js/tools/mct.js?v=61",
  "js/tools/mct_template.js?v=61",
  "js/tools/packet.js?v=62",
  "js/tools/pl.js?v=64",
  "js/tools/pl_templates.js?v=61",
  "js/tools/manual_parents.js?v=4",
  "js/consol.js?v=6",
  "js/item_split.js?v=6",
  "js/tools/manual_details.js?v=2",
  "js/tools/placards.js?v=61",
  "js/tools/pmr.js?v=81",
  "js/tools/pmr_template.js?v=61",
  "js/tools/po.js?v=65",
  "js/tools/propo.js?v=63",
  "js/tools/po_pdf.js?v=63",
  "js/tools/reqatt.js?v=63",
  "js/tools/rfq.js?v=62",
  "js/tools/rfq_template.js?v=61",
  "js/data/history_index.js?v=64",
  "js/tools/search.js?v=64",
  "js/tools/sli.js?v=62",
  "js/tools/sli_template.js?v=61",
  "js/tools/topdocs.js?v=61",
  "js/tools/topdocs_template.js?v=61",
  "js/tools/validate.js?v=64",
  "js/tools/xmastree.js?v=38",
  "js/udq.js?v=66",
  "js/udq_tools.js?v=63",
  "js/util.js?v=61",
];

self.addEventListener("install", (e) => {
  // Note: no skipWaiting() here — the new worker waits until the user accepts
  // the "update available" prompt (pwa.js posts SKIP_WAITING), so we never swap
  // assets out from under an open session.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isRuntime = RUNTIME_HOSTS.indexOf(url.hostname) !== -1;

  // App navigations: try network, fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() =>
        caches.match("./index.html", { ignoreSearch: true }).then((r) => r || caches.match("./"))
      )
    );
    return;
  }

  if (!sameOrigin && !isRuntime) return; // let anything else hit the network normally

  // Cache-first for shell + CDN; populate the runtime cache on success.
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp && (resp.ok || resp.type === "opaque")) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
