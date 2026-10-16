# User-flow inventory

The refactor invariant: **keep every implemented journey below reachable, with
its authorization, privacy, durable effects and recovery behavior intact**.
This is a map of implemented journeys, not permission to add deferred features
or preserve bugs. The Organic walkthrough is current; the original inventory
below is retained as historical evidence. Product changes need an explicit
decision and observed defects need regression proof.

## Organic redesign closure — current walkthrough

This section supersedes the **historical pre-redesign observations below** for
screens and walk status. All 54 journeys were revisited on `feat/organic-parity`,
stacked on Organic PRs #56–#60. A check means the stated primary local journey,
not every race, device or provider variant. This is not security/release approval.
The approved invite-preview follow-up below updates the JOIN interpretation;
the other walkthrough results remain the Organic parity baseline.

- Real Chromium, native 390/1280 layouts and system day/night/reduced motion;
  additional library checks at 320/640/768. Local Worker/D1/private R2 at
  `localhost:5198` (Vite proxy to 8798), isolated persistence, three seeded
  `@example.com` users: Ryan (owner), Maya (member/item owner/requester, then
  actually removed) and Jun (initially unnamed applicant, then active member).
  Seeded sessions are setup, not email-delivery proof.
- Explicit dummy-only runtime configuration; no existing `.dev.vars` or real
  provider credential is used. The local configuration has a producer-only Queue,
  **no consumer and no Cron**, so durable effects can be inspected without
  sending email/push or running cleanup. No `--remote`, deploy or setup change.
- A seeded, hashed, five-minute magic-link challenge was redeemed through the
  real explicit Continue page. Link sending/Turnstile and OTP sending remain
  blocked locally. The separate `localhost:4178` fixture exercised check-email,
  resend and invalid/valid OTP presentation only; it is **not D1/auth/provider
  proof**. No test bypass was added to production code.
- Uncommitted receipts: `/tmp/cc-redesign/organic-parity/`. `walk-*.log` records
  browser steps, URLs and observed states; `final-d1-summary.log` records effects
  **before** later gallery-only setup; `walk-retry.log` and its separate D1
  receipt record the later full saved-item/photo/sharing recovery. Added pagination rows and gallery-only
  pending/approved rows are explicitly setup, not extra successful decisions.
  Browser batches were split at identity/route boundaries; failed/blank captures
  were not accepted as observations. Some CLI timeouts reported CDP disconnects;
  only the successful resumed steps below count.
- Fresh `compare-B01`…`compare-B25-{day,night}.png` are source LEFT/app RIGHT at
  native board widths, without rescaling. B04/B05 app frames are labeled fixture
  presentation; the other boards use local D1 (including explicit gallery setup).
  B00 is the primitive/token reference, not a shipped system-demo route. Phone
  captures omit the export's 34px fake OS row. Landing comparisons include native
  390/1280/1440 plus hover and night adaptation. Screenshots stay out of git.

### Approved invite-preview follow-up

The owner's 2026 chat decision, **“Invite page before joining”**, supersedes the
neutral pre-join default. After sign-in/name setup, the valid-current-secret page
shows **only the cache name, exact active count and up to five cat trait tuples**,
with a true +N and YOU slot. The uppercase eyebrow says “An invite to <cache
name>”; the main heading stays “There's room in the box for you.” and the greeting
uses only the caller's own chosen name. The count label says “neighbors”. No
inviter, member names, IDs/hashes/seeds, emails, photos, things count or approval
stamp/configuration is returned or inferred.

`GET /api/caches/{id}/invite/preview` requires a D1-backed cookie and carries the
secret in `X-Invite-Secret`, not an API URL. One guarded SQL read checks the current
secret/active owner and removed denial, then returns only
`{name,active_member_count,members:[{coat,pattern,folded,tip,delay}]}`. Shared
`shared/cats.ts` derives exactly the same cats the signed-in app renders; no
per-cache identity seed changes their appearance. No preview creates a membership
or notification, grants item/profile-photo access or authorizes a later join.
The explicit POST still rechecks all existing secret/config/quota guards. Active
and pending members still tap Ask to join; no automatic redirect/join was added.

Follow-up local receipts are uncommitted in `/tmp/cc-redesign/invite-preview/`.
This is another isolated producer-only local Worker/D1 with a fresh dummy-only
`.dev.vars`, no Queue consumer/Cron and no real mail/push. Signed-out UI made zero
preview requests; authenticated preview200 returned only the allowlist while
cache/items/profile-photo reads stayed404. Cancel cleared both intent stores.
A real gated ask stayed outside the roof/count until owner approval; pending and
active replays remained explicit. After approval, real preview traits equaled
traits derived from the authorized member read. Open join completed separately.
Owner invite rotation between a loaded preview and Ask made the write/read fail;
previously loaded name/count/cats disappeared and Join became disabled. Removed
current-secret403, stale-secret404 and left→pending rejoin were walked. The four
native source/app comparisons are `compare-invite-{phone,wide}-{day,night}.png`
(B02 desktop/B06 phone; B05 is onboarding, not the invite board).

### Every-flow walk ledger

**✓** = stated primary journey completed locally; **partial** = stated portion
walked with the remaining boundary named; **blocked** = completion needs the
named unavailable/approval-gated setup. Existing real-D1/UI tests cover additional
races/errors; a test is not an unperformed browser step.

