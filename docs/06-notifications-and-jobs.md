# Notifications and jobs

## Delivery goals

- User actions commit independently from external email availability.
- Eligible recipients are decided from transactionally consistent membership
  and preferences.
- Delivery is at-least-once internally and effectively-once at the provider
  within Resend's idempotency window.
- Duplicate email risk is minimized and observable.
- No notification contains a cache password, join code, private email list, or
  security-sensitive detail.

## Event matrix

| Event | Category | Recipients | Exclusions |
|---|---|---|---|
| First creation of inventory item | `new_items` | Active cache members with category enabled | Actor |
| Request opened | `requests` | Active cache members with category enabled | Actor |
| Request fulfilled | `requests` | Requester if active and enabled | Actor if same person |
| Request cancelled | — | None | Only the requester can cancel, so actor exclusion suppresses it |

Quantity additions to existing items, takes, joins, leaves, removals, password
rotations, and cache settings changes do not send MVP email.

Recipient selection happens when the domain transaction is committed. A user
removed after enqueue but before send SHOULD be suppressed by a final active
membership check in the worker. A preference disabled after enqueue but before
send SHOULD also suppress the pending job. Suppressed jobs are marked `sent`
with a non-delivery outcome so they do not retry.

## Outbox schema

`private.notification_outbox`:

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `event_type` | text | constrained |
| `cache_id` | uuid | required |
| `subject_id` | uuid | required |
| `recipient_user_id` | uuid | required |
| `template_version` | integer | required |
| `payload` | jsonb | validated, bounded |
| `idempotency_key` | text | globally unique |
| `status` | outbox_status | required |
| `attempt_count` | integer | default 0 |
| `next_attempt_at` | timestamptz | required |
| `lease_owner` | text | nullable |
| `lease_expires_at` | timestamptz | nullable |
| `provider_message_id` | text | nullable |
| `last_error_code` | text | nullable |
| `created_at` | timestamptz | required |
| `sent_at` | timestamptz | nullable |

Unique `(event_type, subject_id, recipient_user_id, template_version)` prevents
duplicate enqueue. The Resend idempotency key derives from these same stable
values and remains below the provider limit.

Payload contains presentation-safe identifiers and snapshot strings only. It
does not contain the recipient email; the worker resolves the current verified
address from `private.user_contacts`.

## Claim and delivery algorithm

Each active server starts a worker with a unique instance/release identifier.

1. Poll every five seconds with jitter when work exists and back off to 30
   seconds when idle.
2. In a short transaction:
   - Select up to 20 `pending` rows whose `next_attempt_at <= now()`.
   - Also select `processing` rows with an expired lease.
   - Use `FOR UPDATE SKIP LOCKED`.
   - Set `processing`, increment attempts, assign worker, and lease for two
     minutes.
   - Commit.
3. For each claimed row:
   - Recheck recipient active membership and current preference.
   - Resolve verified email.
   - Render a versioned text and HTML template.
   - Send through Resend with the stable idempotency key.
4. In a new transaction:
   - On success, set `sent`, provider ID, and timestamp.
   - On suppression, set `sent` with `last_error_code` prefixed `suppressed_`.
   - On retryable failure, return to `pending` with next attempt.
   - On permanent failure or exhausted retries, set `dead`.

Worker shutdown:

- Stop polling on SIGTERM.
- Cancel unstarted claimed jobs by expiring their leases.
- Allow active HTTP sends up to ten seconds.
- Never hold a database transaction during delivery.

## Retry policy

Maximum eight attempts:

```text
1m, 5m, 15m, 1h, 4h, 12h, 24h
```

Apply bounded jitter. Respect provider `Retry-After` when it is longer.

Retry:

- Network timeout/reset.
- Provider `408`, `409` concurrent idempotency, `429`, and `5xx`.

Do not retry:

- Invalid/unverified recipient.
- Invalid template payload.
- Provider authentication/permission failure after one alerting attempt.
- Recipient no longer active or opted out.

Provider-wide authentication errors trip a circuit breaker for five minutes and
raise an operator alert; they must not burn through every queued attempt.

## Templates

Templates are versioned Go `html/template` and `text/template` assets embedded
in the binary. Every email includes:

- Clear product and cache name.
- Human-readable actor display name.
- Minimal event detail.
- An absolute HTTPS link to the relevant cache route.
- Plain-text alternative.
- Preference-management link.
- Product/operator identity and support contact.

Escape all user-authored strings. Never use user content in email headers
without strict sanitization. Subject lines use controlled templates and bounded
item/cache names stripped of control characters.

Initial templates:

- `new_item_v1`
- `request_opened_v1`
- `request_fulfilled_v1`

Changing existing template meaning creates a new version so queued jobs remain
renderable.

## Email-domain setup

Before external testing:

- Verify a dedicated sending subdomain in Resend.
- Configure SPF and DKIM.
- Publish DMARC initially in monitoring mode, then tighten after observing
  legitimate traffic.
- Use a stable `From` address and monitored reply/support address.
- Keep Supabase Auth email and application notification identities visually
  consistent while using their appropriate provider configurations.

## Unsubscribe behavior

Notification categories are user-configurable transactional preferences rather
than marketing subscriptions.

- Email links route to authenticated per-cache settings.
- A signed one-click category-disable endpoint MAY be added only if the token is
  scoped to user, cache, category, expiry, and one action. It is not required
  for MVP.
- Account/login/security emails cannot be disabled through cache preferences.

## Maintenance jobs

The continuous worker may also run leader-elected periodic maintenance using a
Postgres advisory lock:

- Hourly: release expired leases and purge expired rate-limit buckets.
- Daily: delete expired mutation receipts and sessions past retention.
- Daily: reduce sent outbox payloads older than 30 days to metadata.
- Daily: report dead-letter counts and oldest pending age.

Maintenance failures never block the HTTP server but are logged and alerted.

## Operational metrics

Record:

- Pending/processing/dead counts.
- Oldest pending job age.
- Claims, deliveries, suppressions, retries, and dead letters by event type.
- Resend latency and response class.
- Circuit breaker state.

Do not use recipient email or user-authored content as metric labels.

Initial alert thresholds:

- Oldest pending job exceeds 10 minutes.
- Any dead-letter job in production.
- More than five provider failures in five minutes.
- Worker loop has not completed a poll in two minutes on the always-running
  Machine.
