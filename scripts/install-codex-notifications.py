#!/usr/bin/env python3
"""Configure Codex notifications using this clone; preserve unrelated TOML."""

from datetime import datetime
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tomllib
from typing import Any


def replace_setting(text: str, section: str, key: str, value: str) -> str:
    lines = text.splitlines(keepends=True)
    current: str | None = ""
    section_start: int | None = 0 if not section else None
    for index, line in enumerate(lines):
        header = re.match(r"^\s*\[([^\[\]]+)\]\s*(?:#.*)?$", line)
        if header:
            current = header[1].strip()
            if current == section:
                section_start = index + 1
        elif line.lstrip().startswith("[["):
            current = None
        if current != section or not re.match(rf"^\s*{re.escape(key)}\s*=", line):
            continue
        # Find the end of a TOML value, including multiline notification arrays.
        for end in range(index + 1, len(lines) + 1):
            try:
                tomllib.loads("".join(lines[index:end]))
            except tomllib.TOMLDecodeError:
                continue
            lines[index:end] = [f"{key} = {value}\n"]
            return "".join(lines)
        raise ValueError(f"{key}: expected a valid TOML value")
    if section_start is None:
        return text.rstrip() + f"\n\n[{section}]\n{key} = {value}\n"
    lines.insert(section_start, f"{key} = {value}\n")
    return "".join(lines)


def notification_commands(root: Path) -> tuple[list[str], list[str]]:
    handler = root / "src" / "omarchy-codex-notify.ts"
    current = ["node", str(handler)]
    legacy = ["python3", str(root / "src" / "omarchy-codex-notify")]
    return current, legacy


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    config = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "config.toml"
    original = config.read_text() if config.exists() else ""
    settings: dict[str, Any] = tomllib.loads(original)
    command, legacy_command = notification_commands(root)
    if settings.get("notify") not in (None, command, legacy_command):
        print(
            "notify: another integration is configured; preserve or migrate it before installing",
            file=sys.stderr,
        )
        return 1
    updated = replace_setting(original, "", "notify", json.dumps(command))
    # Completion goes through notify; retain terminal alerts for approvals.
    updated = replace_setting(updated, "tui", "notifications", '["approval-requested"]')
    parsed: dict[str, Any] = tomllib.loads(updated)
    if parsed.get("notify") != command or parsed.get("tui", {}).get("notifications") != ["approval-requested"]:
        print("config.toml: unsupported key layout; configuration was not changed", file=sys.stderr)
        return 1
    if updated == original:
        print("Codex notifications already configured.")
        return 0
    config.parent.mkdir(parents=True, exist_ok=True)
    if config.exists():
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
        shutil.copy2(config, config.with_name(f"{config.name}.bak.omarchy-scripts-{timestamp}"))
    config.write_text(updated)
    print("Codex notifications configured. Restart Codex CLI sessions to load the integration.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
