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

## Logs

After a separately approved rollout, open Cloudflare dashboard → Workers & Pages
→ `communalcache` (or `communalcache-staging`) → Observability → Logs. Named staging
and production configs explicitly enable custom logs at head sampling **1 (100%)**;
traces and invocation logs are off. Pinned Wrangler treats observability as
inheritable, but each environment is explicit; the unnamed/default config is
unchanged. Static assets that bypass the Worker produce no custom request event.

Invocation logs are disabled because they include full request URLs, including
invite secrets in `/join/*` and OAuth callback query credentials. Query-string
redaction is also enabled as defense in depth. Application events never include
raw URLs/query strings, auth/contact emails, display names, OTPs/tokens/session IDs,
push endpoints/keys, R2 photo keys, Turnstile tokens, IPs, request/response bodies,
or raw exception messages/stacks. Routes and methods use closed label allowlists;
unknown paths become fixed wildcards. `request` includes method/route/status/elapsed
milliseconds; `unhandled_error` uses fixed name `Error`; `queue` and `scheduled`
summaries contain counts only. `failed_batches` counts escaped consumer failures;
`failed_jobs` counts rejected sweeps, not per-row failures. Existing delivery/cleanup failures retain only
opaque operation IDs, counters/age and terminal outcome. Better Auth logging stays
disabled; escaped queue errors are replaced with a fixed generic exception.

