#!/usr/bin/env node

import { execFile, execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

import { compact, isObject, noticeKinds, noticeView } from "./lib/codex-notifications.ts";
import type { JsonObject, Notice, NoticeKind } from "./lib/codex-notifications.ts";
import { bridgeRequest, startObserver } from "./lib/codex-bridge.ts";
export { compact } from "./lib/codex-notifications.ts";

type WindowTarget = {
  address: string;
  pid: number;
  stableId: string | number;
};

type TmuxTarget = {
  socket: string;
  pane: string;
  pane_pid: number;
  client: string;
  client_pid: number;
};

export type NotificationTarget = {
  window: WindowTarget;
  tmux?: TmuxTarget;
  herdr?: HerdrTarget;
};

type HerdrTarget = {
  session: string;
  pane: string;
  thread: string;
};

type TmuxPane = {
  pid: number;
  session: string;
  window: string;
};

type TmuxClient = [pid: string, name: string, session: string, activity: string];

function commandOutput(program: string, ...args: string[]): string {
  return execFileSync(program, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 3_000,
  }).trim();
}

export function* parentPids(initialPid: number): Generator<number> {
  const seen = new Set<number>();
  let pid = initialPid;
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    yield pid;
    try {
      // comm may contain spaces and parentheses; ppid follows the final ')'.
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
      pid = Number.parseInt(fields[1], 10);
    } catch {
      return;
    }
  }
}

function parseClients(value: string): JsonObject[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new TypeError("clients: expected a JSON array");
  return parsed.filter(isObject);
}

export function windowForProcess(clients: JsonObject[], pid: number): WindowTarget | undefined {
  for (const parent of parentPids(pid)) {
    const matches = clients.filter((client) => client.pid === parent);
    if (matches.length > 1) return undefined;
    if (matches.length === 1) {
      const [window] = matches;
      if (
        typeof window.address === "string" &&
        typeof window.pid === "number" &&
        (typeof window.stableId === "string" || typeof window.stableId === "number")
      ) {
        return { address: window.address, pid: window.pid, stableId: window.stableId };
      }
      return undefined;
    }
  }
  return undefined;
}

function tmuxPane(socket: string, pane: string): TmuxPane {
  const fields = commandOutput(
    "tmux",
    "-S",
    socket,
    "display-message",
    "-p",
    "-t",
    pane,
    "#{pane_pid}\t#{session_id}\t#{window_id}",
  ).split("\t");
  return { pid: Number.parseInt(fields[0], 10), session: fields[1], window: fields[2] };
}

function tmuxClients(socket: string): TmuxClient[] {
  const output = commandOutput(
    "tmux",
    "-S",
    socket,
    "list-clients",
    "-F",
    "#{client_pid}\t#{client_name}\t#{session_id}\t#{client_activity}",
  );
  if (!output) return [];
  return output.split("\n").map((line) => line.split("\t") as TmuxClient);
}

function herdrPaneHasThread(session: string, pane: string, thread: string): boolean {
  try {
    const screen = commandOutput("herdr", "--session", session, "pane", "read", pane, "--source", "visible", "--lines", "8");
    // Codex displays its thread ID in the bottom status line; older output may mention other threads.
    return screen.split("\n").slice(-8).some((line) => line.includes(thread));
  } catch {
    return false;
  }
}

function herdrOrigins(thread: string): HerdrTarget[] {
  const sessions: unknown = JSON.parse(commandOutput("herdr", "session", "list", "--json"));
  if (!isObject(sessions) || !Array.isArray(sessions.sessions)) return [];
  const matches: HerdrTarget[] = [];

  for (const sessionInfo of sessions.sessions) {
    if (!isObject(sessionInfo) || sessionInfo.running !== true || typeof sessionInfo.name !== "string") continue;
    const session = sessionInfo.name;
    let response: unknown;
    try {
      response = JSON.parse(commandOutput("herdr", "--session", session, "api", "snapshot"));
    } catch {
      continue;
    }
    if (!isObject(response) || !isObject(response.result) || !isObject(response.result.snapshot)) continue;
    const agents = response.result.snapshot.agents;
    if (!Array.isArray(agents)) continue;

    for (const agent of agents) {
      if (!isObject(agent) || agent.agent !== "codex" || typeof agent.pane_id !== "string") continue;
      const pane = agent.pane_id;
      if (!herdrPaneHasThread(session, pane, thread)) continue;

      matches.push({ session, pane, thread });
    }
  }
  return matches;
}

