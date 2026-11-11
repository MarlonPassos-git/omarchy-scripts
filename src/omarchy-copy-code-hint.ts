#!/usr/bin/env node

import { spawnSync } from "node:child_process";

/** Remove hint presentation only; preserve shell quotes, punctuation and spacing. */
export function normalizeCodeHint(rawTarget: string): string {
  if (/[\r\n\x00-\x1f\x7f]/u.test(rawTarget.replaceAll("\t", ""))) {
    throw new Error("hint: expected one command line without control characters");
  }

  let target = rawTarget.trim();
  if (/^[│┃║]/u.test(target)) target = target.slice(1).trimStart();
  if (/[│┃║]$/u.test(target)) target = target.slice(0, -1).trimEnd();
  target = target.replace(/^[•$][ \t]+/u, "");

  if (!target || /[│┃║]/u.test(target)) {
    throw new Error("hint: expected a command from one panel");
  }
  return target;
}

export function main(args: string[]): number {
  if (args.length !== 1) {
    console.error("hint: expected one selected command argument");
    return 2;
  }

  let target: string;
  try {
    target = normalizeCodeHint(args[0]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "hint: invalid command line");
    return 2;
  }

  // The command is stdin data, never a shell argument or executable.
  const result = spawnSync("wl-copy", ["--type", "text/plain;charset=utf-8"], {
    input: target,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.error) {
    console.error(`wl-copy: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