| Flow | Redesigned screens / observed walkthrough | Status / remaining boundary |
| --- | --- | --- |
| AUTH-01 | L01/L02 shelf landing → Get started/Sign in or invite guidance; no cache/user data requests. | **✓** Native day/night/hover; CTAs retain `/login` and `/login?invite=1`. |
| AUTH-02 | Starting/read failure → alert + Try again → Home; protected signed-out route → sign-in; unnamed Jun → name setup. | **✓** Real `/api/me` read abort and recovery; revocation races remain automated coverage. |
| AUTH-03 | B01/B03 labelled sign-in; unavailable bot state disables sends. Fixture B04 check-email, resend and fallback. | **blocked** Real Turnstile/email send intentionally unconfigured; fixture is presentation only. |
| AUTH-04 | Organic Almost there → explicit Continue → Home from a seeded real D1 challenge; invalid/missing recovery. | **✓** Fragment removed and zero verification requests before Continue. Sending/receiving that email is not proved. |
| AUTH-05 | Organic six-box/native code input, invalid-code alert and successful name-setup destination in fixture. | **blocked** Real OTP sending/expiry/rotation needs configured bot/email; browser redemption here was fixture-only. |
| AUTH-06 | B05 name tag/six coats → Jun enters name → preserved invite. | **✓** Real self-profile save; no email-derived name. |
| AUTH-07 | Organic Account → Sign out → sign-in; next protected route is signed out. | **✓** Real session revocation; live push unsubscribe/account reassignment remains device/provider coverage. |
| JOIN-01 | Saved-invite sign-in/name setup → current-secret name/count/cat preview; Cancel clears both intent stores. | **✓** Follow-up signed-out page made no preview read; authenticated allowlist/Cancel walked. Storage-denial/TTL/cross-tab variants remain tests. |
| JOIN-02 | Organic paste sheet → malformed alert → foreign-origin link parsed into local invite → active replay. | **✓** No write until explicit join. |
| JOIN-03 | Valid preview → explicit Ask to join → Welcome/Open cache; open join and active replay. | **✓** Follow-up open admission and active replay walked; zero join requests before tapping. Preview itself is not a membership grant. |
| JOIN-04 | Valid preview → B07 applicant outside box → Waiting for owner approval. | **✓** Follow-up real gated ask/replay kept count6 and cache404 until owner decision. Baseline Jun reject/reapply remains recorded. |
| JOIN-05 | Organic settings packing slip → owner approval → active member. | **✓** Baseline Jun and follow-up Ryan approval completed; count rose6→7 and shared preview/app traits matched. Caps/races remain SQL tests. |
| JOIN-06 | Same slip → Reject Jun → no pending row; Jun explicitly reapplies. | **✓** Real rejection/outbox, not a seeded result. |
| JOIN-07 | Left/current invite preview → explicit rejoin; removed/current-secret preview403; stale-secret404. | **✓** Follow-up left→pending walked; removed/rotated denial showed no old preview fields. Loaded-preview→rotation→Ask failed and hid stale metadata. Baseline actual-removal preservation proof remains unchanged. |
| CACHE-01 | B08/B11 boxes, real counts/asks, desktop previews and phone create/join entry. | **✓** Real Home/navigation; empty/error variants retain tested recovery. |
| CACHE-02 | B10/B12 representative preview, live name/count/switch, unavailable real bot check. | **blocked** Real create requires Turnstile. No fake bot-passed state or seeded-cache creation claim. |
| CACHE-03 | B09/B13 contents/member cats, owner/member actions, search → honest no-match result. | **✓** Real authorized cache/item reads and responsive layouts. |
| CACHE-04 | Organic settings name editor → save; approval switch OFF/ON. | **✓** Real rename/config writes. Cancel/limits/races retain automated coverage. |
| CACHE-05 | Copy → Invite copied; reset confirmation with Cancel focus → rotate → old-link denial. | **✓** Membership unchanged; selectable fallback retained. |
| CACHE-06 | Organic Remove Maya confirmation → actual removal → cache denial. | **✓** Her private drill and its other-cache attachment survived; affected pending ask was rejected. |
| CACHE-07 | Organic Leave confirmation → Home → Jun rejoins open cache. | **✓** Owner has no Leave control; affected-cascade/race matrix remains SQL proof. |
| ITEM-01 | B21/B23 personal box/slip, real totals; >25 seeded items → Load more. | **✓** Real cursor continuation; seed rows are pagination setup. |
| ITEM-02 | B24 private New item → Parity ladder → owner detail. | **✓** One real canonical item, subsequently edited/shared/deleted. |
| ITEM-03 | B14 New item tab → consumable Parity seeds → cache list. | **✓** Real atomic create+first attachment, stock 6. |
| ITEM-04 | B14 Your items → select Existing proof → Add 1 → cache contents. | **✓** Real idempotent attachment; multi-selection partial variants remain tests. |
| ITEM-05 | B15/B17 name/photo tile; own library/member detail; removed cache item denied while own/other-cache drill survives. | **✓** No cache permission from retained request history. |
| ITEM-06 | Organic owner edit with immutable kind → saved title. | **✓** Successful real edit; reserved-stock and type errors remain automated checks. |
| ITEM-07 | Organic availability editor → Lent out/note saved → available again. | **✓** Real flag changes; the note-clear transient acknowledgement was not separately confirmed. No return/holder model. |
| ITEM-08 | Shown in → check two caches → same canonical item shared twice. | **✓** Bodyless PUT now works in the real browser; no copied stock. |
| ITEM-09 | Stop sharing confirmation with Cancel focus → detach only one cache. | **✓** Other attachment and current private photo remained before subsequent global deletion. |
| ITEM-10 | Delete everywhere confirmation with Cancel focus → library. | **✓** Real item/attachment/history deletion and durable exact/prefix cleanup rows. |
| PHOTO-01 | Organic owner uploader → real PNG decode/resize/upload → private image natural width 512; optional-create photo failure → Retry photo. | **✓** Real local R2/D1. A browser-blocked upload retained the saved item, then retried successfully without another create; decode/size variants remain tests. |
| PHOTO-02 | Replace photo → private image natural width 192; owner tile stays usable. | **✓** Real replacement/cleanup; broken-image retry and full permission matrix remain automated coverage. |
| PHOTO-03 | Organic Account photo sheet → upload then replace. | **✓** Real profile pointer and exact-scope cleanup; no public/signed URL. |
| PHOTO-04 | Remove photo → cat fallback. | **✓** Real current pointer removed, profile cleanup persisted; last-shared-cache race matrix remains SQL proof. |
| REQ-01 | B15/B17 cache queue after sending; scope remains current cache only. | **✓** Real pending queue; other-cache/three-party matrix remains SQL proof. |
| REQ-02 | Reusable ask sheet with no quantity → Ask sent/Done; Lent out disables new ask. | **✓** Real request/outbox, no cancellation or loan lifecycle. |
| REQ-03 | B18 consumable sheet min 1/max server stock 6 → send 2 → Ask sent. | **✓** Real reservation; races/caps/unknown stock remain tests. |
| REQ-04 | B16 Requests/phone adaptation, three groups and missing-contact nudge; >25 rows → Load more. | **✓** Real party-only pagination and exact summary badge, not first-page counts. |
| REQ-05 | Consumable approval sheet: empty message, no reusable switch → approve. | **✓** Real stock 8→6 once plus durable outbox. |
| REQ-06 | B19 reusable approval: ON toggle, empty message/note → typed private message → approve. | **✓** Real flag/message/decision/outbox; API omission semantics unchanged. |
| REQ-07 | Separate Organic decline sheet: blank required reason disables action → valid reason → declined. | **✓** Real decision; reservations release without stock deduction. |
| REQ-08 | B20 focused detail, owner/requester directions, actual chosen email contact; then actual removal. | **✓** History 200/contact 404/item 404 despite another shared cache; retained note remains, zero history item-photo requests. |
| ACCT-01 | B22/B25 shipping-label profile → name save/cancel; own email stamped PRIVATE. | **✓** Real self-bound save; no auth email edit/prefill. |
| ACCT-02 | Organic six-platform editor; Text/WhatsApp/Signal/Messenger previews and chosen-email save. | **✓** Real chosen-email destination/save; Instagram-specific rendered preview/native app launch not claimed. |
| ACCT-03 | Remove contact → missing-contact state. | **✓** Real bodyless DELETE; auth email unaffected. |
| ACCT-04 | Organic push panel: OFF/disabled and honest unconfigured guidance. | **blocked** VAPID/provider/device setup intentionally absent; enabled/denied/three-device/iOS-installed paths not claimed. |
| ACCT-05 | Landing/Account support link with configured destination and noopener/noreferrer. | **partial** Link rendering/attributes inspected; external support/payment page deliberately not opened. |
| SYS-01 | Desktop top tabs, phone bottom tabs, back links, settings/dialog Cancel/Escape, unknown route → Home; API JSON 404. | **partial** Primary routes walked; exhaustive keyboard/modified-click/assistive-technology matrix is separate. |
| SYS-02 | Fresh B01–B25 day/night native captures; B00 primitive contracts; 320/640/768/1280 library layout, reduced motion. | **partial** No observed body overflow; reduced-motion animations 0. Forced-colors/full device matrix not claimed. |
| SYS-03 | New flat SVG/PNG/manifest artwork, local SW registration, network-failure library → retry. | **partial** No SW data cache. Installed OS/iOS mask rendering and true installed/offline device behavior unverified. |
| SYS-04 | Styled read failure/retry, actual guarded share failure with saved canonical item, and complete photo/share retry recovery. | **partial** Saved form locks fields. Separate browser network faults proved Retry photo → first share kept/second failed → Retry sharing → one ID, two caches and loaded private photo. Quota/429/provider-outage variants remain tests. |
| SYS-05 | Real approved-request deep links and stale/denied reads; durable producer rows inspected. | **partial** Zero delivery attempts/sends; no real email/push delivery, notification-click/device or rescue claim. |
| SYS-06 | Item/profile replacement/removal/deletion leave durable exact/prefix cleanup intents. | **partial** Actual cleanup rows inspected; local producer-only run intentionally did not execute Cron/Queue recovery. |

### Redesign interpretation and remaining boundaries

- B00–B25 use Caprasimo/Figtree, flat boxes and ID-derived cats, packing slips,
  top/bottom tabs and native controls; the historical pixel scenery, account-menu
  primary navigation, walker and 400ms opening delay below are **not current UI**.
- Exact pending badges use D1 aggregates. Cache ASKS means incoming asks needing
  the caller's answer there; rooftop previews include the caller; phone + keeps
  create/join reachable through a menu. Reusable approval starts ON with empty
  message/note; `/requests/:id` is the focused party-only page. These are the
  stack's pending-owner-confirmation defaults, not newly approved product rules.
- The approved authenticated current-invite exception now reveals only cache
  name, active count and derived cat tuples, as described above; it does not
  reveal an inviter, member names or things. Neutral loading/denial remains when
  the preview is unvalidated/unavailable. New-cache color is representative until
  the server returns its UUID. Real data/kinds, honest loading/empty/error states,
  private images and current bot/push setup override illustrative samples. No fake
  OS clock/battery is shipped.
- Support lives only in Account and the public landing footer, never a generic
  in-app footer. The final lead review requested removal of the inherited global
  footer; native Home/cache/library/Requests frames were corrected accordingly.
- Accessibility ink exceptions retain readable contrast on accent buttons;
  landing avoids the export's low-contrast hover cascade. Its night version is a
  token adaptation, not a separate authored board. Footer support target is 44px
  instead of the reference's 42px. Lead visual review approved landing/icons.
- Historical D-01 is fixed before this stack and real attach/detach/delete,
  removal and contact removal now complete. D-02's invite CTA is explicitly
  guidance, not a paste field; paste remains on Home. D-03's Account alignment
  was replaced in Organic 2. Historical failure receipts remain below for audit.
- Final release scope/device/provider proof, independent security review and
  exact revision/environment release approval remain separate gates. No blocked
  external setup was silently bypassed to label a flow green.

## Historical pre-redesign scope and evidence

- Code baseline: `f8bc19090c3006cffb570eeb6197a3af8a3760f2` (`origin/master`).
  Browser walkthrough: 2026-10-16 UTC, desktop Chromium via the installed
  `/opt/homebrew/bin/agent-browser`; no deployment or external setup changes.
