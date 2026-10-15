#!/usr/bin/env bash
# Warns if an edited file contains an em dash.
input=$(cat)
path=$(echo "$input" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null)
if [[ -f "$path" ]] && grep -q $'\xe2\x80\x94' "$path"; then
  echo "Em dash found in $path. Replace with comma, period, colon, or parentheses." >&2
  exit 2
fi
exit 0
