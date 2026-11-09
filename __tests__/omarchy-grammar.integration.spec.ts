import assert from "node:assert/strict";
import { test } from "node:test";
import { grammarConfig, reviseSelection, reviseText, selectedText } from "../src/lib/grammar.ts";
import type { Desktop } from "../src/lib/grammar.ts";

const config = grammarConfig({ OPENAI_API_KEY: "test-secret", OPENAI_BASE_URL: "https://example.com/v1/", OPENAI_MODEL: "test-model" });
const completed: typeof fetch = async () => Response.json({ choices: [{ message: { content: "Os meninos foram à escola." }, finish_reason: "stop" }] });

function session() {
  const state = { window: "0x1", clipboard: "clipboard original", primary: "os menino foi na escola", pastes: 0 };
  const desktop: Desktop = {
    activeWindow: () => state.window,
    readPrimary: () => state.primary,
    readClipboard: () => state.clipboard,
    copy: (text) => { state.clipboard = text; },
    paste: () => { state.pastes++; },
  };
  return { state, desktop };
}

test("corrects the selection through the configured endpoint and pastes the complete answer", async () => {
  const { state, desktop } = session();
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, "https://example.com/v1/chat/completions");
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer test-secret");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "test-model");
    assert.equal(body.messages[0].role, "system");
    assert.deepEqual(body.messages[1], { role: "user", content: state.primary });
    return completed(url, options);
  };
  assert.equal(await reviseSelection(config, desktop, undefined, request), true);
  assert.equal(state.clipboard, "Os meninos foram à escola.");
  assert.equal(state.pastes, 1);
});

test("falls back to clipboard and prefers clipboard for remote desktop sessions", () => {
  const { state, desktop } = session();
  state.primary = "";
  assert.equal(selectedText(desktop), state.clipboard);
  state.primary = "seleção local antiga";
  desktop.clipboardFirst = () => true;
  assert.equal(selectedText(desktop), state.clipboard);
  state.clipboard = "";
  state.primary = "";
  assert.throws(() => selectedText(desktop), /Sem texto/);
});

test("copies without pasting when focus changes, focus is unknown or paste is disabled", async () => {
  for (const mode of ["changed", "unknown", "disabled"]) {
    const { state, desktop } = session();
    if (mode === "unknown") state.window = "";
    const request: typeof fetch = async (...args) => {
      if (mode === "changed") state.window = "0x2";
      return completed(...args);
    };
    assert.equal(await reviseSelection({ ...config, autoPaste: mode !== "disabled" }, desktop, undefined, request), false);
    assert.equal(state.pastes, 0);
    assert.equal(state.clipboard, "Os meninos foram à escola.");
  }
});