- Real app: `npm run dev`, **local** D1/R2/Queue, isolated persistence under
  `/tmp/cc-redesign/d1-state`, `http://localhost:8797` (8787 was occupied).
  Built current web assets once. Three seeded users: Owen (Tools owner), Mia
  (member/requester, initially unnamed), Rae (Garden owner/requester). Seeds use
  `@example.com`, local-only sessions and a local-only auth secret.
- The existing `.dev.vars` was not changed or used by the walkthrough Worker.
  An explicit temporary env-file path suppresses its loading; because the npm
  script disables dotenv loading, CLI `--var` overrides supplied the local URLs,
  dummy Resend key and blank Turnstile/VAPID keys. Real email delivery and live
  push were not exercised. The temporary vars file is removed after the run.
- No dev-mail logger/code bypass exists. `TURNSTILE_SECRET` was absent. The
  existing `npm run ui:fixture` at `http://localhost:4173` supplied **mock APIs,
  mock mail and a labeled mock bot check only** for sign-in/cache-create UI.
  Fixture success is never real-D1/provider evidence.
- Setup SQL supplied two caches, later shared attachments (after UI sharing
  failed), 26 extra library items and 26 decided requests for pagination. A raw
  membership update supplied a removed-member state. These seeds are **not**
  successful create/share/remove/decision flows or cascade proof.
- Screenshots and UX notes stay uncommitted in `/tmp/cc-redesign/`; that directory
  is a local receipt, not a portable artifact store. Receipt numbers below name
  the corresponding `NN-*.png`. Automated test files were inspected, **not run**
  for this docs-only PR; a listed test is coverage, not a new passing receipt.

**Walk key:** **✓** = primary journey completed against the real local app;
**partially** = only stated variants/UI were walked, with remaining proof named;
**blocked** = main completion failed or required unavailable setup. Even ✓ does
not assert every race/error branch was browser-tested. Test shorthand expands to
exact files: `W:name` = `tests/name.test.ts`; `U:name` =
`web/src/lib/name.test.ts`. “Untested” identifies a gap beyond those tests.

### Observed defects, not behavior to preserve

| Defect | Real-browser observation | Consequence / receipt |
| --- | --- | --- |
| D-01: bodyless mutations fail | Attachment PUT and DELETE for attachment, item, member and contact returned **415 `json_required`**. The UI supplies no JSON body/header; the local runtime exposes a body stream and the handler calls `readBody`. | Existing sharing, detach, global item deletion, owner removal and contact removal cannot complete through this browser path. Checkbox or dialog remains with generic failure. Receipts 15, 19–22. Source: `web/src/lib/api.ts`, `src/index.ts`, `src/http.ts`. Existing unit/D1 tests do not prove this browser transport boundary. |
| D-02: misleading invite copy | Landing “I have an invite link” leads to sign-in guidance, not a paste field. A fixture email failure with no invite still says “Your invite is saved”. | Clarify copy without dropping the existing paste/sign-in routes. Receipts 02, 46. |
| D-03: Account rhythm | Wide Profile card starts below the contact card because only Profile has an introductory subtitle; “What neighbors see” and “On this device” repeat nearby copy. | Layout/copy review input, not an authorization bug. Receipts 11, 36–38. |

## Cross-cutting invariants

1. **Identity, CSRF and profile.** Better Auth D1 sessions, no cookie grant cache;
   production host-only HttpOnly/Secure/SameSite=Lax cookies. Exact trusted origin
   and app mutation Origin checks; missing/null/foreign Origin is rejected.
   `/api/auth/*` has an explicit method/path allowlist. `GET /api/me` returns only
   the caller's auth email. App display name is nullable and independent of the
   auth name/email. Profile-required mutations exempt `PATCH /api/me`, auth and
   push, so a new user can finish setup. Auth failure must not masquerade as empty
   data. (`W:auth, worker, magic-links`; `U:foundation, landing`.)
2. **Current D1 permission, no copied grants.** Cache-data statements/batches
   check active caller membership; cache items/photos also require attachment and
   active item owner. Private library checks ownership directly. Cache ownership
   does not grant editing another person's item. Pending/left/removed/non-member
   cache reads get 404; only a current valid invite gets removed-member 403.
   Retained party-only request history grants no cache/item/photo/contact access.
   Names/IDs, never another person's auth email, enrich shared views.
   (`W:d1-caches, d1-items, d1-requests, profile-photos, contacts`.)
3. **Guarded state and effects.** One guarded SQL write or atomic token-witnessed
   batch, not a pre-read grant across an await; zero primary changes means no
   dependent effects. Request/outbox and destructive recipient snapshots commit
   together. R2/Queue/providers happen outside the D1 batch. Request and removal
   races are real-SQL tests, not inferred from browser success.
4. **One item, one stock count.** Attachments do not copy an item. Consumable
   available quantity is stock minus **all-cache pending** reservations, without
   exposing those other queues. Approval deducts once; stock edits cannot go
   below reservations. Reusable quantity is NULL. Type is immutable. Lent out is
   a manual shared flag/note, not a holder, return or loan lifecycle; it blocks
   new asks, not pending decisions. (`W:d1-items, d1-requests, d1-library`.)
5. **Removal scopes.** Leave/removal rejects affected pending requests and
   detaches that member's items only in that cache; library/photos/other caches
   survive. Detach preserves canonical item/stock/photos/other attachments.
   Global deletion erases item and request history across caches, snapshots
   pending recipients first and queues private photo cleanup. Next SQL statement
   sees permission loss; completed approvals/authorized streams are not recalled.
   (`W:d1-removal`; D-01 prevents several browser completions today.)
6. **Private photos and contacts.** Photos stream same-origin, private/no-store,
   with D1 authorization before R2. Item keys are `ownerId/itemId/uploadUUID`;
   profile keys `users/userId/uploadUUID`. Profile metadata/reads require self or
   a shared cache with both active; mutations are self-only. Current pointers
   survive cleanup races. Contact reveal requires approved request, caller party
   and both parties active in **that request's cache**, in one SQL statement.
   No auth-email inference, public contact directory, outbox contact or message
   relay. Approval message is party-only, not notification payload.
7. **Durable notifications and cleanup.** Outbox kinds: `join_requested`,
   `join_approved`, `join_rejected`, `request_created`, `request_approved`,
   `request_rejected`, `member_removed`, `item_deleted`. Queue hints are
   post-commit; Cron rescues missing/expired claims. `failed_at`, not attempts,
   bounds eligibility; only observed failure may terminally fail a row. Delivery
   is at-least-once. R2 cleanup intents persist until idempotent completion;
   unknown put-before-finalization orphans remain a documented gap. No DO alarms,
   copied discovery, notification inbox or browser service-worker API cache.
8. **Limits are policy, not UI entitlement.** One `plan_limits` table, free by
   default, checked in the same write/finalization. Free: 1 owned cache, 2 new
   caches/rolling 24h, 20 active cache memberships, 30 active members/cache,
   100 library items, 20 pending outgoing asks, 1 current item photo and 1 profile
   photo (5 MB cap). Owners count. Pending joins reserve no seat; approval/rejoin
   rechecks. Replays/rejection/removal remain possible at cap; replacement keeps
   one current pointer. Plus currently changes only owned caches to 3 and cache
   members to 100. No plan UI/billing. Missing policy fails closed.
9. **Accessible, responsive recovery.** One accessible list/control remains when
   decorative pixel art is off; Home mark is named “Home”. Named native dialogs,
   labeled inputs, alert/status text, safe initial focus and keyboard/escape
   behavior must survive. No automatic mutation retry. Read retries distinguish
   loading, empty, stale/error and paginated/incomplete results. Home boxes/cache
   houses are decorative; system sunny/evening palettes only. Reduced motion
   skips walkers, sheet/route animation and cache-opening delay; hidden tabs
   suspend motion. Below 640px retains phone geometry (449–639px extends only
   backgrounds); larger layouts use fluid gutters/1920px cap and 72ch prose,
   intrinsic grids, 1024px wide item/request/Account layouts and a room-aware
   cache sidebar at 68rem container width. Walked 390, 640 and 1440px plus native
   light/dark/reduced-motion Account; exhaustive widths/keyboard/device proof is
   still separate. (`U:cozyTheme, motion, wide, polish, accountMenu`.)

## AUTH — Entry, identity and sign-in

Source: `web/src/App.tsx`, `web/src/auth/AuthProvider.tsx`,
`web/src/pages/{LandingPage,LoginPage,MagicLinkPage,OnboardingPage}.tsx`,
`web/src/lib/{magicLinks,pendingJoin,api}.ts`, `src/{auth,index,magic-links}.ts`.

