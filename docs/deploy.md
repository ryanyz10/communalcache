# Deploying the Cloudflare stack

Target runbook for **one Worker/SPA + ONE D1 database + private R2 + notification
Queue/Cron**, with Cron also draining durable R2 cleanup intents. No Cache/Owner
Durable Objects or discovery/projection sync in the target. PR #29's Owner model
is superseded; its shared-item/Lent out/private-photo product decisions remain.

**This docs-only PR changes no code, bindings, config, packages or migrations and
runs no Cloudflare commands.** Current Cache DO deployment configuration remains
until D1 PR 7. Deleting the class and resetting staging each require explicit
approval; neither is implied by the architecture decision. Legacy Fly/Supabase
stays live until separately approved cutover/decommissioning.

## Target versus current deployment

| Target | Current configuration / transition |
| --- | --- |
| DB: canonical caches, memberships, items, attachments, stock, requests, auth, outbox/push | Current DB holds auth/discovery/outbox; Cache DOs still hold cache-local app rows. Port by D1 PRs 2–6, not dual-writing stock. |
| Private BUCKET: ownerId/itemId/uploadUUID photos | Current cache-key photos need approved mapping/reset; never become public. |
| NOTIFICATIONS Queue and bounded outbox Cron | Keep claims/retry/terminal policy; producers insert outbox atomically with state, not DO pending_sync. |
| Durable r2_cleanup + bounded Cron | Replace DO R2 intents; external R2 is not in the D1 transaction. |
| No Cache/Owner classes, alarms or registry sweeps | Retire Cache in PR 7 via approved deleted_classes migration; never add the superseded Owner namespace. |

Current wrangler.jsonc commits the approved production D1 communalcache ID
b4257b89-22d6-40f1-b250-ccd1985bf1d1, CACHES/Cache SQLite binding and ASSETS web/dist.
Compatibility date 2026-09-30 and nodejs_compat are unchanged by this spec. Current
five-minute Cron still runs registry/outbox work; target removes registry work and
adds bounded cleanup. No trigger/resource success is inferred from a config entry.

Better Auth runs in the Worker with D1 sessions and link-only primary mail plus
explicit code-only fallback; auth awaits Resend independently of Queue-delivered
notifications. No target Supabase, SMTP, DATABASE_URL or browser storage credential.
Remote migrations/deploy/provider/resource/secret operations require approval.

## Local checks first

No account is needed for local invariant tests. Gitignored .dev.vars, local test
bindings and disabled legacy .env fallback; never wrangler dev --remote for tests.
Example implementation gates (**not Cloudflare commands run by this docs PR**):

```bash
npx --no-install tsc --noEmit
npx --no-install vitest run
(cd web && npx --no-install tsc --noEmit && npm run build)
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run -e staging
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run -e production
npm run dev
```

Empty/upgrade D1 migrations, real concurrent SQL races and injected batch rollback
are feature gates. Target harness uses @cloudflare/vitest-plugin,
readD1Migrations/applyD1Migrations; no target DO helpers. Existing DO suite proves
current code only until ported. Smoke health/config, SPA deep links and JSON API
errors. A dry-run validates bundle/bindings, not live deploy/data/provider success.

## Pipeline

Existing pipeline configuration is unchanged by this spec. Personal Cloudflare
account be6051e1d082f9e206faca4c784d43e5, public SHA-pinned actions, committed npm
lockfiles/Wrangler; no organization workflows/registry/secrets. Review privileged
workflow edits separately. Finish approved setup before enabling releases.

| Workflow | Trigger and gate | Target |
| --- | --- | --- |
| ci.yml / CI | Every PR regardless of base; master/production push; reusable workflow_call | Local tests/build and default/staging/production dry-runs; no provider secrets |
| main.yml / Staging | Successful CI for a repository master push, never PR CI | Resolve eligible current master SHA, checkout/build, migrate staging D1, deploy staging |
| production.yml / Production | production push with its reusable CI job passed | Checkout promoted SHA, build, migrate production D1, deploy production |