Cloudflare currently includes 200,000 log events/day and **3-day retention** on
Workers Free, versus **7 days** on Paid. Pricing moves to Cloudflare Observability
pricing on **2026-12-01**; check the [current Workers Logs docs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
before changing sampling or plan. These are account-level/provider limits, not an
application retention guarantee. Live Cloudflare enrichment/storage behavior has
not been verified by local tests: after approved staging deployment inspect a
redacted sample, including platform metadata, before claiming live privacy proof.

Live tail is a remote operation requiring separate approval; it may expose platform
request metadata, so never paste raw output or secret-bearing URLs:

```bash
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler tail -e production
```

No tail, deployment or account change is performed by the logging PR.

## Security headers — verify in each environment

The Worker applies one baseline at its final fetch boundary, including JSON,
errors, admin denials and private photo streams. Workers static assets may bypass
that boundary, so `web/public/_headers` supplies the same baseline without changing
`assets.run_worker_first`. Vite copies it to `web/dist`; pinned Wrangler 4.145.0
reads the file and its asset worker replaces the first matching header value.
Local installed-runtime tests verify actual SVG/font/SW asset bytes and headers,
not just that a file exists. Keep the two policies aligned; tests check this.

| Header | Policy |
| --- | --- |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Content-Security-Policy | Enforced `frame-ancestors 'none'` only |
| Content-Security-Policy-Report-Only | Intended resource policy below; not resource enforcement |
| Referrer-Policy | `strict-origin-when-cross-origin`; retain stricter `no-referrer` on `/join/*`, `/auth/link`, Google callback and existing private admin HTML |
| Permissions-Policy | Deny camera, microphone, geolocation, payment, USB, accelerometer, gyroscope, magnetometer and fullscreen; allow same-origin clipboard-write/web-share used by invite controls |
| Strict-Transport-Security | `max-age=31536000` on configured non-local HTTPS app hosts; Worker also suppresses it on HTTP/local requests; no includeSubDomains/preload |

Static HSTS is host-scoped to the committed production and staging HTTPS hosts;
it is absent on localhost. Tests require that list to match configured origins.
Update it deliberately if an approved environment host changes. Worker local
HTTP/localhost/loopback responses remove any upstream HSTS value, even when local
dev accidentally retains a public APP_BASE_URL. Baseline headers
overwrite weaker upstream values and never replace Content-Type, Cache-Control,
private/no-store photo behavior, body bytes or session cookies. Cloudflare edge
policies can still alter the final wire response and must be verified after rollout.

The **report-only** resource policy permits same-origin resources, Turnstile script/
frame/connect at `https://challenges.cloudflare.com`, the app's inline styles,
same-origin fonts/manifest/service worker and same-origin/data/blob images; it
denies objects, base URLs and foreign form actions. Google uses a top-level
redirect, not an embedded Google script/frame. Private R2 photos remain same-origin
cookie-authorized URLs. No CSP reporting collector or new external data destination
is configured. Do not collect invite/auth URLs or private payloads in a future
reporting service without separately reviewed privacy controls.

File photo inputs and canvas image processing do not use getUserMedia or require
web camera permission. Push/Notification API calls remain explicit-gesture flows;
no `push` or `notifications` Permissions-Policy directive is added. Same-origin
clipboard/write and native sharing are intentionally retained. Header/unit/runtime
checks do not certify native browser permission behavior.

**Browser acceptance is pending.** The security-header PR's isolated local Wrangler
HTTP smoke passed, but browser routing reached a different local tool rather than
that local app, and host-browser routing lacked approval. No Turnstile widget rendering, live provider
flow or enforced full-resource CSP compatibility is claimed. Keep the resource
policy report-only until the following owner check is recorded:

1. **Verify headers + Turnstile widget on staging after deploy**, after separate
   deployment/provider approval. In a real browser inspect Network responses for
   landing, sign-in, a signed-in app page, hashed JS/CSS, font/favicon/SW, JSON API,
   error/admin-404 and an authorized private photo. Confirm the table above, the
   candidate report-only policy, no weaker duplicate headers and unchanged cache/
   MIME/cookie behavior. Repeat on the approved production revision/environment.
2. Confirm no-referrer on invite/magic-link landing and Google callback (including
   failures); never capture token/cookie values. Verify one-year HSTS on staging/
   production, and absence on local HTTP/localhost. No preload/subdomain policy is
   implied for the shared workers.dev parent or other hosts.
3. Let the real configured Turnstile script and iframe render; try the approved
   sign-in/create-cache bot flows and error recovery. Verify inline-style layouts,
   image selection/private photos, service-worker registration and installed-device
   notifications, invite copy/share and Google redirect/return. Do not relax Origin,
   siteverify or authorization checks to make this pass.
4. Before enforcing the full resource policy, review the intended directives against
   these real flows and any report-only browser diagnostics. Record only redacted
   policy/directive details, not private URLs/auth/provider bodies. Add the resulting
   regression proof and rerun parity/security/release gates for the changed revision.

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

### Staging site and installed-app name

Staging and production each build `web/dist` in their own deployment job; no shared
CI asset artifact is promoted. The Staging workflow (`main.yml`) sets public
`VITE_SITE_NAME=Communal Cache Staging` only on its web-build step. A small Vite
hook updates the built HTML/manifest, and the landing/legal runtime title overrides
retain that build name. Default/local/production builds remain Communal Cache.
In-app wordmarks and the accessible Home name are not renamed. For a manual local
staging bundle, run `VITE_SITE_NAME='Communal Cache Staging' npm --prefix web run build`
before the staging dry-run; Wrangler `-e staging` alone changes bindings, not built
asset names. Rebuild without that variable before any production bundle.

| Surface | Staging | Production/local default |
| --- | --- | --- |
| Browser/manifest full name | Communal Cache Staging | Communal Cache |
| Manifest short_name / Apple home-screen title | CC Staging | Communal Cache |

Manifest id, start_url, scope and icons stay the same. Security headers and asset
routing are unchanged; no Worker-side rewriting or runtime flag is involved.
After separately approved staging rollout, verify the new tab/title and manifest.
**Existing iPhone installs need remove + re-add to pick up the saved label**; merely
reloading may retain the original Add-to-Home-Screen name. Sign in/re-enable push
as needed after re-adding; household data remains in D1. Record a native iOS
receipt rather than claiming the existing icon was renamed by local builds.

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
   RESEND_API_KEY, VAPID_PRIVATE_KEY, TURNSTILE_SECRET and GOOGLE_CLIENT_SECRET.
   Staging auth/VAPID secrets are independent,
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
There is no user-facing plan UI, upgrade flow, billing or automatic assignment job.
The private owner admin now supports the same exact-target manual assignments;
see [Private owner admin](#private-owner-admin-live-access-smoke-pending). The
commands below remain an approval-gated operator alternative.

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

### Private owner admin (live Access smoke pending)

`/admin` and `/api/admin/*` require **both** a valid Cloudflare Access assertion
and a current D1 app session on the exact owner-supplied ADMIN_USER_IDS allowlist.
No navigation link advertises the page. The SPA HTML paths are in
`assets.run_worker_first`, so static asset serving cannot bypass the Worker gate.
The Worker performs the same checks on custom domains and alternate workers.dev
hosts, not only behind the edge policy. Missing config/assertion/app session or a
non-allowlisted ID returns private/no-store JSON 404, including admin OPTIONS.
Admin mutations also require Origin exactly APP_BASE_URL; valid admins with a bad
Origin receive 403. Authorization failures never expose an admin login bypass.

Only `Cf-Access-Jwt-Assertion` is accepted. There is **no CF_Authorization cookie
fallback**, email/header-identity comparison or impersonation route. WebCrypto
checks RS256 against the fixed configured team's `/cdn-cgi/access/certs` JWKS,
with manual redirects and a five-second timeout. Issuer and environment audience
must match, exp is required, nbf is checked when present, with 30 seconds of clock
skew. Token-supplied iss/jku/x5u never chooses an outbound URL. Public keys are
fetched fresh for this low-traffic owner tool; a bounded public-key cache is a
possible later optimization, not a cached authorization grant.

Public configuration (not secrets):

| Environment | CF_ACCESS_TEAM_DOMAIN | CF_ACCESS_AUD | ADMIN_USER_IDS |
| --- | --- | --- | --- |
| local/default | unset | unset | unset — disabled |
| staging | https://cool-hill-c184.cloudflareaccess.com | 2b600fcaf92b0e490eaf51becb083fae422aeeb97df2e6ddcdc0c86952477ade | 1afaa0f3-6c78-430f-ad4c-60e86c976bc6 |
| production | https://cool-hill-c184.cloudflareaccess.com | 2f87c35679b9acffa9f9ca447ced84fa2a498fcd90626b86fd7a6b01a76afbea | 4f037f1f-5e2a-4241-876e-abdb938bfeb7 |

Owner-supplied Access setup covers all of the staging Worker and production
`admin*` / `api/admin*` paths. These facts are configuration inputs, not independent
live policy verification. No Access/account/resource/secret command runs in this
PR. Tests inject generated RSA keys and mock JWKS; local/default stays disabled.
The local UI fixture is presentation-only, never an authorization bypass in the
application.

The API shows names/IDs, plans, live counts vs the single plan_limits policy,
outbox backlog age and failed-outbox IDs/kinds/timestamps/attempts only. It never
selects authentication/contact email columns or raw outbox/contact contents.
Better Auth authenticates only the caller's own session; no returned admin data
contains its user/session object. Each operational SQL statement rechecks the
current session, and each exact-target plan UPDATE also requires the requested
plan in plan_limits. Free/plus downgrade changes only the plan field; no data,
reservation or attachment is deleted. No SQL is accepted from the browser.

The existing delivery schema has no error classification: error_class is NULL and
the table says **Not recorded**. Classified delivery metadata is deferred rather
than inferred from private payloads. Suspension is also deferred: there is no
suspend endpoint/control until its effects are enforced across all server-side
reads/writes/sessions. No audit table or migration was required by this slice.

After approved merge and successful staging deploy:

1. Open https://communalcache-staging.ryanyz10-be6.workers.dev and complete the
   owner Cloudflare Access challenge, then sign in to the app as the allowlisted
   staging account. Access login alone is insufficient; app sign-in alone is also
   insufficient. Do not copy JWTs/cookies into a PR or a screenshot.
2. Open https://communalcache-staging.ryanyz10-be6.workers.dev/admin by URL.
   Check overview, Caches, Users and Failed outbox, including page controls and
   phone horizontal table scrolling. Confirm only names/IDs/scoped metadata show.
3. On an approved staging test cache/user, record the UUID/current plan, select
   plus and Save, then Refresh and confirm plan and displayed quotas. Restore the
   original plan. Existing items/memberships/requests must remain intact.
4. Sign out of the app and retry /admin and its APIs (404). With Access still
   signed in, use a non-allowlisted app account and retry (404). Verify a direct
   alternate-host API call lacking the Access assertion is also 404; do not expose
   JWT/cookie material while collecting this receipt.
5. Record exact revision/environment/browser results. Edge access, real JWKS and
   account setup need this owner-run receipt; local tests are not live acceptance.

To enable production later, the owner first signs up normally on production,
completes onboarding and obtains **their own app user ID** from authenticated
`GET /api/me`. Approve only that UUID (no email matching and no staging-ID copy).
Update `env.production.vars.ADMIN_USER_IDS` in a reviewed code/config change and
perform the separately approved production deployment. The owner's production ID is now set;
no bootstrap admin endpoint or automatic enrollment exists. Policy/allowlist
changes, production rollout and final parity/security/release approvals remain
separate.

### Google sign-in (owner-managed credentials; live smoke pending)

Google is configured only when both GOOGLE_CLIENT_ID (public Worker var) and
GOOGLE_CLIENT_SECRET (Worker secret) are present. `/api/config` exposes only a
`google_sign_in` boolean; the button is hidden and provider omitted when either
value is missing. The owner supplied the public client ID committed in default,
staging and production vars and reports the staging secret already provisioned.
Production secret setup remains separately approved; do not print/read secret
values, put them on argv, or copy them into tests. `.dev.vars.example` has a blank
local secret slot, not a working credential. This PR runs no provider/account or
remote Cloudflare operation.

Registered redirects (exact paths/origins):

- https://communalcache.com/api/auth/callback/google
- https://communalcache-staging.ryanyz10-be6.workers.dev/api/auth/callback/google
- http://localhost:8787/api/auth/callback/google

For local Google smoke use localhost:8787, not the unregistered Vite :5173 callback.
Automated tests use only public fixtures and a mocked Google token endpoint.

Pinned 1.7.7 review: trustedProviders alone bypasses provider-email verification.
`user.validateUserInfo` additionally requires the fresh Google email_verified claim
and mapped emailVerified to be strictly true on create, implicit link and returning
sign-in. Linking is enabled only for trusted Google and a locally verified matching
email; unverified local accounts are not implicitly linked. Provider name/picture
are discarded, app display_name stays NULL and existing profile onboarding applies.
Google's account subject, provider ID, app user ID, scopes and timestamps persist
in the existing account schema. Account create/update hooks null accessToken,
refreshToken, idToken and token expiry columns before D1 writes; account cookies
are disabled. Token material is used transiently for the exchange, not persisted.
No schema migration is needed. Raw library/provider error logging is disabled.

Only Origin-checked `POST /api/auth/sign-in/social` (Google code redirect only) and
`GET /api/auth/callback/google` are exposed. Callback URLs share the magic-link
exact-origin validator. Better Auth retains D1 state/PKCE, matching signed state
cookies and exact trustedOrigins; HTTPS uses host-only HttpOnly/Secure/SameSite=Lax
cookies. Local HTTP cookies omit Secure. State is not an invite grant: admission
still needs profile completion and the explicit Join action. Google does not add
Turnstile: the approved bot-check scope remains email sends and cache creation.
Auth responses remain no-store; callback redirects also use no-referrer.

After approved merge and successful staging deploy, the owner can try:

1. Open https://communalcache-staging.ryanyz10-be6.workers.dev/login in a fresh
   browser session. `/api/config` should show google_sign_in=true, never credentials.
2. Choose **Continue with Google**, then choose a Google account with a verified
   email. Confirm return to staging, choose a display name/coat in existing
   onboarding and confirm the account has no imported Google name/photo.
3. Sign out. Sign in by email link/code using that same email; confirm the same
   library/caches. Repeat Google sign-in with an existing verified email account
   and confirm its chosen name/photo/items remain, rather than a duplicate user.
4. Open a real staging invite while signed out, choose Google and confirm return
   to that invite. Complete onboarding if needed; no membership is created until
   the separate **Join**/**Ask to join** action.
5. Cancel at Google. Confirm a friendly sign-in error and usable email fallback;
   an invite remains saved. Check phone/desktop and both OS color schemes.
6. Record revision, environment and browser/provider results. Local mocks and the
   owner-reported secret do not prove real OAuth acceptance. Production setup,
   final parity/security/release approval and Apple remain separate.

### Turnstile (owner-managed setup; live smoke pending)

The public sitekey `0x4AAAAAAFX8jA_m3iHxQbuL` is owner-approved for both staging
and production. `TURNSTILE_HOSTNAMES` remains environment-specific:
`communalcache.com` for production/default, and
`communalcache-staging.ryanyz10-be6.workers.dev` for staging. Never add localhost
to a production allowlist. Only `TURNSTILE_SITE_KEY` is exposed by `/api/config`;
`TURNSTILE_SECRET` is an owner-managed Worker secret, never a committed variable.
Missing secret/hostnames fails closed with 403. This feature PR runs no secret or
remote Cloudflare setup command; owner provisioning is separate.

For local development, use localhost and the real widget's secret in gitignored
`.dev.vars` as described by `.dev.vars.example` (no secret value in that example).
Official dummy keys do not include the required hostname/action verdicts; do not
add a local/test bypass to the Worker. Automated tests mock strict siteverify
responses, including the documented always-fail and spent-token outcomes.

The owner reports staging-secret provisioning; after approved merge/deploy,
validate real widget tokens for magic-link sends, code fallback/resends and cache
creation, plus missing/replayed/wrong-context rejection. Continue, code redemption,
GET session and sign-out must still work without a challenge. Check expired/error
recovery and sunny/evening widget appearance. Record exact revision/environment
receipts; local tests/fixtures and a secret being present do not prove real-token
verification. Bot Fight Mode/domain/provider changes remain separately approved.

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

Public: APP_BASE_URL, BETTER_AUTH_URL, VAPID_PUBLIC_KEY, EMAIL_FROM,
TURNSTILE_SITE_KEY, GOOGLE_CLIENT_ID, CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD,
ADMIN_USER_IDS and environment-local TURNSTILE_HOSTNAMES;
/api/config exposes only intended public fields (Google availability, not credentials).
Secrets: BETTER_AUTH_SECRET, RESEND_API_KEY, VAPID_PRIVATE_KEY, TURNSTILE_SECRET
and GOOGLE_CLIENT_SECRET, explicitly passed as Worker bindings. No target DATABASE_URL,
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

Legacy Go service, Fly deployment and Supabase integration files were removed
from this repo and remain in git history. Removing those files does not shut down
the external Fly app or Supabase project or authorize their decommissioning.

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
