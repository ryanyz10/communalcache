# Communal Cache

Mobile-first household sharing: React + a TypeScript Cloudflare Worker, one D1
database, private R2 photos and a notification Queue/Cron. D1 owns auth, cache
memberships, the canonical item library, cache attachments, shared stock,
requests, outbox/push and durable photo cleanup. No addresses, holder tracking,
loan lifecycle, discovery copies or cross-object synchronization.
Target: https://communalcache.com.

## Status and approval warning

The D1 feature stack is implemented for review; local checks are not live release
or provider proof. PR 7 prepares retirement of the historical `Cache` class.
**Merging its draft deploys a `deleted_classes` migration that permanently deletes
all Cache DO data on staging (and later production). Explicit owner approval is
required. Do not merge or mark ready without it.** The staging test-data reset is
**not included** and needs separate approval. A code rollback cannot restore
class data or undo the D1 projection-table drops.

The retirement code has no object binding/class/RPC/registry sweep. Wrangler keeps
the applied `v1` class history and appends `v2-retire-cache` with
`deleted_classes: ["Cache"]`, inherited by default/staging/production. D1 migration
`0011_retire_cache_projections.sql` drops only obsolete `my_caches` and
`cache_sync_cursor`. Canonical app rows, auth, outbox/push, cleanup and R2 bytes
are not reset. Legacy Go/Fly/Supabase stays live until separately approved cutover.

- [Build guide](docs/build-guide.md): feature order, status, traps and proofs.
- [Plan](docs/plan.md): settled product/architecture decisions and invariants.
- [Database](docs/database.md): D1 schema, guarded batches and recovery.
- [Deploy](docs/deploy.md): approval-gated release and retirement runbook.
- [AGENTS.md](AGENTS.md): authorization/security invariants and conventions.

## Local development

Node 22.12+ is required (CI uses 22.23.1). Install the committed lockfiles:

```bash
npm ci --silent
npm --prefix web ci --silent
```

Copy `.dev.vars.example` to **gitignored** `.dev.vars`, then fill
`BETTER_AUTH_SECRET` with a fresh local-only random secret of at least 32
characters. Do not use production credentials. Keep `APP_BASE_URL` and
`BETTER_AUTH_URL` equal to the browser's exact origin, normally
`http://127.0.0.1:8787`. Never put secrets on argv, in git, frontend build variables
or logs.

```bash
npm --prefix web run build
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
npm run dev
```

Wrangler serves API and built SPA on that origin with local bindings under
`.wrangler/`; the committed D1 resource ID does not make local development remote.
Do not use `--remote` for tests. Remote migrations/deploys, resources, providers,
secrets, class deletion and data resets require explicit approval. Private R2,
Queue and Cron configuration alone is not evidence of provisioning or delivery.

For Vite hot reload, set **both** URLs in `.dev.vars` to `http://localhost:5173`,
run Wrangler and `npm --prefix web run dev` separately, and open the Vite origin.
Vite proxies `/api` to local Wrangler on 8787. For an occupied Worker port,
`npm run dev -- --port 8788 --inspector-port 9238` is available; keep the proxy and
both gitignored origin values consistent with the mode you use. Do not broaden
production trust to work around a local origin mismatch.

The legacy `.env` contains Go/Supabase configuration. `npm run dev` and
`npm run types` disable Wrangler dotenv fallback; use the same
`CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false` prefix for direct Wrangler commands.
Wrangler loads `.dev.vars` independently. Public API config exposes no secrets.

### Provider-free browser walkthrough

The opt-in fixture serves the real SPA with an in-memory mock API:

```bash
npm run ui:fixture
# Optional: UI_FIXTURE_DEV=1 for Vite source UI, or UI_FIXTURE_PORT=4174
```

Open `http://127.0.0.1:4173/login`. Choose a test email and **Email me a sign-in
link**, open `/__fixture/magic-link`, follow its link and press **Continue**.
Alternatively use **Use a 6-digit code instead** with public fixture code `123456`.
Set a display name. `failure@example.test` demonstrates an auth delivery error.
The fixture never sends mail or grants real membership. **Never deploy or expose
it.** Real permissions, stock and durable effects are proved with local D1 tests,
not the fixture's simplified API.

- **Home:** create/open caches; no request preview/sidebar. Home reads active
  memberships directly and previews Your items. The profile menu offers Requests,
  Your items, Account settings and Sign out; arrows/Home/End, Escape, outside clicks
  and navigation manage the menu. Its request badge is first-page pending incoming
  only. Account exposes only your own name/email and device notification controls.
- **Your items:** follow Home **See all** or the profile menu. Create an unshared
  library item without joining a cache. Cards show cache names, give-away stock,
  Lent out and pending ask counts. One item can appear in many caches.
- **Cache Add item:** choose **Your items** to attach existing canonical items;
  **Already here** rows are checked/disabled. Choose **New item** for photo, name,
  **Lend it / Give some away**, quantity and description. Canonical create plus
  first attachment is atomic; photo upload follows it. A failed upload does not
  repeat an acknowledged creation. Partial multi-attach successes are kept.
- **Owner item:** edit title/description/stock (type is fixed), upload/replace a
  private photo, save Lent out/note, and choose **Shown in** cache checkboxes.
  Unchecking confirms that pending asks in that cache will be declined; the
  library item, photo, stock and other attachments survive. Global Delete item
  explicitly removes it from every cache/library and erases its request history.
