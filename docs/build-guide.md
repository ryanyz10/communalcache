# Build guide

Build one feature per PR, including Worker/D1 logic, its UI slice and real local
storage tests. [plan.md](plan.md) is the settled target; [database.md](database.md)
gives the guarded SQL/batch protocols. Every intermediate release must be safe and
deployable, even when a new route is gated until its full cascade is proved.

**Single D1 replaces PR #29's Owner DO model.** Keep its product decisions (shared
items/stock, manual Lent out, owner-scoped private photos), not its object split,
projections, target registration or eventual revocation. Current Cache DO code is
implementation history to port. Existing tests do not prove the new D1 protocol.
No code/config/package/migration/resource changes or Cloudflare commands in this
spec PR. Keep legacy Fly/Supabase live until separately approved cutover.

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
  routes must not operate against partially ported data. New destructive/shared
  paths remain gated until PR 5's race/cascade proof. Leave inactive DO deployment
  configuration until separately approved retirement; do not add Owner DOs.

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
checks. Target tests need no DO schema/alarm helpers; current cache-local tests keep
them until retirement. Smoke local health/config, SPA deep links and JSON API 404s
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
Old cache-local features are regression references, not target D1 completion.
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
| D1 2 | Caches / membership / joining | Implemented; in review: canonical D1 config/membership/join outbox, additive 0007 migration, no DO bridge. Legacy item/photo/request/removal APIs gated temporarily; PRs 2–4 intended to merge together (staging test data only). |
| D1 3 | Shared items / attachments / photos | Planned; direct own library, one item across caches, private R2 and cleanup |
| D1 4 | Requests / shared stock / Lent out / notifications | Planned; guarded INSERT and token-gated decision batches, direct Requests queries |
| D1 5 | Removal / detach / deletion / races | Planned; atomic cascades/snapshots and immediate membership enforcement |
| D1 6 | Library / add sheet / checkboxes / items board | Planned; items board 1a–1d and user flows, supersedes #28 |
| D1 7 | Retire Durable Objects / staging reset | Planned; destructive deleted_classes migration and reset each need explicit approval |

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
Cron fair pagination and Queue duplicates. Keep shared routes staged/gated until
PR 5 demonstrates destructive races, not just happy-path stock tests.

### PR 5 — Removal, detach, deletion and race tests

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
Completed approvals and previously authorized streams are not recalled. No new
self-leave endpoint; a future approved leave must share the same batch protocol.

**Proof:** real concurrent request/removal, attach/removal, decision/removal,
request/detach and request/delete in both orders; no affected pending survivor;
no duplicate deductions/notifications; failed primary → zero cleanup/outbox;
constraint failure anywhere → complete rollback; owner cannot leave/be removed;
wrong member/cache/owner 404; delete snapshots every pending recipient before FK
cascade; library/other attachments/photos survive cache loss. Bound statement/
row work within measured platform limits; fail safely rather than splitting the
atomic invariant. Only now enable destructive/shared paths; close old aliases too.

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

### PR 7 — Retire Durable Objects and reset staging test data

Remove Cache class/RPC/binding use, pending_sync/alarm/registry sweeps, obsolete D1
my_caches/cache_sync_cursor and old test helpers once no route uses them. No Owner
class is introduced. Keep outbox Queue/Cron and R2 cleanup Cron. Append Wrangler
class history with **deleted_classes**; deleting a class destroys its DO data.
**Explicit human approval is required before the destructive migration/deploy**,
not implied by approving the single-D1 product decision.

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
No Cloudflare command, migration/config edit or reset runs in this spec PR.

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
  exact-origin callbacks, independent resends, invite tab persistence/fresh-browser
  semantics. Live mobile/mail remains UNVERIFIED until approved smoke.
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
No provisioning, external migration, reset, secret changes or decommissioning in
this spec PR. Legacy verified-email mapping now imports app rows **straight into
D1**; reconcile item identity/stock/photos/outbox and keep old sessions invalid.
See [deploy.md](deploy.md) for approval boundaries and release sequence.
