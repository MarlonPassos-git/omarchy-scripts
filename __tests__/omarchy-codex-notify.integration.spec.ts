import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import test from "node:test";
import type { TestContext } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function executable(path: string, source: string): void {
  writeFileSync(path, `#!/usr/bin/env node\n${source}`);
  chmodSync(path, 0o755);
}

class Fixture {
  readonly directory = mkdtempSync(join(tmpdir(), "codex-notify-"));
  readonly capture = join(this.directory, "notification.json");
  readonly clients = join(this.directory, "clients.json");
  readonly actions = join(this.directory, "actions.jsonl");
  readonly env: Record<string, string>;

  constructor() {
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    this.env = {
      ...inherited,
      PATH: `${this.directory}:${inherited.PATH}`,
      CODEX_HOME: this.directory,
      XDG_RUNTIME_DIR: this.directory,
      NOTIFICATION_CAPTURE: this.capture,
      TEST_CLIENTS: this.clients,
      TEST_ACTIONS: this.actions,
    };
    delete this.env.TMUX;
    delete this.env.TMUX_PANE;
    writeFileSync(this.clients, "[]");
    executable(
      join(this.directory, "omarchy"),
      'const fs = require("node:fs");\nfs.writeFileSync(process.env.NOTIFICATION_CAPTURE, JSON.stringify(process.argv.slice(2)));\n',
    );
    executable(
      join(this.directory, "hyprctl"),
      'const fs = require("node:fs");\nif (process.argv[2] === "clients") {\n  process.stdout.write(fs.readFileSync(process.env.TEST_CLIENTS, "utf8"));\n} else {\n  fs.appendFileSync(process.env.TEST_ACTIONS, `${JSON.stringify(process.argv.slice(2))}\\n`);\n}\n',
    );
  }

  cleanup(): void {
    rmSync(this.directory, { recursive: true });
  }

  run(...args: string[]) {
    return spawnSync(process.execPath, [join(ROOT, "src/omarchy-codex-notify.ts"), ...args], {
      env: this.env,
      encoding: "utf8",
    });
  }

  notification(): string[] {
    const args: string[] = JSON.parse(readFileSync(this.capture, "utf8"));
    return args.slice(0, args.includes("--action") ? args.indexOf("--action") : args.indexOf("--exec"));
  }

  clickNotification() {
    const args: string[] = JSON.parse(readFileSync(this.capture, "utf8"));
    const command = args.slice(args.includes("--action") ? args.indexOf("--action") + 2 : args.indexOf("--exec") + 1);
    return spawnSync(command[0], command.slice(1), { env: this.env, encoding: "utf8" });
  }

  notificationTarget(): unknown {
    const args: string[] = JSON.parse(readFileSync(this.capture, "utf8"));
    return JSON.parse(args.at(-1) ?? "null");
  }

  installTestWindows(): Record<string, string | number> {
    const target = { address: "0x123", pid: process.pid, stableId: "target" };
    const other = { address: "0x456", pid: 99_999_999, stableId: "other" };
    writeFileSync(this.clients, JSON.stringify([other, target]));
    return target;
  }

  installHerdr(thread: string): void {
    this.env.TEST_THREAD = thread;
    this.env.TEST_CODEX_PID = String(process.pid);
    executable(
      join(this.directory, "herdr"),
      `const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "session" && args[1] === "list") {
  console.log(JSON.stringify({ sessions: [{ name: "pessoal", running: true }] }));
} else if (args[0] === "--session" && args[2] === "api") {
  console.log(JSON.stringify({ result: { snapshot: { agents: [{ agent: "codex", pane_id: "w1:p2" }] } } }));
} else if (args[0] === "--session" && args[2] === "pane" && args[3] === "read") {
  console.log("Codex status · " + fs.readFileSync(process.env.TEST_THREAD_FILE, "utf8"));
} else if (args[0] === "--session" && args[2] === "pane" && args[3] === "process-info") {
  console.log(JSON.stringify({ result: { process_info: { foreground_processes: [{ name: "codex", pid: Number(process.env.TEST_CODEX_PID) }] } } }));
} else {
  fs.appendFileSync(process.env.TEST_ACTIONS, JSON.stringify(args) + "\\n");
}
`,
    );
    this.env.TEST_THREAD_FILE = join(this.directory, "thread.txt");
    writeFileSync(this.env.TEST_THREAD_FILE, thread);
  }
}

