# Communal Cache — agent context

Mobile-first household sharing for a close community. A directory and lightweight
ask/approve handshake, not a logistics system. Handoffs happen in real life; no
addresses, return/holder tracking or loan lifecycle. Lent out is only a manual
owner availability flag, not a borrower or return record.

Target: one TypeScript Cloudflare Worker serves `/api/*` and React static assets.
ONE D1 database is the source of truth for auth, caches, memberships, canonical
items, cache attachments, shared stock, requests and the notification outbox.
Private R2 holds owner-scoped photos. Queue/Cron recover notification delivery;
Cron also retries durable R2 cleanup intents. No Cache or Owner Durable Objects,
projections, discovery copies or cross-object sync are in the target.
Better Auth runs in the Worker: magic-link sign-in with explicit six-digit email
code fallback, D1 sessions and bounded Resend fetch. SMS is deferred.
Intended production URL is https://communalcache.com; provisioning needs approval.

## How to work on this repo

- Build [docs/build-guide.md](docs/build-guide.md) in order, one feature per PR:
  Worker/D1 logic, the feature's UI slice and its tests together.
- Feature branches are `feat/<short-name>`; docs branches are `docs/<short-name>`.
  Exactly one commit per PR; amend, do not stack commits on that branch.
- If the previous PR is unmerged, base the new branch/PR on it and include
  `Depends-on: ryanyz10/communalcache#N`. Update the build-guide status row in the PR.
- Open a PR with `gh pr create`; do not merge it. Publish a review whiteboard with
  what works/how to try it, flow diagrams/code links, invariant-critical diffs and
  genuine risks/deviations/questions. Keep building; apply feedback by amending
  the relevant branch and restacking those above it.
- Run the applicable gates before committing. Docs-only work changes no tooling
  or app code; distinguish existing-code checks from target tests not yet built.
- **All external changes need explicit human approval:** Cloudflare resources,
  account commands/deploys/secrets, Resend/domain settings, or changes to the legacy
  Fly/Supabase deployment. DO deletion and staging reset need explicit approval;
  no decommissioning without separately approved cutover.
- Review against the invariants/traps. Say when something is a real bug rather
  than a preference; do not invent problems or claim undocumented guarantees.

## Documents

- [docs/plan.md](docs/plan.md) is the settled product/architecture spec. Do not
  rewrite its decisions without explicit approval.
- [docs/build-guide.md](docs/build-guide.md) gives feature order, status, traps and
  proving checks; start there.
- [docs/database.md](docs/database.md) explains D1 schemas, guarded batches,
  migrations and local tests; [docs/deploy.md](docs/deploy.md) is the approval-gated
  runbook. Current Cache DO code is historical, not target authority.

## Non-negotiable invariants

1. **One D1 authority, no copied authorization.** Every cache-data read/write checks
   active membership with a join/EXISTS in the same SQL statement or atomic batch.
   Cache item access also checks the attachment, `i.active=1` and active owner
   membership. Inactive items remain owner-readable in the private library. Private
   library operations check item ownership; cache admins cannot edit others' items.
   Cache queues expose only that cache's pending requesters. Non-members get 404;
   only a valid-secret removed join retains 403. No projection or cached grant.
2. **Guard the write, not a previous read.** D1 has no interactive transaction.
   Check-then-write is one guarded statement or one atomic batch whose first guarded
   write records a unique per-operation token; dependent statements require that
   token. No separate authorization/stock read then write across an await. Never
   use SQL changes() across batch statements; inspect primary D1 meta.changes.
   Statement failure rolls back the batch; a zero-row guard is not a SQL failure.
3. **One stock count across caches; never overbook.** Request INSERT ... SELECT
   checks active requester/owner membership, attachment, requester != owner, valid
   type/quantity, `i.active=1`, manual available flag and quantity minus ALL-cache
   pending sum.
   Request plus outbox commit together. Pending-only token-guarded approval deducts
   once; stock edits cannot undercut pending reservations; lost races return 409.
   Lent out blocks new requests, not existing pending rows. Reusable approval's
   checkbox sets that flag in the same batch. The item-page button immediately
   saves Mark as lent out / Mark as available; no availability note.