| ID / actor / entry | Journey and screen states | API, data effects and edges | Coverage / walk |
| --- | --- | --- | --- |
| **AUTH-01** Visitor, `/` | Session resolution → public landing: Sign in, Get started, “I have an invite link”, how-it-works/promises/support. Invite CTA → `/login?invite=1` guidance; it does not open paste. | `GET /api/me`: 401 becomes signed-out. No public cache/items, no writes. Unknown web routes redirect `/`, not a 404 screen. | `U:landing, signin, support`; **✓** landing/guidance/malformed web route (01–02). |
| **AUTH-02** Any visitor, app/deep link | `Starting…` while identity resolves; startup error + Try again reload. Signed-out protected pages → `/login`; unnamed user → name setup; complete user → requested page (Home/login may resume saved invite). | `GET /api/me` → D1 `session`/`user`/own `user_photos`. Expiry/revocation checks D1. Non-401 startup failures stay errors; later 401 uses session-expired copy, not a permission grant. | `W:worker, auth`; `U:foundation, landing, polish`; **partially** signed-out/unnamed/deep links walked; forced startup error and real session expiry not walked. |
| **AUTH-03** Signed-out, `/login` or `/join/:token` | Enter email → complete bot check → Email me a sign-in link → Check your email; Please wait…, Resend link, Wrong email? Change it, code fallback. Protected attempts reset bot token; retry/recomplete on failure. | `POST /api/auth/sign-in/magic-link`, `X-Turnstile-Token`; D1 `verification` hashed 300s links + `rateLimit`; awaited bounded Resend, not outbox. Strict callbacks; email/Turnstile/rate errors in appendix. Resends create independently valid links, **not latest-link-only revocation** despite newest-link guidance. | `W:magic-links, turnstile, auth`; `U:magicLinks, signin, turnstile`; **partially** real unavailable-bot state; fixture send/resend/wrong-email/delivery-error (26, 46). Real mail/bot success **blocked**. |
| **AUTH-04** Link holder, `/auth/link#…` | Opening captures/removes fragment, shows Almost there without verification. Explicit Continue → Signing in… → Home/invite/name setup; missing/invalid/expired/used link offers new link/code recovery. Continue stays disabled after an attempted verification, including failure. | `POST /api/auth/magic-link/verify`; no public verification GET. Atomic first-use challenge → verified user/session/account as needed; same-origin callback. No token in rendered markup/referrer/history; landing no-store. | `W:magic-links`; `U:magicLinks, signin`; **partially** real missing/nonexistent link (49), fixture fresh-tab Continue/name (27); real mail/replay/expiry/account switch not walked. |
| **AUTH-05** Signed-out email holder, login fallback | Use a 6-digit code instead → Enter your code; one native six-digit numeric/paste/autofill field. Sign in, Resend code, Email a link instead, Wrong email. Invalid code is inline; retries require newest code. | `POST /api/auth/email-otp/send-verification-otp` `{email,type:'sign-in'}`; `POST /api/auth/sign-in/email-otp` `{email,otp}`. D1 hashed OTP, 300s, three attempts, rotate on resend; verified user/session/account on redemption. Bot guards sends/resends, not redemption. | `W:auth, otp-races, turnstile`; `U:signin, magicLinks`; **partially** fixture invalid then `123456` → onboarding (28–29). Real OTP send/expiry/rotation **blocked** by setup. |
| **AUTH-06** Authenticated unnamed user, preserved route | “What should neighbors call you?” with initials/name preview → enter nonblank name → Continue/Saving… → Home or saved invite. Input/error allows retry; never derive name from email. | `PATCH /api/me` `{display_name}` → caller's `user.display_name`; 1–60 trimmed UTF-16 units server-side. Profile gate exempts this write. Invite still needs explicit Join. | `W:worker`; `U:signin, joining, landing`; **✓** Mia local onboarding (03); fixture link/code onboarding also observed. |
| **AUTH-07** Signed-in user, Account or account menu | Sign out → Signing out… → signed-out page; error remains visible if cleanup/logout fails. Next account must not see previous private queries/invite/push state. | Disable caller push first, `POST /api/auth/sign-out` `{}` → session revocation; clear invite stores and all non-identity queries. Push failure prevents auth sign-out, while local unsubscribe/notification cleanup still runs. Magic-link account switch also clears old queries. | `W:auth, worker, push`; `U:push, pendingJoin, accountMenu`; **partially** real Rae Account sign-out (47); live subscription/account-switch variants unwalked. |

## JOIN — Invites and membership admission

Source: `web/src/pages/{JoinPage,JoinInviteSheet,JoinRequests}.tsx`,
`web/src/lib/{joining,pendingJoin}.ts`, `shared/invites.ts`, `src/db.ts`.

| ID / actor / entry | Journey and screen states | API, data effects and edges | Coverage / walk |
| --- | --- | --- | --- |
| **JOIN-01** Invite holder, `/join/:token` | Validate token → save intent → login/name if needed → Join this cache. Invalid invite → Go home. If both stores fail: “Could not save this invite. Enable storage for this site and try again.” Cancel invite clears intent. | Intent in session/localStorage, one-hour TTL, not authorization. Strict relative invite callback survives link/new tab; explicit callback wins. Join/cancel/sign-out/expiry clears intent without erasing a newer token from another tab. No pre-join cache-name lookup. | `W:magic-links`; `U:joining, pendingJoin`; **partially** real valid/malformed invite and onboarding; fixture fresh-tab auth; both-store denial/TTL/cross-browser invite handoff unwalked. |
| **JOIN-02** Signed-in user, Home → Join with an invite | Paste full HTTP(S) invite, local path or bare code → Open invite → local Join screen → Join or Cancel. Junk shows exact paste error; Close resets sheet. | No write until explicit Join. Parser discards supplied origin, rejects credentials/query/hash, controls/backslashes and malformed/encoded token; max 2048 input. | `U:pendingJoin, joining`; **✓** invalid paste then foreign-origin sample navigated locally and active replay joined (31). Cancel/storage variants partial. |
| **JOIN-03** Profile-complete invite holder, open cache | Join cache → Joining… → Welcome to NAME → Open cache. Repeated active join is idempotent, even at cap. Missing/wrong/rotated secret is generic 404, no cache details. | `POST /api/caches/C/join` `{secret}` → guarded `memberships` active member. Current exact secret/version/config in write; open join checks both active-member caps. No open-join outbox row. | `W:d1-caches, plan-limits`; `U:joining`; **✓** Mia/Rae admission + Mia replay; stale secret walked (25). Races/caps test-only. |
| **JOIN-04** Profile-complete applicant, approval-required invite | Explicit Join → Waiting for owner approval; “Your request to join NAME is saved…” → Go home. Pending has no cache access; replay does not duplicate request/notification. | Same join endpoint → pending `memberships` + `join_requested` outbox to owner in one batch. No active seat reserved; later approval rechecks limits. | `W:d1-caches, plan-limits`; `U:joining`; **✓** Owen/Mia pending (04); pending replay/privacy edge coverage in tests, not all browser-walked. |
| **JOIN-05** Cache owner, cache banner → settings | Review → Join requests loading/empty/error+retry; Approve NAME → Saving join decision… → Join request decided; member list refreshes. No admin/member decision controls. | `GET /api/caches/C/join-requests`; `POST …/join-requests/U/approve` `{}` → pending-only token batch activates membership + `join_approved` outbox. Lost decision 409; cap failure leaves pending. | `W:d1-caches, plan-limits`; `U:caches, joining`; **✓** Rae approved Owen; list became active. Cap/race variants test-only. |
| **JOIN-06** Cache owner/applicant, same settings/invite | Reject NAME → decision status and applicant leaves pending list. Applicant may submit current invite again; there is no requester cancel/rejection-history screen. | `POST …/join-requests/U/reject` `{}` snapshots `join_rejected`, then deletes pending membership atomically. Reject works at cap; stale decision 409. | `W:d1-caches, plan-limits`; `U:caches, joining`; **✓** reject Mia then explicit retry became pending again. |
| **JOIN-07** Left or removed member, current invite | Left → normal open/gated admission, no automatic old item re-sharing. Removed → “You were removed…”; stale/invalid secret remains 404 instead. | Same guarded join; `left` may transition active/pending, `removed` cannot. Existing approved history does not restore access/contact. | `W:d1-removal, d1-caches, contacts`; `U:joining`; **partially** real leave/open rejoin; seeded removed → cache 404/current-invite 403/history-without-contact (41–44). UI removal cascade blocked by D-01. |

## CACHE — Home, settings and departures

Source: `web/src/pages/{HomePage,CachePage,CacheSettingsPage}.tsx`,
`web/src/lib/{caches,invites}.ts`, `src/{index,db}.ts`.

