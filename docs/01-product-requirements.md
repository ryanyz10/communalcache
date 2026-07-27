# Product requirements

## Product statement

Communal Cache lets a small trusted group—neighbors, housemates, relatives, or
friends—share visibility and custody of infrequently used or perishable
household goods. Members can see what is available, record what they add or
take, request missing items, and review their own participation history.

The product is not a marketplace, delivery service, financial ledger, or
real-time physical inventory guarantee. Quantities are member-reported.

## MVP goals

- Make it fast to create a private cache and share access credentials.
- Make inventory changes trustworthy through atomic balances and immutable
  history.
- Prevent users from reading or mutating any cache they do not belong to.
- Give owners basic governance without creating a complex organization model.
- Notify members about useful events without emailing every quantity change.
- Remain inexpensive and operationally simple for a solo owner.
- Leave one clear enforcement point for future cache-creation billing.

## Personas

### Cache owner

Creates the cache, shares its join code and password, manages membership and
settings, and has all member capabilities.

### Cache member

Joins with a cache code and password, views inventory, records adds/takes,
creates or fulfills requests, views activity, manages notification preferences,
leaves the cache, and may later rejoin with valid credentials.

### Service operator

Deploys and monitors the application. Operator access is infrastructure-level
only; the MVP has no support-agent impersonation or global admin UI.

## Vocabulary

- **Cache:** A private inventory-sharing group.
- **Join code:** A random, non-secret identifier used with the cache password.
- **Cache password:** A shared secret that permits immediate membership.
- **Item:** A cache-specific named inventory balance with one fixed unit.
- **Inventory transaction:** An immutable add or take operation.
- **Request:** A member-authored request for an item, optionally with quantity,
  unit, and note.
- **Removal:** Owner action that revokes access and blocks password-based
  rejoining until restored.
- **Leave:** Member action that revokes access but permits a later password-based
  rejoin.
- **Archive:** Reversible owner action that makes a cache read-only and prevents
  joins.

## Functional requirements

### Accounts

- Users MUST sign in with a verified email one-time code.
- Users MUST choose a display name of 1–80 Unicode characters after trimming.
- Display names need not be unique.
- Users MUST be able to sign out from the current session.
- Users SHOULD be able to sign out all sessions.
- Users MAY enroll TOTP MFA. Once enrolled, MFA MUST be enforced on subsequent
  logins until the factor is removed through a verified flow.
- Email addresses MUST never be visible to other cache members.
- Self-service account deletion is not part of the MVP; the production launch
  checklist MUST include a documented operator deletion process. See the
  privacy document for preservation and anonymization rules.

### Cache creation and settings

- Any authenticated, onboarded user MAY create unlimited caches in the MVP.
- A cache supports at most 100 active members in the MVP. A generic join failure
  is returned when the cap is reached.
- Cache name MUST be 1–80 Unicode characters after trimming.
- Cache password MUST be 12–128 Unicode characters and MUST be confirmed in the
  creation UI.
- Creation MUST generate a random 16-character join code. Display formatting is
  four groups of four characters separated by hyphens; storage and comparison
  use the unhyphenated uppercase value.
- Creating a cache MUST also create the owner's active owner membership.
- Owner capabilities:
  - Rename the cache.
  - View, copy, and rotate the join credentials.
  - Remove and restore members.
  - Archive and unarchive the cache.
- Password rotation MUST invalidate only the old shared password. Existing
  members remain active.
- Owners MUST NOT leave, remove themselves, or be removed in the MVP.
- Permanent cache deletion and ownership transfer are deferred.

### Joining, leaving, and removal

- Only authenticated, onboarded users MAY join.
- A valid join code and password MUST create an active member immediately.
- Repeating a successful join for an active member MUST be idempotent.
- Users who voluntarily left MAY rejoin with valid current credentials.
- Users removed by an owner MUST NOT rejoin with the password alone.
- An owner MAY restore a removed member, returning them to active member status.
- Joining an archived cache MUST fail.
- Join failures MUST use a generic response that does not distinguish an
  unknown code, wrong password, archived cache, or blocked former member.
- Members MAY leave a cache. Leaving MUST preserve their historical activity.
- Removal, leaving, and archival MUST take effect on the next API request.

### Inventory

- Active members MAY list all non-archived and zero-balance items in an active
  cache.
- Active members MAY create an item by adding its first positive quantity.
- Item name MUST be 1–100 characters after trimming and whitespace collapse.
- Item uniqueness within a cache is based on a normalized case-insensitive name.
- Each item has one immutable unit after its first transaction.
- Supported units are `count`, `g`, `kg`, `oz`, `lb`, `mL`, `L`, `tsp`,
  `tbsp`, and `cup`.
