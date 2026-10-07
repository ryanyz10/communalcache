# Deploying the Cloudflare stack

Target runbook, to be implemented during the port. This docs PR changes no resources,
settings, secrets or deployments. **Get explicit approval before account operations,
provider changes, a real deploy, data migration or decommissioning.** Existing
production remains live until an approved cutover.

## What is deployed

One TypeScript module Worker, its React static assets, and an exported SQLite cache
DO class. Bindings connect global D1, cache DO namespace, private R2 and Queue
producer/consumer; a scheduled handler runs registry-sync and outbox sweeps.
Better Auth runs inside the Worker with D1 users/sessions and email OTPs. Resend
fetch serves two independent paths: sign-in codes awaited by the auth request,
and Queue-driven notification email. No target Supabase service or SMTP setup.

Root Worker tooling/config do not exist yet in this docs-only PR. Foundation adds
and pins Wrangler/plugin versions and documents the actual binding/database names.
Commands below assume that tooling and an approved environment configuration exist.

## Local checks first

No Cloudflare account is needed for local binding tests. Use gitignored `.dev.vars`
for local values, never production bindings or `wrangler dev --remote` for tests.

```bash
npx --no-install tsc --noEmit
npx --no-install vitest run
(cd web && npx --no-install tsc --noEmit && npm run build)
npx --no-install wrangler d1 migrations apply communalcache --local
npx --no-install wrangler deploy --dry-run
npx --no-install wrangler dev
```

The dry run validates a bundle, not a live deployment. Smoke local health/config,
SPA invite deep links and JSON API errors. Test migrations on empty D1 and older
DO versions; no Go/Docker/Postgres gate proves these Worker paths.

## Approval-gated provider setup

### Cloudflare

1. Confirm account/environment and intended URL `https://communalcache.com` (the
   user owns this domain on Cloudflare). Custom-domain routing and resource
   provisioning still need approval. Create D1, SQLite-backed cache DO namespace/
   class, private R2 and notification Queue only after approval.
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
  Queue. No callback redirect for code login: pending join stays in sessionStorage.
- Magic-link plugin is a later scanner-safe SPA Continue flow, hashed token and
  exact same-origin callbacks; combined link/code lifecycle needs proof. SMS is
  deferred, no provider account or sender provisioned.

Legacy Fly/Supabase Auth/SMTP/Postgres settings matter only to the old live app.
Leave them intact until a separately approved migration/cutover; no target Supabase
setup or auth redirect configuration is required.

### Resend

Approve and verify `communalcache.com` or its chosen sending subdomain in Resend;
use the provider's required DNS verification records and wait for verification.
`EMAIL_FROM` must use that verified domain. Both auth codes and notification
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
release. No remote command in this runbook is executed by this spec PR.

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
