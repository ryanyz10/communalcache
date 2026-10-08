# Communal Cache

Mobile-first household sharing: React + a TypeScript Cloudflare Worker, one SQLite
Durable Object per cache and global D1. Foundation implements private cookie-auth
sessions, six-digit email sign-in codes and display-name onboarding. Caches,
joining, private R2 photos and Queue notifications follow in feature order.
No addresses, holder tracking or loan tracking. Target: https://communalcache.com.

## Status and docs

Foundation is implemented for review. The `communalcache` D1 database was created
with approval and its real ID is committed; remote migrations, deployments and
Resend/domain changes still require separate approval. The legacy Go/Fly/Supabase
app stays live until an explicitly approved cutover. Its source and deployment files remain reference;
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
further account/provider changes. No R2/Queue/Cron bindings are provisioned by Foundation.

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
CSRF/profile/delivery/concurrency behavior and invite retention. SQL is never
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
