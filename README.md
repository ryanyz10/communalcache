# Communal Cache

Mobile-first household sharing: React + a TypeScript Cloudflare Worker, one SQLite
Durable Object per cache and global D1. Foundation implements private cookie-auth
sessions, link-first email sign-in with an explicit six-digit code fallback and
display-name onboarding. Caches adds
creation, live member/owner access, invites/settings and ordered discovery sync;
joining, items/private R2 photos, transactional requests, Queue email/push,
member removal/item deletion and everyday UX polish are implemented locally.
No addresses, holder tracking or loan tracking. Target: https://communalcache.com.

## Status and docs

The Foundation → Polish Cloudflare feature stack is implemented for review;
local gates are not release/provider proof. The `communalcache` D1 database
was created with approval and its real ID is committed; remote migrations,
deployments and Resend/domain changes still require separate approval. The legacy
Go/Fly/Supabase app stays live until an explicitly approved cutover. Its source
and deployment files remain reference;
the `web/` SPA now targets the Worker, not the Go auth/config contract.

- [Build guide](docs/build-guide.md): feature order, status, traps and proofs.
- [Plan](docs/plan.md): settled product/architecture decisions and invariants.
- [Database](docs/database.md): D1/DO migrations, transactions and recovery.
- [Deploy](docs/deploy.md): approval-gated provider setup and release runbook.
- [AGENTS.md](AGENTS.md): authorization/security invariants and conventions.

## Local development

Node 22.12+ is required (validated with 22.22.3). Install the committed lockfiles:

```bash
npm ci --silent
npm --prefix web ci --silent
```

Copy `.dev.vars.example` to **gitignored** `.dev.vars`, then fill `BETTER_AUTH_SECRET`
with a fresh local-only random secret of at least 32 characters. Do not use
production credentials. Keep `APP_BASE_URL` and `BETTER_AUTH_URL` equal to the
browser's exact origin: normally `http://127.0.0.1:8787`. Do not put secrets on argv,
in git, in frontend build variables or in logs.

```bash
npm --prefix web run build
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
npm run dev
```

Wrangler serves both API and built SPA at `http://127.0.0.1:8787`. D1 and DO state
are local under `.wrangler/`. `wrangler.jsonc` commits the approved `communalcache`
D1 ID `b4257b89-22d6-40f1-b250-ccd1985bf1d1`; this does not make local dev/tests
remote. Remote migrations and deployments still require explicit approval, as do
further account/provider changes. Photos declares local `BUCKET` bindings, but remote
`communalcache-photos` (default/production) and `communalcache-photos-staging` buckets
still require approved private creation; no R2/Queue resources were provisioned.
Never enable public bucket access. The intended
five-minute registry/outbox Cron is declared in config only; no production trigger was installed.
Notifications adds `NOTIFICATIONS` producer/consumer bindings for
`communalcache-notifications` (default/production) and
`communalcache-notifications-staging`. Those remote queues also need approved creation.

For Vite hot reload, set **both** URLs in `.dev.vars` to `http://localhost:5173`,
run Wrangler and `npm --prefix web run dev` in separate terminals, and open the
Vite origin. Vite proxies `/api` to local Wrangler on port 8787. The mutation Origin
must match the URL configured for that mode; do not broaden production trust.

The legacy `.env` contains Go/Supabase configuration. `npm run dev` and
`npm run types` explicitly disable Wrangler dotenv fallback; always use the same
`CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false` prefix for direct Wrangler commands.
Wrangler loads `.dev.vars` independently. API config exposes no database/provider
credentials.

### Safe login UI walkthrough without a provider

Tests mock Resend HTTP; no real mail is sent. The opt-in browser fixture serves the
**real built SPA** with a mock API, not a mock SQL database or a production auth
service:

```bash
npm run ui:fixture
```

Open `http://127.0.0.1:4173/join/11111111-1111-4111-8111-111111111111.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.
Enter a test email and choose **Email me a sign-in link**. Open
`http://127.0.0.1:4173/__fixture/magic-link` to read the mock email, follow its link
and press **Continue**. Just opening the landing page must not sign in. Alternatively,
choose **Use a 6-digit code instead**, enter the public fixture code `123456` and
choose a name. The invite stays in this tab's sessionStorage; reload it or open
`/login` to see navigation resume it. Use `failure@example.test` to see a delivery error
without losing the invite. Cancel clears the pending invite. The fixture does not grant real membership; actual body-only join/approval is proved
against local DO storage in the runtime suite. **Never deploy or expose this fixture server.**

