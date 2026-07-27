# Data model and authorization

## Database conventions

- PostgreSQL is the only durable application datastore.
- Enable `pgcrypto` and `citext` if supported by the selected Supabase project.
- IDs are UUIDv7 when the selected Go UUID library supports it reliably;
  otherwise use UUIDv4 consistently. Never mix strategies inside a table.
- Store timestamps as `timestamptz` in UTC.
- Use snake_case identifiers.
- Use explicit foreign-key deletion behavior.
- Avoid nullable booleans and implicit enum-like text.
- Monetary types are not needed.
- Quantities use `numeric(14,3)`, not floating point.
- All mutable rows have `created_at`, `updated_at`, and a nonnegative `version`
  where concurrent settings edits matter.
- Table ownership belongs to the migration role, not the application role.

## Schemas and roles

Schemas:

- `app`: application tables and RLS helper functions.
- `private`: secrets, sessions, delivery jobs, and security metadata.

Roles:

- `communal_migrator`: owns schemas and may apply migrations.
- `communal_app`: used by HTTP requests; no bypass-RLS and no direct private
  table access except narrowly granted functions.
- `communal_worker`: can claim/update outbox rows and read necessary private
  contacts; cannot modify cache or inventory data.

Revoke default access from `public`, Supabase `anon`, and Supabase
`authenticated` roles. The browser does not use the Supabase Data API.

## Enumerations

Use PostgreSQL enums or check constraints consistently:

```text
membership_role  = owner | member
membership_state = active | left | removed
inventory_kind   = add | take
inventory_unit   = count | g | kg | oz | lb | mL | L | tsp | tbsp | cup
request_status   = open | fulfilled | cancelled
outbox_status    = pending | processing | sent | dead
session_state    = pending_mfa | active
```

Application event types are a constrained text set so new non-breaking event
types can be introduced by migration.

## Tables

### `app.profiles`

| Column | Type | Rules |
|---|---|---|
| `user_id` | uuid | PK; references `auth.users(id)` |
| `display_name` | varchar(80) | nonblank after trim |
| `created_at` | timestamptz | required |
| `updated_at` | timestamptz | required |
| `version` | bigint | default 0 |

Only the owner can update a profile. Active cache members can read only the
`user_id` and display name of users who share an active cache.

### `private.user_contacts`

| Column | Type | Rules |
|---|---|---|
| `user_id` | uuid | PK |
| `email` | citext | required, verified claim only |
| `email_verified_at` | timestamptz | required |
| `synced_at` | timestamptz | required |

Upsert from signed Supabase claims after successful login/refresh. Never expose
through normal application queries.

### `private.app_sessions`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | internal PK |
| `token_digest` | bytea | unique SHA-256 digest |
| `user_id` | uuid | indexed |
| `state` | session_state | required |
| `refresh_ciphertext` | bytea | AES-GCM result |
| `refresh_nonce` | bytea | unique per encryption |
| `encryption_key_id` | text | key-ring lookup |
| `auth_level` | smallint | 1 or 2 |
| `authenticated_at` | timestamptz | recent-auth basis |
| `last_verified_at` | timestamptz | Supabase refresh time |
| `last_seen_at` | timestamptz | idle expiry basis |
| `expires_at` | timestamptz | absolute expiry |
| `revoked_at` | timestamptz | nullable |
| `created_at` | timestamptz | required |

Never store the raw application session identifier. Update `last_seen_at` no
more than once every five minutes to avoid a write on every request.
`pending_mfa` sessions expire after ten minutes and cannot authorize
application data.

### `app.caches`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `name` | varchar(80) | nonblank |
| `join_code` | char(16) | unique, uppercase Crockford Base32 subset |
| `owner_user_id` | uuid | required |
| `archived_at` | timestamptz | nullable |
| `created_at` | timestamptz | required |
| `updated_at` | timestamptz | required |
| `version` | bigint | default 0 |

The owner ID must agree with exactly one active owner membership. Enforce this
through the cache-creation and membership functions plus deferred constraint
tests; do not allow direct owner updates.

### `private.cache_secrets`

| Column | Type | Rules |
|---|---|---|
| `cache_id` | uuid | PK |
| `password_hash` | text | encoded Argon2id hash |
| `rotated_at` | timestamptz | required |

Only server-side cache creation/join/password rotation functions access this
table.

### `app.cache_members`