Staging: https://communalcache-staging.ryanyz10-be6.workers.dev, D1
communalcache-staging (480fe3bd-a463-456d-8dfb-bc80235a5486).
Production: https://communalcache.com, D1
communalcache (b4257b89-22d6-40f1-b250-ccd1985bf1d1); production workers.dev/version
preview URLs disabled. Each environment has distinct Worker/bindings/secrets.
Current self-bound Cache namespaces remain until approved retirement; target needs
only D1/R2/Queue/assets and Cron. R2/Queue config is not proof of provisioning.

Deploy jobs serialize per environment, cancel-in-progress false; a running
migration/deploy is not interrupted by a newer push. GitHub keeps only one pending
run per concurrency group, so late older CI can replace a newer pending staging
run. Staging resolves current master **when its job starts**, before build:

- Current tip equals triggering SHA: that successful push CI is its gate.
- Otherwise query latest CI for the current SHA/repository/master/push event;
  deploy current tip only after completed success. Queued/running/waiting or
  failed/cancelled/missing CI skips; eventual successful push CI retriggers staging.
  API failures fail resolution rather than guessing eligibility.
- Only eligible resolved SHA is checked out/built/migrated/deployed. Skips do none
  of those. Read-only contents/actions permissions, no persisted checkout token.
  Master may advance mid-build; later jobs converge on latest CI-passed tip,
  not necessarily every intermediate commit. Production retains stale-head check.

Migration failure prevents deploy; deploy failure does not undo applied migrations.
Keep additive/backward-compatible schemas while old Workers may run. No artifact
from untrusted PR CI is deployed. A docs merge still uses the existing approved
pipeline policy; opening the PR performs no release.

### One-time setup and approval boundaries

1. GitHub Actions/default master; staging and production Environments limited to
   master and production branches. Optional production required reviewers depend
   on repository plan. Protect master CI checks, production against force/deletion,
   and promotion permissions. Do not require a second PR onto production for the
   selected fast-forward flow.
2. Each Environment has a personal-account-scoped CLOUDFLARE_API_TOKEN for needed
   Worker/Cron/D1 and current DO deployment capabilities; production custom-domain
   route needs approved domain/zone permission. No organization token/Global API
   Key. GH_TOKEN is automatic read-only Actions token for resolution/head checks,
   not another provisioned secret. Retire unnecessary DO capabilities after PR 7.
3. Runtime secrets separately approved per Worker/environment: BETTER_AUTH_SECRET,
   RESEND_API_KEY, VAPID_PRIVATE_KEY. Staging auth/VAPID secrets are independent,
   never production copies. Interactive prompts only, no values on argv/in git/logs.
   Bootstrap can create a Worker, so approval/setup precedes first deploy.
4. Verify exact Worker/D1 identities and URLs, private R2/Queue configuration,
   sender-domain verification and public variables. Production communalcache.com
   routing may replace legacy routing and needs explicit cutover approval. Do not
   decommission Fly/Supabase while enabling Actions.
5. Merge only after setup/CI approval; verify post-merge staging logs and smoke
   before promotion. workflow_run must exist on default branch. Local dry-runs are
   not remote migration/provider proof. DO deletion/staging reset is a separate,
   explicitly destructive approval, not normal setup.

### Promote and roll back

After reviewing successful staging and receiving release approval, fast-forward
promotion is the existing user-selected flow:

```bash
git fetch origin
git switch master
git pull --ff-only origin master
git push origin master:production
```

Divergence is an error to investigate, not permission for force push. Production's
reusable CI gates its migration/deploy; standalone push CI duplication is
intentional, and staging ignores production CI events.

Prefer compatible fix-forward or revert **as a new master commit**, staging
CI/deploy/smoke then the same promotion. No reset/force production. Worker rollback
does not undo D1 migrations or restore deleted DO data. Incompatible recovery or
export/restore requires separate approval and known outbox/cleanup replay effects.

### Environment inheritance and DO retirement

Current config facts with pinned Wrangler 4.145.0: vars, d1_databases and
current durable_objects.bindings are not inherited and are repeated per named
environment. assets and DO migrations **are inherited**; append shared migration
history rather than duplicating/replacing v1. Self-bindings without script_name
attach to each distinct Worker. Cron triggers inherit in this version but are
explicit per environment. CI checks default/staging/production independently.
Auth URLs must equal each environment's exact origin; secrets stay independent.