function herdrSessionWindow(clients: JsonObject[], session: string): WindowTarget | undefined {
  // Herdr's persistent pane processes belong to its server, not its attached GUI.
  const matches = clients.filter((client) => client.class === `org.omarchy.herdr-${session}`);
  if (matches.length !== 1) return undefined;
  const [window] = matches;
  if (typeof window.address !== "string" || typeof window.pid !== "number" || (typeof window.stableId !== "string" && typeof window.stableId !== "number")) return undefined;
  return { address: window.address, pid: window.pid, stableId: window.stableId };
}

function herdrNotificationTarget(clients: JsonObject[], thread: string): NotificationTarget | null | undefined {
  const origins = herdrOrigins(thread);
  if (!origins.length) return undefined;
  if (origins.length !== 1) return null;
  const origin = origins[0];
  const { session, pane } = origin;
  const attached = herdrSessionWindow(clients, session);
  if (attached) return { window: attached, herdr: origin };
  let processResponse: unknown;
  try {
    processResponse = JSON.parse(commandOutput("herdr", "--session", session, "pane", "process-info", "--pane", pane));
  } catch {
    return null;
  }
  if (!isObject(processResponse) || !isObject(processResponse.result) || !isObject(processResponse.result.process_info)) return null;
  const processes = processResponse.result.process_info.foreground_processes;
  if (!Array.isArray(processes)) return null;
  const codex = processes.find((process) => isObject(process) && process.name === "codex" && typeof process.pid === "number");
  if (!isObject(codex) || typeof codex.pid !== "number") return null;
  const window = windowForProcess(clients, codex.pid);
  return window ? { window, herdr: origin } : null;
}

export function notificationTarget(payload?: JsonObject): NotificationTarget | undefined {
  try {
    const clients = parseClients(commandOutput("hyprctl", "clients", "-j"));
    const thread = payload?.["thread-id"];
    if (typeof thread === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(thread)) {
      try {
        const herdr = herdrNotificationTarget(clients, thread);
        if (herdr === null) return undefined;
        if (herdr) return herdr;
      } catch {
        // Codex can also run in terminals without Herdr installed or running.
      }
    }
    if (process.env.TMUX && process.env.TMUX_PANE) {
      const socket = process.env.TMUX.split(",").slice(0, -2).join(",");
      const pane = process.env.TMUX_PANE;
      const info = tmuxPane(socket, pane);
      const attached = tmuxClients(socket).sort((left, right) => Number(right[3]) - Number(left[3]));
      for (const [pid, name, session] of attached) {
        if (session !== info.session) continue;
        const window = windowForProcess(clients, Number.parseInt(pid, 10));
        if (window) {
          return {
            window,
            tmux: {
              socket,
              pane,
              pane_pid: info.pid,
              client: name,
              client_pid: Number.parseInt(pid, 10),
            },
          };
        }
      }
      return undefined;
    }
    const window = windowForProcess(clients, process.pid);
    return window ? { window } : undefined;
  } catch {
    // Notifications still arrive when no unambiguous local window is available.
    return undefined;
  }
}

function isNotificationTarget(value: unknown): value is NotificationTarget {
  if (!isObject(value) || !isObject(value.window)) return false;
  const window = value.window;
  const validWindow = (
    typeof window.address === "string" &&
    typeof window.pid === "number" &&
    (typeof window.stableId === "string" || typeof window.stableId === "number")
  );
  if (!validWindow) return false;
  if (value.herdr === undefined) return true;
  return isObject(value.herdr) &&
    typeof value.herdr.session === "string" && /^[a-zA-Z0-9_-]+$/.test(value.herdr.session) &&
    typeof value.herdr.pane === "string" && /^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/.test(value.herdr.pane) &&
    typeof value.herdr.thread === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.herdr.thread);
}

