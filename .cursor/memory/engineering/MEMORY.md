# Engineering memory — AdHello Leads OS

## 2026-11-11 — Public business Directory (1.0.727–729)

### What shipped
- SEO → **Directory** dashboard (`/directory`): curate Pipeline leads → published listings with slugs.
- Public APIs (CORS open, no session): `/api/public/directory/:token/feed.json` + `/businesses/:slug.json` with `item_list_schema` / `local_business_schema`.
- AI Studio page-builder prompt at `/directory/page-prompt.txt` — index + per-slug detail, SSR/JSON-LD.
- Pipeline float bar **More → Directory** bulk-adds selected leads into **this workspace’s** directory (`POST /directory/listings/bulk`).
- **Per-workspace custom domain**: Live directory URL (e.g. `https://flooringquote.com/directory`) drives the prompt. Never default the public site to AdHello.io — AdHello only hosts the JSON feeds.
- Pattern mirrors Q&A: Leads OS owns curation/APIs; the brand’s AI Studio owns design/SSR pages. Do **not** call `ensurePublicToken` on GET (mint on Save settings only).

### Key files
- `services/directoryStore.js`, `directoryPublic.js`, `directoryPagePrompt.js`
- `routes/directory.js`, `routes/directoryPublic.js`, `views/directory.ejs`
- `views/partials/bulk_action_bar.ejs` — `#bulkAddDirectoryBtn`

## 2026-11-11 — Reviews-app lead repair must not block Agency OS (1.0.725–726, 1.0.732)

### Symptom
- Reviews (member) app showed **Link unavailable** / “Something went wrong…”
- After that was fixed, Agency OS **Folders**, **Business Reviews**, and **Q&A** stopped loading (nav frost / hang). Same class of “old” menu-hop failures.
- Recurred when Customers list awaited full **`getAllLeads`** for touch sorting + still **awaited** repair on Home/Customers/Referrals.

### Root causes
1. **1.0.722 shared team book** used `ctx.bookMemberId` on Home/Customers but `loadContext()` never set it → `memberWork` threw `invalid scope` → invalid-link screen. Fixed in **1.0.725** by always setting `bookMemberId = work.teamBookMemberId(...)` in `loadContext`.
2. Once the app loaded again, every Home/Customers/Referrals hop **awaited** `repairCallSmsContactLeads` → full **`getAllLeads`**, locking SQLite (`busy_timeout = 5000`) and starving Folders / Reviews / Q&A. Fixed in **1.0.726** (inbound-only list inside repair).
3. **1.0.732**: Customers touch-sort still called `getAllLeads`; Home/Customers/Referrals still **awaited** repair. Fixed by fire-and-forget repair + `listLeadsWithInboundEvents` for the touch index.

### Durable rules
- Never await a full workspace `getAllLeads` on member-app request paths (Home, Customers, bell). Prefer `listLeadsWithInboundEvents` (or another SQL-prefiltered list).
- Do **not** `await` `repairCallSmsContactLeads` / website-form repair on HTML hops — `void …catch`. Throttle repair (3 min per shared book); `force: true` only after CRM sync.
- Folders lite + SEO/Reviews/Q&A pages stay on light chrome (skip softphone / heavy nav extras on first paint).
- If menu hops “look like old frost bugs” again, check for a new hot-path `getAllLeads` / awaited repair before rewriting nav frost.

### Key files
- `routes/memberApp.js` — `loadContext` must set `bookMemberId`; no awaited repair / getAllLeads on list hops
- `services/memberGhlAlerts.js` — repair + pending lists; throttle + inbound-only query
- `services/memberCustomerGhl.js` — post-sync repair with `force: true`
- `views/partials/navbar_scripts.ejs` — Folders lite skips softphone