| ID / actor / entry | Journey and screen states | API, data effects and edges | Coverage / walk |
| --- | --- | --- | --- |
| **CACHE-01** Complete member, `/` | Your caches grid/list + decorative box shortcuts → cache. Loading caches…, empty create/join CTAs, retry alert (“Previously loaded caches may be out of date”). Home also previews three own items. | `GET /api/caches` joins active `memberships`/usable `caches`; no discovery copy. Saved invite redirects before normal Home. | `W:d1-caches, d1-library`; `U:caches, landing, library, motion`; **✓** empty/nonempty Home and cache entry (03); failure/animation variants partial. |
| **CACHE-02** Complete user, Home → New cache sheet | Name (1–60 code points), optional Approve new members switch, bot check → Create cache/Creating… → cache immediately. Cancel/Escape before save; validation/provider/limit errors keep sheet. | `POST /api/caches` `{name,requires_approval}`, bot token → atomic `caches` + active owner `memberships`; policy guard counts owner/membership/rolling day. No creation notification. | `W:d1-caches, plan-limits, turnstile`; `U:caches, limits, turnstile`; **partially** fixture create completed (30); real completion **blocked** by absent Turnstile secret. Seeded caches are not creation proof. |
| **CACHE-03** Active member, `/caches/C` | Loading cache… → name/member count/houses, shared item list, Invite, settings; wide members sidebar, phone members in settings. Empty items invite first add; cache/item/join-queue errors have distinct recovery. Invite uses share API or copy, settings provides selectable fallback. | `GET /api/caches/C`, `GET …/items`; owner-only `GET …/join-requests`. Active members see current invite and active names/avatars, not emails/pending applicants. Share/copy writes no D1. | `W:d1-caches, d1-items`; `U:caches, items, wide`; **partially** real owner/member/empty/nonempty/error views; settings Copy succeeded. Native share/cancel/fallback not all walked. |
| **CACHE-04** Active owner, `/caches/C/settings` | Edit cache name → Save settings/Saving… or Cancel; Approve new members switch saves immediately → Settings saved. Members see members/invite/Leave, no owner controls. Settings load/error+retry. | `PATCH /api/caches/C` `{name}` or `{requires_approval}` → guarded `caches`; no outbox. Current config governs later join; toggling does not bulk-approve pending applicants. | `W:d1-caches`; `U:caches, wide`; **partially** real rename and owner/member control split; switch mutation/cancel/name-boundary variants unwalked. |
| **CACHE-05** Member copies / owner resets, settings | Copy → Invite copied or selectable-link fallback. Reset link → warning existing members keep access → Confirm reset/Resetting… → “Invite rotated. The old link no longer works.” Cancel is safe initial focus. | `POST /api/caches/C/invite/rotate` `{}` changes `caches.join_secret`; membership unchanged, no outbox. Wrong owner 404; racing join cannot use previously compared secret. | `W:d1-caches`; `U:caches, wide`; **✓** copy, reset confirmation/success and old-link rejection (24–25); failure/cancel/race test-only. |
| **CACHE-06** Owner, settings → Remove NAME | Confirmation lists immediate access loss, pending rejection and library/photo preservation → Confirm removal/Removing… → member disappears/focus returns to heading; errors remain in dialog. Owner cannot remove self. | `DELETE /api/caches/C/members/U`: intended atomic `memberships` removed + affected `requests` rejected (`left the cache`) + `member_removed` outbox snapshots + delete this member's `item_caches` in C. No R2 deletion. | `W:d1-removal`; `U:caches, wide`; **blocked** D-01: confirm returned 415, no removal (22). Seeded removed state tests denial only, not cascade. |
| **CACHE-07** Non-owner active member, settings → Leave | Confirmation → Confirm leave/Leaving… → Home without cache. Rejoin allowed with current invite; approval applies, old attachments not restored. Owner has no Leave control; API returns owner prohibition. | `POST /api/caches/C/leave` `{}` runs same atomic cascade as removal, but status `left`; library/photos/other caches survive. | `W:d1-removal`; `U:caches`; **partially** Mia leave/open rejoin completed (23); affected-pending/item cascade and gated left-rejoin not browser-walked. |

## ITEM — Private library and cache sharing

Source: `web/src/pages/{LibraryPage,ItemPages,ItemForm,AddItemSheet,ShownIn}.tsx`,
`web/src/lib/items.ts`, `src/{items,index,db}.ts`.
Private base **L** = `/api/me/items`; cache base **I** = `/api/caches/C/items`.

| ID / actor / entry | Journey and screen states | API, data effects and edges | Coverage / walk |
| --- | --- | --- | --- |
| **ITEM-01** Item owner, Home preview → `/items` | Cards show title/type, sharing names, Lent out, pending-ask count; preview max three → See all. Loading your items…, no items + New item, stale/error+retry; Load more items (25/page). | `GET L[?after=cursor]` → owner-only `items`, active attachments/cache names and all-cache pending summary; no membership prerequisite. Invalid cursor is an error, not a restarted page. | `W:d1-library`; `U:library`; **✓** empty, preview, full library, seeded second page and aborted-read retry (03, 39, 44–45). |
| **ITEM-02** Complete user, `/items/new` | Optional photo, Name, Lend it (default) / Give some away, consumable stock, optional description → Create item/Saving… → own detail; Cancel returns library. Unshared item remains private. | `POST L` creates caller-owned `items` only, no attachment/outbox. Title 1–120, description ≤2000 code points; consumable integer 0–9999, reusable NULL. Owned-item quota includes unshared items. Photo is separate (PHOTO-01). | `W:d1-items, d1-library, plan-limits`; `U:items, library`; **✓** reusable private drill creation (05); private consumable/optional-photo error variants partial. |
| **ITEM-03** Active member, cache Add item → New item; also `/caches/C/items/new` | Native add sheet Your items/New item; New creates in library and shares here in one step. Create and add here → sheet closes/list refreshes, or direct route → detail. Busy sheet cannot dismiss. | `POST I` atomically inserts canonical `items` + first `item_caches`; ownership from caller, membership/quota guarded. No create-then-attach orphan. | `W:d1-items, d1-library, plan-limits`; `U:library, items`; **✓** direct consumable Seed packets and phone sheet reusable watering can (06, 32). |
| **ITEM-04** Item owner/active member, cache Add item → Your items | Own paginated library, sharing hints, checked/disabled Already here; select several → Add N/Adding…. Successful attachments stay if a later one fails; retry only remaining selection; Close resets selection. Empty library directs New item. | `GET L`, sequential idempotent `PUT L/ID/attachments/C`, no item creation/copy. Separate per-item writes, not an all-selection transaction. | `W:d1-library, d1-items`; `U:library`; **partially** sheet empty/new branch walked; attachment transport **blocked** by D-01 (same endpoint as ITEM-08). Multi-selection partial-success browser proof untested. |
| **ITEM-05** Owner/member, `/items/ID` or `/caches/C/items/ID` | Loading item…, error+retry → title/owner/photo/type/stock/description. Owner gets edit/delete/availability/sharing/photo controls; other members get asks. Own-library detail links to Requests, not a cache queue. | `GET L/ID` owner-only; `GET I/ID` active caller+owner+attachment. Library survives losing cache. Member edit route redirects to cache; API writes still require item owner. | `W:d1-items, d1-library`; `U:items, wide`; **✓** own/member, library/cache and removed cache denial views; forged-path variants test-only. |
| **ITEM-06** Item owner, corresponding `/edit` | Existing values; immutable type label; edit title/description/stock → Save item/Saving… → detail or Cancel. Validation errors retain form. Stock below pending reservation floor fails without losing item. | `PATCH L/ID` or `PATCH I/ID`; guarded canonical `items`, no outbox. Cache alias additionally requires active membership/attachment. Invalid type/quantity/reserved-stock messages below. | `W:d1-items, d1-requests`; `U:items`; **partially** real reserved-stock edit failed correctly (09); successful text/stock save and cancel not browser-walked. |
| **ITEM-07** Item owner, detail → Item availability | Lent out switch + optional note → Save availability/Saving…; note ≤200 code points; Availability saved or inline error. Shared flag/note affects all caches; existing pending asks remain decidable. | `PATCH L/ID` `{available,unavailable_note}` → canonical `items`. No borrower/return record or availability notification. Blank/null clears note; false checkbox is available. | `W:d1-items, d1-requests`; `U:requests, items`; **partially** real manual flag saved and reusable approval flag seen in other cache (17); note clearing/200-code-point error unwalked. |
| **ITEM-08** Item owner, detail → Shown in checked on | Loading sharing…, error + Try sharing again, no-cache guidance; check active cache → Updating sharing… → Sharing saved. Failure keeps last confirmed state and offers refresh/retry. | `GET L/ID`, `GET /api/caches`, `PUT L/ID/attachments/C`; guarded ownership+active membership, idempotent attachment. Stock/photo shared, never copied. | `W:d1-items, d1-library`; `U:library`; **blocked** real PUT returned 415 and stayed unchecked (15). SQL-seeded two-cache attachment is setup only. |
| **ITEM-09** Item owner, Shown in checked off | Stop sharing in NAME? explicitly preserves library/photos/stock/other caches and declines this cache's pending asks → Confirm stop sharing; Cancel keeps checked. From detached cache detail, success returns own-library detail. | `DELETE L/ID/attachments/C` → atomic affected `requests` rejection (`item no longer shared in this cache`) + `request_rejected` outbox (`item_detached:true`) + delete attachment. History remains. | `W:d1-removal`; `U:library, items, wide`; **blocked** real confirmation/415 error walked (20), no detach. |
| **ITEM-10** Item owner, either detail → Delete item | Delete TITLE everywhere? explains library/all caches/history removal and queued photos → Confirm deletion/Deleting… → `/items`; Cancel safe initial focus. Not cache-local delete. | `DELETE L/ID` (UI); `DELETE I/ID` API alias is also global. Guarded batch snapshots `item_deleted` for pending requesters, rejects pending, records exact/prefix `r2_cleanup`, deletes item/attachments/history by FK. | `W:d1-removal`; `U:items, wide`; **blocked** real dialog/415 (21); no deletion/cleanup from that attempt. |

