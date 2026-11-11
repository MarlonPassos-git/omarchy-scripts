import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCodeHint } from "../src/omarchy-copy-code-hint.ts";

test("removes panel padding, borders and prompt markers", () => {
  for (const hint of [
    "  pnpm run build    ",
    "  pnpm run build    │",
    "│  pnpm run build    ┃",
    "  $ pnpm run build    ",
    "  • pnpm run build    ",
  ]) {
    assert.equal(normalizeCodeHint(hint), "pnpm run build");
  }
});

test("preserves shell quoting, substitutions, accents and internal whitespace", () => {
  const command = `node -e 'console.log("Olá;  $HOME", "$(date)")'`;
  assert.equal(normalizeCodeHint(`  ${command}  │`), command);
});

test("rejects empty, multiline, control characters and text spanning panels", () => {
  for (const hint of ["", "    │", "node\nnode", "node\rnode", "node\x1b[0m", "node\0", "  node  │  pnpm  │"]) {
    assert.throws(() => normalizeCodeHint(hint), /hint: expected/u);
  }
});
