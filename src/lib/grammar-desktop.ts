import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function copyGrammarText(text: string): void {
  const result = spawnSync("wl-copy", ["--type", "text/plain;charset=utf-8"], {
    input: text,
    encoding: "utf8",
    timeout: 5000,
    // wl-copy's background owner retains inherited pipes after the parent exits.
    stdio: ["pipe", "ignore", "ignore"],
  });
  if (result.error || result.status !== 0) throw new Error("Falha ao copiar o texto com wl-copy.");
}

/** Qt offers HTML and plain text together; wl-copy supports one payload per invocation. */
export async function copyGrammarHtml(
  text: string,
  html: string,
  ownerScript = fileURLToPath(new URL("./grammar-clipboard.py", import.meta.url)),
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // PySide6 is an Arch system package; Mise shims may select an unrelated Python.
    const child = spawn("/usr/bin/python3", ["-I", ownerScript], {
      detached: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, QT_QPA_PLATFORM: "wayland" },
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Tempo limite ao copiar o texto formatado."));
    }, 5000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Não foi possível iniciar Python/PySide6 para copiar o HTML."));
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Falha ao copiar o texto formatado com Qt/PySide6."));
    });
    child.stdout.once("data", (chunk: Buffer) => {
      if (!chunk.toString().includes("READY")) return;
      clearTimeout(timer);
      child.stdout.destroy();
      child.unref();
      resolve();
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({
      "text/html": Buffer.from(html).toString("base64"),
      "text/plain": Buffer.from(text).toString("base64"),
      "text/plain;charset=utf-8": Buffer.from(text).toString("base64"),
    }));
  });
}