## PHOTO — Item and profile media

Source: `web/src/pages/{ItemPhoto,ProfilePhotoControls}.tsx`,
`web/src/components/Avatar.tsx`, `web/src/lib/photos.ts`,
`src/{photos,cleanup,db}.ts`.

| ID / actor / entry | Journey and screen states | API, data effects and edges | Coverage / walk |
| --- | --- | --- | --- |
| **PHOTO-01** Item owner, new-item form or detail uploader | Choose JPEG/PNG/WebP → decode/resize longest side ≤1600, white backing, JPEG → Upload photo/Saving photo… → Photo saved. Optional-create photo failure after item save locks fields and offers Retry photo / Continue without photo; never create item twice. Decode failure before save creates nothing. | `POST L/ID/photo` or `POST I/ID/photo`, raw image; 5 MB streamed cap/type sniff, no SVG. Immutable R2 put then guarded `items.photo_path` finalization; old/rejected key cleanup durable. Post-I/O ownership/membership/plan recheck. | `W:photos, d1-photos, plan-limits`; `U:photos, items`; **partially** real detail upload succeeded (14). Optional-form saved-item retry, oversize/decoder/uncertain-finalization not browser-walked. |
| **PHOTO-02** Authorized reader / owner replacing item photo, detail/cards | Same private image via library/authorized caches; owner Replace photo uses same uploader. Missing image has placeholder/Photo unavailable + Try photo again (detail); thumbnails fall back. No individual remove-photo control. | `GET L/ID/photo` owner or `GET I/ID/photo` guarded cache read before R2; private/no-store/nosniff. Replacement changes version pointer + old-key cleanup atomically; detach/removal does not delete shared image. | `W:d1-photos, photos`; `U:photos, items`; **partially** real private upload/read/replacement and cross-cache display (14, 17, 48); failed-image retry/nonmember stream matrix test-only. |
| **PHOTO-03** Signed-in user, `/account` → Change photo | Native sheet shows avatar/initials, privacy/cap guidance; Choose a photo → Save photo/Saving… → closes and refreshes avatars. Replace keeps one current photo. Read-image/limit/permission failures stay in sheet; Close/Escape before mutation. | `POST /api/me/photo` raw image → private `users/U/UUID` R2, `user_photos` pointer + `r2_cleanup(scope='profile',item_id=NULL,kind='exact')`. Current plan checked after R2. No other-user mutation route. | `W:profile-photos`; `U:profilePhotos, photos`; **partially** real PNG decoded/uploaded and avatar read 200 (13), unlike historical transport blockage; replacement/error/race variants unwalked. |
| **PHOTO-04** User removing own photo / eligible avatar viewer | Remove photo (disabled if absent) → sheet closes/initials restore; no confirmation. Header/cache/member/item/request avatars use initials on absent/failed images. Shared-cache metadata permission cannot come from history alone. | `DELETE /api/me/photo` → remove pointer + exact profile cleanup; works at quota zero. `GET /api/me/photo`, `GET /api/users/U/photo` self/shared-active gate. Next read denied after last shared cache loss; another active shared cache still permits. | `W:profile-photos`; `U:profilePhotos`; **partially** real remove 204/initials (33); other-user photo membership matrix and failed-image fallback test-only. |

## REQ — Asks, decisions and arranging a handoff

Source: `web/src/pages/RequestsPage.tsx`, `web/src/lib/requests.ts`,
`web/src/components/{RequestStatus,ContactLink}.tsx`,
`src/{requests,contacts,index,db}.ts`.

| ID / actor / entry | Journey and screen states | API, data effects and edges | Coverage / walk |
| --- | --- | --- | --- |
| **REQ-01** Active cache member, cache item Requests | Loading requests…, error + Try requests again, visible list or No visible requests. Pending visible to members in this cache; answered cards only to parties. Consumable Available now uses server aggregate, not visible queue. | `GET I/ID/requests` checks current attachment/caller/owner, limits rows to C; decided rows require owner/requester. Other-cache queue identities and private approval message are not revealed. | `W:d1-requests, contacts`; `U:requests`; **✓** pending, empty other-cache queue and answered party views; exhaustive three-party privacy assertions test-only. |
| **REQ-02** Non-owner active member, reusable cache item | Ask to use (no quantity) → Sending request… → “Request sent. Arrange the handoff in person if approved.” Pending card appears. Lent out disables Ask but existing requests still decidable. Owner sees no self-ask form. | `POST I/ID/requests` `{quantity:null}` → guarded pending `requests` + `request_created` outbox to item owner. Verified email/write budget/profile/current membership/availability/quota guards. Repeat ask is not a cancel or deduplicated reservation. | `W:d1-requests, polish, plan-limits`; `U:requests`; **✓** Mia reusable ask and shared Lent out disable (16–17). |
| **REQ-03** Non-owner active member, consumable cache item | Quantity 1–9999 integer → Ask; Available now falls immediately by reservation. Zero/unknown stock disables ask with no-stock/refresh guidance. Too-large/racing request returns insufficient-stock alert and refreshes views. | Same POST with numeric quantity → all-cache guarded stock reservation, no deduction until approval. Quantity type/range, self/attachment/membership/manual flag and outgoing cap checked in write. | `W:d1-requests, plan-limits`; `U:requests`; **✓** Mia asked 2 of 6; Rae's 5 failed when 4 available, then 1 succeeded (07–08). Multi-cache concurrent overbooking remains SQL proof. |
| **REQ-04** Signed-in party, `/requests` / account menu | Needs your answer, Answered for your things, Your requests; loading/error+retry, honest loaded-results empty copy; Load more requests (25/page). Missing-own-contact nudge → Account. Badge counts pending incoming on **first page**, not an authoritative total. | `GET /api/requests[?after=…]` directly reads owner/requester `requests`/`items`/`caches`; history survives departure, not item deletion. `unavailable_cache_ids` currently always empty; UI retains incomplete-list warning for compatibility. | `W:d1-requests, d1-library`; `U:requests, accountMenu, polish`; **✓** real incoming/outgoing/answered/empty groups, seeded pagination (10, 18, 40, 43); compatibility unavailable-list branch unwalked. |
| **REQ-05** Item owner with pending consumable ask, card → Approve | Opens confirmation with **empty** optional Message; ≤500 code points; Approve/Cancel → Saving decision… → Approved. Stock deducted once; optional message visible only to two parties. Not an automatic handoff/contact send. | `POST /api/me/requests/R/approve` `{approval_message,mark_lent_out:false}`. Cache alias `POST /api/caches/C/requests/R/approve` also guarded. Pending-only decision token + stock + `request_approved` outbox atomic; stale decision 409, lost membership 404. | `W:d1-requests, contacts`; `U:requests, contacts`; **✓** approve Mia's 2, private message shown; D1 stock 6→4 (10, 18). Double-decision/rollback proof test-only. |
| **REQ-06** Item owner with pending reusable ask, Approve | Same confirmation plus unchecked Mark as lent out and optional ≤200-code-point note when checked. Checked approval atomically marks shared unavailable; unchecked preserves previous flag/note. Existing Lent out does not block a pending decision. | Same approve endpoint; no stock quantity. Message, decision, optional flag/note and outbox commit together. API can omit note to preserve, blank/null clears; consumables reject mark_lent_out. | `W:d1-requests, contacts`; `U:requests`; **✓** real checked approval/note and disabled ask in another cache (16–17). Unchecked/omitted-note/race variants test-only. |
| **REQ-07** Item owner with pending ask, inline rejection form | Enter required Reason for rejection (1–500 code points) → Reject request from NAME → Saving decision… → Rejected + reason. No separate reject confirmation. Already-decided/error retains useful message and refreshes. | `POST /api/me/requests/R/reject` `{reason}`; guarded cache alias also exists. Pending-only token batch + `request_rejected`; reservation released, no stock deduction; no approval message. | `W:d1-requests`; `U:requests`; **✓** real Rae rejection/reason appeared (10). Required/length/race errors test-only. |
| **REQ-08** Approved request party, answered card | Loading contact… → Message NAME on platform, or NAME hasn't added a way to reach them yet. Denied/error: “Contact is unavailable. Both people must still be active in this request's cache.” + Try contact again. Message button opens server-built destination; app sends nothing. | `GET /api/me/requests/R/contact`; approved+party+both-active-in-R.cache D1 guard returns other party's chosen `user_contacts` or `{contact:null}`. Approval message stays party-history-visible after departure; contact/avatars do not gain permission from history. | `W:contacts, profile-photos`; `U:contacts`; **✓** missing contact, chosen email button (not auth email), then seeded removal hides contact while history remains (18, 43). Native messaging app launch not attempted. |

