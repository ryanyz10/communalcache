# Communal Cache — agent context

Mobile-first household sharing for a close community. A directory and lightweight
ask/approve handshake, not a logistics system. Handoffs happen in real life; no
addresses, return/holder tracking or loan lifecycle. Lent out is only a manual
owner availability flag/note, not a borrower or return record.

Target: one TypeScript Cloudflare Worker serves `/api/*` and React static assets.
Cache DOs own membership, permanent owner-target registration and display-only
listings. One SQLite Owner DO per user owns canonical items, cache attachments,
shared stock, requests and revocation tombstones. D1 holds auth/discovery/outbox,
including requester-to-owner request_index; R2 holds owner-scoped private photos.
Queues plus both DOs' alarms/Cron recovery drain durable work.
Better Auth runs in our Worker, with D1 users/sessions and six-digit email codes
sent through Resend fetch. Magic links are a planned follow-up; SMS is deferred.
Intended production URL is https://communalcache.com; provisioning needs approval.

## How to work on this repo

- Build [docs/build-guide.md](docs/build-guide.md) in order, one feature per PR:
  Worker/DO logic, the feature's UI slice and its tests together.
- Feature branches are `feat/<short-name>`; docs branches are `docs/<short-name>`.
  Exactly one commit per PR; amend, do not stack commits on that branch.
- If the previous PR is unmerged, base the new branch/PR on it and include
  `Depends-on: ryanyz10/communalcache#N`. Update the build-guide status row in the PR.
- Open a PR with `gh pr create`; do not merge it. Publish a review whiteboard with
  what works/how to try it, flow diagrams/code links, invariant-critical diffs and
  genuine risks/deviations/questions. Keep building; apply feedback by amending
  the relevant branch and restacking those above it.
- Run the applicable gates before committing. Docs-only work changes no tooling
  or app code; distinguish existing-code checks from target-stack tests not yet built.
- **All external changes need explicit human approval:** Cloudflare resources,
  account commands/deploys/secrets, Resend/domain settings, or changes to the legacy
  Fly/Supabase deployment. No decommissioning without separately approved cutover.
- Review against the invariants/traps. Say when something is a real bug rather
  than a preference; do not invent problems or claim undocumented guarantees.

## Documents

- [docs/plan.md](docs/plan.md) is the settled product/architecture spec. Do not
  rewrite its decisions without explicit approval.
- [docs/build-guide.md](docs/build-guide.md) gives feature order, status, traps and
  the proving checks; start there.
- [docs/database.md](docs/database.md) explains D1/DO placement, migrations and
  local test setup; [docs/deploy.md](docs/deploy.md) is the approval-gated runbook.

## Non-negotiable invariants

1. **Split authority, never a projection grant.** Cache DO synchronously authorizes
   membership; Owner DO authorizes canonical item/attachment/stock/revocation state.
   Cache-context reads check both. Requests first check R/O active plus listing in
   Cache, then all Owner guards locally; no browser-supplied admission flag bypass.
   Cache pending queues never disclose another cache's requester identities. Non-members get 404; only valid-secret
   removed joins retain 403. A listing or D1 row routes a call, never authorizes it.
2. **No await inside local check-then-write.** Each Cache/Owner mutation uses one
   `ctx.storage.transactionSync`; throw rolls back its local state and intents.
   No cross-object RPC/D1/R2/Queue await belongs inside it. Completed admission
   RPCs may precede an Owner transaction; they are not a distributed transaction
   or timeless membership grant. Tombstones reconcile the removal race eventually.
3. **One stock count across caches; never overbook.** Owner request transaction:
   item exists/attached to C, neither (C,R) nor (C,O) revoked, R != O, valid quantity,
   manual available flag on, `quantity - pending_sum >= requested` across ALL caches,
   request + notification + request_index intent. Pending-only decisions deduct
   once; stock edits respect the global reservation floor; lost races return 409.
   Lent out blocks new requests, not existing pending rows. The reusable approval
   checkbox sets that flag/note and projection intents in the same transaction.
4. **Register targets before attachments; cascade locally, deliver durably.** Cache
   attach admission checks O active and inserts `owner_targets(O)` in one transaction
   BEFORE the Owner attachment commits. Never delete registrations while C exists.
   Cache removal marks R removed plus revocation intents for EVERY registered owner,
   not eventual listings. Each target atomically inserts permanent `revoked(C,R)`,
   rejects R's pending requests via C, and if R is that owner detaches all from C and
   rejects pending via those attachments. Either delivery order must converge with
   no surviving pending row. No instant rollback of completed approvals is claimed.
   Losing C preserves library items/photos/other caches. Global item deletion
   snapshots all pending recipients and records listing/notification/R2 cleanup
   before local cascade. No destructive route before its full protocol is proved.
