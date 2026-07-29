# Database connection

How this app talks to Postgres, and how to set that up without shooting yourself in
the foot. Aimed at someone who has not done this before.

## What you need from Supabase

1. Open your project in the [Supabase dashboard](https://supabase.com/dashboard).
2. Go to **Project Settings → Database**.
3. Under **Connection string**, pick **URI**.
4. Choose **Session mode** (or the direct connection). Copy that URI.

**Never use port 6543 (transaction mode / transaction pooling).** The migration
runner holds a session-scoped advisory lock on one connection for the whole run.
Transaction pooling multiplexes many clients onto one backend connection per
transaction, which silently turns that lock into a no-op — two Fly machines
deploying at once would both migrate. It also breaks pgx's prepared-statement
cache. Session mode (or a direct connection) keeps one backend session for the
life of the client connection, which is what the lock needs.

Paste the URI into a local `.env` (gitignored) or into Fly secrets — never into
the repo:

```bash
export DATABASE_URL='postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
```

For local tests against Docker Postgres, use a separate URL and **never** point
it at the hosted project:

```bash
export TEST_DATABASE_URL='postgres://postgres:postgres@localhost:5432/communalcache?sslmode=disable'
```

`TEST_DATABASE_URL` is what `go test` uses. Later phases insert and delete under
concurrency. If that URL is your production database, those tests will mutate
live data. The hosted Data API boundary check uses **`HOSTED_DATABASE_URL`** on a
read-only transaction and runs only via `make boundary-http` — never as part of
`go test ./...`.

## What a connection pool is

Opening a TCP connection and authenticating to Postgres is expensive, so the app
keeps a small pool of ready connections (`pgxpool`) and borrows one per request.

Migrations are different. An advisory lock is **session-scoped**: it lives on
one backend connection until that connection releases it. If the runner borrowed
a connection from the pool, ran `pg_advisory_lock`, returned the connection, then
borrowed another for the SQL, the lock and the work would be on different
sessions and protect nothing. So `Migrate` calls `pool.Acquire`, holds that one
connection for the whole run, and only then releases it.

## Local Postgres for tests

```bash
docker run -d --name cc-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=communalcache postgres:16

export TEST_DATABASE_URL='postgres://postgres:postgres@localhost:5432/communalcache?sslmode=disable'
go test ./internal/db -count=1 -v
```

Vanilla Postgres has no `anon` / `authenticated` roles — Supabase provisions
those. Migration `001` creates them if missing so `REVOKE` does not fail locally.

## Verifying a migration applied

`psql` is optional. With the Docker container:

```bash
docker exec cc-pg psql -U postgres -d communalcache -c \
  'SELECT filename, applied_at FROM app.schema_migrations ORDER BY filename;'
```

Or with Go:

```bash
go run ./cmd/server   # migrates on boot; then Ctrl-C
```

The ledger is `app.schema_migrations` — filename primary key, applied timestamp.
It used to live in `public`; that was a security hole (PostgREST exposes
`public` to the browser's anon key). It now lives in `app` with the same RLS
deny-all wall as every other table. **Do not recreate it in `public`.**

## One-time Supabase console setup (auth / storage)

These are not connection-string settings, but you will need them before login
works. Details and order live in [deploy.md](deploy.md):

- Disable the Data API (before the first deploy).
- Enable asymmetric JWT signing keys.
- Site URL + redirect allowlist (`{APP_BASE_URL}/join/*` and local Vite origin).
- Resend as custom SMTP for magic links.
- Private storage bucket with no `storage.objects` policies (Phase 4).
