# Frontend and UX

## Frontend stack

- React and TypeScript with Vite.
- React Router for routes and nested layouts.
- TanStack Query for server state.
- React Hook Form plus Zod for client-side form ergonomics. Server validation
  remains authoritative.
- Tailwind CSS and shadcn/ui primitives.
- `decimal.js-light` or an equivalent small decimal library only for display
  and input normalization; preserve API quantities as strings.
- `vite-plugin-pwa` for the manifest and public asset service worker.
- Vitest, Testing Library, MSW, axe-core, and Playwright.

Pin exact dependency versions in the lockfile. Avoid global client state when
URL state, component state, or TanStack Query is sufficient.

## Route map

```text
/
/login
/verify
/mfa
/onboarding
/app
/app/caches/new
/app/caches/join
/app/caches/:cacheId
/app/caches/:cacheId/inventory
/app/caches/:cacheId/requests
/app/caches/:cacheId/activity
/app/caches/:cacheId/members
/app/caches/:cacheId/settings
/app/account
/app/account/security
```

- `/app` lists active caches, archived caches, and create/join actions.
- Cache routes use a shared header and mobile bottom navigation.
- Owner-only controls are hidden for members, but the API remains authoritative.
- If membership is lost while a route is open, invalidate cache queries,
  display a neutral access-lost message, and return to `/app`.
- Archived caches display a persistent read-only banner and suppress mutation
  controls.

## Authentication flow

1. User enters email.
2. UI always displays the same "check your email" result.
3. User enters the one-time code.
4. If MFA is required, continue to the TOTP screen.
5. If profile is incomplete, route to onboarding.
6. Otherwise route to `/app`.

The frontend never stores credentials, session IDs, JWTs, email codes, TOTP
secrets, or cache passwords in local/session storage, IndexedDB, query cache
persistence, analytics, or error reports.

On `401`, clear private query caches and route to login. Do not repeatedly call
refresh from every failed request; use a single request coordinator and retry
the original read at most once after successful `/auth/refresh`.

## Navigation and layouts

### Mobile

- Bottom navigation: Inventory, Requests, Activity, More.
- Primary add action remains reachable with one hand but does not obscure list
  content.
- Dialogs that contain forms become full-height sheets at narrow widths.
- Tap targets are at least 44 by 44 CSS pixels.

### Desktop

- Left cache navigation and centered content column.
- Preserve the same route and information hierarchy as mobile.
- Maximum content widths prevent tables/forms stretching excessively.

## Screen requirements

### Dashboard

- Cache cards show name, role, member count, open requests, and archived state.
- Empty state explains create versus join.
- Create and join are separate forms to reduce credential mistakes.
- Never show a cache password after submission.

### Create cache

- Name, password, and password confirmation.
- Explain that the password is shared and cannot be recovered, only rotated.
- On success, show join code with copy affordance and a reminder to share the
  code/password through an appropriate channel.
- Copy failures have a manual-select fallback.

### Join cache

- Accept hyphenated or unhyphenated join code; normalize visually to groups.
- Password manager/autocomplete behavior must not treat the cache password as
  the user's account password.
- Generic error copy: "The cache could not be joined. Check the credentials or
  ask the owner for access."
- Rate-limit UI honors `Retry-After`.

### Inventory list

- Search by item name.
- Sort default: normalized name ascending. Optional zero-stock filter may be
  client-visible but server query remains paginated.
- Each row/card shows name, formatted quantity/unit, and Add/Take buttons.
- Zero stock is visually clear without implying deletion.
- Add new item form collects name, quantity, and unit.
- Add existing item form fixes the item's unit and accepts quantity only.
- Take form displays current balance and rejects obvious overdraw locally, while
  still handling server conflict caused by concurrent takes.
- After a successful mutation, update from the returned authoritative item;
  never calculate and persist a speculative balance.
- For uncertain network failure, retry only with the original idempotency key.

