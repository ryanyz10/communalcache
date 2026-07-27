# Security and privacy

## Security objectives

1. A user cannot read or mutate data for a cache without active membership.
2. A member cannot perform owner actions.
3. A removed user cannot regain access with the shared password.
4. Compromise of browser-visible configuration does not grant database,
   provider, or cross-cache access.
5. Cache and account credentials are never stored or logged in plaintext.
6. Retried/concurrent requests cannot corrupt inventory or duplicate actions.
7. External service failure cannot corrupt domain state.
8. Stored personal data is minimal, access-controlled, and removable through a
   defined operator process.

## Trust boundaries

- Browser input and headers are untrusted.
- Fly proxy headers are trusted only when the request arrived through the
  configured Fly environment; direct internal exposure is not allowed.
- Supabase JWT/identity claims are trusted only after verification with the
  configured issuer, audience, algorithm allowlist, expiry, and key ID.
- Database contents are not assumed to be authorization-safe without RLS and
  service checks.
- Resend responses are untrusted external input and are bounded before logging.
- User-authored names and notes are untrusted output in HTML and email.

## Authentication controls

- Managed email OTP and TOTP through Supabase.
- Opaque 256-bit application sessions; raw token digest only in storage.
- Encrypted refresh tokens using AES-256-GCM with random nonces and key IDs.
- Bind encryption to the session ID digest, user ID, and key ID as
  authenticated additional data so ciphertext cannot be swapped between rows.
- Key ring supports decrypting with previous keys while all new encryption uses
  the active key.
- Idle, absolute, and provider-verification expiry.
- Session fixation defense: always create a new session after successful login
  or MFA elevation.
- Login sessions awaiting MFA are short-lived `pending_mfa` sessions restricted
  to MFA/session routes and cannot authorize cache data.
- Revoke current/all sessions through both application storage and Supabase.
- Recent authentication for cache password rotation, member remove/restore,
  session revocation, MFA changes, and logout-all.
- No account passwords are implemented.

Recovery behavior:

- Loss of email access is handled by the email provider/Supabase support policy;
  the application does not create security questions or alternate identities.
- TOTP enrollment MUST present recovery implications before confirmation.
- TOTP recovery codes are not invented locally unless Supabase supports and
  owns their lifecycle.

## Authorization controls

- Deny by default in handlers, domain services, SQL grants, and RLS.
- Resource authorization derives cache ID from the loaded resource; never trust
  a request body cache ID to authorize a nested resource.
- Service methods use typed actor context and explicit owner/member predicates.
- RLS is forced on all `app` tables.
- State-changing SQL is exposed through narrow functions or exact queries, not
  generic CRUD endpoints.
- Removed/left state is checked on every request, not embedded in long-lived
  application token claims.
- Owner identity is never editable through a generic cache update.
- Integration tests enumerate every role/action combination.

## Credential and secret handling

Secrets:

- Application, worker, and migration database URLs
- Supabase server credentials
- Session encryption key ring
- Cursor-signing and rate-limit HMAC keys
- Resend API key

Requirements:

- Store production secrets only in Fly secrets or the appropriate provider
  secret store.
- Never prefix server secrets with frontend-exposed Vite variables.
- Never put secrets in `fly.toml`, Docker layers, source, fixtures, screenshots,
  generated OpenAPI clients, or logs.
- Use separate credentials per environment and role.
- Rotate immediately on suspected exposure.
- Document last rotation and owner without storing secret values.
- CI runs secret scanning on history and working tree.

Cache password:

- Normalize only by accepting the exact Unicode string after validating length;
  do not trim silently.
- Hash with Argon2id using an encoded, versioned format and a unique random salt.
- Start at or above OWASP's current minimum parameters, benchmark on the
  smallest production Machine, and target roughly 100–300 ms verification.
- Enforce a maximum concurrent password-verification semaphore to prevent
  memory exhaustion.
- Rehash on successful verification when parameters become outdated.
- Never reveal, recover, email, or log the password.
- Verify unknown join codes against a fixed dummy Argon2id hash and return the
  same public error family so code existence is not exposed through a cheap
  timing difference.

## CSRF, CORS, and browser controls

- Same-origin SPA and API; do not enable CORS in MVP.
- Check exact `Origin` on unsafe methods. Fall back to strict `Referer`
  validation only for user agents that omit Origin.
- Require the double-submit CSRF cookie/header on authenticated unsafe methods.
- Reject simple cross-origin content types for JSON endpoints.
- Cookies use `__Host-`, `Secure`, proper `HttpOnly`, and same-site attributes.
- CSP default:

```text
default-src 'self';
base-uri 'none';
object-src 'none';
frame-ancestors 'none';
form-action 'self';
img-src 'self' data:;
font-src 'self';
style-src 'self';
script-src 'self';
connect-src 'self';
manifest-src 'self';
worker-src 'self';
```