For the Caches UI walkthrough, cancel the saved invite to reach **Your caches**.
**+ New cache** opens a named bottom sheet on mobile (centered dialog on desktop);
create and immediately open the cache. **Invite** uses the native share sheet when
available, otherwise copies the link. The gear opens `/caches/:id/settings` for
members/invites and owner join decisions, reset-link confirmation and cache settings.
The house icon in the pinned header goes Home. The profile menu opens **Requests**
(`/requests`), **Account settings** (`/account`) and **Sign out**; Account retains
its sign-out button along with your own name/email and notification toggle. Escape,
outside pointer clicks and navigation close the menu; keyboard arrows/Home/End move
between its items. The profile/menu badge counts only first-page pending incoming
requests. Home shows caches only, with no requests preview/sidebar or Your items
placeholder. Discovery supplies names, not item/member counts; no counts are invented. The fixture API is mocked;
the runtime suite separately proves real D1/DO authority.
For Items, use **Add item** from a cache: create a reusable item without stock or
check Consumable and set stock (including zero). Open the item, edit its title,
description or stock, and return to the cache list. Type is fixed after creation;
the owner can delete it through a confirmation dialog. From item detail, choose a JPEG, PNG or WebP and
**Upload photo**; the browser resizes/re-encodes it to JPEG. The owner can replace
it, and item lists/detail load it from the same-origin authenticated photo route.
The mock fixture covers UI flows only; real authorization, R2 cleanup and
pending-reservation floors are runtime tests.

For Requests, sign in as an owner test email and create a consumable item. Sign
out, sign in with a second test email (same public fixture code `123456`), open the
shared cache/item and **Ask to use** a positive quantity. Open **Requests** from
the profile menu: **Needs your answer** contains pending incoming decisions;
**Your requests** contains your outgoing requests with their status. Sign back in as the owner to approve, or reject with a
reason; approve deducts stock and reject frees reservations. Fixture identities
persist in memory by email, and its caches are shared for this walkthrough only;
real join/membership permissions are proved by DO tests, not this mock API.
The real aggregate loads 25 discovered caches per page with **Load more caches**,
and explicitly warns if some caches could not be loaded. There is no cancellation
or handoff/return tracking.

The cache owner's settings page has **Remove** confirmation dialogs for non-owner
members. Removal immediately blocks cache data (404), keeps the invite route's
removed-member 403, deletes the member's items and rejects their pending requests
on surviving items. Item deletion notifies pending requesters. D1/R2/notification
cleanup is eventual through durable ordered sync; there is no self-leave or owner
removal. The UI fixture mocks this flow, while runtime tests prove cascades.
Use `UI_FIXTURE_PORT=4174 npm run ui:fixture` if 4173 is occupied, or additionally
`UI_FIXTURE_DEV=1` to exercise the real Vite source UI before building.

For actual local bindings, `npm run dev -- --port 8788 --inspector-port 9238`
works around an occupied 8787; change both gitignored URL values to that origin.
Create/settings return authoritative DO state immediately. Home summaries contain
only discovery id/name and may lag; revisit the page after a moment. Invites/ownership never
come from D1. Sync is capped at 25 intent rows per drain; Cron sweeps 25 known caches
per tick. Failed first alarm scheduling retains intents, but registry cannot find
a brand-new cache until its registry intent succeeds; its returned cache ID and a
later entry point can repair the gap. A crash before the ID response remains an
explicit recovery limitation. Stable outbox IDs and replay are proved with Joining/request events in the runtime
suite, independently of this mock UI.

Real email sign-in requires separately approved Resend/domain setup and a local
provider key. Delivery is awaited with a 10-second abort deadline. Better Auth
1.7.7 catches callback rejections, so a request-local delivery result maps failures
to generic JSON `502 email_unavailable`; a rate-limited request remains 429.

### Email links and code fallback

The default sign-in email contains **only a magic link**, expiring after five
minutes. Formatted mail has a centered, inline-styled card and table-based **Sign in**
button, with the same link retained in the plain-text fallback. No images or remote
assets are loaded by the email. Its `/auth/link#token=...` landing page does not verify on load, preview or
GET; only **Continue** makes an Origin-protected verification POST. The app removes
the fragment from browser history and never includes its token in incoming server
URLs. Reloading that page after removal requires a new link. Invalid/expired/used
links show an error and offer a new link or an email code.