### Requests

- Open requests first, resolved history separately.
- Cards show item, optional amount, requester, age, and note.
- Fulfill is available to all active members.
- Cancel appears only to the requester.
- Terminal requests disable controls immediately from authoritative response.
- A `409` refreshes the request and explains that another member already
  resolved it.

### Activity

- Infinite/cursor pagination with an explicit "Load more" control as an
  accessible fallback.
- Events use human-readable sentences while retaining semantic screen-reader
  text.
- Dates show relative time with an exact timestamp available.
- Personal statistics group quantities by unit and never sum unlike units.

### Members

- Members see display name, role, and active membership.
- Owners additionally see left/removed members and restore/remove controls.
- Remove dialog explains that the user cannot rejoin until restored.
- Owner actions requiring recent authentication redirect through reauth and
  resume the pending action only after success; do not retain raw passwords.

### Settings

- Members: notification preferences and leave-cache action.
- Owners: name, join code, password rotation, archive/unarchive, member
  management shortcut.
- Password rotation requires new password and confirmation; never display old
  hash or password.
- Archival confirmation states that the cache becomes read-only and joins stop.

### Account and security

- Profile display-name edit.
- Verified email displayed only to the account owner.
- MFA enroll, verify, and remove flows.
- Active session list with revoke and "sign out all" controls.
- Privacy/help contact for account deletion until self-service deletion ships.

## Query and mutation policy

- Query keys include authenticated user ID and cache/resource IDs.
- Clear the entire private query client on logout/account change.
- Default stale times:
  - Cache summaries: 30 seconds.
  - Inventory and requests: 15 seconds.
  - Activity: 30 seconds.
  - Settings/member list: 60 seconds.
- Refetch relevant queries on window focus, but avoid aggressive polling.
- The MVP does not require WebSockets or Supabase Realtime.
- Mutations use a newly generated UUID idempotency key retained until the
  operation receives a definitive response.
- Disable duplicate submit controls while the same mutation is in flight.
- Do not use optimistic quantity updates. Request status may be visually
  disabled while pending but is replaced by the server response.

## Form and content rules

- Trim display values but do not unexpectedly alter intentional internal
  punctuation.
- Show quantity inputs in a locale-friendly UI and canonicalize to a
  period-decimal API string.
- Reject scientific notation, negative values, more than three decimals, NaN,
  and infinity.
- Preserve item/request capitalization for display while relying on server
  normalized names for uniqueness.
- Notes and names render as escaped text.
- Errors appear next to fields and in a focusable summary.
- Password values are never repopulated after server errors.

## PWA behavior

- Provide name, short name, theme/background colors, icons, `start_url=/app`,
  and standalone display mode.
- Cache hashed public assets and the unauthenticated shell only.
- Network-only:
  - `/api/*`
  - Authenticated HTML
  - Any response with `Cache-Control: no-store`
- Do not implement background sync, offline mutation queues, push, or persisted
  TanStack Query cache.
- Offline page says a connection is required and does not display stale private
  data.
- Updates show a non-blocking "new version available" prompt after active forms
  are no longer dirty.

## Accessibility

- Target WCAG 2.2 AA.
- Use native elements before ARIA.
- Focus moves to page heading on route navigation and to the first invalid field
  after submit.
- Dialogs trap focus, close on Escape when safe, and restore focus.
- Toasts supplement rather than replace inline outcomes.
- Status changes use polite live regions; destructive errors use assertive
  announcements sparingly.
- Respect reduced motion and OS color preferences.
- Test keyboard-only, screen-reader landmarks/names, zoom to 200%, and
  high-contrast modes.

## Analytics

No third-party behavioral analytics ship in the MVP. Operational telemetry may
record route templates, response status, latency, release, and pseudonymous
request/session correlation. It must not record emails, names, notes, join
codes, passwords, full URLs containing user input, or request/response bodies.