Avoid inline script/style requirements. If tooling requires a nonce or hash,
generate it per response rather than adding `unsafe-inline`.

Other headers:

- `Strict-Transport-Security` after custom-domain HTTPS is verified.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: no-referrer`.
- `Permissions-Policy` disabling unneeded sensors/camera/microphone/location.
- `Cross-Origin-Opener-Policy: same-origin` after compatibility testing.

## Input and output controls

- Generate transport validation from OpenAPI and apply domain validation again.
- Reject duplicate JSON keys if the decoder/library permits reliable
  enforcement.
- Reject unknown fields, excessive nesting, invalid UTF-8, control characters
  in names, and oversized values.
- Parameterize every SQL query; dynamic ordering/filtering uses an allowlist.
- Render text through React and Go template escaping.
- Sanitize controlled email headers against CR/LF injection.
- Limit cursor, search, and idempotency header lengths.
- Never follow user-provided URLs or fetch user-provided remote resources.
- No file upload or HTML input exists in MVP.

## Rate limiting and abuse protection

`private.rate_limit_buckets` stores:

| Column | Meaning |
|---|---|
| `action` | stable endpoint category |
| `subject_digest` | HMAC of normalized email, join code, user ID, or IP |
| `window_started_at` | fixed/sliding window basis |
| `count` | attempts |
| `blocked_until` | optional cooldown |
| `expires_at` | automatic purge |

Never store raw IPs for rate limiting. Use a versioned HMAC key so leaked
digests cannot be reversed through simple lookup.

Initial limits, subject to test/tuning:

- Request email code: 5/hour/email and 20/hour/IP digest.
- Verify email code: 10/15 minutes/email and 30/15 minutes/IP digest.
- Cache join: 5 failures/15 minutes/user and 20/hour/join-code digest.
- Cache creation: 10/day/user.
- Domain mutations: burst 60/minute/user, with stricter item mutation burst of
  20/minute/cache/user.

Successful joins clear only the user's relevant failure bucket. Rate-limit
responses do not reveal whether the target exists. Use database-atomic counters
so two Machines share enforcement.

## Logging and audit

Application access logs include:

- Timestamp, release, Machine/region, request ID
- HTTP method and route template, never raw sensitive URL
- Status, duration, response bytes
- Pseudonymous user/session correlation when authenticated
- Stable error code

Exclude:

- Cookies, authorization headers, CSRF values
- OTP/TOTP values and QR secrets
- Cache passwords/hashes and join codes
- Emails, display names, item/request notes
- Request/response bodies
- Database URLs and provider payloads

Security audit events include login success/failure category, session
revocation, MFA changes, recent-auth events, cache credential rotation,
membership removal/restoration, archival, rate-limit blocks, and operator
privacy actions. Store pseudonymous actor and target IDs, outcome, request ID,
and timestamp.

## Privacy

Personal data collected:

- Supabase identity ID
- Verified email
- Display name
- Cache membership and activity tied to user ID
- Short-lived HMAC-derived abuse identifiers
- Session/security metadata

Data minimization:

- No phone number until SMS exists.
- No address, precise location, contacts import, profile photo, or payment data.
- No behavioral advertising/analytics SDK.
- No raw IP persistence in the application database.
- No email exposure to cache members.

Before public launch, provide:

- Privacy policy and terms.
- Support/privacy contact.
- Operator identity and subprocessors.
- Data export procedure.
- Account deletion/anonymization runbook.
- Breach and user-notification procedure appropriate to operating jurisdiction.

## Dependency and supply-chain security

- Pin Go module and npm lockfiles.
- Use official minimal container bases pinned by digest for releases.
- Run `govulncheck`, npm audit policy, static analysis, license review, and image
  vulnerability scan in CI.
- Generate an SBOM for production images.
- Sign release images and retain provenance if the CI platform supports it.
- Renovation/dependency updates use small reviewed pull requests and must pass
  the full test suite.
- No postinstall scripts without explicit review.

## Security verification checklist

- Cross-cache IDOR attempts for every resource and method.
- Owner endpoint calls by members.
- Removed member with still-valid session.
- Removed member attempting password rejoin.
- CSRF with missing/mismatched header, wrong origin, and alternate content type.
- Session fixation, expiry, revocation, logout-all, and two-Machine refresh race.
- JWT wrong issuer/audience/algorithm/key/expiry.
- Join-code enumeration timing and error equivalence.
- Argon2 resource exhaustion and rate-limit concurrency.
- SQL injection, stored/reflected XSS, header injection, open redirect.
- Idempotency replay with same and different payload.
- Service-role credential absent from client bundles and image history.
- RLS with empty/malformed `app.user_id`.

Arrange an independent security review before accepting real households at
scale. Automated tests do not replace penetration testing.
