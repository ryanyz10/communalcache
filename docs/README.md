# Communal Cache implementation handoff

## Purpose

These documents are the decision-complete implementation specification for the
Communal Cache MVP. The intended reader is an engineer or coding agent starting
from an empty repository.

The documents deliberately separate product behavior from implementation
details so that security or schema decisions do not become accidental UI
behavior.

## Copy-paste handoff prompt

> Implement the Communal Cache MVP in this repository. Start by reading
> `docs/README.md` and every document in its reading order before editing code.
> Treat `MUST` requirements and documented security/data invariants as
> acceptance criteria. Follow `docs/10-implementation-roadmap.md` phase by
> phase, run each phase's tests, and update the decision register plus all
> affected specifications before making any necessary deviation. Do not add
> deferred features or weaken RLS, session, idempotency, transaction, privacy,
> or deployment requirements for convenience. Continue through a verified
> staging-ready implementation unless an external credential/operator choice is
> genuinely required.

## Reading order

1. [Product requirements](01-product-requirements.md)
2. [System architecture](02-system-architecture.md)
3. [Data model and authorization](03-data-model-and-authorization.md)
4. [API and authentication](04-api-and-authentication.md)
5. [Frontend and UX](05-frontend-and-ux.md)
6. [Notifications and jobs](06-notifications-and-jobs.md)
7. [Security and privacy](07-security-and-privacy.md)
8. [Deployment and operations](08-deployment-and-operations.md)
9. [Testing and acceptance](09-testing-and-acceptance.md)
10. [Implementation roadmap](10-implementation-roadmap.md)
11. [Decision register and open follow-ups](11-decision-register.md)

## Source-of-truth hierarchy

When documents appear to conflict, use this precedence:

1. Security and privacy invariants
2. Product requirements and role matrix
3. Data constraints and authorization policies
4. API contract
5. Frontend behavior
6. Deployment defaults

Do not silently resolve a genuine conflict. Record the resolution in the
decision register and update every affected document in the same change.

## Required implementation characteristics

- The browser is a React/TypeScript SPA.
- The production backend and asset server are one Go binary.
- Node.js exists only in frontend build and test stages.
- Supabase provides hosted Postgres and identity. The browser never accesses
  the Supabase Data API directly.
- All application access goes through the versioned Go API.
- Go authorization is the primary enforcement layer; Postgres RLS is the
  independent defense-in-depth layer.
- Inventory balances and their immutable transaction records change atomically.
- Notifications use a transactional Postgres outbox.
- Production is packaged as a portable OCI image and initially deployed to
  Fly.io.
- Application code must not import Fly-specific runtime APIs.

## Definition of done

The MVP is complete only when:

- Every `MUST` requirement in the product specification is implemented.
- The API behavior and error shapes match the API specification.
- The database constraints and full RLS matrix pass integration tests.
- All acceptance tests in the testing document pass.
- The production image contains no Node runtime or frontend source maps.
- A staging deployment has passed login, cache, inventory, request,
  notification, backup/restore, graceful deploy, and Machine failover checks.
- Required secrets, DNS records, monitoring, budget alerts, and runbooks are in
  place.

## Scope discipline

Do not add expiration lots, unit conversion, SMS, native applications, barcode
scanning, ownership transfer, offline mutation queues, public cache discovery,
social features, or paid plans during this implementation. Preserve extension
points for those features without building speculative systems.