## ACCT — Profile, contact, notifications and support

Source: `web/src/pages/{AccountPage,ContactControls,PushControls}.tsx`,
`web/src/components/Support.tsx`, `web/src/lib/{contacts,push,support}.ts`.

| ID / actor / entry | Journey and screen states | API, data effects and edges | Coverage / walk |
| --- | --- | --- | --- |
| **ACCT-01** Complete signed-in user, `/account` | Profile photo/initials, display name, own Email · private; Edit name → Save name/Saving… or Cancel → Profile saved. Notifications/session/contact/support panels below/beside profile. No email-change/theme selector. | `GET/PATCH /api/me`; edit only caller's `user.display_name`, refresh identity. Auth email read-only and private. Name 1–60 trimmed units; profile gate still applies if missing. | `W:worker`; `U:signin, wide`; **✓** real name edit Owen→Owen Owner and phone/tablet/wide layouts (11, 36–38); validation/cancel partial. |
| **ACCT-02** User, How to reach me → Add/Edit contact | Loading/failed own contact → retry; sheet starts empty/no auth-email prefill. Pick Text/WhatsApp/Signal/Messenger/Instagram/Email; edit value → Checking preview… → exact Message button → Save contact/Saving… closes. Invalid preview disables save. Close discards edits. One optional contact, replacement overwrites it. | `GET/PUT /api/me/contact`; debounced `POST /api/me/contact/preview` validates/builds without storing. `user_contacts` self-only; API builds links, never trusts URL. Phone 7–15 ASCII digits optional +, usernames bounded, chosen email simple ASCII (≤254), no control/header/URI injection. | `W:contacts`; `U:contacts`; **partially** real all-six previews, invalid Instagram URL, chosen-email save/reopen/reveal (12, 34–35). Replacement persistence/native app launches unwalked. |
| **ACCT-03** User with stored contact, contact sheet | Remove contact immediately (no extra confirmation) → intended close + missing-contact nudge; errors remain in sheet. Disabled when absent; removal does not alter sign-in email. | `DELETE /api/me/contact` deletes own `user_contacts`; invalidate own/request-contact queries; old approved contacts must not persist after denied refetch. | `W:contacts`; `U:contacts`; **blocked** real 415/generic error, contact remains (19, D-01). |
| **ACCT-04** User, Notifications on this device | Register SW/config; unconfigured/unsupported guidance or iOS Add to Home Screen guidance. User toggle requests permission → Updating… → enabled status; denied/error shows recovery. Disable unsubscribes/closes visible notifications. At most three browsers/account. | `GET /api/config`; `POST/DELETE /api/push/subscribe` → caller `push_subscriptions`. Strict HTTPS/provider origins/keys, no userinfo/nonstandard ports; endpoint account reassignment rotates ID, stale 410 cannot delete replacement. Local owner hint is not auth. | `W:push, push-crypto`; `U:push, pwa`; **partially** real unconfigured disabled switch (11, 33, 36–38); enable/disable/provider/device proof **blocked** by no VAPID setup; no live push sent. |
| **ACCT-05** Visitor/member, footer or Account support card | Support Communal Cache / Buy me a coffee → configured hosted page in new tab. Hidden if URL unconfigured. No in-app checkout, donor state, entitlement/unlock or payment result screen. | Plain approved HTTPS anchor, noopener/noreferrer, no app identity/tracking parameters, provider widget/script or D1 effect. | `U:support`; **partially** real landing/Account/footer rendering inspected; external destination/payment not opened or performed (01, 11, 36). |

Contact destination variants (ACCT-02 / REQ-08); previewing does not send a message:

| Kind | Valid value → server-built destination |
| --- | --- |
| Text (`sms`) | 7–15 digits, optional + → `sms:+digits` |
| WhatsApp | Same phone validation → `https://wa.me/digits` |
| Signal | Same phone validation → `https://signal.me/#p/+digits` |
| Messenger | 5–50 ASCII letters/digits/dots, no leading/trailing/consecutive dots → `https://m.me/username` |
| Instagram | 1–30 ASCII letters/digits/dots/underscores, same dot rules → `https://instagram.com/username` |
| Chosen email | ASCII local part ≤64, whole input ≤254, validated dotted domain → `mailto:encoded-local@domain` (local + becomes `%2B`) |

## SYS — Shared navigation, failure modes and durable follow-through

| ID / actor / entry | Journey and screen states | API, data effects and edges | Coverage / walk |
| --- | --- | --- | --- |
| **SYS-01** Signed-in user, header/Home/breadcrumbs | Account menu exposes Requests, Your items, Account settings, Sign out and first-page incoming badge. Arrow/Escape/outside/route-change focus rules; desktop breadcrumbs and phone back links. Home list/horizon cache navigation shares a 400ms opening delay; reduced motion/hidden tabs skip it; modified click stays native. | Navigation/read queries only; no permission from link visibility. Unknown web path → `/`; unknown API → JSON 404, wrong method 405. Source `App.tsx`, `AccountMenu.tsx`, `CacheLink.tsx`. | `W:worker, domain-api`; `U:accountMenu, motion, wide`; **partially** real menu/Escape/routes/back links/unknown web path walked (47); full keyboard/modified-click/focus matrix test-only. |
| **SYS-02** Any user, every screen | System sunny/evening, responsive phone→wide layout, reduced-motion/static decoration; no theme preference UI. Decorative cat/boxes/houses cannot replace labeled content. Content/form/read-error layouts remain usable without animation. | CSS/media queries + `PixelArt`, `RouteMotion`; no D1 preference or per-plan theme. Preserve widths/semantics described above. | `U:cozyTheme, motion, wide, redesign`; **partially** native Account 390/640/1440, light/dark/reduced-motion (36–38); other flows seen phone or wide, not full cross-product/a11y audit. |
| **SYS-03** User installing/opening PWA or going offline | Manifest/launcher Home; browser-native installation (no custom install prompt), iOS installed-app push instructions. Offline is a network failure, **not offline library/cache access**; reload/retry needs network. | `manifest.webmanifest`, icons, `/sw.js`: install/activate + push/notificationclick, **no fetch handler/cache**. Click validates same-origin relative path and focuses exact target window or opens it. | `U:pwa, cozyTheme`; **partially** real SW registration/unconfigured app inspected; installed OS/iOS/offline/push-click paths **blocked/unwalked** on this desktop-only provider-disabled run. |
| **SYS-04** User hitting quota/rate/provider/network errors | Accessible inline error, bounded retry guidance, no upgrade/billing upsell or silent success. Reads offer Try again; mutations require explicit retry. Busy controls prevent duplicate submits where implemented; no automatic mutation retry. | 409 `limit_reached` + stable `limit`; policy unavailable 503. D1 fixed-minute write budgets: join 10, join-decision 30, ask 20, decision 60/user; auth D1 limit 100/60s, magic 5/60s, OTP send 3/60s, OTP redemption 10/60s. Auth and app limiters are separate. | `W:plan-limits, polish, auth, turnstile`; `U:limits, polish`; **partially** real stock/permission/transport and forced library network failure→retry (08–09, 15, 41–45); quota exhaustion/429/provider outage browser proof unwalked. |
| **SYS-05** Notification recipient, email/push → app | Join request→owner settings via cache; approved joins→cache; item asks/decisions→cache item; rejected join/member departure→Home; detached rejection→Requests; deleted item→cache. Destination reauthorizes; stale notification is not a grant. No in-app notification inbox/read-state. | Eight outbox kinds above. Queue guarded claim/90s lease, bounded provider/row deadlines, retry + paged Cron rescue; no subscriptions/all expired → email, transient push failure retries push rather than fallback mail. Email/push content excludes contact/private approval message/auth email of other users. Source `src/notifications.ts`, `src/push.ts`, `web/public/sw.js`. | `W:notifications, push, push-crypto, d1-caches, d1-requests, d1-removal`; `U:pwa`; **partially** real producer rows inspected (join/request kinds); real delivery/deep-link clicks **blocked** by intentionally dummy mail/no push, not claimed passed. |
| **SYS-06** User after replacement/deletion, no dedicated screen | UI success means pointer/state committed, not that old R2 bytes are already removed. Background failures must not undo state or lose cleanup intent. No user-facing cleanup monitor. | `r2_cleanup` exact/prefix work, scope validation, expiring claim/current-pointer protection, bounded cursor-paged Cron and idempotent R2 delete. Profile removal/replacement exact-only; item deletion exact+prefix. Unknown orphan window remains. | `W:d1-photos, profile-photos, d1-removal`; **partially** real upload/replacement/removal generated item/profile cleanup rows; Cron completion/retry **not walked**, SQL/provider-mock coverage only. |

## Exact error and recovery copy

