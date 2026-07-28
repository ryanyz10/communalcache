#!/usr/bin/env bash
# Runnable check for docs-record-edit.sh and docs-check.sh.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd -P)
RECORD=$ROOT/.cursor/hooks/docs-record-edit.sh
CHECK=$ROOT/.cursor/hooks/docs-check.sh
STATE=$(mktemp -d)
trap 'rm -rf "$STATE"; rm -f "$ROOT"/tmp\ spaced*.go 2>/dev/null || true' EXIT

export DOCS_HOOK_STATE_DIR=$STATE
cd "$ROOT"

pass=0
fail=0

assert_one_json() {
  local out=$1
  local n
  n=$(printf '%s' "$out" | jq -s 'length')
  if [ "$n" = "1" ]; then
    return 0
  fi
  echo "FAIL: expected exactly one JSON value, got: [$out]"
  fail=$((fail + 1))
  return 1
}

ok() {
  echo "ok  $1"
  pass=$((pass + 1))
}

bad() {
  echo "FAIL $1"
  fail=$((fail + 1))
}

assert_eq() {
  local got=$1 want=$2 label=$3
  if [ "$got" = "$want" ]; then
    ok "$label"
  else
    bad "$label"
    echo "  got:  $got"
    echo "  want: $want"
  fi
}

assert_file() {
  local path=$1 label=$2
  if [ -f "$path" ]; then
    ok "$label"
  else
    bad "$label (missing $path)"
  fi
}

assert_no_file() {
  local path=$1 label=$2
  if [ ! -e "$path" ]; then
    ok "$label"
  else
    bad "$label (still exists: $path)"
  fi
}

assert_contains() {
  local hay=$1 needle=$2 label=$3
  if printf '%s' "$hay" | grep -qF "$needle"; then
    ok "$label"
  else
    bad "$label"
    echo "  hay: $hay"
  fi
}

assert_not_contains() {
  local hay=$1 needle=$2 label=$3
  if printf '%s' "$hay" | grep -qF "$needle"; then
    bad "$label"
    echo "  hay: $hay"
  else
    ok "$label"
  fi
}

assert_json_field_match() {
  local out=$1 pattern=$2 label=$3
  if printf '%s' "$out" | jq -e --arg p "$pattern" '.followup_message | test($p)' >/dev/null 2>&1; then
    ok "$label"
  else
    bad "$label"
    echo "  out: $out"
  fi
}

assert_json_field_nomatch() {
  local out=$1 pattern=$2 label=$3
  if printf '%s' "$out" | jq -e --arg p "$pattern" '.followup_message | test($p) | not' >/dev/null 2>&1; then
    ok "$label"
  else
    bad "$label"
    echo "  out: $out"
  fi
}

key_for() {
  printf '%s' "$1" | shasum -a 256 | cut -c1-32
}

run_record() {
  local cid=$1 path=$2
  printf '%s' "$(jq -nc --arg c "$cid" --arg p "$path" '{conversation_id:$c,file_path:$p,edits:[]}')" |
    bash "$RECORD"
}

run_check() {
  local cid=$1 status=${2:-completed}
  printf '%s' "$(jq -nc --arg c "$cid" --arg s "$status" '{conversation_id:$c,status:$s,loop_count:0}')" |
    bash "$CHECK"
}

# --- Recorder ---

out=$(run_record "c1" "$ROOT/docs/plan.md")
assert_one_json "$out" || true
assert_eq "$out" '{}' "recorder ignores docs/"
assert_no_file "$STATE/$(key_for c1)" "recorder wrote nothing for docs/"

out=$(run_record "c1" "$ROOT/AGENTS.md")
assert_eq "$out" '{}' "recorder ignores AGENTS.md"

out=$(run_record "c1" "$ROOT/README.md")
assert_eq "$out" '{}' "recorder ignores README.md"

out=$(run_record "c1" "$ROOT/.cursor/hooks.json")
assert_eq "$out" '{}' "recorder ignores .cursor/"

out=$(run_record "c1" "$ROOT/internal/api/server.go")
assert_one_json "$out" || true
assert_eq "$out" '{}' "recorder emits {} on record"
if grep -qx 'internal/api/server.go' "$STATE/$(key_for c1)"; then
  ok "recorder records internal/api/server.go"
else
  bad "recorder records internal/api/server.go"
fi

spaced="$ROOT/tmp spaced$$.go"
printf 'package tmp\n' >"$spaced"
out=$(run_record "c-space" "$spaced")
assert_eq "$out" '{}' "recorder emits {} for spaced path"
if grep -qx "tmp spaced$$.go" "$STATE/$(key_for c-space)"; then
  ok "recorder records path with space"
else
  bad "recorder records path with space"
  echo "  state: $(cat "$STATE/$(key_for c-space)" 2>/dev/null || echo missing)"
fi
rm -f "$spaced"

out=$(run_record "c1" "${ROOT}-other/foo.go")
assert_eq "$out" '{}' "recorder ignores sibling-prefix path"
if grep -q 'foo.go' "$STATE/$(key_for c1)" 2>/dev/null; then
  bad "sibling-prefix not recorded"
else
  ok "sibling-prefix not recorded"
fi

out=$(run_record "c1" "/tmp/outside-communalcache.go")
assert_eq "$out" '{}' "recorder ignores path outside root"

