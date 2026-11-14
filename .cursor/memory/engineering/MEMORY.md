# Engineering memory — AdHello Leads OS

## 2026-11-13 — Site-wide menu hops: no frost abort, no cold paint scan (1.0.754)

### What / why
- User: whole site slow; half of menu items need manual refresh.
- Frost auto-`location.assign` on stall aborted in-flight HTML for Today/Pipeline/Folders.
- Today/Pipeline still *started* cold `getAllLeads` on cache miss (raced 1.5s) — scan kept SQLite locked for the next hop.
- Fix: skip frost on common menu paths; stall shows Retry only (no auto-assign); warm-only paint + deferred cold scan; skip `ensureWorkspaceAndMember` on all navFastPath hops.

### Key files
- `public/js/navbar-shell.js`, `routes/today.js`, `routes/prospecting.js`, `middleware/withWorkspace.js`

## 2026-11-13 — Reviews/Q&A false busy on lead scans (1.0.753)

### What / why
- `/inbox.json` returned soft-busy whenever *any* lead list scan or switcher build was inflight. Reviews/Q&A do not need leads — that gate left Loading stuck during folder searches / warm scans while MCP still read the store fine.
- Fix: remove lead/switcher soft-busy; SSR inbox with fail-fast KV (shell+hydrate only on real SQLITE_BUSY).

### Key files
- `routes/businessReviews.js`, `routes/seoQa.js`

## 2026-11-13 — Stop light-hop frost assign loop + fix SW syntax (1.0.752)

### What / why
- Leave-nav frost auto-`location.assign` on Reviews/Q&A aborted the in-flight HTML document and looped; 751’s shorter stall made it worse.
- `public/sw.js` had `CACHE_VERSION = '…',` (comma) since 742 — SyntaxError, clients stuck on last good SW.
- Fix: skip untilPageShow frost for light SEO hops; semicolon in SW; bump to 752.

### Key files
- `public/js/navbar-shell.js`, `public/sw.js`

## 2026-11-13 — Fail-fast hydrate + short light frost (1.0.751)

### What / why
- Soft-busy retries still left Reviews/Q&A looking dead: sync KV waited full `busy_timeout=5000`, and light-hop frost sat 6–14s.
- Fix: `tryGetKvSync` (busy_timeout 0) for inbox reads → immediate `pending`; skip member ensure on light HTML; shorten Reviews/Q&A frost + tap-dismiss.

### Key files
- `services/database.js`, `services/businessReviews.js`, `routes/businessReviews.js`, `middleware/withWorkspace.js`, `public/js/navbar-shell.js`

## 2026-11-13 — Inbox JSON skip member ensure + bell searches (1.0.750)

### What / why
- After 749, `/inbox.json` still awaited `ensureWorkspaceAndMember` (extra sync getWorkspace) and bell polls still ran `getAllSearches` (kvList + N parses), racing Reviews/Q&A hydrate.
- Fix: skip member ensure on `appJsonFastPath`; bell polls use logged notifications only (full Notifications page still loads searches).

### Key files
- `middleware/withWorkspace.js`, `routes/notifications.js`

## 2026-11-13 — Bell idle boot still frosted hydrate (1.0.749)

### What / why
- `_deferNavExtras` used `requestIdleCallback(boot, {timeout:12000})`. Idle often fires right after paint — not after 12s — so bell/inbound raced Reviews/Q&A `/inbox.json`.
- Fix: absolute `setTimeout(boot, 15000)` only; skip script-seed on light inbox hops; inbox soft-busy while switcher inflight; longer hydrate abort/retries.

### Key files
- `views/partials/navbar_scripts.ejs`, `middleware/withWorkspace.js`, `routes/businessReviews.js`, `routes/seoQa.js`

## 2026-11-13 — Unstick switcher race that froze Reviews/Q&A (1.0.748)

### What / why
- 1.0.747 raced a 400ms switcher build on cold HTML hops. better-sqlite3 KV is sync — `setTimeout` cannot cancel it — so Reviews/Q&A `/inbox.json` hydrate stayed busy.
- Fix: cache-only on nav/inbox hops; warm only on non-inbox HTML; no idle switcher prefetch; `switcher.json` shares inflight + soft-busy when lead scan owns SQLite; more hydrate retries.

### Key files
- `middleware/withWorkspace.js`, `routes/workspaces.js`, `public/js/sidebarShell.js`, `views/business_reviews.ejs`, `views/seo_qa.ejs`

## 2026-11-13 — Workspace switcher missing workspaces (1.0.747)

### What / why
- HTML nav fast-path on switcher cache miss painted only the active workspace. Background warm filled the cache too late for the already-rendered menu, so users saw a single workspace (e.g. Flooring) until a lucky later hop.
- Fix: race the switcher build ~400ms on miss; `GET /workspaces/switcher.json`; sidebarShell hydrates the full list on idle + menu open.

### Key files
- `middleware/withWorkspace.js`, `routes/workspaces.js`, `public/js/sidebarShell.js`

## 2026-11-13 — iOS blank white after stalled hop (1.0.746)