5. **State plus `pending_sync` commits atomically; external effects are idempotent.**
   Stable intent/outbox IDs, ordered single drain per DO, no pending-row deletion
   until D1/R2/Queue effects succeed. Alarm and `flushSync` must not reorder work.
6. **Recovery keeps re-arming while work remains.** Alarm catches failures and
   reschedules; every DO entry point re-arms pending work. Six automatic retries
   are not indefinite recovery. Registry Cron flushes and outbox Cron re-enqueues
   expired nonterminal work. Test the new-cache commit/alarm scheduling window.
7. **D1 discovery never authorizes.** `my_caches` discovers Home caches;
   `request_index(requester_id, owner_id)` discovers outgoing request targets, each
   Owner DO filtering requester/party, never bypassing cache item/photo gates.
   Incoming requests and Your items use the caller's own Owner DO, not cache fan-out. Registry/known owner IDs discover
   recovery work only. Missing/stale rows mean delayed/empty/404 results, never access.
8. **Outbox eligibility is bounded by `failed_at`, never `attempts`.** A guarded
   expiring claim decides who sends; zero D1 `meta.changes` means ack/skip. Both
   terminal writes require `AND sent_at IS NULL AND failed_at IS NULL`, plus current
   claim ownership. Only an observed failure writes `failed_at`; a crashed last
   claim remains recoverable. Delivery is at-least-once.
9. **No endpoint returns another user's email.** App `GET /api/me` returns only
   your own authenticated Better Auth user email. Auth endpoints may return only
   the caller's session/user; no admin/list-users or public user lookup. D1 auth
   rows keep emails for login/delivery; public name enrichment never selects email.
10. **Push URLs are untrusted.** Strict push origins, HTTPS, no userinfo/nonstandard
    ports, `redirect: 'manual'` at send. Private-IP blocking by Workers is UNVERIFIED;
    there is no fetch DNS/dial hook for the old resolved-IP guard.
11. **`requireProfile` exempts `PATCH /api/me`, push routes and `/api/auth/*`.**
    Otherwise a new user cannot authenticate/set a name. Never use an email-derived
    or auth-core name to bypass the nullable app display-name profile.
12. **Photos remain private and owner-scoped.** Cache reads check Cache membership/
    listing, then Owner attachment and caller/owner tombstones before private R2
    streaming. Own-library reads authenticate its owner directly. Upload is owner-only
    with an Owner item/ownership re-check after R2 I/O; immutable keys are
    ownerId/itemId/uploadUUID. Detach/removal alone never deletes a shared photo.
    Same-origin cookies suffice; no public bucket, signed URL or bearer/blob route.
13. **Cookie auth requires app CSRF protection.** HttpOnly/Secure/SameSite=Lax
    production cookies, exact Better Auth trustedOrigins and Origin checks on app
    mutations; reject missing/null/foreign origins. Auth guards do not cover unrelated
    API handlers. No auth cookie cache; revocation checks D1.
14. **Auth challenges/limits stay in D1.** Hash OTPs, six digits/300s/three attempts,
    rotate on resend; persistent database rate-limit storage, never per-isolate
    memory. Auth email awaits Resend from the request, not notification Queue.
    Magic-link landing pages must not auto-verify; Continue is the future trigger.

### Old invariant mapping

| Old # | Status | Reason |
| --- | --- | --- |
| 1 app schema/RLS | Dropped | New data is private D1/DO storage, not PostgREST; leave legacy protections intact. |
| 2 no port 6543 | Dropped | Bindings/Wrangler migrations replace connection pools and advisory locks. |
| 3 over-booking | Changed | One Owner DO transaction guards shared stock/pending sum across all caches. |
| 4 lock order | Dropped | Object-local transactions need no Postgres row locks; no transaction spans objects. |
| 5 lock before snapshot | Changed | Each local snapshot/cascade/intents is atomic; registered-target revocation spans objects durably, not atomically. |
| 6 outbox recovery | Kept + extended | Failed-at eligibility/terminal guards remain; durable DO→D1 intents and self-re-arming alarms are added. |
| 7 membership/404 | Kept, implementation changed | Cache membership plus Owner item/tombstone authority; no projection grant or global transaction. |
| 8 email privacy | Kept | Own auth user email only; Better Auth session/user endpoints remain caller-scoped. |
| 9 untrusted push | Changed | Origin/HTTPS/manual redirects remain; no resolved-IP fetch hook or assumed platform SSRF immunity. |
| 10 profile exemptions | Kept + extended | Name onboarding, push and `/api/auth/*` cannot be gated out. |