- Quantity precision is at most three decimal places and quantity operations
  MUST be greater than zero and no greater than `99999999999.999`.
- Adds MUST increase the balance and takes MUST decrease it atomically.
- A take that exceeds the current balance MUST fail without changing the item or
  transaction log.
- Zero-balance items remain visible.
- Items and inventory transactions MUST NOT be hard-deleted.
- Item renaming is deferred because it complicates audit semantics. Members can
  continue using the established name.
- Every accepted add/take MUST create exactly one immutable transaction with the
  resulting balance.
- Retried mutations with the same idempotency key MUST return the original
  result without applying the quantity twice.

### Requests

- Active members MAY create a free-form request with:
  - Item name: required, 1–100 characters.
  - Quantity: optional, positive, up to three decimal places.
  - Unit: required when quantity is supplied and omitted otherwise.
  - Note: optional, at most 500 characters.
- Request states are `open`, `fulfilled`, and `cancelled`.
- Any active member MAY fulfill an open request.
- Only the requester MAY cancel their open request.
- A request accepts only `open -> fulfilled` or `open -> cancelled`.
- Repeated fulfill/cancel calls with the same idempotency key MUST be
  idempotent. Conflicting transitions MUST return a conflict.
- Request history remains visible after fulfillment, cancellation, or member
  departure.

### Activity and statistics

- Active members MUST see a cache activity feed containing inventory changes,
  request creation/status changes, joins, leaves, and owner membership actions.
- The feed MUST use sanitized event data and MUST NOT include emails, password
  material, auth factors, IP addresses, or internal security metadata.
- The feed MUST be newest-first with cursor pagination.
- Members MUST see their personal add and take:
  - Event counts.
  - Total quantity grouped by unit.
  - Recent transaction history.
- Totals across different units MUST NOT be combined.

### Notification preferences

- Request and new-item email categories default to enabled per cache.
- Users MAY independently disable either category for each cache.
- The actor MUST NOT receive an email about their own action.
- Creating an item's first inventory record notifies other eligible members.
  Later additions to that item do not.
- Opening a request notifies other eligible members.
- Fulfilling a request notifies its requester when the fulfiller is another
  member. Cancellation sends no email because only the requester can cancel and
  actors are never emailed about their own actions.
- Notification failure MUST NOT roll back the user action.
- Email delivery is eventually consistent; the UI MUST not claim an email was
  delivered.

## Role matrix

| Action | Anonymous | Unrelated user | Member | Owner |
|---|---:|---:|---:|---:|
| Request/verify login code | Yes | Yes | Yes | Yes |
| Create cache | No | Yes | Yes | Yes |
| Join with credentials | No | Yes | Yes | Yes |
| Read active cache data | No | No | Yes | Yes |
| Add/take inventory | No | No | Yes | Yes |
| Create/fulfill requests | No | No | Yes | Yes |
| Cancel own request | No | No | Yes | Yes |
| Change own preferences | No | No | Yes | Yes |
| Leave cache | No | No | Yes | No |
| Rename/archive cache | No | No | No | Yes |
| Rotate cache password | No | No | No | Yes |
| Remove/restore members | No | No | No | Yes |

Archived caches are readable by existing active members but all inventory,
request, join, and preference mutations are rejected except owner unarchive.

## UX and quality requirements

- Primary workflows MUST be usable at 320 CSS pixels wide.
- All controls MUST be keyboard accessible and meet WCAG 2.2 AA color contrast.
- Forms MUST have programmatic labels, inline error summaries, and visible focus
  states.
- Destructive or access-changing owner actions MUST require confirmation.
- Quantity controls MUST use decimal-capable text input with mobile numeric
  keyboard hints; do not rely on browser number-step behavior.
- Dates MUST be stored in UTC and displayed in the user's browser locale.
- User-authored text MUST be rendered as text, never raw HTML.
- The UI MUST clearly distinguish empty state, loading, authorization loss,
  validation failure, conflict, and server failure.

## Explicit non-goals

- Expiration dates or contribution lots
- Unit conversion
- Financial accounting or reimbursements
- Public discovery or search across caches
- SMS or push notifications
- Native mobile applications
- Offline access to private data or offline mutations
- Barcode scanning
- Images or file uploads
- Ownership transfer or delegated admin
- Billing implementation
- Support impersonation or a global admin console
