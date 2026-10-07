# D1 and cache Durable Object storage

This is the target storage design. The Foundation port has not created its Worker
package/config/migrations yet; this docs change does not migrate any data or touch
production. [plan.md](plan.md) defines semantics; this page explains the mechanics.

## Two stores, two jobs

| Store | Owns | Never used for |
| --- | --- | --- |
| One SQLite DO per cache | Membership/owner role, settings/join secret, items, requests, pending_sync | Global email/subscription storage |
| Global D1 | Better Auth users/sessions/challenges/rate limits, app profiles, cache registry, my_caches discovery, push subscriptions, outbox | Authorizing cache membership |
| Private R2 | Photos under cacheId/itemId | Public access or membership decisions |

The Worker derives the cache DO from `/api/caches/{cacheId}/...`; UUID item/request
IDs need no global locator. Joins carry `{cacheId}.{secret}`, compared in that DO.
Names are fetched from D1 after cache authorization. Cross-cache requests discover
the caller's my_caches, but each DO separately checks membership and party visibility.

`my_caches` and registry are eventual projections. A stale index is a missing/404
entry, not a permission. There are no cross-store foreign keys or transactions.
D1 foreign keys relate only D1 tables; DO references relate only that cache's tables.

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
assume auth operations inherit cache-DO transaction semantics.

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

## Local transactions

Each cache check-then-write is one synchronous local transaction:

```typescript
ctx.storage.transactionSync(() => {
  // Read membership/item/requests, decide, then write state and pending_sync.
  // Throw an expected 404/409 to roll back all local changes.
});
```

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
for these bindings. They are not exposed through a browser database API. Legacy
Supabase/Postgres must retain its protections until separately approved retirement.

## D1 migrations

The Foundation port adds a separate SQLite migration directory and configures it
on the D1 binding. Do not point Wrangler at the existing PostgreSQL migrations.
Wrangler records applied files in `d1_migrations`, not a custom boot-time ledger.
[Official migration reference](https://developers.cloudflare.com/d1/reference/migrations/index.md).

After tooling exists, local-only commands are:

```bash
npx --no-install wrangler d1 migrations create communalcache init
npx --no-install wrangler d1 migrations list communalcache --local
npx --no-install wrangler d1 migrations apply communalcache --local
npx --no-install wrangler dev
```

Create only writes a local migration file; list/apply explicitly select local D1.
[Wrangler documents local/remote selection](https://developers.cloudflare.com/workers/wrangler/commands/d1/index.md#d1-migrations-apply).
The database name/binding must match the future Wrangler configuration. There is
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
version. Tests cover both a fresh object and an older persisted schema.

DO namespace/class deployment configuration is separate from SQL schema migration.
Creating/renaming/deleting classes is an approval-gated operator action. Do not
rename a class/namespace casually and mistake a new empty DO for migrated data.

Use additive/backward-compatible schema changes while old/new Worker versions can
both be active. A code rollback does not undo D1 or per-object schema changes;
prefer fixing forward for incompatible migrations.

## Durable sync, not distributed transactions

A mutation writes state plus ordered pending_sync rows locally, then sets an alarm.
For each pending row, apply its D1/R2 effects idempotently; insert outbox by the
stable DO-generated ID, send that ID to Queue, then delete the local pending row.
Replay cannot reset an existing outbox's attempts/claim/sent/failed state.

- One ordered bounded drain per DO, even if alarm and `flushSync` overlap.
- Registry upsert precedes reverse-index inserts; removal/name changes cannot be
  undone by an older intent finishing late.
- Catch failures and set another alarm while work remains. Built-in alarm retries
  stop after six; every entry point re-arms pending work.
- Registry Cron invokes each known DO's `flushSync`; outbox Cron repairs failed
  Queue handoff, expired messages or claims. Neither uses D1 as authorization.

[Alarms are at-least-once and finite-retry](https://developers.cloudflare.com/durable-objects/api/alarms/index.md).
The namespace binding cannot list objects. Management REST listing exists but needs
account credentials and is not the application's sweep mechanism. A newly created
cache not yet in the registry has a commit/alarm crash window; entry-point retries
repair it, and the creation feature must test/document that window explicitly.

## Tests and migrations in setup

Use Vitest + `@cloudflare/vitest-plugin`, which runs tests inside the local Workers
runtime. The old `vitest-pool-workers` package is renamed/deprecated. No production
bindings, real-provider calls or hosted database are needed for invariant tests.

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
are the API references. Tests must distinguish pending work from terminal failure
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
map legacy Supabase users by verified email into inserted Better Auth user rows,
preserve profiles and rewrite user_id/owner_id/requester_id references throughout
D1, DO tables and pending-sync/outbox payloads. Reject ambiguous/unverified email
mappings; do not migrate old sessions. No automatic teardown, destructive reset
or implicit dual-write migration here.