4. **Destruction is one guarded atomic batch.** Removal, detach, deactivation and
   global item deletion snapshot affected recipients into outbox before deleting source rows,
   reject affected pending requests and commit all relational changes together.
   Deactivation's first owner-guarded `active=1→0` write records a fresh operation
   token; every outbox/rejection statement requires it. It rejects pending across
   all caches without detaching or deleting photos; reactivation never restores asks.
   Removal rejects the member's pending via C and detaches their items from C,
   rejecting pending via those attachments; library/photos/other caches survive.
   Removal is effective for the next statement, not eventual tombstone delivery;
   already completed approvals/authorized reads are not recalled. No early route.
5. **State and durable effects commit together.** Insert notification outbox rows
   and needed R2 cleanup intents in the same D1 batch as the state change, using
   stable unique IDs/dedupe keys. Queue sends, R2 and provider calls happen after
   commit, never inside a database transaction. External effects are idempotent
   where possible; retain cleanup work until success. No pending_sync bridge.
6. **Recovery follows durable D1 work.** Queue retries plus bounded cursor-paged
   Cron rescue unsent/unfailed outbox rows with absent/expired claims, including a
   failed post-commit enqueue. Cron also retries idempotent R2 cleanup intents.
   Finite Queue retries are not indefinite recovery. No DO alarms, registry sweeps
   or re-arming protocol; backlog age and terminal failures must be observable.
7. **D1 queries authorize and aggregate directly.** Home joins active memberships;
   Your items filters owner_id; incoming/outgoing Requests filter owner/requester.
   Every cache-context item query/count includes current membership/attachment
   predicates and `i.active=1`; private library and party-only history are exceptions.
   Party-only request history never grants cache/item/photo access or reveals
   another cache's queue, except the owner-approved count-only position: a requester
   with their own pending reusable-item request may see the count of earlier pending
   requests for that item across all caches, in the same caller-guarded SQL read.
   Never expose those other requests' names, IDs, caches or details. Cache-context
   request rows remain cache-scoped. Paginate/index real tables; no my_caches, request_index,
   listings, owner_targets, registry or revocation-tombstone copies.
8. **Outbox eligibility is bounded by failed_at, never attempts.** A guarded
   expiring claim decides who sends; zero D1 meta.changes means ack/skip. Both
   terminal writes require AND sent_at IS NULL AND failed_at IS NULL, plus current
   claim ownership. Only an observed failure writes failed_at; a crashed last
   claim remains recoverable. Delivery is at-least-once.
9. **Never expose another user's authentication email.** App `GET /api/me` and
   auth endpoints return only the caller's own auth user/session email. The approved
   future contact feature may return a separately user-chosen contact email only
   to the two parties of an approved request while both are active in that
   request's cache, guarded in the same SQL statement. Never select, infer or
   prefill contact from the auth email field. Admin shows names/IDs and scoped
   operational metadata only, never auth/contact emails or raw private payloads;
   public name enrichment never selects email.
10. **Push URLs are untrusted.** Strict push origins, HTTPS, no userinfo/nonstandard
    ports, `redirect: 'manual'` at send. Private-IP blocking by Workers is UNVERIFIED;
    there is no fetch DNS/dial hook for the old resolved-IP guard.
11. **`requireProfile` exempts `PATCH /api/me`, push routes and `/api/auth/*`.**
    Otherwise a new user cannot authenticate/set a name. Never use an email-derived
    or auth-core name to bypass the nullable app display-name profile.
12. **Photos remain private and owner-scoped.** Cache reads check active caller and
    owner memberships plus item attachment and `i.active=1` in D1 before private
    R2 streaming. Cache upload finalization rechecks it after R2 I/O too; inactive
    items' owner-library photos remain readable/editable.
    Own-library reads authenticate the item owner directly. Upload is owner-only
    with a guarded item/ownership re-check after R2 I/O; immutable keys are
    ownerId/itemId/uploadUUID. Detach/removal alone never deletes a shared photo.
    Same-origin cookies suffice; no public bucket, signed URL or bearer/blob route.
    Profile photos use `users/{userId}/{uploadUUID}` and app-owned user_photos:
    self-only mutation; reads and avatar metadata require self or a cache where
    caller and photo owner are both active, checked in one D1 statement before
    private/no-store streaming. History/metadata never grants photo permission.
    Pointer/token changes and cleanup commit together; profile cleanup has
    scope=profile, item_id=NULL and exact keys only, never a fake item ID. Claims
    protect current item/profile pointers. Use initials on absent/failed images.