export function focusNotification(target: unknown): number {
  if (!isNotificationTarget(target)) return 0;
  try {
    const clients = parseClients(commandOutput("hyprctl", "clients", "-j"));
    const currentWindow = clients.some(
      (client) =>
        client.address === target.window.address &&
        client.pid === target.window.pid &&
        client.stableId === target.window.stableId,
    );
    if (!currentWindow || !/^0x[0-9a-f]+$/i.test(target.window.address)) return 0;

    if (target.herdr && herdrPaneHasThread(target.herdr.session, target.herdr.pane, target.herdr.thread)) {
      try {
        commandOutput("herdr", "--session", target.herdr.session, "agent", "focus", target.herdr.pane);
      } catch {
        // A closed or detached pane must not prevent focusing its still-open window.
      }
    }

    if (target.tmux) {
      const tmux = target.tmux;
      const pane = tmuxPane(tmux.socket, tmux.pane);
      const attached = tmuxClients(tmux.socket);
      const originalClient = attached.some(
        ([pid, name]) => Number.parseInt(pid, 10) === tmux.client_pid && name === tmux.client,
      );
      if (pane.pid !== tmux.pane_pid || !originalClient) return 0;
      commandOutput("tmux", "-S", tmux.socket, "switch-client", "-c", tmux.client, "-t", pane.session);
      commandOutput("tmux", "-S", tmux.socket, "select-window", "-t", `${pane.session}:${pane.window}`);
      commandOutput("tmux", "-S", tmux.socket, "select-pane", "-t", tmux.pane);
    }

    commandOutput(
      "hyprctl",
      "dispatch",
      `hl.dsp.focus({ window = "address:${target.window.address}" })`,
    );
  } catch {
    return 0;
  }
  return 0;
}

function escapeMarkup(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function isTitleGeneration(payload: JsonObject): boolean {
  const messages = payload["input-messages"];
  if (!Array.isArray(messages) || messages.length !== 1 || typeof messages[0] !== "string") return false;
  if (!messages[0].startsWith("Generate a concise, single-line task title of at most 36 characters ")) {
    return false;
  }
  try {
    const response: unknown = JSON.parse(typeof payload["last-assistant-message"] === "string" ? payload["last-assistant-message"] : "");
    return isObject(response) && Object.keys(response).length === 1 && typeof response.title === "string";
  } catch {
    return false;
  }
}

type SendOptions = { target?: NotificationTarget; replaceId?: number; preview?: boolean };

/** Returns the native notification ID so later states can replace the same session card. */
export async function sendNotice(notice: Notice, options: SendOptions = {}): Promise<{ status: number; id?: number }> {
  const view = noticeView(notice);
  let body = escapeMarkup(view.body);
  if (body.startsWith("-")) body = `\u200b${body}`;
  const iconPath = fileURLToPath(new URL("../assets/codex-symbolic.svg", import.meta.url));
  const script = fileURLToPath(import.meta.url);
  const args = [
    "notification", "send", `--app-name=${options.preview ? "Codex Preview" : "Codex"}`,
    `--icon=${iconPath}`, `--image=${iconPath}`,
    `--urgency=${view.urgency}`, "--print-id", `--replace-id=${options.replaceId || 0}`,
    ...(options.preview ? ["--transient", "--expire-time=15000"] : []),
    view.title, body,
  ];
  if (options.preview) args.push("--action", view.action, process.execPath, script, "--preview-action");
  else if (options.target) args.push("--action", view.action, process.execPath, script, "--focus", JSON.stringify(options.target));
  else if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(notice.thread)) {
    args.push("--action", view.action, process.execPath, script, "--open-thread", notice.thread);
  } else args.push("--exec", process.execPath, script, "--focus", "null");
  try {
    const result = await runFile("omarchy", args, { encoding: "utf8", timeout: 5_000 });
    const id = Number.parseInt(result.stdout.trim(), 10);
    return { status: 0, ...(Number.isSafeInteger(id) && id > 0 ? { id } : {}) };
  } catch {
    console.error(JSON.stringify({ component: "codex-notifications", event: "delivery_failed" }));
    return { status: 1 };
  }
}

