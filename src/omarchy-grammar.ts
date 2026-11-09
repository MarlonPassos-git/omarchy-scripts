#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { createServer } from "node:net";
import { grammarConfig, listModels, readSettings, reviseSelection, reviseText, selectedText } from "./lib/grammar.ts";
import type { Desktop } from "./lib/grammar.ts";
import { copyGrammarText, copyGrammarHtml } from "./lib/grammar-desktop.ts";

function command(program: string, args: string[]): string {
  const result = spawnSync(program, args, { encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Falha ao executar ${program}.`);
  return result.stdout;
}

const desktop: Desktop = {
  clipboardFirst: () => {
    try {
      const window = JSON.parse(command("hyprctl", ["activewindow", "-j"]));
      return /freerdp|sdsr|remote desktop|xfreerdp/i.test(`${window.class} ${window.title}`);
    } catch { return false; }
  },
  readPrimary: () => command("wl-paste", ["--primary", "--no-newline"]),
  readClipboard: () => command("wl-paste", ["--no-newline"]),
  activeWindow: () => {
    try {
      const window = JSON.parse(command("hyprctl", ["activewindow", "-j"]));
      return typeof window.address === "string" && window.address !== "0x0" ? window.address : "";
    } catch { return ""; }
  },
  readHtml: (source) => command("wl-paste", [...(source === "primary" ? ["--primary"] : []), "--type", "text/html", "--no-newline"]),
  copyHtml: copyGrammarHtml,
  copy: copyGrammarText,
  paste: () => { command("wtype", ["-M", "ctrl", "-k", "v", "-m", "ctrl"]); },
};

function notify(message: string): void {
  spawnSync("omarchy", ["notification", "send", "Grammar", message, "-t", "3500"], { stdio: "ignore", timeout: 5000 });
}

async function configure(path: string): Promise<void> {
  if (!process.stdin.isTTY) throw new Error("Execute --configure em um terminal interativo.");
  const current = readSettings(path);
  let secret = false;
  const output = new Writable({ write(chunk, _encoding, done) { if (!secret) process.stdout.write(chunk); done(); } });
  const terminal = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const baseUrl = await terminal.question(`Endpoint [${current.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}]: `);
    const model = await terminal.question(`Modelo [${current.OPENAI_MODEL ?? "gpt-4.1-mini"}]: `);
    process.stdout.write(`Chave da API (oculta${current.OPENAI_API_KEY ? "; Enter mantém a atual" : ""}): `);
    secret = true;
    const key = await terminal.question("");
    secret = false;
    process.stdout.write("\n");
    const settings = {
      ...current,
      OPENAI_BASE_URL: baseUrl.trim() || current.OPENAI_BASE_URL || "https://api.openai.com/v1",
      OPENAI_MODEL: model.trim() || current.OPENAI_MODEL || "gpt-4.1-mini",
      OPENAI_API_KEY: key.trim() || current.OPENAI_API_KEY || "",
    };
    grammarConfig(settings);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, Object.entries(settings).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    console.log("Configuração salva. Use --models para listar modelos ou --stdout para testar uma revisão.");
  } finally { terminal.close(); }
}

const help = `Uso: omarchy-grammar.ts [opções] [texto]
Sem texto, revisa a seleção atual ou o clipboard e cola na janela original.
  --configure       Cadastra endpoint, modelo e chave (oculta) no terminal
  --config CAMINHO  Usa outro arquivo de configuração
  --model MODELO    Seleciona um modelo para esta execução
  --models          Lista os modelos do endpoint configurado
  --stdout          Retorna só o texto revisado, sem alterar clipboard ou colar
  --stdin           Lê o texto da entrada padrão
  --no-paste        Copia a revisão sem colar
  --help            Mostra esta ajuda`;

let quiet = false;
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      configure: { type: "boolean" }, config: { type: "string" }, model: { type: "string" },
      models: { type: "boolean" }, stdout: { type: "boolean" }, stdin: { type: "boolean" },
      "no-paste": { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
  });
  quiet = Boolean(values.stdout || values.models || values.configure || values.help);
  if (values.help) { console.log(help); return; }
  if (values.stdin && positionals.length) throw new Error("Use --stdin ou texto nos argumentos, não ambos.");
  const path = values.config ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "omarchy-scripts", "grammar.env");
  if (values.configure) { await configure(path); return; }
  const config = grammarConfig({ ...readSettings(path), ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) });
  if (values.model) config.model = values.model;
  if (values["no-paste"]) config.autoPaste = false;
  if (values.models) { console.log((await listModels(config)).join("\n")); return; }
  const text = values.stdin ? readFileSync(0, "utf8") : positionals.length ? positionals.join(" ") : undefined;
  if (values.stdout) { console.log(await reviseText(text ?? selectedText(desktop), config)); return; }
  // An abstract socket releases itself on exit, including crashes; no stale lock file.
  const lock = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      lock.once("error", () => reject(new Error("Já existe uma revisão em andamento.")));
      lock.listen(`\0omarchy-grammar-${process.getuid?.()}`, resolve);
    });
    notify("Revisando texto…");
    const pasted = await reviseSelection(config, desktop, text);
    notify(pasted ? "Texto revisado e colado." : "Texto revisado e copiado. Use Ctrl + V para colar.");
  } finally { if (lock.listening) lock.close(); }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Falha ao revisar o texto.";
  console.error(`Grammar: ${message}`);
  if (!quiet) notify(message);
  process.exitCode = 1;
});
