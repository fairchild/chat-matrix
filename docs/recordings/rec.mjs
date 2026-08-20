// Shared plumbing for the recorders beside it, so a recording is a script about
// its beats and nothing else.
//
// It exists because the two recorders here were each written in one sitting
// against one checkout and hardcoded it: an absolute import of Playwright, an
// absolute output directory, an absolute scratch path belonging to the session
// that wrote them, and /opt/homebrew paths for ffmpeg. All four were true on the
// machine that ran them once, and none survived the directory being renamed —
// both scripts were committed in a state that could not run from a fresh clone.
// Every path below is derived from this file's own location or from PATH.
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
/** Recordings live beside this file; they're committed, and the pages embed them. */
export const OUT_DIR = HERE;

/** A fresh directory per run, under the OS temp dir rather than a session's. */
export const scratch = () => mkdtempSync(join(tmpdir(), "chat-matrix-rec-"));

/** Playwright comes from probes/, the one place in the repo that installs it.
 *  Resolved through this file's location so the recorder runs from any cwd —
 *  a bare specifier would resolve from docs/recordings/, which has no
 *  node_modules and no package.json to lead anywhere. */
const playwrightEntry = join(ROOT, "probes", "node_modules", "playwright", "index.js");
let loaded;
try {
  loaded = await import(pathToFileURL(playwrightEntry).href);
} catch {
  throw new Error(`recorders need Playwright from probes/ — run ./scripts/setup.sh (looked in ${playwrightEntry})`);
}
export const { chromium } = loaded;

const run = (bin, args, options) => {
  try {
    return execFileSync(bin, args, options);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${bin} is not on PATH — brew install ffmpeg`);
    throw error;
  }
};

/** One or more webm files to a palette-quantized gif, and report what came out.
 *  `colors` is the knob worth touching per recording: a UI with tool cards and
 *  syntax colour needs more of them than a hub with two greys. */
export function toGif(videos, name, { fps = 12, colors = 160, width = 900 } = {}) {
  const gifPath = join(OUT_DIR, `${name}.gif`);
  const filter =
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1]` +
    `;[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`;

  // One video is an input; several are a concat list, which ffmpeg reads from a
  // file rather than argv.
  const input =
    videos.length === 1
      ? ["-i", videos[0]]
      : (() => {
          const list = join(scratch(), "list.txt");
          writeFileSync(list, videos.map((v) => `file '${v}'\n`).join(""));
          return ["-f", "concat", "-safe", "0", "-i", list];
        })();

  run("ffmpeg", ["-y", ...input, "-vf", filter, gifPath], { stdio: "inherit" });

  const mb = (statSync(gifPath).size / 1024 / 1024).toFixed(2);
  const seconds = run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    gifPath,
  ]).toString().trim();
  console.log(`gif: ${gifPath} (${mb} MB, ${seconds}s)`);
  return gifPath;
}
