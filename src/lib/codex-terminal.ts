import { basename } from "node:path";
import { codexHome } from "./codex-bridge.ts";
import { CodexRpc } from "./codex-rpc.ts";
import { isObject } from "./codex-notifications.ts";
import type { JsonObject } from "./codex-notifications.ts";

const terminalClasses = new Set(["Alacritty", "kitty", "foot", "footclient", "com.mitchellh.ghostty", "Ghostty"]);

/** The daemon owns hook processes; match standalone TUIs by their unique task title instead. */
export async function terminalThreadWindow(clients: JsonObject[], thread: string) {
  const terminals = clients.filter((client) => typeof client.class === "string" && terminalClasses.has(client.class) && typeof client.title === "string");
  if (!terminals.length) return undefined;
  const rpc = new CodexRpc(codexHome());
  try {
    await rpc.initialize();
    const threads: JsonObject[] = [];
    let cursor: string | undefined;
    do {
      const page = await rpc.request("thread/loaded/list", { limit: 100, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page.data)) return undefined;
      const metadata = await Promise.all(page.data.filter((id): id is string => typeof id === "string").map((id) => rpc.request("thread/read", { threadId: id })));
      threads.push(...metadata.flatMap((value) => isObject(value.thread) ? [value.thread] : []));
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
    } while (cursor);
    const origin = threads.find((candidate) => candidate.id === thread);
    if (!origin || typeof origin.name !== "string" || !origin.name || typeof origin.cwd !== "string") return undefined;
    const title = `${origin.name} | ${basename(origin.cwd)}`;
    const sameTitle = threads.filter((candidate) => typeof candidate.cwd === "string" && `${candidate.name} | ${basename(candidate.cwd)}` === title);
    if (sameTitle.length !== 1) return undefined;
    // Codex prepends a braille spinner while working; the remainder is unchanged.
    const matches = terminals.filter((client) => String(client.title).replace(/^[\u2800-\u28ff]\s*/, "") === title);
    if (matches.length !== 1) return undefined;
    const [window] = matches;
    if (typeof window.address !== "string" || typeof window.pid !== "number" || (typeof window.stableId !== "string" && typeof window.stableId !== "number")) return undefined;
    return { address: window.address, pid: window.pid, stableId: window.stableId };
  } finally {
    rpc.close();
  }
}