| Column | Type | Rules |
|---|---|---|
| `cache_id` | uuid | composite PK |
| `user_id` | uuid | composite PK |
| `role` | membership_role | required |
| `state` | membership_state | required |
| `joined_at` | timestamptz | required |
| `state_changed_at` | timestamptz | required |
| `state_changed_by` | uuid | nullable for self-leave/system |

Rules:

- One row is retained for the lifetime of a cache/user relationship.
- `left` can become `active` through a valid join.
- `removed` can become `active` only through owner restore.
- Owner membership is always `owner/active`.
- A cache has exactly one owner.

Indexes:

- `(user_id, state)` for the dashboard.
- `(cache_id, state)` for member lists and notification recipients.

### `app.inventory_items`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `cache_id` | uuid | required |
| `name` | varchar(100) | required |
| `normalized_name` | varchar(100) | required |
| `quantity` | numeric(14,3) | `>= 0` |
| `unit` | inventory_unit | required |
| `created_by` | uuid | required |
| `archived_at` | timestamptz | nullable; unused by normal v1 UI |
| `created_at` | timestamptz | required |
| `updated_at` | timestamptz | required |

Unique `(cache_id, normalized_name)` where not archived. Normalize by Unicode
NFKC, trim, collapse internal whitespace, and locale-independent case fold in
Go; persist both display and normalized values. Database tests MUST cover
normalization parity. If robust Unicode case folding cannot be reproduced in
Postgres, all writes remain server-only and the unique index uses the supplied
normalized value.

### `app.inventory_transactions`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `cache_id` | uuid | required, denormalized for RLS/indexing |
| `item_id` | uuid | required |
| `actor_user_id` | uuid | nullable only after privacy anonymization |
| `actor_display_name` | varchar(80) | immutable snapshot |
| `kind` | inventory_kind | required |
| `quantity` | numeric(14,3) | `> 0` |
| `quantity_after` | numeric(14,3) | `>= 0` |
| `idempotency_key` | uuid | required |
| `created_at` | timestamptz | required |

Unique `(actor_user_id, idempotency_key)` while actor is present. No UPDATE or
DELETE grants for the application role. A trigger rejects mutation except from
the migration role's explicit privacy-anonymization procedure.

Indexes:

- `(cache_id, created_at desc, id desc)`
- `(actor_user_id, created_at desc)`
- `(item_id, created_at desc)`

### `app.item_requests`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `cache_id` | uuid | required |
| `requester_user_id` | uuid | nullable after anonymization |
| `requester_display_name` | varchar(80) | immutable snapshot |
| `item_name` | varchar(100) | required |
| `normalized_item_name` | varchar(100) | required |
| `quantity` | numeric(14,3) | nullable, otherwise `> 0` |
| `unit` | inventory_unit | null iff quantity is null |
| `note` | varchar(500) | nullable |
| `status` | request_status | required |
| `fulfilled_by` | uuid | nullable |
| `created_at` | timestamptz | required |
| `resolved_at` | timestamptz | nullable |
| `version` | bigint | default 0 |

Creation and transition idempotency keys live in a generic mutation receipt
table rather than adding multiple columns here.

### `app.notification_preferences`

| Column | Type | Rules |
|---|---|---|
| `cache_id` | uuid | composite PK |
| `user_id` | uuid | composite PK |
| `new_items_enabled` | boolean | default true |
| `requests_enabled` | boolean | default true |
| `updated_at` | timestamptz | required |

Create lazily on first preference change; absence means both defaults are true.

### `app.cache_events`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `cache_id` | uuid | required |
| `actor_user_id` | uuid | nullable after anonymization |
| `actor_display_name` | varchar(80) | snapshot |
| `event_type` | text | constrained |
| `subject_id` | uuid | nullable |
| `public_data` | jsonb | sanitized, size bounded |
| `created_at` | timestamptz | required |

This table covers request and membership events. Inventory activity is read
from `inventory_transactions`; the feed query merges both sources. Never put
emails, join codes, password metadata, notes intended to be private, IP
addresses, or tokens into `public_data`.

### `private.mutation_receipts`

| Column | Type | Rules |
|---|---|---|
| `user_id` | uuid | composite unique |
| `idempotency_key` | uuid | composite unique |
| `operation` | text | required |
| `request_hash` | bytea | required |
| `status_code` | integer | required |
| `response_body` | jsonb | bounded |
| `created_at` | timestamptz | required |
| `expires_at` | timestamptz | required |

