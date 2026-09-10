#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

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

type NotificationTarget = {
  window: WindowTarget;
  tmux?: TmuxTarget;
};

type TmuxPane = {
  pid: number;
  session: string;
  window: string;
};

type TmuxClient = [pid: string, name: string, session: string, activity: string];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export function notificationTarget(): NotificationTarget | undefined {
  try {
    const clients = parseClients(commandOutput("hyprctl", "clients", "-j"));
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
  return (
    typeof window.address === "string" &&
    typeof window.pid === "number" &&
    (typeof window.stableId === "string" || typeof window.stableId === "number")
  );
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

export function compact(text: string, limit: number): string {
  const normalized = text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim().replace(/\s+/g, " ");
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}…`;
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

function sendNotification(payload: JsonObject): number {
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  const response = typeof payload["last-assistant-message"] === "string" ? payload["last-assistant-message"] : "";
  const project = compact(basename(cwd), 70);
  const title = `Codex terminou${project ? ` · ${project}` : ""}`;
  let body = compact(response, 240) || "Resposta pronta. Volte ao terminal quando quiser.";
  // Keep dash-leading model output from being parsed as an Omarchy CLI option.
  if (body.startsWith("-")) body = `\u200b${body}`;
  const iconPath = "/usr/share/icons/hicolor/256x256/apps/codex-desktop.png";
  const script = fileURLToPath(import.meta.url);
  const target = JSON.stringify(notificationTarget() ?? null);
  const args = [
    "notification",
    "send",
    "--app-name=Codex",
    `--icon=${existsSync(iconPath) ? iconPath : "codex-desktop"}`,
    "--urgency=normal",
    title,
    escapeMarkup(body),
    "--exec",
    process.execPath,
    script,
    "--focus",
    target,
  ];
  const result = spawnSync("omarchy", args, { stdio: "inherit", timeout: 10_000 });
  if (result.error) {
    console.error(`omarchy: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export function main(args: string[]): number {
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
  return sendNotification(payload);
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