13. **Cookie auth requires app CSRF protection.** HttpOnly/Secure/SameSite=Lax
    production cookies, exact Better Auth trustedOrigins and Origin checks on app
    mutations; reject missing/null/foreign origins. Auth guards do not cover unrelated
    API handlers. No auth cookie cache; revocation checks D1.
14. **Auth challenges/limits stay in D1.** Hash OTPs, six digits/300s/three attempts,
    rotate on resend; persistent database rate-limit storage, never per-isolate
    memory. Auth email awaits Resend from the request, not notification Queue.
    Magic-link landing pages never auto-verify; explicit Continue triggers the POST.
    Opt-in LOCAL_DEV_AUTH on loopback may log auth mail only without a Resend key; D1 challenges stay real.
15. **Plans/quotas: one limits source, same-write enforcement.** User/cache plan
    columns default `free`; one `plan_limits` table keyed by `free` / `plus`
    controls limits inside the same guarded write or fresh-token batch. No client/
    per-isolate/hard-coded route quota or previous entitlement read across an
    await. Free caps apply to every account: 1 owned cache, 2 new in rolling 24h,
    20 active cache memberships, 30 active members/cache, 100 owned items,
    20 pending outgoing requests and 1 current item photo at the current cap.
    Plus keeps owned_caches at 3 and cache_members at 100; other seeds equal free
    until the owner decides otherwise. Profile_photos=1 now guards profile finalization after R2
    I/O; replacement keeps one current pointer, removal remains allowed at zero. Pending joins reserve no seat; approval/left rejoin
    rechecks caps, while rejection and existing join replays stay possible at cap.
    Count owners; never exempt by role. Missing policy fails closed. Return 409
    limit_reached plus stable limit name; preserve photo replacement and cleanup.
    No plan UI, upgrades or billing; before admin exists, assignments are exact
    owner-approved manual D1 commands only, never automatic. No silent data loss
    on downgrade; quota errors must clearly say limit reached.
16. **Approved contact target: private parties, validated destinations.** One
    optional contact per user: sms/whatsapp/signal/messenger/instagram/chosen email.
    Another user's value/link requires approved request + caller party + both
    parties active in that request cache in one SQL statement. Shared different
    caches, admins and retained history after membership loss do not grant it.
    Server validates by kind and builds only the specified sms/wa.me/signal.me/
    m.me/instagram.com/mailto destinations; never trust a supplied URL or scheme.
    Keep contacts off public/admin/outbox/push/log payloads. Owner preview, platform
    icon and accessible Message button; nudge when missing. Optional approval
    message starts empty, never prefilled. No chat, email relay or SMS auth/service.
17. **Owner setup is not authorization or release approval.** Turnstile email-send/
    cache-create protection needs Worker siteverify; Google linking requires
    verified email through Better Auth; Apple remains deferred. LOCAL_DEV_AUTH may
    accept Siteverify-confirmed testing-key verdicts only on loopback; never set it
    in Wrangler config. Future `/admin` and all backing APIs require Access + Worker-verified JWT + current allowlisted
    app user ID, including alternate-host calls; fail closed, no privacy bypass.
    Suspension must be enforced server-side. Tips stay hidden until configured:
    hosted link only, no webhooks/app records/unlocks. Provisioning, secrets, Bot
    Fight Mode and provider setup remain separately owner-approved. Final parity/
    cleanup → independent security review → explicit revision/environment release
    approval gates must run again when a deferred setup feature later ships.

### Architecture changes from PR #29

PR #29's Owner DO model is superseded, not implemented by this spec. Its product
decisions remain: one owner/item, many cache attachments, one stock count, manual
Lent out and private owner-scoped photos. D1 guarded SQL/batches replace local DO
transactions, target registration, eventual revocation, projections and alarms.
Legacy Postgres RLS/schema/pooling rules remain on the legacy service only; do not
weaken them while Fly/Supabase is live.

## Conventions

- Plain TypeScript Worker dispatch, no router library or ORM; no target DO RPC.
  Cache context includes `/api/caches/{cacheId}`. Private library routes use the
  authenticated caller, never a body-supplied owner. IDs never grant permission.
