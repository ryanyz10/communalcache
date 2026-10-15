# D1, Cache and Owner Durable Object storage

**Shared target: option B (2026-10-15).** Current app code still keeps items/requests
in Cache DOs. The schemas/protocol below are the approved replacement, not code or
migrations shipped by this docs PR. Existing cache-local tests do not prove Owner
behavior. See [plan.md](plan.md) and the
[shared implementation plan](build-guide.md#shared-items-implementation-plan).
The approved D1 database exists; further resources, migrations, resets and deployment
still need separate approval. No Cloudflare operation is part of this docs change.

## Stores and authorities

| Store | Owns | Never used for |
| --- | --- | --- |
| One Cache DO per cache | Membership/settings, permanent owner_targets, display listings, local pending_sync | Canonical stock/request decisions |
| One Owner DO per user | Items/library, attachments, ONE stock ledger, requests, revoked tombstones, local pending_sync | Fresh cache membership authority |
| Global D1 | Auth/profiles/rate limits, cache/my_caches discovery, request_index, push subscriptions, outbox | Item, membership or stock authorization |
| Private R2 | Immutable ownerId/itemId/uploadUUID photos | Public access or permission decisions |

Cache context routes to the Cache DO. Its authorized listing identifies an Owner
DO; private library routes use the authenticated caller's own Owner DO selected by
`idFromName(user_id)`. Owner identity is fixed metadata, not a body-supplied owner.
There is no D1 item locator. Joins keep cacheId.secret and compare only in Cache.
Public display-name enrichment happens after authorization and never selects email.

`my_caches` discovers Home caches. Incoming requests and Your items are local to the
caller's Owner DO. Outgoing requests discover owners through D1 request_index, with
bounded owner pages/concurrency and per-target requester filtering. Missing/stale
rows delay/hide results or yield 404, never access. Cache listings are display
projections, not request permissions or a second stock count. There is no FK or
transaction across these stores; each SQLite FK stays within its own database.

## Planned shared schemas

Illustrative target DDL only: implementation PRs hand-write/review migrations and
prove upgrades. Do not execute this against staging from this docs PR. All app IDs
are UUID text and timestamps integer Unix milliseconds; all application SQL binds
inputs. Cache config/members retain their existing role/status/secret constraints.

### Cache projection and permanent routing targets

The target replaces cache-local canonical items/requests with these tables;
physical retirement of old staging tables/data belongs to the migration plan.

```sql
CREATE TABLE listings (
  item_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  is_consumable INTEGER NOT NULL CHECK(is_consumable IN (0,1)),
  available INTEGER NOT NULL CHECK(available IN (0,1)),
  unavailable_note TEXT, photo_version TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE owner_targets (
  owner_id TEXT PRIMARY KEY NOT NULL, registered_at INTEGER NOT NULL
);
```

`owner_targets` is not a listing, membership copy or display count. Attach admission
checks O active and inserts O here in the **same Cache transaction**, before its
Owner attachment can commit. Never delete the registration while the cache exists,
even after detach. Listing timestamps are display metadata, not permission or a
platform total-order guarantee. Projection replay must not restore canonical access.

### Owner canonical state

Ownership is implicit in the fixed user namespace; no requester's FK reaches Cache
members or D1 users. Only local item dependencies use foreign keys.

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, description TEXT,
  photo_path TEXT,
  is_consumable INTEGER NOT NULL CHECK(is_consumable IN (0,1)),
  quantity INTEGER,
  available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)),
  unavailable_note TEXT, created_at INTEGER NOT NULL,
  CHECK(is_consumable = (quantity IS NOT NULL)),
  CHECK(quantity IS NULL OR (typeof(quantity) = 'integer' AND quantity BETWEEN 0 AND 9999))
);
CREATE TABLE attachments (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  cache_id TEXT NOT NULL, attached_at INTEGER NOT NULL,
  PRIMARY KEY(item_id, cache_id)
);
CREATE TABLE requests (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  cache_id TEXT NOT NULL, requester_id TEXT NOT NULL, quantity INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  decision_reason TEXT, decided_at INTEGER, created_at INTEGER NOT NULL,
  CHECK(quantity IS NULL OR (typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 9999)),
  CHECK((status = 'pending') = (decided_at IS NULL)),
  CHECK(status <> 'rejected' OR decision_reason IS NOT NULL)
);
CREATE INDEX pending_requests ON requests(item_id) WHERE status = 'pending';
CREATE INDEX requests_cache_requester ON requests(cache_id, requester_id, status);
CREATE INDEX requests_requester ON requests(requester_id, created_at, id);
CREATE TABLE revoked (
  cache_id TEXT NOT NULL, user_id TEXT NOT NULL, revoked_at INTEGER NOT NULL,
  PRIMARY KEY(cache_id, user_id)
);
```

Type/quantity consistency remains a runtime Owner transaction check as well as the
schema rules. `requests` deliberately does not FK to attachments: detaching rejects
pending rows but can retain decided rows. Global item deletion may cascade them
after recipient snapshots. `revoked(C,R)` and `revoked(C,O)` permanently block late
request/attachment work; removed cache memberships cannot rejoin.

Both DO classes keep independent schema-version metadata and the ordered
`pending_sync(sequence, id UNIQUE, kind, payload, created_at)` table. Fixed Owner
identity initialization/namespace checks must be proved in PR 2. No Owner schema,
class migration or binding is added here.

### D1 outgoing-owner discovery

```sql
CREATE TABLE request_index (
  requester_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  PRIMARY KEY(requester_id, owner_id)
);
```

Request creation records its stable index-upsert intent in the same Owner
transaction as request/notification state; the drain does an idempotent pair insert.
This is discovery only. Stale pairs may remain after decisions/deletion and return
no canonical rows; never use them to bypass requester/party checks or item/photo
checks. Do not delete a pair merely because one request ended while another may
still need it. Row/cursor budgets and any later cleanup require runtime proof.

App UUIDs come from `crypto.randomUUID()`; app user ID equals Better Auth user.id
with its UUID generator configured. App timestamps are integer Unix milliseconds;
auth date columns/conversions follow its pinned generated schema. SQLite checks
and explicit NOT NULL constraints preserve product rules. Emails live in the auth
user table with its reviewed uniqueness/normalization, not a duplicate app user
identity. Notification delivery reads email privately; public enrichment reads
only user.id/display_name. App JSON payloads are text.

## Better Auth schema and adapter

Pin `better-auth@1.7.7` (published 2026-09-30, over seven days old on 2026-10-08).
Its native adapter accepts `database: env.DB`; no third-party kysely-d1 is needed.
The older other-relational-databases page lists that community dialect, but the
[specific D1 example](https://www.better-auth.com/docs/concepts/database.md) and
[tagged implementation](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/kysely-adapter/src/dialect.ts#L184-L194)
show native support. It explicitly disables interactive transactions; do not
assume auth operations inherit object-local DO transaction semantics.

D1 contains Better Auth's `user`, `session`, `account`, `verification` and
`rateLimit` tables. Add nullable `user.display_name` as the app profile concept,
configured as an additional auth field but not writable through unused auth
signup/update endpoints. Better Auth core name is not community display_name.
`my_caches`/push user_id references point to `user.id`; no separate `users` table.

Derive hand-written, reviewed migration SQL from the pinned library's schema
generator output/config, including plugins/additional fields and database rate
limits. Preserve its column types, required defaults and indexes; do not invent
auth schema from a remembered table list. Apply through Wrangler, never expose
Better Auth's example migration endpoint in production or run DDL at HTTP startup.
The generator is a schema reference, not permission to use an ORM for app queries.
See [schema generation](https://www.better-auth.com/docs/concepts/database.md#generating-schema).

Sessions/challenges/rate limits stay in D1; no secondary storage or session cookie
cache. OTPs explicitly use hashed storage, six digits/300s/three attempts and
rotate on resend (hashed values cannot be recovered for reuse). Rate-limit storage
is database, not per-isolate memory. Foundation tests must prove concurrent OTP
redemption, attempt budgets and counter behavior against local D1; documented
adapter support is not a project-level concurrency guarantee.

`0003_otp_identifier_unique.sql` adds a partial UNIQUE index for the plugin's exact
`sign-in-otp-` prefix (case-sensitive GLOB), the only exposed OTP type. It first
keeps the newest duplicate by `createdAt`, breaking same-millisecond ties by
insertion `rowid`; unrelated verification namespaces are unchanged. This makes
1.7.7's resend conflict handler replace the old row and prevents late wrong-code
restoration from resurrecting it. The sign-in request's `onAPIError` callback maps
only D1's exact `verification.identifier` unique-conflict diagnostic to 400
`INVALID_OTP`; unrelated database errors remain failures. This workaround tracks
upstream [#10437](https://github.com/better-auth/better-auth/issues/10437),
[#11105](https://github.com/better-auth/better-auth/issues/11105) and
[fix PR #10443](https://github.com/better-auth/better-auth/pull/10443). Retire it only
after a reviewed pinned upgrade supplies the same storage/restore guarantee.
Tests cover wrong-code/resend overlap and overlapping resends with equal timestamps.

## Local transactions

Each object's check-then-write is one synchronous local transaction:

```typescript
// Cache DO attach admission, before any Owner attachment exists:
cache.storage.transactionSync(() => {
  requireActiveMember(ownerId);
  registerOwnerTargetIfAbsent(ownerId);
});
// After that RPC completes, a separate Owner DO operation:
owner.storage.transactionSync(() => {
  requireOwnerCallerAndItem();
  requireNotRevoked(cacheId, ownerId);
  insertAttachmentAndListingIntent();
});
```

Illustrative shape, not a shared storage handle or distributed transaction.
“Writes never await between objects” forbids external awaits **inside** either
local check/write transaction; admission and canonical operations are separate
completed RPCs. A previous membership read is not an atomic global grant. Owner
requests recheck item/attachment, both cache/user tombstones, manual availability,
type/quantity and the all-cache pending sum locally, then insert request,
notification and request_index intents together. No cache_id predicate belongs in
the stock reservation sum.

No async callback, Promise, D1 call, R2 call, Queue send or await inside it.
`sql.exec()` runs synchronously; consume its cursor before returning/awaiting.
Cloudflare [documents rollback on throw and synchronous SQL participation](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/index.md#transactionsync).
Do not issue SQL BEGIN/SAVEPOINT manually; use the storage transaction APIs.

A DO is single-threaded, but an external await can let other handlers interleave.
[Input gates cover own storage; external I/O is different](https://developers.cloudflare.com/durable-objects/api/state/index.md#blockconcurrencywhile).
`blockConcurrencyWhile` is for constructor initialization or a bounded async
section that must exclude other events, not a substitute for local transactions.
Its timeout resets the DO after 30 seconds. Never hold local auth/quantity decisions
across network calls.

No Postgres pool, session advisory lock, row-lock order, app schema or RLS is needed
for these bindings. No two-object transaction is supplied or assumed. They are not exposed through a browser database API. Legacy
Supabase/Postgres must retain its protections until separately approved retirement.

## Registered-target revocation

A display projection cannot enumerate revocation destinations: it may be missing
when an attachment already exists. `owner_targets` closes that gap:

1. Cache attach admission atomically checks O active and registers O if absent.
2. Only after that returns does O's Owner DO check its permanent owner tombstone
   and commit the attachment/listing intent. Never remove the target on detach.
3. Member removal atomically marks R removed and records durable revocation work
   covering **every registered owner**, independent of listings. A bounded drain
   must retain complete target coverage/cursor state until all acknowledgments.
4. Each Owner receiver atomically inserts `revoked(C,R)`, rejects R's pending
   requests via C and records recipient/notification intents. If R is that owner,
   also detach all from C and reject all pending through those attachments.

A listing implies a prior attachment and therefore prior registration. Any request
admitted before removal routes to a registered target; admission afterward fails
Cache membership. Tombstone first refuses late creation; request/attach first is
rejected/detached by later delivery. Both orders converge under durable retry.
Registrations/tombstones are permanent for this model; re-attachment cannot erase
a removed membership. Other caches, canonical library items and photos survive.

This is **at-least-once/eventual**, not instant revocation across objects or an undo
of an already completed approval. The next Cache check blocks removed users, while
already authorized in-flight work may finish before delivery. PR 4 must prove both
orders, registration/removal before listing sync, owner removal before attachment
commit, detach/re-attach, replay, eviction and recovery beyond six failures. These
are **UNVERIFIED implementation gates** until that code and its runtime tests exist.

## Manual availability, not loan state

Confirmed semantics: `items.available` is an owner-only 0/1 toggle plus optional
short note. Project “Lent out” to every attachment. New requests check the flag and
return 409 when off; existing pending rows remain pending. A reusable approval's
**Mark as lent out** checkbox sets the flag/note and listing intents in the same
Owner transaction as its pending-only decision. Unchecked approval does not clear
the flag; the owner manually marks available again. No current-holder, borrower,
due-date, return or loan-status table/column is added. Computed consumable
`available_quantity` still uses one all-cache pending sum, not this boolean.

## D1 migrations

Foundation uses SQLite migrations in `migrations/d1/`, configured on binding `DB`
with database name `communalcache`. `0001_auth.sql` is reviewed from the pinned
schema compiler (`scripts/auth-schema.mjs`); `0002_app.sql` adds discovery, push
subscriptions and outbox; `0003_otp_identifier_unique.sql` supplies the narrow
sign-in OTP uniqueness workaround above without changing the generator reference.
Caches adds `0004_cache_sync_cursor.sql` for the bounded registry sweep; it is
discovery/recovery metadata, never authorization. Notifications adds
`0005_notification_sync_cursor.sql` so bounded outbox recovery pages cannot starve
later IDs behind repeatedly crashed claims; this cursor is not delivery state.
Polish adds `0006_write_limits.sql`: at most four reusable fixed-minute counters
per verified user, keyed by join/request route family (not cache/item IDs). A single
guarded UPSERT admits and increments atomically; changing a window reuses the row.
This is an abuse budget, not D1 cache authorization. User deletion cascades counters;
there is no time-window garbage sweep or in-memory bucket. See the
[Polish guide](build-guide.md#feature-9--polish) for limits and boundary behavior.
The listed files describe the current cache-local port. Owner tables, cache
listings/owner_targets, request_index and recovery cursor changes require future
reviewed PR 2–4 migrations; this docs PR adds none. Existing auth SQL/OTP uniqueness
is unrelated to item placement and stays unchanged.
Auth date columns store adapter-produced ISO strings;
app timestamps are integer milliseconds. `wrangler.jsonc` commits the approved
`communalcache` D1 ID `b4257b89-22d6-40f1-b250-ccd1985bf1d1`. Tests and default dev
bindings remain local; remote migrations and deployment require explicit approval.
Never point Wrangler at the legacy PostgreSQL migrations in `internal/db/migrations/`.
Wrangler records applied files in `d1_migrations`, not a custom boot-time ledger.
[Official migration reference](https://developers.cloudflare.com/d1/reference/migrations/index.md).

Local-only commands (disable fallback to the legacy Go `.env`) are:

```bash
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations list communalcache --local
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
npm run dev
```

Create new migration files in `migrations/d1/`; list/apply explicitly select local D1.
[Wrangler documents local/remote selection](https://developers.cloudflare.com/workers/wrangler/commands/d1/index.md#d1-migrations-apply).
The database name/binding must match `wrangler.jsonc`. There is
no DATABASE_URL or TEST_DATABASE_URL for the port. Never use remote bindings in tests.

D1's documented binding is auto-commit; `batch()` is an atomic SQL batch with
rollback on statement failure, not an interactive JS transaction. Global upserts
and claims use bound guarded SQL; never read global state and assume it stayed
unchanged while deciding. Do not rely on cross-statement `changes()` behavior
(UNVERIFIED); inspect each statement's D1 `meta.changes` after it executes.

## DO schema versions

Each DO has its own private schema and version number. Its constructor runs schema
initialization/upgrades under `ctx.blockConcurrencyWhile`, before handling RPCs.
Apply each local migration and version bump atomically; failure leaves the previous
version. Foundation's `src/cache.ts` uses v1 for cache data and v2 for pending_sync;
constructor upgrade tests persist v1, evict, then instantiate v2 without data loss.
Tests also inject DDL failure and prove version/DDL rollback. Caches now drains
registry/reverse-index intents in sequence. Joining produces notification intents
whose stable pending_sync ID becomes the D1 outbox ID and dedupe key via
`INSERT OR IGNORE`; replay preserves attempts, claims and terminal state. Payloads
snapshot the recipient ID and cache name without emails or invite secrets.
Notifications now sends each materialized outbox ID to Queue before deleting its
local intent, so either external boundary can be replayed without resetting state.

**Historical cache-local v2:** Photos/Requests/Removal reused its items/requests
schema, local cascade and cacheId/itemId/uploadUUID keys. Those tests remain
current-code reference, not the Owner schema or shared-stock proof. Do not transplant
that single-cache stock/cascade assumption into new Owner operations.

**Shared target:** PR 2 introduces Owner identity/versioning, items, attachments,
listings/owner_targets and ownerId/itemId/uploadUUID photo keys. PR 3 moves request
state/global reservation sums and adds request_index. PR 4 proves registered-target
removal and local detach/global-delete cascades under both message orders. Constructors
must not silently discard old staging data; its separately approved reset/migration
is PR 6. Keep mixed old/new writes gated until the corresponding protocol is safe.

Owner photo finalization rechecks canonical owner/item state after R2 I/O, commits
photo/listing/cleanup intents locally and never deletes the image just because one
cache detached. Request cache queues disclose only cache C's pending rows; stock
checks sum across every cache. The item owner can decide/see its own requests;
outgoing targets filter the requester. No email lookup is part of those responses.

DO namespace/class deployment configuration is separate from SQL schema migration.
Creating/renaming/deleting classes is an approval-gated operator action. Do not
rename a class/namespace casually and mistake a new empty DO for migrated data.

Use additive/backward-compatible schema changes while old/new Worker versions can
both be active. A code rollback does not undo D1 or per-object schema changes;
prefer fixing forward for incompatible migrations.

## Durable sync, not distributed transactions

Both classes commit state plus ordered pending_sync rows locally, then arm recovery.
Cache effects include registry/membership discovery, joins and registered-target
revocation RPCs. Owner effects include cache listing projections, request_index,
notifications and R2 cleanup. Receiver revocation commits its own tombstone/cascade/
intents before acknowledging. No object holds a transaction across that RPC.
Outbox materialization keeps the stable source-DO ID and preserves claim/terminal
state, then enqueues the ID. A failed effect or uncertain response leaves its source
intent replayable; only acknowledged effects permit deletion.

- One ordered bounded drain per object, including alarm/flush overlap; replay must
  not restore attachments, permissions or deleted item state.
- Local source state/intents and receiver state/intents are each atomic, never one
  distributed commit. Delivery is at-least-once and idempotent.
- Catch failures and keep alarms armed while work remains, beyond six built-in
  retries. Every entry point re-arms its pending work.
- Cache registry and known Owner IDs support bounded recovery sweeps; outbox Cron
  repairs Queue handoff/expired claims. Discovery never supplies permission.

[Alarms are at-least-once and finite-retry](https://developers.cloudflare.com/durable-objects/api/alarms/index.md).
**Current cache-local implementation:** Caches serializes all drains through one per-object promise,
processes at most 25 intent rows per drain (up to 50 external binding calls when
rows each insert D1 then send Queue), and keeps work armed while it remains.
Registry Cron sweeps 25 caches per tick using a persisted guarded cursor; failures
on one cache do not block others. `triggers.crons` declares the intended five-minute
schedule but no production trigger has been installed. Mutations with no external
effect (approval setting/invite rotation) need no projection intent.

**Owner target:** add a bounded sweep over known Owner IDs, for example D1 user-ID
pages selecting only `id`, with durable cursor/retry progress. Do not expose auth
user enumeration or acquire management credentials to list namespaces. Share total
Cache/Owner/outbox invocation budgets with headroom; adding 25 more Owner RPCs to
the existing sweep blindly is not quota proof. Exact cursor migrations, row/page
limits and CPU/subrequest fit remain **UNVERIFIED** PR 2–3 checks.

Sync failures persist `sync_retry` metadata in DO storage, doubling alarm delay from
five seconds to one hour; success clears it. Entry points preserve that delay and
registry Cron calls `flushSync(true)` to respect it; an explicit `flushSync()` forces
a retry for diagnostics. This changes no local SQL schema version and does not cap
recovery attempts.

Notification Queue consumption claims an outbox row with one guarded D1 UPDATE and
checks `meta.changes`. The 90-second lease/token guard protects both terminal writes,
which also require unsent/unfailed state. A failed send clears its own claim for retry;
an observed failure at `attempts >= 6` stamps `failed_at`. Attempts never bound claim
or Cron eligibility. Email lookup is private; no API exposes another user's email.
A 30-second delivery deadline covers claim/lookup/provider work (including a stuck
response body), with a 10-second provider abort and guarded durable outcome recording.

Push reuses `push_subscriptions` from the Foundation schema, without a migration.
A single guarded UPSERT sets caller ownership, rotates the registration ID and allows
at most three browser registrations per account under concurrent writes. DELETE is
caller-scoped. Delivery revalidates endpoint/key data and checks the captured ID/user
before fetch; 404/410 cleanup deletes only that captured registration, never a newer
refresh/account assignment. Live registrations mean push; none, or all expired this
pass, means email now. Transient/redirect/invalid push failures remain push retries,
never email escalation. Three sequential outbox rows per batch bound the added calls.

The five-minute Cron independently runs registry and outbox recovery. Outbox recovery
pages 25 IDs older than three minutes with absent/expired claims, then sends one Queue
batch and advances its guarded cursor. Terminal/live-claim rows are skipped; crashes
and dropped Queue messages remain recoverable. Sending succeeds at least once, not
exactly once: accepted mail followed by a failed D1 success write may be sent again.

The namespace binding cannot list objects. Management REST listing exists but needs
account credentials and is not the application's sweep mechanism. A newly created
cache not yet in the registry has a commit/alarm crash window; entry-point retries
repair it, and the creation feature must test/document that window explicitly.

## Tests and migrations in setup

Use Vitest + `@cloudflare/vitest-plugin`, which runs tests inside the local Workers
runtime. The old `vitest-pool-workers` package is renamed/deprecated. No production
bindings, real-provider calls or hosted database are needed for invariant tests.

The current harness covers Cache DOs; future shared PRs must register Owner test
bindings and migration fixtures. Existing green checks are not Owner protocol proof.

1. Config reads D1 SQL migrations via `readD1Migrations` from the plugin's config
   helpers and passes the migration array as a test-only binding.
2. A test setup file calls `applyD1Migrations(env.DB, migrations)` from
   `cloudflare:test`; this records applied versions in the local migration table.
3. Tests create DO stubs, invoke real RPCs concurrently, and use
   `runInDurableObject` to inspect local state or inject failures.
4. `runDurableObjectAlarm` immediately runs a scheduled alarm for the main Worker's
   DO. Assert work persists/re-arms after failures and replays idempotently.

[Migration configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/index.md#readd1migrationsmigrationspath)
and [runtime helpers](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/index.md#durable-objects)
are the API references. With the pinned plugin, expected native RPC rejections use
explicit await/try-catch assertions instead of Vitest `.rejects` (which produced
spurious unhandled reports). Crash replay uses `abortAllDurableObjects`, then
reacquires the same named stub; forced teardown invalidates old RPC channels.
Graceful eviction remains the constructor-upgrade/backoff-persistence check, not a forced-crash model.
Notification tests use the real local Queue producer with no automatic consumer;
`createMessageBatch`/`getQueueResult` exercise consumer ack/retry behavior in workerd,
while Resend fetch is mocked. No hosted Queue or real-provider delivery is claimed.
Tests must distinguish pending work from terminal failure
and a duplicate external send from a duplicate durable outbox row.

## Limits and recovery

Free D1: 500 MB per database, 5 GB/account; 5 million rows read/day and 100,000
written/day; 50 queries per Worker invocation. Free DOs: 100,000 requests/day,
13,000 GB-s/day, 5 GB/account, unlimited objects and 100 classes/account.
Per-object Free storage is **UNVERIFIED** due conflicting summary/FAQ; conservatively
budget 1 GB, not 10 GB. See [plan.md's sourced facts](plan.md#verified-platform-facts).

Bound sync/outbox/registry batches and requests fan-out. Watch unsent/pending age,
not only error counts; a healthy HTTP API can still have a broken notification path.
Recovery/export/restore on production storage is an operator action needing approval,
not a test fixture. A data migration from legacy storage is a separate cutover plan:
map legacy Supabase users by verified email into Better Auth rows, preserve names,
and rewrite identity references throughout D1, both DO classes and pending/outbox
payloads. Import each canonical item/request into its owner's DO, create attachments
and listings, rebuild request_index and convert owner-scoped photo references.
Do not merge equal-title legacy rows without an explicit approved mapping. Reject
ambiguous/unverified identities and do not transfer old sessions.

The new stack has no production data yet. Staging test data may be reset or migrated
by a reviewed one-off procedure in PR 6, with explicit approval/inventory/recovery
checks; no automatic constructor drop/reset or implicit dual write. Legacy production
remains live until the separately approved cutover. No such command runs in this PR.
