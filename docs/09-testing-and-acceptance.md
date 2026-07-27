# Testing and acceptance

## Test strategy

Use the smallest test level that proves the behavior:

- Go unit tests for pure validation, normalization, policies, crypto wrappers,
  error mapping, cursors, and template selection.
- PostgreSQL integration tests for transactions, constraints, roles, and RLS.
- Go HTTP integration tests for middleware, auth/session, API semantics, and
  concurrency.
- Frontend component tests for behavior and accessibility.
- Playwright for critical user journeys against a real Go server and test
  database/Auth substitute.
- Staging smoke and failure tests for real Supabase, Resend sandbox/test
  recipients, and Fly behavior.

Tests MUST be deterministic, isolated, parallel-safe where marked, and free of
production credentials.

## Local test infrastructure

- Use a disposable PostgreSQL container with the same major version and
  required extensions as Supabase.
- Apply real migrations before integration tests.
- Create real migrator/app/worker roles.
- Use transaction rollback or per-test schema/database isolation; do not rely
  on test order.
- Use an `httptest` Supabase Auth fake for most Go tests:
  - OTP accepted/rejected.
  - MFA required.
  - Refresh rotation/rejection.
  - JWKS rotation and malformed claims.
- Use a fake Resend server recording headers, idempotency keys, and bodies.
- Run a smaller staging suite against real providers before release.

## Unit tests

### Validation and normalization

- Cache, item, request, profile, password, note, and search length boundaries.
- Unicode trimming, NFKC, case folding, and whitespace collapse.
- Empty/whitespace-only and control-character inputs.
- Quantity min/max, three decimals, leading zeros, scientific notation, NaN,
  infinity, comma locale input, and negative zero.
- Join-code hyphen/case normalization and invalid alphabet.
- Email input normalization used only for rate-limit digests.

### Security utilities

- Session token generation entropy/length and digest.
- AES-GCM encrypt/decrypt, wrong key, wrong nonce/tag, key rotation.
- Constant-time CSRF comparison.
- Cursor sign/verify, tamper, wrong key, expiry, malformed data.
- Rate-limit HMAC versioning.
- Argon2 encoded parsing, verification, wrong password, Unicode, parameter
  upgrade, and semaphore limit.
- JWT algorithm allowlist, issuer, audience, expiry/not-before, missing subject,
  unknown key, and JWKS refresh.

### Domain policy

- Role/action matrix.
- Archived-cache behavior.
- Membership active/left/removed transitions.
- Owner invariants.
- Request transition table.
- Recipient selection and actor exclusion.
- Preference defaults.
- Cache creation policy allows every authenticated MVP user.

## Database integration tests

### Roles and grants

- `communal_app` cannot access `private` tables directly.
- `communal_worker` cannot modify cache, membership, inventory, or request rows.
- Supabase `anon`, `authenticated`, and Postgres `public` have no application
  access.
- Application cannot disable/bypass RLS.
- Inventory transactions and security audit rows reject update/delete.

### RLS matrix

For every selectable/mutable application table, test:

- Missing `app.user_id`.
- Malformed `app.user_id`.
- Unknown user.
- Unrelated authenticated user.
- Active member.
- Owner.
- Left member.
- Removed member.
- Active member of archived cache.

Test both ordinary queries and direct attempts to call constrained functions.
Test that pooled-connection reuse does not preserve a previous transaction's
user setting.

### Transactional behavior

- Cache creation either creates all required rows or none.
- Join state machine including collision, active retry, leave/rejoin,
  removed/rejected, restore, archive, member-cap enforcement, dummy-hash path,
  and concurrent joins.
- Concurrent first-add for the same normalized item creates one item and two
  correct transactions.
- Concurrent adds result in exact balance/log agreement.
- Concurrent takes near the remaining balance permit only valid total
  withdrawal.
- Failed take creates no transaction or receipt.
- Idempotent replay returns original response.
- Same idempotency key with altered body conflicts.
- Request transition race yields one terminal state and one conflict.
- Event and outbox rows commit with the triggering operation.
- Transaction rollback leaves no outbox orphan.
- Outbox `SKIP LOCKED`, lease expiration, and unique recipient/event behavior.

Property test the invariant:

```text
item.quantity =
  sum(add transaction quantities) - sum(take transaction quantities)
```

for generated valid operation sequences.

## HTTP/API tests

- Exact media types, statuses, headers, error shape, and request IDs.
- Malformed JSON, duplicate/unknown fields, wrong content type, oversized body,
  excessive strings, and invalid UTF-8.
- Authentication missing, expired, idle-expired, revoked, provider-rejected.
- OTP endpoint response equivalence for existing/nonexisting email.
- MFA challenge/enrollment/removal and recent-auth requirements.
- Session fixation prevention and logout/all-session revocation.
- Pending-MFA session route restrictions, expiry, and atomic elevation.
- Two simultaneous refreshes routed to different server instances using the
  shared session row lock.
- CSRF missing/wrong header, wrong/missing origin, safe methods, and login
  public routes.
