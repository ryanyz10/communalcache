# Deploying the Cloudflare stack

Target runbook for **one Worker/SPA + ONE D1 database + private R2 + notification
Queue/Cron**, with Cron also draining durable R2 cleanup intents. No Cache/Owner
Durable Objects or discovery/projection sync in the target. PR #29's Owner model
is superseded; its shared-item/Lent out/private-photo product decisions remain.

**Draft PR 7 warning: merging deploys a `deleted_classes` migration that
permanently deletes all Cache DO data on staging (and later production). Explicit
owner approval is required. Do not merge or mark ready without it.** The staging
test-data reset is **not included** and needs separate approval. This work prepares
code/config/migrations and runs local tests/dry-runs only; no remote migration,
class deletion, resource operation or reset has run. Legacy Fly/Supabase stays live
until separately approved cutover/decommissioning.

## Prepared code versus deployed state

| Target | Current configuration / transition |
| --- | --- |
| DB: canonical caches, memberships, items, attachments, stock, requests, auth, outbox/push | All app routes use guarded D1 after PRs 2–6. Draft migration 0011 drops only unused my_caches/cache_sync_cursor; no canonical-data reset. |
| Private BUCKET: ownerId/itemId/uploadUUID photos | Owner-scoped photo/cleanup code is implemented. Historical cache-key bytes are not deleted by this PR and need approved disposition separately. |
| NOTIFICATIONS Queue and bounded outbox Cron | Keep claims/retry/terminal policy; producers insert outbox atomically with state, not DO pending_sync. |
| Durable r2_cleanup + bounded Cron | Implemented independent guarded cleanup; external R2 is not in the D1 transaction. |
| No Cache/Owner classes, alarms or registry sweeps | Draft PR 7 removes code/bindings and appends v2-retire-cache; no class deletion has been deployed. Never add the superseded Owner namespace. |

Prepared wrangler.jsonc retains the approved production D1 communalcache ID
b4257b89-22d6-40f1-b250-ccd1985bf1d1 and ASSETS web/dist. It removes all active object
bindings while retaining v1 history and appending `v2-retire-cache` for `Cache`.
Compatibility date 2026-09-30 and nodejs_compat are unchanged. The five-minute Cron
runs only outbox rescue and R2 cleanup, independently; no registry work remains.
Config/local checks are not evidence of applied migration or live resource state.

Better Auth runs in the Worker with D1 sessions and link-only primary mail plus
explicit code-only fallback; auth awaits Resend independently of Queue-delivered
notifications. No target Supabase, SMTP, DATABASE_URL or browser storage credential.
Remote migrations/deploy/provider/resource/secret operations require approval.

## Local checks first

No account is needed for local invariant tests. Gitignored .dev.vars, local test
bindings and disabled legacy .env fallback; never wrangler dev --remote for tests.
Local gates (dry-run validates bundles only, never authorizes deletion/deploy):

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
readD1Migrations/applyD1Migrations; no object binding/helpers. The suite proves
canonical D1 behavior and populated retirement upgrade preservation, not remote
class deletion. Smoke health/config, SPA deep links and JSON API
errors. A dry-run validates bundle/bindings, not live deploy/data/provider success.

## Pipeline

Release pipeline behavior is unchanged by this retirement draft. Personal Cloudflare
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
Previously deployed self-bound Cache namespaces remain until an approved deploy
applies the inherited class deletion. Prepared code needs only D1/R2/Queue/assets
and Cron. R2/Queue config is not proof of provisioning.

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
pipeline policy; opening the draft PR performs no release. **Merging this draft
would make the successful master-push staging job apply the destructive class
deletion. Draft status is a review warning, not a technical deployment gate.**

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

With pinned Wrangler 4.145.0, vars and d1_databases are non-inherited and stay
explicit per named environment. Assets and class migrations **are inherited**.
Draft PR 7 removes the active binding blocks from default/staging/production and
preserves/appends shared history:

```json
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["Cache"] },
  { "tag": "v2-retire-cache", "deleted_classes": ["Cache"] }
]
```

The class is actually named `Cache`; it is no longer exported in prepared code.
No superseded Owner namespace is introduced. Cron stays explicit per environment;
CI dry-runs all three. Auth origins/secrets remain environment-specific.

