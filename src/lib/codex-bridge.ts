import { createHash } from "node:crypto";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isObject } from "./codex-notifications.ts";
import type { JsonObject } from "./codex-notifications.ts";

export function codexHome(): string { return process.env.CODEX_HOME || join(homedir(), ".codex"); }
export function bridgePath(): string {
  const identity = createHash("sha256").update(codexHome()).digest("hex").slice(0, 12);
  return join(process.env.XDG_RUNTIME_DIR || tmpdir(), `omarchy-codex-${process.getuid?.() ?? "user"}-${identity}.sock`);
}

export function bridgeRequest(message: JsonObject): Promise<JsonObject | undefined> {
  return new Promise((resolve) => {
    const socket = connect(bridgePath());
    const finish = (result?: JsonObject) => { socket.destroy(); resolve(result); };
    socket.setTimeout(1_000, () => finish());
    socket.once("error", () => finish());
    socket.once("connect", () => socket.write(JSON.stringify(message) + "\n"));
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 32_768) { finish(); return; }
      if (!buffer.includes("\n")) return;
      try { const value: unknown = JSON.parse(buffer.split("\n")[0]); finish(isObject(value) ? value : undefined); } catch { finish(); }
    });
    socket.once("end", () => finish());
  });
}

export async function startObserver(): Promise<void> {
  if (await bridgeRequest({ method: "status" })) return;
  const directory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "omarchy-scripts");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const log = openSync(join(directory, "codex-notifications.log"), "a", 0o600);
  const script = fileURLToPath(new URL("../omarchy-codex-notify.ts", import.meta.url));
  const child = spawn(process.execPath, [script, "--watch"], { detached: true, stdio: ["ignore", log, log] });
  closeSync(log);
  child.on("error", (error) => console.error(`observer: ${error.message}`));
  child.unref();
}