export function closeNotice(id: number): void {
  // Omarchy 4.5 keeps visible snapshots after D-Bus CloseNotification. Its dismiss
  // command accepts a summary, so withdraw only an unambiguous, ID-verified row.
  try {
    const file = join(homedir(), ".local/state/omarchy/notifications/live.json");
    if (statSync(file).size > 2 * 1024 * 1024) return;
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(value)) return;
    const rows = value.filter(isObject);
    const row = rows.find((candidate) => candidate.app === "Codex" && candidate.originalId === id);
    if (!row || typeof row.summary !== "string" || !row.summary) return;
    const summary = row.summary;
    if (rows.filter((candidate) => typeof candidate.summary === "string" && candidate.summary.includes(summary)).length !== 1) return;
    execFile("omarchy", ["notification", "dismiss", summary], { timeout: 2_000 }, () => {});
  } catch { /* A missing or changing native store leaves dismissal to the desktop. */ }
}

export async function targetIsFocused(target: NotificationTarget): Promise<boolean> {
  try {
    const active: unknown = JSON.parse((await runFile("hyprctl", ["activewindow", "-j"], { timeout: 3_000 })).stdout);
    if (!isObject(active) || active.address !== target.window.address || active.pid !== target.window.pid || active.stableId !== target.window.stableId) return false;
    if (target.tmux) return false;
    if (!target.herdr) return true;
    const snapshot: unknown = JSON.parse((await runFile("herdr", ["--session", target.herdr.session, "api", "snapshot"], { timeout: 3_000 })).stdout);
    if (!isObject(snapshot) || !isObject(snapshot.result) || !isObject(snapshot.result.snapshot)) return false;
    const agents = snapshot.result.snapshot.agents;
    return Array.isArray(agents) && agents.some((agent) => isObject(agent) && agent.pane_id === target.herdr?.pane && agent.focused === true);
  } catch { return false; }
}

export function previewNotice(kind: NoticeKind): Notice {
  const samples: Partial<Record<NoticeKind, string>> = {
    response: "A revisão está pronta. Confira os pontos encontrados e as sugestões na sessão.",
    "goal-complete": "Integração concluída. As verificações passaram e o resultado está pronto para revisão.",
    input: "Como você prefere continuar?\n1. Manter a configuração atual\n2. Aplicar a alternativa sugerida",
    failed: "Não foi possível concluir a execução. Confira o erro e o trabalho parcial antes de tentar novamente.",
  };
  return { kind, thread: "preview", cwd: "projeto-exemplo", text: samples[kind] };
}

async function watch(): Promise<number> {
  const { watchNotifications } = await import("./lib/codex-observer.ts");
  const targets = new Map<string, { target?: NotificationTarget; checkedAt: number }>();
  const ids = new Map<string, number>();
  const generation = new Map<string, number>();
  let sequence = 0;
  const resolving = new Map<string, Promise<NotificationTarget | undefined>>();
  const clear = (thread: string) => {
    generation.set(thread, ++sequence);
    const id = ids.get(thread); if (id) closeNotice(id); ids.delete(thread);
  };
  const resolveTarget = (thread: string): Promise<NotificationTarget | undefined> => {
    const existing = resolving.get(thread);
    if (existing) return existing;
    // External process/pane probes run outside the observer's IPC event loop.
    const pending = runFile(process.execPath, [fileURLToPath(import.meta.url), "--resolve-target", thread], { timeout: 10_000, maxBuffer: 32_768 })
      .then(({ stdout }) => { const value: unknown = JSON.parse(stdout); return isNotificationTarget(value) ? value : undefined; })
      .catch(() => undefined).finally(() => resolving.delete(thread));
    resolving.set(thread, pending);
    return pending;
  };
  await watchNotifications({
    async deliver(notice) {
      const token = ++sequence;
      generation.set(notice.thread, token);
      let cached = targets.get(notice.thread);
      if (!cached || Date.now() - cached.checkedAt > 30_000) {
        cached = { target: await resolveTarget(notice.thread), checkedAt: Date.now() };
        targets.set(notice.thread, cached);
        if (targets.size > 200) {
          const oldest = targets.keys().next().value!;
          targets.delete(oldest); generation.delete(oldest);
        }
      }
      if (generation.get(notice.thread) !== token) return;
      const target = cached.target;
      const focused = target && await targetIsFocused(target);
      if (generation.get(notice.thread) !== token) return;
      if (focused) { clear(notice.thread); return; }
      const result = await sendNotice(notice, { target, replaceId: ids.get(notice.thread) });
      if (result.id) {
        if (generation.get(notice.thread) !== token) closeNotice(result.id);
        else ids.set(notice.thread, result.id);
      }
    },
    closeNotice: clear,
  });
  return 0;
}

