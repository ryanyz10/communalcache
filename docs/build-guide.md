# Build guide

A phase-by-phase route through implementing Communal Cache by hand.

[docs/plan.md](plan.md) is the spec and the source of truth on _what_ to build. This
file is about _how_ and _in what order_, plus the specific mistakes that are easy to
make. It deliberately does not contain the implementation — it names the shape,
the traps, and the check that proves each phase.

Each phase ends deployable. That is why the destructive endpoints come last: an
intermediate deploy that can remove a member but cannot clean up after them is worse
than one that cannot remove anyone.

**The traps in each phase are not hypothetical.** Every one is a defect that a review
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

Completion gates, run before calling any phase done:

```bash
go test ./... && go vet ./... && gofmt -l . && (cd web && npx tsc --noEmit && npm run build)
```

---

## Phase 1 — Skeleton

**Goal:** a deployable binary that migrates its own schema and serves the SPA.

### Already scaffolded

- `cmd/server/main.go` — startup, migration call, SPA fallback, graceful shutdown
- `cmd/server/embed.go` — `go:embed all:dist`
- `internal/db/migrate.go` — advisory-locked migration runner
- `internal/db/migrations/001_init.sql` — full schema, `app` schema, RLS deny-all
- `internal/config/config.go` — env loading
- `internal/api/server.go` — `/api/healthz`, `/api/config`
- `Dockerfile`, `fly.toml`, `Makefile`, Vite app in `web/`

### Left to do

1. **Body-size and JSON middleware.** Wrap write routes in `http.MaxBytesReader`:
   16KB for JSON, 5MB for photo uploads. Decode with `DisallowUnknownFields` so a
   typo'd field is a 400 rather than a silent no-op.
2. **A shared error helper.** One place that writes `{"error": "code"}` with a status.
   Every handler will use it; retrofitting is annoying.
3. **The Data API boundary test.** See Proof below. This is the highest-value test in
   the codebase.
4. **Deploy to Fly** to prove the pipeline before feature code exists.

### Traps

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
  `/api/config`. A table in `public` with RLS off is world-readable.

### Proof

The boundary test must go **over HTTP against PostgREST** with a real anon key, not via
`SET ROLE` in a database session — role switching exercises grants while proving
nothing about the exposed-schemas config or the API gateway in front of it. Enumerate
tables from `information_schema` rather than hardcoding a list, so a table added later
without RLS fails the test instead of slipping through.

Then assert the four layers _independently_, because an end-to-end "anon gets nothing"
check passes just as happily when three of them have quietly stopped working:

- `has_schema_privilege('anon', 'app', 'USAGE')` is false
- `pg_policies` is empty for every `app` table
- `relrowsecurity` is true on each
- `relforcerowsecurity` is **false** on each

The test harness must `CREATE ROLE anon` and `CREATE ROLE authenticated` before
migrating. Vanilla Postgres has neither — they exist only because Supabase provisions
them — and `REVOKE ALL ON SCHEMA app FROM anon` errors outright on a missing role.
`001_init.sql` creates them if absent, so local migration works today; keep that.

---

## Phase 2 — Auth

**Goal:** a signed-in user with a display name.

### Concepts

- **JWKS** — Supabase publishes public keys at
  `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`. You validate signatures locally
  against those keys; no network call per request once cached.
- `github.com/lestrrat-go/jwx/v3` covers both JWS verification and a caching JWKS
  fetcher. Do not hand-roll JWT parsing.

### Build order

1. `internal/auth` — a validator holding a cached JWKS fetcher. Validate signature,
   then `iss` == `{SUPABASE_URL}/auth/v1`, `aud` == `authenticated`, and `exp`.
2. Middleware that extracts the bearer token, validates it, upserts the `app.users`
   row from `sub` + `email`, and puts the user on the request context.
3. `requireProfile` middleware — 409 `profile_incomplete` when `display_name IS NULL`.
4. `GET /api/me`, `PATCH /api/me`.
5. Frontend: `/api/config` fetch → `supabase-js` client → magic-link login screen →
   display-name onboarding screen driven by the 409.

### Traps

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

### Proof

- JWT rejection matrix: wrong `iss`, wrong `aud`, expired, `alg=none`, HS256 signed with
  the public key, an `alg` outside the allowlist, unknown `kid`. Rotation succeeds after
  one refetch.
- Profile gate: cache/item/request writes 409 before `display_name` is set, while
  `PATCH /api/me` succeeds. That second half is the assertion that catches the deadlock.

---

## Phase 3 — Caches

**Goal:** create a cache, share a link, let people in.

### Build order

1. `POST /api/caches` — cache row + owner's `active` membership, **one transaction**.
2. `GET /api/caches` — caches I'm an active member of.
3. `GET /api/caches/{id}` — detail, member list, and the `invite_token`.
4. `PATCH /api/caches/{id}` — name, `requires_approval`. Cache owner only.
5. `POST /api/caches/{id}/invite/rotate` — new high-entropy token (32 bytes,
   `crypto/rand`, base64url).
6. `POST /api/join/{token}` — insert `active`, or `pending` when `requires_approval`.
7. `GET /api/caches/{id}/join-requests` and approve/reject.

No member-removal endpoint in this phase. It ships in Phase 7 with its cascade.

### Traps

