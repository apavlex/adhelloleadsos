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

## 2026-11-12 — Reports froze Reviews / Q&A (1.0.736)

### What / why
- `/reports` always ran `loadSalesTrackerLocals` → cold `getAllLeads` (+ outreach coach could scan again). That held SQLite and frosted Business Reviews / Q&A hops.
- Fix: Reports uses warm `peekCachedLeads` only (`allowColdScan: false`); background warm; light chrome for reports; Reviews shell skips settings/store KV reads.

### Key files
- `routes/analytics.js`, `services/salesTrackerLocals.js`, `routes/businessReviews.js`, `views/partials/navbar_scripts.ejs`

## 2026-11-12 — Bad Gateway from OFFSET lead paging (1.0.735)

### What / why
- `getAllLeads` OFFSET chunks (1.0.733) re-scanned earlier rows → long SQLite holds → Render **502 Bad Gateway** while other hops waited on `busy_timeout`.
- Fix: **keyset** paging (`key < cursor`) + denser yields; unscoped scan also yields while parsing.

### Key files
- `services/database.js` — `getAllLeads` / `getAllLeadsUnscoped`

## 2026-11-12 — Directory shell-first paint (1.0.734)

### What / why
- SEO → **Directory** was SSR-blocking on first paint while background lead scans held SQLite — same frost class as Reviews/Q&A.
- Fix: HTML shell (`shell: true`) + hydrate listings/KPIs from `/directory/inbox.json` (mirrors Business Reviews / Q&A).

### Key files
- `routes/directory.js`, `views/directory.ejs`

## 2026-11-11 — Reviews-app / lead scans must not freeze Agency OS (1.0.725–733)

### Symptom
- Reviews (member) app showed **Link unavailable** / “Something went wrong…”
- After that was fixed, Agency OS **Folders**, **Business Reviews**, and **Q&A** stopped loading (nav frost / hang). Same class of “old” menu-hop failures.
- Recurred across **lots of pages** after deploys: cold **`getAllLeads`** on 2k+ lead workspaces blocked the Node process; form-sync + Customers touch-sort made it worse.

### Root causes
1. **1.0.722 shared team book** used `ctx.bookMemberId` on Home/Customers but `loadContext()` never set it → `memberWork` threw `invalid scope` → invalid-link screen. Fixed in **1.0.725** by always setting `bookMemberId = work.teamBookMemberId(...)` in `loadContext`.
2. Once the app loaded again, every Home/Customers/Referrals hop **awaited** `repairCallSmsContactLeads` → full **`getAllLeads`**, locking SQLite (`busy_timeout = 5000`) and starving Folders / Reviews / Q&A. Fixed in **1.0.726** (inbound-only list inside repair).
3. **1.0.732**: Customers touch-sort still called `getAllLeads`; Home/Customers/Referrals still **awaited** repair. Fixed by fire-and-forget repair + `listLeadsWithInboundEvents` for the touch index.
4. **1.0.733**: Bell `listPendingForMember` awaited `syncRecentFormLeads` → cold `getAllLeads`; giant single `.all()` froze the event loop. Fixed: fire-and-forget form sync (unless `forceFormSync`), form sync uses warm cache / inbound-only, `getAllLeads` pages in chunks with yields.

### Durable rules
- Never await a full workspace `getAllLeads` on member-app request paths (Home, Customers, bell). Prefer `listLeadsWithInboundEvents` / `peekCachedLeads`.
- Do **not** `await` `repairCallSmsContactLeads` / website-form repair / form sync on HTML or bell hops — `void …catch` (tests may `forceFormSync`).
- Cold `getAllLeads` must page + yield so other menu hops stay responsive after deploys clear the cache.
- Folders lite + SEO/Reviews/Q&A pages stay on light chrome (skip softphone / heavy nav extras on first paint).
- If menu hops “look like old frost bugs” again, check for a new hot-path `getAllLeads` / awaited repair/sync before rewriting nav frost.

### Key files
- `routes/memberApp.js` — `loadContext` must set `bookMemberId`; no awaited repair / getAllLeads on list hops
- `services/memberGhlAlerts.js` — repair + pending lists; throttle + inbound-only; form sync fire-and-forget
- `services/ghlFormLeadSync.js` — no cold getAllLeads
- `services/database.js` — `peekCachedLeads`, chunked `getAllLeads`
- `services/memberCustomerGhl.js` — post-sync repair with `force: true`
- `views/partials/navbar_scripts.ejs` — Folders lite skips softphone