function fixtureFor(context: TestContext): Fixture {
  const fixture = new Fixture();
  context.after(() => fixture.cleanup());
  return fixture;
}

test("completion has project and escaped bounded preview", (context) => {
  const fixture = fixtureFor(context);
  const payload = {
    type: "agent-turn-complete",
    cwd: "/tmp/my project",
    "last-assistant-message": `Done <b>&\n${"x".repeat(500)}`,
  };
  const result = fixture.run(JSON.stringify(payload));
  assert.equal(result.status, 0, result.stderr);
  const args = fixture.notification();
  assert.deepEqual(args.slice(0, 2), ["notification", "send"]);
  assert.equal(args.at(-2), "Resposta pronta · my project");
  assert.match(args.at(-1) ?? "", /^Done &lt;b&gt;&amp; /);
  assert.match(args.at(-1) ?? "", /…$/);
  assert.ok((args.at(-1)?.length ?? Infinity) < 260);
  assert.ok(args.some((arg) => arg.startsWith("--icon=") && arg.endsWith("/assets/codex-symbolic.svg")));
});

test("internal title generation does not notify", (context) => {
  const fixture = fixtureFor(context);
  const payload = {
    type: "agent-turn-complete",
    client: "codex-tui",
    "input-messages": [
      "Generate a concise, single-line task title of at most 36 characters and under five words where possible.\n\nUser prompt:\nTest",
    ],
    "last-assistant-message": '{"title":"Validate notifications"}',
  };
  assert.equal(fixture.run(JSON.stringify(payload)).status, 0);
  assert.throws(() => readFileSync(fixture.capture));

  payload["input-messages"] = ["Return JSON with a title field."];
  assert.equal(fixture.run(JSON.stringify(payload)).status, 0);
  assert.match(fixture.notification().at(-1) ?? "", /Validate notifications/);
});

test("other events are ignored", (context) => {
  const fixture = fixtureFor(context);
  assert.equal(fixture.run('{"type":"approval-requested"}').status, 0);
  assert.throws(() => readFileSync(fixture.capture));
});

test("dash-leading response remains notification text", (context) => {
  const fixture = fixtureFor(context);
  const result = fixture.run('{"type":"agent-turn-complete","last-assistant-message":"--exec"}');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fixture.notification().at(-1), "\u200b--exec");
});

test("empty completion has readable fallback", (context) => {
  const fixture = fixtureFor(context);
  assert.equal(fixture.run('{"type":"agent-turn-complete"}').status, 0);
  assert.match(fixture.notification().at(-1) ?? "", /resposta|Resposta/);
});

test("click focuses the originating process", (context) => {
  const fixture = fixtureFor(context);
  fixture.installTestWindows();
  assert.equal(fixture.run('{"type":"agent-turn-complete"}').status, 0);
  assert.deepEqual(fixture.notificationTarget(), {
    window: { address: "0x123", pid: process.pid, stableId: "target" },
  });
  assert.throws(() => readFileSync(fixture.actions));
  const click = fixture.clickNotification();
  assert.equal(click.status, 0, click.stderr);
  assert.deepEqual(JSON.parse(readFileSync(fixture.actions, "utf8")), [
    "dispatch",
    'hl.dsp.focus({ window = "address:0x123" })',
  ]);
});

test("a missing Herdr installation does not break direct terminal focus", (context) => {
  const fixture = fixtureFor(context);
  fixture.installTestWindows();
  executable(join(fixture.directory, "herdr"), "process.exit(1);\n");
  const result = fixture.run('{"type":"agent-turn-complete","thread-id":"01a0e8cb-ddfd-7bf1-84df-0daf216911d3"}');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fixture.notificationTarget(), {
    window: { address: "0x123", pid: process.pid, stableId: "target" },
  });
});

