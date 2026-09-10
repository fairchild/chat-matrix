#!/usr/bin/env bash
# Check that a backend implements the reference contract, so a frontend can be
# pointed at it without surprises. Usage: conformance.sh [backend-url]
set -uo pipefail

BACKEND="${1:-http://localhost:8001}"
THREAD="conformance-$$"
PASS=0
FAIL=0
SKIP=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
# A check the backend has told us it doesn't answer. It carries the backend's own
# words and is counted separately, so a skip can never be read as a pass.
skip() { printf '  \033[33m–\033[0m %s\n    \033[33m%s\033[0m\n' "$1" "$2"; SKIP=$((SKIP + 1)); }
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
  authority="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("history",""))' "$health")"
  assert "health declares where history lives" '"history"' "$health"
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
# A deployment may decline to publish the bulk list — it's every visitor's first
# message — and says so in `detail`. That's a different fact from an empty store,
# so it's skipped rather than failed, and only when the backend states it: an
# unexplained empty list is still a failure. The thread having persisted is
# proven either way by the rehydrate checks below, which fetch it by id.
list_off="$(python3 -c 'import json,sys;b=json.load(open(sys.argv[1]));print(b["detail"] if not b.get("threads") and b.get("detail") else "")' "$threads" 2>/dev/null || echo "")"
if [ -n "$list_off" ]; then
  skip "thread recorded after run" "$list_off"
else
  assert "thread recorded after run" "$THREAD" "$threads"
fi

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
why=$(mktemp)
if python3 - "$BACKEND" "$THREAD" >"$second" 2>"$why" <<'PYEOF'
import json, sys, urllib.request

backend, thread = sys.argv[1], sys.argv[2]

# Every request below names the gate rather than the interpreter. Cloudflare's
# edge answers a `Python-urllib/x.y` User-Agent with `403` and error 1010 — a
# browser-signature ban applied before the Worker is reached — so against a
# deployed backend these two checks failed for their User-Agent and reported it
# as the backend refusing the request. The curl calls in this same file were
# never affected, which is what made it read as a route problem rather than a
# client one. Installing the opener covers the bare-URL urlopen calls as well as
# the Request objects.
UA = "chat-matrix-conformance (+protocol/conformance.sh)"
_opener = urllib.request.build_opener()
_opener.addheaders = [("user-agent", UA)]
urllib.request.install_opener(_opener)

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
    """Collect the ids of tool *parts* only.

    An `id` inside a tool's arguments or result is that tool's content, not a
    part's identity — the same distinction golden.ts draws when it renames ids
    at a frame's top level and leaves the rest alone. Recursing indiscriminately
    would red a healthy thread whose tool happens to return a `toolCallId` key.
    """
    if isinstance(node, dict):
        kind = node.get("type")
        if isinstance(kind, str) and (kind.startswith("tool-") or kind == "dynamic-tool"):
            if isinstance(node.get("toolCallId"), str):
                ids.append(node["toolCallId"])
        for key, value in node.items():
            if key not in ("input", "output"):
                walk(value)
    elif isinstance(node, list):
        for value in node:
            walk(value)

walk(get(f"/threads/{thread}?protocol=vercel-ai"))
print(len(ids), len(set(ids)))
PYEOF
then
  read -r total distinct <"$second"
  # Uniqueness is the claim, and it doesn't depend on the model. Whether two
  # calls happened at all does: a real model may answer the second question
  # without reaching for the tool, which is a miss, not a conformance failure.
  if [ "$total" != "$distinct" ]; then
    bad "tool call ids are unique in a thread ($total calls, $distinct distinct)"
  elif [ "${total:-0}" -lt 2 ] && [ "$model" = "scripted" ]; then
    bad "two turns leave two tool calls in the thread (found ${total:-0})"
  else
    ok "tool call ids are unique in a thread (${total:-0} calls)"
    [ "${total:-0}" -lt 2 ] && printf '    \033[33m⚠\033[0m fewer than two calls — %s did not call the tool twice, so uniqueness held trivially\n' "$model"
  fi
