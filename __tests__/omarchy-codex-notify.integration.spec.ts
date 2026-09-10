import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
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
    return args.slice(0, args.indexOf("--exec"));
  }

  clickNotification() {
    const args: string[] = JSON.parse(readFileSync(this.capture, "utf8"));
    const command = args.slice(args.indexOf("--exec") + 1);
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
  assert.equal(args.at(-2), "Codex terminou · my project");
  assert.match(args.at(-1) ?? "", /^Done &lt;b&gt;&amp; /);
  assert.match(args.at(-1) ?? "", /…$/);
  assert.ok((args.at(-1)?.length ?? Infinity) < 260);
  assert.ok(args.some((arg) => arg.startsWith("--icon=") && arg.includes("codex-desktop")));
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
  assert.match(fixture.notification().at(-1) ?? "", /Resposta pronta/);
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
