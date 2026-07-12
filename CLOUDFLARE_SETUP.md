# ATLAS Utility (Web) — Cloudflare Pages + Access (team email login)

This is the FULL-DATA build (vendors, signers, contract numbers, addresses all intact).
That's fine here because it will sit behind a login — only people whose email you add can
reach it. Below: (1) put the files online, (2) turn on the email login, (3) what your team
sees. You'll need a free Cloudflare account.

================================================================
PART 1 — Publish the files (Cloudflare Pages, direct upload)
================================================================
1. Sign in at https://dash.cloudflare.com
2. Left sidebar → "Workers & Pages".
3. "Create application" → "Pages" tab → "Use direct upload" (a.k.a. drag-and-drop).
4. Give the project a name, e.g. `atlas-utility`. (This becomes the URL:
   `atlas-utility.pages.dev`. The *.pages.dev name can't be changed later without
   recreating the project, so pick one you're happy with.)
5. Drag the `atlas-cf` folder (or this zip) onto the upload area → "Deploy site".
6. After it finishes you'll have a live URL: `https://atlas-utility.pages.dev`.
   (It's PUBLIC at this moment — Part 2 locks it down. Don't share it yet.)

================================================================
PART 2 — Turn on the email login (Cloudflare Access)
================================================================
Pick ONE route. Route A (custom domain) is cleaner; Route B needs no domain but has one
fiddly step.

----- Route A — you have / will use a custom domain (recommended) -----
A1. In your Pages project → "Custom domains" → add e.g. `atlas.yourcompany.com`.
    (The domain must be on your Cloudflare account as an active zone. If your company
    domain is elsewhere, IT can delegate just that subdomain, or you can buy a domain via
    Cloudflare Registrar at cost.)
A2. Dashboard → "Zero Trust" → Access controls → Applications → "Create new application"
    → "Self-hosted".
A3. Add the public hostname: select `atlas.yourcompany.com` from the Domain dropdown.
A4. Under "Access policies" create a policy (see "THE EMAIL POLICY" below) → Create.
A5. Visit the domain — you should now get a login prompt.

----- Route B — keep it on the free `*.pages.dev` URL (no domain) -----
B1. In your Pages project → Settings → enable "Access Policy". This creates an Access
    application, but BY DEFAULT it only covers preview deployments (`*.atlas-utility.pages.dev`),
    NOT your main `atlas-utility.pages.dev` URL.
B2. Go to Zero Trust → Access controls → Applications → open the application Cloudflare just
    created → in the hostname/Subdomain field, REMOVE the leading `*` so it matches the
    production host `atlas-utility.pages.dev` exactly (or add a second application for that
    exact hostname). This is the step people miss — without it, the main URL stays public.
B3. Attach the email policy (below) and Save.

----- THE EMAIL POLICY (both routes) -----
- Action: Allow.
- Session duration: pick the LONGEST option (e.g. 1 month) so teammates rarely re-auth.
- Rule — choose either:
    • "Emails" → paste each teammate's address (this is the "just add their emails" option), OR
    • "Emails ending in" → `@yourcompany.com` to allow your whole work domain.
- Login method: leave "One-time PIN" on (it's built in — no Google/Microsoft setup needed).
  Optionally connect Google Workspace or Microsoft 365 for one-click sign-in instead.

================================================================
PART 3 — What your team experiences
================================================================
- First visit on a device: they go to the link, type their email, get a 6-digit code by
  email (One-time PIN), enter it, and the app loads.
- After that: a session cookie keeps them signed in for the duration you set (e.g. a month),
  so they just click their bookmark — no prompt — until the session expires or they sign out.
- So the "favorite the link" experience is normal; only that first visit per device asks.

================================================================
Adding / removing people later
================================================================
Zero Trust → Access controls → Policies → open your policy → edit the email list → Save.
Changes take effect immediately for new logins. To cut someone off right away, remove their
email AND revoke active sessions (Zero Trust → … → user sessions / re-auth).

================================================================
Updating the app later
================================================================
Pages project → "Create a new deployment" → drag the folder again. The Access login stays in
place across deployments.