else
  bad "second turn on the same thread (request failed)"
  sed 's/^/    /' "$why" | tail -4
fi

# Where history lives is a real difference between these backends, not a defect
# in either, so the contract admits both and `/health` declares which. This holds
# a backend to its own declaration, from both sides: a `client` backend has to
# follow the client's shorter history, and a `session` backend has to ignore it.
# Declared one way and behaving the other is the failure — which is what keeps
# the flag from excusing a regression rather than describing a design.
head_ "history authority ($authority)"
partial=$(mktemp)
whyp=$(mktemp)
if [ -z "$authority" ]; then
  bad "health declares history authority (missing, so nothing to hold it to)"
elif python3 - "$BACKEND" "$THREAD-auth" >"$partial" 2>"$whyp" <<'PYEOF'
import json, sys, urllib.request

backend, thread = sys.argv[1], sys.argv[2]

# Same reason as the block above: the default User-Agent is banned at
# Cloudflare's edge with a 403 before the Worker sees the request.
_opener = urllib.request.build_opener()
_opener.addheaders = [("user-agent", "chat-matrix-conformance (+protocol/conformance.sh)")]
urllib.request.install_opener(_opener)

def send(text, messages):
    body = json.dumps({
        "id": thread, "trigger": "submit-message",
        "messages": messages + [
            {"id": f"u{len(messages)}", "role": "user",
             "parts": [{"type": "text", "text": text}]}
        ],
    }).encode()
    request = urllib.request.Request(
        f"{backend}/chat", data=body, headers={"content-type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        response.read()

def stored():
    with urllib.request.urlopen(f"{backend}/threads/{thread}?protocol=vercel-ai", timeout=30) as r:
        return json.load(r)["messages"]

send("What is the weather in Tokyo?", [])
after_first = stored()
# The second turn deliberately echoes nothing: the shape a second tab, or a
# client that windows a long thread, produces without meaning to.
send("What is the weather in Oslo?", [])
after_second = stored()

def cities(messages):
    found = []
    def walk(node):
        if isinstance(node, dict):
            kind = node.get("type")
            if isinstance(kind, str) and (kind.startswith("tool-") or kind == "dynamic-tool"):
                value = node.get("input")
                if isinstance(value, dict) and isinstance(value.get("city"), str):
                    found.append(value["city"])
            for key, item in node.items():
                if key not in ("input", "output"):
                    walk(item)
        elif isinstance(node, list):
            for item in node:
                walk(item)
    walk(messages)
    return found

print(len(after_first), " ".join(sorted(set(cities(after_second)))) or "-")
PYEOF
then
  read -r first kept <"$partial"
  case "$authority:$kept" in
    client:Oslo)
      ok "client-authoritative: a shorter history shrinks the stored thread (kept $kept)" ;;
    session:Oslo\ Tokyo)
      ok "session-authoritative: the server's own session survives a partial echo (kept $kept)" ;;
    client:*)
      bad "declares client-authoritative but kept '$kept' — a client-authoritative store follows the client's history" ;;
    session:*)
      bad "declares session-authoritative but kept '$kept' — a session-authoritative store keeps its own turns" ;;
    *)
      bad "history is '$authority'; expected \"client\" or \"session\"" ;;
  esac
else
  bad "history authority probe (request failed)"
  sed 's/^/    /' "$whyp" | tail -4
fi
curl -s -X DELETE "$BACKEND/threads/$THREAD-auth" >/dev/null 2>&1 || true

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

printf '\n\033[1m%d passed, %d failed%s\033[0m\n' "$PASS" "$FAIL" \
  "$([ "$SKIP" -gt 0 ] && printf ', %d skipped' "$SKIP")"
[ "$FAIL" -eq 0 ]
