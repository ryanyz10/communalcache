# Build guide

Build Communal Cache feature by feature, one PR each, in the order below. Each PR
includes the backend, that feature's UI slice, and its tests.

[docs/plan.md](plan.md) is the spec and the source of truth on _what_ to build. This
file is about _how_ and _in what order_, plus the specific mistakes that are easy to
make. It names the scope, the traps, and the check that proves each feature.

Each feature ends deployable. That is why the destructive endpoints come late: an
intermediate deploy that can remove a member but cannot clean up after them is worse
than one that cannot remove anyone.

**The traps in each feature are not hypothetical.** Every one is a defect that a review
pass caught in the plan before any code existed. They are the things worth slowing
down for.

## Before you start

Concepts that show up throughout, worth being comfortable with:

- **Go 1.22+ `http.ServeMux` patterns** — `"GET /api/items/{id}"` with `r.PathValue("id")`.
  No router library is needed or wanted.
- **pgx v5** — `pgxpool.Pool` for normal work, `pool.Acquire` when you need a _session_
  (advisory locks), `tx.Begin/Commit/Rollback` for transactions.
- **Postgres row locking** — `FOR UPDATE`, `FOR SHARE`, `SKIP LOCKED`, and why
  `READ COMMITTED` (the default) is what this app wants rather than `REPEATABLE READ`.

Local Postgres for tests:

```bash
docker run -d --name cc-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=communalcache postgres:16
export TEST_DATABASE_URL='postgres://postgres:postgres@localhost:5432/communalcache?sslmode=disable'
export DATABASE_URL="$TEST_DATABASE_URL"
```

Completion gates, run before calling any feature done:

```bash
make test && make vet && test -z "$(gofmt -l .)" && (cd web && npx tsc --noEmit && npm run build)
```

## Status

Update the feature's row in its own PR. Implementation status and review status are
separate: an open PR can be ready for review while the next feature is being built.

| # | Feature | Status | PR |
| --- | --- | --- | --- |
| — | Foundation | Done | — |
| 1 | Caches | Not started | — |
| 2 | Joining | Not started | — |
| 3 | Items (no photos) | Not started | — |
| 4 | Photos | Not started | — |
| 5 | Requests | Not started | — |
| 6 | Notification worker + email | Not started | — |
| 7 | Web push + PWA | Not started | — |
| 8 | Member removal and item deletion | Not started | — |
| 9 | Polish | Not started | — |

---

## Foundation (done)

Already on `master` and deployed at https://communalcache.fly.dev:

- Single Go binary with embedded SPA, graceful shutdown, `/api/healthz` and
  `/api/config`, env loading, Dockerfile, Fly config, and Make targets.
- Dedicated-connection migration runner, full schema with deny-all RLS in `app`,
  migration ledger in `app.schema_migrations` with `002_ledger_hardening.sql`,
  body-size/JSON decode helper, shared error helper, and SQL/hosted Data API checks.
- Cached JWKS JWT validation via `github.com/lestrrat-go/jwx/v3`, auth middleware
  that upserts users without clobbering `display_name`, `requireProfile`, and
  `GET`/`PATCH /api/me`.
- Runtime config → supabase-js → magic-link login → display-name onboarding →
  `/join/:token` stash, with Vite proxying `/api` to Go.
- Resend custom SMTP, asymmetric JWT keys, Site URL and redirect wildcards,
  deployed login/onboarding smoke, and hosted PostgREST boundary verified.

See [database.md](database.md) for connection and migration details and
[deploy.md](deploy.md) for provider setup, secrets, deploys, and rollback.

### Traps that still apply

- **The advisory lock must be held on one dedicated connection**, not the pool.
  Advisory locks are session-scoped; taken from a pool, the lock lands on a different
  connection than the migrations and protects nothing. `migrate.go` already does this
  via `pool.Acquire` — understand why before changing it.
- **`DATABASE_URL` must be a direct connection or Supavisor _session_ mode.** Not port 6543. Transaction pooling multiplexes per transaction, which silently turns the
  advisory lock into a no-op and breaks pgx's prepared statements.