**Deploying v2-retire-cache permanently deletes the Cache namespace's data in the
selected environment. Explicit owner approval is required before merge/deploy.**
The default/production config shares the production resource identity; a default
remote deploy is destructive too. No remote command or class deletion has run.
Keep applied history; code rollback cannot restore deleted data.
[Cloudflare class lifecycle reference](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
still supports the legacy migrations flow used by this pinned configuration;
this PR does not switch to the newer exports flow.

Staging test-data reset needs its own explicit approval: inventory target D1/DO/
R2/outbox/push state, record backup/recovery procedure and exact scope, reconcile or
reset approved test data and prove the direct-D1 app afterward. No new-stack
production data exists yet; reset is not authority to touch legacy production.
This draft includes the reviewed deletion config and D1 table-drop migration,
but no reset or remote operation. Before approval, inventory existing Cache
namespaces, any undelivered legacy intents, D1/outbox/push and private R2 bytes;
record backup/recovery and explicit keep/export/discard decisions. Do not discard
legacy work just because the new D1 producer is active.

Migration 0011 preserves canonical state and drops only obsolete discovery/cursor
tables. The pipeline migrates D1 before deploying the Worker. A previous Worker
may briefly report a scheduled registry error during that gap; its independent
outbox and cleanup recovery still run. Reverting to code that requires the dropped
tables is not a compatible rollback. Prefer fix-forward; restoring any schema/data
requires an approved recovery plan.

Existing action pins (resolved 2026-10-14) remain: checkout v7.0.1
3d3c42e5aac5ba805825da76410c181273ba90b1 (2026-07-20), setup-node v7.0.0
820762786026740c76f36085b0efc47a31fe5020 (2026-07-14); newer v7.1.0 was <7 days old.
Actions Node 24-capable hosted runner; app/tooling Node 22.23.1 locally validated.
No dependency or workflow release-policy change is included in this draft.

## Manual plan assignment (owner-run)

Migration **0012_plan_limits** adds `plan` to app user/cache rows (free default,
free/plus CHECK) and seeds one `plan_limits` table. Free values are owned_caches 1,
new_caches_per_day 2, member_caches 20, cache_members 30, owned_items 100,
open_requests 20, photos_per_item 1 and profile_photos 1. Plus keeps owned_caches 3 and
cache_members 100; every other value intentionally equals free until the owner
decides otherwise. Migration 0013's profile-photo endpoint now consumes the
profile_photos allowance in its guarded finalization.
There is no plan UI, upgrade flow, billing or automatic assignment job.

**No remote plan command is run by this feature PR.** The owner must approve each
exact environment/database, cache/user UUID, previous plan and target plan before
an operator acts. Use named staging or production configuration, never assume
production permission from local tests. Check that migration 0012 is applied and
the target policy row exists. Public signup/profile/cache writes cannot assign a
plan. Do not change plan_limits globally as a shortcut for a one-user/cache grant.

Templates below require replacing the quoted placeholders with the **approved**
values, validating UUIDs and allowing only free/plus (no browser-supplied SQL).
Run only the selected target's commands, not both targets automatically:

```bash
# Preflight: capture only ID/plan and the approved target policy, never auth email.
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 execute '<approved_database>' --env '<approved_environment>' --remote --command "SELECT id,plan FROM caches WHERE id='<approved_cache_uuid>'; SELECT plan FROM plan_limits WHERE plan='<approved_target_plan>';"
# Guard against a changed preflight value; expect exactly one UPDATE change.
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 execute '<approved_database>' --env '<approved_environment>' --remote --command "UPDATE caches SET plan='<approved_target_plan>' WHERE id='<approved_cache_uuid>' AND plan='<approved_previous_plan>' AND EXISTS(SELECT 1 FROM plan_limits WHERE plan='<approved_target_plan>'); SELECT id,plan FROM caches WHERE id='<approved_cache_uuid>';"

# User target instead, with the same explicit approval/read-back requirements.
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 execute '<approved_database>' --env '<approved_environment>' --remote --command "SELECT id,plan FROM user WHERE id='<approved_user_uuid>'; SELECT plan FROM plan_limits WHERE plan='<approved_target_plan>';"
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 execute '<approved_database>' --env '<approved_environment>' --remote --command "UPDATE user SET plan='<approved_target_plan>' WHERE id='<approved_user_uuid>' AND plan='<approved_previous_plan>' AND EXISTS(SELECT 1 FROM plan_limits WHERE plan='<approved_target_plan>'); SELECT id,plan FROM user WHERE id='<approved_user_uuid>';"
```

If preflight returns no target/policy row or UPDATE changes zero rows, stop and
investigate; do not broaden the WHERE or silently retry a stale assignment.
Record operator approval, revision/environment, target ID and old/new plans.
Reversal uses the same guarded template with approved old/new values swapped;
a downgrade does **not** delete/detach canonical data or cancel admitted work.
Cache plan controls member capacity; personal plus does not change owned caches' plans.

Limits are checked in canonical guarded writes: cache create, open join/gated
approval/left rejoin, item create (including create-and-attach), request create
and item-photo finalization. Pending joins count neither membership cap and
reserve no seat; approval rechecks cache and applicant plans atomically. Existing
active/pending replays and rejection are not blocked by a downgrade. Daily usage
counts owned canonical caches with created_at strictly newer than now minus 24h;
exactly 24h old expires. No cache-delete endpoint currently erases that history.
Photo replacement uses one current pointer; allowance is rechecked after R2 I/O
and a rejected upload retains durable cleanup. Profile-photo finalization applies
the same rule with its own current pointer; remove is allowed at quota zero.
Missing plan policy denies writes, never grants unlimited
capacity. API quota failures are 409 limit_reached plus a stable limit name.

Migration 0012 is additive and preserves existing over-cap rows; only growth is
blocked. An old Worker does not enforce the new quotas during the migration/
deployment overlap. Release enforcement proof must use the new revision after
rollout (with an approved write boundary if strict activation timing is needed).
No code rollback restores deleted DO data from the inherited retirement draft.

## Profile-photo rollout and smoke

Migration 0013 adds app-owned user_photos plus explicit cleanup scope (item default;
profile requires item_id=NULL and exact-key kind). Cleanup rebuild preserves old
IDs/targets/timestamps/claims; no binding, bucket exposure or provider setup is
added. Existing item writers remain compatible. An older cleanup Worker may
reject profile-scoped work as invalid during rollout; it retains the intent for
the new Cron instead of deleting a user prefix. Do not interpret that transient
backlog as permission to erase cleanup work or bypass scope validation.

`GET/POST/DELETE /api/me/photo` is self-only for mutations. The read route
`GET /api/users/{userId}/photo` streams only for self or a currently shared active
cache. The SQL check precedes private R2 access, with private/no-store and nosniff
headers. Named views include only nullable version flags under the same predicate,
never raw keys or another user's email. A historical request alone is insufficient;
losing the last shared cache denies the next photo request, not an already
completed/in-flight authorized read.

After explicit deployment approval, smoke Account Change photo → choose → save,
replace and remove; initials on no/missing image, header/member/item/request
avatars, a second active-cache sharer, non-sharer/pending/left/removed 404 and
survival through another shared cache. Verify quota-zero rejection after R2 I/O,
known cleanup retry and one current photo under replacement. Local D1/R2 tests
prove those guards/atomic effects; browser upload success is not claimed when the
host/container file transport cannot deliver a readable file. No theme change,
remote command or live profile-photo rollout is run by this PR.

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
Invites carry a strict relative join callback in the fragment email link, with
one-hour session/localStorage intent fallback for same-browser tabs. Continue
remains explicit; a new browser can resume the callback without stored state.
Home's paste-invite sheet extracts only a valid local join path. Clear intent on
join/cancel/sign-out/expiry. SMS deferred; retain challenge/rate-limit tests.

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
telemetry uses only cleanup ID and backlog age. Historical cache_sync_failed
logging and registry recovery are removed; they are not target alert dependencies.

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
legacy migration or staging reset in this retirement draft. Code rollback does not undo
D1 migration or restore deleted DO data; use compatible fix-forward/revert or an
explicitly approved recovery plan.
