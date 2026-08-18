#!/usr/bin/env bash
# Check that a backend implements the reference contract, so a frontend can be
# pointed at it without surprises. Usage: conformance.sh [backend-url]
set -uo pipefail

BACKEND="${1:-http://localhost:8001}"
THREAD="conformance-$$"
PASS=0
FAIL=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# assert <label> <needle> <haystack-file>
assert() { grep -qF -- "$2" "$3" && ok "$1" || bad "$1 (missing: $2)"; }

trap 'curl -s -X DELETE "$BACKEND/threads/$THREAD" >/dev/null 2>&1 || true' EXIT

printf '\033[1mconformance: %s\033[0m\n' "$BACKEND"

head_ "health"
health=$(mktemp)
if curl -sf "$BACKEND/health" -o "$health"; then
  for field in '"backend"' '"model"' '"tools"' '"protocols"'; do
    assert "health exposes $field" "$field" "$health"
  done
  model="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["model"])' "$health")"
  printf '    backend=%s model=%s\n' \
    "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["backend"])' "$health")" \
    "$model"
  # These assertions are about which events the stream carries, and a real model
  # chooses whether to call a tool at all. It can pass; it can also miss for a
  # reason that isn't a conformance failure.
  [ "$model" = "scripted" ] || printf '    \033[33m⚠\033[0m not on scripted — a real model picks its own tools, so a miss here may be the model\n'
else
  bad "GET /health unreachable — is the backend running?"
  printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
  exit 1
fi

head_ "vercel-ai stream (/chat)"
stream=$(mktemp)
curl -sN -X POST "$BACKEND/chat" -H 'content-type: application/json' -d "{
  \"id\": \"$THREAD\", \"trigger\": \"submit-message\",
  \"messages\": [{\"id\":\"m1\",\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"text\":\"What is the weather in Tokyo?\"}]}]
}" -o "$stream"
# The tool-input-* pair is what lets a frontend show arguments streaming in.
assert "emits start"                 '"type":"start"'                 "$stream"
assert "emits tool-input-start"      '"type":"tool-input-start"'      "$stream"
assert "emits tool-input-delta"      '"type":"tool-input-delta"'      "$stream"
assert "emits tool-output-available" '"type":"tool-output-available"' "$stream"
assert "emits text-delta"            '"type":"text-delta"'            "$stream"
assert "terminates with [DONE]"      'data: [DONE]'                   "$stream"
assert "tool actually ran"           'Tokyo'                          "$stream"

head_ "persistence"
threads=$(mktemp)
curl -sf "$BACKEND/threads" -o "$threads"
assert "thread recorded after run" "$THREAD" "$threads"

for proto in vercel-ai ag-ui; do
  hydrate=$(mktemp)
  if curl -sf "$BACKEND/threads/$THREAD?protocol=$proto" -o "$hydrate"; then
    count=$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["messages"]))' "$hydrate" 2>/dev/null || echo 0)
    [ "${count:-0}" -gt 0 ] && ok "rehydrates as $proto ($count messages)" \
                            || bad "rehydrates as $proto (0 messages)"
  else
    bad "rehydrates as $proto (request failed)"
  fi
done

# A second turn calling the *same* tool, with the transcript echoed back the way
# a client does. Nothing else here repeats a tool inside one thread, and the
# golden fixtures can't either, so this is the only place a call id numbered
# per-run collides with itself — which it did, in all four backends, until
# 51c0d5d. The id is a client's identity for a tool part: two parts sharing one
# means the second result renders against the first call's card.
head_ "tool call ids"
second=$(mktemp)
if python3 - "$BACKEND" "$THREAD" >"$second" 2>/dev/null <<'PYEOF'
import json, sys, urllib.request

backend, thread = sys.argv[1], sys.argv[2]

def get(path):
    with urllib.request.urlopen(f"{backend}{path}", timeout=30) as response:
        return json.load(response)

history = get(f"/threads/{thread}?protocol=vercel-ai")["messages"]
body = json.dumps({
    "id": thread,
    "trigger": "submit-message",
    "messages": history + [
        {"id": "m2", "role": "user",
         "parts": [{"type": "text", "text": "What is the weather in Paris?"}]}
    ],
}).encode()
request = urllib.request.Request(
    f"{backend}/chat", data=body, headers={"content-type": "application/json"}
)
with urllib.request.urlopen(request, timeout=60) as response:
    response.read()

ids = []
def walk(node):
    if isinstance(node, dict):
        if isinstance(node.get("toolCallId"), str):
            ids.append(node["toolCallId"])
        for value in node.values():
            walk(value)
    elif isinstance(node, list):
        for value in node:
            walk(value)

walk(get(f"/threads/{thread}?protocol=vercel-ai"))
print(len(ids), len(set(ids)))
PYEOF
then
  read -r total distinct <"$second"
  if [ "${total:-0}" -lt 2 ]; then
    bad "two turns leave two tool calls in the thread (found ${total:-0})"
  elif [ "$total" != "$distinct" ]; then
    bad "tool call ids are unique in a thread ($total calls, $distinct distinct)"
  else
    ok "tool call ids are unique in a thread ($total calls)"
  fi
else
  bad "second turn on the same thread (request failed)"
fi

head_ "ag-ui stream (/ag-ui)"
agui=$(mktemp)
curl -sN -X POST "$BACKEND/ag-ui" -H 'content-type: application/json' -d "{
  \"threadId\": \"$THREAD-agui\", \"runId\": \"run-1\", \"state\": {},
  \"messages\": [{\"id\":\"m1\",\"role\":\"user\",\"content\":\"What is the weather in Tokyo?\"}],
  \"tools\": [], \"context\": [], \"forwardedProps\": {}
}" -o "$agui"
assert "emits RUN_STARTED"        'RUN_STARTED'        "$agui"
assert "emits TOOL_CALL_START"    'TOOL_CALL_START'    "$agui"
assert "emits TEXT_MESSAGE_START" 'TEXT_MESSAGE_START' "$agui"
assert "emits RUN_FINISHED"       'RUN_FINISHED'       "$agui"
curl -s -X DELETE "$BACKEND/threads/$THREAD-agui" >/dev/null 2>&1 || true

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