- **Never set `FORCE ROW LEVEL SECURITY`.** RLS is enabled with zero policies as a
  deny-all wall against anything that reaches the tables. Go gets through because the
  `DATABASE_URL` role _owns_ the tables and owners are exempt. `FORCE` removes that
  exemption and locks the application out through its own wall.
- **Tables live in `app`, never `public`.** Supabase serves a PostgREST Data API over
  `public` using the anon key, which this app hands to every browser from
  `/api/config`. A table in `public` with RLS off is world-readable. The migration
  ledger itself used to live in `public` — that is the same hole. Keep it in `app`
  (bootstrap + `002_ledger_hardening.sql`); never recreate `public.schema_migrations`.
- **`TEST_DATABASE_URL` must never point at the hosted project.** Local `go test`
  suites insert and delete under concurrency. The hosted PostgREST check is
  `make boundary-http` (HTTP only; uses `SUPABASE_URL` + anon key from `.env`).
- **`requireProfile` must exempt `PATCH /api/me`** and the push subscription routes.
  Setting a display name is itself a write; gating it leaves a new user with no way
  out. This is a real deadlock, not a theoretical one.
- **Do not default `display_name` to the email's local part.** It would leak a fragment
  of everyone's email into the member list and pending queue, which contradicts the
  privacy stance. `NULL` until the user picks one.
- **Pin `alg` to an explicit allowlist** of exactly `ES256` and `RS256`, matched against
  the JWK's own `alg`. Inferring from key type still admits weaker algorithms sharing
  that type. Reject `none` and HS256-signed-with-the-public-key.
- **Unknown `kid` should trigger one rate-limited JWKS refetch**, not a refetch per
  request — otherwise key rotation becomes a DoS vector against your own server.
- **Supabase's built-in email sender is rate-limited** to a handful per hour and is not
  for production. Configure Resend as custom SMTP or magic links silently stop arriving.
- **The invite token must survive the magic-link round trip.** A logged-out user tapping
  an invite link is the _primary_ onboarding path. Stash the token in `sessionStorage`
  and pass `emailRedirectTo = {APP_BASE_URL}/join/{token}`, and add
  `{APP_BASE_URL}/join/*` to Supabase's redirect allowlist or the link bounces.

### Proof to keep green

**SQL half** (`go test` + `TEST_DATABASE_URL`): assert the four layers
_independently_, because an end-to-end "anon gets nothing" check passes just as
happily when three of them have quietly stopped working:

- `has_schema_privilege('anon', 'app', 'USAGE')` is false
- `pg_policies` is empty for every `app` table
- `relrowsecurity` is true on each
- `relforcerowsecurity` is **false** on each

Enumerate tables from `information_schema` and compare against
`dbtest.ExpectedAppTables`, so a table added later without RLS fails here instead
of slipping through. The harness must `CREATE ROLE anon` and
`CREATE ROLE authenticated` before migrating — vanilla Postgres has neither, and
`REVOKE` fails without them. `001_init.sql` creates them if absent.

**HTTP half** (`make boundary-http`, build tag `hosted`): occasional **operator
smoke**, not CI. Hits PostgREST with the legacy JWT anon key +
`Accept-Profile: app` for each name in `dbtest.ExpectedAppTables`. Proves the
Data API / gateway layer that SQL `SET ROLE` cannot. Needs only `SUPABASE_URL`
and `SUPABASE_ANON_KEY` from `.env` (`eyJ…`, not `sb_publishable_…`). Accepted
denials include `503`/`PGRST002` when the Data API is off; any 2xx is a failure.

- JWT rejection matrix: wrong `iss`, wrong `aud`, expired, `alg=none`, HS256 signed with
  the public key, an `alg` outside the allowlist, unknown `kid`. Rotation succeeds after
  one refetch.
- Profile gate: cache/item/request writes 409 before `display_name` is set, while
  `PATCH /api/me` succeeds. That second half is the assertion that catches the deadlock.

