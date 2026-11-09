import { chmodSync, unlinkSync } from "node:fs";
import { connect, createServer } from "node:net";
import type { Server } from "node:net";
import { bridgePath, codexHome } from "./codex-bridge.ts";
import { CodexRpc } from "./codex-rpc.ts";
import { goalKind, isObject, questionText } from "./codex-notifications.ts";
import type { JsonObject, Notice, NoticeKind } from "./codex-notifications.ts";

export type ThreadState = {
  cwd: string;
  goal?: string;
  goalChanged?: boolean;
  turn?: string;
  text?: string;
  running: boolean;
  waiting?: NoticeKind;
  pending?: NoticeKind;
  timer?: NodeJS.Timeout;
  last?: string;
  subscribed?: boolean;
  refresh?: NodeJS.Timeout;
};

type ObserverOptions = { home?: string; socketPath?: string; deliver: (notice: Notice) => void | Promise<void>; closeNotice: (thread: string) => void; delay?: number };

/** Observes only already-loaded interactive roots. It never starts work or answers server requests. */
export class CodexObserver {
  readonly threads = new Map<string, ThreadState>();
  private rpc?: CodexRpc;
  private ignored = new Set<string>();
  private connected = false;
  private stopped = false;
  private retry?: NodeJS.Timeout;
  private backoff = 1_000;
  private readonly options: ObserverOptions;

  constructor(options: ObserverOptions) { this.options = options; }

  async start(): Promise<void> {
    if (this.stopped) return;
    const rpc = new CodexRpc(this.options.home || codexHome());
    this.rpc = rpc;
    rpc.on("event", (event: JsonObject) => { void this.handleEvent(event).catch(() => this.log("event_failed")); });
    rpc.once("disconnected", () => {
      this.connected = false;
      for (const state of this.threads.values()) { clearTimeout(state.timer); clearTimeout(state.refresh); }
      this.threads.clear(); this.ignored.clear();
      if (!this.stopped) {
        this.retry = setTimeout(() => { void this.start(); }, this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30_000);
      }
    });
    try {
      await rpc.initialize();
      this.connected = true;
      this.backoff = 1_000;
      let cursor: string | undefined;
      do {
        const page = await rpc.request("thread/loaded/list", { limit: 100, ...(cursor ? { cursor } : {}) });
        const ids = Array.isArray(page.data) ? page.data.filter((id): id is string => typeof id === "string") : [];
        await Promise.all(ids.map((id) => this.track(id)));
        cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
      } while (cursor && !this.stopped);
      this.log("connected");
    } catch {
      this.log("connection_unavailable");
      rpc.close();
    }
  }

  private log(event: string): void { console.error(JSON.stringify({ component: "codex-notifications", event })); }

  private async track(id: string, metadata?: JsonObject): Promise<void> {
    if (this.threads.has(id) || this.ignored.has(id) || !this.rpc) return;
    // Reserve before awaiting so global status events can find this thread.
    const state: ThreadState = { cwd: "", running: false };
    this.threads.set(id, state);
    try {
      const result = metadata ? { thread: metadata } : await this.rpc.request("thread/read", { threadId: id });
      const thread = result.thread;
      if (!isObject(thread) || thread.parentThreadId || thread.ephemeral === true || !["cli", "vscode", "appServer"].includes(String(thread.source))) {
        this.threads.delete(id); this.ignored.add(id);
        if (this.ignored.size > 200) this.ignored.delete(this.ignored.values().next().value!);
        return;
      }
      state.cwd = typeof thread.cwd === "string" ? thread.cwd : "";
      state.running = isObject(thread.status) && thread.status.type === "active";
      const goal = await this.rpc.request("thread/goal/get", { threadId: id });
      state.goal = isObject(goal.goal) && typeof goal.goal.status === "string" ? goal.goal.status : undefined;
      if (isObject(thread.status) && Array.isArray(thread.status.activeFlags) && thread.status.activeFlags.length) {
        await this.handleEvent({ method: "thread/status/changed", params: { threadId: id, status: thread.status } });
      }
    } catch { this.threads.delete(id); }
  }

  status(): JsonObject { return { connected: this.connected, threads: this.threads.size }; }

  legacy(payload: JsonObject): boolean {
    const id = payload["thread-id"];
    if (!this.connected || typeof id !== "string") return false;
    if (this.ignored.has(id)) return true;
    const state = this.threads.get(id);
    if (!state) return false;
    if (typeof payload["last-assistant-message"] === "string") state.text = payload["last-assistant-message"];
    if (typeof payload["turn-id"] === "string") state.turn = payload["turn-id"];
    // The authoritative turn/completed event decides success, interruption or failure.
    return true;
  }

