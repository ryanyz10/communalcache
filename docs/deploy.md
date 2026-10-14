# Deploying the Cloudflare stack

Target release runbook; Foundation supplies tooling/bindings and commits the real
ID of the approved `communalcache` D1 database. Remote migrations and deployment
have not been authorized by that resource creation. **Get explicit approval before
further account operations, provider changes, a real deploy, data migration or
decommissioning.** Existing production remains live until an approved cutover.

## What is deployed

One TypeScript module Worker, its React static assets, and an exported SQLite cache
DO class. Bindings connect global D1, cache DO namespace, private R2 and Queue
producer/consumer; a scheduled handler runs registry-sync and outbox sweeps.
Better Auth runs inside the Worker with D1 users/sessions and email OTPs. Resend
fetch serves two independent paths: sign-in codes awaited by the auth request,
and Queue-driven notification email. No target Supabase service or SMTP setup.

Foundation supplies `wrangler.jsonc`, D1 binding `DB` (database `communalcache`),
SQLite DO binding `CACHES` (class `Cache`) and `ASSETS` (`web/dist`). The approved
D1 ID `b4257b89-22d6-40f1-b250-ccd1985bf1d1` is committed in `wrangler.jsonc`;
remote migrations and deployment still need separate approval. Compatibility date
`2026-09-30` supports RPC/default error serialization; `nodejs_compat` is set.
Caches declares an intended five-minute registry Cron and its scheduled handler;
no production trigger has been installed. R2/Queue bindings remain later features,
not provisioned here.

## Local checks first

No Cloudflare account is needed for local binding tests. Use gitignored `.dev.vars`
for local values, never production bindings or `wrangler dev --remote` for tests.

```bash
npx --no-install tsc --noEmit
npx --no-install vitest run
(cd web && npx --no-install tsc --noEmit && npm run build)
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run
npm run dev
```

Copy `.dev.vars.example` to gitignored `.dev.vars`; use a fresh local-only auth
secret and identical local APP_BASE_URL/BETTER_AUTH_URL (see README). Disable
Wrangler dotenv fallback so legacy `.env` cannot supply Go/Supabase values.
The dry run validates a bundle, not a live deployment. Smoke local health/config,
SPA invite deep links and JSON API errors. Test migrations on empty D1 and older
DO versions; no Go/Docker/Postgres gate proves these Worker paths.

## Pipeline

The standalone GitHub Actions pipeline targets this personal Cloudflare account
`be6051e1d082f9e206faca4c784d43e5`. It uses public SHA-pinned actions, the committed
npm lockfiles and their Wrangler binary; no organization workflows, package
registry, organization secrets or notification infrastructure is involved. Adding
these definitions does not execute a release. Finish the setup below before the
first merge enables automatic staging deployment.

| Workflow | Trigger and gate | Target |
| --- | --- | --- |
| `ci.yml` / CI | Every pull request, regardless of base; push to `master`/`production`; reusable `workflow_call` | Local tests, build and default/staging/production dry-runs only; no provider secrets |
| `main.yml` / Staging | Successful CI completion for a **push** to this repository's `master`, never a PR CI run | Check out that CI run's `head_sha`, build, migrate staging D1, deploy staging |
| `production.yml` / Production | Push to `production`; deployment needs its own reusable CI job to pass | Check out the promoted SHA, build, migrate production D1, deploy production |

Staging is `https://communalcache-staging.ryanyz10-be6.workers.dev`, using D1
`communalcache-staging` (`480fe3bd-a463-456d-8dfb-bc80235a5486`). Production is
`https://communalcache.com`, using D1 `communalcache`
(`b4257b89-22d6-40f1-b250-ccd1985bf1d1`); production workers.dev and version preview
URLs are disabled. Each environment has its own Worker and self-bound `Cache` DO
namespace, plus an explicit five-minute registry Cron. No Queue/R2 is added here.

Both deploy jobs serialize per environment with `cancel-in-progress: false`; a
running migration/deploy is not interrupted by a newer push. GitHub can coalesce
pending runs, so this does not promise a deployment of every intermediate commit.
Immediately before migration/deploy, a read-only GitHub head check skips a
superseded master/promotion SHA; CI completion/reviewer wait order cannot otherwise
be assumed to equal commit order. A failed migration prevents the deploy command.
If deploy fails after migrations succeed, the schema remains migrated: changes
must stay backward compatible. No artifact from an untrusted PR run is consumed.

