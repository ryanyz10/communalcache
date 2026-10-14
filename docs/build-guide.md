# Build guide

Build Communal Cache feature by feature, one PR each, in this order. Each feature
includes Worker/DO logic, its UI slice and tests. [plan.md](plan.md) is the settled
spec; this guide names the scope, traps and check that proves the implementation.

Every feature ends deployable. Destructive endpoints come late because removal
without cleanup and notifications is worse than not exposing removal yet.

The Go foundation and Caches/Joining PRs are references, not completed Cloudflare
features. Port them before adding later features; retain their product behaviors
and authorization tests, not their Postgres/Fly mechanisms.

## Before you start

- **Worker bindings**: D1 is global; a cache DO's local SQLite owns authorization
  and all cache data. R2/Queue/D1 calls are external I/O, not local transactions.
- **`transactionSync`**: read, decide in JS, write and record intent synchronously;
  throw rolls back. No await, async callback or cursor crossing an await.
- **DO scheduling**: single-threaded does not mean one entire async handler at a
  time. External awaits can interleave. Alarms retry automatically only six times;
  pending work needs explicit re-arming and a recovery backstop.
- **Discovery vs permission**: `my_caches` discovers the caller's home list and
  requests fan-out; each DO still authorizes. Registry is for discovery/sweeps,
  never an ownership or membership source.
- **Cloudflare Vitest plugin**: real local Worker/D1/DO storage tests. Mock provider
  HTTP, not SQL. `vitest-pool-workers` is deprecated; use `vitest-plugin`.

### Completion gates

Foundation supplies the root Worker package/tooling and Wrangler configuration.
These commands validate local bindings and bundle only, never production:

```bash
npx --no-install tsc --noEmit
npx --no-install vitest run
(cd web && npx --no-install tsc --noEmit && npm run build)
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run
```

Also test empty D1 migrations and old→new DO schema versions in the suite; smoke
local `/api/healthz`, `/api/config`, SPA deep links and API 404s under
`wrangler dev`. It defaults to local storage; no `--remote` or production test
bindings. See [README.md](../README.md) for local `.dev.vars`, Vite origins and the
provider-free UI fixture; legacy `.env` must not feed Worker bindings.

