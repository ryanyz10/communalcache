# Implementation roadmap

## Working agreement

- Implement phases in order; later UI work may scaffold against generated
  clients but must not bypass incomplete security boundaries.
- Each phase ends with tests and documentation updates.
- Keep commits small enough to review and never mix generated changes with
  unrelated refactors.
- Do not weaken a requirement merely to make a test pass.
- Record necessary deviations in the decision register before implementation.

## Phase 0: repository and toolchain

Deliver:

- Go module and `cmd/communalcache`.
- React/TypeScript/Vite application.
- Repository layout from the architecture document.
- Makefile, formatter/linter configuration, editor configuration.
- Multi-stage Dockerfile with non-root runtime.
- Initial OpenAPI document and code-generation wiring.
- sqlc configuration and migration tool.
- CI skeleton with frozen dependency installs and secret scanning.
- Local environment template containing names, never real values.

Exit criteria:

- `make build`, `make test`, and `make docker-build` pass.
- Go binary serves `/health/live` and embedded placeholder SPA.
- Generated code drift check works.
- Production image has no Node executable.

## Phase 1: database foundation and sessions

Deliver:

- Schemas, roles, extensions, migration history.
- Profiles, contacts, application sessions, rate limits, and security audit
  tables.
- Supabase Auth REST adapter and JWKS verification.
- Encrypted opaque application sessions, CSRF, origin enforcement.
- Email OTP, explicit refresh, logout/current/all sessions.
- Profile onboarding.
- TOTP MFA enrollment/challenge/removal.
- RLS helpers and role/grant tests.

Exit criteria:

- Auth/session/CSRF/JWT test suites pass.
- Two-process refresh race is deterministic.
- Browser receives no Supabase tokens.
- App and worker roles cannot access privileged data outside their grants.

## Phase 2: caches and membership

Deliver:

- Cache, secret, membership, preference, event, and mutation-receipt migrations.
- Cache creation policy interface with free implementation.
- Argon2id hash/verify/rehash and concurrency bound.
- Cache create/list/detail/rename/archive/unarchive.
- Join, leave, remove, restore, credential view, password rotation.
- Role and membership RLS policies.
- Dashboard, create, join, members, and settings UI.

Exit criteria:

- Full membership state-machine and role matrix tests pass.
- Removed users cannot rejoin; left users can.
- Owner invariant survives concurrent/admin operations.
- Password/join failures do not leak target state.

## Phase 3: inventory and activity

Deliver:

- Inventory item/transaction migrations and immutable protections.
- Name normalization and supported-unit validation.
- Atomic create/add/take services and endpoints.
- Idempotency receipt handling.
- Activity merge/cursor and personal stats queries.
- Inventory, add/take, activity, and statistics UI.

Exit criteria:

- Concurrency/property tests prove balance/log invariant.
- Cross-cache item and transaction access fails closed.
- UI never calculates an authoritative balance with JavaScript floats.
- Retry with one idempotency key cannot double-apply.

## Phase 4: requests

Deliver:

- Request migration, state transition service, events, and API.
- Request list/create/fulfill/cancel UI.
- Conflict refresh behavior.
- Request activity feed integration.

Exit criteria:

- Transition race and authorization tests pass.
- Terminal history remains visible after membership changes.
- All request input renders safely.

## Phase 5: notifications

Deliver:

- Private outbox migration and worker role.
- Transactional recipient selection for new item/request events.
- Claim/lease/retry/dead-letter worker.
- Resend adapter and four versioned templates.
- Preference UI and endpoints.
- Maintenance cleanup and operational metrics.

Exit criteria:

- Domain state succeeds during provider outage.
- Retry, suppression, lease recovery, and idempotency tests pass.
- Staging email authentication records and test delivery work.
- No email contains secrets or unauthorized recipient data.

## Phase 6: UX, PWA, and accessibility completion

Deliver:

- Responsive layouts and all empty/loading/error/access-lost states.
- PWA manifest, icons, safe asset-only service worker, offline page.
- Keyboard/focus/live-region behavior.
- Session-expiry and cache-clearing behavior.
- Component accessibility coverage and complete Playwright journeys.

Exit criteria:

- Critical flows pass at 320 px and desktop widths.
- WCAG automated checks and manual keyboard checklist pass.
- No private response is persisted by PWA/browser application storage.

## Phase 7: production hardening and Fly deployment

Deliver:

- `fly.toml`, health checks, release/migration command, graceful lifecycle.
- Staging and production configuration validation.
- Logs, metrics, alerts, budget alerts, and dashboards.
- Secret rotation, backup/restore, rollback, incident, and privacy runbooks.
- Dependency/image scans, SBOM, immutable image promotion.
- Custom domain and security/email DNS records.

Exit criteria:

- Production launch checklist passes.
- Failover and graceful deploy tested with two Machines.
- Staging database restore drill recorded.
- No unresolved launch blocker remains in the decision register.

## Suggested vertical slices

Within a phase, prefer complete thin slices:

1. Migration/constraint.
2. sqlc query.
3. domain service.
4. handler/OpenAPI.
5. generated frontend client.
6. UI behavior.
7. unit, integration, and E2E coverage.

Do not build all tables, then all handlers, then all UI without validating a
working secured path.

## Review checkpoints

Request focused review after:

- Session/auth boundary.
- Database roles and first RLS policies.
- Membership removal/join behavior.
- Inventory transaction and concurrency implementation.
- Outbox lease/retry algorithm.
- Fly production configuration.

These areas carry disproportionate security or data-integrity risk.

## Handoff artifacts required from the implementation agent

- Running source and locked dependencies.
- Complete OpenAPI contract and generated clients.
- Forward migrations and schema diagram.
- Environment variable reference.
- Local development instructions.
- CI workflow and test evidence.
- Fly deployment/runbook documentation.
- Provider setup checklist with no secret values.
- Known limitations and deferred work list.
- Decision-register updates for any divergence.