- Cross-cache UUID substitution on every nested resource endpoint.
- Hidden-resource `404` behavior versus explicit owner/member `403`.
- ETag/If-Match success and stale conflict.
- Pagination stability when rows are inserted between pages.
- Search scoping and query bounds.
- Idempotency response replay and mismatch.
- Rate-limit atomicity across concurrent instances and correct `Retry-After`.
- Health endpoints reveal no secrets and enforce dependency timeouts.

## Notification tests

- Exact event/recipient matrix.
- Removed, left, actor, unverified-contact, and opted-out suppression.
- Template escaping for names/notes containing HTML/control-like text.
- Header injection rejection.
- Both HTML and text parts.
- Stable unique idempotency key.
- Retry classification for network, `4xx`, `429`, and `5xx`.
- Backoff/jitter bounds and maximum attempts.
- Crash after claim, lease recovery, and crash after provider success.
- Provider circuit breaker and recovery.
- Dead-letter metric/alert.
- Outbox payload retention reduction.

## Frontend tests

### Components

- Quantity input parsing/formatting without floating-point calculations.
- Forms show field and summary errors and preserve safe values.
- Passwords are cleared after failure.
- Role-based controls render appropriately.
- Archived and access-lost states.
- Loading, empty, error, conflict, and success states.
- Request status controls.
- Session-expired query cache clearing.
- Idempotency key retained across uncertain retry.
- Copy join-code fallback.

### Accessibility

Run axe plus manual assertions for:

- Page landmarks/headings.
- Labels/descriptions/error associations.
- Keyboard navigation and focus order.
- Dialog focus trap/restore/Escape behavior.
- Live status announcements.
- Color contrast and non-color state indicators.
- 200% zoom and 320 px viewport.
- Reduced motion.

### PWA

- Manifest validates and icons load.
- Public static assets work offline after first visit.
- `/api/*` and private HTML are never served from service-worker cache.
- Logout clears private query state.
- No IndexedDB/localStorage contains private API responses or credentials.
- Update prompt does not discard dirty form state.

## End-to-end journeys

1. New user requests code, verifies, completes profile, and creates a cache.
2. Owner copies join code; second user joins with code/password.
3. Wrong credentials and repeated failures remain generic and rate limited.
4. Member creates brown sugar, adds more, and another member takes some.
5. Two browsers attempt to take the last quantity; only a valid balance wins.
6. Member creates a green-onion request; another member fulfills it.
7. Activity and personal statistics reflect exact operations and units.
8. Member disables request email and no longer receives applicable mail.
9. Owner removes member; their open browser loses access and password rejoin
   fails; owner restores them.
10. Member leaves and successfully rejoins.
11. Owner rotates password; existing sessions remain, old password fails for a
    new join, new password succeeds.
12. Owner archives cache; reads work, mutations/joins fail; unarchive restores
    behavior.
13. User enrolls MFA, logs out, and completes MFA login.
14. Session expires/revokes without leaking stale private UI data.

## Performance and resilience tests

Initial synthetic target with representative data:

- 100 active caches for a user is out of expected use but list pagination
  remains bounded.
- One cache: 100 members, 1,000 items, 100,000 transactions, 10,000 requests.
- p95 targets from the operations document under 25 concurrent users.
- Inventory transaction remains correct under 50 concurrent operations on one
  item.
- Query plans use intended indexes and avoid sequential scans on large
  transaction/activity tables.
- Argon2 concurrency cannot OOM a 512 MiB Machine.
- Resend and Supabase timeouts do not exhaust HTTP or DB pools.

Fly staging:

- Kill the active Machine during reads and during outbox processing.
- Verify standby start/failover and eventual delivery.
- Deploy a new version under traffic and confirm graceful drain.
- Simulate database readiness failure.
- Roll back to the prior image digest.

## CI gates

Required on every change:

- Go formatting and generated-code drift.
- `go vet`, static analysis, unit tests, race tests where practical.
- `govulncheck`.
- SQL migration lint/checksum and sqlc generation.
- Database/RLS integration suite.
- Frontend formatting, lint, typecheck, unit/component tests.
- OpenAPI validation and backward-compatibility check.
- Secret scan.
- Dependency and license policy.

Required before release:

- Playwright full suite.
- Production image build and vulnerability scan.
- SBOM generation.
- Staging provider integration and smoke tests.
- Manual migration/rollback and security checklist review.

No flaky test is silently retried into passing status. Quarantine requires an
owner, issue, deadline, and retained signal.

## Acceptance criteria

The release candidate is accepted when:

- All defined journeys pass in staging.
- RLS matrix has explicit coverage for every application table.
- The inventory property invariant holds in generated/concurrency tests.
- Cross-cache access and member/owner escalation tests fail closed.
- No high/critical known dependency or container vulnerability remains without
  a documented risk acceptance.
- No private data or server secret appears in browser bundles, caches, logs, or
  test artifacts.
- Notification backlog drains after simulated failure without duplicates beyond
  documented provider ambiguity.
- Fly failover, health checks, graceful deployment, budget alert, and database
  restore have been exercised.
