/**
 * What the pi child loads (`pi --mode rpc -e src/extension.ts`): the scripted
 * model as a provider, and the reference agent's three tools. This is the whole
 * of the agent as far as pi is concerned; the server never runs a model or a
 * tool itself.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { scriptedProvider } from "./scripted.ts";
import { TOOLS } from "./tools.ts";

export default function (pi: ExtensionAPI) {
  pi.registerProvider(scriptedProvider());
  for (const tool of TOOLS) pi.registerTool(tool);
}
