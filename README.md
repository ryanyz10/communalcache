# Communal Cache

Mobile-first household sharing app: React + Go + Postgres (Supabase Auth/Storage),
web push + Resend email, deployed on Fly.io.

## Docs

- **[docs/build-guide.md](docs/build-guide.md)** — phase-by-phase implementation guide:
  build order, concepts, the traps worth slowing down for, and the check that proves
  each phase. Start here.
- **[docs/plan.md](docs/plan.md)** — the spec. Data model, per-route authorization,
  delivery semantics, known tradeoffs.
- **[docs/database.md](docs/database.md)** — Postgres connection string, session vs
  transaction mode, local test DB, migration ledger.
- **[docs/deploy.md](docs/deploy.md)** — Fly deploy, secrets, Supabase/Resend setup,
  rollback (including the ledger one-way door).
- **[AGENTS.md](AGENTS.md)** — invariants and conventions, read automatically by coding
  agents.

## Status

Phases 1–2 done and deployed (https://communalcache.fly.dev): schema + migration
ledger in `app`, health/config, JWT auth, `GET`/`PATCH /api/me`, magic-link login
and display-name onboarding (verified locally and on Fly). Providers configured;
hosted PostgREST boundary passes. Next is Phase 3 (caches), by hand. See
[docs/build-guide.md](docs/build-guide.md).

## Layout

```
cmd/server/          Go entrypoint + embedded SPA dist/
internal/
  api/               HTTP handlers (auth middleware, /api/me)
  auth/              JWKS JWT validation
  config/            Env config
  db/                pgx pool + migrations + boundary tests
  dbtest/            Shared TEST_DATABASE_URL helper (exclusive lock)
  notify/            Push + email (pending)
  outbox/            Delivery worker (pending)
web/                 Vite + React + TypeScript SPA (Tailwind, react-router, TanStack Query)
```

## Local

Put vars in a gitignored `.env` at the repo root (Make loads them). Never point
`TEST_DATABASE_URL` at the hosted Supabase project. Session mode / direct —
not Supavisor transaction port 6543. See [docs/database.md](docs/database.md).

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/communalcache?sslmode=disable
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/communalcache?sslmode=disable
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...
APP_BASE_URL=http://localhost:5173
```

```bash
make test && make vet && test -z "$(gofmt -l .)"   # backend gates
make dev                                          # :8080; needs .env
# GET /api/healthz
# GET /api/config  (includes app_base_url)

# Frontend (proxies /api → :8080)
cd web && npm ci && npm run dev
```

Production build embeds the SPA:

```bash
make web-build
go build -o bin/communalcache ./cmd/server
```

Hosted PostgREST boundary (separate from `make test`):

```bash
make boundary-http
# needs SUPABASE_URL + SUPABASE_ANON_KEY from .env
```

## Deploy

See [docs/deploy.md](docs/deploy.md). Phase 2 secrets: `DATABASE_URL`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_BASE_URL` (stdin import — never on
argv). Phase 4 adds `SUPABASE_SERVICE_ROLE_KEY`.

Later: `RESEND_API_KEY`, `EMAIL_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.

One-time Supabase: disable Data API; asymmetric JWT keys; Resend as custom SMTP;
redirect allowlist `{APP_BASE_URL}/join/*` and `http://localhost:5173/**`; private
storage bucket with no policies. `DATABASE_URL` must be direct or Supavisor
**session** mode.
