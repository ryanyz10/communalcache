# Build guide

Build one feature per PR, including Worker/D1 logic, its UI slice and real local
storage tests. [plan.md](plan.md) is the settled target; [database.md](database.md)
gives the guarded SQL/batch protocols. Every intermediate release must be safe and
deployable, even when a new route is gated until its full cascade is proved.

The [user-flow inventory](user-flows.md) is the cleanup/refactor parity invariant:
implemented journeys, permission/data effects, current test coverage and explicit
local walkthrough results, including blocked cases. It is not release approval.

**Single D1 replaces PR #29's Owner DO model.** Keep its product decisions (shared
items/stock, manual Lent out, owner-scoped private photos), not its object split,
projections, target registration or eventual revocation. PRs 2–6 implement the D1
routes/screens with real SQL tests. Draft PR 7 removes the historical Cache code
and prepares destructive class deletion; it is **not approved for merge/deploy**.
No remote migration, deployment, class deletion or staging reset has run as part
of that draft. Keep legacy Fly/Supabase live until separately approved cutover.

## Before you start

- **One authority:** D1 contains cache config/secrets, memberships, items,
  item_caches, stock, requests and outbox alongside auth/push. No copied grant.
  Every cache-data statement/batch checks current active membership via join/EXISTS;
  item routes also check attachment/active owner. Non-member 404, only valid-secret
  removed join 403. Private library is item-owner authenticated, not cache fan-out.
- **No interactive transaction:** guarded INSERT ... SELECT / UPDATE ... WHERE,
  or ONE atomic batch whose first guarded write stores a unique operation token
  and whose later statements require it. No separate SELECT/await/write for auth
  or stock; no SQL changes() across batch statements (UNVERIFIED). Inspect primary
  D1 meta.changes. A no-op guard is not SQL failure; dependent effects must no-op.
- **One stock ledger:** all-cache pending sum for item, never per-cache stock or
  reservation copies. Pending-only decisions deduct once. FK/CHECK failure must
  roll back the entire batch; a JS throw afterward cannot undo it.
- **Atomic durable effects:** state + recipient-snapshot outbox + relevant R2
  cleanup intents in the same batch. Queue/R2/provider I/O after commit. Bounded
  Cron rescues enqueue gaps/expired claims and cleanup; no DO alarms or registry.
- **Real SQL tests:** @cloudflare/vitest-plugin with readD1Migrations and
  applyD1Migrations; real local D1 concurrent requests/batches. Mock provider HTTP,
  not SQL. Deprecated vitest-pool-workers is not the dependency.
- **Rollout gate:** port each route to one authority only; disable old cache-local
  write/compatibility paths rather than dual-write shared stock. Old removal/delete
  routes must not operate against partially ported data. Request paths reopen in
  PR 4 after guarded stock/membership race proofs; destructive paths remain gated
  until PR 5's complete cascade proof. Leave inactive DO deployment configuration
  until separately approved retirement; do not add Owner DOs.

## Completion gates

Existing tooling supports these local gates; none authorizes a remote operation:

```bash
npx --no-install tsc --noEmit
npx --no-install vitest run
(cd web && npx --no-install tsc --noEmit && npm run build)
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run -e staging
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run -e production
```

Test empty and additive/upgrade D1 migrations; preserve auth/OTP and quantity/status
checks. Tests use real D1 without object bindings/schema/alarm helpers; historical
object-only tests retire with PR 7 and canonical equivalents remain. Smoke local health/config, SPA deep links and JSON API 404s
under npm run dev (local bindings; never --remote). `.dev.vars` is gitignored;
disable fallback to legacy `.env`. Docs-only checks distinguish existing-code
regression gates from D1 target tests that have not been implemented.