### One-time setup before the first merge

These are operator setup instructions, **not commands executed by this PR**.

1. Enable GitHub Actions for the repository with `master` as its default branch.
   In Settings → Environments, create exactly `staging` and `production`. Limit
   their deployment branches to `master` and `production`, respectively. Optional
   required reviewers on the production Environment add a second approval gate
   when supported by the repository's GitHub plan.
2. In **each Environment**, add secret `CLOUDFLARE_API_TOKEN`. Use a token scoped
   to the personal account and the required Worker/DO/Cron deployment and D1
   migration capabilities; production also needs authorization for the
   `communalcache.com` custom domain/zone. Do not use an organization token or a
   Global API Key. The account ID is plain workflow configuration, not a secret.
   `GH_TOKEN` is automatically the job's read-only GitHub token for the stale-head
   check; do not provision another GitHub secret or grant write permissions.
3. Bootstrap the two named Workers' required runtime secrets after approval.
   Staging needs its **own independently generated** `BETTER_AUTH_SECRET`; never
   reuse production's. Store values interactively, not on argv, in git or in CI
   logs. These operations may create/bootstrap a Worker if it does not yet exist,
   so complete the approved bootstrap before enabling the first deployment:

   ```bash
   # OPERATOR ONLY, after approval; each command prompts for the secret value.
   export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
   npx --no-install wrangler secret put BETTER_AUTH_SECRET -e staging
   npx --no-install wrangler secret put RESEND_API_KEY -e staging
   npx --no-install wrangler secret put BETTER_AUTH_SECRET -e production
   npx --no-install wrangler secret put RESEND_API_KEY -e production
   ```

   Resend's sender/domain must be approved and verified for actual sign-in mail;
   `EMAIL_FROM` is unchanged in both environments. `VAPID_PRIVATE_KEY` is a later
   push-feature secret, not needed by this pipeline's current application slice.
4. Protect `master` with the CI `checks` job after it appears on the first PR;
   review workflow edits as privileged release code. Protect `production` against
   force pushes/deletion and restrict who may promote. Do not require a new PR
   onto `production` if using the selected fast-forward promotion command below.
5. Confirm the two existing D1 IDs, Worker identities and staging subdomain. Before
   the **first production promotion**, separately confirm the approved
   `communalcache.com` cutover: deploying its custom-domain route can replace
   legacy routing. Do not decommission Fly/Supabase as part of enabling Actions.
6. Merge only after setup and CI are green. Verify the first post-merge master CI
   run triggers Staging, review migration/deployment logs and smoke staging before
   promoting. The workflow_run definition must be present on the default branch.
   Remote migration/deployment and live-provider success are not proved by local
   dry-runs; no such operations were run while authoring this pipeline.

### Promote and roll back

After reviewing a successful staging deployment, update local master and promote
without force; the user-selected command is:

```bash
git fetch origin
git switch master
git pull --ff-only origin master
git push origin master:production
```

A divergent production branch is an error to investigate, not permission to force
push. Production CI runs again through the reusable workflow before migration and
deploy. The standalone push CI also runs on `production`; duplication is
intentional in this shape, and staging ignores those production CI events.

For rollback, prefer a compatible fix-forward or a revert **as a new master
commit**, let staging CI/deploy complete, then promote that new commit with the
same fast-forward command. Do not reset/force-push `production`. Worker rollback
does not undo D1 migrations or DO schema upgrades; restoring data or incompatible
code requires a separate approved recovery plan.

### Wrangler environment inheritance

Top-level local configuration is unchanged; tests still explicitly use
`remoteBindings: false` and local D1/SQLite DOs. Always use the named environment
for a real pipeline deployment; a bare top-level deploy is not the release path.
`vars`, `d1_databases` and `durable_objects.bindings` are not inherited and are
repeated for both environments. The two auth URLs must match each other and the
exact environment origin. Staging and production secrets are separate too.

With pinned Wrangler 4.145.0, `assets` and DO `migrations` **are inherited**. Keep the
single top-level `v1` SQLite class migration rather than duplicating histories;
self-bindings without `script_name` attach to each distinct Worker, not to the
other environment's namespace. Cron `triggers` are also inherited in this version,
but are repeated explicitly here so each release's schedule is visible. New
migrations must append to the shared class history. All three configs receive
independent dry-run checks in CI.

