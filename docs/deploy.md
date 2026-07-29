# Deploying to Fly.io

How this app gets to production. Read [database.md](database.md) first if you do
not yet have a working `DATABASE_URL`.

## One-time provider setup

A deploy without these comes up healthy and cannot log anyone in.

### Supabase

1. **Disable the Data API** (Project Settings → API / Data API). This app never
   uses PostgREST; the browser talks only to the Go API. Leaving it on is the
   exposure the `app` schema design exists to close — do this _before_ the first
   deploy.
2. **Asymmetric JWT signing keys** (Auth → JWT / Signing keys). Go validates
   tokens against the JWKS; shared secrets must not reach the server.
3. **Site URL** = your Fly app URL (e.g. `https://communalcache.fly.dev`).
4. **Redirect allowlist** — wildcards, not bare origins:
   - `{APP_BASE_URL}/join/*` for production invites
   - `http://localhost:5173/**` for local Vite (a bare origin does **not** match
     `/join/:token`)
5. **Custom SMTP** via Resend (Auth → SMTP). Create a Resend account, add your
   sending domain, publish the SPF and DKIM records Resend shows you, wait until
   the domain verifies, then paste Resend's SMTP settings into Supabase.
   `EMAIL_FROM` must be an address on that verified domain.

   Magic links go through Supabase's SMTP config. Notification email (Phase 6)
   calls the Resend HTTP API from Go and uses a separate Fly secret
   `RESEND_API_KEY`. The two paths are independent; each can fail on its own.
   For Phase 2 you only need the Supabase SMTP path — do **not** put the Resend
   key in Fly secrets yet unless you want it ready early.

### Resend domain checklist

1. [resend.com](https://resend.com) → Domains → Add.
2. Copy SPF + DKIM (and any other records shown) into your DNS host.
3. Wait for "Verified". Propagation is often minutes, sometimes longer.
4. Configure Supabase custom SMTP with Resend's host/port/user/password.
5. Send a test magic link after deploy.

## Install flyctl

```bash
# macOS
brew install flyctl

fly auth login
```

Confirm the app name in [`fly.toml`](../fly.toml) matches your Fly app
(`communalcache`).

## Secrets vs `[env]`

`[env]` in `fly.toml` is plain config checked into git (`LISTEN_ADDR`). Secrets
are set once on the app and never appear in the repo.

**Do not put secret values on a `fly secrets set` command line.** Anything on
argv is recorded in shell history and visible to other processes via `ps` —
that is how a database password leaked in an earlier session. Non-secret
config may go through a heredoc into `fly secrets import`; every actual secret
is read silently and piped on stdin.

Phase 2 — needed for login (`DATABASE_URL` session mode / direct, never port
6543 — see [database.md](database.md)):

```bash
# Non-secrets via heredoc (safe to type / paste into the script).
fly secrets import -a communalcache <<'EOF'
SUPABASE_URL=https://xxxx.supabase.co
APP_BASE_URL=https://communalcache.fly.dev
EOF

# Secrets via silent read → stdin. Subshell discards values even on failure.
( read -rs 'anon?SUPABASE_ANON_KEY: '; echo
  printf 'SUPABASE_ANON_KEY=%s\n' "$anon" | fly secrets import -a communalcache )

( read -rs 'pw?DB password: '; echo
  enc=$(printf '%s' "$pw" | python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))')
  printf 'DATABASE_URL=postgresql://postgres.<ref>:%s@aws-0-<region>.pooler.supabase.com:5432/postgres\n' "$enc" \
    | fly secrets import -a communalcache )

# Phase 4 — photos (when you get there): same stdin pattern for
# SUPABASE_SERVICE_ROLE_KEY.

# Phase 6 — notifications: RESEND_API_KEY, EMAIL_FROM, VAPID_PUBLIC_KEY,
# VAPID_PRIVATE_KEY — same stdin pattern; never inline on argv.
```

## What the Dockerfile does

Multi-stage build in [`Dockerfile`](../Dockerfile):

1. **node** — `npm ci` / `npm run build` for the SPA in `web/`.
2. **golang** — compile `cmd/server` with the SPA `dist/` embedded.
3. **distroless** — copy the static binary only; no shell, nonroot user.

Locally you can mirror that with `make web-build && go build -o bin/communalcache ./cmd/server`.

## First deploy

```bash
fly deploy
curl -sS https://communalcache.fly.dev/api/healthz
# {"status":"ok"}
```

`fly.toml` keeps `min_machines_running = 1` and `auto_stop_machines = "off"` so
the outbox worker (Phase 6) actually runs. Auto-stop would delay notifications
until traffic wakes the machine.

## Logs and health

```bash
fly logs
fly status
curl -sS https://communalcache.fly.dev/api/healthz
curl -sS https://communalcache.fly.dev/api/config
```

`/api/config` must return `supabase_url`, `supabase_anon_key`, `vapid_public_key`,
and `app_base_url`. It must **never** return the service role key.

## Hosted Data API boundary (operator smoke, not CI)

Occasional check that PostgREST cannot read `app` tables over HTTP. It is **not**
part of `make test` (build tag `hosted`). Local SQL boundary tests cover
grants/RLS; this probe covers the gateway / Data API console setting.

Needs only `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `.env` (both public —
the anon key is served to every browser from `/api/config`):

```bash
make boundary-http
```

Use the legacy JWT anon key (`eyJ…`), not `sb_publishable_…`. Accepted denials
include 404, 401/403, `PGRST106`, SQLSTATE `42501`, and `503`/`PGRST002` (Data
API off / schema cache unusable). Any **2xx** is a failure.

## Rolling deploys and migrations

Fly overlaps old and new machines during a rolling deploy. Both processes call
`Migrate` on boot. The runner takes `pg_advisory_lock` on a dedicated connection
so only one migrates; the other waits. That is why session mode matters, and why
the lock is not taken from the pool.

### This release is a one-way door

The migration ledger moved from `public.schema_migrations` to
`app.schema_migrations`. Once a new binary has dropped the public table, an
**older** binary rolled back on top will:

1. Look for `public.schema_migrations`, not find it.
2. Create an empty public ledger.
3. Try to re-run `001_init.sql` against a schema that already exists — and fail.

Rolling back across the ledger relocation means **rolling forward** (redeploy the
new binary), not deploying an older image. Document any emergency plan
accordingly.

## Rollback (normal)

```bash
fly releases
fly deploy --image <previous-image>
```

Prefer fixing forward when the failed release included a migration. After the
ledger move above, prefer fixing forward always for that release.
