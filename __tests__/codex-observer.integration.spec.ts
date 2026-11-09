import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import test from "node:test";
import type { TestContext } from "node:test";
import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import { CodexObserver } from "../src/lib/codex-observer.ts";
import { isObject } from "../src/lib/codex-notifications.ts";
import type { JsonObject, Notice } from "../src/lib/codex-notifications.ts";

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Expected observer effect did not arrive");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

class AppServerFixture {
  readonly directory = mkdtempSync(join(tmpdir(), "codex-observer-"));
  readonly server = createServer();
  readonly websocket = new WebSocketServer({ server: this.server });
  readonly notices: Notice[] = [];
  readonly closed: string[] = [];
  readonly methods: string[] = [];
  readonly replies: JsonObject[] = [];
  readonly thread = "01a0e8cb-ddfd-7bf1-84df-0daf216911d3";
  goal: string | undefined;
  turn: JsonObject = { id: "turn-1", status: "completed", items: [{ type: "agentMessage", text: "Final result" }] };
  client?: WebSocket;
  readonly observer = new CodexObserver({ home: this.directory, deliver: (notice) => { this.notices.push(notice); }, closeNotice: (id) => this.closed.push(id), delay: 10 });

  async start(context: TestContext): Promise<void> {
    mkdirSync(join(this.directory, "app-server-control"));
    this.server.listen(join(this.directory, "app-server-control/app-server-control.sock"));
    await once(this.server, "listening");
    this.websocket.on("connection", (client) => {
      this.client = client;
      client.on("message", (bytes) => {
        const message: unknown = JSON.parse(bytes.toString());
        if (!isObject(message)) return;
        if (typeof message.method !== "string" && typeof message.id === "number") { this.replies.push(message); return; }
        if (typeof message.method !== "string" || typeof message.id !== "number") return;
        this.methods.push(message.method);
        let result: unknown = {};
        switch (message.method) {
          case "thread/loaded/list": result = { data: [this.thread, "child", "internal"], nextCursor: null }; break;
          case "thread/read": {
            const id = isObject(message.params) ? message.params.threadId : undefined;
            result = { thread: { id, cwd: "/tmp/example", source: id === "internal" ? "exec" : "cli", parentThreadId: id === "child" ? this.thread : null, status: { type: "idle" } } }; break;
          }
          case "thread/goal/get": result = { goal: this.goal ? { status: this.goal } : null }; break;
          case "thread/turns/list": result = { data: [this.turn] }; break;
        }
        client.send(JSON.stringify({ id: message.id, result }));
        if (message.method === "thread/resume") this.send("item/tool/requestUserInput", { turnId: "turn-1", questions: [{ question: "Which approach?", options: [{ label: "Keep current" }, { label: "Use alternative" }] }] }, 700);
      });
    });
    context.after(async () => {
      this.observer.stop();
      for (const client of this.websocket.clients) client.terminate();
      await new Promise<void>((resolve) => this.websocket.close(() => this.server.close(() => resolve())));
      rmSync(this.directory, { recursive: true });
    });
    await this.observer.start();
  }

  send(method: string, params: JsonObject, id?: number): void {
    this.client?.send(JSON.stringify({ ...(id ? { id } : {}), method, params: { threadId: this.thread, ...params } }));
  }

  async finish(status = "completed"): Promise<void> {
    this.send("thread/status/changed", { status: { type: "active", activeFlags: [] } });
    this.turn = { ...this.turn, status };
    this.send("thread/status/changed", { status: { type: status === "failed" ? "systemError" : "idle" } });
  }
}

test("observes global lifecycle without resuming idle sessions or replaying historical completions", async (context) => {
  const fixture = new AppServerFixture();
  await fixture.start(context);
  assert.equal(fixture.observer.status().threads, 1);
  assert.equal(fixture.observer.legacy({ "thread-id": "internal" }), true);
  assert.equal(fixture.observer.legacy({ "thread-id": "child" }), true);
  assert.equal(fixture.notices.length, 0);
  assert.ok(!fixture.methods.includes("thread/resume"));
  await fixture.finish();
  await until(() => fixture.notices.length === 1);
  assert.equal(fixture.notices[0].kind, "response");
  assert.equal(fixture.notices[0].text, "Final result");
  assert.ok(!fixture.methods.includes("turn/start"));
  assert.ok(!fixture.methods.includes("thread/resume"));
});