test("preserves clipboard and does not paste on provider errors, incomplete or empty answers", async () => {
  const responses = [
    new Response("test-secret and private input", { status: 401 }),
    new Response("private input", { status: 429 }),
    Response.json({ choices: [{ message: { content: "partial" }, finish_reason: "length" }] }),
    Response.json({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
    Response.json({ error: { message: "private input" } }),
    new Response("not json"),
  ];
  for (const response of responses) {
    const { state, desktop } = session();
    await assert.rejects(reviseSelection(config, desktop, undefined, async () => response), (error: Error) => {
      assert.doesNotMatch(error.message, /test-secret|private input/);
      return true;
    });
    assert.equal(state.clipboard, "clipboard original");
    assert.equal(state.pastes, 0);
  }
});

test("reports a paste failure with the correction still available in clipboard", async () => {
  const { state, desktop } = session();
  desktop.paste = () => { throw new Error("wtype failed"); };
  await assert.rejects(reviseSelection(config, desktop, undefined, completed), /Use Ctrl \+ V/);
  assert.equal(state.clipboard, "Os meninos foram à escola.");
});

test("rejects empty input without calling the provider and redacts network errors", async () => {
  await assert.rejects(reviseText("  ", config, async () => { throw new Error("unexpected"); }), /Texto vazio/);
  await assert.rejects(reviseText("texto", config, async () => { throw new Error("test-secret"); }), /^Error: Falha na API:/);
});

test("validates endpoint, credentials, timeout and boolean settings", () => {
  assert.throws(() => grammarConfig({}), /OPENAI_API_KEY/);
  for (const endpoint of ["file:///tmp/test", "https://user:secret@example.com", "https://example.com?key=secret"]) {
    assert.throws(() => grammarConfig({ OPENAI_API_KEY: "key", OPENAI_BASE_URL: endpoint }), /OPENAI_BASE_URL inválida/);
  }
  assert.throws(() => grammarConfig({ OPENAI_API_KEY: "key", GRAMMAR_TIMEOUT_MS: "NaN" }), /GRAMMAR_TIMEOUT_MS/);
  assert.throws(() => grammarConfig({ OPENAI_API_KEY: "key", GRAMMAR_AUTO_PASTE: "yes" }), /GRAMMAR_AUTO_PASTE/);
});

test("CLI uses a saved configuration and prints only the correction without desktop commands", async () => {
  const { createServer } = await import("node:http");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  let fail = false;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer saved-test-key");
    assert.equal(JSON.parse(body).messages[1].content, "os menino foi na escola");
    if (fail) { response.writeHead(401).end("saved-test-key and private text"); return; }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: "Os meninos foram à escola." }, finish_reason: "stop" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = mkdtempSync(join(tmpdir(), "grammar-test-"));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const file = join(directory, "grammar.env");
    writeFileSync(file, `OPENAI_API_KEY="saved-test-key"\nOPENAI_BASE_URL="http://127.0.0.1:${address.port}/v1"\nOPENAI_MODEL="local-test"\n`, { mode: 0o600 });
    const env = { ...process.env };
    for (const key of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "GRAMMAR_TIMEOUT_MS", "GRAMMAR_AUTO_PASTE"]) delete env[key];
    // Missing Wayland tools ensures stdout mode has no clipboard or keyboard dependency.
    env.PATH = directory;
    const args = ["src/omarchy-grammar.ts", "--config", file, "--stdout", "os menino foi na escola"];
    const run = promisify(execFile);
    const result = await run(process.execPath, args, { env });
    assert.equal(result.stdout, "Os meninos foram à escola.\n");
    assert.equal(result.stderr, "");
    fail = true;
    await assert.rejects(run(process.execPath, args, { env }), (error: Error & { stdout?: string; stderr?: string }) => {
      assert.equal(error.stdout, "");
      assert.match(error.stderr ?? "", /HTTP 401/);
      assert.doesNotMatch(error.stderr ?? "", /saved-test-key|private text/);
      return true;
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true });
  }
});

test("request timeout aborts a provider that does not respond", async () => {
  const { createServer } = await import("node:http");
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await assert.rejects(reviseText("texto", { ...config, baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 50 }), /tempo limite/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Luna revisions disable reasoning for endpoints that add function tools", async () => {
  for (const model of ["gpt-6-luna", "openai/gpt-6-luna"]) {
    const request: typeof fetch = async (url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.reasoning_effort, "none");
      return completed(url, options);
    };
    assert.equal(await reviseText("os menino foi na escola", { ...config, model }, request), "Os meninos foram à escola.");
  }
});

test("clipboard copying completes while the background owner retains its output handles", async () => {
  const { copyGrammarText } = await import("../src/lib/grammar-desktop.ts");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "grammar-clipboard-test-"));
  const previousPath = process.env.PATH;
  const captured = join(directory, "clipboard.txt");
  const ownerPid = join(directory, "owner.pid");
  const ownerCode = "setInterval(() => {}, 1000); setTimeout(() => process.exit(), 10000);";
  writeFileSync(join(directory, "wl-copy"), `#!${process.execPath}
const fs = require('node:fs');
const {spawn} = require('node:child_process');
fs.writeFileSync(${JSON.stringify(captured)}, fs.readFileSync(0));
const owner = spawn(process.execPath, ['-e', ${JSON.stringify(ownerCode)}], {stdio: 'inherit', detached: true});
fs.writeFileSync(${JSON.stringify(ownerPid)}, String(owner.pid));
owner.unref();
`, { mode: 0o755 });
  try {
    process.env.PATH = directory;
    copyGrammarText("Texto revisado com acentuação.\nSegunda linha.");
    assert.equal(readFileSync(captured, "utf8"), "Texto revisado com acentuação.\nSegunda linha.");
    writeFileSync(join(directory, "wl-copy"), `#!${process.execPath}\nprocess.exit(1);\n`, { mode: 0o755 });
    assert.throws(() => copyGrammarText("texto"), /Falha ao copiar/);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    try { process.kill(Number(readFileSync(ownerPid, "utf8")), "SIGTERM"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    rmSync(directory, { recursive: true });
  }
});

