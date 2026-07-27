# API and authentication

## Contract rules

- Base path: `/api/v1`.
- Media type: `application/json; charset=utf-8`.
- Dates: RFC 3339 UTC strings.
- IDs and idempotency keys: canonical lowercase UUID strings.
- Unknown JSON fields are rejected on mutation requests.
- Request bodies are capped at 1 MiB before decoding.
- Responses containing private data use `Cache-Control: no-store`.
- List endpoints use opaque cursor pagination, never page numbers.
- API fields use lower camel case.
- The OpenAPI document is authoritative for wire shapes; this document defines
  semantics the schema cannot express.

## Standard error

Use `application/problem+json`:

```json
{
  "type": "https://communalcache.example/problems/validation",
  "title": "Request validation failed",
  "status": 422,
  "code": "validation_failed",
  "detail": "One or more fields are invalid.",
  "requestId": "01J...",
  "errors": [
    {
      "field": "quantity",
      "code": "must_be_positive",
      "message": "Quantity must be greater than zero."
    }
  ]
}
```

Stable `code` values:

- `validation_failed`
- `not_authenticated`
- `reauthentication_required`
- `mfa_required`
- `csrf_failed`
- `not_found`
- `forbidden`
- `conflict`
- `insufficient_quantity`
- `idempotency_conflict`
- `rate_limited`
- `service_unavailable`
- `internal_error`

Authorization-sensitive lookups SHOULD return `404` rather than reveal a
resource in another cache. Join failures always return the same `403
join_failed` problem after comparable work.

Include `Retry-After` on `429` and temporary `503` responses.

## Common headers

- Every response: `X-Request-ID`.
- Client may supply a syntactically valid `X-Request-ID`; otherwise server
  generates a ULID.
- Every unsafe authenticated mutation: `X-CSRF-Token`.
- Every retryable domain mutation: `Idempotency-Key` containing a UUID.
- Optimistic settings updates: `If-Match: "<version>"`.
- Responses with versions: `ETag: "<version>"`.

Idempotency applies to item add/take, request creation/transition, cache
creation, cache join, and membership changes. The server hashes the canonical
validated input rather than raw JSON formatting.

Exact Origin validation applies to every unsafe browser request, including
public login endpoints. The CSRF cookie/header is additionally required when an
authenticated application session is present.

## Authentication model

### Application session

Cookie name: `__Host-communalcache_session`.

Properties:

- Random 256-bit opaque value, base64url without padding.
- `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`.
- No `Domain` attribute.
- Cookie max age does not exceed the server-side absolute session expiry.

CSRF cookie: `__Host-communalcache_csrf`.

- Random 256-bit value.
- `Secure`, `SameSite=Strict`, `Path=/`.
- Not `HttpOnly` so the SPA can copy it to `X-CSRF-Token`.
- Server compares cookie and header in constant time and also validates
  `Origin` against the configured public origin.

The CSRF token rotates at login, session privilege elevation, and explicit
session refresh. A stolen CSRF token alone is useless without the host-only
session cookie.

Session defaults:

- Idle timeout: 7 days.
- Absolute timeout: 30 days.
- Supabase verification/refresh interval: no more than 15 minutes.
- Recent-authentication window: 10 minutes.
- MFA authentication level is preserved from the verified Supabase session.

On each request:

1. Hash the opaque cookie and load a non-revoked, non-expired session.
2. Enforce idle and absolute expiry.
3. Reject `pending_mfa` sessions for every route except session inspection,
   MFA challenge/verify, and logout.
4. Refresh with Supabase when verification is stale, taking a row lock.
5. Synchronize verified email claims.
6. Set authenticated user/level in request context.
7. Touch `last_seen_at` only when older than five minutes.

If Supabase rejects refresh, revoke the application session and clear cookies.

### Login endpoints

#### `POST /auth/email-code`

Request:

```json
{ "email": "person@example.com" }
```

Behavior:

- Normalize email for rate-limit hashing, but let Supabase determine identity
  validity.
