import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[1]


class CodexNotificationsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.capture = self.directory / "notification.json"
        notifier = self.directory / "omarchy"
        notifier.write_text(
            f"#!{sys.executable}\nimport json, os, sys\n"
            "from pathlib import Path\n"
            "Path(os.environ['NOTIFICATION_CAPTURE']).write_text(json.dumps(sys.argv[1:]))\n"
        )
        notifier.chmod(0o755)
        self.env = dict(os.environ, PATH=f"{self.directory}:{os.environ['PATH']}",
                        CODEX_HOME=str(self.directory), NOTIFICATION_CAPTURE=str(self.capture))
        self.env.pop("TMUX", None)
        self.env.pop("TMUX_PANE", None)
        self.clients = self.directory / "clients.json"
        self.clients.write_text("[]")
        self.actions = self.directory / "actions.jsonl"
        self.env.update(TEST_CLIENTS=str(self.clients), TEST_ACTIONS=str(self.actions))
        hyprctl = self.directory / "hyprctl"
        hyprctl.write_text(
            f"#!{sys.executable}\nimport json, os, sys\nfrom pathlib import Path\n"
            "if sys.argv[1] == 'clients':\n"
            "    print(Path(os.environ['TEST_CLIENTS']).read_text())\n"
            "else:\n"
            "    with Path(os.environ['TEST_ACTIONS']).open('a') as out:\n"
            "        out.write(json.dumps(sys.argv[1:]) + '\\n')\n"
        )
        hyprctl.chmod(0o755)

    def notification(self):
        args = json.loads(self.capture.read_text())
        return args[:args.index("--exec")]

    def click_notification(self):
        args = json.loads(self.capture.read_text())
        return subprocess.run(args[args.index("--exec") + 1:], env=self.env,
                              capture_output=True, text=True)

    def install_test_windows(self):
        target = {"address": "0x123", "pid": os.getpid(), "stableId": "target"}
        other = {"address": "0x456", "pid": 99999999, "stableId": "other"}
        self.clients.write_text(json.dumps([other, target]))
        return target

    def run_script(self, relative, *args):
        return subprocess.run([sys.executable, str(ROOT / relative), *args],
                              env=self.env, capture_output=True, text=True)

    def test_completion_has_project_and_escaped_bounded_preview(self):
        payload = {"type": "agent-turn-complete", "cwd": "/tmp/my project",
                   "last-assistant-message": "Done <b>&\n" + "x" * 500}
        result = self.run_script("src/omarchy-codex-notify", json.dumps(payload))
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.notification()
        self.assertEqual(args[:2], ["notification", "send"])
        self.assertEqual(args[-2], "Codex terminou · my project")
        self.assertTrue(args[-1].startswith("Done &lt;b&gt;&amp; "))
        self.assertTrue(args[-1].endswith("…"))
        self.assertLess(len(args[-1]), 260)
        self.assertTrue(any(arg.startswith("--icon=") and "codex-desktop" in arg for arg in args))

    def test_internal_title_generation_does_not_notify(self):
        payload = {"type": "agent-turn-complete", "client": "codex-tui",
                   "input-messages": ["Generate a concise, single-line task title of at most 36 characters and under five words where possible.\n\nUser prompt:\nTest"],
                   "last-assistant-message": '{"title":"Validate notifications"}'}
        result = self.run_script("src/omarchy-codex-notify", json.dumps(payload))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.capture.exists())

        payload["input-messages"] = ["Return JSON with a title field."]
        result = self.run_script("src/omarchy-codex-notify", json.dumps(payload))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Validate notifications", self.notification()[-1])

    def test_other_events_are_ignored(self):
        result = self.run_script("src/omarchy-codex-notify", '{"type":"approval-requested"}')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.capture.exists())

    def test_dash_leading_response_remains_notification_text(self):
        payload = {"type": "agent-turn-complete", "last-assistant-message": "--exec"}
        result = self.run_script("src/omarchy-codex-notify", json.dumps(payload))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.notification()[-1], "\u200b--exec")

    def test_empty_completion_has_readable_fallback(self):
        result = self.run_script("src/omarchy-codex-notify", '{"type":"agent-turn-complete"}')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Resposta pronta", self.notification()[-1])

    def test_click_focuses_originating_process_not_another_window(self):
        self.install_test_windows()
        result = self.run_script("src/omarchy-codex-notify", '{"type":"agent-turn-complete"}')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.actions.exists(), "Delivery must not change focus")
        result = self.click_notification()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.actions.read_text()),
                         ["dispatch", 'hl.dsp.focus({ window = "address:0x123" })'])

    def test_click_ignores_closed_or_replaced_origin_window(self):
        target = self.install_test_windows()
        self.run_script("src/omarchy-codex-notify", '{"type":"agent-turn-complete"}')
        target["stableId"] = "replacement"
        self.clients.write_text(json.dumps([target]))
        self.assertEqual(self.click_notification().returncode, 0)
        self.assertFalse(self.actions.exists())

    def test_ambiguous_process_does_not_focus_an_arbitrary_window(self):
        target = self.install_test_windows()
        self.clients.write_text(json.dumps([target, dict(target, address="0x789")]))
        self.run_script("src/omarchy-codex-notify", '{"type":"agent-turn-complete"}')
        self.assertEqual(self.click_notification().returncode, 0)
        self.assertFalse(self.actions.exists())

    def test_tmux_click_restores_originating_session_window_and_pane(self):
        self.install_test_windows()
        self.env.update(TMUX="/tmp/test-tmux.sock,100,0", TMUX_PANE="%7")
        tmux = self.directory / "tmux"
        tmux.write_text(
            f"#!{sys.executable}\nimport json, os, sys\nfrom pathlib import Path\n"
            "command = sys.argv[3]\n"
            "if command == 'display-message':\n"
            "    print('4321\\t$2\\t@3')\n"
            "elif command == 'list-clients':\n"
            f"    print('{os.getpid()}\\t/dev/pts/42\\t$2\\t100')\n"
            "else:\n"
            "    with Path(os.environ['TEST_ACTIONS']).open('a') as out:\n"
            "        out.write(json.dumps(sys.argv[1:]) + '\\n')\n"
        )
        tmux.chmod(0o755)
        self.run_script("src/omarchy-codex-notify", '{"type":"agent-turn-complete"}')
        self.assertFalse(self.actions.exists())
        result = self.click_notification()
        self.assertEqual(result.returncode, 0, result.stderr)
        actions = [json.loads(line) for line in self.actions.read_text().splitlines()]
        self.assertEqual(actions, [
            ["-S", "/tmp/test-tmux.sock", "switch-client", "-c", "/dev/pts/42", "-t", "$2"],
            ["-S", "/tmp/test-tmux.sock", "select-window", "-t", "$2:@3"],
            ["-S", "/tmp/test-tmux.sock", "select-pane", "-t", "%7"],
            ["dispatch", 'hl.dsp.focus({ window = "address:0x123" })'],
        ])

    def test_invalid_payload_does_not_expose_contents(self):
        for payload in ("private invalid data", "[]", '{"type":"agent-turn-complete","cwd":42}'):
            with self.subTest(payload=payload):
                result = self.run_script("src/omarchy-codex-notify", payload)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn(payload, result.stderr)
                self.assertFalse(self.capture.exists())

    def test_install_preserves_settings_backs_up_and_is_idempotent(self):
        config = self.directory / "config.toml"
        original = '# personal setting\nmodel = "test-model"\n[tui]\nnotifications = [\n "agent-turn-complete",\n "approval-requested",\n]\nstatus_line = ["git-branch"]\n'
        config.write_text(original)
        for _ in range(2):
            result = self.run_script("scripts/install-codex-notifications")
            self.assertEqual(result.returncode, 0, result.stderr)
        settings = tomllib.loads(config.read_text())
        self.assertEqual(settings["model"], "test-model")
        self.assertEqual(settings["tui"]["status_line"], ["git-branch"])
        self.assertEqual(settings["tui"]["notifications"], ["approval-requested"])
        self.assertEqual(settings["notify"], ["python3", str(ROOT / "src/omarchy-codex-notify")])
        backups = list(self.directory.glob("config.toml.bak.*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), original)

    def test_install_new_config_and_preserve_existing_notify(self):
        result = self.run_script("scripts/install-codex-notifications")
        self.assertEqual(result.returncode, 0, result.stderr)
        config = self.directory / "config.toml"
        original = 'notify = ["existing-notifier"]\n'
        config.write_text(original)
        result = self.run_script("scripts/install-codex-notifications")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(config.read_text(), original)


if __name__ == "__main__":
    unittest.main()
