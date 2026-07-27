# Communal Cache

Mobile-first household sharing app: React + Go + Postgres (Supabase Auth/Storage),
web push + Resend email, deployed on Fly.io.

## Docs

- **[docs/build-guide.md](docs/build-guide.md)** — phase-by-phase implementation guide:
  build order, concepts, the traps worth slowing down for, and the check that proves
  each phase. Start here.
- **[docs/plan.md](docs/plan.md)** — the spec. Data model, per-route authorization,
  delivery semantics, known tradeoffs.
- **[AGENTS.md](AGENTS.md)** — invariants and conventions, read automatically by coding
  agents.

## Status

Scaffold only: schema migration, health/config endpoints, embed SPA shell,
Dockerfile, and `fly.toml`. Feature work (auth, caches, items, requests,
notifications) is next.

## Layout

```
cmd/server/          Go entrypoint + embedded SPA dist/
internal/
  api/               HTTP handlers
  auth/              JWT validation (pending)
  config/            Env config
  db/                pgx pool + migrations
  notify/            Push + email (pending)
  outbox/            Delivery worker (pending)
web/                 Vite + React + TypeScript SPA
```

## Local

```bash
# Postgres (session mode / direct — not Supavisor transaction port 6543)
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/communalcache?sslmode=disable

go run ./cmd/server
# GET /api/healthz
# GET /api/config
```

Frontend:

```bash
cd web && npm ci && npm run dev
```

Production build embeds the SPA:

```bash
make web-build
go build -o bin/communalcache ./cmd/server
```

## Deploy

Secrets: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `APP_BASE_URL`.

One-time Supabase: disable Data API; asymmetric JWT keys; Resend as custom SMTP;
redirect allowlist `{APP_BASE_URL}/join/*`; private storage bucket with no policies.
`DATABASE_URL` must be direct or Supavisor **session** mode.