- Enforce per-IP-digest and per-email-digest limits.
- Call Supabase OTP request with a fixed application redirect policy.
- Always return `202` with the same body and approximate timing, whether the
  account exists or delivery succeeds.

Response:

```json
{ "message": "If the address can receive a code, it will arrive shortly." }
```

#### `POST /auth/verify`

Request:

```json
{
  "email": "person@example.com",
  "code": "123456"
}
```

Behavior:

- Rate limit before Supabase verification.
- If Supabase requires MFA, create a ten-minute `pending_mfa` application
  session, set the normal opaque session cookie, and return `401 mfa_required`.
  That session cannot access application data.
- Otherwise create the application session, set both cookies, synchronize the
  contact, and return the current account.

#### MFA endpoints

- `POST /auth/mfa/challenge`
- `POST /auth/mfa/verify`
- `POST /auth/mfa/enroll`
- `POST /auth/mfa/enroll/verify`
- `DELETE /auth/mfa/factors/{factorID}`

Enrollment/removal requires an authenticated session and recent
authentication. Challenge responses MUST not reveal TOTP secrets after initial
enrollment. Successful login-time verification atomically changes the session
from `pending_mfa` to `active` at AAL2, rotates its opaque cookie identifier,
and rotates CSRF. QR payloads are `no-store` and never logged.

#### Other authentication endpoints

- `POST /auth/refresh`: rotate CSRF and refresh Supabase/application session.
- `POST /auth/reauth/email-code`: request a code for the current account.
- `POST /auth/reauth/verify`: elevate `authenticated_at`.
- `POST /auth/logout`: revoke current application and Supabase session.
- `POST /auth/logout-all`: revoke all application sessions and Supabase
  sessions for the current user; requires recent authentication.
- `GET /auth/session`: return account, onboarding state, MFA enrollment state,
  and CSRF availability; never return tokens.

## Resource representations

### Account

```json
{
  "id": "uuid",
  "displayName": "Ryan",
  "onboardingComplete": true,
  "mfaEnabled": false
}
```

Email may appear only in `/me`, never in member or activity representations.

### Cache summary

```json
{
  "id": "uuid",
  "name": "Maple Street Pantry",
  "role": "owner",
  "memberCount": 4,
  "openRequestCount": 2,
  "archived": false,
  "updatedAt": "2026-07-26T20:00:00Z",
  "version": 3
}
```

### Inventory item

Quantities are JSON strings to preserve decimal precision:

```json
{
  "id": "uuid",
  "cacheId": "uuid",
  "name": "Brown sugar",
  "quantity": "2.500",
  "unit": "lb",
  "createdAt": "2026-07-26T20:00:00Z",
  "updatedAt": "2026-07-26T20:00:00Z"
}
```

The frontend MUST use a decimal library or string-safe formatting, never
JavaScript floating-point arithmetic for balance calculations.

### Request

```json
{
  "id": "uuid",
  "cacheId": "uuid",
  "itemName": "Green onion",
  "quantity": "2.000",
  "unit": "count",
  "note": "Needed by Friday",
  "status": "open",
  "requester": { "id": "uuid", "displayName": "Sam" },
  "fulfilledBy": null,
  "createdAt": "2026-07-26T20:00:00Z",
  "resolvedAt": null,
  "version": 0
}
```

## Endpoint inventory

The implementer MUST encode these routes in OpenAPI.

### Account

- `GET /me`
- `PATCH /me` — update display name with `If-Match`.
- `GET /me/sessions` — sanitized session list.
- `DELETE /me/sessions/{sessionID}` — revoke another session; recent auth.

Self-service account deletion is intentionally absent.

### Caches

- `GET /caches?state=active|archived&cursor=&limit=`
- `POST /caches`
  - Body: `{name, password}`
  - Returns `201` cache detail including join code once.
- `POST /caches/join`
  - Body: `{joinCode, password}`
  - Returns active membership/cache summary.
- `GET /caches/{cacheID}`
- `PATCH /caches/{cacheID}`
  - Owner; name or archived state; `If-Match`.
