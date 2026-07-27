# Deployment and operations

## Environments

Use separate local, staging, and production environments:

- Separate Supabase projects for staging and production.
- Separate Resend API keys and sending modes.
- Separate Fly apps, domains, secrets, and database roles.
- Never copy production personal data into staging.
- Local development uses Supabase CLI or an equivalent local Postgres/Auth
  setup with fake mail delivery.

Production and staging use the same Dockerfile and commands.

## Fly.io topology

- One Fly app per environment.
- Primary region is the Fly region with the lowest measured network latency to
  the selected Supabase project. Prefer database proximity over user proximity
  because every dynamic request reaches Postgres.
- Start with two 512 MiB shared-CPU Machines.
- Configure:

```toml
[http_service]
  internal_port = 8080
  force_https = true
  auto_start_machines = true
  auto_stop_machines = "stop"
  min_machines_running = 1

  [http_service.concurrency]
    type = "requests"
    soft_limit = 50
    hard_limit = 75
```

- The second Machine may stop when idle and starts for capacity/failover.
- No Fly Volume is attached.
- The active Machine runs HTTP and the outbox worker.
- Scale memory/CPU only after observing OOM, latency, connection, and Argon2
  verification metrics.

Do not assume two Machines provide zero downtime if both depend on one database
or bad release. Health checks, rollout behavior, and rollback remain required.

## Network and TLS

- Fly terminates public TLS.
- Application listens on `0.0.0.0:$PORT`.
- Redirect HTTP to HTTPS at the proxy and reject unexpected forwarded hosts in
  the application.
- Use a custom production domain.
- Add HSTS only after the domain and all required subdomains are confirmed on
  HTTPS.
- Database connections require TLS verification.
- Restrict Supabase network access when plan/features allow without breaking
  Fly's egress model.

## Health and lifecycle

Fly checks:

- `/health/live` every 15 seconds, short timeout.
- `/health/ready` for rollout readiness, with a database timeout below two
  seconds.

Go server defaults:

- Read header timeout: 5 seconds.
- Read timeout: 15 seconds.
- Write timeout: 30 seconds.
- Idle timeout: 60 seconds.
- Maximum headers: bounded.
- Graceful shutdown budget: 20 seconds.

SIGTERM sequence:

1. Mark readiness false.
2. Stop accepting/claiming new work.
3. Shutdown HTTP server.
4. Finish or release active notification leases.
5. Close database pools.
6. Exit before Fly's kill timeout.

## Build and release

CI release steps:

1. Check formatting, generated-code drift, lint, typecheck, unit tests, race
   tests, integration tests, and security scans.
2. Build the multi-stage Docker image once.
3. Scan image and generate SBOM.
4. Tag with immutable commit SHA and human release name.
5. Push to registry.
6. Apply backward-compatible migrations with migration role.
7. Deploy the exact tested image digest to staging.
8. Run staging smoke tests.
9. Promote the same digest to production.
10. Run production smoke tests and observe error/latency/job metrics.

Never rebuild between staging and production.

## Migration policy

- Migrations are timestamped, immutable after merge, and transaction-wrapped
  where PostgreSQL permits.
- Take expand/contract steps:
  1. Add nullable/default-compatible schema.
  2. Deploy code supporting old and new forms.
  3. Backfill in bounded batches if needed.
  4. Enforce constraints.
  5. Remove old fields only in a later release.
- Avoid table-rewriting defaults and long locks on growing tables.
- Set statement and lock timeouts for migrations.
- Migration command takes an advisory lock and records version/checksum.
- Application readiness fails when required migrations are missing, but the app
  never auto-migrates.
- Rollback normally means rolling application code back while leaving
  expand-compatible schema in place. Down migrations are not a production
  recovery strategy for destructive changes.

## Secrets and configuration

Fly secrets must include:

- Application and worker database URLs
- Migration URL only in the release/migration context
- Supabase URL and server credentials
- Session encryption key ring and active key ID
- Cursor signature and rate-limit HMAC keys
- Resend API key

