// The hub, driven. Everything else in probes/ drives a cell; nothing drove the
// page that sends you to one, which made it the most conditional file in the
// repo with the least evidence behind it — it renders a 4×5 grid from two
// config files, probes every backend's health, carries the chosen backend into
// each link, and renders a different shape entirely once HOSTED is filled in.
//
// These assertions are about the wiring, not the styling: that every square the
// grid claims is live actually opens something, that the backend a column names
// is the backend its links carry, that a published build offers nothing it
// can't serve, and that the pages the hub links exist. That last one is the
// regression this whole publish arc was blocked on — `build_index` used to ship
// index.html alone, so two cards on the landing page 404'd.
//
// Runs against whatever the rest of probes/ is pointed at: the local matrix on
// :3000, or the hosted preview on :4000 with PROBE_PORT_OFFSET=1000.
import { expect, test } from "@playwright/test";
import { hubUrl, isPreview, matrixOrder } from "./frontends.ts";

const HUB = hubUrl();

test.describe("hub", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HUB, { waitUntil: "networkidle" });
    // The grid renders immediately and then fills in from one /health probe per
    // backend. Waiting for the readout to stop saying it's checking is waiting
    // for that second pass; every assertion below is about the settled grid.
    await expect(page.locator("#readout .pair")).toHaveText(/squares live/, { timeout: 30_000 });
  });

  test("every backend and frontend in stacks.sh has a square", async ({ page }) => {
    const { cells, backends } = matrixOrder();
    // OUTSIDE cells (jinja) sit in their own band with no backend axis, so the
    // grid is only the ones that have one. Asking the page which rows it drew
    // rather than assuming five keeps this honest when a cell moves out.
    const rows = await page.locator("tbody tr").count();
    for (const b of backends) expect(await page.locator(`th.b:has-text("${b}")`).count()).toBeGreaterThan(0);
    for (const f of cells.slice(0, rows)) {
      for (const b of backends) {
        await expect(page.locator(`#sq-${f}-${b}`), `square ${f} × ${b}`).toHaveCount(1);
      }
    }
  });

  test("a live square opens its own frontend with its own column's backend", async ({ page }) => {
    const live: { href: string; backend: string }[] = [];
    for (const sq of await page.locator("td .sq").all()) {
      const href = await sq.getAttribute("href");
      if (href) live.push({ href, backend: ((await sq.locator(".on").textContent()) ?? "").trim() });
    }
    expect(live.length, "no square is live — is the matrix up?").toBeGreaterThan(0);

    for (const { href, backend } of live) {
      // Every link carries an explicit ?backend=, including the first column.
      // It used to be omitted there because the first backend happened to match
      // the cells' own build-time default, which made the hub's choice look
      // like it was working when it was only ever agreeing.
      const carried = new URL(href, HUB).searchParams.get("backend");
      expect(carried, `${href} carries no ?backend=`).toBeTruthy();
      // The column says which backend it is; the link has to agree with it.
      const res = await page.request.get(`${carried}/health`);
      expect(res.ok(), `${carried}/health for the ${backend} column`).toBeTruthy();
      expect((await res.json()).backend).toBe(backend);
    }
  });

  test("the pages the hub links are all served", async ({ page }) => {
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? "").filter((h) => h !== ""));
    // Relative links only: the doc links point at the repo host, and a square's
    // link is a whole frontend that the other spec already drives.
    const local = [...new Set(hrefs.filter((h) => !/^https?:/.test(h) && !h.startsWith("#")))];
    expect(local.length, "the hub links nothing of its own").toBeGreaterThan(0);
    for (const href of local) {
      const res = await page.request.get(new URL(href, HUB).toString());
      expect(res.status(), `${href} from the hub`).toBeLessThan(400);
    }
  });

  test("a hosted build offers only what it can serve", async ({ page }) => {
    test.skip(!isPreview(), "a local run serves the whole matrix, so nothing is withheld");

    // An unhosted backend keeps its column and says `local` rather than
    // vanishing — the grid is the argument, and a square you can't click is
    // still a row in it. What it must not do is hand out a link to a process
    // that isn't there.
    const marks = await page.locator("td .sq .mark").allTextContents();
    expect(marks.filter((m) => m.trim() === "local").length).toBeGreaterThan(0);
    for (const sq of await page.locator("td .sq").all()) {
      const mark = (await sq.locator(".mark").textContent())?.trim();
      if (mark === "local") expect(await sq.getAttribute("href"), "a local square is a link").toBeNull();
    }

    // And no link anywhere on a published page may point at a developer's
    // machine. Under preview the cells legitimately are on localhost, so the
    // check is scoped to the links the hub owns rather than the squares.
    const own = await page
      .locator("#nav a, #footer a, .page")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? "").filter((h) => h !== ""));
    expect(own.filter((h) => /localhost|127\.0\.0\.1/.test(h))).toEqual([]);
  });

  test("a column states its model, and states it as fixed when the backend says so", async ({ page }) => {
    const shown = page.locator("th.b select.model:visible");
    expect(await shown.count(), "no backend offered a model at all").toBeGreaterThan(0);

    // Counted, and asserted at the end. Every escape hatch below is a column
    // this test couldn't reach, and a version of it that could skip its way to
    // green would report a broken hub as a passing one — which is exactly what
    // it did the first time it was run against a mutant.
    let checked = 0;
    for (const select of await shown.all()) {
      const column = await select.evaluate((el) => el.closest("th")?.dataset.c ?? "");
      const name = (await page.locator(`th.b[data-c="${column}"] .name`).textContent())?.trim();
      expect(await select.inputValue(), `${name} shows no current model`).toBeTruthy();

      // The backend's URL isn't on the page as data, so it's read back out of a
      // live square in the same column — the same `?backend=` the other spec
      // asserts the links carry. A column whose frontends are all down has no
      // square to read, which is the one case with genuinely nothing to check.
      const square = page.locator(`td[data-c="${column}"] .sq[href]`).first();
      if (!(await square.count())) continue;

      // Having found a live square, its backend must be resolvable: this is the
      // hub's own invariant, so failing to read it is a failure, not a skip.
      const href = (await square.getAttribute("href")) ?? "";
      const backend = new URL(href, HUB).searchParams.get("backend");
      expect(backend, `${name} has a live square (${href}) carrying no ?backend=`).toBeTruthy();

      // `locked` is the backend's own claim, so the page is checked against the
      // backend rather than against an expectation hard-coded here: whichever
      // way the deployment is configured, the control has to say the same thing
      // the API does.
      const models = await (await page.request.get(`${backend}/models`)).json();
      expect(await select.isDisabled(), `${name} control vs /models locked=${models.locked}`).toBe(
        Boolean(models.locked),
      );
      expect(await select.getAttribute("class")).toContain(models.locked ? "fixed" : "model");
      expect(await select.inputValue()).toBe(models.current);
      checked += 1;
    }
    expect(checked, "no column could be checked — this test proved nothing").toBeGreaterThan(0);
  });
});