---

## Feature 1 — Caches

**Goal:** create a cache and share its invite link.

### Scope

1. `POST /api/caches` — cache row + owner's `active` membership, **one transaction**.
2. `GET /api/caches` — caches I'm an active member of.
3. `GET /api/caches/{id}` — detail, member list, and the `invite_token`.
4. `PATCH /api/caches/{id}` — name, `requires_approval`. Cache owner only.
5. `POST /api/caches/{id}/invite/rotate` — new high-entropy token (32 bytes,
   `crypto/rand`, base64url).

UI: dashboard (my caches, create) and a cache view shell (name, copy invite link,
owner-only rotate and settings, member list). Joining ships in Feature 2; member
removal ships in Feature 8 with its cascade.

### Traps

- **Resolve membership in the same SQL statement as the data fetch**, joining
  `cache_members` on `status='active'`. Never a separate pre-check — that is exactly how
  a direct-ID route drifts out of scope later.
- **Return 404, not 403,** for non-members, so nobody can probe for a cache's existence.
- **Cache creation must be one transaction.** Otherwise a partial failure leaves a
  creator who is not a member of the cache they just made and cannot see it.
- **Never return another user's `email`.** Member and queue payloads carry `user_id` and
  `display_name` — the client needs the ID to key rows and address the removal route —
  but email appears in exactly one response, `GET /api/me`, and only your own.

### Proof

Cover this feature's routes with the authorization matrix below. Creating a cache
leaves the creator an active member; owner settings and invite rotation are owner-only.
Try creating a cache, opening its shell, copying the link, and rotating it from the UI.

---

## Feature 2 — Joining

**Goal:** an invite link brings a person into a cache, with owner approval when required.

### Scope

- `POST /api/join/{token}` — insert `active`, or `pending` when `requires_approval`.
- `GET /api/caches/{id}/join-requests` — cache owner's pending queue.
- `POST /api/caches/{id}/join-requests/{userId}/approve` and
  `POST /api/caches/{id}/join-requests/{userId}/reject` — cache owner only.
- Enqueue outbox rows for gated join requests and join approvals/rejections, in the
  same transaction as the membership change.

UI: wire `/join/:token` through login/onboarding to joining, and add the owner's
pending queue with approve/reject actions to the members sheet.

### Traps

- **A `removed` membership row blocks rejoin.** Leave it untouched and return 403. The
  invite link is still sitting in the group chat, so removal is meaningless otherwise.
- **A rejected join _deletes_ the pending row** rather than marking it `removed`, so a
  mistaken rejection can be redone.
- **Enqueue outbox rows now**, even though the worker arrives in Feature 6. The table
  exists from migration 001 for this reason. Otherwise intermediate deploys drop join
  approvals on the floor and you retrofit enqueue calls into reviewed handlers later.

### Proof

Run this matrix across both Caches and Joining routes:

Authorization matrix over non-member, pending member, removed member, active member,
and cache owner, across every direct-ID route, asserting 404 for cross-cache access.
Plus: creating a cache leaves the creator an active member; a removed member cannot
rejoin with a valid token.

Also exercise open and gated joins, rejection followed by a retry, and the logged-out
invite → magic link → display name → join path. Assert recipients and that a
rolled-back membership change enqueues nothing.

---

## Feature 3 — Items (no photos)

**Goal:** members list things and owners edit them.

### Scope

1. `POST /api/caches/{id}/items` — active member; `owner_id` from the caller.
2. `GET /api/caches/{id}/items`, `GET /api/items/{id}`.
3. `PATCH /api/items/{id}` — item owner only.

UI: item list in the cache view, item detail sheet, and add-item form. No photo
upload yet; no delete endpoint until Feature 8.

Item stock is `NULL` for non-consumables and 0–9999 for consumables, as in plan.md.
The positive-quantity trap below applies to requests against those items; enforce
that cross-table rule when Requests ships, not as a ban on zero item stock.

### Traps