nested=$STATE/nested-missing
rm -rf "$nested"
out=$(DOCS_HOOK_STATE_DIR=$nested run_record "c-mkdir" "$ROOT/internal/api/server.go")
assert_eq "$out" '{}' "recorder creates missing state dir"
if [ -d "$nested" ]; then ok "state dir was created"; else bad "state dir was created"; fi
assert_file "$nested/$(key_for c-mkdir)" "state file in new dir"

out=$(run_record "../../etc/passwd" "$ROOT/internal/api/errors.go")
assert_eq "$out" '{}' "hostile conversation_id still emits {}"
hostile_key=$(key_for "../../etc/passwd")
assert_file "$STATE/$hostile_key" "hostile id writes inside state dir only"
if [ -e /tmp/docs-hook-escape-probe ]; then rm -f /tmp/docs-hook-escape-probe; fi
# Confirm no path components from the id escaped the state dir.
escaped=0
case "$hostile_key" in
  *..*) escaped=1 ;;
esac
if [ "$escaped" -eq 0 ] && [ ! -e "$STATE/../passwd" ]; then
  ok "hostile id does not escape state dir"
else
  bad "hostile id does not escape state dir"
fi

out=$(run_record "" "$ROOT/internal/api/server.go")
assert_eq "$out" '{}' "recorder ignores empty conversation_id"

k1=$(key_for "!!!")
k2=$(key_for "???")
run_record "!!!" "$ROOT/internal/api/server.go" >/dev/null
run_record "???" "$ROOT/internal/api/errors.go" >/dev/null
if [ "$k1" != "$k2" ]; then ok "punctuation-only ids hash differently"; else bad "punctuation-only ids hash differently"; fi
if [ -f "$STATE/$k1" ] && [ -f "$STATE/$k2" ]; then
  ok "punctuation-only ids get distinct files"
else
  bad "punctuation-only ids get distinct files"
  echo "  k1=$k1 exists=$([ -f "$STATE/$k1" ] && echo y || echo n)"
  echo "  k2=$k2 exists=$([ -f "$STATE/$k2" ] && echo y || echo n)"
  ls -la "$STATE"
fi

# --- Checker ---

out=$(run_check "c-abort" "aborted")
assert_one_json "$out" || true
assert_eq "$out" '{}' "checker silent on aborted"

out=$(run_check "c-error" "error")
assert_eq "$out" '{}' "checker silent on error"

out=$(run_check "c-missing")
assert_eq "$out" '{}' "checker silent when state missing"

empty_key=$(key_for "c-empty")
: >"$STATE/$empty_key"
out=$(run_check "c-empty")
assert_eq "$out" '{}' "checker silent when state empty"
assert_no_file "$STATE/$empty_key" "empty state claimed and removed"

run_record "c-nudge" "$ROOT/internal/api/server.go" >/dev/null
out=$(run_check "c-nudge")
assert_one_json "$out" || true
assert_json_field_match "$out" "maintaining-docs" "checker nudges with skill name"
assert_json_field_match "$out" "internal/api/server\\.go" "checker lists recorded path"

out=$(run_check "c-nudge")
assert_eq "$out" '{}' "second stop is silent after claim"

run_record "c-dedup" "$ROOT/internal/api/server.go" >/dev/null
run_record "c-dedup" "$ROOT/internal/api/server.go" >/dev/null
out=$(run_check "c-dedup")
count=$(printf '%s' "$out" | jq -r '.followup_message' | grep -oF 'internal/api/server.go' | wc -l | tr -d ' ')
assert_eq "$count" "1" "checker deduplicates repeated path"

out=$(printf 'not-json' | bash "$CHECK")
assert_one_json "$out" || true
assert_eq "$out" '{}' "checker yields {} on malformed stdin"

# --- Lifecycle: record after claim ---

run_record "c-life" "$ROOT/internal/api/server.go" >/dev/null
out1=$(run_check "c-life")
assert_json_field_match "$out1" "server\\.go" "lifecycle first check nudges"
run_record "c-life" "$ROOT/internal/api/errors.go" >/dev/null
out2=$(run_check "c-life")
assert_json_field_match "$out2" "errors\\.go" "lifecycle second check has newer path"
assert_json_field_nomatch "$out2" "server\\.go" "lifecycle second check lacks older path"

# --- Conversation isolation ---

run_record "iso-a" "$ROOT/internal/api/server.go" >/dev/null
run_record "iso-b" "$ROOT/internal/api/errors.go" >/dev/null
out_a=$(run_check "iso-a")
out_b=$(run_check "iso-b")
assert_json_field_match "$out_a" "server\\.go" "iso A has server.go"
assert_json_field_nomatch "$out_a" "errors\\.go" "iso A lacks errors.go"
assert_json_field_match "$out_b" "errors\\.go" "iso B has errors.go"
assert_json_field_nomatch "$out_b" "server\\.go" "iso B lacks server.go"

# Doc edit after code edit does not suppress
run_record "c-mix" "$ROOT/internal/api/server.go" >/dev/null
run_record "c-mix" "$ROOT/AGENTS.md" >/dev/null
out=$(run_check "c-mix")
assert_json_field_match "$out" "server\\.go" "doc edit does not suppress code nudge"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
