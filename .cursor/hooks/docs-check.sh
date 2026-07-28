#!/usr/bin/env bash
# stop: if this conversation recorded non-doc edits, nudge maintaining-docs.

set -u

quiet() {
  printf '%s\n' '{}'
  exit 0
}

input=$(cat) || quiet
status=$(printf '%s' "$input" | jq -er '.status // empty' 2>/dev/null) || quiet
conversation_id=$(printf '%s' "$input" | jq -er '.conversation_id // empty' 2>/dev/null) || quiet

[ "$status" = "completed" ] || quiet
[ -n "$conversation_id" ] || quiet

state_dir=${DOCS_HOOK_STATE_DIR:-.cursor/hooks/state}
key=$(printf '%s' "$conversation_id" | shasum -a 256 | cut -c1-32)
state_file=$state_dir/$key
claimed=$state_dir/${key}.claimed.$$

mv "$state_file" "$claimed" 2>/dev/null || quiet

if [ ! -s "$claimed" ]; then
  rm -f "$claimed"
  quiet
fi

paths=$(sort -u "$claimed" | tr '\n' ' ' | sed 's/[[:space:]]*$//')
rm -f "$claimed"

# Follow-up names the skill and permits a one-line "no doc change needed".
msg=$(jq -nc \
  --arg paths "$paths" \
  '{followup_message: ("Code edits this turn: " + $paths + ". Use the maintaining-docs skill to check whether AGENTS.md, README.md, or docs/build-guide.md need updates. If nothing is stale, reply with exactly: no doc change needed.")}')

printf '%s\n' "$msg"
exit 0