test("retains original CRLF, boundary whitespace, Markdown hard breaks and protected content", async () => {
  const text = '\r\n  Oi pessoal  \r\n\r\n  - os menino foi\r\n  - veja [o guia](./docs/guia.md) e `npm run typecheck`\r\n\r\n```ts\nconst value = "nao alterar";\n```\r\n';
  const answer = 'Oi, pessoal\n\n  - os meninos foram\n  - veja [o guia](./docs/guia.md) e `npm run typecheck`\n\n```ts\nconst value = "nao alterar";\n```';
  const request: typeof fetch = async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: answer } }] });
  const result = await reviseText(text, config, request);
  assert.equal(result, text.replace('Oi pessoal', 'Oi, pessoal').replace('os menino foi', 'os meninos foram'));
});

test("rejects changed line breaks, lists, indentation, markup, links or code before copying", async () => {
  const cases = [
    ['Oi\n\nTudo bem?', 'Oi, tudo bem?'],
    ['- texto errado', '1. Texto corrigido'],
    ['Primeiro\n  segundo', 'Primeiro\nsegundo'],
    ['texto **importante**', 'texto importante'],
    ['• texto errado', '- Texto corrigido'],
    ['- [ ] tarefa pendente', '- [x] tarefa pendente'],
    ['Valeu 👍🏽', 'Valeu 👍'],
    ['feito ✅', 'feito'],
    ['veja https://example.com/original', 'veja https://example.com/alterado'],
    ['veja [guia](./original.md)', 'veja [guia](./outro.md)'],
    ['rode `npm test`', 'rode `npm run test`'],
    ['```ts\nconst x = 1;\n```', '```ts\nconst x = 2;\n```'],
    ['| nome | valor |\n| --- | --- |', 'nome: valor\n---'],
  ];
  for (const [text, answer] of cases) {
    const { state, desktop } = session();
    const request: typeof fetch = async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: answer } }] });
    await assert.rejects(reviseSelection(config, desktop, text, request), /alterou a formatação/);
    assert.equal(state.clipboard, 'clipboard original');
    assert.equal(state.pastes, 0);
  }
});

test("a rich clipboard revision keeps its HTML alongside plain text through the desktop flow", async () => {
  const { state, desktop } = session();
  state.primary = '';
  state.clipboard = 'os menino foi\n\nconfig: true';
  const html = '<p style="color:red">os menino foi</p><p><code>config: true</code></p>';
  desktop.readHtml = () => html;
  let copied: {text: string; html: string} | undefined;
  desktop.copyHtml = async (text, html) => { copied = {text, html}; };
  const request: typeof fetch = async (_url, options) => {
    const segments = JSON.parse(JSON.parse(String(options?.body)).messages[1].content) as {id: number; text: string; locked: boolean}[];
    assert.equal(segments[1].locked, true);
    return Response.json({ choices: [{finish_reason: 'stop', message: {content: JSON.stringify(segments.map(({id, text}) => ({id, text: text.replace('os menino foi', 'Os meninos foram')})))}}] });
  };
  assert.equal(await reviseSelection({...config, autoPaste: false}, desktop, undefined, request), false);
  assert.deepEqual(copied, {text: 'Os meninos foram\n\nconfig: true', html: html.replace('os menino foi', 'Os meninos foram')});
  assert.equal(state.clipboard, 'os menino foi\n\nconfig: true');
  assert.equal(state.pastes, 0);
});

test("rich clipboard uses the system Python even when PATH selects an incompatible interpreter", async () => {
  const { copyGrammarHtml } = await import("../src/lib/grammar-desktop.ts");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "grammar-python-test-"));
  const previousPath = process.env.PATH;
  const owner = join(directory, "owner.py");
  const result = join(directory, "result.json");
  writeFileSync(join(directory, "python3"), '#!/bin/sh\nexit 83\n', { mode: 0o755 });
  writeFileSync(owner, `import sys, json
from pathlib import Path
payload = json.load(sys.stdin)
Path(${JSON.stringify(result)}).write_text(json.dumps({"python": sys.executable, "isolated": sys.flags.isolated, "formats": payload}))
print("READY", flush=True)
`);
  try {
    process.env.PATH = directory;
    await copyGrammarHtml("Texto revisado.", "<p>Texto revisado.</p>", owner);
    const saved = JSON.parse(readFileSync(result, "utf8"));
    assert.equal(saved.python, "/usr/bin/python3");
    assert.equal(saved.isolated, 1);
    assert.equal(Buffer.from(saved.formats["text/html"], "base64").toString(), "<p>Texto revisado.</p>");
    assert.equal(Buffer.from(saved.formats["text/plain"], "base64").toString(), "Texto revisado.");
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(directory, { recursive: true });
  }
});