- `GET /caches/{cacheID}/credentials`
  - Owner + recent auth; returns join code only, never password/hash.
- `POST /caches/{cacheID}/password`
  - Owner + recent auth; `{password}`.
- `GET /caches/{cacheID}/members`
- `POST /caches/{cacheID}/leave`
  - Member only.
- `POST /caches/{cacheID}/members/{userID}/remove`
  - Owner + recent auth.
- `POST /caches/{cacheID}/members/{userID}/restore`
  - Owner + recent auth.

Member rows contain user ID, display name, role, state, and relevant
timestamps—never contact details.

### Inventory

- `GET /caches/{cacheID}/items?query=&cursor=&limit=`
- `GET /items/{itemID}`
- `POST /caches/{cacheID}/items`
  - Semantically "add by name"; body `{name, quantity, unit}`.
  - Creates or atomically adds to an existing normalized item.
- `POST /items/{itemID}/add`
  - Body `{quantity}`.
- `POST /items/{itemID}/take`
  - Body `{quantity}`.
- `GET /items/{itemID}/transactions?cursor=&limit=`

Do not add generic PATCH or DELETE routes for items or transactions.

### Requests

- `GET /caches/{cacheID}/requests?status=open|resolved|all&cursor=&limit=`
- `POST /caches/{cacheID}/requests`
- `GET /requests/{requestID}`
- `POST /requests/{requestID}/fulfill`
- `POST /requests/{requestID}/cancel`

Do not expose a generic status update endpoint.

### Activity and statistics

- `GET /caches/{cacheID}/activity?cursor=&limit=`
- `GET /caches/{cacheID}/stats/me?from=&to=`

Activity cursor encodes `(created_at, source_rank, id)` to paginate a stable
merge of transaction and cache event sources. The cursor is opaque and
authenticated or signed to prevent arbitrary query construction.

Stats response:

```json
{
  "addCount": 12,
  "takeCount": 7,
  "addedByUnit": [{ "unit": "count", "quantity": "8.000" }],
  "takenByUnit": [{ "unit": "count", "quantity": "3.000" }]
}
```

### Notification preferences

- `GET /caches/{cacheID}/notification-preferences/me`
- `PUT /caches/{cacheID}/notification-preferences/me`
  - Body: `{newItemsEnabled, requestsEnabled}`.

Changing preferences does not cancel deliveries already marked `processing`.

### Health

- `GET /health/live`: process is alive; no dependency checks.
- `GET /health/ready`: application can accept requests; checks a bounded
  database round trip and completion of required migrations.
- Health responses contain no build secrets or dependency credentials.

## Status behavior

- `200`: successful reads/updates and idempotent replay.
- `201`: new cache/item/request created.
- `202`: login-code request accepted.
- `204`: logout or action with no response body.
- `400`: malformed JSON, cursor, or headers.
- `401`: missing/expired authentication or MFA requirement.
- `403`: authenticated but explicitly forbidden; generic join failure.
- `404`: resource absent or hidden by cache isolation.
- `409`: state/version/idempotency conflict.
- `422`: syntactically valid request with field validation errors.
- `429`: rate limited.
- `503`: dependency unavailable before a domain transaction begins.

Never retry non-idempotent work automatically unless an idempotency key is
present.

## Pagination and limits

- Default limit: 30.
- Maximum limit: 100.
- Cursor includes the sort key and ID, is base64url-encoded, and is signed with
  a server key.
- Invalid or expired cursor: `400 invalid_cursor`.
- Search is case-insensitive within one authorized cache and capped in length.
- No endpoint returns unbounded members, transactions, requests, or events.

## API evolution

- Additive response fields are non-breaking; clients must ignore unknown
  response fields.
- Removing/renaming fields, changing meanings, or tightening previously valid
  enum values requires `/api/v2`.
- Database migrations and API changes deploy expand-first, contract-later.
- The generated frontend client is checked in so generation drift is visible in
  code review; CI runs generation and fails on diffs.