Non-secret configuration may remain in `fly.toml` or environment variables.

### Environment variable contract

The implementation MUST use and document these stable names. Durations use Go
duration syntax. Key-ring JSON values map key IDs to base64url-encoded 32-byte
keys.

| Variable | Secret | Required in production | Default/meaning |
|---|---:|---:|---|
| `APP_ENV` | No | Yes | `local`, `staging`, or `production` |
| `APP_RELEASE` | No | Yes | Immutable image/commit identifier |
| `PUBLIC_BASE_URL` | No | Yes | Exact HTTPS origin |
| `HTTP_ADDR` | No | No | `:8080` |
| `DATABASE_URL` | Yes | Yes | `communal_app` connection |
| `WORKER_DATABASE_URL` | Yes | Yes | `communal_worker` connection |
| `MIGRATION_DATABASE_URL` | Yes | Release only | `communal_migrator` connection |
| `SUPABASE_URL` | No | Yes | Project HTTPS URL |
| `SUPABASE_PUBLISHABLE_KEY` | No | Yes | Server-to-Auth API identification |
| `SUPABASE_SECRET_KEY` | Yes | Yes | Server-only admin/session operations; never exposed to Vite |
| `SUPABASE_JWT_ISSUER` | No | Yes | Exact issuer |
| `SUPABASE_JWT_AUDIENCE` | No | Yes | Exact audience allowlist |
| `SUPABASE_JWKS_URL` | No | Yes | Project asymmetric JWKS |
| `SESSION_KEYS_JSON` | Yes | Yes | Versioned AES key ring |
| `SESSION_ACTIVE_KEY_ID` | No | Yes | Key used for new encryption |
| `CURSOR_HMAC_KEYS_JSON` | Yes | Yes | Signed cursor key ring |
| `CURSOR_ACTIVE_KEY_ID` | No | Yes | Key used for new cursors |
| `RATE_LIMIT_HMAC_KEY` | Yes | Yes | Pseudonymous limiter digests |
| `RESEND_API_KEY` | Yes | Yes | Notification delivery |
| `EMAIL_FROM` | No | Yes | Verified sender mailbox |
| `EMAIL_REPLY_TO` | No | Yes | Monitored support mailbox |
| `LOG_LEVEL` | No | No | `info` in production |

Optional tuning variables with compiled safe defaults:

```text
HTTP_READ_HEADER_TIMEOUT=5s
HTTP_READ_TIMEOUT=15s
HTTP_WRITE_TIMEOUT=30s
HTTP_IDLE_TIMEOUT=60s
HTTP_SHUTDOWN_TIMEOUT=20s
HTTP_MAX_BODY_BYTES=1048576
DB_MAX_CONNS=5
DB_MIN_CONNS=0
DB_MAX_CONN_IDLE_TIME=5m
DB_MAX_CONN_LIFETIME=30m
SESSION_IDLE_TIMEOUT=168h
SESSION_ABSOLUTE_TIMEOUT=720h
SESSION_PROVIDER_VERIFY_INTERVAL=15m
SESSION_RECENT_AUTH_WINDOW=10m
OUTBOX_POLL_INTERVAL=5s
OUTBOX_IDLE_INTERVAL=30s
OUTBOX_BATCH_SIZE=20
OUTBOX_LEASE_DURATION=2m
```

An `.env.example` contains the names and safe local placeholders only. It MUST
not contain values that are accepted by staging or production.

Deployment MUST validate:

- Public origin and environment
- Distinct database usernames/roles
- Key lengths and active key presence
- HTTPS provider/base URLs
- Verified Resend sender
- Allowed Host values

Rotation runbooks:

- Session encryption keys: add new key, make active, retain old decrypt key
  through maximum session lifetime, then remove.
- HMAC/cursor keys: accept current and previous key during a bounded rotation
  window.
- Provider/database secrets: rotate provider-side, update Fly secret, rolling
  deploy, revoke old credential.