- **`is_consumable` is immutable after creation.** Flipping it strands `quantity` and
  every pending reservation counted against it.
- **`owner_id` comes from the authenticated caller, never the request body.**
- **`quantity` must be `NULL` for a non-consumable and a bounded positive int for a
  consumable.** This is a cross-table rule no `CHECK` constraint can express, so the
  handler enforces it and a test covers both directions.

### Proof

Owner-only mutations 404 for non-owners. `is_consumable` cannot be changed.
Creating an item cannot forge `owner_id`; item stock accepts zero for consumables
and requires `NULL` for non-consumables. Exercise list, detail, create, and edit in
the UI; retain the request-quantity proof in Feature 5.

---

## Feature 4 — Photos

**Goal:** owners add photos and members see them without exposing the bucket.

### Scope

1. `POST /api/items/{id}/photo` — multipart, item owner only.
2. Frontend `<canvas>` resize to max 1600px, re-encode to JPEG, then upload.
3. Batched signed URLs for list views, 1-hour TTL.

UI: photo picker and upload/error state in the item form/detail sheet, with photos
in the item list. Creating the private Supabase Storage bucket and configuring its
policies are external changes: get the human's explicit approval first. The service
role key is a server-side secret and also needs approval before configuration.

### Traps

- **Client-side resize is a convenience, not a validation.** Go still sniffs the content
  type, caps the body at 5MB, and rejects anything but JPEG/PNG/WebP. An SVG with a
  script tag must not get through.
- **Canvas decode can fail** on an unsupported format or a large image on a low-memory
  device, and `toBlob` can hand back `null`. Surface "couldn't read that image, try
  another" rather than uploading a blank frame.
- **The storage bucket is private with zero `storage.objects` policies.** Supabase
  Storage authorizes through RLS on that table, so a policy-less private bucket leaves
  the service role — server-side only — as the sole accessor. The service key must never
  appear in `/api/config` or any browser-reachable response.

### Proof

Upload validation rejects an oversize body, a wrong content type, and an SVG with a
script. Owner-only mutations 404 for non-owners. `is_consumable` cannot be changed.
Anonymous and authenticated clients can neither list the bucket nor download a known
object path, while server-side upload and a signed URL both work.

---

## Feature 5 — Requests

**Goal:** the ask/approve handshake, without over-booking.

### Scope

- `POST /api/items/{id}/requests` — active member, excluding the item's owner.
- `POST /api/requests/{id}/approve` and `POST /api/requests/{id}/reject` — item owner only.
- `GET /api/requests` — the caller's incoming and outgoing requests.
- Item detail includes the public pending queue; decided requests stay private to
  the requester and item owner.
- Extend `PATCH /api/items/{id}` with the quantity-edit floor below.
- Enqueue outbox rows for request creation and decisions in the mutation transaction.

UI: "Ask to use" in the item sheet and a requests screen with incoming/outgoing
lists, approve/reject actions, and a required rejection reason.

This is the only genuinely non-trivial invariant in the app. Slow down here.

### The invariant

```
available = items.quantity - COALESCE(SUM(requests.quantity) WHERE status='pending', 0)
```

Three paths mutate it — create a request, decide a request, edit quantity — and all
three run the same shape inside a `READ COMMITTED` transaction:

1. `SELECT ... FROM app.items WHERE id = $1 FOR UPDATE` — serializes the three paths.
2. Read the pending sum in a **separate statement**, after the lock is held.
3. Mutate, checking the invariant.

Step 2 being a separate statement is the whole trick. Under `READ COMMITTED`, a
statement issued after the lock is acquired sees what the previous lock holder
committed. Under `REPEATABLE READ` it would still see the stale snapshot from
transaction start — which is why this app deliberately does not use it.

Membership is locked before the item, using the lock order preserved under Feature 8.

### Per path

- **Create** — 409 if `quantity > available`.
- **Approve** — `UPDATE app.requests SET status='approved', decided_at=now()
WHERE id=$1 AND status='pending'`. **Zero rows changed means someone already decided
  it: roll back with 409.** Then `quantity -= request.quantity`. Net effect on
  `available` is zero; the reservation became a real deduction.
