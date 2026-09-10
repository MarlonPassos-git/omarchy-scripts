#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export type HintAction = {
  program: string;
  args: string[];
};

type FileSystem = {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
};

const fileSystem: FileSystem = {
  exists: existsSync,
  isDirectory: (path) => statSync(path).isDirectory(),
};

function trimFromStart(value: string, characters: string): string {
  let index = 0;
  while (index < value.length && characters.includes(value[index])) index += 1;
  return value.slice(index);
}

function trimFromEnd(value: string, characters: string): string {
  let index = value.length;
  while (index > 0 && characters.includes(value[index - 1])) index -= 1;
  return value.slice(0, index);
}

function expandHome(path: string, home: string): string {
  return path === "~" ? home : path.startsWith("~/") ? resolve(home, path.slice(2)) : path;
}

export function resolveHintAction(
  rawTarget: string,
  home = homedir(),
  fs: FileSystem = fileSystem,
): HintAction {
  let target = rawTarget;
  // Path hints include delimiters because Alacritty's DFA has no lookaround.
  const candidate = trimFromStart(target, " \t\r\n\"'`(<[=:");
  if (candidate.startsWith("/") || candidate.startsWith("~/")) {
    target = trimFromEnd(candidate, " \t\r\n\"'`()[]{}<>:,;!?.");
  }

  if (target.startsWith("file:")) {
    const uri = new URL(target);
    if (uri.hostname && uri.hostname !== "localhost") {
      return { program: "xdg-open", args: [target] };
    }
    target = decodeURIComponent(uri.pathname);
  } else if (!target.startsWith("/") && !target.startsWith("~/")) {
    return { program: "xdg-open", args: [target] };
  }

  let path = expandHome(target, home);
  if (!fs.exists(path)) {
    const trimmed = trimFromEnd(path, ".,;!?");
    if (fs.exists(trimmed)) path = trimmed;
  }
  if (!fs.exists(path)) {
    return { program: "notify-send", args: ["Arquivo não encontrado", path] };
  }
  if (fs.isDirectory(path)) {
    return { program: "xdg-open", args: [path] };
  }
  return { program: "alacritty", args: ["-e", "nvim", "--", path] };
}

export function runHint(rawTarget: string): number {
  const action = resolveHintAction(rawTarget);
  const result = spawnSync(action.program, action.args, { stdio: "inherit" });
  if (result.error) {
    console.error(`${action.program}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export function main(args: string[]): number {
  if (args.length !== 1) {
    console.error("target: expected one URL or path argument");
    return 2;
  }
  return runHint(args[0]);
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