Reusing a key with the same operation and request hash returns the saved
response. Reusing it with different input returns `409 idempotency_conflict`.
Retain receipts for at least 24 hours and purge them with a maintenance job.

### Private delivery and security tables

`private.notification_outbox` and `private.rate_limit_buckets` are detailed in
the notifications and security documents.

`private.security_audit_log` records login/session, owner access changes,
rate-limit triggers, and secret rotations with pseudonymous identifiers. It is
append-only and inaccessible to cache members.

## Transaction invariants

### Create cache

One transaction inserts the cache, secret hash, owner membership, and initial
preference defaults. The join code is retried on the extremely unlikely unique
collision. The `CacheCreationPolicy` is checked immediately before the
transaction.

### Join cache

Password verification happens outside a long database transaction after a
server-only secret lookup. The membership state is then changed atomically:

- Missing row -> `member/active`.
- `left` -> `active`.
- `active` -> no-op.
- `removed` -> generic denial.

Recheck cache existence, archival state, and secret rotation version inside the
write transaction to prevent time-of-check/time-of-use races.

An unknown join code still runs one verification against a fixed in-memory
dummy Argon2id hash so externally visible work is comparable. Generate or load
the dummy hash at startup, never per request.

Lock the cache row while activating a new, left, or restored membership and
enforce the 100-active-member limit inside that transaction. The owner counts
toward the limit.

### Add inventory

- Resolve or insert the item under a transaction.
- Lock existing item `FOR UPDATE`.
- Verify active cache and membership through both service logic and RLS.
- Update quantity.
- Insert transaction and cache activity-related data.
- If the item was newly created, select recipients and insert outbox rows.
- Insert mutation receipt.
- Commit once.

Concurrent first-add requests for the same normalized item handle the unique
constraint by selecting and locking the winning row, then applying the second
add exactly once.

### Take inventory

- Lock item `FOR UPDATE`.
- Conditional update requires `quantity >= requested`.
- Insert immutable transaction with resulting quantity.
- Insert mutation receipt.
- Commit once.

No partial write is allowed when stock is insufficient.

### Request transitions

Use a conditional update `WHERE status = 'open'` and validate requester/actor
rules. Insert the event, notification jobs, and receipt in the same transaction.
Return the existing outcome for a matching retry; return conflict for a
different terminal state.

## RLS design

Define stable helper functions owned by the migrator:

```text
app.current_user_id() -> uuid
app.is_active_member(cache_id uuid) -> boolean
app.is_cache_owner(cache_id uuid) -> boolean
```

`current_user_id` reads `current_setting('app.user_id', true)`, returns null for
missing/malformed values, and never throws for anonymous context. Helpers use a
fixed empty `search_path` and fully qualified names.

Every application table has RLS enabled and forced. Representative policies:

- Caches: active members may select; owner may update permitted fields through
  server functions only.
- Members: active members may select sanitized active membership rows in their
  cache; owners may additionally select left/removed rows. State/role writes
  occur only through constrained functions.
- Inventory and requests: active members may select and use domain-specific
  functions; no generic direct INSERT/UPDATE/DELETE grants.
- Preferences: the authenticated user may select/update only their own row in
  an active cache.
- Activity: active members may select.

Prefer constrained SQL functions for state transitions over broad table write
grants. Security-definer functions MUST:

- Set `search_path` to empty.
- Fully qualify every object.
- Validate `app.current_user_id()`.
- Enforce role and cache state inside the function.
- Be executable only by `communal_app`.
- Never accept an actor ID argument.

## Retention and anonymization

- Inventory transactions, request history, and cache events are retained while
  the cache exists.
- Outbox bodies are deleted or reduced to delivery metadata after 30 days.
- Dead-letter metadata is retained for 30 days.
- Rate-limit buckets expire automatically within 24 hours.
- Security audit events are retained for 90 days initially.
- Expired sessions are purged after 30 days.
- Operator account deletion:
  - Revoke all sessions and delete private contact data.
  - Change memberships to `left`.
  - Replace nullable actor IDs with null while preserving display snapshot as
    `Former member`.
  - Delete the profile and Supabase identity.
  - Refuse deletion while the user owns an unarchived cache; permanent cache
    deletion or ownership transfer remains an operator-assisted prerequisite.

Retention durations MUST be configurable where operationally useful but may
not be increased silently.