test("click finds the exact Codex thread in Herdr and focuses its pane and window", (context) => {
  const fixture = fixtureFor(context);
  fixture.installTestWindows();
  const thread = "01a0e8cb-ddfd-7bf1-84df-0daf216911d3";
  fixture.installHerdr(thread);
  const result = fixture.run(JSON.stringify({ type: "agent-turn-complete", "thread-id": thread }));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fixture.notificationTarget(), {
    window: { address: "0x123", pid: process.pid, stableId: "target" },
    herdr: { session: "pessoal", pane: "w1:p2", thread },
  });

  const click = fixture.clickNotification();
  assert.equal(click.status, 0, click.stderr);
  const actions = readFileSync(fixture.actions, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(actions, [
    ["--session", "pessoal", "agent", "focus", "w1:p2"],
    ["dispatch", 'hl.dsp.focus({ window = "address:0x123" })'],
  ]);

  writeFileSync(fixture.env.TEST_THREAD_FILE, "different thread");
  writeFileSync(fixture.actions, "");
  assert.equal(fixture.clickNotification().status, 0);
  assert.deepEqual(JSON.parse(readFileSync(fixture.actions, "utf8")), [
    "dispatch",
    'hl.dsp.focus({ window = "address:0x123" })',
  ]);
});

test("click ignores a closed or replaced origin window", (context) => {
  const fixture = fixtureFor(context);
  const target = fixture.installTestWindows();
  fixture.run('{"type":"agent-turn-complete"}');
  target.stableId = "replacement";
  writeFileSync(fixture.clients, JSON.stringify([target]));
  assert.equal(fixture.clickNotification().status, 0);
  assert.throws(() => readFileSync(fixture.actions));
});

test("ambiguous process does not focus an arbitrary window", (context) => {
  const fixture = fixtureFor(context);
  const target = fixture.installTestWindows();
  writeFileSync(fixture.clients, JSON.stringify([target, { ...target, address: "0x789" }]));
  fixture.run('{"type":"agent-turn-complete"}');
  assert.equal(fixture.clickNotification().status, 0);
  assert.throws(() => readFileSync(fixture.actions));
});

