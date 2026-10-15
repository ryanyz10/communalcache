# One D1 database and private R2 storage

**Target: single D1 authority.** This supersedes PR #29's Cache/Owner DO split.
Current `src/cache.ts` still has cache-local membership/items/requests; `src/db.ts`
contains D1 discovery/outbox and `src/sync.ts` registry recovery. The target below
must be ported, not treated as implemented. No schema/config/application changes,
Cloudflare command, remote migration or reset is part of this docs-only PR.
See [plan.md](plan.md) and [D1 PRs 2–7](build-guide.md#d1-implementation-plan).

## Stores and authorization

| Store | Owns | Never used for |
| --- | --- | --- |
| ONE D1 database | Auth/profiles/limits, caches/config/secrets, memberships, canonical items, item_caches, ONE stock ledger, requests, outbox/push, R2 cleanup intents | Public browser database credentials |
| Private R2 | Immutable ownerId/itemId/uploadUUID bytes | Permission or relational state |
| Queue | Outbox ID delivery hints/retries | Sole durable event storage |

Every cache-data query/write joins or EXISTS-checks active membership **in that
same SQL statement or atomic batch**. Item/photo reads also check attachment and
active owner membership. Non-members (including pending/removed/left) get 404; only the
valid-current-secret removed join returns 403. Private library operations check
owner_id=authenticated caller and do not need cache membership. Party-scoped
request history never grants cache/item/photo access or another cache's queue.
Public enrichment selects only user ID/display_name, never another user's email.

Home joins caches/memberships directly. Library filters items.owner_id; incoming/
outgoing Requests joins items and filters owner/requester. Index/paginate actual
rows, not copied discovery tables. Drop my_caches, cache registry role/cursor,
request_index, listings, owner_targets, revoked tombstones and pending_sync.
There is no DO namespace, RPC, schema constructor, alarm or sync recovery target.

## Planned D1 schemas

Illustrative target DDL, **not executable migrations shipped by this PR**. All app
IDs are UUID text, app timestamps integer Unix milliseconds, parameters bound.
Better Auth user.id is app identity (`generateId: 'uuid'`); auth types/date
conversions and migrations remain unchanged. The existing caches projection must
be upgraded into canonical cache/config rows, not retained alongside a new copy.

```sql
CREATE TABLE caches (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL, join_secret TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0 CHECK(requires_approval IN (0,1)),
  created_at INTEGER NOT NULL, operation_token TEXT
);
CREATE TABLE memberships (
  cache_id TEXT NOT NULL REFERENCES caches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id),
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  status TEXT NOT NULL CHECK(status IN ('active','pending','removed','left')),
  created_at INTEGER NOT NULL, operation_token TEXT,
  PRIMARY KEY(cache_id,user_id),
  CHECK(role <> 'owner' OR status = 'active')
);
CREATE UNIQUE INDEX one_cache_owner ON memberships(cache_id) WHERE role = 'owner';
CREATE INDEX memberships_user ON memberships(user_id,status,cache_id);
CREATE TABLE items (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES user(id),
  title TEXT NOT NULL, description TEXT, photo_path TEXT,
  is_consumable INTEGER NOT NULL CHECK(is_consumable IN (0,1)),
  quantity INTEGER,
  available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)),
  unavailable_note TEXT, created_at INTEGER NOT NULL, operation_token TEXT,
  CHECK(is_consumable = (quantity IS NOT NULL)),
  CHECK(quantity IS NULL OR (typeof(quantity) = 'integer' AND quantity BETWEEN 0 AND 9999))
);
CREATE INDEX items_owner ON items(owner_id,created_at,id);
CREATE TABLE item_caches (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  cache_id TEXT NOT NULL REFERENCES caches(id) ON DELETE CASCADE,
  attached_at INTEGER NOT NULL, operation_token TEXT,
  PRIMARY KEY(item_id,cache_id)
);
CREATE INDEX item_caches_cache ON item_caches(cache_id,item_id);
CREATE TABLE requests (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  cache_id TEXT NOT NULL REFERENCES caches(id),
  requester_id TEXT NOT NULL REFERENCES user(id), quantity INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  decision_reason TEXT, decided_at INTEGER, created_at INTEGER NOT NULL,
  decision_token TEXT,
  CHECK(quantity IS NULL OR (typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 9999)),
  CHECK((status = 'pending') = (decided_at IS NULL)),
  CHECK(status <> 'rejected' OR decision_reason IS NOT NULL)
);
CREATE INDEX pending_requests ON requests(item_id) WHERE status = 'pending';
CREATE INDEX requests_cache_requester ON requests(cache_id,requester_id,status);
CREATE INDEX requests_requester ON requests(requester_id,created_at,id);
```

Exactly one active cache owner is established by atomic cache+owner creation;
the unique index enforces at most one. No owner removal/transfer route. Account or
cache deletion is not added by these FKs. Membership rows are retained as removed
on removal and left on voluntary leave. Only removed denies a valid-secret rejoin;
left may rejoin under current approval rules without restoring old attachments.
App type is immutable; guarded request SQL also enforces
item/request quantity type consistency (a CHECK cannot look up another table).
New stock cannot fall below the all-cache pending sum. Requests deliberately do
not FK to attachments: decided history may remain after detach/removal. Global
item deletion snapshots recipients, then cascades request rows. Outbox must not
FK to deleted source items/requests/memberships.

Manual availability is `available` plus optional max **200 Unicode code points**
`unavailable_note`, validated server-side (not UTF-16 string.length). New requests
check flag; existing pending rows stay pending and may be decided while membership/
attachment is valid. Reusable approval can atomically set Lent out; unchecked
approval does not clear it. No current-holder/return table or new request status.

### Existing global tables retained

- Better Auth user/session/account/verification/rateLimit including nullable
  app display_name: unchanged. Do not invent a second app users/email identity.
- `outbox`: current id, kind, dedupe_key, payload JSON text, attempts >= 0,
  claim_until/token, sent_at, failed_at, created_at; UNIQUE(kind,dedupe_key),
  CHECK(sent_at IS NULL OR failed_at IS NULL), partial unsent index. IDs now come
  from the domain handler, not DO pending_sync. Snapshot payloads survive deletion.
- `push_subscriptions`: current unique endpoint, user_id, p256dh/auth, ID and
  created_at. Registration ID rotates on refresh/account reassignment.
- `write_limits`: current four reusable per-user route counters; guarded UPSERT,
  no isolate-memory limit. Auth/profile/origin failures do not count; attempts
  including later invalid-body/authorization failures do. Existing route budgets:
  join 10/min, join decisions 30/min, requests 20/min, decisions 60/min. Fixed
  windows may admit twice the budget across a boundary. Rejected attempts do not
  update rows. JSON 429 with 1–60s Retry-After; fail closed on D1 failure.
- `notification_sync_cursor`: bounded fair outbox rescue cursor, not event state.
  Retain/rename only via reviewed migration; the name does not imply target DO sync.

### Durable R2 cleanup

R2 cannot join a D1 batch. Record cleanup in D1 alongside the photo replacement or
item deletion; intents survive deletion and do not FK to source items.

```sql
CREATE TABLE r2_cleanup (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL, item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('exact','prefix')),
  target TEXT NOT NULL, created_at INTEGER NOT NULL,
  claim_token TEXT, claim_until INTEGER,
  UNIQUE(kind,target)
);
```

Validate target is the exact immutable key or trailing-slash ownerId/itemId/
prefix, never arbitrary input. Cron claims bounded pages with a fresh token and
lease; delete intent only after success using the current claim. On failure retain
it; crashes expire and retry. Prefix cleanup re-lists its first bounded page after
deletion until empty (a cursor over a changing key set can skip keys). Persist a
fair cleanup scan cursor if needed so repeated failures cannot starve later IDs.
External duplicates are harmless; cleanup must not delete a currently referenced
photo. No finite retry budget silently abandons cleanup. Exact budgets/lease and
cursor migration are **UNVERIFIED implementation gates**, measured with outbox
recovery against shared invocation limits.

Owner upload checks item ownership before R2 I/O and uses a guarded finalization
batch afterward: update photo_path only if caller still owns the item, record
replaced/rejected-key cleanup, and preserve a key that uncertain finalization
already attached. A crash after put before finalization can orphan an untracked
object; exact/prefix intents do not prove complete orphan recovery. Pre-upload
tracking or a reviewed orphan sweep/lifecycle policy is the upgrade. Detach and
membership removal never delete canonical photos. Cache reads join memberships
and attachment before private/no-store streaming; library reads authenticate owner.

## Atomic D1 protocols

D1 binding is auto-commit; **batch is atomic, not an interactive JS transaction**.
Documented failure rolls back the entire batch; each database processes queries
one at a time. See [sourced facts](plan.md#verified-platform-facts). Never issue
manual BEGIN/COMMIT around separate binding calls or assume an await-free JS
section serializes Workers. Every authorization/stock decision is guarded SQL.

### Tokens, no-op guards and result handling

- Single statement: put all authorization and state predicates in INSERT ...
  SELECT / UPDATE ... WHERE. No SELECT-then-write across an await.
- Multi-statement: primary guarded write stores fresh server UUID token on its
  target (operation_token/decision_token); dependent statements join that exact
  token AND target IDs **inside the same batch**. Delete token-bearing row last.
  A primary no-op must cause every dependent write/snapshot to no-op.
- New request/cache UUID may witness an insertion; primary insertion must fail on
  duplicate ID rather than IGNORE and accidentally reuse a previous operation.
  Fresh per-attempt tokens are not reusable idempotency or browser admission flags.
- No SQL changes() dependency across batch statements: **UNVERIFIED**. Inspect
  the primary result's D1 meta.changes after batch completes. Zero rows is not a
  SQL failure and does not roll back other statements automatically.
- Preserve FKs/CHECKs; prove primary predicates imply dependent matches/deductions,
  or force an actual constraint error for violated assumptions. A late JS throw
  cannot undo a batch that committed. Do not silently skip stock deduction after
  primary approval. Inject SQL failure at each boundary to prove rollback.
- Meta.changes zero: unauthorized/missing resource → 404; authorized pending/stock
  race → 409. A post-failure guarded diagnostic read may classify, never authorize
  a later write. If access was removed meanwhile, return 404 without disclosure.

### Cache creation, joining and settings

Create cache with fresh ID/operation token, then insert owner membership from that
exact row/token in the same batch. Reads immediately join memberships/caches;
there is no creation-to-registry/alarm window. Settings/rotation UPDATE requires
active owner membership in its SQL.

Join secret is 32 random bytes/base64url. Compare decoded fixed-length candidate
in constant time in the Worker; the guarded membership INSERT/UPDATE also matches
the exact stored secret/version compared, uses current requires_approval and never
overwrites removed membership. This closes rotation/config races without keeping
a read-time grant. Body {secret}, no secret in API URL/logs; invite page no-referrer.
Valid-current-secret removed join 403; missing/wrong secret 404. Reject join deletes
pending membership for retry. A guarded token marker on pending membership gates
outbox snapshot then delete/update; rejection snapshot precedes deletion. Removed
rows persist; no separate revocation tombstone is needed. A left row can be
upserted to the new active/pending state only by the current-secret guarded join;
existing active/pending joins remain idempotent and removed is never overwritten.

### Requests, decisions and stock

Primary request INSERT ... SELECT checks active requester AND item-owner
memberships in C, item_caches(I,C), requester != owner, type/quantity, manual flag
and stock minus pending sum **without a cache_id filter**. Same batch inserts
request-created outbox from the fresh request UUID. No browser owner/admission
field is accepted. Consumable item stock 0–9999; request 1–9999; reusable NULL.

Approval primary UPDATE requests WHERE pending + caller owns item + active both
memberships + attachment + sufficient stock writes status/decided_at/decision_token.
In that same batch: deduct consumable stock where the exact token matches; optional
reusable Lent out update with token; snapshot outbox with token. A concurrent
second decision cannot reuse the first token. Stock CHECK failure aborts the whole
batch; required relationships cannot disappear between batch statements. No
manual-available predicate blocks decisions on existing pending rows. Rejection
uses pending guard/token + required reason + outbox, no stock deduction.

Stock edit is owner-only guarded UPDATE with quantity bounds AND new_quantity >=
SUM(all pending for I), never separate read/calculation/write. Request, decision,
stock edit and destructive batches serialize at D1 statement/batch boundaries.

### Removal, detach and global deletion

Each operation below is **one atomic guarded batch**, not per-request awaited
loops or paginated partial cascades. Server constructs fixed SQL statements using
INSERT ... SELECT snapshots; many affected rows do not require many statements.
Size/time/query budgets still need tests; too-large work must fail safely rather
than silently weaken atomicity.

| Operation | Primary witness | Dependent statements, all token guarded |
| --- | --- | --- |
| Remove R from C | memberships UPDATE active non-owner R → removed + fresh operation_token, requiring active cache-owner caller | Snapshot affected pending via C (R requester OR item owner R) into outbox, deduped; reject those pending; delete R-owned item_caches for C; retain membership token row |
| Leave C | memberships UPDATE active non-owner caller → left + fresh operation_token | Same snapshot/reject/detach cleanup as removal; retain membership row; valid-current-secret rejoin follows current approval and never restores attachments |
| Detach I from C | item_caches marker UPDATE requiring authenticated item owner and active membership | Snapshot/notify pending for I,C; reject pending; delete marked attachment last |
| Delete library item I | items marker UPDATE requiring owner_id=caller | Snapshot pending across ALL caches, reject pending, insert exact/prefix R2 cleanup, delete marked item last (cascades attachments/requests) |

Outbox snapshots contain recipient, title, reason, quantity and destination before
source deletion, with per-request dedupe keys. Membership removal/attachment detach
preserves library items/private photos/other caches and does not deduct stock.
Completed approvals are not rolled back; no holder/return ledger is created.
Approved POST /api/caches/{cacheId}/leave uses the non-owner removal protocol with
left status, not a bare DELETE. Owners cannot leave. Membership removal/leave and
detach each use five statements; global deletion uses seven. All affected state
and snapshots commit together, while at most 25 immediate Queue hints are returned.
The outbox retains the rest for Cron. A destructively rejected pending request's
UUID is its stable outbox ID; the per-operation/request dedupe key and token gates
prevent replays from resetting delivery or manufacturing another closure event.

No registration-before-attachment protocol, target enumeration, eventual tombstone
delivery or projection cleanup. Request/attach first is included in later removal;
removal first makes later membership predicates fail. Next cache-data query sees
removed membership immediately, though a previously authorized stream cannot be
recalled. PR 5 must prove these races before destructive/shared routes are enabled.

## Notification recovery retained, not DO sync

Domain state and outbox now commit in one D1 batch. After commit send outbox IDs
to Queue; crash/failure before send leaves durable outbox for Cron. No D1 registry,
DO flushSync, alarm retry/re-arm, sequence drain or source intent materialization.

Keep existing guarded claim: unsent/unfailed and absent/expired claim; attempts++
and fresh token, 90s lease, meta.changes zero → ack/skip. Provider deadlines 10s,
whole-row 30s. Both sent_at/failed_at writes require unsent/unfailed/current live
claim. Only observed failure at attempts >= 6 writes failed_at; attempts never
bound eligibility. A crashed sixth claim remains recoverable. Queue retries are
finite; bounded cursor-paged Cron re-enqueues nonterminal expired-claim work older
than three minutes (initial page 25 per five-minute tick), repairing dropped IDs.
Cleanup Cron is separate durable R2 work, not resurrected DO sync.

Push policy is unchanged: three registrations/account, endpoint UPSERT reassigns
ownership and registration ID, stale 410 deletion matches captured ID/user. No
subscriptions/all expired → email now; transient push failures retry push. Strict
origin/HTTPS/default-port/manual-redirect policy applies at subscribe and send.
Delivery remains at-least-once; neither a duplicate Queue ID nor a duplicate
provider send implies a duplicate durable outbox event. No another-user email API.

## Better Auth schema and adapter (unchanged)

Pin better-auth@1.7.7 (2026-09-30, >7 days old at 2026-10-08 review). Native
`database: env.DB`; no kysely-d1. [Official example](https://www.better-auth.com/docs/concepts/database.md)
and [tagged dialect](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/kysely-adapter/src/dialect.ts#L184-L194)
show D1 support and transaction=false. This is not a promise of interactive app
transactions or every concurrent auth behavior.

Derive hand-written reviewed auth migrations from pinned generator/config,
including plugins/additional display_name/database rate limits. Preserve types,
defaults and indexes. No runtime/public migration endpoint. Better Auth core name
is not app display_name. No email-derived name, cookie cache or secondary session
storage. Six-digit/300s/three-attempt hashed OTPs rotate; database rate-limit
storage and race tests remain required.

`0003_otp_identifier_unique.sql` retains its case-sensitive GLOB partial unique
index for exact sign-in-otp- namespace. It keeps newest createdAt, rowid tie-break,
leaving unrelated namespaces intact. It prevents late wrong-code restoration from
reviving superseded OTPs. Only exact verification.identifier unique conflict maps
to 400 INVALID_OTP; unrelated D1 errors remain failures. Tracks upstream
[#10437](https://github.com/better-auth/better-auth/issues/10437),
[#11105](https://github.com/better-auth/better-auth/issues/11105) and
[fix #10443](https://github.com/better-auth/better-auth/pull/10443). Retire only after
a reviewed pinned upgrade proves equivalent resend/restore behavior, including
overlapping equal-timestamp resends. Magic-link hashed verification namespace is
disjoint; fragment/Continue POST, independent resends, exact-origin callbacks,
single-use redemption and code fallback remain as [specified](plan.md#magic-links-implemented-locally-retained).

## Migrations, local tests and retirement

Current `migrations/d1/` contains 0001_auth, 0002_app (discovery/push/outbox),
0003_otp_identifier_unique, 0004_cache_sync_cursor, 0005_notification_sync_cursor
and 0006_write_limits for the cache-local implementation. D1 port migrations add
0007_d1_caches, 0008_d1_items and 0009_d1_requests. PR 5 adds
0010_membership_leave: rebuild memberships while preserving rows/tokens/FKs and
owner indexes, adding left to the status CHECK. Obsolete discovery/cursor removal
still belongs to retirement. Never edit already-applied migration history to
pretend the DO data was in D1 all along.
Wrangler records versions in d1_migrations; no custom boot-time ledger.
Do not point it at legacy `internal/db/migrations/`.

The approved database communalcache is binding DB; committed ID
b4257b89-22d6-40f1-b250-ccd1985bf1d1. Staging uses its distinct named environment
and database. Local development/test bindings stay local. Example **local-only**
commands, not run by this docs PR:

```bash
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations list communalcache --local
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
npm run dev
```

No DATABASE_URL/TEST_DATABASE_URL for the port. `.dev.vars` is gitignored; disable
fallback to legacy `.env`. [Migration reference](https://developers.cloudflare.com/d1/reference/migrations/index.md).
Use additive/backward-compatible changes while old Workers can run. A code
rollback does not undo D1 migrations; incompatible schema changes need approved
fix-forward/recovery, not namespace recreation.

Tests use @cloudflare/vitest-plugin and real local D1: config readD1Migrations,
setup applyD1Migrations, concurrent Worker requests against the same DB. No mocked
SQL, hosted database or target DO helpers. Existing cache-local tests retain DO
helpers only until their code retires. Test primary guard no-ops and injected SQL
failure rollback, two-cache overbooking, double-approve, stock edits and all
removal/detach/delete race orders. Mock Resend/push HTTP; exercise local Queue
consumer ack/retry via createMessageBatch/getQueueResult. D1-supported batching
is not implementation proof until these tests exist.

PR 7 removes obsolete Cache code/bindings/sweeps/helpers and appends a Wrangler
`deleted_classes` migration. **Class deletion destroys DO data; explicit approval
is required**. Inventory/backup/approved staging test-data reset must precede it;
no implicit constructor drop or new empty namespace as migration. PR #29's Owner
class plan is superseded and must not be deployed. Remote reset/migration/deploy
needs approval and is not part of this spec.

Legacy Go/Supabase migration later maps verified-email users to Better Auth,
imports caches/memberships/items/item_caches/requests directly to D1 and rewrites
all identity references in outbox/photo paths. Preserve display names, reconcile
ownership/stock/status, reject ambiguous identities and approve duplicate-item
mapping rather than merging equal titles. No old sessions transfer. Staging has
no new-stack production data; its reset is not legacy cutover. Fly/Supabase stays
live until separately approved cutover and decommissioning.

## Limits and growth paths

VERIFIED Free D1: 100,000 rows written/day, 5M read/day, 500 MB/database, 50 queries
per Worker invocation; 5 GB/account. Single primary location means a round trip
for distant users. Queries run one at a time; throughput is query-time-bounded,
with **no verified workload-specific throughput number**. Index stock sums,
member/attachment joins and cursor pages; account for auth/outbox/counter/index
writes and cleanup, not just user-visible mutations. Monitor rows read/written,
query duration, Worker CPU and oldest outbox/cleanup ages.

Read replication/Sessions API integration is **UNVERIFIED for our authorization
and read-after-write needs**. Regional sharding requires explicit stock/cache/
identity boundaries and migration; there is no promised cross-shard transaction.
A future per-cache DO could serve WebSocket fan-out only, not canonical data.
See [plan's sourced facts](plan.md#verified-platform-facts); quotas are ceilings,
not a promise of free-plan viability. All external upgrade/recovery actions need
approval. None runs in this docs PR.
