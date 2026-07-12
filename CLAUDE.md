# CLAUDE.md — ATLAS Utility PWA

This file is the standing brief for this project. Read it before every task.
It tells you what ATLAS Utility is, the rules to follow, and the conventions to
match. If a rule here conflicts with something I say in chat, ask before
overriding it.

---

## What this project is

ATLAS Utility is a Progressive Web App (PWA) that supports TTI's ATLAS
material-transit and inventory management platform.

- **Current Utility version:** 2.5.60
- **Language:** vanilla JavaScript (no framework, no build step)
- **Size:** ~30,000 lines of app JS across ~54 JS files
- **Deployment:** Cloudflare (see CLOUDFLARE_SETUP.md)
- **App icon:** the "Atomic Possum"

I am not a professional programmer. I work by describing what I want and
reviewing the result ("vibe coding"). Explain what you changed in plain
language, not just in code.

---

## Working style (important)

- Be **direct and concise**. No filler, no restating my request back to me.
- When you change something, give a **short plain-English summary** of what
  changed and why, then the code — no lecture on how it works unless I ask.
- **Reuse the existing conventions and patterns** already in the codebase.
  Match the surrounding style; don't introduce a new approach.
- Make the **smallest change that solves the problem**. Don't refactor or
  "tidy" files I didn't ask you to touch.
- When something is ambiguous, **ask one focused question** instead of guessing.
- Deliver **clean output** — strip internal rationale from anything user-facing
  once it has served its purpose.

---

## Versioning policy (two separate streams — do not mix these up)

ATLAS uses **two independent version histories**:

1. **The Utility's own version** — semantic version, currently **2.5.60**.
   This tracks *this PWA*.
2. **The ATLAS platform release history** — MAJOR.MINOR.FIX, tracked separately
   in the platform's `releases.json` (not in this repo).

These are **not the same number** and must never be conflated.

### Bumping the Utility version — update ALL THREE places together

When the Utility version changes, it must change in every one of these, or the
app will ship inconsistently (e.g. the cache won't refresh and users won't get
the update):

1. `sw.js` — `const CACHE = "atlas-cache-vX.Y.Z-<short-label>"`
2. `js/constants.js` — `const APP_VERSION = "Web X.Y.Z"`
3. `js/about.js` — `version: "X.Y.Z"`

Always confirm all three match after a version change.

---

## PWA / caching rules (read before touching assets)

- This is an installable, offline-capable PWA. `sw.js` precaches the app shell.
- **Bump the `CACHE` name in `sw.js` on every release** or users keep the old
  cached version. (The cache name currently includes a short label describing
  the release, e.g. `-metrics-drilldowns`.)
- Individual shell files use a `?v=NN` cache-busting query (e.g.
  `js/formcache.js?v=62`). If you change such a file, bump its `?v=` number in
  the app shell list so the new version is fetched.

---

## Deployment (current — supersedes the drag-and-drop in CLOUDFLARE_SETUP.md)

This repo is **Git-connected to Cloudflare Pages** — deploys are automatic:

- Push to `main` on GitHub (`chrissmith28443/ATLAS-Utility-web-`) → Cloudflare
  Pages rebuilds and publishes within ~1 minute. **No manual upload.**
- **Build config in Cloudflare:** Framework preset = None, Build command =
  empty, Build output directory = `/`. It's plain static files (no build step),
  so the repo root IS the site root.
- **Employee URL:** https://atlas-utility.net (custom domain).
- **Raw Pages URL:** https://atlas-utility.pages.dev (same site).
- **Access control:** BOTH URLs sit behind Cloudflare Access (email one-time-PIN
  login) via the `atomic-possum` Zero Trust team — only allow-listed emails get
  in. This protects the full-data build (vendors, signers, contract numbers).
  ⚠️ Any NEW hostname or preview URL (`*.atlas-utility.pages.dev`) must be added
  to the Access application, or it's a public backdoor to that data.
- `CLOUDFLARE_SETUP.md` documents the OLD drag-and-drop method — keep it for the
  Access-policy reference, but deploys no longer work that way.

---

## Project structure

- `index.html` — app shell / entry point
- `sw.js` — service worker (offline cache, app-shell precache)
- `manifest.webmanifest` — PWA manifest
- `css/app.css` — styles (`app_.css` appears to be a variant/backup — confirm)
- `icons/` — app icons (Atomic Possum), incl. maskable + apple-touch
- `js/` — core app logic:
  - `app.js` (main), `constants.js`, `util.js`, `settings.js`, `pwa.js`,
    `audit.js`, `backup.js`, `compare.js`, `metrics_dashboard.js`,
    `dangerous_goods.js`, `udq.js` / `udq_tools.js` / `json_udq.js`,
    `assets.js`, `item_split.js`, `consol.js`, `recents.js`, `formcache.js`,
    `a11y.js`, `about.js`
  - `js/data/history_index.js` — history index
  - `js/tools/` — document generators & related:
    DD1149 (`dd1149.js` + template), SLI (`sli.js` + template),
    RFQ (`rfq.js` + template), PO (`po.js`, `po_pdf.js`, `propo.js`),
    packing lists (`pl.js`, `pl_templates.js`), `placards.js`,
    CoreIMS (`coreims.js` + template), ECM, IPC, MCT, PMR, `packet.js`,
    `search.js`, `validate.js`, `xmastree.js`, `topdocs.js`, and others
  - `js/vendor/` — third-party libraries (do not edit)

---

## Things NOT to do

- Don't introduce a framework or build tooling — this is intentionally vanilla
  JS with no build step.
- Don't edit anything in `js/vendor/` (third-party code).
- Don't reformat or restructure files I didn't ask you to change.
- Don't conflate the Utility version (2.5.60) with the platform `releases.json`
  version.
- Don't add dependencies without flagging it first.

---

## Session hygiene (for continuity)

Claude Code remembers everything *within* a session but not *across* sessions.
When we finish something worth remembering (a decision made, a half-done
feature, the next step to take), note it here or in a `NOTES.md` so the next
session starts with context instead of a blank slate.