export async function main(args: string[]): Promise<number> {
  if (args.length === 1) {
    switch (args[0]) {
      case "--watch": return watch();
      case "--start": await startObserver(); return 0;
      case "--stop": await bridgeRequest({ method: "stop" }); return 0;
      case "--status": {
        const status = await bridgeRequest({ method: "status" });
        console.log(status ? `Observer ${status.connected ? "connected" : "reconnecting"}; ${status.threads} interactive sessions.` : "Observer is not running.");
        return status ? 0 : 1;
      }
      case "--preview-action": console.log("Preview only; no session was changed."); return 0;
    }
  }
  if (args.length === 2 && args[0] === "--resolve-target" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(args[1])) {
    console.log(JSON.stringify(notificationTarget({ "thread-id": args[1] }) ?? null)); return 0;
  }
  if (args.length === 2 && args[0] === "--open-thread" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(args[1])) {
    const target = notificationTarget({ "thread-id": args[1] });
    if (target) return focusNotification(target);
    let origins: HerdrTarget[] = [];
    try { origins = herdrOrigins(args[1]); } catch { /* Herdr may be unavailable. */ }
    if (origins.length > 1) return 0;
    if (origins.length === 1) {
      const origin = origins[0];
      try { commandOutput("herdr", "--session", origin.session, "agent", "focus", origin.pane); }
      catch { return 1; }
      const result = spawnSync("omarchy", ["launch", "terminal", "herdr", "--session", origin.session], { stdio: "ignore", timeout: 5_000 });
      return result.status ?? 1;
    }
    const result = spawnSync("omarchy", ["launch", "terminal", "codex", "resume", args[1]], { stdio: "ignore", timeout: 5_000 });
    return result.status ?? 1;
  }
  if (args.length === 2 && args[0] === "--preview") {
    const kinds = args[1] === "all" ? noticeKinds : noticeKinds.filter((kind) => kind === args[1]);
    if (!kinds.length) { console.error(`preview: invalid type; expected ${noticeKinds.join(", ")}, or all`); return 2; }
    for (const kind of kinds) { const result = await sendNotice(previewNotice(kind), { preview: true }); if (result.status) return result.status; console.log(`${kind}: ${result.id || "sent"}`); }
    return 0;
  }
  if (args.length === 2 && args[0] === "--focus") {
    try {
      return focusNotification(JSON.parse(args[1]));
    } catch {
      return 0;
    }
  }
  if (args.length !== 1) {
    console.error("payload: expected one JSON object argument");
    return 2;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(args[0]);
  } catch {
    console.error("payload: invalid JSON; expected an object (content omitted)");
    return 2;
  }
  if (!isObject(payload)) {
    console.error("payload: expected a JSON object (content omitted)");
    return 2;
  }
  if (payload.type !== "agent-turn-complete" || isTitleGeneration(payload)) return 0;

  for (const field of ["cwd", "last-assistant-message"]) {
    if (payload[field] !== undefined && payload[field] !== null && typeof payload[field] !== "string") {
      console.error(`${field}: invalid value; expected a string (content omitted)`);
      return 2;
    }
  }
  const coverage = await bridgeRequest({ method: "completion", payload: {
    "thread-id": payload["thread-id"], "turn-id": payload["turn-id"],
    "last-assistant-message": typeof payload["last-assistant-message"] === "string" ? compact(payload["last-assistant-message"], 500) : "",
  } });
  if (coverage?.covered === true) return 0;
  return (await sendNotice({ kind: "response", thread: typeof payload["thread-id"] === "string" ? payload["thread-id"] : "", turn: typeof payload["turn-id"] === "string" ? payload["turn-id"] : undefined, cwd: typeof payload.cwd === "string" ? payload.cwd : "", text: typeof payload["last-assistant-message"] === "string" ? payload["last-assistant-message"] : "" }, { target: notificationTarget(payload) })).status;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
