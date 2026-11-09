#!/usr/bin/env python3
"""Configure Codex notifications using this clone; preserve unrelated TOML."""

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import shutil
import shlex
import subprocess
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-start", action="store_true", help="Configure without starting the observer")
    args = parser.parse_args()
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
    # The observer handles interaction alerts; notify remains a completion fallback.
    updated = replace_setting(updated, "tui", "notifications", "false")
    parsed: dict[str, Any] = tomllib.loads(updated)
    if parsed.get("notify") != command or parsed.get("tui", {}).get("notifications") is not False:
        print("config.toml: unsupported key layout; configuration was not changed", file=sys.stderr)
        return 1
    config_root = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
    hook = config_root / "omarchy/hooks/post-boot.d/omarchy-codex-notifications.sh"
    hook_content = (
        "#!/usr/bin/env bash\nset -euo pipefail\n"
        "# Managed by omarchy-scripts: Codex notifications.\n"
        f"export CODEX_HOME={shlex.quote(str(config.parent))}\n"
        f"exec node {shlex.quote(str(root / 'src/omarchy-codex-notify.ts'))} --start\n"
    )
    hook_original = hook.read_text() if hook.exists() else None
    if hook_original is not None and "# Managed by omarchy-scripts: Codex notifications." not in hook_original:
        print("post-boot hook: another integration owns this path; configuration was not changed", file=sys.stderr)
        return 1
    try:
        dependency = subprocess.run(
            ["node", "--input-type=module", "-e", "if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1); await import('ws')"],
            cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        )
    except OSError:
        print("node: executable unavailable; expected Node.js 24+", file=sys.stderr)
        return 1
    if dependency.returncode:
        print("node/ws: expected Node.js 24+ and installed ws; run npm install before installing notifications", file=sys.stderr)
        return 1
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    if updated != original:
        config.parent.mkdir(parents=True, exist_ok=True)
        if config.exists():
            shutil.copy2(config, config.with_name(f"{config.name}.bak.omarchy-scripts-{timestamp}"))
        config.write_text(updated)
    if hook_content != hook_original:
        hook.parent.mkdir(parents=True, exist_ok=True)
        if hook.exists():
            backups = hook.parent.parent / "backups"
            backups.mkdir(parents=True, exist_ok=True)
            shutil.copy2(hook, backups / f"{hook.name}.bak.omarchy-scripts-{timestamp}")
        hook.write_text(hook_content)
        hook.chmod(0o755)
    if not args.no_start:
        subprocess.run(["node", str(root / "src/omarchy-codex-notify.ts"), "--start"], cwd=root, check=True)
    print("Codex notifications configured. " + ("Observer startup skipped (--no-start)." if args.no_start else "Observer started; it will also start at login."))
    print("Restart Codex sessions to load terminal notification settings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