- **Reject** — same guarded UPDATE, `decision_reason` required.
- **Edit quantity** — floor the new value at the current pending sum; 409 below it.
  Restocking upward is unconstrained.

### Traps

- **The guarded `UPDATE ... WHERE status='pending'` is what stops a racing
  double-approval from deducting twice.** Reading the status and then updating it in two
  statements does not; two approvals interleave and the item loses two units for one
  request. Check the rows-affected count.
- **The item's own owner cannot request it.**
- **The pending queue is a deliberate disclosure** — requester `display_name`, quantity,
  and `created_at`, visible to every active member, because the product calls for a
  publicly visible queue. Decided requests stay visible only to the requester and the
  item owner.

The request-quantity NULL/positive rule is preserved under Feature 3 and enforced here.

### Proof

Concurrency, against real Postgres, with actual goroutines:

- Concurrent creates never let pending exceed available.
- Concurrent approves of the same request deduct exactly once.
- Approve-after-reject returns 409.
- A restock racing a create loses neither write.
- Quantity rejected when supplied for a non-consumable and when omitted for a consumable.

Also prove edits below pending reservations return 409, incoming/outgoing lists are
caller-scoped, and rolled-back creates/decisions enqueue nothing. Exercise the
ask/approve/reject UI with two accounts.

---

## Feature 6 — Notification worker + email

**Goal:** deliver queued events by email; every recipient gets email until push exists.

### Scope

- Poll and lease outbox rows, deliver outside the transaction, retry with backoff,
  and record guarded terminal states.
- Deliver via the Resend HTTP API using `net/http`, with `html/template` escaping
  user-supplied item titles and reasons. Use a 10s client timeout within the 30s row
  deadline. `RESEND_API_KEY` and `EMAIL_FROM` configuration need human approval.
- Use the recipients table below for events already enqueued by Joining and Requests;
  destructive-event enqueue calls arrive in Feature 8.

No new public API routes or UI screen. Email links take recipients back to the
relevant cache or requests screen. Push subscription routes do not exist yet, so
all recipients use email; Feature 7 adds structural channel selection.

### Concepts

- **Transactional outbox** — rows written in the same transaction as the state change,
  delivered later by a worker, so a notification can never describe a rollback.

### The worker loop

Claim, committed immediately:

```sql
UPDATE app.outbox SET attempts = attempts + 1,
       send_after = now() + least(interval '90 seconds' * power(2, attempts), interval '1 hour')
WHERE id IN (
  SELECT id FROM app.outbox
  WHERE sent_at IS NULL AND failed_at IS NULL AND send_after <= now()
  ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10
) RETURNING *
```

Then send outside the transaction, under a single 30s context per row, processing the
batch concurrently. On success set `sent_at`; on an observed failure at
`attempts >= 6` set `failed_at` and log.

### Traps

These are subtle and cost three review rounds to get right. The reasoning matters more
than the rules.

- **Bound claim eligibility on `failed_at`, never on `attempts`.** The claim _increments_
  `attempts`, so a predicate like `attempts < 6` makes the last permitted claim
  ineligible for reclamation _before its send is even attempted_ — a crash during that
  send loses the notification permanently, having never delivered it once.
- **`attempts` is a claim budget, not a failure budget.** A crash consumes one, so a row
  can reach the give-up threshold with fewer than six observed failures. That is the
  intended reading; assert it rather than assuming six failures.
- **Guard both terminal writes** with `AND sent_at IS NULL AND failed_at IS NULL`. A
  worker whose lease expired mid-send is still running; another worker may have already
  delivered the row, and the straggler must not stamp `failed_at` on a message that went
  out.
- **Process the claimed batch concurrently.** Ten rows sequentially at up to 30s each is
  300s, well past the 90s lease, so another worker re-claims the tail and duplicates it.
  Concurrently, batch wall time is its slowest row: 30s < 90s regardless of batch size.