The separate deploy-pipeline PR adds secret-free CI on every PR base plus
master/production pushes and dry-runs for both named Wrangler environments.
After the one-time setup in [deploy.md](deploy.md#pipeline), successful master push
CI releases staging; `git push origin master:production` runs production CI before
release. No real deployment or GitHub Environment/secret setup is performed by
that PR. Future features must keep all three bundle checks green.

For legacy Go-only reference validation, existing `make test`, `make vet`, gofmt
and frontend commands still apply to that code. Do not mistake them for Worker/DO
validation. Do not run legacy database tests against hosted Postgres.

## Status

Update a feature's row in its own PR. Implementation and review status are separate.

| # | Feature | Cloudflare status | Reference PR |
| --- | --- | --- | --- |
| — | Foundation port | Implemented; in review (local gates, no deployment) | — |
| — | Deploy pipeline | Implemented; in review (CI → staging, fast-forward production; setup pending) | — |
| 1 | Caches | Implemented; in review (Cloudflare port, no deployment) | [#2](https://github.com/ryanyz10/communalcache/pull/2) (closed Go reference) |
| 2 | Joining | Implemented; in review (Cloudflare port, no deployment) | [#3](https://github.com/ryanyz10/communalcache/pull/3) (closed Go reference) |
| 3 | Items (no photos) | Implemented; in review (Cloudflare, pending-reservation stock floor; no deployment) | — |
| 4 | Photos | Implemented; in review (private local R2, cleanup recovery; remote buckets pending) | — |
| 5 | Requests | Not started | — |
| 6 | Notifications + email | Not started | — |
| 7 | Web push + PWA | Not started | — |
| 8 | Member removal and item deletion | Not started | — |
| 9 | Polish | Not started | — |

---

## Foundation port

**Goal:** deployable Worker/SPA foundation with real local storage tests and no
change to existing production services without explicit approval.

### Scope

- TypeScript module Worker, plain dispatch, health/config, JSON/error/body helpers.
- React build served by Workers static assets; `/api/*` runs Worker logic before
  SPA fallback. Vite proxies API to local Wrangler development.
- Better Auth 1.7.7 in the Worker under `/api/auth/*`, native D1 adapter and
  nodejs_compat; six-digit email codes sent synchronously through Resend fetch.
  D1 cookie sessions, persistent auth rate limits, `GET/PATCH /api/me`, nullable
  app display-name onboarding and profile exemptions (including auth routes).
- Reviewed hand-written auth SQL derived from pinned schema generation: user,
  session, account, verification, rateLimit and additional display_name field.
  Cookies HttpOnly/Secure/SameSite=Lax; exact trustedOrigins plus app-mutation
  Origin checks. No passwords/admin/list-users or unused auth paths.
- D1 global schema/migrations including outbox from the beginning. Local cache DO
  schema includes config/members/items/requests/pending_sync, with versioned
  constructor migration under `blockConcurrencyWhile`.
- Vitest + `@cloudflare/vitest-plugin` harness; D1 migration setup, DO transaction,
  schema/rollback and alarm helpers. No Postgres roles/RLS/lock harness in the port.
- Document configuration, local `.dev.vars`, dry-run bundle and migration checks.

### Traps

- **No Data API/pooling invariants in the new store.** D1/DO bindings are not public
  browser database credentials. Leave legacy Postgres protections intact until
  approved retirement; this is not permission to change the old service.
- **No await in local check-then-write.** Prove rollback on a thrown error now;
  external D1/fetch calls can interleave other requests despite single-threaded JS.
- **Schema migration runs before requests**, under constructor
  `blockConcurrencyWhile`, with a version number; failed migration must not stamp
  the new version. D1 migrations run through Wrangler, not on HTTP startup.
- **Profile/auth exemptions and no email-derived names.** `PATCH /api/me`, push
  and `/api/auth/*` are not gated; auth core name cannot bypass display-name setup.
  App/auth responses expose only the caller's own email/session/user.
- **Cookies need CSRF beyond the auth handler.** Exact production trustedOrigins;
  reject missing/null/foreign Origin on app mutations. Cookie cache stays off;
  logout/revocation uses D1. Development origins never become production wildcards.
- **Hash OTPs and rotate resends.** Six digits/300 seconds/three attempts; hashed
  storage cannot reuse the old code. Foundation adds exact-prefix OTP uniqueness
  in D1 so resend replaces old rows even with equal timestamps and late wrong-code
  restoration cannot revive a superseded code. Only that sign-in unique conflict
  maps to 400 INVALID_OTP; other database failures stay visible. Tell users to use
  the code from the newest request; concurrent mail delivery can finish out of order.
- **D1 rate-limit storage, not isolate memory.** Explicitly enabled in tests; prove
  concurrent redemption/attempt limits and counters across Worker instances. Native
  adapter support is not proof of every concurrency property.
- **Only one signup flow.** Allow verified email-OTP signup, disable password,
  reset/change-email and other unused paths/plugins. No admin/list-users.
- **Invite stays on the page.** Stash cacheId/secret before requesting a code;
  verify code, set display name and resume the join page. Feature 2 adds the join
  POST body. Keep no-referrer; no callback URL or auth-email copy of the join secret.
- **Auth delivery is synchronous.** Await bounded Resend fetch from the auth
  request, not Queue/waitUntil. communalcache.com sending-domain setup needs
  approval; an auth-mail send failure must surface without losing the invite.
- **API errors are not the SPA.** Test invalid API paths/auth failures as JSON;
  use a compatibility date supporting RPC and the selected error serialization.
- **The pending_sync/outbox tables exist before events.** Later delivery cannot
  recover events that were never recorded.

### Proof

Local empty D1/DO creation/version upgrades including auth schema; atomic rollback;
OTP correctness/expiry/replay/three attempts/resend invalidation/hashed storage;
concurrent auth-limit tests; tampered/expired/revoked cookies and flags; app/auth
CSRF, disabled endpoints, profile exemptions and caller-only email. Resend failure/
timeout is visible and independent of Queue. Health/config/deep links; logged-out
invite → code on the same page → name → original join page, with sessionStorage
retention and explicit cancellation. The actual join POST (secret in body) is
proved in Feature 2, not Foundation. Domain/delivery smoke waits for approval;
target URL is https://communalcache.com.

Foundation uses compatibility date `2026-09-30` (RPC and default error serialization)
and an empty-D1 pinned schema compiler reference in `scripts/auth-schema.mjs`.
Better Auth 1.7.7 awaits but catches delivery callback errors; per-request closure
state maps HTTP failure/timeout to generic JSON 502 without changing a rate-limited
response. Tests prove concurrent send results cannot leak between requests.

**Planned auth follow-up:** magic-link plugin with hashed 300s tokens, exact-origin
callbacks and a scanner-safe SPA Continue button; no verification on page load.
One email containing link + code is the goal, but combined challenge coordination
is UNVERIFIED and needs its own tests. SMS/phone plugin is deferred, not Foundation
or Features 1–9; it needs an SMS provider, registration/compliance and pumping controls.

---

## Feature 1 — Caches

**Goal:** create a cache, open it immediately and share its invite link.

### Scope

- `POST /api/caches`: Worker creates UUID, calls DO `create(owner, name)`; one
  transaction inserts config, active owner and registry/reverse-index intents.
- `GET /api/caches`: caller's D1 discovery projection, not authorization.
- `GET/PATCH /api/caches/{cacheId}`: authoritative DO detail/members/settings;
  PATCH is owner-only. Include shareable `cacheId.secret` link for active members.
- `POST /api/caches/{cacheId}/invite/rotate`: owner-only, 32 random bytes/base64url.
- Ordered idempotent sync, re-arming alarm and registry Cron backstop. Notification
  Queue delivery arrives later; durable intents must already survive.

UI: dashboard/create; navigate straight to cache page on creation; cache shell,
copy invite, member sheet and owner settings. No join/removal yet.

### Traps

- **Creator membership and intents are atomic.** A partially created cache must
  not strand its owner. Missing `my_caches` immediately afterward is expected.
- **D1 never authorizes**; fetch/authorize inside the DO, non-member 404.
- **No member email payloads.** Enrich names from D1 by IDs after DO authorization.
- **Stable IDs and ordered replay.** Upsert registry before reverse-index insert;
  delete pending work only after external effects succeed. Concurrent alarm and
  `flushSync` drains cannot apply stale projection changes after newer ones.
- **Alarm retry limit is not recovery.** Catch/reschedule failures; every entry
  point re-arms pending work. Test the creation commit/alarm scheduling gap before
  declaring sync reliable; a pre-registry cache cannot be found by registry Cron.

### Proof

Auth matrix: non-member/pending/removed/active/owner; settings and rotate owner-only.
Creation returns an immediately readable cache while home discovery lags. Inject
sync crashes at each boundary, replay twice, and fail beyond six alarm retries;
show unique stable intent IDs, no duplicate registry/my_caches rows or reordered
projection, entry-point re-arm and cursor-bounded Cron flush. Open/create/copy/rotate
through the UI. Duplicate-outbox-ID proof belongs to Feature 2, the first actual
notification producer; Caches has no notification recipient/event to materialize.

The port drains at most 25 D1 effects per DO flush and sweeps at most 25 known
caches per Cron tick, with a D1 cursor. A failed first alarm schedule preserves
committed state/intents and still returns the cache ID; a later entry point
re-arms it. Registry Cron cannot discover a pre-registry object. A process crash
before the client receives that ID remains the documented creation-recovery window.

---

## Feature 2 — Joining

**Goal:** invite links join directly, optionally with owner approval.

### Scope

- `POST /api/caches/{cacheId}/join` with body `{secret}` routes directly to the
  cache DO; compare the fixed-length decoded secret in constant time, 404 on
  missing cache/mismatch. Secret in the body, never the API path (request logs);
  the `/join/...` SPA page sends `Referrer-Policy: no-referrer`.
- Insert active or pending membership in `transactionSync`.
- Owner `GET /api/caches/{cacheId}/join-requests` and
  `POST .../join-requests/{userId}/approve|reject`.
- Atomic membership plus pending_sync discovery updates/notification intents.

UI: `/join/:token` through login/name onboarding, active/pending result, owner queue.

### Traps

- **Removed member cannot rejoin.** Valid invite + removed row returns 403 without
  changing it; ordinary cache-data access still returns 404.
- **Reject deletes pending membership**, not marks removed, so retry is possible.
- **Invite secret never lives in D1.** Cache ID selects the DO; compare/rotate there.
- **Record recipients before deleting a row.** Sync must not reconstruct rejected
  join recipients from a membership row that no longer exists.
- **Durable notification intents arrive now**, not when the consumer ships.

### Proof

Open/gated joins, idempotent join replay, removed denial, secret rotation/mismatch,
owner-only decisions and cross-cache 404s. Rejection then rejoin works; thrown
transaction creates neither state nor intent. Assert recipient IDs and prove stable
notification intent/outbox IDs cannot duplicate on replay (the first notification
producer, moved from Feature 1). Logged-out invite → email code on the same page
→ name → join POST body resumes correctly.

---

## Feature 3 — Items (no photos)

**Goal:** members list things and owners edit them.

### Scope

- `GET/POST /api/caches/{cacheId}/items`,
  `GET/PATCH /api/caches/{cacheId}/items/{itemId}`.
- Owner from caller; type immutable; local DO authorization and bound SQL.
- UI item list/detail/add/edit. No upload yet; no deletion until Feature 8.

### Traps

- **Item stock is 0–9999 for consumables, NULL otherwise.** Zero is valid stock;
  positive-only applies to requests in Feature 5, not item creation.
- **`is_consumable` is immutable**; conversion strands reservations.
- **Never accept forged owner ID.** Non-owner writes/wrong-cache IDs return 404.
- **No D1 item locator.** Cache ID in the route selects the DO, item UUID stays plain.

### Proof

Authorization matrix, forged owner rejection, immutable type, zero-stock creation,
NULL rules and bounded integers. UI list/detail/create/edit. Keep request-type
checks for Feature 5, not a fictional ban on empty consumable stock.

---

## Feature 4 — Photos

**Goal:** owner uploads and member reads without exposing R2.

### Scope

- `POST/GET /api/caches/{cacheId}/items/{itemId}/photo`.
- Owner check via DO, capped/sniffed upload through Worker to R2 key
  `cacheId/itemId`, then DO attachment re-check after the external write.
- Read: DO `photoKey(user, item)` checks active membership/existence/photo; Worker
  streams `BUCKET.get(key)` with `Cache-Control: private`. No signed URLs.
- Canvas resize/re-encode JPEG, photo picker/errors and list/detail rendering.

R2 creation/settings/bindings need explicit approval, not this feature's existence.
The port uses approved immutable `cacheId/itemId/uploadUUID` keys rather than the
fixed key above, so racing replacement/orphan cleanup cannot erase another upload.

### Traps

- **Client resize is not validation.** Cap actual bytes at 5 MB, sniff content;
  JPEG/PNG/WebP only. An SVG with a script cannot pass.
- **Decode/toBlob can fail.** Show "couldn't read that image, try another".
- **R2 and DO do not commit together.** Re-check owner/member when attaching after
  upload; cleanup orphan writes if state changed. Do not retain an authorization
  decision across R2 I/O and assume it is still current.
- **Same-origin images use cookies.** Plain `<img src>` attaches the session
  cookie; every read still checks membership in the DO. No bearer/blob workaround.
- **No public bucket or shared authorized-response cache.** Removing membership
  blocks the next photo read; cached responses must not bypass that check.

### Proof

Oversize/chunked input, wrong type/SVG, owner-only upload, removal racing upload,
orphan cleanup, anonymous/non-member 404, active streaming and private headers.
Exercise canvas failures and authenticated image rendering from the UI.

The local R2 binding is `BUCKET`; remote `communalcache-photos` (default/production)
and `communalcache-photos-staging` still need approved private creation before deploy.
Replacement/rejected-upload cleanup is recorded transactionally and retried through
the ordered sync drain. A Worker crash after R2 put but before DO finalization can
leave an unreferenced object; a future orphan sweep/lifecycle policy is the recovery
upgrade, not a claimed DO/R2 atomic commit.

---

## Feature 5 — Requests

**Goal:** ask/approve/reject without over-booking.

### Scope

- `POST /api/caches/{cacheId}/items/{itemId}/requests`.
- Owner `POST /api/caches/{cacheId}/requests/{requestId}/approve|reject`.
- Item detail's public pending queue; decided rows only for requester/item owner.
- `GET /api/requests` discovers the caller's `my_caches`, then parallel bounded
  DO calls with live membership/party checks; no whole-registry fan-out.
- Quantity edit floor and atomic pending_sync notification intents.

UI: "Ask to use", incoming/outgoing lists, approval/rejection with required reason.

### Invariant and traps

`available = quantity - COALESCE(SUM(pending request quantities), 0)`.

- **One transactionSync for check/decision/state/intent.** No await inside; no
  SQL cursor crossing an await. A thrown 404/409 rolls back local effects.
- **Create**: active non-owner, quantity NULL for non-consumable or 1–9999 for
  consumable; insufficient available stock returns 409.
- **Approve**: pending-only guarded transition, zero changed rows 409, exactly one
  deduction in the same transaction. Reject requires reason/releases reservation.
- **Edit**: new stock cannot be below pending sum; upward restock within bounds.
- **Queue disclosure is deliberate**, names/quantity/time/IDs only, never email.
- **Discovery index is not permission.** Stale rows 404; missing rows can delay
  aggregate visibility. `ponytail:` cap requests aggregation at 50 caches per page,
  with continuation/bounded concurrency and budget for other binding calls;
  paginate further rather than granting access from the index. Failed RPCs need an
  unavailable state, not a misleading empty list.

### Proof

Concurrent DO RPC creates never overbook; concurrent approves deduct once;
approve-after-reject 409; restock/create race loses neither write; stock floor and
NULL/type quantity rules; rollback leaves no intent. Tamper cache IDs and discovery
rows; test cap/continuation/partial failures and party visibility. Two-account
ask/approve/reject UI walkthrough.

---

## Feature 6 — Notifications + email

**Goal:** deliver recorded events with Queue retries and Cron recovery.

### Scope

- Flush pending_sync outbox rows idempotently to D1 by stable DO ID, then Queue ID.
- Queue consumer guarded expiring claim/terminal states; Cron re-enqueues old
  nonterminal rows with expired claims and flushes cache sync via the registry.
- Resend `fetch`, no SDK; HTML escaping, 10s provider/30s row abort deadlines.
- Until push ships, every recipient uses email. Links point back to the app.

Configuring Queue/Cron/Resend/secrets requires approval. No new public UI screen.

### Recipients

| Event | Notifies |
| --- | --- |
| Request created | Item owner |
| Request approved/rejected | Requester |
| Item deleted | Pending requesters |
| Member removed | Requesters whose requests were rejected |
| Gated join requested | Cache owner |
| Join approved/rejected | Person who asked |

### Traps

- **Outbox is eventually filled, intent is atomic.** The mutation's local
  pending_sync row is the durable bridge; a thrown mutation records nothing.
- **Claim guard plus rows-changed count.** Terminal rows or unexpired claims are
  not acquired; `meta.changes === 0` means ack/skip. Lease initially 90s > row 30s.
- **Failed-at bounds eligibility, not attempts.** Claim increments attempts;
  crashing on the sixth claim must not permanently lose the notification. Only
  an observed failure at the budget writes failed_at. Attempts include crashes.
- **Both terminal writes guard sent/failed and current claim token.** A stale
  sender cannot stamp failed over sent or a newer claim.
- **Queues retries are finite too.** Explicit retry configuration; default three
  retries can end in deletion. Cron + durable outbox repair dropped Queue IDs.
- **Per-call deadlines alone do not bound the row.** Three subscriptions and an
  email can otherwise exceed a lease. Respect the six simultaneous connection
  limit and CPU/subrequest quotas with bounded processing.

### Proof

Crash after mutation, D1 insert, Queue send and final claim; replay is idempotent.
Competing claims send once while lease is valid; crash after sixth claim remains
recoverable; mixed crashes/observed failures pin the claim-budget meaning;
stale terminal update rejected; Cron revives expired/dropped Queue work. Check
recipients, HTML escaping, deadlines and permanently failed terminal state.

---

## Feature 7 — Web push + PWA

**Goal:** installed browsers get push; those without live subscriptions get email.

### Scope

- Caller-scoped `POST/DELETE /api/push/subscribe`, exempt from profile gate.
- WebCrypto RFC 8291/VAPID candidate `@block65/webcrypto-web-push` 2.x, only added
  after a Worker-runtime proof; application-controlled fetch policy/deadlines.
- 404/410 cleanup, structural channel choice, runtime VAPID public key; private
  VAPID key remains a secret. PWA/service worker and notification links.
- Explicit enable/disable action and iOS install/permission guidance.

### Traps

- **Structural email, no retry escalation.** No subscriptions, or all 404/410 this
  pass, means email now; transient push errors remain push retries.
- **Untrusted endpoint.** Strict origins, HTTPS/default port/no userinfo; check at
  subscribe and send, and force `redirect: 'manual'`. Reject redirects.
- **No assumed platform SSRF immunity.** Production private/loopback/link-local
  fetch/DNS guarantees are UNVERIFIED. `ponytail:` no fetch DNS/dial hook means the
  origin allowlist is the control; stronger IP-level enforcement needs vetted egress.
- **Endpoints belong to browsers.** UPSERT reassigns endpoint to the new account;
  ignoring UNIQUE conflict leaks previous-account notifications. Logout removes it.
- **iOS has no programmable install prompt.** Render instructions; ask permission
  only from a gesture, on iOS only in the installed PWA.
- **Do not equate README support with project proof.** Verify RFC vectors, VAPID,
  runtime CPU and actual target-provider behavior, particularly installed iOS push.

### Proof

Worker crypto tests, no subscriptions → email, 410 deletion → same-pass email,
transient push no escalation, malicious origin/HTTP/userinfo rejection, manual
302 refusal, two-account reassignment/logout, gesture permission and installed
iOS delivery. Local fetch tests cannot certify production private-IP restrictions.

---

## Feature 8 — Member removal and item deletion

**Goal:** destructive endpoints arrive with cleanup and durable notifications.

### Scope

- Owner `DELETE /api/caches/{cacheId}/members/{userId}`.
- Item owner `DELETE /api/caches/{cacheId}/items/{itemId}`.
- One transactionSync for membership/status/cascades and pending_sync snapshots,
  outbox intents, reverse-index removal and R2 cleanup intents.
- UI confirmations in owner members sheet and item detail.

### Traps

- **Snapshot before local cascade, in the same transaction.** Deleted item requests
  do not survive to carry a reason: notification snapshots include title/recipient.
- **Two different cascades.** Deleted items cascade requests; removed member's
  requests on surviving items are rejected with "left the cache", not erased.
- **No await or Postgres lock ceremony.** Atomic DO SQL replaces lock order and
  lock-before-snapshot; external cleanup is durable sync after commit.
- **The cache owner cannot be removed**, including self-removal.
- **No replay resurrection.** Old reverse-index/name/outbox/R2 effects cannot undo
  newer removal state; retain stable IDs and ordered drain behavior.

### Proof

Both request directions on removal, owner prohibition, repeat deletion, correct
recipients/R2 cleanup, failed mutation leaves neither partial state nor intents.
Create vs deletion/owner-removal yields 404, or success included in durable removal
notifications; never success silently erased without an intent. Stale D1 indexes
and photo links fail the next DO membership check.

---

## Feature 9 — Polish

**Goal:** everyday UX, resource budgets and approved release checks.

### Scope and traps

- Write rate limits on joins/requests, keyed by verified user + route. Prefer the
  Workers Rate Limiting binding when its account-plan availability is confirmed;
  per-location/eventually consistent, not a global exact quota. Free availability
  is UNVERIFIED in the reviewed docs; no per-isolate in-memory bucket masquerading
  as durable/global protection.
- Empty/error/partial-unavailable states for every list and mutation.
- Accessibility: labels, visible focus, keyboard sheets/modals, contrast.
- README setup, quotas/backlog/CPU monitoring, bounded sweeps/fan-out and runbook.
- Keep previous traps green. Free tier availability is not proof auth, push and
  sync fit its CPU/storage/Queue limits; measure before choosing a production plan.

### Proof and manual smoke

Whole completion gates; rate-limit behavior, list/errors and accessible controls;
claim/sync backlog recovery after repeated failures; projected discovery drift.

After explicit approval, separately verify: Resend sign-in code from the auth
request, Queue-driven notification email, authorized image stream, installed iOS
push, alarm/Queue/Cron recovery,
migration-compatible Worker update, and rollback procedure. Legacy production
stays live until approved cutover; no teardown is bundled into this feature.
