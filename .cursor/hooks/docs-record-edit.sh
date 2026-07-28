#!/usr/bin/env bash
# afterFileEdit: record non-doc edits for the docs-check stop hook.
#
# ponytail: only edits made through the agent's edit tool are recorded.
# Ceiling: shell rewrites (gofmt -w, codegen) and deletions are invisible.
# Upgrade: add postToolUse entries matching Shell and Delete.

set -u

quiet() {
  printf '%s\n' '{}'
  exit 0
}

input=$(cat) || quiet
conversation_id=$(printf '%s' "$input" | jq -er '.conversation_id // empty' 2>/dev/null) || quiet
file_path=$(printf '%s' "$input" | jq -er '.file_path // empty' 2>/dev/null) || quiet

[ -n "$conversation_id" ] || quiet
[ -n "$file_path" ] || quiet

# Project hooks run from the project root.
root=$(pwd -P)
# Resolve file_path if it exists; otherwise use as given (new files).
if [ -e "$file_path" ]; then
  abs=$(cd "$(dirname "$file_path")" && pwd -P)/$(basename "$file_path")
else
  abs=$file_path
  case "$abs" in
    /*) ;;
    *) quiet ;;
  esac
fi

# Component-aware containment: reject sibling-prefix paths.
case "$abs" in
  "$root"/*) ;;
  *) quiet ;;
esac

rel=${abs#"$root"/}

case "$rel" in
  docs|docs/*|AGENTS.md|README.md|.cursor|.cursor/*) quiet ;;
esac

state_dir=${DOCS_HOOK_STATE_DIR:-.cursor/hooks/state}
mkdir -p "$state_dir" || quiet

key=$(printf '%s' "$conversation_id" | shasum -a 256 | cut -c1-32)
state_file=$state_dir/$key

printf '%s\n' "$rel" >>"$state_file" || quiet
quiet
