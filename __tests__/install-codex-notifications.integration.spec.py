from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[1]


class InstallCodexNotificationsTest(unittest.TestCase):
    temp: tempfile.TemporaryDirectory[str]
    directory: Path
    env: dict[str, str]

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.env = dict(os.environ, CODEX_HOME=str(self.directory), XDG_CONFIG_HOME=str(self.directory / "config"))

    def run_installer(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts/install-codex-notifications.py"), "--no-start"],
            env=self.env,
            capture_output=True,
            text=True,
        )

    def test_preserves_settings_backs_up_and_is_idempotent(self) -> None:
        config = self.directory / "config.toml"
        original = (
            '# personal setting\nmodel = "test-model"\n[tui]\nnotifications = [\n'
            ' "agent-turn-complete",\n "approval-requested",\n]\nstatus_line = ["git-branch"]\n'
        )
        config.write_text(original)
        for _ in range(2):
            result = self.run_installer()
            self.assertEqual(result.returncode, 0, result.stderr)

        settings = tomllib.loads(config.read_text())
        command = ["node", str(ROOT / "src/omarchy-codex-notify.ts")]
        self.assertEqual(settings["model"], "test-model")
        self.assertEqual(settings["tui"]["status_line"], ["git-branch"])
        self.assertIs(settings["tui"]["notifications"], False)
        self.assertEqual(settings["notify"], command)
        backups = list(self.directory.glob("config.toml.bak.*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), original)
        hook = self.directory / "config/omarchy/hooks/post-boot.d/omarchy-codex-notifications.sh"
        self.assertTrue(hook.stat().st_mode & 0o111)
        syntax = subprocess.run(["bash", "-n", str(hook)], capture_output=True, text=True)
        self.assertEqual(syntax.returncode, 0, syntax.stderr)
        self.assertIn("--start", hook.read_text())

    def test_migrates_the_legacy_python_notifier(self) -> None:
        config = self.directory / "config.toml"
        legacy = ["python3", str(ROOT / "src/omarchy-codex-notify")]
        config.write_text(f"notify = {json.dumps(legacy)}\n")

        result = self.run_installer()

        self.assertEqual(result.returncode, 0, result.stderr)
        settings = tomllib.loads(config.read_text())
        self.assertEqual(settings["notify"], ["node", str(ROOT / "src/omarchy-codex-notify.ts")])

    def test_keeps_managed_hook_backups_outside_the_boot_directory(self) -> None:
        hook = self.directory / "config/omarchy/hooks/post-boot.d/omarchy-codex-notifications.sh"
        hook.parent.mkdir(parents=True)
        original = "#!/bin/sh\n# Managed by omarchy-scripts: Codex notifications.\necho previous\n"
        hook.write_text(original)
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(list(hook.parent.iterdir())), 1)
        backups = list((hook.parent.parent / "backups").iterdir())
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), original)

    def test_preserves_an_unrelated_boot_hook(self) -> None:
        config = self.directory / "config.toml"
        original = 'model = "test"\n'
        config.write_text(original)
        hook = self.directory / "config/omarchy/hooks/post-boot.d/omarchy-codex-notifications.sh"
        hook.parent.mkdir(parents=True)
        hook.write_text("#!/bin/sh\necho personal\n")
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(config.read_text(), original)
        self.assertEqual(hook.read_text(), "#!/bin/sh\necho personal\n")

    def test_preserves_an_unrelated_notifier(self) -> None:
        config = self.directory / "config.toml"
        original = 'notify = ["existing-notifier"]\n'
        config.write_text(original)

        result = self.run_installer()

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(config.read_text(), original)


if __name__ == "__main__":
    unittest.main()