Action pins were resolved from release tags on 2026-10-14: checkout v7.0.1
`3d3c42e5aac5ba805825da76410c181273ba90b1` (published 2026-07-20), setup-node v7.0.0
`820762786026740c76f36085b0efc47a31fe5020` (published 2026-07-14). Newer setup-node
v7.1.0 was under seven days old and was deliberately excluded. The actions run on
GitHub's Node 24-capable hosted runner; app/tooling steps use Node 22.23.1, the
locally validated version (no repo engine/version file is currently present).

## Approval-gated provider setup

### Cloudflare

1. Confirm account/environment and intended URL `https://communalcache.com` (the
   user owns this domain on Cloudflare). Custom-domain routing and resource
   provisioning still need approval. D1 `communalcache` was created with approval;
   provision its remaining settings, the SQLite-backed cache DO namespace/class,
   private R2 and notification Queue only after approval.
2. Bind them to the Worker. The DO can access that Worker's env bindings; those
   capabilities never appear in browser config. Use a compatibility date supporting
   RPC (`2024-04-03` or later); choose/test error serialization explicitly. Add
   nodejs_compat for Better Auth's AsyncLocalStorage; this does not add Hono.
3. Serve `web/dist` as static assets with SPA fallback, but ensure `/api/*` executes
   Worker logic first. An API 404/auth error must not turn into HTML 200.
4. Keep R2 public domain and `r2.dev` access off. Worker streams authorized photos
   with private cache headers; no public bucket, signed URL or service-role key.
5. Configure Queue producer/consumer retry delays/batch/concurrency bounds and a
   Cron Trigger for registry sync/outbox rescue. Default three Queue retries are
   insufficient as the sole recovery policy. DO alarms catch and re-arm pending
   work indefinitely; Cron repairs stuck known-cache projections and expired claims.
6. Check Free-plan budgets before choosing a plan. HTTP CPU, DO duration/storage,
   D1 rows, Queue operations/24h retention and R2 operations are separate quotas.
   R2 free allowances are not a hard zero-billing cap. Any paid upgrade needs approval.

No management API credential is required just to sweep DOs: walk the D1 cache
registry. The binding has no list method; privileged REST object listing is not
part of this application. Discovery projections never authorize access.

### Better Auth

- Pin better-auth 1.7.7 exactly (published 2026-09-30, over seven days old when
  checked 2026-10-08). Native D1 `database: env.DB`, no kysely-d1, auth under
  `/api/auth/*`; reviewed Wrangler SQL for user/session/account/verification/
  rateLimit tables and nullable app display_name, derived from pinned generator.
- Set BETTER_AUTH_URL = APP_BASE_URL = `https://communalcache.com` and provide
  BETTER_AUTH_SECRET explicitly from Worker bindings. Exact production
  trustedOrigins, host-only HttpOnly/Secure/SameSite=Lax cookies; no session cookie
  cache/secondary storage. Keep library CSRF checks; app mutations also enforce
  an exact Origin check (missing/null/foreign rejected).
- Enable only email-otp sign-in/signup, six digits/300s/three attempts, hashed
  storage and rotate-on-resend. Disable password/unused auth routes and plugins;
  never expose admin/list-users, raw tokens or a public migration endpoint.
- Database rate-limit storage, not memory; trusted Cloudflare IP header and tested
  send/resend/verify limits. App profile gate exempts auth, PATCH /api/me and push.
- Auth code delivery awaits bounded Resend fetch, independent of notification
  Queue. Better Auth 1.7.7 catches callback errors; a per-request closure result maps
  failed sends/timeouts to generic JSON 502. No callback redirect for code login:
  pending join stays in sessionStorage and returns to the same page. Foundation
  proves preservation; Feature 2 adds the actual join POST.
- Magic-link plugin is a later scanner-safe SPA Continue flow, hashed token and
  exact same-origin callbacks; combined link/code lifecycle needs proof. SMS is
  deferred, no provider account or sender provisioned.

Legacy Fly/Supabase Auth/SMTP/Postgres settings matter only to the old live app.
Leave them intact until a separately approved migration/cutover; no target Supabase
setup or auth redirect configuration is required.

### Resend

Approve and verify `communalcache.com` or its chosen sending subdomain in Resend;
use the provider's required DNS verification records and wait for verification.
`EMAIL_FROM` must use that verified domain; Resend verifies `send.communalcache.com`,
so the sender is `signin@send.communalcache.com`. Both auth codes and notification
emails use Resend HTTP, but one failing path need not imply the other is broken.
Domain ownership alone is not sending-domain verification.

