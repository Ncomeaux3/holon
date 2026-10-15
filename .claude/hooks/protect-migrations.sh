#!/usr/bin/env bash
# Blocks edits to shipped migrations. New migration files are allowed.
input=$(cat)
path=$(echo "$input" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null)
if [[ "$path" == *supabase/migrations/* ]] && git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
  echo "Blocked: $path is a shipped migration. Create a new migration instead." >&2
  exit 2
fi
exit 0
