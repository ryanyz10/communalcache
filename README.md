# Communal Cache

Mobile-first household sharing: React + a TypeScript Cloudflare Worker, one SQLite
Durable Object per cache, global D1, private R2 photos and Queues notifications.
Better Auth runs in the Worker with D1 cookie sessions and six-digit email codes
sent through Resend. Magic links are planned next; SMS is deferred. Web push and
notification email support real-life handoffs. Intended URL: https://communalcache.com
(provisioning needs approval). No addresses or loan tracking.

## Docs

- **[docs/build-guide.md](docs/build-guide.md)** — Foundation port then Features
  1–9, status, scope, traps and each feature's proving check. Start here.
- **[docs/plan.md](docs/plan.md)** — product/architecture spec, split data model,
  authorization, delivery/recovery rules, tradeoffs and sourced platform facts.
- **[docs/database.md](docs/database.md)** — D1/DO placement, local transactions,
  migrations, sync and Worker-runtime test setup.
- **[docs/deploy.md](docs/deploy.md)** — approval-gated Cloudflare runbook,
  Better Auth/Resend/domain setup, release checks and cutover/rollback constraints.
- **[AGENTS.md](AGENTS.md)** — invariants and working conventions.

## Status

The architecture above is the **target**, not an already completed port. This PR
changes docs only. The existing Go foundation is live; Go Caches and Joining in
[#2](https://github.com/ryanyz10/communalcache/pull/2) and
[#3](https://github.com/ryanyz10/communalcache/pull/3) are reference implementations
to be superseded, not merged automatically by this spec.

Next: **Foundation port**, then Caches/Joining ports and Features 3–9. See the
[status table](docs/build-guide.md#status). Existing production and Supabase
Auth/Postgres stay live until an explicitly approved cutover, mapping users by
verified email into new Better Auth identities. No target Supabase dependency;
no resources, settings, secrets or deployment changes in this documentation PR.

## Checkout layout today

```text
cmd/server/       Existing Go entrypoint and embedded SPA
internal/         Existing Go API/auth/config/Postgres code and tests
migrations/       Existing PostgreSQL migrations; not D1 migration input
web/              React + TypeScript + Vite SPA
```

The Foundation port adds Worker/DO tooling, separate SQLite migrations and local
Vitest bindings. It does not pretend existing Go source/package/config has already
been replaced. Target commands after that tooling exists:

```bash
npx --no-install tsc --noEmit
npx --no-install vitest run
(cd web && npx --no-install tsc --noEmit && npm run build)
npx --no-install wrangler d1 migrations apply communalcache --local
npx --no-install wrangler dev
npx --no-install wrangler deploy --dry-run
```

Use gitignored `.dev.vars` for local values; never production bindings in tests.
`wrangler dev` defaults to local resources. A real deploy or provider/secret
configuration still requires explicit approval. Legacy Go commands/config remain
in the checkout for reference; they are not Cloudflare completion gates.