- **Resolve membership in the same SQL statement as the data fetch**, joining
  `cache_members` on `status='active'`. Never a separate pre-check — that is exactly how
  a direct-ID route drifts out of scope later.
- **Return 404, not 403,** for non-members, so nobody can probe for a cache's existence.
- **Cache creation must be one transaction.** Otherwise a partial failure leaves a
  creator who is not a member of the cache they just made and cannot see it.
- **A `removed` membership row blocks rejoin.** Leave it untouched and return 403. The
  invite link is still sitting in the group chat, so removal is meaningless otherwise.
- **A rejected join _deletes_ the pending row** rather than marking it `removed`, so a
  mistaken rejection can be redone.
- **Never return another user's `email`.** Member and queue payloads carry `user_id` and
  `display_name` — the client needs the ID to key rows and address the removal route —
  but email appears in exactly one response, `GET /api/me`, and only your own.
- **Enqueue outbox rows now**, even though the worker arrives in Phase 6. The table
  exists from migration 001 for this reason. Otherwise intermediate deploys drop join
  approvals on the floor and you retrofit enqueue calls into reviewed handlers later.

### Proof

Authorization matrix over non-member, pending member, removed member, active member,
and cache owner, across every direct-ID route, asserting 404 for cross-cache access.
Plus: creating a cache leaves the creator an active member; a removed member cannot
rejoin with a valid token.

---

## Phase 4 — Items

**Goal:** list things, with photos.

### Build order

1. `POST /api/caches/{id}/items` — active member; `owner_id` from the caller.
2. `GET /api/caches/{id}/items`, `GET /api/items/{id}`.
3. `PATCH /api/items/{id}` — item owner only.
4. `POST /api/items/{id}/photo` — multipart, item owner only.
5. Frontend `<canvas>` resize to max 1600px, re-encode to JPEG, then upload.
6. Batched signed URLs for list views, 1-hour TTL.

No delete endpoint in this phase. Phase 7.

### Traps

- **`is_consumable` is immutable after creation.** Flipping it strands `quantity` and
  every pending reservation counted against it.
- **`owner_id` comes from the authenticated caller, never the request body.**
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

## Phase 5 — Requests

**Goal:** the ask/approve handshake, without over-booking.

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
- **`quantity` must be `NULL` for a non-consumable and a bounded positive int for a
  consumable.** This is a cross-table rule no `CHECK` constraint can express, so the
  handler enforces it and a test covers both directions.
- **The item's own owner cannot request it.**
- **The pending queue is a deliberate disclosure** — requester `display_name`, quantity,
  and `created_at`, visible to every active member, because the product calls for a
  publicly visible queue. Decided requests stay visible only to the requester and the
  item owner.

### Proof

Concurrency, against real Postgres, with actual goroutines:

- Concurrent creates never let pending exceed available.
- Concurrent approves of the same request deduct exactly once.
- Approve-after-reject returns 409.
- A restock racing a create loses neither write.
- Quantity rejected when supplied for a non-consumable and when omitted for a consumable.

---

## Phase 6 — Notifications

**Goal:** the owner finds out, fast.

### Concepts

- **Web push is RFC 8291** — payloads are ECDH + AES-GCM encrypted per subscription.
  Use `github.com/SherClockHolmes/webpush-go`; there is no stdlib equivalent.
- **VAPID** keys identify your server to the push services.
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
- A recipient with no subscriptions gets email; a 410 deletes the subscription and emails
  in the same pass; a permanently failing send sets `failed_at` and stops being claimed.
- A straggler cannot stamp `failed_at` over another worker's `sent_at`.
- SSRF at dial time, which subscribe-time checks do not reach: an allowlisted hostname
  that _resolves_ to a private address is refused, and a 302 toward an internal address
  has the redirect refused.
- Endpoint reassignment between two accounts, after which the first receives nothing.

---

## Phase 7 — Destructive endpoints and cascades

**Goal:** removal and deletion that clean up after themselves.

### Build order

1. `DELETE /api/caches/{id}/members/{userId}` — status flip, delete their items in that
   cache, reject their outstanding requests, notify.
2. `DELETE /api/items/{id}` — cascade its requests, notify pending requesters.

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

## Phase 8 — Polish

**Goal:** ship it.

1. **Write rate limits.** A small in-memory token bucket per user is enough at this
   scale; joins and request creation are the paths worth limiting.
2. **Empty and error states** for every list and every mutation.
3. **PWA manifest and service worker.**
4. **Accessibility pass** — labeled form controls, visible focus, keyboard-reachable
   modals and sheets, sufficient text contrast.
5. **README setup steps** and the manual smoke checklist.

### Traps

- **iOS has no programmable install prompt.** There is no `beforeinstallprompt` in
  Safari, so iOS gets rendered instructions ("Share, then Add to Home Screen") and
  nothing more.
- **`Notification.requestPermission()` must be called from an explicit user gesture**,
  and on iOS only inside the installed PWA — that is the only context there that can
  receive push at all.

### Manual smoke checklist

None of these is cheaply automatable, and each covers a path the test suite cannot:

- A magic link arrives (exercises Supabase's SMTP config).
- A _notification_ email arrives — a separate path, the Resend API called directly from
  Go, so the magic link passing proves nothing about it.
- A signed image URL renders.
- Push arrives on an installed iOS PWA.
- A Fly rolling deploy with a pending migration comes up clean.