CI remains secret-free on all PR bases and master/production pushes, with all
three named/default dry-runs. After approved setup, successful master push CI
releases staging; fast-forward `git push origin master:production` runs production
CI before release. See [pipeline](deploy.md#pipeline); opening this docs PR does
not deploy. Legacy Go make test/vet is reference validation, not D1 protocol proof.

## Status

Update the relevant row in its own PR; implementation and review are separate.
Old cache-local features are historical references, not the current authority.
Each feature row records its original rollout boundary; later rows reopen gates.
PR labels below are sequence numbers, **not GitHub issue/PR numbers**.

| # | Feature | Status / target |
| --- | --- | --- |
| Existing | Foundation / deploy pipeline | Worker/auth/local tooling and staging/production pipeline exist; external setup/smoke remains separately approved |
| Existing 1–2 | Caches / Joining | Cache-local DO implementation to replace in D1 PR 2; Go #2/#3 are closed historical references |
| Existing 3–4 | Items / Photos | Cache-local implementation; replace with canonical D1 library/attachments and owner-scoped photos in PR 3 |
| Existing 5 | Requests | Cache-local stock/fan-out; replace with all-cache guarded D1 stock in PR 4 |
| Existing 6–7 | Notifications / Push/PWA | Retain guarded D1 claim/delivery and crypto/UI checks; change producer atomicity and remove registry recovery |
| Existing 8 | Removal / deletion | Old local cascades, not shared-item-safe; gated/replaced by PR 5 |
| Existing 9 | Polish | D1 write budgets, accessible/error states, telemetry/runbook retained; query/budget fit remeasured |
| Existing | Magic-link sign-in | Implemented locally, link-only primary + explicit OTP fallback; live mail/mobile proof pending |
| Existing | Frontend redesign | Existing design slices retained; library/items board completed against D1 in PR 6 |
| Historical | Owner DO specification | [#29](https://github.com/ryanyz10/communalcache/pull/29) merged, **superseded** by single-D1 architecture; do not implement its namespaces/protocol |
| Historical | Your items cache fan-out | Draft [#28](https://github.com/ryanyz10/communalcache/pull/28) superseded by direct-D1 library, not target design |
| D1 1 | Single-D1 specification | This docs-only PR; no implementation/migration/resource changes |
| D1 2 | Caches / membership / joining | Implemented; merged: canonical D1 config/membership/join outbox, additive 0007 migration, no DO bridge. Legacy item/photo/request/removal APIs gated temporarily; PRs 2–4 intended to merge together (staging test data only). |
| D1 3 | Shared items / attachments / photos | Implemented; merged: 0008 canonical items/attachments/cleanup, own-library APIs, retained atomic cache create+attach and scoped PATCH/photo routes, restored item UI. Requests/destruction remain gated; library/add-sheet/checkbox screens stay PR 6. |
| D1 4 | Requests / shared stock / Lent out / notifications | Implemented; merged: 0009 requests, all-cache reservation guards, atomic token-gated decisions/outbox, direct party pagination, Lent out toggle/approval checkbox. Request APIs/screens reopen after race proofs; every destructive route stays gated for PR 5. |
| D1 5 | Removal / leave / detach / deletion / races | Implemented; in review: guarded atomic cascades/outbox/cleanup, 0010 left-membership rebuild and rejoin semantics, removal/leave/detach/global-delete confirmations; no DO/config retirement. |
| D1 6 | Library / add sheet / checkboxes / items board | Implemented; in review: owner-scoped paginated library/Home preview, Existing/New cache add sheet, atomic create+attach, Shown in confirmations, shared availability and private photos; items board 1a–1d, supersedes #28. |
| D1 7 | Retire Durable Objects / staging reset | Implemented for draft review only: Cache code/bindings/RPC/sweeps and historical tests removed; inherited v2-retire-cache deleted_classes and D1 0011 projection-table drop prepared. Explicit owner approval required before merge/deploy. Staging test-data reset is NOT included and remains separately approval-gated. |
| Readiness 1 | Plans foundation | Implemented; in review: 0012 free/plus user/cache plans, one plan_limits table, guarded free limits and stable API/web errors; free owned_caches is 1; plus keeps owned_caches at 3 and cache_members at 100. No plan UI/billing or remote assignment. |
| Readiness 2 | Free quotas and limit-reached UX | Implemented with readiness 1 for existing endpoints: atomic cache/membership/item/request/photo guards, rolling 24h and active-only member counts, races and clear limit-reached copy. Profile-photo enforcement now lands with readiness 3. |
| Readiness 3 | Private profile photo | Implemented; in review: 0013 app-owned user_photos + explicit profile cleanup scope, self/shared-active SQL read and metadata guards, post-R2 plan recheck, Account Change photo sheet and avatars/initials across named views. No theme/dependency/resource changes. Browser upload is blocked by shared item/profile transport read errors; API/D1/UI-unit proof is separate. |
| Readiness 4 | Contact after approval | Implemented; in review: 0014 app-owned user_contacts, validated server-built links, request-scoped approved-party/both-active SQL reveal, Account editor/preview and request buttons/nudges. Optional private approval message starts empty, max 500 code points, atomic with decision/outbox; never auth-email fallback. Inline platform glyphs need official brand assets before release. |
| Readiness 5 | Cozy theme and app identity | Implemented; in review: round-6 sunny/evening CSS tokens via prefers-color-scheme, 2px Home boxes/cache-member houses, decorative reduced-motion cat, open-box/cat Home mark and reproducible SVG/32/180/192/512 icon set. Phone/wide fixture comparisons cover key screens in both palettes; native installed-PWA/device proof remains separate. No API, plan UI or dependency changes. |
| Readiness 5a | Desktop cozy pass | Implemented; in review: 1200px desktop content, width-scaled pixel scenes/taller sign-in illustration, cache members sidebar, outgoing request column and two-column Account. Original phone geometry/classes retained below 1024px; native-viewport screenshot receipts in the PR body. No API/dependency changes. |
| Readiness 5b | Cozy motion | Implemented; in review: shared 400ms stepped cache opening for horizon/cards and Enter, one two-frame integer-pixel walker with edge pauses/turns, idle blink/ear/sky motion, small card lift, 140ms route opacity fade and sheet entrance. Reduced motion skips all animation/navigation delay; hidden tabs suspend motion. No API/dependency changes; recordings stay in the PR body. |
| Readiness 5c | Fluid responsive layout | Implemented; in review: full-bleed Home/cache sky and repeated terrain, shared clamp gutters/1920px content cap, intrinsic card grids, readable 72ch prose/forms, room-aware cache sidebar and integer 3–7px artwork above 640px. 390px phone visuals are unchanged; 449–639px keeps phone content geometry while extending only decorative background bands. Native viewport receipts stay in the PR body. No API/dependency changes. |
| Readiness 6 | Turnstile and bot setup | Implemented; in review: one strict Worker siteverify guard for magic-link/OTP sends and cache creation, explicit action/theme widgets, one-use token reset and fail-closed errors. Owner-approved shared public sitekey with separate staging/production hostname lists; secrets remain owner-managed. Real-token staging validation pending after deploy; Bot Fight Mode remains separate. |
| Readiness 7 | Google sign-in | not started — needs owner setup; Better Auth provider, verified-email linking only; Apple deferred |
| Readiness 8 | Owner admin | not started — needs owner setup; Access + Worker JWT verification + allowlisted app user ID; names/IDs only, plan/usage/failed-outbox/suspend controls |
| Readiness 9 | Supporter tips link | Implemented; in review: owner-approved Buy Me a Coffee anchor on Account and quiet signed-in/landing footers, one URL constant, new-tab noopener/noreferrer. No provider script/widget/iframe, tracking params, webhooks, payment storage or unlocks; hidden when unconfigured. |
| Readiness | Signed-out landing page | Implemented; in review: public `/` uses the cozy landing mock and shared pixel art, centralized copy/metadata and sign-in CTAs. Session resolution gates rendering; signed-in Home and invite/magic-link paths are unchanged. No new dependencies or public cache data. |
| Fix | Invite sign-in continuity / paste-to-join | Implemented; in review: strict invite callback survives magic-link tab changes, one-hour session/local intent fallback, clear-on-join/sign-out/expiry, and Home paste sheet. Explicit Continue + Join and gated pending flow remain; general same-origin callback contract is preserved. |
| Organic 1/6 | Foundation / cats / app shell | Implemented; in review: Claude Design labelled-box day/night roles, self-hosted OFL Caprasimo/Figtree, ID-derived organic cats and photo/cat avatars, Box/Stamp/Tabs primitives, desktop top tabs and phone bottom navigation. Replaces old pixel strips, walker, delayed cache opening and route fade; page layouts remain transitional for Organic 2–6. No Worker/API/migration/dependency changes. Native shell/design comparisons stay in the PR body. |
| Organic 2/6 | Account / getting in | Implemented; in review, depends on Organic 1: labelled-box sign-in/email/name/neutral-invite/pending/Account layouts; self-only validated nullable cat_coat with additive 0015 migration and scoped display enrichment. Six-coat choice preserves hashed traits; auth/CSRF/Turnstile/OTP/Continue/contact/photo/push/tips semantics retained. No pre-join preview API or cache/member/inviter disclosure. Native comparisons and real-D1 proof stay in the PR body. |
| Organic 3/6 | Home / caches / live summaries | Implemented; in review, depends on Organic 2: B08–B13 labelled boxes, caller-inclusive member cats, exact D1 totals/pending-answer badges and bounded Home previews, full-list contents filters/search and per-member attached counts. Responsive new-cache preview keeps real bot gating, OFF approval default and guarded writes; settings/join decisions/invite reset/removal/leave/paste stay reachable. No counters, new grants, email disclosure or dependencies. Native comparisons and local-D1 proof stay in the PR body. |
| Organic 4/6 | Library / item forms / sharing / photos | Implemented; in review, depends on Organic 3: B14/B15/B17/B21/B23/B24 personal label box, owner-scoped exact totals/filtered cursor pagination, packing slips, item name/photo tile and owner controls. New items retain one canonical ID across optional photo and selected-cache partial failures; cache-context creation keeps its atomic first attachment. Edit/type/stock/Lent out/sharing/detach/global-delete/private-photo safeguards remain; Ask opens the existing inline form until Organic 5. Native comparisons and real-D1/browser proof stay in the PR body. |
| Organic 5/6 | Requests / ask and decision sheets / approved detail | Implemented; in review, depends on Organic 4: B16/B18–B20 request packing slips, stock-bounded ask sheet, reason-required decline flow and reusable Lent out ON/empty-message approval defaults over the unchanged guarded batch. Party-only single-request GET and focused `/requests/:id` reuse request-cache/both-active contact guards; approved notification links validate UUIDs and reauthorize. Owner stock preview uses quantity minus this ask, not twice-subtracted availability. No auth-email fallback, stored counter, new dependency or release approval. Native comparisons and real-D1 proof stay in the PR body. |
| Organic 6/6 | Public landing / flat icons / parity closure | Implemented; in review, depends on Organic 5: L01/L02 fictional shelf/packing slip/CTA/footer, local flat BoxMark SVG/32/180/192/512 icon generation and Organic off-artboard dialog/sheet polish. All 54 flow IDs revisited with explicit local walk/partial/blocked status in user-flows; fresh native day/night B01–B25 and landing comparisons stay uncommitted. Real D1/R2 journeys retain guarded state/outbox/cleanup and history/contact denial; provider/device/background delivery remains unclaimed. No dependency, public data, deployment or release approval. |
| Organic follow-up | Approved pre-join invite preview | Implemented; in review on master after Organic 1–6 merged: authenticated current-secret GET reveals only cache name, active count and up to five shared cat-trait tuples; no member IDs/names/emails, inviter, photos, things or config. One SQL read enforces current secret/active owner and removed403; wrong/rotated404, no preview writes/grants, explicit joins unchanged. Shared traits render identically before/after admission; native day/night comparisons and real-D1/browser proof remain uncommitted. Owner approval is recorded in plan.md; external setup/release gates remain separate. |
| Organic follow-up | Peek-inside cache opening | Implemented; in review on master: tapping a Home box grows its handle hole over the screen, a cat looks around, then the dark shrinks into the open cache's handle (2.1s, fixed). OS reduced motion always skips it; an Account setting (this device only, localStorage) picks Every time / First time only / Never. Cache and items queries prefetch on pointerdown. Web-only: no API, schema, dependency or deployment change; loading placeholders and recovery cards are tracked separately below. |
| Organic follow-up | Loading placeholders / cache handoff states | Implemented; in review: shared day/night shimmer, route-aware signed-in startup with a boolean device hint, and page-shaped read placeholders. Cache uses native desktop/mobile rows, known Home metadata, a clock-tested six-second slow notice, retry/error and empty-add cards, cached-data bypass and reduced-motion swaps. No Worker/API/schema/dependency changes; native comparisons remain outside git. |
| Cleanup 1/5 | Unreachable starter UI / retired frontend branches | Implemented; in review: removes unimported starter stylesheet/assets and pixel definitions, unused ItemList/thumbnail mode, initials and first-page counter. Useful checks now exercise routed CachePage, Avatar and authoritative summary badges; native before/after receipts stay outside git. Shared cats, live UI, Worker/SQL, migrations and dependencies are unchanged. |
| Cleanup 2/5 | Unreachable layout CSS / obsolete assertions | Implemented; in review: prunes only verified dead compatibility selectors and dead arms of mixed rules in place. Shared page/sheet sizing, theme aliases, live layouts, JS-created peek classes/keyframes and contrast/font/icon checks remain; current rendered-layout and native parity proof replace retired CSS-string requirements. No Worker/API/schema/dependency changes. |
| Cleanup 3/5 | Concrete cache / private-item query reuse | Implemented; in review: settings and item routes reuse cacheDetailQuery; four owner-library reads share one account-scoped libraryItemQuery. Cache-context item keys/paths, enabled/retry policy, prefetch and mutation invalidation/removal remain distinct and unchanged. Exact-query, disabled-read, denial/refetch/account-switch and native/network parity receipts stay outside git; no Worker/SQL/schema/dependency changes. |
| Cleanup 5/5 | Straight-line Worker method dispatch | Implemented; in review: replaces only the nested allowed-method conditional with ordered if/else cases in the same dispatcher. An explicit route/method matrix passes against both the unchanged and refactored code; routing/capture precedence, Origin/session/profile guards, bodyless writes, private-photo errors and API aliases remain intact. UI, SQL, migrations, Queue/Cron, configuration and dependencies are unchanged. Optional Cleanup 4 was skipped because exact-preserving Home form extraction required extra opening/reset coordination. |
| Readability 1/9 | CSS layout and declaration formatting | Implemented; in review: expands the six app stylesheets to one declaration per line and separate rule blocks, preserving selectors, at-rule preludes, values and complete rule/declaration order. Read-only parsed-tree equivalence and identical production CSS bytes prove the formatting-only boundary; ten source assertions now tolerate only formatting whitespace. No app/Worker logic, dependencies or visual behavior changes. |
| Readability 2/9 | Named, expanded Cat renderer | Implemented; in review: replaces cryptic renderer/color/style aliases with named anatomy and explicit pose composition. Exact pre/post static markup checks cover every trait, pose, motion flag, animation delay and app wrapper width; a frozen 720-variant fingerprint remains in tests. Shared hash/traits, SVG geometry/attribute order, keyframes and responsive CSS are unchanged; focused phone/day and wide/night smoke replaces a full matrix recapture. |
| Readability 3/9 | Page-family skeleton modules | Implemented; in review: replaces PageSkeletons with concrete Home/cache/library/item/request/Account families and a small RouteSkeleton selector; callers import their family directly. Packed JSX and geometry fallbacks are explicit, while primitives, six-second notice/cancellation, route precedence and markup stay unchanged. Pre/post render comparisons, frozen export fingerprints and native loading-frame parity stay outside git apart from the regression tests. |
| Readability 4/9 | Cache pages and settings state clarity | Implemented; in review: names cache/item/queue queries, counts and refs, replaces the nested contents chain with explicit local render states, and expands settings JSX while retaining local effect owners. Query/enabled policies and mutation invalidation/focus order stay unchanged. Parent-verified dialog contracts, cache-state regressions, four-mode pixel parity and controlled network receipts prove the slice; native-dialog/slow browser walking remains tool-blocked and is not claimed. No Worker/SQL/schema/dependency changes. |
| Readability 5/9 | Item routes, form and sharing clarity | Implemented; in review: splits item detail/editor routes, keeps owner controls local, and names the form's committed progress/snapshot and photo/share recovery steps. Photo, Add and Shown in JSX/lifetimes are explicit; concrete query keys, mutation/invalidation order and the existing persistItem protocol stay unchanged. Parent-verified dialog/save contracts, four-mode item/library/Add parity and bounded network receipts prove the slice; native destructive-dialog walking is replaced by the handler/ref route, not claimed as a browser pass. No Worker/SQL/CSS/dependency changes. |
| Readability 6/9 | Request routes, cards and sheet clarity | Implemented; in review, stacked on Public pages: RequestCard/ItemRequests are direct feature modules; route groups, ask availability, decision form modes, focused detail and approved-party contact rendering are expanded with descriptive locals. Query/enabled/invalidation order and state owners remain unchanged. Eleven unchanged handler/ref contracts pass first on the frozen parent, then the rewrite; 76 captured manifest frames are AE=0 and ten handler-driven real-local network groups match. Eight pagination frames are blocked by two CDP disconnects per group, not claimed as visual passes. No requester-cancel feature is introduced; unsent-sheet Cancel/Escape and decision close remain covered. No Worker/SQL/CSS/dependency changes. |
| Public pages | Privacy policy / terms of use | Implemented; in review, stacked on Readability 5: public `/privacy` and `/terms` remain readable without a session or working auth API. One content module holds owner-review policy drafts; landing footer and sign-in links use the Organic theme. Source audit distinguishes implemented privacy/notification/deletion behavior from conditional Google/Access setup. No Worker, SQL, migration, dependency, configuration, external setup or release approval. |
| Readability 7a/9 | Remaining route pages | Implemented; in review, stacked on Readability 6: Home, Library, Account name/logout, Join/queue/paste, Login, magic-link, onboarding and landing JSX use descriptive locals and explicit branches. Home dialog ownership/lifecycle, query keys/guards, mutation/invalidation/focus order and DOM/aria remain unchanged. Eleven contracts pass first on the frozen parent, then unchanged on the rewrite; 174 captured manifest pairs are AE=0, with 16 late photo/library-pagination frames blocked after two CDP drops per group. Sixteen bounded network groups match; auth/bot/create presentation fixtures are distinguished from real-local-D1 groups in the PR. Account photo/contact/push/coat/peek controls, shared components and lib reflows remain for 7b; no Worker/SQL/CSS/dependency changes. |
| Readability 7b/9 | Independent controls and shared components | Implemented; in review, stacked on 7a: profile photo/contact/push/coat/peek controls and fourteen dense shared component/overlay modules have expanded JSX, descriptive locals and explicit branches without new ownership or hooks. Eleven control and three overlay phase/geometry contracts pass on the frozen parent then unchanged on the rewrite; 200+ shared-export markup cases match. All 334 current-revision manifest frames are AE=0, including media/pagination prepared through fresh real-local upload handlers; ten application-network groups match, with push browser/provider APIs explicitly stubbed and immutable photo versions symbolically mapped only from observed URLs. Runtime lib implementations remain untouched/deferred; no Worker/SQL/CSS/dependency changes. |
| Readability 8/9 | Worker dispatch and dense helpers | Implemented; in review, stacked on 7b: expands plain route dispatch, POST write-route selection, validation/photo/auth/notification/push/Turnstile/cleanup helpers without new routing or SQL abstractions. The unchanged #71 matrix retains 546 route/method cells per signed-out/unnamed caller; a new parent-first real-D1 fixture matches 1,380 response cells across 49 route/scenario rows and twelve caller/Origin/Turnstile states, with exact headers and raw-body fingerprints, no normalization. D1 auth/membership/stock remains authoritative; Origin/profile/method/session order, private photo reads, provider bounds and durable-effect ordering are preserved. src/db.ts plus all fifteen migrations are byte-identical to base. No frontend, dependency, configuration, remote-resource or release change. |
| Gate 10 | Full user-flow parity and cleanup refactor | Local Organic walkthrough recorded for all 54 journeys; provider/setup/device and exhaustive accessibility variants remain explicitly partial/blocked. Final intended release scope still needs its complete parity acceptance; not security/release approval. |
| Gate 11 | Independent security review | not started — independent reviewer, exact revision/scope, findings fixed or explicitly accepted; not a CI-only signoff |
| Gate 12 | Explicit release approval | not started — owner-approved revision/environment/features after parity and security; external setup, destructive retirement/reset and legacy cutover approvals remain separate |

## D1 implementation plan

### PR 2 — Caches, memberships and joining in D1

Make existing D1 caches canonical (name/config/join_secret/requires_approval) and add
memberships(cache_id,user_id,role,status). Cache+active-owner creation is one batch,
with fresh ID/token guarding owner insert. Home/detail query canonical rows, no
my_caches or eventual home discovery. Port settings, member reads, invite rotation,
open/gated join and owner approval/rejection with same-statement/batch membership.

Secret remains 32 random bytes/base64url. Compare fixed decoded bytes in constant
time; join write must match the exact stored secret/version compared and current
approval setting, so a rotation/config race cannot reuse a prior read. Existing
active/pending join is idempotent, removed stays 403 only for valid-current-secret;
missing/wrong secret 404. Reject pending membership deletes it for retry; snapshot
join outbox before deletion, in that same token-guarded batch. No owner leave/
removal/transfer, no self-leave endpoint added. No public emails.

**Proof:** real-D1 empty/upgrade migration and constraints; auth matrix; failed
primary → no dependent state/outbox; injected batch failure rollback; one owner;
rotation/join/config races, open/gated/idempotent joins, reject/retry and removed
403. UI create/open/copy/rotate and invite → login → name → saved join body.
Retain cookie/profile/Origin rules. Gate old destructive routes now, before porting
shared data; no parallel membership source for new D1 routes.

**Approved PR 2 transition:** no D1-to-DO membership compatibility bridge. All
legacy item/photo/request APIs, including GET /api/requests and destructive
routes, return temporary 503 items_moving after normal auth/profile/Origin guards.
The UI shows only “Items are being moved, back soon” where lists would be and
hides add/remove actions. Keep Cache code/bindings, legacy direct-DO regression
tests and legacy-only sync until their assigned retirement. Canonical D1 rows are
excluded from legacy registry sweeps and cannot be overwritten by old projections.
Staging holds test data only; PRs 2–4 are meant to merge together, so staging only
briefly goes without items. Existing DO data is not imported/reset implicitly;
new D1 caches/joining work immediately, and any old-data reset remains separately
approval-gated in PR 7.

### PR 3 — Shared items, attachments and photos

D1 items with owner_id, immutable type, consumable 0–9999 or reusable NULL, manual
availability fields; item_caches unique attachments with real FKs. Library access
filters authenticated owner directly, including unattached items. Attach requires
owner and active cache membership in guarded INSERT, no target registration or
listing projection. Cache lists/detail join attachment and both memberships.
Provide backend/minimal UI without enabling unproved destructive paths.

Photos use ownerId/itemId/uploadUUID immutable private R2 keys. Owner finalization
rechecks item/ownership in guarded D1 batch after R2 I/O; commit photo_path plus
replaced/rejected cleanup intents together. Add bounded Cron cleanup with guarded
claims/idempotent exact/prefix deletion; no DO sync. Document put-before-finalize
orphan window honestly; pre-upload tracking/sweep is an upgrade, not atomic R2/D1.

**Proof:** one item shared to two caches without copies, unshared library, forged
owner rejection, active/pending/removed/owner cache gates, stock/type constraints;
attach vs removal, photo caps/sniff/SVG rejection, ownership recheck/upload-delete
race, uncertain finalization does not delete current key, known cleanup retry and
private/no-store streams. No detach/removal deletes library photo. Port source
routing without retaining old stock writes. Destructive route gate stays closed.

**Approved PR 3 API/UI contract:** expose private GET/POST /api/me/items,
GET/PATCH /api/me/items/{itemId}, GET/POST .../photo and guarded PUT
.../attachments/{cacheId} now. Keep POST /api/caches/{cacheId}/items as the real
“new item inside a cache” flow: create canonical item plus first attachment in one
atomic guarded batch. Keep cache-context PATCH/photo POST with ownership, active
membership and attachment checks; PR 6 may move those writes to private routes.
Restore the current cache list/add/edit/photo screens, not the PR 6 library/add
sheet/cache checkboxes. Requests, member removal, item deletion and detach stay
gated. All cache item/photo reads require active caller AND owner membership;
losing a cache never deletes the canonical item/photo or blocks own-library access.

Manual available/unavailable_note fields are stored and validated now (200 Unicode
code points); UI controls/approval behavior follow later PRs. With request routes
gated, new D1 items have no reservations yet; PR 4 must add the all-cache pending
floor to guarded stock edits before requests open. Cleanup uses two cursor-paged
intents per Cron tick, one 100-key prefix page each, 90s guarded leases and durable
retry without an attempt cutoff. A nonempty prefix page retains its intent until
a later empty confirmation. Its worst normal sweep is seven D1 queries + four R2
calls, leaving headroom alongside retained legacy registry/outbox recovery.
Replacement pointer + old-key cleanup commit atomically; rejected-upload cleanup
is an independent guarded repair that never deletes a currently referenced key.
A put-before-finalization crash can still orphan unknown bytes; no complete orphan
sweep or R2/D1 atomicity is claimed.

### PR 4 — Requests, shared stock, Lent out and notifications

D1 request INSERT ... SELECT includes active requester/owner memberships in C,
attachment, non-owner, valid quantity/type, manual flag and stock minus pending sum
across **ALL caches**. Same batch records outbox via new request UUID. No separate
SELECT/await/write, no admission flags or SQL changes(). Direct indexed/cursor
incoming/outgoing query replaces cache/owner fan-out and request_index.

Approve/reject primary pending-only guarded UPDATE writes fresh decision_token;
dependent stock deduction, optional reusable Lent out flag/note and outbox require
that exact token in the same batch. A losing primary causes no effects. Ensure
stock CHECK failure aborts, not a silent deduction no-op. Owner stock edit includes
all-cache reservation floor. Preserve cache-only pending queue/party-only history.

Manual Lent out/note max 200 Unicode code points blocks new requests, **not existing
pending rows**. Checked reusable approval sets it atomically; unchecked does not
clear it. No holder/return/cancellation model. Keep existing outbox guarded claim,
failed_at eligibility, 90s lease, 10s provider/30s row deadlines, Queue retries and
bounded Cron rescue. Producers now insert outbox with state, never DO intents.
Queue send is post-commit; enqueue failure is recoverable from committed outbox.

**Proof:** concurrent creates through two caches never overbook; concurrent double
approve deducts once; approve/reject/edit/create races; zero primary → no dependent
effects; injected failure rolls back stock/decision/flag/outbox. Note Unicode
bounds, unavailable create 409, pending still decidable, checkbox atomicity;
cache queue vs party-history privacy and no emails. Competing outbox claims,
crashed sixth claim recovery, stale terminal writes, post-commit enqueue crash,
Cron fair pagination and Queue duplicates. Open request routes after these proofs;
keep removal/detach/delete gated until PR 5 demonstrates their complete cascades.

**Approved PR 4 rollout clarification:** request APIs/screens reopen now, rather
than waiting for PR 5. Membership-race tests may mutate local D1 membership directly
to prove the next request is refused; this is not a destructive endpoint or proof
of PR 5's rejection/detachment cascade. A request that committed before that raw
membership change remains reserved until its proper cascade/decision, never
silently freed by a projection or partial removal.

Migration 0009 adds requests with quantity/status/decided_at constraints, indexes,
a fresh creation_token witness and decision_token. A zero-row create cannot reuse
an existing request ID to manufacture an outbox row. Bound-number integer equality
plus schema checks validate quantities without assuming parameter typeof() matches
JavaScript integer values. Request/decision state and recipient snapshots commit
atomically; enqueue remains post-commit and recoverable through the existing outbox.

Enable GET/POST /api/caches/{cacheId}/items/{itemId}/requests, canonical POST
/api/me/requests/{requestId}/approve|reject and guarded cache-context decision
routes. GET /api/requests directly queries owner/requester parties with stable
created_at/UUID cursors (25 rows/page), not cache RPC fan-out; the compatibility
unavailable_cache_ids field is always empty. Party history never grants cache,
item/photo or decision access. Cache queues expose only that cache's pending
requesters, plus party-owned decided rows. Item available_quantity is calculated
from ALL-cache pending reservations without returning other caches' identities.

Minimal owner Lent out/note controls and the reusable approval checkbox ship now.
A checked approval sets the flag and optional note in the decision batch; omitted
note preserves it, explicit null/blank clears it. Unchecked approval preserves the
existing flag/note. Unicode validation remains 200 code points. Requests use the
server's shared available_quantity, not a sum of the visible cache queue; edits,
decisions and availability changes invalidate item/request views across caches.
No holder/return lifecycle or cancellation status is added.

### PR 5 — Removal, leave, detach, deletion and race tests

Each destructive operation is ONE guarded atomic batch, not a JS loop or partial
paginated commits. Primary token marker establishes authorization; INSERT ...
SELECT snapshots outbox recipients before source deletion; every later statement
requires that operation's token/target IDs. No copied grant, tombstone or eventual
convergence protocol.

- Remove active non-owner R from C: active cache-owner guard, mark R removed,
  snapshot/reject R's pending via C and all pending through R-owned attachments
  in C, then detach R's items from C. Dedupe overlap. Keep library/photos/other caches.
- Detach I,C: item-owner/active-member guard, snapshot/reject pending via I,C,
  delete marked attachment last; other attachments and canonical state survive.
- Global item delete: item-owner guard, snapshot pending across all caches, reject,
  insert R2 cleanup then delete item/dependents last. Snapshots survive cascade.

Next SQL statement sees removal immediately. Racing creates either commit first
and are included, or fail after removal/detach/delete; no sync-delivery wait.
Completed approvals and previously authorized streams are not recalled.

**Approved leave semantics:** POST /api/caches/{cacheId}/leave runs the same cleanup
as removal but sets status=left; owners get 409 and cannot leave. Migration 0010
rebuilds memberships while preserving rows, timestamps, operation tokens, FKs and
owner indexes. Older PR 4 code does not implement left-member rejoin; prefer a
compatible fix-forward rather than assuming a code rollback restores that flow.
Left is non-active (cache-data 404), but a valid-current-secret join
behaves like a new member: open → active, gated → pending. Old attachments and
rejected requests are never restored. Only removed retains valid-secret 403.

Enable private DELETE /api/me/items/{itemId} as global delete, guarded cache-context
DELETE .../items/{itemId} as its global-delete alias, and DELETE private item
.../attachments/{cacheId} as detach-only. Current screens get owner Remove member,
member Leave, an explicit every-cache/library global-delete confirmation and a
small Stop sharing in this cache confirmation. Full checkbox/library UI stays PR 6.
Membership/remove/leave and detach each use five fixed statements; global delete
uses seven, independent of recipient count. All affected relational rows/outbox
snapshots commit together. At most 25 Queue hints are sent after commit; Cron
rescues the remaining durable outbox without splitting the destructive batch.

**Proof:** real concurrent request/removal, attach/removal, decision/removal,
request/detach and request/delete in both orders; no affected pending survivor;
no duplicate deductions/notifications; failed primary → zero cleanup/outbox;
constraint failure anywhere → complete rollback; owner cannot leave/be removed;
wrong member/cache/owner 404; delete snapshots every pending recipient before FK
cascade; library/other attachments/photos survive cache loss. Bound statement/
row work within measured platform limits; fail safely rather than splitting the
atomic invariant. Only now enable destructive paths; close unsafe old aliases too.

### PR 6 — Screens: library, add sheet, checkboxes and items board

Home Your items directly queries own D1 library, including unshared rows and
attached caches. Cache Add item sheet offers **Existing item / New item**; create
once then attach. Failed attachment remains visible/retryable, never duplicates.
Item detail owner cache checkboxes attach/detach through proved batches. Add Lent
out/note and reusable approval checkbox without holder/return UI. Finish **items
board 1a–1d**, retaining approved design, mobile layout and accessibility.

**Supersedes #28**'s cache fan-out library; reuse presentation patterns only, not
its query/permission model. Prove one canonical item in two caches, private library,
new/existing selection, cache checkbox failure/retry and immediately shared manual
availability. Test stable pagination, correct empty/loading/error states, labels,
keyboard/focus/modal behavior and no wrong-account stale private query data. UI
and browser checks do not replace real-SQL authorization/stock/race proof.

### PR 7 — Retire Durable Objects; staging reset separately approved

**Draft only: merging deploys a deleted_classes migration that permanently deletes
all Cache DO data on staging (and later production). Explicit owner approval is
required. Do not merge or mark ready without it. The staging test-data reset is
NOT included.**

Prepared code removes Cache class/RPC/bindings, pending_sync/alarm/registry work,
legacy request fan-out and object-only tests/helpers. D1 0011 drops only unused
my_caches/cache_sync_cursor; canonical caches and all app/auth/durable state stay.
Outbox Queue/Cron and R2 cleanup Cron remain independent. Wrangler preserves v1
and appends inherited v2-retire-cache with `deleted_classes: ["Cache"]`; there is
no Owner class. Local checks/dry-runs do not apply that class deletion.

Inventory staging data/R2/outbox/push and retain approved backup/recovery evidence.
Get separate approval for the staging **test-data reset**, specify exact databases/
namespaces/buckets affected and preserve secrets/resource identities. No hidden
constructor drop, inferred duplicate mapping or implicit dual-write transition.
New-stack staging has no production data; legacy migration/cutover is later.

**Proof:** all routes/cron/queue use only D1/R2/Queue; no active DO binding/class/RPC
references in application config or tests except immutable migration history.
Reviewed migration plan, explicit deletion/reset approvals and staging reset/smoke
receipts are separate from local typecheck/suite/build/dry-runs. Confirm auth,
private photos, shared stock and delivery recovery after approved staging reset.
Legacy Fly/Supabase stays live; no legacy teardown is bundled with DO retirement.
This draft prepares code/config/migrations but runs no remote Cloudflare command,
class deletion or reset. Remote inventory/backup/smoke receipts and per-environment
owner approval remain outstanding. D1 table drops precede Worker deployment in
the pipeline: old registry Cron can briefly report failure, although its
independent outbox/cleanup work still runs. Code requiring the dropped tables is
not a compatible rollback; fix forward rather than assuming data is restored.

## Production readiness build order

The [approved readiness additions](plan.md#production-readiness-additions--approved-scope)
are tracked individually above. Readiness 1–2 now ship together for existing
endpoints; readiness 3 adds profile photos. Remaining feature rows are not
implemented. Build each later feature with its
backend guards, UI slice and tests together. Rows 1–5 are core work; 6–9 are last among features
and remain **needs owner setup** until the owner supplies the required external
configuration/approvals. Terminal gates 10 → 11 → 12 cover the final intended
production revision. If an owner-setup feature is deferred past release, rerun
these gates when it later ships. No setup row authorizes provisioning, a secret
change, a plan assignment, draft #37's destructive merge or a staging reset.

### Readiness 1 — Plans foundation

Add app user/cache `plan` columns with free defaults and one `plan_limits` table
keyed by `free` / internal placeholder `plus`. Keep one source for user and cache limits;
plan choice is not membership, item ownership or an auth-core display name.
No plan UI, upgrade/billing flow, prices or third tier. Use the
[manual assignment runbook](deploy.md#manual-plan-assignment-owner-run)
only for exact owner-approved targets until the protected admin page exists.
Free owned_caches is 1; plus owned_caches is 3 and cache_members is 100.
Other plus seeds equal free pending owner decisions,
not guessed values copied from older paid-tier notes.

**Traps:** do not accept plan from signup/cache-create bodies, auto-assign it from
email/admin status, select it once before a later unguarded write or reset data on
a downgrade. Preserve reviewed Better Auth migrations and D1 FK/quantity/status
checks. One table serves both plan dimensions; do not add divergent per-route
limit maps or implicit unlimited fallbacks for a missing plan row.

**Proving checks:** real-D1 empty/populated upgrade defaults everyone to free;
constraints reject unknown keys; no-forged-plan tests on public writes; approved
manual assignment/read-back/reversal documented without auth email disclosure.
Plan/table changes racing a consuming write must use the plan observed inside
that same guarded statement/batch. `tests/plan-limits.test.ts` provides the real-D1
upgrade, boundary, activation, race and HTTP proofs; web limits tests cover copy.

### Readiness 2 — Free quotas and limit-reached states

Enforce free caps for every account: **1 owned cache (plus: 3); 2 new caches/day; 20 cache
active memberships; 30 members/cache (plus: 100); 100 owned library items; 20 pending
outgoing requests; 1 current item photo at the existing 5 MB cap; 1 profile photo**.
User plan controls account caps; cache plan controls its member cap. One item
shared in two caches counts once; photo replacement/cleanup keys are not extra
current slots. Read limits from `plan_limits` within the authorized write or
fresh-token batch; retain stock, membership, state+outbox atomicity and abuse
budgets. Return structured limit-reached errors and clear accessible UX, not a
billing upsell or silent partial success.

**Traps:** cover open join, gated activation and `left` rejoin; an owner counts as
an active member and owned caches count toward the account membership limit.
`removed` stays valid-secret 403, not a fresh join. Rolling 24h counts owned cache
created_at strictly newer than now-24h; pending joins reserve no active seat and
approval rechecks both caps. Rejection and idempotent replays remain possible at
the cap. No cache-local item count, UI-only quota or auth exemption. A cap failure must not manufacture membership,
attachments, requests, outbox or cleanup effects. Do not introduce a loan lifecycle
to count pending requests, or delete existing data when a plan lowers a limit.

**Proving checks:** real-D1 parallel last-slot cache/item/request creation and
open/gated joins/approvals; quota/plan-change races; failed primary → zero dependent
effects; rollback on injected failure. Test below/at/over caps, new-day behavior,
replay/idempotent joins, pending → decided slot release, cross-cache one-item
counting and no wrong-account limit usage. UI shows specific limit-reached copy,
loading/error/retry and no upgrade controls.

### Readiness 3 — Private profile photo

Account can upload, replace or remove one private photo at
`users/{userId}/{uploadUUID}` with initials fallback. Reuse item-photo cap/sniffing,
immutable upload and guarded post-I/O finalization. A single D1 read authorizes
self or at least one cache where **both users are active**, before private/no-store
R2 streaming. Commit pointer changes and cleanup intents together; add an explicit
profile cleanup scope rather than passing user keys through item validators.

**Traps:** public avatar URLs, cached membership grants, requester history as a
photo grant, pending/left/removed memberships and cross-user mutation IDs. Losing
one shared cache must not deny another valid shared cache; losing the last denies
the next read. Cleanup must preserve the current key across replacement/removal/
uncertain finalization and must never cross item/user prefix boundaries.

**Proving checks:** `tests/profile-photos.test.ts` covers the real-D1 self/shared/
pending/removed/left matrix, last shared cache, metadata/history privacy, post-R2
user/plan rechecks, concurrent replace/remove, pointer/cleanup rollback, R2 retry,
strict scope and caps/Origin. UI units cover Account controls, all avatar locations,
initials, self-upload/limit errors and a real PNG input through the shared resize
function (native decoder/canvas mocked in Node). The browser displayed the sheet,
read-error state and Escape dismissal; a valid host PNG failed identically in the
existing item uploader, so successful browser upload/replace/remove remains
blocked/unverified pending the transport fix. Preserve the unknown-orphan gap.

### Readiness 4 — Contact reveal and optional approval message

Account stores at most one optional contact: sms, whatsapp, signal, messenger,
instagram or chosen email. Server validates by kind and constructs only the
[approved destinations](plan.md#contact-after-approval-not-chat-or-email-relay).
Owners get a test preview; after approval show a platform icon and **Message X on
<platform>** button, with a nudge when contact is missing. Contact reveal checks
approved request + caller party + both parties active in **that request cache** in
one SQL statement. No chat, relay, auth-email fallback or public contact directory.
An optional plain-text approval message is separate from rejection reason and
starts empty; the implemented bound is 500 Unicode code points (trimmed, empty stored as NULL), separate from rejection reason.

**Traps:** another member/admin, a different shared cache, pending/rejected request
or retained party history is not contact permission. Do not copy contact into
outbox/push/admin payloads or select Better Auth email for contact enrichment.
Never accept arbitrary URLs or schemes, malformed phone/usernames, CRLF/mailto
parameter injection or unescaped labels/messages. Do not prefill the message with
sample text or a contact value. Keep approval + message + durable effects atomic.

**Proving checks:** real-D1 party/status/cache/membership matrix and approved-read
races with leave/removal/contact replacement; no auth email selected/returned for
the other party; private-message party checks. Exact server-built link tests for
all six kinds, malicious values/schemes and Unicode/length bounds; missing-contact
and owner preview flows; UI consent/empty message, accessible icons/buttons and
phone deep-link behavior without initiating real messages or relay email.

Implemented API: GET/PUT/DELETE `/api/me/contact`, POST `/api/me/contact/preview`
(validates/builds without storing) and GET `/api/me/requests/{requestId}/contact`.
Eligible missing contacts return `{contact:null}`; denied reads return 404 with no
value/link. Lists and Better Auth output never include contact. Messages remain in
party-scoped request history even after membership loss, but contact does not.
Phone input accepts 7–15 ASCII digits with optional leading +, normalized to +digits;
Messenger accepts 5–50 letters/digits/dots and Instagram 1–30 letters/digits/dots/
underscores (neither permits leading/trailing/consecutive dots). Chosen email uses
a simple ASCII address check, max 254 characters / 64 local-part characters, with
no URI/header parameters. Plus in an email local part is encoded as `%2B`.
`tests/contacts.test.ts` proves local D1 guards, upgrade, races, rollback, validation
and HTTP/privacy; `web/src/lib/contacts.test.ts` covers presentation/deep-link
attributes. Simplified inline brand-colour glyphs must be replaced with official
brand assets before release; no external assets or messaging service is added.

### Readiness 5 — Cozy theme and app identity

Apply approved **cozy whiteboard round 6**: decorative pixel horizon with boxes on
Home, houses in a cache; sunny light/evening dark via `prefers-color-scheme`; open
box with cat replaces the black house Home mark. Ship SVG + 32px PNG favicon,
180px apple-touch-icon, 192/512 manifest maskable icons and safe-area artwork.
No plan-specific theme picker or functional screen redesign.

**Traps:** decorative content must be `aria-hidden`, not a second item list or
status announcement. Preserve accessible lists, single controls, breadcrumbs,
Home name, focus rings, error states and existing wide-layout conventions. Honor
`prefers-reduced-motion`; don't rely on animation or low-contrast pixel art to
convey meaning. Icons must be actual correct-size assets, not renamed files.

**Proving checks:** browser phone/wide light/dark and reduced-motion screenshots
against round 6; keyboard/screen-reader structure and contrast; full user flows
with decoration off. Inspect icon dimensions, favicon/manifest references,
maskable cropping and installed-PWA appearance; automated layout/asset checks do
not replace actual rendered/device evidence.

Implementation: `web/src/index.css` defines both palettes and maps the existing
Tailwind utility names to shared tokens so sheets/error/status/wide layouts inherit
the same theme. `PixelArt.tsx` keeps the horizon aria-hidden; Home box shortcuts are
pointer-only (tabIndex=-1), while the existing labeled cache list remains the
keyboard/screen-reader path. Below 640px, the original 96px phone scene keeps 2px
sprite cells and horizontal overflow when decorations cannot fit. At 449–639px,
only the decorative bands extend to the viewport; content and foreground sprites
keep their old phone measures. Larger scenes
repeat native-size SVG terrain patterns across their available width; container
queries step sprite cells from 3px to 7px rather than stretching one small viewBox.
Home/cache header, sky and horizon backgrounds are full-bleed. Content uses a
shared clamp(16px,4vw,96px) gutter and 1920px cap, with intrinsic auto-fill card
grids; prose/forms stay within 72ch. Cache members stack until the content
container has 68rem for a sidebar. Item/Requests/Account retain their wide columns,
and sign-in keeps a bounded form beside a fluid art panel. Screenshot receipts
and proof limits are recorded in the feature PR body. The walking cat stops under
prefers-reduced-motion; information and controls never depend on it.

Cozy motion shares one `CacheLink` path for cards and horizon shortcuts: a 400ms
stepped lid/open-box/cat sequence precedes navigation. Modified/new-tab clicks keep
native behavior; a timer, not animationend, guarantees navigation. Reduced motion
or a hidden tab skips the delay, including preference/visibility changes mid-open.
A single visible walker per horizon uses integer-pixel transforms, two leg frames,
edge pauses and turns; RAF stops while hidden/reduced. Idle blink/ear/sky CSS and
sheet entrances run only for no-preference, with hidden-tab CSS pause. Route fades
only opacity for 140ms, and cancels on reduced motion. `motion.test.ts` proves
policy/navigation/timer cleanup, walker travel/pause/turn/resume and static fallback;
local pointer/horizon/Enter/reduced recordings are linked in the feature PR.

`node scripts/make-icons.mjs` regenerates the committed icons using only Node
built-ins and the app's shared OPEN_BOX sprite. Maskable artwork lies inside the
40%-radius safe circle; backgrounds remain opaque to the edges. Tests inspect
actual PNG dimensions, decode pixels, check safe-area containment/reproducibility,
and assert body/status/avatar contrast of at least 4.5:1 for both palettes.

Browser comparison fixtures: `/__fixture/compare?screen=home` (also cache, item,
requests, account, signin) renders sunny/evening phone viewports side by side;
`&layout=wide&theme=evening` exercises a real 1280px iframe viewport. A fixture-only
style forces tokens for screenshots because browser emulation is unavailable;
production has no override/picker and follows the system media query. Before/after
receipts cover all six screens; extra wide layouts and the rendered 512px icon
were inspected. These screenshots are mock-API presentation proof, not native
system-setting, installed-PWA or real-device proof.

### Readiness 6 — Turnstile (live validation pending)

Owner supplies approved site configuration/key/secret and intended hostname/action.
Protect magic-link/code sends/resends and cache creation with server-side
`siteverify`. Keep Origin/auth/profile, D1 rate limits and same-write quota guards.
Bot Fight Mode is an owner-approved zone setting, not an automatic code side effect.

**Traps:** widget-only checks, frontend token trust, direct-API/resend bypass,
missing-secret fail-open, foreign-host/action tokens or provider calls inside a
D1 batch. Siteverify success is not membership/plan authorization.

**Proving checks:** mock success/missing/invalid/expired/replayed/mismatched tokens,
provider errors/timeouts and direct API paths with no unsafe state/mail send.
After setup approval, record live valid/invalid-token browser/provider receipts
and verify existing sign-in fallback/rate limits. No zone toggle/secret provision
or live assertion until the owner supplies and approves setup.

Implementation: `src/turnstile.ts` is the single siteverify function, called before
Better Auth email-send handlers and the guarded cache-create write. It sends a
form-encoded secret/response/CF-Connecting-IP request with a 10s abort deadline and
requires boolean success, exact `signin` / `create_cache` action and configured
hostname. Missing token/config, provider failures and replay all return generic
403 `turnstile_failed`; Origin, auth/profile, rate limits and D1 quotas stay intact.
Continue, OTP verification, session reads and sign-out are not gated. Better Auth
1.7.7's captcha plugin supports action/host checks but uses JSON/truthy success and
different provider-failure behavior; this stricter shared guard leaves it unused.

The owner replaced the original widgets with shared public sitekey
`0x4AAAAAAFX8jA_m3iHxQbuL`. Production accepts only communalcache.com; staging only
communalcache-staging.ryanyz10-be6.workers.dev. Local `.dev.vars` uses that real
widget/owner-provided secret and localhost; the example contains no secret value.
Official dummy test keys return example.com without an action, so they cannot
bypass these checks. Automated tests mock siteverify with exact claims. The owner
reports staging-secret provisioning separately; live valid/invalid-token staging
proof is still pending after this revision deploys. This PR provisions no secret.

The client loads one explicit async script, chooses the rendered cozy light/dark
palette, mounts cache widgets only while the sheet is open, clears expired/error
callbacks, and resets after each protected attempt. `GET /api/config` exposes only
the public sitekey. No existing CSP was found. The UI fixture uses a clearly
labeled mock widget and never contacts Cloudflare; it is not live-token evidence.

### Readiness 7 — Google (needs owner setup)

Owner supplies Google OAuth client credentials and approved redirect origins.
Use Better Auth social sign-in and link by verified email to the same app user;
retain magic-link/code fallback. Apple remains deferred for its paid developer
account requirement. This does not introduce phone/SMS authentication.

**Traps:** unverified-email linking, duplicate app identities, arbitrary callback
origins, trusting browser provider claims, bypassing display-name onboarding or
retaining another account's private query/push state. Add only reviewed auth
provider paths to the allowlist; secrets never reach frontend config/logs.

**Proving checks:** mocked provider verified/unverified/existing/new/collision
flows, state/callback/CSRF/replay failures, session revocation/profile gates and
account switching. After owner setup, approved live Google callback/linking and
fallback receipts; no real provider setup inferred from local test success.

### Readiness 8 — Owner admin (needs owner setup)

Owner supplies Cloudflare Access policy/JWT settings and exact allowlisted app
user IDs. Guard `/admin` and **every backing API** with Access plus Worker JWT
verification and current allowlisted app identity. Show names/IDs, plan/usage and
failed-outbox metadata only; allow guarded plan assignment and suspension. Define
suspension's enforced effects before exposing the action. Never show auth/contact
emails, raw outbox/contact payloads or an impersonation/privacy bypass.

**Traps:** protecting only the SPA/edge, workers.dev bypass, forged identity
headers, JWT-derived fetch origins, wrong issuer/audience, expired tokens, an
allowlisted Access token without the required app ID, or frontend-only suspension.
Do not accept arbitrary SQL/plan keys from an admin form. Operational access is
not permission to expose item-owner library or request-party contact data.

**Proving checks:** invalid signature/issuer/audience/time/config and missing app
session/ID tests, direct alternate-origin API attempts, CSRF and exact-target plan
writes; denied access has zero effects. Names/IDs-only query/response snapshots,
suspension enforcement and operational-data redaction tests. Live Access policy
and direct-API deny receipts need separately approved owner setup.

### Readiness 9 — Supporter tips (implemented)

The owner-approved hosted link is https://buymeacoffee.com/ryanyz10, held in one
`web/src/lib/support.ts` constant. Account has a small cozy card; signed-in pages
and the landing page have quiet footer links. Anchors open a new tab with
`rel="noopener noreferrer"`; no provider script/widget/iframe or tracking params.
**Support Communal Cache** stays hidden if unconfigured. No webhooks, app supporter
or payment records, plan changes, unlocks or billing/upgrade UI. Copy uses the
existing copy module; tests check exact destination, safe attributes, visibility
and no provider loading. Native Account phone/wide palette receipts stay in the PR.

**Traps:** donor/entitlement state, analytics carrying app identity/contact data,
auth tokens in URLs, fake checkout controls or showing an unconfigured link.
External payment provider storage is not an app payment ledger.

**Proving checks:** hidden/configured states, approved HTTPS destination and no
app identity/query leakage; clicking cannot mutate D1 or entitlement state.
After owner setup, manually verify the configured destination without making an
unapproved payment. Do not provision payment products or providers automatically.

### Signed-out landing page

Public `/` introduces Communal Cache using `cozy-landing.tsx`: box mark/header,
hero and sign-in/invite CTAs, decorative horizon, three how-it-works cards, four
community promises and footer CTA. It reuses cozy system palettes, shared PixelArt
and reduced-motion behavior; cards become three columns at 1024px. New copy and
root title/description live in `web/src/lib/landingCopy.ts` for later review.

Wait for the existing session gate before showing landing or Home. `/login`
remains sign-in, and the invite CTA adds only an explanation on `/login?invite=1`;
real `/join/:token` and `/auth/link` flows remain unchanged. The page has no public
cache/item data, remote assets or new authentication mechanism. Routing/copy tests
use the real route table and cover pending/error, signed-out/in, onboarding,
invite and explicit magic-link Continue states. Fixture screenshots cover phone
and wide layouts in both palettes; they remain mock-API presentation proof.

### Invite continuity and paste-to-join fix

The old session-only intent was lost when an email app opened the magic link in a
new tab. Sends now pass a strict relative `/join/<valid-token>` callback through
Better Auth; the email keeps it in the fragment-only Continue link. Shared token
validation rejects malformed/non-relative invite callbacks before send/consume,
without narrowing the existing non-invite same-origin callback contract.

One-hour session/localStorage records provide current-tab/shared-tab fallback;
explicit callbacks take priority, and join/cancel/sign-out/expiry clears intent.
Storage remains only an intent hint, never cached membership. Home has a native
paste sheet near New cache and in its empty state; HTTP(S) URL origins are
ignored, and only a validated local join path is navigated. One explicit Join tap
remains (no new non-member cache-name lookup); approval-required joins stay pending.
`pendingJoin.test.ts` and real Worker magic-link tests cover parsing, handoff,
expiry, clearing, callback safety and active/pending outcomes. Live email-app
handoff is still separate from the local fixture/real-D1 proof.

### Gate 10 — Full user-flow parity checklist and cleanup refactor

Freeze the intended release scope and inventory every flow: magic link/scanner/
Continue and code fallback; invite/name/new account/account switching; cache
create/open/gated join/approval/rotation/leave/rejoin/removed denial; private library,
Existing/New create/attach, Shown in confirmation/retry, photos/profile photo;
all-cache stock, requests/decisions/Lent out/contact/empty approval message;
quota errors; notification/push/cleanup recovery; Account/preferences/logout;
owner-setup features only if included in this release. Compare phone/wide,
light/dark, reduced-motion, keyboard/focus, loading/empty/error/retry and privacy.

**Traps:** cosmetic cleanup that weakens SQL guards/token batches, drops durable
work or revives holder/return/projection models; calling skipped setup/device/
provider cases passed; checklist drift from the actual release revision.

**Proving checks:** attach requirement/revision/environment receipts per flow,
real-D1 races/rollback plus browser coverage, explicit blocked/deferred cases and
regression-backed removal of obsolete paths. Applicable whole suite/typechecks/
build/bundles stay green. Complete this gate before the independent review.

### Gate 11 — Independent security review

A reviewer other than the implementation author reviews the exact final release
revision and enabled features, including new quota, photo/contact, link, social,
Access/suspension and existing auth/CSRF/D1/stock/durable-effect boundaries.

**Traps:** self-review or green CI relabeled independent signoff, reviewing an old
revision, untracked findings, or relying only on UI hides/provider edge policy.

**Proving checks:** named reviewer, scope/revision, evidence-backed findings and
fix verification; owner explicitly accepts any residual risk. Changes after the
review trigger appropriate parity/re-review before release. This docs PR is not
the review and makes no claim that new functionality is secure/implemented.

### Gate 12 — Explicit release approval

Owner approves the exact revision, environment and enabled/deferred features only
after parity and independent security review. Include external setup readiness,
provider/device smoke where applicable, migration/backup/fix-forward evidence and
approved monitoring/recovery. DO deletion, staging reset and legacy cutover still
require their separate explicit approvals.

**Traps:** treating a normal docs PR, feature merge, draft status change, CI success
or plan assignment as release permission; silently adding a deferred setup feature
after review; assuming code rollback restores deleted data.

**Proving checks:** durable owner approval with revision/environment/scope and
links to parity/security/operational receipts. No deploy/promotion/reset without
that approval. If a deferred owner-setup feature later ships, rerun gates 10–12.

## Retained regression requirements

- Auth: Better Auth 1.7.7/native D1/nodejs_compat; nullable display_name and profile
  exemptions; own email only; exact Origin/trustedOrigins; cookie revocation checks
  D1. No password/admin/public lookup. Retain pinned schema compiler reference and
  0003 OTP uniqueness/late-restore workaround until reviewed upstream fix proof.
- OTP: six digits/300s/three attempts/hashed/rotate; D1 limits across instances;
  request-awaited Resend failure/timeout visible independently of notification Queue.
- Magic link: link-only mail, explicit code fallback; hashed 300s first-use tokens,
  fragment landing/no-referrer/no-store, scanner GET consumes nothing; Continue
  POST adapts internal GET handler preserving D1 5/60s limits. No auth.api bypass;
  exact-origin callbacks, independent resends, strict invite callback plus expiring
  cross-tab intent and paste-to-join semantics. Live mobile/mail remains UNVERIFIED until approved smoke.
- Push: @block65/webcrypto-web-push@2.0.0 local RFC 8291/VAPID proof retained;
  strict endpoint allowlist/manual redirect/deadlines; account reassign/logout and
  stale 410 cleanup; no subscriptions/all expired → same-pass email, transient
  failure remains push. Three browsers/account, three sequential Queue rows.
  Gesture/installed-iOS behavior and production private-IP/CPU guarantees stay
  UNVERIFIED; no service-worker fetch cache bypasses authorization.
- Input/photo: actual JSON 16 KB/photo 5 MB caps, Unicode text limits, image sniff,
  JPEG/PNG/WebP not SVG, canvas failure/retry and owner recheck after R2 I/O.
- Polish: current fixed-minute per-user D1 abuse budgets remain, not notification
  throttling or membership grants. Preserve JSON errors, mixed-case UUID
  canonicalization (never secrets), a11y/focus/forced-colors, empty/error states,
  secret-free logs, oldest outbox/cleanup age and query/row/CPU monitoring.

## Risks, approvals and release proof

VERIFIED D1 Free ceilings: 100k rows written/day, 5M read/day, 500 MB/database,
50 queries/Worker invocation. One primary round trip for distant users; queries
serialize, so query duration bounds throughput. No workload-specific throughput
number is verified. Index/paginate and measure auth/counters/outbox/cleanup too.
Read replication/Sessions API is UNVERIFIED for our access/read-after-write needs;
regional sharding needs a new data/stock boundary, and optional future per-cache
DO WebSocket fan-out is not a return to DO authority.

After separate explicit approval, smoke real Resend link/code, scanner-safe
Continue/mobile handoff, Queue email, private photos, installed iOS push, Cron
rescue/cleanup and migration-compatible Worker update/fix-forward drill. Record
environment, revision and receipts; local green checks are not remote proof.
No provisioning, remote migration, reset, secret changes or decommissioning is
performed by the retirement draft. Legacy verified-email mapping now imports app rows **straight into
D1**; reconcile item identity/stock/photos/outbox and keep old sessions invalid.
See [deploy.md](deploy.md) for approval boundaries and release sequence.