## Observability

Use structured JSON logs through stdout. Connect Fly log export to a searchable
retention service before public launch if Fly's default retention is
insufficient.

Metrics:

- Request count, error count, and latency by method/route/status class.
- Active DB connections, acquisition wait, query duration, transaction rollback.
- Auth request/verify/refresh outcomes without emails.
- Rate-limit blocks by action.
- Inventory conflict/insufficient-stock rates.
- Outbox metrics defined in the notifications document.
- Go runtime memory, goroutines, GC, CPU, restarts, and OOM.
- Build release and Machine region.

Initial service objectives:

- 99.5% successful API availability monthly, excluding planned maintenance.
- p95 authenticated read latency below 500 ms in the primary region under
  normal MVP load.
- p95 inventory mutation below 750 ms excluding Argon2/login operations.
- 99% of notifications attempted within 5 minutes.

Alerts:

- Five-minute API `5xx` ratio over 5%.
- Readiness failures or no healthy Machine.
- Database connection exhaustion/acquisition p95 over one second.
- Repeated panic recovery or OOM/restart loop.
- Notification thresholds from its document.
- Supabase/Resend auth failure.
- Fly spend threshold at 50%, 80%, and 100% of the operator-defined budget.

## Backups and recovery

- Enable the appropriate Supabase automated backup/PITR offering before
  production data is important.
- Document retention and recovery point objective from the purchased plan; do
  not claim capabilities the plan does not provide.
- Perform and record a staging restore drill before launch and at least
  quarterly.
- Target initial objectives:
  - RPO: 24 hours until PITR is enabled; then provider-supported objective.
  - RTO: 4 hours for MVP.
- Export migration history and configuration separately from data backups.
- Email provider logs are not a source of truth; the outbox is.
- Local Fly filesystem is disposable and excluded from recovery.

## Incident runbooks

Create concise operator runbooks for:

### Database unavailable

- Confirm provider status and connectivity.
- Readiness should remove Machines from traffic while liveness remains healthy.
- Do not accept mutations into memory.
- Restore traffic only after transactional health succeeds.

### Bad application release

- Halt rollout.
- Roll back to previous image digest.
- Verify schema compatibility and smoke workflows.
- Record incident and add regression test.

### Suspected secret exposure

- Identify credential and blast radius.
- Rotate/revoke immediately.
- Revoke sessions if session keys/tokens are implicated.
- Review audit/access logs.
- Notify affected users/regulators when required.

### Notification backlog

- Check provider health and circuit breaker.
- Fix credentials/configuration.
- Run `worker --once` in bounded batches.
- Do not manually mark jobs sent without provider confirmation.

### Authorization vulnerability

- Disable affected endpoint or place app in maintenance mode.
- Preserve logs.
- Patch and test all role/cache variants.
- Review access evidence and follow breach procedure.

## Cost controls

- Configure Fly billing alerts before production.
- Keep one minimum running Machine and allow the standby to stop.
- Use no volume, Redis, separate worker, or multi-region deployment in MVP.
- Keep database pools small.
- Bound email fan-out with the product-level maximum active cache size of 100
  members.
- A cache reaching the limit returns a clear join failure to the user and an
  operator metric without revealing membership details.
- Reevaluate architecture and budgets before raising that cap or enabling paid
  product plans.

## Production launch checklist

- Custom domain and TLS verified.
- HSTS/CSP and all cookie attributes inspected in a real browser.
- Supabase asymmetric keys, redirect allowlist, OTP rate limits, MFA, and email
  templates configured.
- RLS forced and direct `anon`/`authenticated` grants revoked.
- Distinct database roles proven by tests.
- Resend SPF/DKIM/DMARC and sender verified.
- Fly health checks, graceful shutdown, one-running/one-standby behavior tested.
- Billing alerts and hard organizational budget documented.
- Backup restore drill passed.
- Privacy/terms/support/deletion process published.
- Security test suite and manual review passed.
- Operator runbooks accessible outside the production system.
