---
priority: 4
arc: honest-axes
---

# Two thread ids can share one pi session file

`sessionIdFor` in `backends/pi/src/store.ts` and its identical twin in
`backends/pi-rpc/src/store.ts` coerce a thread id into a pi session id:

```ts
const cleaned = threadId.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[._-]+|[._-]+$/g, "");
return cleaned || "thread";
```

That map isn't injective. `rev x`, `rev/x` and `rev_x` all become `rev_x`, so
they are one thread as far as the store is concerned — `pathFor` finds the same
file, `open` resumes it, and a `DELETE` on any of them removes the other's
history. Ids with no allowed characters collapse further, onto the shared
literal `"thread"`. Confirmed against `:8003` when the item was first written: a
turn posted to thread `rev x` came back from `GET /threads/rev_x`. Both copies
of the function re-read on 2026-08-18 and unchanged.

Hub-minted ids are `token_urlsafe`, which stays in the safe class, so this needs
an external client to hit — curl, a script, another frontend. That is exactly
the audience `protocol/CONTRACT.md` invites, which is why it's worth closing
rather than documenting.

Either fix works: hash the original id into the coerced one so distinct ids stay
distinct, or reject a thread id that doesn't survive the round trip. Rejecting
is the smaller change and gives a caller a real error instead of a silent merge;
hashing keeps every id usable. Pick one and apply it to both backends in the
same commit — `backends/pi-rpc/src/store.ts` is a copy, and a fix in one is a
divergence.

## Acceptance

- `POST /chat` on `rev x` and on `rev_x` produce two threads; `GET /threads`
  lists both; deleting one leaves the other.
- Both pi backends behave identically — the same probe against `:8003` and
  `:8004`.
- `./protocol/conformance.sh http://localhost:8003` and `:8004` stay green, and
  `./scripts/golden.sh` too.

---