  private async refreshTurn(id: string, state: ThreadState, attempt = 0): Promise<void> {
    if (!this.rpc || this.stopped || state.running) return;
    try {
      const [page, goal] = await Promise.all([
        this.rpc.request("thread/turns/list", { threadId: id, limit: 1, sortDirection: "desc", itemsView: "summary" }),
        this.rpc.request("thread/goal/get", { threadId: id }),
      ]);
      if (!state.running) {
        const status = isObject(goal.goal) && typeof goal.goal.status === "string" ? goal.goal.status : undefined;
        if (status !== state.goal) state.goalChanged = true;
        state.goal = status;
      }
      const turn = Array.isArray(page.data) ? page.data.find(isObject) : undefined;
      if (!turn) return;
      if (turn.status === "inProgress" && attempt < 2) {
        state.refresh = setTimeout(() => { void this.refreshTurn(id, state, attempt + 1); }, 200 * 3 ** attempt);
        return;
      }
      if (state.running || this.threads.get(id) !== state) return;
      await this.handleEvent({ method: "turn/completed", params: { threadId: id, turn } });
    } catch { this.log("turn_read_failed"); }
  }

  private schedule(id: string, state: ThreadState, kind: NoticeKind): void {
    clearTimeout(state.timer);
    state.pending = kind;
    state.timer = setTimeout(() => {
      const pending = state.pending;
      state.pending = undefined;
      if (!pending || this.stopped) return;
      const key = `${state.turn || ""}:${pending}`;
      if (state.last === key) return;
      state.last = key;
      const notice = { kind: pending, thread: id, turn: state.turn, cwd: state.cwd, text: ["response", "goal-complete", "input", "failed"].includes(pending) ? state.text : undefined };
      void Promise.resolve().then(() => this.options.deliver(notice)).catch(() => this.log("delivery_failed"));
    }, this.options.delay ?? 500);
  }