Target PR 7 removes active DO bindings/class usage and appends **deleted_classes**
for Cache in that class history. **This destroys Durable Object data. Get explicit
human approval for each intended environment before applying/deploying it.** See
[Cloudflare class migration reference](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/index.md).
Do not rewrite applied history, rename into a new empty namespace or assume code
rollback restores DOs. Never add Owner DOs from the superseded spec.

Staging test-data reset needs its own explicit approval: inventory target D1/DO/
R2/outbox/push state, record backup/recovery procedure and exact scope, reconcile or
reset approved test data and prove the direct-D1 app afterward. No new-stack
production data exists yet; reset is not authority to touch legacy production.
No such command/config/migration/data operation runs in this docs PR.

Existing action pins (resolved 2026-10-14) remain: checkout v7.0.1
3d3c42e5aac5ba805825da76410c181273ba90b1 (2026-07-20), setup-node v7.0.0
820762786026740c76f36085b0efc47a31fe5020 (2026-07-14); newer v7.1.0 was <7 days old.
Actions Node 24-capable hosted runner; app/tooling Node 22.23.1 locally validated.
No version/tooling/config change in this spec.

## Provider and secret setup (approval required)

### Cloudflare / private photos / Queue

- Confirm personal account/environment and approved intended URL. One canonical
  D1 database **per environment**, not one shared between staging/production.
  Configure private R2 and notification Queue only after explicit approval.
