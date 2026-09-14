import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveHintAction } from "../src/omarchy-open-terminal-hint.ts";

test("routes decorated local files to Neovim", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "terminal-hint-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const target = join(directory, "example.ts");
  writeFileSync(target, "export {};\n");

  assert.deepEqual(resolveHintAction(`(${target}).`), {
    program: "alacritty",
    args: ["-e", "nvim", "--", target],
  });
});

test("routes directories and web URLs to the desktop", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "terminal-hint-"));
  context.after(() => rmSync(directory, { recursive: true }));
  mkdirSync(join(directory, "folder"));

  assert.deepEqual(resolveHintAction(join(directory, "folder")), {
    program: "xdg-open",
    args: [join(directory, "folder")],
  });
  assert.deepEqual(resolveHintAction("https://example.com/docs"), {
    program: "xdg-open",
    args: ["https://example.com/docs"],
  });
});

test("routes image paths and local image URLs to imv", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "terminal-hint-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const decoratedTarget = join(directory, "screenshot.PNG");
  const urlTarget = join(directory, "my photo.jpg");
  writeFileSync(decoratedTarget, "image");
  writeFileSync(urlTarget, "image");

  assert.deepEqual(resolveHintAction(`(${decoratedTarget}).`), {
    program: "imv",
    args: [decoratedTarget],
  });
  assert.deepEqual(resolveHintAction(new URL(`file://${urlTarget}`).href), {
    program: "imv",
    args: [urlTarget],
  });
});

test("decodes local file URLs", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "terminal-hint-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const target = join(directory, "my file.ts");
  writeFileSync(target, "export {};\n");

  assert.deepEqual(resolveHintAction(new URL(`file://${target}`).href), {
    program: "alacritty",
    args: ["-e", "nvim", "--", target],
  });
});

test("reports missing local files without opening an editor", () => {
  assert.deepEqual(resolveHintAction("/definitely/missing/file.ts"), {
    program: "notify-send",
    args: ["Arquivo não encontrado", "/definitely/missing/file.ts"],
  });
});