## Public config vs secrets

Public runtime values: `APP_BASE_URL`, `BETTER_AUTH_URL` (equal to APP_BASE_URL),
`VAPID_PUBLIC_KEY`, `EMAIL_FROM`. `/api/config` exposes only intended public values.
No provider anon key or external Auth URL is needed.

Secrets: `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`. No target
DATABASE_URL or Supabase credentials. Bind secret/base URL explicitly into Better
Auth; do not assume process.env reads Worker bindings. Never commit `.env`/
`.dev.vars`, print values or place them on argv/history. Use Wrangler's interactive
secret prompt after approval, for example:

```bash
# OPERATOR ONLY, after explicit approval; prompts for the value.
npx --no-install wrangler secret put BETTER_AUTH_SECRET
npx --no-install wrangler secret put RESEND_API_KEY
npx --no-install wrangler secret put VAPID_PRIVATE_KEY
```

The actual approved environment must be selected explicitly in production tooling;
never guess the account from whatever login happens to be active locally.

## Approved release sequence

1. Confirm environment/domain, stable auth secret, reviewed auth schema, OTP/
   session/CSRF/rate-limit tests, local gates, quotas and recovery tests.
2. Build the SPA and Worker; inspect the dry-run output and bindings. Make schema
   changes additive/backward-compatible while old versions can still run.
3. Apply **approved** D1 remote migrations explicitly to the intended database.
   DO SQL versions migrate lazily on construction under `blockConcurrencyWhile`.
4. Deploy the **approved** Worker/asset bundle; do not create new empty DO names or
   rename a namespace to paper over a migration failure.
5. Run the manual smoke checklist and inspect sync/outbox age/consumer failures.
   A healthy `/api/healthz` alone says nothing about pending work delivery.

The port must document its final environment-specific commands before a real
release. No remote command in this runbook is executed by Foundation or Caches.

## Manual smoke and observability

After approval, separately check:

- Runtime config has only public values and API failures remain JSON.
- Sign-in code arrives synchronously via Resend, verifies, creates a cookie
  session, sets a name and resumes the stashed invite POST body. Resend errors
  surface; expired/old/resend codes and revoked sessions fail.
- Auth cookie flags, exact origin/CSRF checks, caller-only auth user/session data,
  disabled password/admin routes and D1-backed multi-instance rate limits work.
- Later magic-link follow-up: scanner landing GET consumes nothing; Continue
  verifies once and foreign callback URLs are rejected. Not part of code-first release.
- New cache page opens before discovery catches up; stale/removed indexes never
  authorize a tap; request aggregation stays caller-scoped and bounded.
- Queue-driven notification email arrives (auth-code success does not prove this).
- An authorized photo streams; non-member/removed access gets 404.
- Push arrives in an installed iOS PWA; permission was gesture-driven.
- Pending-sync failures repeatedly re-arm alarms; registry Cron flush and outbox
  Cron rescue work; Queue duplicates/expired claims do not lose events.
- Migration-compatible Worker update preserves existing DO/D1 state.

Track Worker CPU/resource-limit failures, Queue retry/backlog, failed outbox rows,
oldest pending-sync/outbox ages and discovery drift. Never log OTPs, session cookies,
auth/link tokens, invite secrets, push credentials or emails as debug payloads. Testing locally does not prove
production fetch private-IP restrictions; those remain UNVERIFIED.

## Rollback and cutover

A previous Worker version must understand the schemas left by the new one. Code
rollback does not revert D1 migrations or already upgraded DO databases. Prefer
fix-forward after incompatible schema changes; production restore/export actions
need approval and a documented effect on outbox/sync replay.

Cutover is separate work: inventory legacy Supabase users and verified emails;
insert/match Better Auth users by verified email, preserve app display names and
rewrite all user_id/owner_id/requester_id references in D1/DO tables and pending/
outbox payloads. Resolve duplicates/unverified-email conflicts before migration;
never transfer sessions/JWTs or attach an unverified identity to a legacy account.
Verify codes, app/domain routing, ownership/status, photos/intents and notification
recovery; choose a controlled write boundary. Keep legacy Fly + Supabase live until
approval to cut over, then require separate approval to decommission. No automatic
data migration, dual-write transition, teardown or provider changes in this PR.