### What / why
- Absolute frost clear after Retry grace called `hideNavLoading()` only. On iOS the outgoing page is already discarded, so peeling frost revealed a pure white void when the next HTML never arrived.
- Fix: after stall grace, `location.assign(pendingHref)` or `reload()` (same as Retry). Directory edit drawer also starts `hidden` (not translate-only) and drops the SSR JSON seed that HTML-escaped into broken JS.

### Key files
- `public/js/navbar-shell.js`, `views/directory.ejs`

## 2026-11-13 — Reviews/Q&A still stuck: bell cold scan (1.0.744)

### What / why
- 740’s “warm-first 800ms race” still **started** `listLeadsWithInboundEvents` on cache miss. better-sqlite3 `.all()` is sync — that scan locked SQLite and frosted Reviews/Q&A `/inbox.json` hydrate.
- Fix: bell/inbound polls are **warm-only** (never start a cold scan). Full Notifications page may cold-scan. Keyset-page inbound list like `getAllLeads`. Defer bell scripts until `adhello:inbox-hydrated` (12s fallback). Inbox returns `pending` while `countLeadsListInflight() > 0`.

### Key files
- `routes/notifications.js`, `services/database.js`, `routes/businessReviews.js`, `routes/seoQa.js`
- `views/partials/navbar_scripts.ejs`, `views/business_reviews.ejs`, `views/seo_qa.ejs`

## 2026-11-13 — Frost must not brick the app (1.0.741)

### What / why
- After 740, leave-nav frost stayed forever once stalled (Retry only, no absolute clear). Full-screen `pointer-events:auto` overlay made the whole app look “not loading.”
- Fix: stall → show Retry → absolute clear after 5s desktop / 10s mobile so hops cannot trap the UI.

### Key files
- `public/js/navbar-shell.js`

## 2026-11-13 — Remembered frost/SQLite fix reapplied (1.0.740)

### What / why
- User: still broken on 739 — “remember the fix” (1.0.726 rule: never cold `getAllLeads` on hot paths; frost must not lie).
- Regressions: (1) leave-nav frost peeled early on desktop → hops looked like “nothing opens”; (2) bell `/notifications` cold `listLeadsWithInboundEvents` contended with SEO hydrate; (3) Pipeline still awaited full `getAllLeads`; (4) scheduler startup unscoped scans at 8–13s post-deploy.
- Fix: keep frost until pageshow + Retry; bell warm-first 800ms race; Pipeline `leadsForPipelinePaint`; defer Engagement/etc. bell scripts; delay startup unscoped scans to 90s+.

### Key files
- `public/js/navbar-shell.js`, `routes/notifications.js`, `routes/prospecting.js`
- `views/partials/navbar_scripts.ejs`, `services/scheduler.js`, `services/database.js`

## 2026-11-13 — Engagement / Reviews / Q&A / Links still stuck (1.0.739)

### What / why
- 1.0.738 PR never merged — production stayed on **1.0.737**.
- Same freeze class also hit Engagement (fragment hydrate) and Backlinks (HTML awaited agency DFS resolve + localSeo load).
- Fix on top of 738: Backlinks `pageLocalsLight` (req.workspace only) + `/status.json` DFS upgrade; Engagement fragment retries + busy 503; yield while parsing engagement/activity lead filters; Engagement in light frost destinations; ship **1.0.739** to main.

### Key files
- `routes/backlinks.js`, `views/backlinks.ejs`, `routes/engagement.js`, `views/engagement.ejs`
- `services/database.js`, `public/js/navbar-shell.js`, plus 738 Review/Q&A/Today files

## 2026-11-12 — Reviews/Q&A still stuck after 737 (1.0.738)

### What / why
- 1.0.737 stopped Reports cold scans, but Reviews/Q&A still failed to hydrate for some users.
- Root causes left: (1) `getAllLeadsUnscoped` still did one monolithic `SELECT … .all()` (scheduler sequences every 15m + startup referral), locking SQLite; (2) `/today` awaited a cold `getAllLeads` on first paint; (3) client hydrate aborted at **5s** (same as `busy_timeout`) with no retry; (4) shell never applied settings from `/inbox.json`; (5) SW cache version stuck at 1.0.717.
- Fix: keyset-page `getAllLeadsUnscoped`; Today warm-first with 1.5s race then paint; inbox.json returns `pending: true` on SQLITE_BUSY; hydrate retries (12s, up to 3); apply settings on hydrate; bump PWA cache to 1.0.738.

### Key files
- `services/database.js`, `routes/today.js`, `routes/businessReviews.js`, `routes/seoQa.js`
- `views/business_reviews.ejs`, `views/seo_qa.ejs`, `public/sw.js`

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

## 2026-11-12 — Reports still kicked cold scans (1.0.737)

### What / why
- 1.0.736 was live but Reviews/Q&A still frosted: Reports `void getAllLeads` (fire-and-forget) still ran sync SQLite on the event loop.
- Fix: **no cold lead scan from Reports at all**; skip outreach coach when cache cold; Reports in `_lightChrome`; shorter frost failsafe on SEO/Reports hops; inbox hydrate abort 5s.

### Key files
- `services/salesTrackerLocals.js`, `routes/analytics.js`, `views/partials/head.ejs`, `public/js/navbar-shell.js`

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