**Use a 6-digit code instead** sends the existing six-digit code email and opens code
entry. The two email types are separate; codes and links are independent
challenges, not a combined email or cross-invalidated pair. Codes still rotate on
resend; additional links do not revoke outstanding unexpired links. Use the newest
link if you requested another. Both auth send paths await bounded Resend HTTP and
surface a generic 502 on failure, not a background notification Queue job.

A link works in a different/fresh browser without requesting-browser state.
Pending invites stay in the original tab's sessionStorage: open the mail link in
that tab to resume automatically, reopen the invite in the other browser, or use
the code fallback in the original tab. Invite secrets never go into sign-in mail
or callback data. Auth callbacks must resolve to the exact app origin; public GET
verification is denied. Both magic-link HTTP paths retain Better Auth's D1-backed
5/60s trusted-IP/path rate limit through the internal GET adapter. No new config,
dependency or migration is needed; migration 0003 remains compatible and unchanged.
Live Resend delivery and real mobile mail-client handoff remain approval-gated.

### Notification delivery

Joining/request events now flow from durable DO intents through D1 outbox IDs to
Queue-driven email, using the same `EMAIL_FROM` and Resend binding as auth but an
independent handler. There is no new notifications screen. Live browser subscriptions
receive encrypted push; recipients without subscriptions, or whose subscriptions all
return 404/410 in this pass, receive email. Transient push errors retry push rather
than escalating to email. App APIs still expose only your own email. Provider calls abort after 10 seconds within a 30-second delivery deadline.
Queue duplicates are harmless after terminal recording, but a crash after provider
acceptance can still duplicate mail (at-least-once delivery).

The five-minute recovery Cron cursor-pages 25 expired/unclaimed nonterminal rows
older than three minutes and 25 registry caches. Failed DO sync backs off from
five seconds to one hour without giving up; entry points and Cron preserve the
delay. Tests mock Resend and use local Queue producers plus consumer ack/retry
helpers; no external provider is contacted. A real `wrangler dev` consumer can
send notification mail if a provider key is configured, so do not use production
credentials or assume local persistence makes provider fetches local. For read-only
smoke, use a fresh isolated `--persist-to` directory with no queued work.

### Web push and installation

Account has a **Push notifications** toggle under **Notifications on this device**.
Permission is requested only when explicitly turning it on. On iPhone/iPad, use
Share → Add to Home Screen, open the installed app, then turn notifications on. At most three browsers
can register for one account. Logout deletes the caller's server registration,
unsubscribes locally and closes displayed notifications before signing out.
An unmatched previous-account browser registration is cleared without auto-enabling
notifications for the new account. The ownership marker is local UI state, not API
authorization. The service worker opens only same-origin paths and never caches
private API/photo responses. The manifest reuses the existing SVG icon.

For a local test setup, put a local-only P-256 VAPID pair in gitignored `.dev.vars`:
`VAPID_PUBLIC_KEY` is the base64url uncompressed 65-byte public point and
`VAPID_PRIVATE_KEY` is the base64url JWK `d` scalar. Public config exposes only the
public key; blank public config disables Enable. Use separate approved staging and
production pairs; never commit/log private keys or put secret values on argv.
`APP_BASE_URL` is the VAPID contact URI. Registration/delivery tests use generated
fixture keys and mock all providers; the provider-free UI fixture keeps push disabled.

The exact `@block65/webcrypto-web-push@2.0.0` pin (published 2026-09-03) has local
workerd encryption/decryption and VAPID signature proof. Actual push-service and
installed iOS delivery, platform icon rendering, production CPU/free-tier fit and
private-IP/DNS-rebinding blocking remain **UNVERIFIED**. The strict service-origin
allowlist and manual redirects are application controls, not proof of platform
SSRF immunity. No VAPID/provider/account changes were performed by this feature.

## Write budgets and everyday UX

