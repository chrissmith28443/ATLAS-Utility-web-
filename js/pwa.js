/* =========================================================================
   ATLAS Utility Web — pwa.js
   Registers the service worker and provides the "Install app" affordance.
   No-ops gracefully when service workers aren't supported or when the page is
   opened directly from disk (file://), where SWs can't run — the app still
   works exactly as before in that case.

   Install button behavior:
     - Hidden when the app is already running installed (standalone).
     - Otherwise shown, so it's always discoverable.
     - Click uses the browser's native install prompt when available
       (beforeinstallprompt). If the browser hasn't offered one, it shows short
       per-browser instructions instead (some browsers only expose install via
       the address-bar icon or menu, and a few don't support it at all).
   ========================================================================= */
(function () {
  // Register the service worker (HTTPS/localhost only; not file://).
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        // If an updated worker is already waiting (e.g. from a previous visit), prompt now.
        if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg);
        // Watch for a new worker installing.
        reg.addEventListener("updatefound", function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", function () {
            // "installed" while a controller exists means an update is ready (not first install).
            if (nw.state === "installed" && navigator.serviceWorker.controller) showUpdateToast(reg);
          });
        });
      }).catch(function (e) {
        console.warn("Service worker registration failed:", e);
      });

      // When the new worker takes control, reload once so the page runs fresh assets.
      var reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
    });
  }

  function showUpdateToast(reg) {
    if (document.getElementById("updateToast")) return;
    var t = document.createElement("div");
    t.id = "updateToast";
    t.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:1200;" +
      "background:#16283C;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:10px;" +
      "box-shadow:0 10px 30px rgba(0,0,0,.35);padding:11px 14px;display:flex;align-items:center;gap:12px;" +
      "font-family:-apple-system,Segoe UI,system-ui,Arial,sans-serif;font-size:.9rem;max-width:92vw;";
    t.innerHTML =
      '<span>A new version of ATLAS Utility is available.</span>' +
      '<button id="updateReload" style="background:#E8590C;color:#fff;border:0;border-radius:7px;padding:6px 12px;font:600 12.5px var(--disp,inherit);letter-spacing:.04em;text-transform:uppercase;cursor:pointer;">Reload</button>' +
      '<button id="updateDismiss" aria-label="Dismiss" style="background:none;border:0;color:#9fb0c2;font-size:18px;line-height:1;cursor:pointer;">&times;</button>';
    document.body.appendChild(t);
    document.getElementById("updateReload").addEventListener("click", function () {
      if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
      else window.location.reload();
    });
    document.getElementById("updateDismiss").addEventListener("click", function () { t.remove(); });
  }

  var deferredPrompt = null;
  function btn() { return document.getElementById("installBtn"); }
  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
  }
  function showBtn() { var b = btn(); if (b && !isStandalone()) b.style.display = "inline-flex"; }
  function hideBtn() { var b = btn(); if (b) b.style.display = "none"; }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showBtn();
  });
  window.addEventListener("appinstalled", function () { deferredPrompt = null; hideBtn(); });

  function showInstructions() {
    if (document.getElementById("installHelp")) return;
    var ov = document.createElement("div");
    ov.id = "installHelp";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(12,18,28,.55);z-index:1100;display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px;";
    ov.innerHTML =
      '<div style="background:#fff;color:#16283C;max-width:460px;width:100%;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.3);font-family:-apple-system,Segoe UI,system-ui,Arial,sans-serif;">' +
      '<div style="padding:14px 18px;border-bottom:1px solid #D4DAE0;display:flex;align-items:center;">' +
      '<strong style="font-size:1.05rem;">Install ATLAS Utility</strong>' +
      '<button id="installHelpX" aria-label="Close" style="margin-left:auto;border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:#5B6B7C;">&times;</button></div>' +
      '<div style="padding:16px 18px;font-size:.92rem;line-height:1.5;">' +
      'Add ATLAS Utility as a desktop app:' +
      '<ul style="margin:10px 0 0;padding-left:18px;">' +
      '<li><strong>Chrome / Edge:</strong> click the install icon at the right end of the address bar, or open the <strong>&#8942;</strong> / <strong>&#183;&#183;&#183;</strong> menu and choose <strong>&ldquo;Install ATLAS Utility&hellip;&rdquo;</strong>.</li>' +
      '<li style="margin-top:6px;"><strong>Safari (Mac):</strong> <strong>File &#9656; Add to Dock</strong>.</li>' +
      '</ul>' +
      '<div style="margin-top:12px;color:#5B6B7C;font-size:.85rem;">If none of these appear, the browser may not support installing web apps (Firefox desktop doesn&rsquo;t), or it&rsquo;s already installed.</div>' +
      '</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) ov.remove(); });
    var x = document.getElementById("installHelpX");
    if (x) x.addEventListener("click", function () { ov.remove(); });
  }

  /* Trigger the install flow: use the captured prompt if the browser offered
     one, otherwise show manual instructions. Called from the Settings modal. */
  async function doInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ }
      deferredPrompt = null;
      hideBtn();
    } else {
      showInstructions();
    }
  }

  /* Public API so the Settings modal can host the install action. */
  window.AtlasPWA = { install: doInstall, isStandalone: isStandalone };

  document.addEventListener("DOMContentLoaded", function () {
    var b = btn();
    if (!b) return;             // Install button now lives in Settings, not the header.
    showBtn();
    b.addEventListener("click", doInstall);
  });
})();