- Serve web/dist as assets; /api/* executes Worker before SPA fallback, API errors
  remain JSON. nodejs_compat serves Better Auth AsyncLocalStorage, not a router.
- R2 public domain/r2.dev off; authorized D1 membership/attachment/owner checks then
  private/no-store stream. Immutable ownerId/itemId/uploadUUID; no signed URL or
  browser storage key. Detach/removal never deletes shared photo. Owner finalization
  rechecks state after R2 I/O; record replaced/rejected/exact/prefix cleanup in D1.
- Queue NOTIFICATIONS uses communalcache-notifications-staging and
  communalcache-notifications for production/default. Current initial consumer
  settings: three sequential rows/batch, six retries, 60s retry delay, concurrency
  two. Confirm approved resources/settings before live proof.
- Target five-minute Cron runs outbox rescue and R2 cleanup, **not** registry/DO
  flush. Outbox initial rescue 25 rows older than three minutes, cursor-paged;
  claims absent/expired, unsent/unfailed, regardless of attempts. Cleanup also uses
  guarded expiring claims/bounded pages, preserving work until external success.
  Verify combined budgets, fair progress and injected failure recovery in PR 3–5.
- Free quotas are independent ceilings, not guaranteed fit: D1 rows/storage/query
  limits, Worker CPU, Queue operations/retention and R2 operations. Paid upgrade,
  resource/plan changes and remote diagnostics need approval.

### Better Auth / Resend

Pin better-auth@1.7.7 native database: env.DB, no kysely-d1. Retain reviewed auth
schema/0003 OTP workaround and nullable app display_name. Production
BETTER_AUTH_URL=APP_BASE_URL=https://communalcache.com; explicit BETTER_AUTH_SECRET,
exact trustedOrigins, host-only HttpOnly/Secure/SameSite=Lax cookies, no cookie
cache/secondary storage. App mutations independently reject missing/null/foreign
Origin. Profile gate exempts auth, PATCH /api/me and push. No other-user email,
password/admin/raw OTP/public migration endpoints.

Magic links: hashed 300s atomic first use; link-only primary email, explicit
separate OTP fallback (six digits/300s/three attempts/hashed/rotate). Fragment
/auth/link#token=... landing captures/removes fragment with no-referrer/no-store;
scanner GET consumes nothing, Continue POST verifies. Public verify GET denied;
internal plugin HTTP-handler GET adaptation preserves D1 5/60s limits, no auth.api
bypass. Exact-origin normalized callbacks reject protocol-relative/userinfo/foreign
URLs. Resending creates independent outstanding links, not latest-link-only rotation.
Invites stay in tab sessionStorage; new browser verifies without that state and
must reopen invite. SMS deferred. Preserve concurrent challenge/rate-limit tests.

Auth sends await bounded Resend fetch, independent of notification Queue; callback
failure maps per-request generic JSON 502 without hiding rate-limit responses.
Approve sender/domain DNS verification and EMAIL_FROM. Current sender is
signin@send.communalcache.com on verified send.communalcache.com; domain ownership
alone is not verification. Auth success does not prove notification delivery.
No legacy Supabase Auth/SMTP/provider settings change with this target.

### Web push

@block65/webcrypto-web-push@2.0.0 retained after local RFC 8291/VAPID proof. Separate
per-environment P-256 key pair; private JWK d in VAPID_PRIVATE_KEY Worker secret,
matching 65-byte uncompressed public point as VAPID_PUBLIC_KEY runtime config.
App origin is VAPID subject/contact. Rotation requires browser disable/re-enable.
Existing approved staging private-key provisioning and public config do not prove
provider/browser delivery; default/production key provisioning requires approval.
Never expose/log/generate secret values as part of a docs change.

Strict service origins (fcm.googleapis.com, updates.push.services.mozilla.com,
web.push.apple.com, boundary-checked .notify.windows.com subdomains), HTTPS/default
443/no userinfo/manual redirects, policy checked at subscribe/send. Complete
private-IP/DNS-rebinding blocking is UNVERIFIED. Structural push→email choice,
endpoint account reassignment, caller-scoped logout, rotating registration ID and
stale 410 cleanup remain. Gesture permission and installed iOS behavior/icon/live
push/production CPU require separately approved proof.

### Public values and secret handling

Public: APP_BASE_URL, BETTER_AUTH_URL, VAPID_PUBLIC_KEY, EMAIL_FROM; /api/config
exposes only intended public fields. Secrets: BETTER_AUTH_SECRET, RESEND_API_KEY,
VAPID_PRIVATE_KEY, explicitly passed as Worker bindings. No target DATABASE_URL,
Supabase credential, browser R2 credential or provider anon key. Never put secret
values on argv, in git, screenshots or logs. Approved operator secret updates use
interactive Wrangler prompts and explicit named environment, not guessed login.

## Approved release sequence

1. Record environment/revision/approval scope; confirm schema/backward compatibility,
   auth/CSRF/OTP/link/rate-limit proof, real D1 authorization/stock/destructive race
   tests, quotas and durable outbox/cleanup recovery. Keep unsafe old routes gated.
2. Build assets/Worker and inspect all dry-run configs; no remote effect yet.
3. Apply **approved** D1 migrations to explicit intended database; never infer
   production permission from local success. No lazy DO constructor migration in
   target. During transition do not discard old DO data without PR 7 approval.
4. Deploy approved Worker/assets. Class deletion is separately approved destructive
   work; inventory/reset receipts are prerequisites, not an incidental deploy flag.
5. Smoke below and inspect oldest outbox/cleanup work, claims/terminal failures,
   query latency/rows/CPU. Healthz alone is not evidence delivery is functioning.

## Manual smoke and observability

After explicit approval, record revision/environment/browser/provider receipts:

- Runtime public-only config; API failures JSON; cookies/Origin/profile exemptions,
  caller-only session/email, disabled password/admin and D1 multi-instance limits.
- Real Resend magic-link-only mail → scanner-safe landing → Continue/session,
  replay/expiry/callback rejection, same-tab invite resume and fresh-browser mobile
  handoff; explicit code-only fallback still works. Auth failure visible.
- Cache creation immediately appears in canonical Home; non-member/pending/removed
  cache/item/photo access 404; valid-secret removed join 403. Rotation racing join
  does not accept old secret. No stale discovery table can grant anything.
- One library item attached to two caches has one stock count; concurrent requests
  cannot overbook, double approval deducts once; Lent out blocks new requests but
  keeps pending, reusable checkbox atomic. Private library survives cache removal.
- Removal/detach/delete includes affected pending requests/recipient snapshots in
  its batch; next statement checks removed membership immediately. No sync wait.
- Owner photo upload/finalization/private stream and idempotent cleanup retry;
  no public bucket; known orphan coverage/remaining window documented honestly.
- Queue notification email/push (auth mail does not prove this); installed iOS
  gesture permission/live push. Enqueue gap/expired claims/Cron rescue and R2
  cleanup recover without DO alarms. Compatible Worker update/fix-forward drill.

### Backlog and budget triage

Track Worker CPU/resource errors, D1 query duration/rows read/written/database size,
Queue retry/backlog/retention, terminal outbox failure counts and oldest nonterminal
outbox/cleanup age. Single primary round trips and query serialization can affect
distant users/long queries; no specific workload throughput number is VERIFIED.
Free D1: 100k rows written/day, 5M read/day, 500 MB/database, 50 queries/invocation.
Auth/counters/index maintenance/outbox/cleanup share those ceilings. Worker Free
HTTP CPU 10ms; Queue 10k operations/day, 24h retention; typical write/read/delete
three operations/message. See [sourced facts](plan.md#verified-platform-facts).

Read-only **target** diagnostics (remote reads still require explicit approval):

```sql
SELECT COUNT(*) AS pending, MIN(created_at) AS oldest_pending_at
FROM outbox WHERE sent_at IS NULL AND failed_at IS NULL;
SELECT COUNT(*) AS expired_claims FROM outbox
WHERE sent_at IS NULL AND failed_at IS NULL
  AND claim_until IS NOT NULL AND claim_until <= unixepoch() * 1000;
SELECT kind, COUNT(*) AS terminal_failures FROM outbox
WHERE failed_at IS NOT NULL GROUP BY kind;
SELECT COUNT(*) AS cleanup_pending, MIN(created_at) AS oldest_cleanup_at
FROM r2_cleanup;
SELECT route, COUNT(*) AS active_counters, SUM(count) AS admitted_attempts
FROM write_limits WHERE window_start >= unixepoch() * 1000 - 60000 GROUP BY route;
```

Never dump outbox payloads/auth rows/push credentials, emails, invite secrets,
tokens or cookies. Current-minute write counters are not historical usage meters;
track rejected 429s separately. Existing notification_delivery_failed logs only ID,
claim attempts and terminal outcome, not provider/recipient payload. Target cleanup
telemetry must be similarly secret-free. Current cache_sync_failed logging is
historical and retires with DO sync, not a target alert/recovery dependency.

Initial alerts (tune to measured workload): CPU/resource ceiling pressure, rising
D1 query latency/rows/storage, new terminal outbox failures, Queue age/retries,
oldest nonterminal outbox >15 minutes, growing cleanup age. Cursor page 25 every
five minutes is bounded progress, not an immediate whole-database sweep guarantee.
Read replication/Sessions API fit remains UNVERIFIED for our authorization and
read-after-write needs; regional sharding requires a new ownership/stock boundary.
A future per-cache DO could fan out live WebSockets, not own canonical data.

Recovery: verify approved bindings/provider dependencies, restore availability,
let Queue/Cron replay durable IDs/claims/cleanup, confirm backlog age falls.
Attempts never bound outbox eligibility; terminal failed_at needs separately
approved explicit replay/repair. Do not delete intents, clear claims/counters/
terminal flags or recreate storage to make metrics healthy. Provider acceptance
before terminal recording can duplicate sends; Resend idempotency headers remain
disabled without a verified contract. Failed cleanup persists until success, not a
finite hidden retry cutoff. Production export/restore needs approval.

## Legacy cutover (separate approval)

Inventory verified Supabase emails; match/insert Better Auth users and preserve
display names. Import caches, memberships, canonical items, item_caches and
requests **straight into D1**, rewriting owner/requester/user IDs and outbox/photo
references. Re-key private photos ownerId/itemId/uploadUUID. Approve ambiguous
identities/duplicate-item mapping; equal titles are not identity. Never link an
unverified email or transfer old sessions/JWTs. Reconcile stock/ownership/status,
photos, outbox/cleanup and notification recovery at a controlled write boundary.

Keep Fly/Supabase live until separately approved cutover, then obtain separate
decommissioning approval. No automatic dual write, teardown, provider change,
legacy migration or staging reset in this spec PR. Code rollback does not undo
D1 migration or restore deleted DO data; use compatible fix-forward/revert or an
explicitly approved recovery plan.
