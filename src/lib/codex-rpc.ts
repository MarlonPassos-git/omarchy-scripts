import { EventEmitter } from "node:events";
import { join } from "node:path";
import WebSocket from "ws";
import { isObject } from "./codex-notifications.ts";
import type { JsonObject } from "./codex-notifications.ts";

// Suppress streamed prose and command output before they enter the observer.
const noisyMethods = ["item/agentMessage/delta", "item/reasoning/textDelta", "item/reasoning/summaryTextDelta", "item/reasoning/summaryPartAdded", "item/commandExecution/outputDelta", "item/fileChange/outputDelta", "item/plan/delta", "thread/tokenUsage/updated", "turn/diff/updated", "turn/plan/updated", "hook/started", "hook/completed", "item/started", "item/completed"];

export class CodexRpc extends EventEmitter {
  readonly socket: WebSocket;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: JsonObject) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(home: string) {
    super();
    this.socket = new WebSocket(`ws+unix:${join(home, "app-server-control/app-server-control.sock") }:/`, { perMessageDeflate: false, maxPayload: 8 * 1024 * 1024, handshakeTimeout: 5_000 });
    this.socket.on("error", () => {});
    this.socket.on("message", (bytes) => {
      let message: unknown;
      try { message = JSON.parse(bytes.toString()); } catch { return; }
      if (!isObject(message)) return;
      if (typeof message.method === "string") { this.emit("event", message); return; }
      if (typeof message.id !== "number") return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error("Codex RPC request failed"));
      else request.resolve(isObject(message.result) ? message.result : {});
    });
    this.socket.on("close", () => {
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Codex disconnected")); }
      this.pending.clear();
      this.emit("disconnected");
    });
  }

  async initialize(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    await this.request("initialize", { clientInfo: { name: "omarchy_notifications", title: "Omarchy Codex notifications", version: "1" }, capabilities: { experimentalApi: true, optOutNotificationMethods: noisyMethods } });
    this.socket.send(JSON.stringify({ method: "initialized" }));
  }

  request(method: string, params: JsonObject = {}): Promise<JsonObject> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Codex is not connected"));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Codex RPC timeout")); }, 5_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void { this.socket.close(); }
}
