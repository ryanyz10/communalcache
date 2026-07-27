# System architecture

## Context

The system has four external dependencies:

- A browser running the React SPA.
- A Fly.io application running the Go binary.
- A Supabase project providing Postgres and Auth.
- Resend providing email delivery.

The browser communicates only with the Go application's origin. It does not
receive Supabase database credentials, refresh tokens, Resend keys, or direct
PostgREST access.

```text
Browser
  | HTTPS: static assets + /api/v1
  v
Fly Proxy
  |
  v
Go binary
  +-- React assets embedded with go:embed
  +-- REST handlers and auth proxy
  +-- domain services
  +-- outbox worker
  |
  +------ TLS ------> Supabase Auth
  +------ TLS ------> Supabase Postgres
  +------ TLS ------> Resend API
```

## Repository layout

The implementation SHOULD use this layout:

```text
.
├── api/
│   └── openapi.yaml
├── cmd/
│   └── communalcache/
│       └── main.go
├── db/
│   ├── migrations/
│   ├── queries/
│   └── sqlc.yaml
├── internal/
│   ├── api/
│   ├── auth/
│   ├── config/
│   ├── database/
│   ├── domain/
│   ├── email/
│   ├── middleware/
│   ├── observability/
│   └── worker/
├── web/
│   ├── src/
│   ├── public/
│   └── package.json
├── Dockerfile
├── fly.toml
├── go.mod
└── Makefile
```

Generated code belongs under `internal/api/generated`,
`internal/database/generated`, and `web/src/api/generated`. Generated files
MUST carry a generated-file header and MUST NOT be hand-edited.

## Runtime components

### HTTP server

- Use the current stable Go release pinned in `go.mod` and the container image.
- Use `net/http.ServeMux` method/path patterns; do not add a web framework
  without a documented need.
- Middleware order:
  1. Request ID
  2. Real-client IP extraction from trusted Fly headers
  3. Panic recovery
  4. Security headers
  5. Access logging
  6. Body-size enforcement
  7. Origin/CSRF enforcement for unsafe API requests
  8. Authentication
  9. Route handler
- Public routes: SPA assets, health endpoints, login-code request, login-code
  verification, and explicit session refresh.
- All other `/api/v1` routes require an active application session.
- Unknown `/api/*` paths return JSON `404`; other unknown paths serve
  `index.html` for client-side routing unless they look like missing static
  assets.

### Domain services

Handlers MUST be thin. They validate transport input, call a domain service,
and map typed errors to the API error contract.

Domain services own:

- Cache creation policy and credential generation.
- Membership state transitions and role checks.
- Inventory transactions.
- Request state transitions.
- Activity event creation.
- Notification selection and outbox insertion.
- Recent-authentication enforcement.

Domain services MUST accept the authenticated actor as an explicit immutable
argument and MUST never accept a caller role from the client.

### Database layer

- Use `pgxpool` for connections and `sqlc` for query code.
- Start with `MaxConns=5` per Machine, `MinConns=0`, five-minute idle timeout,
  and 30-minute maximum connection lifetime. Tune only against Supabase
  connection limits and measured demand.
- Every authenticated application operation executes in a transaction:
  1. Begin transaction.
  2. Set `app.user_id` with transaction-local `set_config`.
  3. Execute typed queries.
  4. Commit before writing the HTTP response.
- Do not keep database transactions open while calling Supabase Auth, Resend, or
  any other network service.
- Use a distinct pool/role for the outbox worker.
- Migrations use a separate privileged connection and never run implicitly on
  application startup.

### Authentication adapter

The Go service owns the browser session boundary while Supabase owns identity,
email verification, and MFA.

To avoid refresh-token races across multiple Machines, the browser receives an
opaque application session cookie rather than raw Supabase tokens:

- After Supabase verifies the email code/MFA, Go creates a 256-bit random
  session identifier.
- Store only a SHA-256 digest of the identifier in Postgres.
- Store the Supabase refresh token encrypted with AES-256-GCM in the private
  session row. The encryption key is a Fly secret and supports key versioning.
- The cookie contains the opaque identifier and uses the `__Host-` prefix,
  `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`.
- Session refresh takes a row lock, preventing concurrent refresh-token use
  across Machines.
- Supabase access tokens may exist only in memory during verification/refresh;
  they are not persisted or sent to the browser.
- If email verification succeeds but an enrolled factor still requires a
  challenge, create a short-lived `pending_mfa` application session. Middleware
  permits that session to access only session inspection, MFA challenge/verify,
  and logout. Successful MFA atomically rotates the opaque identifier and
  elevates the row to `active`.

This is an intentional hardening refinement of the earlier concept of storing
Supabase tokens directly in cookies. Identity remains managed; application
session concurrency and revocation are deterministic.

### Notification worker

- Run an outbox polling loop in every active server process.
- Claim work with `FOR UPDATE SKIP LOCKED` and a short transaction.
- Network delivery occurs after the claim transaction commits.
- Lease expiration lets another worker reclaim jobs abandoned by a crash.
- Graceful shutdown stops claiming jobs and gives active sends a bounded time
  to finish.
- Duplicate claims and retries are safe because every delivery has a stable
  provider idempotency key.

## Build architecture

The Dockerfile uses three stages:

1. A pinned Node image installs frontend dependencies with a frozen lockfile,
   typechecks, tests as configured, and produces `web/dist`.
2. A pinned Go image generates/validates code as appropriate and builds a
   statically linked binary with the frontend assets embedded.
3. A minimal non-root runtime image contains the binary, CA certificates, and
   timezone data only.

The production image MUST NOT contain Node, npm caches, source maps, source
files, compilers, a shell unless operationally justified, or credentials.

## Commands

The binary SHOULD expose:

```text
communalcache serve
communalcache worker --once
communalcache migrate up
communalcache migrate status
communalcache version
```

`serve` starts both the HTTP server and continuous outbox worker. `worker
--once` exists for recovery and manual draining. Migration commands require the
migration database URL and MUST refuse to use the normal application role.

The Makefile SHOULD provide:

```text
make dev
make generate
make check-generated
make test
make test-integration
make test-e2e
make lint
make build
make docker-build
```

## Configuration

Configuration is read once on startup, validated, and represented as a typed
immutable struct. Required categories:

- Environment and public base URL
- HTTP address and timeout values
- Application, worker, and migration database URLs
- Supabase project URL and publishable/secret server credentials
- Supabase issuer, audience, and JWKS URL
- Session encryption key ring and active key ID
- Session idle/absolute/recent-authentication durations
- Resend API key, verified sender, and reply-to address
- HMAC key used to pseudonymize rate-limit identifiers
- Worker polling, lease, batch, and retry settings
- Log level and release identifier

Startup MUST fail on missing production configuration, malformed URLs, weak key
material, insecure public HTTP URLs, or accidental reuse of database roles.

## Portability boundary

Fly-specific behavior is limited to deployment configuration and trusted proxy
header parsing. The application:

- Listens on a configured TCP port.
- Uses standard environment variables.
- Writes logs to stdout/stderr.
- Stores no durable state on local disk.
- Exposes liveness and readiness endpoints.
- Handles SIGTERM gracefully.

These constraints allow later deployment to Railway, Render, or Cloud Run
without changing domain code.
