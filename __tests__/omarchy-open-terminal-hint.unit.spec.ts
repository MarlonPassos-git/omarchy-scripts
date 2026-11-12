import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveHintAction } from "../src/omarchy-open-terminal-hint.ts";

test("routes decorated local files to the desktop", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "terminal-hint-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const target = join(directory, "example.ts");
  writeFileSync(target, "export {};\n");

  assert.deepEqual(resolveHintAction(`(${target}).`), {
    program: "xdg-open",
    args: [target],
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

test("routes image paths and local image URLs to the desktop", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "terminal-hint-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const decoratedTarget = join(directory, "screenshot.PNG");
  const urlTarget = join(directory, "my photo.jpg");
  writeFileSync(decoratedTarget, "image");
  writeFileSync(urlTarget, "image");

  assert.deepEqual(resolveHintAction(`(${decoratedTarget}).`), {
    program: "xdg-open",
    args: [decoratedTarget],
  });
  assert.deepEqual(resolveHintAction(new URL(`file://${urlTarget}`).href), {
    program: "xdg-open",
    args: [urlTarget],
  });
});

test("decodes local file URLs", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "terminal-hint-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const target = join(directory, "my file.ts");
  writeFileSync(target, "export {};\n");

  assert.deepEqual(resolveHintAction(new URL(`file://${target}`).href), {
    program: "xdg-open",
    args: [target],
  });
});

test("routes decorated video paths, home paths and local URLs to the default player", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "terminal-hint-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const target = join(directory, "recording.mp4");
  const urlTarget = join(directory, "my recording.WEBM");
  writeFileSync(target, "video");
  writeFileSync(urlTarget, "video");

  for (const input of [`${target};`, `(${target}).`, "~/recording.mp4"]) {
    assert.deepEqual(resolveHintAction(input, directory), {
      program: "xdg-open",
      args: [target],
    });
  }
  assert.deepEqual(resolveHintAction(new URL(`file://${urlTarget}`).href), {
    program: "xdg-open",
    args: [urlTarget],
  });
});

test("reports missing local files without opening an editor", () => {
  assert.deepEqual(resolveHintAction("/definitely/missing/file.ts"), {
    program: "notify-send",
    args: ["Arquivo não encontrado", "/definitely/missing/file.ts"],
  });
});

for (const filename of ["report.md", "report.markdown", "document.pdf", "archive.zip", "song.mp3"]) {
  test(`routes ${filename} to the desktop without choosing an application`, (context) => {
    const directory = mkdtempSync(join(tmpdir(), "terminal-hint-"));
    context.after(() => rmSync(directory, { recursive: true }));
    const target = join(directory, filename);
    writeFileSync(target, "example");

    assert.deepEqual(resolveHintAction(`~/${filename}`, directory), {
      program: "xdg-open",
      args: [target],
    });
  });
}

test("preserves Obsidian protocol links for the desktop handler", () => {
  const target = "obsidian://open?vault=Notes&file=example";
  assert.deepEqual(resolveHintAction(target), { program: "xdg-open", args: [target] });
});
