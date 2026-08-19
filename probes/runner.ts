// Executes a parsed flow against one frontend. Every step resolves through the
// adapter, so this file contains no selectors and never needs to know which
// stack it is driving.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { Flow, Step } from "./flow.ts";
import type { Frontend } from "./frontends.ts";

/** Long enough for the deliberately-slow analyze tool (~3s) plus stream. */
const REPLY_TIMEOUT = 30_000;
const SETTLE = 400;

export type Shot = { label: string; path: string; step: string };

export class Runner {
  readonly shots: Shot[] = [];
  /** User messages on screen at the moment of the last reload — what a cell
   *  that declares `resumes` has to put back. */
  private usersAtReload: number | null = null;

  constructor(
    private readonly page: Page,
    private readonly frontend: Frontend,
    private readonly flow: Flow,
    /** Where this run's captures go: artifacts/<backend>/<flow>, composed by
     *  matrix.spec.ts so the layout is decided in one place rather than here. */
    private readonly captureDir: string,
  ) {}

  private get a() {
    return this.frontend.adapter;
  }

  async run(): Promise<void> {
    for (const [i, step] of this.flow.steps.entries()) {
      await this.step(step, this.flow.source[i]);
    }
  }

  /** The call for one named tool, however this stack spells that. */
  private toolNamed(tool: string) {
    return (
      this.a.toolNamed?.(this.page, tool) ?? this.a.toolCalls(this.page).filter({ hasText: tool })
    );
  }

  private async step(step: Step, source: string): Promise<void> {
    const { page } = this;

    switch (step.kind) {
      case "open": {
        await page.goto(this.frontend.url, { waitUntil: "networkidle" });
        // The composer mounts client-side; waiting on it is the honest "ready".
        await this.a.composer(page).first().waitFor({ state: "visible", timeout: 20_000 });
        await page.waitForTimeout(SETTLE);
        return;
      }

      case "ask": {
        const users = this.a.userMessages(page);
        const assistants = this.a.assistantMessages(page);
        const [usersBefore, assistantsBefore] = [await users.count(), await assistants.count()];

        const composer = this.a.composer(page).first();
        await composer.click();
        await composer.fill(step.text);
        await page.keyboard.press("Enter");

        // Confirm the send registered. Without this a follow-up turn can be
        // typed while the previous run is still streaming, where the composer
        // silently drops it — the message never appears and the failure shows
        // up three steps later as a wrong message count.
        await expect
          .poll(() => users.count(), { timeout: 15_000 })
          .toBeGreaterThan(usersBefore);

        // Then wait for the run to actually be underway, so a later
        // "wait for the reply" can't satisfy itself with the idle state left
        // over from the previous turn. Either tell will do: a visible busy
        // affordance, or a new assistant node if the stack got there first.
        await expect
          .poll(
            async () =>
              (await this.a.stop(page).count()) > 0 ||
              (await assistants.count()) > assistantsBefore,
            { timeout: 15_000 },
          )
          .toBe(true);
        return;
      }

      case "suggestion": {
        await page.getByRole("button", { name: step.text, exact: false }).first().click();
        return;
      }

      case "waitForToolCall": {
        await this.a
          .toolCalls(page)
          .first()
          .waitFor({ state: "visible", timeout: REPLY_TIMEOUT });
        return;
      }

      case "waitForReply": {
        // Both conditions matter: an assistant node is mounted before it has any
        // text in it, so "idle" alone can mean "an empty bubble is on screen".
        await expect
          .poll(
            async () =>
              (await this.a.stop(page).count()) === 0 &&
              ((await this.a.assistantMessages(page).last().innerText().catch(() => "")) ?? "")
                .trim().length > 0,
            { timeout: REPLY_TIMEOUT },
          )
          .toBe(true);
        await page.waitForTimeout(SETTLE);
        return;
      }

      case "expandToolCall": {
        await this.a.expandToolCall?.(page);
        await page.waitForTimeout(SETTLE);
        return;
      }

      case "expectToolFor": {
        await expect(this.toolNamed(step.tool).first(), source).toBeVisible();
        return;
      }

      case "expectToolCount": {
        await expect.poll(() => this.a.toolCalls(page).count(), { timeout: 5_000 }).toBe(step.count);
        return;
      }

      case "expectMention": {
        await expect(this.a.transcript(page), source).toContainText(step.text, {
          timeout: REPLY_TIMEOUT,
        });
        return;
      }

      case "expectMessages": {
        const locator =
          step.role === "user" ? this.a.userMessages(page) : this.a.assistantMessages(page);
        await expect.poll(() => locator.count(), { timeout: 10_000 }).toBe(step.count);
        return;
      }

      case "expectBusy": {
        const busy = async () => (await this.a.stop(page).count()) > 0;
        await expect.poll(busy, { timeout: 10_000 }).toBe(step.busy);
        return;
      }

      case "expectDeclaredResume": {
        if (this.usersAtReload === null) {
          throw new Error(`probes: "${source}" only means something after "reload the page".`);
        }
        const before = this.usersAtReload;
        const declared = this.a.resumes === true;
        const plural = before === 1 ? "message" : "messages";
        const message = declared
          ? `${this.frontend.name} declares resumes: true in probes/frontends.ts, so the ` +
            `${before} user ${plural} sent before the reload should still be on screen.`
          : `${this.frontend.name} does not declare resumes in probes/frontends.ts, so the ` +
            `transcript should be empty after a reload; if it now rehydrates, declare it there.`;
        await expect
          .poll(() => this.a.userMessages(page).count(), { timeout: 10_000, message })
          .toBe(declared ? before : 0);
        return;
      }

      case "reload": {
        // Read the transcript before it goes away: the resume assertion is
        // against what was on screen, not against a number written in the flow.
        this.usersAtReload = await this.a.userMessages(page).count();
        await page.reload({ waitUntil: "networkidle" });
        await this.a.composer(page).first().waitFor({ state: "visible", timeout: 20_000 });
        await page.waitForTimeout(1_500);
        return;
      }

      case "capture": {
        mkdirSync(this.captureDir, { recursive: true });
        const path = join(this.captureDir, `${step.label}--${this.frontend.name}.png`);
        await page.screenshot({ path });
        this.shots.push({ label: step.label, path, step: source });
        return;
      }
    }
  }
}
