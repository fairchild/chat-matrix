// app.js — the whole client. Applies NDJSON DOM patches from POST /t/{id};
// the server owns every state transition and every byte of markup.
const fragmentUrl = () => document.getElementById("composer").action + "/fragments/composer";
let controller = null;
const near = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 80;
const focusInput = () => document.querySelector('[data-slot="input"]')?.focus();
const apply = (line, el, stuck) => {
  const p = JSON.parse(line);
  const target = p.target && document.getElementById(p.target);
  if (p.op !== "done" && !target) return console.debug("app.js: unknown target", p.target);
  if (p.op === "append" || p.op === "error") target.insertAdjacentHTML("beforeend", p.html);
  else if (p.op === "replace") target.outerHTML = p.html;
  else if (p.op === "text") target.append(document.createTextNode(p.text));
  else if (p.op !== "done") return;
  if (stuck) el.scrollTop = el.scrollHeight;
  if (p.op === "done" || p.op === "error") focusInput();
};
const restoreComposer = async () => {
  document.getElementById("composer").outerHTML = await fetch(fragmentUrl()).then((r) => r.text());
  focusInput();
};
const run = async (form, submitter) => {
  if (controller) return; // a run is already in flight — Enter-while-busy must not start a second one
  const body = new FormData(form);
  if (submitter?.name === "message") body.append("message", submitter.value);
  const mine = (controller = new AbortController());
  const transcript = document.getElementById("transcript");
  const el = getComputedStyle(transcript).overflowY === "visible" ? document.scrollingElement : transcript;
  try {
    const opts = { method: "POST", body, headers: { accept: "application/x-ndjson" }, signal: mine.signal };
    const reader = (await fetch(form.action, opts)).body.getReader();
    const decoder = new TextDecoder("utf-8", { stream: true });
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) if (line) apply(line, el, near(el));
    }
  } catch (err) {
    if (err.name !== "AbortError") await restoreComposer();
  } finally {
    if (controller === mine) controller = null; // don't drop a newer run's controller
  }
};

document.addEventListener("submit", (event) => {
  if (event.target.id !== "composer") return;
  event.preventDefault();
  run(event.target, event.submitter);
});
document.addEventListener("keydown", (event) => {
  if (event.target.dataset?.slot !== "input" || event.key !== "Enter" || event.shiftKey || event.target.readOnly) return;
  event.preventDefault();
  event.target.form.requestSubmit();
});
document.addEventListener("click", (event) => {
  if (event.target.closest?.('[data-slot="stop"]')) { controller?.abort(); restoreComposer(); }
});
{ const t = document.getElementById("transcript"); (getComputedStyle(t).overflowY === "visible" ? document.scrollingElement : t).scrollTop = 1e9; }
