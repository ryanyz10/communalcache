# Communal Cache — agent context

Mobile-first web app for a close community to share household things (a bag of brown
sugar, a stand mixer). It is a **facilitator** for handoffs that happen in real life,
not a logistics system: its value is a directory of who has what plus a lightweight
request/approve handshake. No addresses are ever stored.

Single Go binary serving an embedded React SPA. Supabase for Auth, Postgres, and
Storage. Web push with email fallback via Resend. Deployed on Fly.io.

## How to work on this repo

The agent implements one feature per PR; the human reviews each on a whiteboard.

- Implement the features in [docs/build-guide.md](docs/build-guide.md) in order,
  end to end: backend, that feature's UI slice, and tests.
- Each feature gets its own branch `feat/<short-name>` and exactly one commit
  (amend, don't stack). Before committing, run the backend and frontend gates below.
- Open a PR with `gh pr create`. If the previous feature's PR has not merged, base
  the new branch on it, set the PR base to that branch, and add a `Depends-on: #N`
  line to the PR body. In the same PR, update the feature's build-guide status row.
- After opening the PR, publish a review whiteboard: what now works and how to try
  it, flow/sequence diagrams with code links for key paths, a diff of the
  invariant-critical code, and findings (risks, deviations from `plan.md`, open
  questions).
- Keep building the next feature without waiting for review. Apply feedback by
  amending the relevant branch and restacking the branches above it.
- External changes (Fly deploys, Supabase dashboard/storage config, secrets) need
  the human's explicit approval first.
- Review against the invariants below and the build-guide traps. Those traps are
  real defects caught in review, not style preferences.
- Say when something is a genuine bug versus a preference, and don't invent problems.

## Documents

- **[docs/plan.md](docs/plan.md)** — the spec. Source of truth on _what_ to build,
  including the data model, per-route authorization, and known tradeoffs. Treat it as
  settled; the decisions in it survived eight review rounds. Do not edit it.
- **[docs/build-guide.md](docs/build-guide.md)** — feature order, status, concepts,
  traps, and the check that proves each feature. Start here to find out which feature
  is next.

## Non-negotiable invariants

Violating any of these causes data loss, a security hole, or a deadlock. They are
justified in the docs; do not "simplify" them away.

1. **Tables live in the `app` schema, never `public`,** and RLS is enabled with zero
   policies. Supabase's PostgREST Data API is reachable with the anon key, which the
   browser holds. `FORCE ROW LEVEL SECURITY` must never be set — Go gets through as the
   owning role, and FORCE would remove that exemption.
2. **`DATABASE_URL` is direct or Supavisor session mode, never transaction pooling
   (6543).** Transaction pooling silently defeats the migration advisory lock.
3. **The over-booking guard:** lock the item `FOR UPDATE`, _then_ read the pending sum in
   a separate statement, under `READ COMMITTED`. Decisions use a guarded
   `UPDATE ... WHERE status='pending'` and roll back with 409 on zero rows affected.
4. **One lock order, everywhere:** `cache_members` first, then item rows ascending by
   `id`. Anything else deadlocks against member removal.
5. **Destructive paths lock affected items before snapshotting** the requests they will
   destroy, or a concurrently created request is erased after its author got a 201.
6. **Outbox claim eligibility is bounded on `failed_at`, never `attempts`,** and both
   terminal writes are guarded with `AND sent_at IS NULL AND failed_at IS NULL`.
7. **Membership is resolved in the same SQL statement as the data fetch,** joining on
   `status='active'`. Never a separate pre-check. Non-members get **404, not 403**.
8. **No endpoint returns another user's email.** Only `GET /api/me`, and only your own.
9. **Push endpoints are untrusted input:** origin allowlist at subscribe time, HTTPS
   only, and a client that refuses redirects and non-public IPs after resolution.
10. **`requireProfile` exempts `PATCH /api/me`** and the push routes, or a new user can
    never set a display name.

## Conventions

- **Go stdlib `http.ServeMux`** with method patterns. No router library.
- **`pgx` with hand-written SQL.** No sqlc, no ORM. All cache-scoped queries go through
  `internal/db` so authorization has one auditable chokepoint.
- **No new dependencies without a reason** that survives "does stdlib or an installed
  dep already do this?" Current justified exceptions: `pgx`, `jwx` (never hand-roll
  crypto), `webpush-go` (RFC 8291 encryption), `@supabase/supabase-js` (Auth client),
  `react-router` (SPA routes), `@tanstack/react-query` (server state), Tailwind via
  `@tailwindcss/vite` (CSS).
- Intentional simplifications get a `ponytail:` comment naming the ceiling and the
  upgrade path.
- Comments explain constraints the code cannot show. Not what the next line does.
- **Keep it simple enough to read cold.** Follow the boring best practice over the
  clever one. Never build abstractions, interfaces, or harnesses ahead of need —
  every layer you add is one a new reader has to load before they can change
  anything. Someone should be able to open a file and understand what it does and
  why, without cross-referencing three other files or reconstructing indirections.
  If a simpler shape does the job — a list instead of a live query, one function
  instead of two layers of wiring — the simpler shape is correct. Deleting code
  beats adding it. When something genuinely needs the complexity, the comment says
  why; otherwise complexity is a defect.
- Non-trivial logic leaves one runnable check behind. Concurrency, constraint, and
  migration tests run against real Postgres from `TEST_DATABASE_URL`, never a mock.
- One commit per branch or PR; amend rather than stacking commits.

## Commands

```bash
make test && make vet && test -z "$(gofmt -l .)"  # backend gates (Make loads .env)
cd web && npx tsc --noEmit && npm run build      # frontend gates
make web-build                                   # build SPA into cmd/server/dist
make dev                                         # go run ./cmd/server via .env
make boundary-http                               # hosted PostgREST; not make test

docker run -d --name cc-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=communalcache postgres:16
```

Put `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_BASE_URL` (and
later Photos, Notification worker + email, and Web push + PWA vars) in a gitignored
`.env`; the Makefile `-include`s it.
A bare `go test ./...` does **not** load `.env`.

Test harness must `CREATE ROLE anon` and `CREATE ROLE authenticated` before migrating —
vanilla Postgres lacks both, and the `REVOKE` in migration 001 fails without them.

## Current state

Foundation is done on `master` and deployed at https://communalcache.fly.dev:
app schema and migration ledger, health/config, embedded SPA, JWT auth,
`GET`/`PATCH /api/me`, magic-link login, and display-name onboarding. Login and
onboarding are verified locally and on Fly. Providers are configured (Resend SMTP,
Data API off, asymmetric JWT keys, Site URL + redirect wildcards). Hosted PostgREST
boundary passes via `make boundary-http`.

**Next:** Feature 1 (Caches). Per-feature status lives in the
[build-guide status table](docs/build-guide.md#status).