test("tmux click restores the originating session, window, and pane", (context) => {
  const fixture = fixtureFor(context);
  fixture.installTestWindows();
  fixture.env.TMUX = "/tmp/test-tmux.sock,100,0";
  fixture.env.TMUX_PANE = "%7";
  executable(
    join(fixture.directory, "tmux"),
    `const fs = require("node:fs");\nconst command = process.argv[4];\nif (command === "display-message") {\n  console.log("4321\\t$2\\t@3");\n} else if (command === "list-clients") {\n  console.log("${process.pid}\\t/dev/pts/42\\t$2\\t100");\n} else {\n  fs.appendFileSync(process.env.TEST_ACTIONS, JSON.stringify(process.argv.slice(2)) + "\\n");\n}\n`,
  );
  fixture.run('{"type":"agent-turn-complete"}');
  assert.throws(() => readFileSync(fixture.actions));
  const click = fixture.clickNotification();
  assert.equal(click.status, 0, click.stderr);
  const actions = readFileSync(fixture.actions, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(actions, [
    ["-S", "/tmp/test-tmux.sock", "switch-client", "-c", "/dev/pts/42", "-t", "$2"],
    ["-S", "/tmp/test-tmux.sock", "select-window", "-t", "$2:@3"],
    ["-S", "/tmp/test-tmux.sock", "select-pane", "-t", "%7"],
    ["dispatch", 'hl.dsp.focus({ window = "address:0x123" })'],
  ]);
});

test("invalid payloads do not expose their contents", (context) => {
  const fixture = fixtureFor(context);
  for (const payload of ["private invalid data", "[]", '{"type":"agent-turn-complete","cwd":42}']) {
    const result = fixture.run(payload);
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stderr, new RegExp(payload.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.throws(() => readFileSync(fixture.capture));
  }
});

test("previews use every native state and safe navigation buttons", (context) => {
  const fixture = fixtureFor(context);
  const kinds = ["response", "progress", "goal-complete", "input", "approval", "blocked", "budget", "usage", "interrupted", "paused", "failed"];
  for (const kind of kinds) {
    const result = fixture.run("--preview", kind);
    assert.equal(result.status, 0, result.stderr);
    const args: string[] = JSON.parse(readFileSync(fixture.capture, "utf8"));
    assert.ok(args.includes("--app-name=Codex Preview"));
    assert.ok(args.includes("--transient"));
    assert.ok(args.some((arg) => arg.startsWith("--icon=") && arg.endsWith("/assets/codex-symbolic.svg")));
    assert.ok(args.some((arg) => arg.startsWith("--image=") && arg.endsWith("/assets/codex-symbolic.svg")));
    assert.ok(!args.some((arg) => arg.startsWith("--glyph=")));
    assert.equal(args.at(-1), "--preview-action");
    assert.equal(args.includes("--urgency=critical"), kind === "failed");
    const click = fixture.clickNotification();
    assert.equal(click.status, 0);
    assert.match(click.stdout, /no session was changed/);
  }
  assert.throws(() => readFileSync(fixture.actions));
});

test("unknown previews and invalid thread actions do not launch commands", (context) => {
  const fixture = fixtureFor(context);
  assert.equal(fixture.run("--preview", "invalid").status, 2);
  assert.equal(fixture.run("--open-thread", "--exec=malicious").status, 2);
  assert.throws(() => readFileSync(fixture.capture));
});

test("withdraws only the ID-verified native card when its summary is unambiguous", (context) => {
  const fixture = fixtureFor(context);
  const store = join(fixture.directory, ".local/state/omarchy/notifications");
  mkdirSync(store, { recursive: true });
  const row = { app: "Codex", originalId: 42, summary: "Precisa de você · example" };
  writeFileSync(join(store, "live.json"), JSON.stringify([row]));
  const script = new URL("../src/omarchy-codex-notify.ts", import.meta.url).href;
  const run = () => spawnSync(process.execPath, ["--input-type=module", "-e", `const { closeNotice } = await import(${JSON.stringify(script)}); closeNotice(42);`], { env: { ...fixture.env, HOME: fixture.directory }, encoding: "utf8" });
  assert.equal(run().status, 0);
  assert.deepEqual(JSON.parse(readFileSync(fixture.capture, "utf8")), ["notification", "dismiss", row.summary]);
  writeFileSync(fixture.capture, "unchanged");
  writeFileSync(join(store, "live.json"), JSON.stringify([row, { ...row, originalId: 43 }]));
  assert.equal(run().status, 0);
  assert.equal(readFileSync(fixture.capture, "utf8"), "unchanged");
});

test("Herdr server-owned Codex processes return to the named GUI session", (context) => {
  const fixture = fixtureFor(context);
  const target = fixture.installTestWindows();
  target.class = "org.omarchy.herdr-pessoal";
  writeFileSync(fixture.clients, JSON.stringify([target]));
  const thread = "01a0e8cb-ddfd-7bf1-84df-0daf216911d3";
  fixture.installHerdr(thread);
  fixture.env.TEST_CODEX_PID = "99999999";
  assert.equal(fixture.run(JSON.stringify({ type: "agent-turn-complete", "thread-id": thread })).status, 0);
  const origin = fixture.notificationTarget() as { herdr: unknown };
  assert.deepEqual(origin.herdr, { session: "pessoal", pane: "w1:p2", thread });
  assert.equal(fixture.clickNotification().status, 0);
  const actions = readFileSync(fixture.actions, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(actions[0], ["--session", "pessoal", "agent", "focus", "w1:p2"]);
  assert.equal(fixture.run("--open-thread", thread).status, 0);
});

test("a headless Herdr origin never opens another terminal", (context) => {
  const fixture = fixtureFor(context);
  const thread = "01a0e8cb-ddfd-7bf1-84df-0daf216911d3";
  fixture.installHerdr(thread);
  fixture.env.TEST_CODEX_PID = "99999999";
  assert.equal(fixture.run("--open-thread", thread).status, 0);
  assert.throws(() => readFileSync(fixture.capture));
  assert.throws(() => readFileSync(fixture.actions));
});

test("a truncated Codex status returns to the Herdr pane across workspaces", (context) => {
  const fixture = fixtureFor(context);
  const target = fixture.installTestWindows();
  writeFileSync(fixture.clients, JSON.stringify([{ ...target, class: "org.omarchy.herdr-pessoal", workspace: { id: -99, name: "special:scratchpad" } }]));
  const thread = "01a0e8cb-ddfd-7bf1-84df-0daf216911d3";
  fixture.installHerdr(thread);
  writeFileSync(fixture.env.TEST_THREAD_FILE, thread.slice(0, 27) + "…");
  assert.equal(fixture.run("--open-thread", thread).status, 0);
  const actions = readFileSync(fixture.actions, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(actions, [
    ["--session", "pessoal", "agent", "focus", "w1:p2"],
    ["dispatch", 'hl.dsp.focus({ window = "address:0x123" })'],
  ]);
  assert.throws(() => readFileSync(fixture.capture));
});

test("unidentified threads never launch a new terminal", (context) => {
  const fixture = fixtureFor(context);
  fixture.installTestWindows();
  executable(join(fixture.directory, "herdr"), "process.exit(1);\n");
  assert.equal(fixture.run("--open-thread", "01a0e8cb-ddfd-7bf1-84df-0daf216911d3").status, 0);
  assert.throws(() => readFileSync(fixture.capture));
  assert.throws(() => readFileSync(fixture.actions));
});

test("short UUID prefixes and UUIDs in prose do not identify a Herdr origin", (context) => {
  const fixture = fixtureFor(context);
  const thread = "01a0e8cb-ddfd-7bf1-84df-0daf216911d3";
  fixture.installHerdr(thread);
  fixture.env.TEST_CODEX_PID = "99999999";
  for (const text of [thread.slice(0, 18) + "…", `mentioned thread ${thread}`]) {
    writeFileSync(fixture.env.TEST_THREAD_FILE, text);
    assert.equal(fixture.run("--open-thread", thread).status, 0);
    assert.throws(() => readFileSync(fixture.actions));
    assert.throws(() => readFileSync(fixture.capture));
  }
});

test("daemon notifications find standalone terminals by a unique task title", async (context) => {
  const fixture = fixtureFor(context);
  executable(join(fixture.directory, "herdr"), "process.exit(1);\n");
  const thread = "01a0e8cb-ddfd-7bf1-84df-0daf216911d3";
  const target = { address: "0x123", pid: 99_999_999, stableId: "target", class: "Alacritty", title: "⠼ Fix notifications | example", workspace: { id: 8, name: "8" } };
  writeFileSync(fixture.clients, JSON.stringify([target]));
  const threads = [{ id: thread, name: "Fix notifications", cwd: "/tmp/example" }];
  const server = createServer();
  const websocket = new WebSocketServer({ server });
  context.after(async () => {
    for (const client of websocket.clients) client.terminate();
    await new Promise<void>((resolve) => websocket.close(() => server.close(() => resolve())));
  });
  websocket.on("connection", (client) => client.on("message", (bytes) => {
    const message = JSON.parse(bytes.toString());
    if (message.id === undefined) return;
    let result = {};
    if (message.method === "thread/loaded/list") result = { data: threads.map((entry) => entry.id), nextCursor: null };
    if (message.method === "thread/read") result = { thread: threads.find((entry) => entry.id === message.params.threadId) };
    client.send(JSON.stringify({ id: message.id, result }));
  }));
  mkdirSync(join(fixture.directory, "app-server-control"));
  server.listen(join(fixture.directory, "app-server-control/app-server-control.sock"));
  await once(server, "listening");
  const run = (...args: string[]) => promisify(execFile)(process.execPath, [join(ROOT, "src/omarchy-codex-notify.ts"), ...args], { env: fixture.env, timeout: 5_000 });
  const resolved = await run("--resolve-target", thread);
  assert.deepEqual(JSON.parse(resolved.stdout), { window: { address: target.address, pid: target.pid, stableId: target.stableId } });
  await run("--open-thread", thread);
  assert.deepEqual(JSON.parse(readFileSync(fixture.actions, "utf8")), ["dispatch", 'hl.dsp.focus({ window = "address:0x123" })']);
  assert.throws(() => readFileSync(fixture.capture));

  writeFileSync(fixture.actions, "");
  threads.push({ ...threads[0], id: "01a0e8cb-ddfd-7bf1-84df-0daf216911d4" });
  await run("--open-thread", thread);
  assert.equal(readFileSync(fixture.actions, "utf8"), "");
  assert.throws(() => readFileSync(fixture.capture));
  threads.pop();
  writeFileSync(fixture.clients, JSON.stringify([target, { ...target, address: "0x456" }]));
  await run("--open-thread", thread);
  assert.equal(readFileSync(fixture.actions, "utf8"), "");
  assert.throws(() => readFileSync(fixture.capture));
});
