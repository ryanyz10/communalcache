# Decision register and open follow-ups

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend language | Go | Good fit for HTTP/Postgres service with lower implementation overhead than Rust |
| Frontend | React + TypeScript + Vite | Typed browser code and conventional SPA build |
| Production runtime | One Go binary | Same-origin security and no Node backend |
| Identity | Supabase Auth | Managed OTP/MFA and identity lifecycle |
| Database | Supabase Postgres | Relational transactions, constraints, and RLS |
| Browser data path | Go API only | Central API contract and no direct database credentials |
| Database access | pgx + sqlc | Explicit SQL with generated typed Go code |
| API shape | REST `/api/v1` + OpenAPI | Clear language-neutral contract |
| Deployment | Fly.io OCI container | Portable Go service, regional placement, Machine model |
| Email | Resend + Go templates | Simple transactional delivery without Node runtime |
| Authorization | Go checks + forced Postgres RLS | Independent defense in depth |
| Cache roles | Owner and member | Minimum governance model |
| Join | Random code + shared password, immediate | Matches product concept and low-friction groups |
| Removed rejoin | Blocked until owner restore | Removal would otherwise be ineffective |
| Inventory | Aggregate balance, fixed unit | Simpler MVP than per-contribution lots |
| Mutation safety | Transaction + idempotency key | Handles retries and concurrent clients |
| Notifications | Requests and first item creation | Useful without emailing every change |
| Background work | Transactional Postgres outbox | No additional queue infrastructure |
| Billing | Free policy interface only | Preserves future enforcement point without speculative Stripe work |

## Security refinement

The original high-level plan suggested keeping Supabase access and refresh
tokens in secure browser cookies. This handoff instead specifies an opaque
application session cookie and server-side encrypted Supabase refresh token.

Reason:

- Two Fly Machines can otherwise race refresh-token rotation.
- Server-side sessions provide deterministic logout-all and revocation.
- Supabase tokens never enter browser JavaScript or browser storage.
- The browser still receives only secure, host-only, HttpOnly session material.

This refinement does not replace Supabase identity; it defines the application's
session boundary around it.

## Defaults that may be tuned without product approval

Tune using tests/observations and document the change:

- DB pool size and connection lifetimes.
- HTTP and provider timeouts.
- Outbox poll interval, batch size, lease, and retry jitter.
- Argon2 parameters at or above current security minimum.
- Log level and metric sampling.
- Fly request concurrency limits.
- UI query stale times.

Do not tune away security bounds, transactionality, member limits, or retention
without updating the relevant specification.

## Operator choices required during environment setup

These cannot be chosen in source:

- Production domain.
- Supabase project and region.
- Nearest/lowest-latency Fly region.
- Resend sending/support addresses and DNS domain.
- Fly monthly budget threshold.
- Supabase backup/PITR plan.
- Legal operator name, jurisdiction-specific privacy text, and support contact.

The implementation must expose configuration/checklists for each and fail safe
when a required production value is absent.

## Pre-public-launch follow-ups

These are not feature-development blockers but are launch blockers:

- Publish privacy policy and terms.
- Establish operator account deletion/data export process.
- Configure and test backup restoration.
- Verify SPF, DKIM, and DMARC.
- Perform an independent security review.
- Choose monitoring/log-retention provider if Fly defaults are inadequate.
- Record incident contacts and secret owners.

## Deferred product decisions

Do not decide or implement these in MVP:

- Cache pricing unit: per owner, per cache, per member, or usage tier.
- Ownership transfer/delegated admins.
- Permanent cache deletion.
- Expiration dates and per-contribution lots.
- Unit conversion.
- SMS/push notification consent and providers.
- Native mobile clients.
- Public API access and third-party OAuth.
- Offline private data.

When revisiting one, update product, data, API, security, tests, and operations
documents together before implementation.

## Known tradeoffs

### Shared cache password

It is easy to share but cannot identify who disclosed it. Mitigations are a
high-entropy join code, Argon2id, rate limits, owner rotation, verified account
requirement, and a removal block independent of the password.

### Aggregate quantity

It cannot represent separate expirations, owners, or batches. The immutable
transaction history preserves contribution evidence, but the displayed balance
is one unit per item.

### Email OTP

Security depends on the user's email account and provider. Optional TOTP raises
assurance. No insecure backup questions or application-created password reset
flow are added.

### In-process worker

It avoids another paid service but couples delivery throughput to active API
Machines. Postgres leases make it horizontally safe and allow later extraction
without changing the outbox.

### RLS with application context

The application database role can set transaction-local `app.user_id`, so RLS
does not protect against total compromise of the Go runtime/database
credential. It does protect against query mistakes and cross-tenant omissions.
Go authorization, narrow grants, parameterized SQL, secret isolation, and
runtime hardening remain necessary.

### No self-service account deletion

This reduces initial destructive lifecycle complexity but requires a documented
operator process before public launch. Historical cache integrity uses
anonymization rather than deleting other members' audit history.
