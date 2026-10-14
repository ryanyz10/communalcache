# Communal Cache

Mobile-first household sharing: React + a TypeScript Cloudflare Worker, one SQLite
Durable Object per cache and global D1. Foundation implements private cookie-auth
sessions, six-digit email sign-in codes and display-name onboarding. Caches adds
creation, live member/owner access, invites/settings and ordered discovery sync;
joining, private R2 photos and Queue notifications follow in feature order.
No addresses, holder tracking or loan tracking. Target: https://communalcache.com.

## Status and docs

Foundation and Caches are implemented for review. The `communalcache` D1 database
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
five-minute registry Cron is declared in config only; no production trigger was installed.

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
Use a test email and the public fixture code `123456`, then choose a name. The
invite stays on the same page and in sessionStorage; reload it or open `/login`
to see navigation resume it. Use `failure@example.test` to see a delivery error
without losing the invite. Cancel clears the pending invite. Joining's actual
POST is deferred to Feature 2. **Never deploy or expose this fixture server.**

For the Caches UI walkthrough, cancel the saved invite to reach the dashboard,
create a cache and immediately open its page. Copy an invite, open the members
sheet, change owner settings and rotate through the confirmation dialog. The
fixture API is mocked; the runtime suite separately proves real D1/DO authority.
For Items, use **Add item** from a cache: create a reusable item without stock or
check Consumable and set stock (including zero). Open the item, edit its title,
description or stock, and return to the cache list. Type is fixed after creation;
deletion is intentionally absent. From item detail, choose a JPEG, PNG or WebP and
**Upload photo**; the browser resizes/re-encodes it to JPEG. The owner can replace
it, and item lists/detail load it from the same-origin authenticated photo route.
The mock fixture covers UI flows only; real authorization, R2 cleanup and
pending-reservation floors are runtime tests.

For Requests, sign in as an owner test email and create a consumable item. Sign
out, sign in with a second test email (same public fixture code `123456`), open the
shared cache/item and **Ask to use** a positive quantity. **Your requests** shows
incoming/outgoing lists. Sign back in as the owner to approve, or reject with a
reason; approve deducts stock and reject frees reservations. Fixture identities
persist in memory by email, and its caches are shared for this walkthrough only;
real join/membership permissions are proved by DO tests, not this mock API.
The real aggregate loads 25 discovered caches per page with **Load more caches**,
and explicitly warns if some caches could not be loaded. There is no cancellation
or handoff/return tracking.
Use `UI_FIXTURE_PORT=4174 npm run ui:fixture` if 4173 is occupied, or additionally
`UI_FIXTURE_DEV=1` to exercise the real Vite source UI before building.

For actual local bindings, `npm run dev -- --port 8788 --inspector-port 9238`
works around an occupied 8787; change both gitignored URL values to that origin.
Create/settings return authoritative DO state immediately. Home summaries contain
only discovery id/name and may lag; refresh after a moment. Invites/ownership never
come from D1. Sync is capped at 25 effects per drain; Cron sweeps 25 known caches
per tick. Failed first alarm scheduling retains intents, but registry cannot find
a brand-new cache until its registry intent succeeds; its returned cache ID and a
later entry point can repair the gap. A crash before the ID response remains an
explicit recovery limitation. Duplicate-outbox proof lands with Joining's first
notification producer, not an unused Caches bridge.

Real email sign-in requires separately approved Resend/domain setup and a local
provider key. Delivery is awaited with a 10-second abort deadline. Better Auth
1.7.7 catches callback rejections, so a request-local delivery result maps failures
to generic JSON `502 email_unavailable`; a rate-limited request remains 429.

## Validation

```bash
npx --no-install tsc --noEmit
npx --no-install vitest run
(cd web && npx --no-install tsc --noEmit && npm run build)
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler d1 migrations apply communalcache --local
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx --no-install wrangler deploy --dry-run
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