- **Per-call timeouts alone do not bound a send.** Three subscriptions plus an email
  fallback is four sequential calls; at 10s each that is 40s. One deadline for the whole
  row is the bound that actually holds.

### Recipients per event

| Event                         | Notifies                                                |
| ----------------------------- | ------------------------------------------------------- |
| Request created               | The item's owner                                        |
| Request approved or rejected  | The requester                                           |
| Item deleted                  | Everyone with a pending request on it                   |
| Member removed                | The requesters whose requests were rejected as a result |
| Join request on a gated cache | The cache owner                                         |
| Join approved or rejected     | The person who asked                                    |

### Proof

- A kill mid-send loses nothing; a duplicate is acceptable and expected.
- A kill immediately after the sixth claim still leaves the row claimable.
- Six claims of mixed crashes and observed failures reach the give-up threshold.
- A straggler cannot stamp `failed_at` over another worker's `sent_at`.

Assert that every recipient gets email, event recipients match the table, and a
permanently failing send sets `failed_at` and stops being claimed. Keep the combined
email/410 proof under Feature 7 for when subscriptions exist.

---

## Feature 7 — Web push + PWA

**Goal:** installed browsers receive push; recipients without live subscriptions get email.

### Scope

- `POST /api/push/subscribe` and `DELETE /api/push/subscribe` — authenticated,
  caller-scoped, exempt from `requireProfile`. Logout deletes the endpoint.
- Add push delivery to the worker, 404/410 subscription cleanup, and structural
  email selection. Keep the same per-call timeout and whole-row deadline.
- Serve the VAPID public key through runtime `/api/config`; private key stays
  server-side. Configuring VAPID secrets needs human approval.
- PWA manifest and service worker for installability, push display, and notification
  clicks back into the app.

UI: explicit enable/disable notifications action, permission/error state, and iOS
install instructions. There is no programmable iOS install prompt.

### Concepts

- **Web push is RFC 8291** — payloads are ECDH + AES-GCM encrypted per subscription.
  Use `github.com/SherClockHolmes/webpush-go`; there is no stdlib equivalent.
- **VAPID** keys identify your server to the push services.

### Traps

- **Email is structural, not an escalation ladder.** A recipient gets email if and only
  if they have no live push subscription — none registered, or every one answered
  404/410 this pass, in which case those rows are deleted and email goes out in the same
  pass. There is deliberately no "push kept failing, so escalate" path; that ladder
  produced a bug in three consecutive review rounds because it made the escalation
  threshold and the give-up threshold interact.
