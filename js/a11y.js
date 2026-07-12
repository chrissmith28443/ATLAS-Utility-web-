/* =========================================================================
   ATLAS Utility Web — a11y.js
   Section 508 / WCAG 2.0 AA support (Feature #2).

   Rather than retrofit every modal's open/close, this installs ONE global
   mechanism that works for any element marked role="dialog" aria-modal="true"
   (which all current modals already are — Settings, History, Compare, About,
   Backup, Validation gate, Diagnostics — plus any future one):

     • Focus trap — Tab / Shift+Tab cycle within the topmost open dialog and
       can't escape to the page behind it.
     • Focus move-in / restore — when a dialog opens, focus moves into it and
       the element that had focus is remembered; when it closes, focus returns
       there. Keyboard and screen-reader users never get "lost" behind a modal.
     • Inert background — while any dialog is open the app shell (topbar +
       layout) is aria-hidden so a screen reader's virtual cursor stays in the
       dialog, matching the visual modality.

   Plus a polite live region + atlasAnnounce(msg) so status changes (e.g. the
   pre-flight validation result after a UDQ loads) are spoken without moving
   focus.

   No modal code needs to change; the existing per-modal Escape handlers and
   overlay-click-to-close still work alongside this.
   ========================================================================= */

const AtlasA11y = {
  DIALOG_SEL: '[role="dialog"][aria-modal="true"]',
  FOCUSABLE_SEL: [
    'a[href]', 'area[href]',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])',
    'button:not([disabled])', 'iframe', 'object', 'embed',
    '[contenteditable]:not([contenteditable="false"])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(','),

  _stack: [],          // [{ dialog, returnTo }]  (supports stacked modals)
  _inertEls: [],       // app-shell elements we aria-hid while a modal is open

  _visible(el) {
    return !!(el && el.getClientRects && el.getClientRects().length);
  },

  _focusables(container) {
    return Array.prototype.slice
      .call(container.querySelectorAll(this.FOCUSABLE_SEL))
      .filter((el) => this._visible(el));
  },

  _topDialog() {
    const all = Array.prototype.slice.call(document.querySelectorAll(this.DIALOG_SEL))
      .filter((d) => this._visible(d));
    return all.length ? all[all.length - 1] : null;
  },

  _matchDialog(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.matches && node.matches(this.DIALOG_SEL)) return node;
    return node.querySelector ? node.querySelector(this.DIALOG_SEL) : null;
  },

  _setBackgroundInert(on) {
    // Hide the app shell from assistive tech while a modal is open. Only act on
    // the 0<->1 transition so stacked modals don't double-toggle.
    if (on) {
      if (this._inertEls.length) return;
      const shell = [];
      document.querySelectorAll("body > .topbar, body > .layout").forEach((el) => shell.push(el));
      shell.forEach((el) => {
        if (el.getAttribute("aria-hidden") !== "true") {
          el.setAttribute("aria-hidden", "true");
          el.dataset.a11yInert = "1";
          this._inertEls.push(el);
        }
      });
    } else {
      this._inertEls.forEach((el) => {
        if (el.dataset.a11yInert) { el.removeAttribute("aria-hidden"); delete el.dataset.a11yInert; }
      });
      this._inertEls = [];
    }
  },

  onDialogAdded(dialog) {
    if (this._stack.some((s) => s.dialog === dialog)) return;
    const returnTo = (document.activeElement && document.activeElement !== document.body)
      ? document.activeElement : null;
    this._stack.push({ dialog, returnTo });

    // Make the dialog programmatically focusable and move focus to it, so the
    // screen reader announces the dialog's role + label first. :focus-visible
    // won't draw a ring for this programmatic focus.
    if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
    // Defer so a modal that focuses its own field (setTimeout) wins over us.
    setTimeout(() => {
      if (document.contains(dialog) && !dialog.contains(document.activeElement)) {
        try { dialog.focus(); } catch (e) { /* ignore */ }
      }
    }, 0);

    if (this._stack.length === 1) this._setBackgroundInert(true);
  },

  onDialogRemoved(dialog) {
    const idx = this._stack.findIndex((s) => s.dialog === dialog);
    if (idx === -1) return;
    const entry = this._stack.splice(idx, 1)[0];
    if (this._stack.length === 0) this._setBackgroundInert(false);
    const rt = entry.returnTo;
    if (rt && document.contains(rt) && typeof rt.focus === "function") {
      try { rt.focus(); } catch (e) { /* ignore */ }
    }
  },

  /** Pure decision: given the dialog's focusable elements, the currently active
   *  element, and the Tab direction, return the element that should receive
   *  focus — or null to let the browser handle it. Exposed for unit tests. */
  nextFocusTarget(focusables, active, shiftKey, isInsideDialog) {
    if (!focusables || !focusables.length) return null;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (!isInsideDialog) return first;          // focus escaped → pull back in
    if (shiftKey && active === first) return last;   // wrap to end
    if (!shiftKey && active === last) return first;  // wrap to start
    return null;                                // normal Tab within the trap
  },

  handleKeydown(e) {
    if (e.key !== "Tab") return;
    const dialog = this._topDialog();
    if (!dialog) return;
    const f = this._focusables(dialog);
    if (!f.length) { e.preventDefault(); try { dialog.focus(); } catch (_) {} return; }
    const target = this.nextFocusTarget(f, document.activeElement, e.shiftKey, dialog.contains(document.activeElement));
    if (target) { e.preventDefault(); target.focus(); }
  },

  ensureLiveRegion() {
    let r = document.getElementById("a11yLive");
    if (!r) {
      r = document.createElement("div");
      r.id = "a11yLive";
      r.className = "visually-hidden";
      r.setAttribute("role", "status");
      r.setAttribute("aria-live", "polite");
      r.setAttribute("aria-atomic", "true");
      document.body.appendChild(r);
    }
    return r;
  },

  announce(msg) {
    const r = this.ensureLiveRegion();
    // Clearing then setting on the next tick makes repeat/identical messages
    // re-announce in most screen readers.
    r.textContent = "";
    setTimeout(() => { r.textContent = String(msg || ""); }, 30);
  },

  init() {
    this.ensureLiveRegion();
    document.addEventListener("keydown", (e) => this.handleKeydown(e), true);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.addedNodes) m.addedNodes.forEach((n) => {
          const d = this._matchDialog(n);
          if (d) this.onDialogAdded(d);
        });
        if (m.removedNodes) m.removedNodes.forEach((n) => {
          const d = this._matchDialog(n);
          if (d) this.onDialogRemoved(d);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  },
};

/** Convenience global used elsewhere (e.g. after a UDQ loads). */
function atlasAnnounce(msg) {
  try { if (typeof AtlasA11y !== "undefined") AtlasA11y.announce(msg); } catch (e) { /* ignore */ }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    try { AtlasA11y.init(); } catch (e) { /* never let a11y wiring break the app */ }
  });
}

/* ---------- Node test support ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { AtlasA11y };
}