Joins and request writes use verified-user + route-family D1 counters, shared across
all cache/item IDs. Limits per fixed minute: join 10, join decisions 30, request
creation 20, request decisions 60. Failed attempts count after Origin/auth/profile
checks; 429 returns bounded `Retry-After` and the UI tells you how long to wait.
Reads and notification delivery are not throttled by these write budgets. Counters
reuse four rows/user, not one row per URL/window; concurrent guarded UPSERTs cannot
overshoot within a window, but a minute boundary can admit two windows' budgets.
Workers Rate Limiting binding plan availability remains **UNVERIFIED**, so no
account-plan assumption or per-isolate memory limit is used. D1 failure fails
closed; one D1 write per admitted attempt adds cost to measure before release.

Lists show loading/empty/error states and cached-list failures explicitly warn of
staleness; partial/paginated request queues never claim to be complete. Error
retries, notification-config retry and photo retry are explicit actions, not silent
mutation retries. Native modal sheets are centered and scroll within small screens,
trap keyboard focus, start on Close/Cancel and return focus on dismissal. Confirmations
cannot be dismissed while their mutation is pending, so failures stay visible.
Forms are labeled; focus rings support forced colors. Sign-in copy says to use
the most recent code **requested**, even if an older email arrives later.

## Resource budgets and monitoring

Local proof does not establish Free-plan fit. Before an approved release, measure
Worker CPU p50/p95/p99 and resource-limit errors separately for OTP sign-in,
request fan-out and push encryption; HTTP Free CPU is 10 ms/invocation. Compare
D1 rows read/written, DO duration/storage, Queue operations/retries/retention and
R2 operations against [sourced ceilings](docs/plan.md#verified-platform-facts).
A paid plan, Rate Limiting binding or provider setup needs explicit approval.

Current bounded work:

| Path | Budget / continuation |
| --- | --- |
| DO sync drain | 25 iterations, up to 50 D1/Queue/R2 binding calls; alarm continues |
| R2 item cleanup | 100 keys/page, relist after deletion; intent remains until empty |
| Registry / outbox Cron | 25 caches and 25 recoverable IDs per five-minute tick; durable cursors |
| Requests aggregation | 25 discovered caches/page, 5 concurrent RPCs, explicit next cursor/unavailable IDs |
| Queue consumer | 3 sequential rows/batch, up to 3 browser registrations/user; 10s provider / 30s row deadline |
| Write abuse counters | 1 atomic D1 statement/attempt; 4 reusable rows/user |

Observe backlog age, not just `/api/healthz`. Failed DO drains log only
`cache_sync_failed`, retry count/time and oldest pending age (no payload/secret).
Observed notification failures log `notification_delivery_failed`, outbox UUID,
claim attempts and terminal status. Auth/provider error bodies, codes, cookies,
emails, invite secrets and push keys must never be logged. See the
[monitoring/recovery runbook](docs/deploy.md#backlog-and-budget-triage) for
payload-free D1 queries, suggested signals and replay precautions.

Release proof remains separate and approval-gated: auth email, Queue notification
email, authorized photos, installed iOS push, alarm/Queue/Cron recovery,
migration-compatible update and rollback. Legacy production stays live; no remote
resource, account, secret, deploy or cutover operation is included in Polish.

## Validation

```bash
npx --no-install tsc --noEmit
npx --no-install vitest run
(cd web && npx --no-install tsc --noEmit && npm run build)
# Cheap source-only check while editing (the root web tsconfig only has references):
(cd web && npx --no-install tsc --noEmit -p tsconfig.app.json)
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run -e staging
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run -e production
```

The suite has a real local Worker/D1/SQLite DO project and a Node UI-unit project.
It checks migrations, transaction rollback, schema upgrades, alarms, OTP/session/
CSRF/profile/delivery/concurrency behavior, cache authorization, ordered crash
replay, recovery beyond six failures, bounded sweeps and invite retention. SQL is never
mocked. Browser-fixture checks do not certify real provider delivery.

`npm run types` regenerates Wrangler environment/runtime declarations without
embedding secret values. `node --experimental-strip-types scripts/auth-schema.mjs`
prints the pinned Better Auth empty-D1 schema reference for reviewing auth SQL;
it never changes global or production schemas. D1 migrations live in
`migrations/d1/`; legacy PostgreSQL migrations stay under `internal/db/migrations/`.

The first npm 10.9.8 install hit an internal peer-resolver crash, not an ERESOLVE
range conflict. Lock regeneration and plain `npm ci` succeeded. The Cloudflare
plugin requires Vitest, runner and snapshot `^4.1.0`; installed `4.1.11` satisfies
all three. No legacy-peer-deps override is required by the committed setup.