## Conventions

- Plain TypeScript Worker dispatch and DO RPC, no router library or ORM. Cache
  context includes `/api/caches/{cacheId}`; its authorized listing routes to an Owner
  DO. Private library routes use the caller's Owner DO. No D1 item locator.
- Hand-written bound SQL. Membership/target registration stays in Cache SQL;
  canonical item/attachment/request/stock/tombstone checks stay in Owner SQL.
  Global D1 queries stay auditable. No transaction spans objects or D1/R2.
- UUID app keys; Better Auth user.id is the app identity (`generateId: 'uuid'`).
  App timestamps are integer Unix milliseconds; auth columns follow its reviewed
  generated schema. SQLite booleans have 0/1 checks; nullable columns are explicit;
  SQL cursors are consumed before awaits. Auth schema changes are hand-written
  Wrangler SQL migrations derived from pinned generator output, never public DDL.
- No new dependency without a reason that survives "does the runtime or an
  installed dependency already do this?" Target allowlist: `wrangler` (tooling and
  bindings/types), exact `better-auth@1.7.7` (Worker auth/session/OTP library and
  client, native D1 support), Vitest + `@cloudflare/vitest-plugin` (local runtime
  tests), `@block65/webcrypto-web-push` (candidate RFC 8291/VAPID WebCrypto, only with
  Push/runtime proof). No kysely-d1 is needed. New pins must have been published
  at least seven days ago; 1.7.7 was published 2026-09-30, checked 2026-10-08.
  Keep React/TypeScript/Vite, React Router, TanStack Query and Tailwind. Drop jose,
  the old provider Auth client, pgx/jwx/webpush-go from the port; no Resend SDK.
  Better Auth needs nodejs_compat for AsyncLocalStorage. The deprecated
  vitest-pool-workers is not the test dependency.
- `ponytail:` comments name intentional ceilings and their upgrade paths. Comments
  explain constraints the code cannot show, not what the next line does.
- Keep code readable cold: straight-line functions, guard clauses, no abstractions,
  interfaces or harnesses ahead of a demonstrated need. Deleting complexity wins.
- Non-trivial logic leaves a runnable check. Concurrency/constraints/migrations
  use local DO SQLite and D1, never mocked SQL. External HTTP providers are mocked.
- Private push egress guarantees, free-plan viability and library integration must
  not be promoted from UNVERIFIED to fact without evidence.

## Commands

**Target commands after the Foundation port adds root Worker tooling** (this docs
PR does not add package scripts, configuration or dependencies):

```bash
npx --no-install tsc --noEmit              # Worker/DO typecheck
npx --no-install vitest run               # whole local runtime suite
(cd web && npx --no-install tsc --noEmit && npm run build)
npx --no-install wrangler d1 migrations apply communalcache --local
npx --no-install wrangler dev             # defaults to local bindings; never --remote for tests
npx --no-install wrangler deploy --dry-run # bundle check only, not a deployment
```

No production test bindings. D1 tests use `readD1Migrations` + `applyD1Migrations`
in setup. DO tests use `runInDurableObject`/`runDurableObjectAlarm`; constructors
migrate local schema under `blockConcurrencyWhile` with a version number.
Store local secrets in gitignored `.dev.vars`; no secret values on argv or in git.
See the build guide for current-versus-target tooling and the full gates.

## Current state

Go foundation is live. Go Features 1–2 are implemented in open reference PRs
[#2](https://github.com/ryanyz10/communalcache/pull/2) and
[#3](https://github.com/ryanyz10/communalcache/pull/3); they are **not** Cloudflare
ports and will be superseded. Existing Go source, dependencies and deployment
files stay untouched by this docs PR; old commands/config are not new-stack gates.

**Next: shared-items PRs 2–6**, following the approved Owner DO spec in plan.md.
Current app code still stores canonical items/requests in Cache DOs; that is the
old implementation, not permission to use it for new shared-stock writes. Target
registration/revocation and Owner runtime proof are not implemented by this docs PR.
Draft #28 is superseded by shared-items PR 5's owner library. Implementation/review
status lives in the [build-guide table](docs/build-guide.md#status).
The legacy Fly app and Supabase remain live until approved cutover; the target
has no Supabase dependency. Migration maps legacy users by verified email into
Better Auth user rows and rewrites all D1/DO identity references; canonical items/
requests go to Owner DOs and cache relationships become attachments/listings.
Old sessions do not transfer. No resource/config/secret/decommissioning changes in this spec PR.