- Hand-written bound SQL. Global D1 queries and their authorization/stock guards
  stay in auditable domain modules under `src/db/`, with a stable index export.
  Keep each guarded statement and token-gated atomic batch together; no interactive
  JS transactions or SQL changes(). R2/Queue are outside D1 atomicity. A no-op
  primary write must make all dependent writes no-op.
- UUID app keys; Better Auth user.id is the app identity (`generateId: 'uuid'`).
  App timestamps are integer Unix milliseconds; auth columns follow its reviewed
  generated schema. SQLite booleans have 0/1 checks; nullable columns are explicit.
  Auth schema changes are hand-written Wrangler migrations derived from pinned
  generator output, never public DDL. Preserve quantity/status/decided_at checks.
- No new dependency without a reason that survives "does the runtime or an
  installed dependency already do this?" Target allowlist: `wrangler` (tooling and
  bindings/types), exact `better-auth@1.7.7` (Worker auth/session library/client,
  native D1 support), Vitest + `@cloudflare/vitest-plugin` (local runtime tests),
  `@block65/webcrypto-web-push@2.0.0` (local crypto proof; live provider proof pending).
  No kysely-d1 is needed. New pins must have been published at least seven days ago;
  1.7.7 was published 2026-09-30, checked 2026-10-08. Keep React/TypeScript/Vite,
  React Router, TanStack Query and Tailwind. No Resend SDK. Better Auth needs
  nodejs_compat for AsyncLocalStorage. Deprecated vitest-pool-workers is not used.
- Approved cozy theme follows round-6 mocks: boxes on Home, houses in a cache;
  sunny/evening via prefers-color-scheme, reduced-motion respected, decorative
  strip aria-hidden with accessible lists/controls intact. Open-box-with-cat mark
  keeps the Home accessible name; SVG/32px favicon, 180px apple touch and 192/512
  maskable manifest assets. No per-plan theme UI.
- `ponytail:` comments name intentional ceilings and upgrade paths. Comments
  explain constraints the code cannot show, not what the next line does.
- Keep code readable cold: straight-line functions, guard clauses, no abstractions,
  interfaces or harnesses ahead of a demonstrated need. Deleting complexity wins.
- Non-trivial logic leaves a runnable check. Concurrency/constraints/migrations
  use real local D1, never mocked SQL. External HTTP providers are mocked.
- Private push egress guarantees, free-plan viability, read replication/Sessions
  API fit and throughput numbers stay UNVERIFIED until supported by evidence.

## Commands

Existing Worker tooling validates current code; the D1 target tests land with each
port PR. This docs PR changes no tooling, config, migrations or application code.

```bash
npx --no-install tsc --noEmit              # Worker typecheck
npx --no-install vitest run               # whole local runtime suite
(cd web && npx --no-install tsc --noEmit && npm run build)
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
npm run dev                              # local bindings; never --remote for tests
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run
```

No production test bindings. D1 tests use `readD1Migrations` + `applyD1Migrations`
in setup through `@cloudflare/vitest-plugin`. Target tests need no DO helpers;
current cache-local tests keep their helpers until retirement. Store local secrets
in gitignored `.dev.vars`; no values on argv/in git. See build-guide for full gates.

## Current state

Current Cloudflare code stores membership/items/requests in Cache DOs and copies
Home discovery into D1; this is the implementation to port, not target permission.
PR #29's merged Owner DO spec is superseded by this single-D1 spec. Do not continue
the paused Owner implementation or add an Owner namespace. Draft #28's cache
fan-out library is superseded by the direct-D1 library in D1 PR 6.

**Next: D1 PRs 2–7**, following [build-guide status](docs/build-guide.md#status).
PR 7 retires Cache DOs with an explicitly approved destructive `deleted_classes`
migration and staging test-data reset. This spec performs neither operation.
Legacy Go/Fly/Supabase code and deployment files were removed from this repo;
they remain in git history. The external Fly app and Supabase remain live until
separately approved cutover and decommissioning. Go PRs #2/#3 are historical
references, not Cloudflare ports. Legacy migration maps
verified-email identities into Better Auth and imports caches, memberships, items,
attachments and requests straight into D1, rewriting outbox/photo identity
references. Equal titles never imply item identity; old sessions do not transfer.
No resource/config/secret/decommissioning changes in this spec PR.
