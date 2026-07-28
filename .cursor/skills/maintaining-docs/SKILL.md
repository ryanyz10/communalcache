---
name: maintaining-docs
description: >-
  Use when finishing a change that may have left documentation stale, when a
  stop-hook follow-up asks for a docs check, when docs/build-guide.md, AGENTS.md,
  or README.md no longer match the code, or when judging whether a documentation
  file should be split because it covers too many unrelated systems.
---

# Maintaining docs

Keep Communal Cache documentation accurate. Fix stale facts; propose
restructuring and wait for approval.

## Ownership

| File                  | Owns                                                     |
| --------------------- | -------------------------------------------------------- |
| `AGENTS.md`           | Invariants, conventions, commands, `Current state`       |
| `README.md`           | `Status`, `Layout`, local run steps, deploy secrets list |
| `docs/build-guide.md` | Phase order, concepts, traps, proofs                     |
| `docs/plan.md`        | **Frozen. Never edit. Never split.**                     |

Phase 1 in the build guide uses `Already scaffolded` / `Left to do`. Phases 2–8
use `Build order`. "Mark the phase item done" means different edits in different
phases.

### Duplications — update both

- `AGENTS.md` `Current state` and `README.md` `Status` describe the same progress
  in different words.
- `README.md` deploy secrets must match the env vars `internal/config` actually
  reads.

## Change → doc

| Code change              | Update                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Phase item completed     | `AGENTS.md` `Current state`, `README.md` `Status`, and the phase's `Left to do` or `Build order` |
| New justified dependency | `AGENTS.md` Conventions exceptions list                                                          |
| New command or env var   | `AGENTS.md` Commands and `README.md` (Local / Deploy)                                            |
| Newly discovered trap    | The relevant phase's `Traps` in `docs/build-guide.md`                                            |
| Layout / package move    | `README.md` `Layout`                                                                             |

If nothing in the table applies, answer **"no doc change needed"** in one line.

## `docs/plan.md` divergence is a defect

`plan.md` is the settled spec. If the implementation disagrees with it, the code
is wrong — surface the disagreement and stop. Do **not** normalize the drift by
recording it in `build-guide.md` or anywhere else.

## Fix small, propose large

- **Do:** correct a stale fact (status line, renamed command, new secret, trap).
- **Propose and wait:** any split or other restructuring.

## Splitting (cohesion, not size)

Split when a file goes in-depth on systems that are **not read together**:

- Two+ subjects with their own subsections where a reader for one skips the other
- The opening sentence needs "and" to describe the file
- The file needs edits for unrelated reasons

Do **not** split on length alone. A long file about one system is fine.

**Exception:** a document organized as a sequence or an index is cohesive even
when it spans many systems. `docs/build-guide.md` is the journey through phases —
not a split candidate today. It becomes one only if a single phase grows into a
reference in its own right.

When a split is approved: extract the subject, leave a one-line link (not a
summary), keep the parent readable as an index, `grep` the repo for the old
filename to fix every inbound link and anchor, and update this skill's ownership
map.