test("goal continuation is quiet and only the final goal state notifies", async (context) => {
  const fixture = new AppServerFixture();
  fixture.goal = "active";
  await fixture.start(context);
  await fixture.finish();
  await until(() => fixture.methods.includes("thread/turns/list"));
  assert.equal(fixture.notices.length, 0);
  fixture.goal = "complete";
  fixture.send("thread/goal/updated", { goal: { status: "complete" } });
  await until(() => fixture.notices.length === 1);
  assert.equal(fixture.notices[0].kind, "goal-complete");
  fixture.send("turn/completed", { turn: fixture.turn });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(fixture.notices.length, 1);
});

test("Esc coalesces a paused goal into one interruption; errors stay distinct", async (context) => {
  const fixture = new AppServerFixture();
  fixture.goal = "active";
  await fixture.start(context);
  fixture.send("thread/status/changed", { status: { type: "active", activeFlags: [] } });
  fixture.goal = "paused";
  fixture.send("thread/goal/updated", { goal: { status: "paused" } });
  fixture.turn.status = "interrupted";
  fixture.send("thread/status/changed", { status: { type: "idle" } });
  await until(() => fixture.notices.length === 1);
  assert.equal(fixture.notices[0].kind, "interrupted");
  fixture.turn = { id: "turn-2", status: "failed", error: { message: "Connection failed" } };
  await fixture.finish("failed");
  await until(() => fixture.notices.length === 2);
  assert.equal(fixture.notices[1].kind, "failed");
  assert.equal(fixture.notices[1].text, "Connection failed");
});

test("shows replayed question options and releases the temporary subscription after answering", async (context) => {
  const fixture = new AppServerFixture();
  await fixture.start(context);
  fixture.send("thread/status/changed", { status: { type: "active", activeFlags: ["waitingOnUserInput"] } });
  await until(() => fixture.notices.length === 1);
  assert.equal(fixture.notices[0].kind, "input");
  assert.match(fixture.notices[0].text || "", /1\. Keep current/);
  assert.match(fixture.notices[0].text || "", /2\. Use alternative/);
  fixture.send("thread/status/changed", { status: { type: "active", activeFlags: [] } });
  await until(() => fixture.methods.includes("thread/unsubscribe"));
  assert.ok(fixture.closed.includes(fixture.thread));
  assert.equal(fixture.replies.length, 0);
  assert.ok(!fixture.methods.includes("turn/start"));
  fixture.send("thread/status/changed", { status: { type: "active", activeFlags: ["waitingOnUserInput"] } });
  await until(() => fixture.notices.length === 2);
  assert.equal(fixture.notices[1].kind, "input");
});

for (const [goal, kind] of [["blocked", "blocked"], ["budgetLimited", "budget"], ["usageLimited", "usage"], ["paused", "paused"]]) {
  test(`reports goal ${goal} once`, async (context) => {
    const fixture = new AppServerFixture();
    fixture.goal = "active";
    await fixture.start(context);
    fixture.goal = goal;
    fixture.send("thread/goal/updated", { goal: { status: goal } });
    await until(() => fixture.notices.length === 1);
    assert.equal(fixture.notices[0].kind, kind);
    fixture.send("thread/goal/updated", { goal: { status: goal } });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(fixture.notices.length, 1);
  });
}

test("reconnects after daemon disconnection without replaying old notices", async (context) => {
  const fixture = new AppServerFixture();
  await fixture.start(context);
  fixture.client?.terminate();
  await until(() => fixture.methods.filter((method) => method === "initialize").length === 2);
  await until(() => fixture.observer.status().threads === 1);
  assert.equal(fixture.notices.length, 0);
});

test("an old completed goal does not label a later ordinary response as goal completion", async (context) => {
  const fixture = new AppServerFixture();
  fixture.goal = "complete";
  await fixture.start(context);
  await fixture.finish();
  await until(() => fixture.notices.length === 1);
  assert.equal(fixture.notices[0].kind, "response");
});

for (const [code, kind] of [["sessionBudgetExceeded", "budget"], ["usageLimitExceeded", "usage"], ["rateLimitExceeded", "usage"]]) {
  test(`classifies terminal ${code} as ${kind}`, async (context) => {
    const fixture = new AppServerFixture();
    await fixture.start(context);
    fixture.turn = { id: "limited-turn", status: "failed", error: { codexErrorInfo: code, message: "Limit reached" } };
    await fixture.finish("failed");
    await until(() => fixture.notices.length === 1);
    assert.equal(fixture.notices[0].kind, kind);
  });
}