`web/src/lib/api.ts` is the shared mapping. Flow rows name API codes rather than
repeating these strings. Server error objects are `{error}` plus optional stable
`limit`; 429 may include `Retry-After`. Do not expose raw provider/database errors.

| Code / condition | Exact displayed message |
| --- | --- |
| non-API/network error | Could not connect. Please try again. |
| unmatched API failure (including `json_required`, `invalid_json`, `invalid_cursor`, `invalid_origin`, `auth_unavailable`, `internal_error`, wrong method) | Could not complete that request. Please try again. |
| 401 | Your session has expired. Sign in again. |
| 404 | This cache, item or invite is not available, or you are no longer a member. |
| 429 with bounded retry | Too many tries. Please wait N seconds and try again. |
| 429 otherwise | Too many tries. Please wait a minute and try again. |
| `limits_unavailable` | Could not check the limits. Please try again later. |
| `turnstile_failed` | Bot check failed or expired. Please complete the new check and try again. |
| `email_unavailable` | Could not send the sign-in email. Your invite is saved; please try again. |
| `invalid_magic_link` | That sign-in link is invalid, expired or already used. Request a new link or use an email code. |
| `invalid_callback` | That sign-in destination is not allowed. Request a new link from this app. |
| `INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS`, `invalid_otp` | That code is invalid or expired. Use the most recent code you requested, or request a new one. |
| `invalid_display_name` | Choose a name between 1 and 60 characters. |
| `invalid_name` | Use a cache name between 1 and 60 characters. |
| `member_removed` | You were removed from this cache and cannot rejoin with an invite. |
| `join_not_pending` | This join request has already been decided. The list has been refreshed. |
| `invalid_title` | Use an item title between 1 and 120 characters. |
| `invalid_description` | Keep the description within 2000 characters. |
| `invalid_quantity` | Use a whole stock quantity from 0 to 9999 for consumables; reusable items have no quantity. |
| `invalid_is_consumable`, `immutable_is_consumable` | Choose an item type when adding it. The type cannot be changed later. |
| `quantity_reserved` | Stock cannot be lower than the quantity reserved by pending requests. Refresh the item and try again. |
| `invalid_request_quantity` | Request a whole quantity from 1 to 9999 for consumables; reusable items have no quantity. |
| `item_unavailable` | This item is marked as lent out. Existing requests are unchanged. |
| `invalid_unavailable_note` | Keep the Lent out note within 200 characters. |
| `invalid_lent_out` | Mark as lent out is available only when approving a reusable item. |
| `invalid_available` | Choose whether this item is available. |
| `insufficient_stock` | There is not enough available stock. The item and requests have been refreshed. |
| `request_not_pending` | This request has already been decided. The list has been refreshed. |
| `invalid_contact` | Enter a valid phone number, platform username or chosen email address, not a URL. |
| `invalid_approval_message` | Keep the approval message within 500 characters. |
| `invalid_reason` | Give a rejection reason between 1 and 500 characters. |
| `invalid_photo_type`, `invalid_photo` | Couldn't read that image, try another JPEG, PNG or WebP. |
| local image decode/resize | Couldn't read that image, try another. |
| `photo_too_large` | That photo is too large. Try a smaller image (maximum 5 MB after resizing). |
| `invalid_push_endpoint`, `invalid_push_keys` | This browser returned an unsupported push subscription. |
| `push_limit` | Notifications are already enabled on three browsers for this account. Disable one before adding another. |
| `owner_cannot_leave` | The cache owner cannot leave this cache. |
| `owner_cannot_be_removed` | The cache owner cannot be removed. |

`limit_reached` (409) exact variants:

| `limit` | Message |
| --- | --- |
| `owned_caches` | Limit reached: you already own the maximum number of caches. |
| `new_caches_per_day` | Limit reached: you have created the maximum number of caches in the last 24 hours. Try again later. |
| `member_caches` | Limit reached: you are already in the maximum number of caches. |
| `cache_members` | Limit reached: this cache has the maximum number of active members. |
| `owned_items` | Limit reached: your item library is full. |
| `open_requests` | Limit reached: you have the maximum number of pending asks. Wait for one to be answered. |
| `photos_per_item` | Limit reached: the photo allowance for this item is unavailable. |
| `profile_photos` | Limit reached: the profile photo allowance is unavailable. |
| missing/unknown name | Limit reached: this action exceeds the current allowance. |

Additional screen-local errors/states are in the flow rows. Keep these distinctions:

- Turnstile unavailable: “Bot protection is unavailable. Please retry.” + Retry
  bot check; script failure: “Bot check could not load. Please retry.” Missing
  config/script failure disables protected sends/create. Loading/checking labels
  are “Loading bot check…” / “Checking your browser…”. Expiry/error clears the
  token; fixture readiness is not a real-token verdict.
- Invite parse: “That does not look like an invite. Paste the full invite link or
  its code.” Invalid route heading: “Invalid invite link”. Cache Invite reports
  “Invite shared.”, “Sharing cancelled.” or “Invite copied.”; failed share/copy:
  “Could not share or copy. Open Cache settings to select the invite link.”
  Settings copy failure: “Could not copy automatically. Select the invite link
  and copy it.”
- Magic-link missing fragment: “This sign-in link is missing or invalid. Request
  a new link or use an email code.”
- Shown in failure appends “Could not confirm sharing. Refresh or try the checkbox
  again.”; detach dialog appends “You can retry here.”
- Multi-attach failure appends “Items already added are kept. Retry the remaining
  selection or find them in Your items.” Photo-after-create failure says “Your
  item is saved in your library. Only the photo needs retrying.” (cache variant:
  “Your item is saved and shared here. Only the photo needs retrying.”)
- Local approval message/note checks: “Keep the message within 500 characters.” /
  “Keep the note within 200 characters.” Global note API copy differs as above.
- Push setup: “Push is not configured yet. Email notifications remain available.”
  Registration error: “Could not start notifications. Reload and try again.”
  Config error: “Could not load notification configuration.” Permission denial:
  “Notification permission was not granted. You can change it in browser settings.”

## Not implemented / deliberately outside this invariant

Do not turn an absent flow into a refactor requirement to build it:

- Cache deletion, description, admin roles/role management, ownership transfer,
  unremove/reinvite overrides, member search/discovery and public cache browsing.
- Requester cancellation, return/holder/loan lifecycle, handoff/address/logistics
  tracking, chat or message/email relay. Rejection exists; cancellation does not.
- Individual item-photo removal (replace or global item delete only). Profile
  photo removal **does** exist. No photo gallery/public/signed/bearer URL.
- Web 404 page (unknown web routes redirect Home), manual theme/settings toggle,
  per-plan themes, offline data cache, custom PWA install prompt or notification
  inbox. Landing invite CTA is guidance; paste is on signed-in Home.
- Password/SMS auth, auth email editing, account deletion, Google sign-in,
  Apple sign-in, protected owner `/admin`/suspension controls, billing/upgrades
  and in-app supporter/payment records. Google/admin require owner setup and
  implementation; Apple is deferred. Support is only an external hosted link.
- Remote migration, deployment, Cloudflare mutation, production mail/push send,
  destructive DO retirement/reset, legacy cutover/decommissioning or release
  approval. This inventory is input to Gate 10, **not completion of Gate 10–12**.

## Local walkthrough replay

1. Use current built assets; start a local-only Worker with isolated persistence,
   explicit local URLs/dummy provider values and no loaded real credentials.
   Apply `migrations/d1` to that **same local persistence**. Never `--remote`.
2. Seed three throwaway users/sessions, an open owner cache and a second gated
   cache owned by another user. Seed sessions are setup, not authentication proof.
   Start the existing fixture separately only for the blocked auth/bot UI.
3. Walk AUTH → JOIN/CACHE → private reusable and cache consumable/new-sheet item
   creation → sharing → asks/decisions/contact → photos → leave/rejoin →
   destructive confirmations/denial. Record failures rather than bypassing them
   and calling the original UI passed. Seed attachments/removed state explicitly
   only when needed to reach downstream screens.
4. Seed >25 own items/party requests to exercise continuation. Observe both
   phone and wide layouts; emulate native light/dark/reduced motion. Fault one
   local read, restore network and use its visible retry. Close named browser
   sessions after each short batch; intermittent CDP disconnects require a fresh
   explicit local session/navigation, not a claimed observation of a blank page.
5. Inspect local D1 summaries, not raw auth/outbox/contact payloads: this run
   recorded approved consumable stock **6→4**, two approved/one rejected real asks,
   join/request outbox kinds and profile/item cleanup intents. Extra pagination
   history was setup, not additional real decisions. Dummy-provider failure does
   not prove delivery or durable recovery.
6. Save UX notes/screenshots outside git, stop only this run's local services,
   leave pre-existing fixture/services untouched, remove temporary runtime vars,
   and run `git diff --check`. Confirm the commit
   changes only this file and the build-guide link. Do not substitute docs-only
   checks for an implementation suite, security review or release approval.