- **A push endpoint is untrusted input and the worker POSTs to it from inside Fly's
  network**, where cloud metadata and 6PN private addresses are reachable. Three
  controls: an origin allowlist of the real push services at subscribe time
  (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`,
  `*.notify.windows.com`), HTTPS-only with no userinfo, and a client that refuses
  redirects and refuses to dial a non-public IP after DNS resolution.
- **An endpoint identifies a browser, not a person.** On a shared device, or after a
  logout and a different login, the same endpoint arrives under a second account.
  `ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id` reassigns it;
  ignoring the conflict would send one account's notifications to another's device.
- **iOS has no programmable install prompt.** There is no `beforeinstallprompt` in
  Safari, so iOS gets rendered instructions ("Share, then Add to Home Screen") and
  nothing more.
- **`Notification.requestPermission()` must be called from an explicit user gesture**,
  and on iOS only inside the installed PWA — that is the only context there that can
  receive push at all.

### Proof

- A recipient with no subscriptions gets email; a 410 deletes the subscription and emails
  in the same pass; a permanently failing send sets `failed_at` and stops being claimed.
- SSRF at dial time, which subscribe-time checks do not reach: an allowlisted hostname
  that _resolves_ to a private address is refused, and a 302 toward an internal address
  has the redirect refused.
- Endpoint reassignment between two accounts, after which the first receives nothing.

Also reject metadata/private hosts, plain HTTP, userinfo, and off-allowlist origins
at subscribe time; accept genuine Apple, Mozilla, and FCM endpoints. Check permission
is gesture-driven, logout unsubscribes, and push arrives on an installed iOS PWA.

---

## Feature 8 — Member removal and item deletion

**Goal:** removal and deletion that clean up after themselves.

### Scope

1. `DELETE /api/caches/{id}/members/{userId}` — status flip, delete their items in that
   cache, reject their outstanding requests, notify.
2. `DELETE /api/items/{id}` — cascade its requests, notify pending requesters.

Member removal is cache-owner-only; item deletion is item-owner-only. Enqueue each
notification in the destructive transaction. UI: removal in the owner's members
sheet and deletion in the item owner's detail sheet, both with confirmation.

### The two mechanisms differ

- **An item is deleted** — its requests go with it via `ON DELETE CASCADE`. No row
  survives to display a rejection reason on, so the notification carries the whole
  story, embedding the item title.
- **A member is removed** — the requests they made against _surviving_ items are
  rejected, not deleted. The row survives, so `decision_reason` is visible normally.

### Traps

- **Lock every affected item `FOR UPDATE` before snapshotting the pending requests you
  are about to destroy or decide.** Otherwise: the delete snapshots the pending list, a
  member concurrently creates a request (their create takes the item lock, commits, and
  returns them a 201), and then the cascade erases it — with no notification, because
  the snapshot predated the insert. Locking first forces that create to either land
  before the snapshot and be included, or block and then fail with a 404 the requester
  actually sees.
- **The lock set is wider than the items being deleted.** Member removal also _decides_
  requests against other people's items, and a decision needs those item locks for the
  over-booking guard. Removal locks the union: their own items in that cache, plus every
  item they hold a pending request against.
- **One lock order, everywhere, no exceptions:** the `cache_members` row first
  (`FOR SHARE` on write paths resolving membership, `FOR UPDATE` on removal), then item
  rows ascending by `id`. This is the whole deadlock story, and it is easy to get wrong
  because removal naturally reaches for the membership row first while creating a request
  naturally reaches for the item first. Those two orders deadlock against each other.
- **The cache owner cannot be removed** and cannot remove themselves. Ownership transfer
  is out of scope.

### Proof

- Removal deletes their items and rejects their outstanding requests in both directions.
- A request created concurrently with removal cannot land.
- Destructive races: creating a request concurrently with a direct item deletion, and
  with removal of the item's owner, each end in exactly one of two states — the create
  fails with 404, or it succeeds _and_ its notification outbox row exists. Never success
  with the request silently gone.
- Per-event recipients are correct, and a rolled-back mutation enqueues nothing.

---

## Feature 9 — Polish

**Goal:** finish the everyday UX and release checks.

### Scope

1. **Write rate limits.** A small in-memory token bucket per user is enough at this
   scale; joins and request creation are the paths worth limiting.
2. **Empty and error states** for every list and every mutation.
3. **Accessibility pass** — labeled form controls, visible focus, keyboard-reachable
   modals and sheets, sufficient text contrast.
4. **README setup steps** and the manual smoke checklist.

Apply these across the existing routes and UI screens; no new product endpoints.
PWA and permission/install behavior already ship in Feature 7.

### Traps

Keep the Foundation and feature traps green while polishing. Magic-link delivery
and notification email are independent paths; neither one's smoke check proves the
other works.

### Proof

Run the completion gates and check rate limits on joins and request creation, every
list's empty/error state, and failed mutations. Check labeled controls, visible
focus, keyboard access to modals/sheets, and text contrast.

### Manual smoke checklist

None of these is cheaply automatable, and each covers a path the test suite cannot:

- A magic link arrives (exercises Supabase's SMTP config).
- A _notification_ email arrives — a separate path, the Resend API called directly from
  Go, so the magic link passing proves nothing about it.
- A signed image URL renders.
- Push arrives on an installed iOS PWA.
- A Fly rolling deploy with a pending migration comes up clean.

Deploys, provider configuration, and secret changes in this checklist still need the
human's explicit approval.