  async handleEvent(event: JsonObject): Promise<void> {
    const params = event.params;
    if (!isObject(params)) return;
    if (event.method === "thread/started" && isObject(params.thread) && typeof params.thread.id === "string") {
      await this.track(params.thread.id, params.thread); return;
    }
    const id = params.threadId;
    if (typeof id !== "string") return;
    if (event.method === "thread/closed") this.ignored.delete(id);
    const state = this.threads.get(id);
    if (!state) return;
    if (typeof params.turnId === "string") state.turn = params.turnId;
    if (event.method === "thread/closed" || event.method === "thread/archived" || event.method === "thread/deleted") {
      clearTimeout(state.timer); clearTimeout(state.refresh); this.threads.delete(id); return;
    }
    if (event.method === "turn/started" && isObject(params.turn)) {
      clearTimeout(state.timer);
      state.turn = typeof params.turn.id === "string" ? params.turn.id : undefined;
      state.text = undefined; state.running = true; state.waiting = undefined; state.pending = undefined; state.last = undefined; state.goalChanged = false;
      this.options.closeNotice(id); return;
    }
    if (event.method === "thread/goal/cleared") { state.goal = undefined; state.goalChanged = false; return; }
    if (event.method === "thread/goal/updated" && isObject(params.goal)) {
      const status = params.goal.status;
      if (typeof status !== "string" || status === state.goal) return;
      state.goal = status; state.goalChanged = true;
      const kind = goalKind(status);
      if (kind && !state.running) this.schedule(id, state, kind);
      else if (status === "active") { clearTimeout(state.timer); state.pending = undefined; state.last = undefined; this.options.closeNotice(id); }
      return;
    }
    if (event.method === "thread/status/changed" && isObject(params.status)) {
      const flags = Array.isArray(params.status.activeFlags) ? params.status.activeFlags : [];
      const waiting = flags.includes("waitingOnApproval") ? "approval" : flags.includes("waitingOnUserInput") ? "input" : undefined;
      const running = params.status.type === "active";
      const wasRunning = state.running;
      if (running && !state.running) {
        clearTimeout(state.timer); clearTimeout(state.refresh);
        state.turn = undefined; state.text = undefined; state.last = undefined; state.pending = undefined; state.goalChanged = false;
        this.options.closeNotice(id);
      }
      if (waiting && state.waiting !== waiting) {
        state.text = undefined; state.waiting = waiting; this.schedule(id, state, waiting);
        // Subscribe only during a pending interaction, to receive its replayed question.
        // A permanent subscription would keep closed TUI sessions loaded in the daemon.
        if (!state.subscribed && this.rpc) {
          state.subscribed = true;
          const rpc = this.rpc;
          try {
            await rpc.request("thread/resume", { threadId: id, excludeTurns: true });
            if (!state.waiting || this.stopped || this.threads.get(id) !== state) {
              state.subscribed = false;
              await rpc.request("thread/unsubscribe", { threadId: id }).catch(() => {});
            }
          } catch {
            state.subscribed = false;
            await rpc.request("thread/unsubscribe", { threadId: id }).catch(() => {});
          }
        }
      }
      if (!waiting && state.waiting) {
        clearTimeout(state.timer); state.pending = undefined; this.options.closeNotice(id);
        state.waiting = undefined; state.last = undefined;
        if (state.subscribed && this.rpc) {
          state.subscribed = false;
          await this.rpc.request("thread/unsubscribe", { threadId: id }).catch(() => {});
        }
      }
      state.running = running;
      if (!running && (wasRunning || params.status.type === "systemError")) {
        clearTimeout(state.refresh);
        state.refresh = setTimeout(() => { void this.refreshTurn(id, state); }, 100);
      }
      return;
    }
    if (event.method === "tool/requestUserInput" || event.method === "item/tool/requestUserInput" || event.method === "mcpServer/elicitation/request") {
      state.text = questionText(params) || (typeof params.message === "string" ? params.message : undefined); state.waiting = "input"; this.schedule(id, state, "input"); return;
    }
    if (typeof event.method === "string" && event.method.endsWith("/requestApproval")) {
      state.waiting = "approval"; this.schedule(id, state, "approval"); return;
    }
    if (event.method !== "turn/completed" || !isObject(params.turn)) return;
    const turn = params.turn;
    if (typeof turn.id === "string") state.turn = turn.id;
    state.running = false;
    const items = Array.isArray(turn.items) ? turn.items : [];
    const answer = items.filter(isObject).findLast((item) => item.type === "agentMessage" && typeof item.text === "string");
    if (answer && typeof answer.text === "string") state.text = answer.text;
    if (turn.status === "failed") {
      state.text = isObject(turn.error) && typeof turn.error.message === "string" ? turn.error.message : undefined;
      const code = isObject(turn.error) ? turn.error.codexErrorInfo : undefined;
      const kind = state.goal === "budgetLimited" || code === "sessionBudgetExceeded" ? "budget"
        : state.goal === "usageLimited" || code === "usageLimitExceeded" || code === "rateLimitExceeded" ? "usage" : "failed";
      this.schedule(id, state, kind); return;
    }
    if (turn.status === "interrupted") { this.schedule(id, state, "interrupted"); return; }
    if (turn.status !== "completed") return;
    const goal = state.goalChanged ? goalKind(state.goal) : undefined;
    if (goal) this.schedule(id, state, goal);
    else if (state.goal !== "active") this.schedule(id, state, "response");
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    for (const state of this.threads.values()) { clearTimeout(state.timer); clearTimeout(state.refresh); }
    this.rpc?.close();
  }
}

async function listen(server: Server, path: string): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
    chmodSync(path, 0o600);
    return true;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE") throw error;
    const stale = await new Promise<boolean>((resolve) => {
      const socket = connect(path);
      socket.once("connect", () => { socket.destroy(); resolve(false); });
      socket.once("error", (cause) => resolve("code" in cause && cause.code === "ECONNREFUSED"));
    });
    if (!stale) return false;
    unlinkSync(path);
    return listen(server, path);
  }
}

export async function watchNotifications(options: ObserverOptions): Promise<void> {
  const observer = new CodexObserver(options);
  const path = options.socketPath || bridgePath();
  const server = createServer((socket) => {
    socket.setTimeout(2_000, () => socket.destroy());
    let buffer = "";
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 32_768) { socket.destroy(); return; }
      if (!buffer.includes("\n")) return;
      try {
        const message: unknown = JSON.parse(buffer.split("\n")[0]);
        if (!isObject(message)) { socket.end("{}\n"); return; }
        if (message.method === "completion" && isObject(message.payload)) socket.end(JSON.stringify({ covered: observer.legacy(message.payload) }) + "\n");
        else if (message.method === "stop") { socket.end("{}\n"); shutdown(); }
        else socket.end(JSON.stringify(observer.status()) + "\n");
      } catch { socket.end("{}\n"); }
    });
  });
  if (!await listen(server, path)) return;
  function shutdown(): void { observer.stop(); server.close(); }
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  await observer.start();
}