- **Requests:** a non-owner asks in a shared cache; owners approve or reject with
  a reason. Consumable approval deducts shared stock once. Reusable approval can
  mark Lent out. Requests pages are direct party-scoped D1 queries, 25 rows/page,
  not discovered-cache fan-out. No cancellation, holder or return tracking.
- **Membership:** cache owners approve gated joins and may remove non-owners.
  Non-owner members may leave. Both operations reject affected pending requests
  and detach the departing member's items from that cache atomically; their
  library/photos/other caches survive. Removed membership denies a valid-secret
  rejoin; voluntary leavers can rejoin with a current invite without restoring
  old attachments. Owners cannot leave or be removed.

### Email links and code fallback

Primary email contains only a magic link, valid for five minutes. Its
`/auth/link#token=...` landing page removes the fragment and never verifies on
load, preview or GET; explicit **Continue** performs an Origin-protected POST.
Reloading after fragment removal requires a new link. Invalid/expired/used links
show recovery actions. Codes and links are independent challenges; codes rotate
on resend, while additional links do not revoke outstanding unexpired links.
Both send paths await bounded Resend HTTP and surface a generic 502 on failure.

Invites stay in the requesting tab's sessionStorage, never auth metadata/mail/
callback data. A fresh browser can verify a link but must reopen its invite, or
use code in the original tab. Better Auth 1.7.7 retains D1-backed limits, hashed
six-digit codes, three attempts, exact-origin callbacks and scanner-safe link
redemption. Live mail/mobile handoff needs separately approved provider proof.

### Notifications and private photos

Domain mutations and recipient-snapshot outbox rows commit in the same guarded
D1 batch. Queue sends happen afterward; enqueue failures retain durable work.
The five-minute Cron independently rescues up to 25 old nonterminal outbox rows
and processes two durable photo-cleanup intents. Cleanup handles one 100-key
prefix page per intent/tick and retains work until success/empty confirmation.
There are no object alarms, registry sweeps or copied grants.

Queue consumers handle three sequential rows/batch, with 10-second provider and
30-second delivery deadlines. Expiring guarded claims prevent competing live
senders. Only observed failures can set terminal `failed_at`; attempts alone never
make crashed work ineligible. Delivery is at least once: provider acceptance
before durable success recording can duplicate a send.

Push is preferred when live registrations remain; no subscriptions/all 404/410
this pass falls back to email. Transient push errors retry push, not email.
At most three browsers/account; registration ownership rotates on account change,
and logout clears the caller's subscription before sign-out. On iOS, install via
Share → Add to Home Screen before enabling push. The service worker opens only
same-origin paths and never caches private API/photo responses.

R2 remains private and owner-scoped. Photo upload validates actual bytes and
JPEG/PNG/WebP signatures; finalization rechecks ownership after R2 I/O and records
replaced/rejected-key cleanup durably. A crash after put but before finalization
can leave unknown orphan bytes; complete orphan sweeping is not claimed.

Tests mock all providers. A real local Queue consumer can send mail if configured
with a real provider key: local persistence does not make external HTTP local.
Use isolated fresh `--persist-to` state with no queued work for read-only smoke.
Live mail/push, installed-device behavior, production private-IP/CPU guarantees
and Free-plan fit remain unverified until separately approved evidence.

## Limits, monitoring and recovery

Joins and request writes use four reusable per-user D1 fixed-minute counters:
join 10, join decision 30, request create 20, request decision 60. Failed attempts
count after Origin/auth/profile checks. JSON 429 includes bounded Retry-After.
These are abuse budgets, not membership grants or notification throttles.

Monitor Worker CPU, D1 query duration/rows/storage, Queue age/retries/retention,
terminal outbox failures and oldest nonterminal outbox/cleanup age. Structured
notification/cleanup logs exclude payloads and credentials. Never log auth bodies,
codes, cookies, emails, invite secrets or push keys. See the
[runbook](docs/deploy.md#backlog-and-budget-triage) for payload-free diagnostics.

Canonical SQL guards and atomic token-gated batches protect authorization, shared
stock and destruction. External R2/Queue/provider work stays outside database
atomicity. Recovery follows durable D1 work, with no hidden attempt cutoff for
crashed claims or photo cleanup. Paid upgrades, replay/restore and production
cutover require approval; do not clear durable work to make metrics healthy.

## Validation

```bash
npx --no-install tsc --noEmit
npx --no-install vitest run
(cd web && npx --no-install tsc --noEmit && npm run build)
# Source-only check: the root web tsconfig contains project references.
(cd web && npx --no-install tsc --noEmit -p tsconfig.app.json)
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run -e staging
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run -e production
```

The suite uses real local Worker/D1/R2/Queue bindings and Node UI-unit tests.
It covers empty/populated migration upgrades, OTP/session/CSRF/profile rules,
canonical membership/item/photo authorization, shared-stock races, destructive
batch rollback, outbox claims/recovery, cleanup retry and library pagination.
No object test binding or helper remains. Dry-runs validate bundles only, not
remote class deletion, deployment, data preservation or provider delivery.

`npm run types` regenerates Wrangler environment/runtime declarations without
secret values. Generic platform types may still mention object APIs; they are not
configured app bindings. `node --experimental-strip-types scripts/auth-schema.mjs`
prints the pinned Better Auth schema reference without changing any database.
D1 migrations are in `migrations/d1/`; applied history stays intact. Legacy
PostgreSQL migrations remain under `internal/db/migrations/`.
