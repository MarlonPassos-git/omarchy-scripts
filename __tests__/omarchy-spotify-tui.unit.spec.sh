#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_file_contains() {
  local file="$1" expected="$2"

  grep -Fq -- "$expected" "$file" || fail "expected <$expected> in $file"
}

write_fake_player() {
  local path="$1" log="$2" exit_status="$3"

  printf '%s\n' \
    '#!/usr/bin/env bash' \
    "printf '%s\\n' \"\$*\" >>'$log'" \
    "exit $exit_status" \
    >"$path"
  chmod +x "$path"
}

test_tui_connects_daemon_before_opening_control_only_binary() {
  local tmpdir control_log tui_log
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' RETURN
  control_log="$tmpdir/control.log"
  tui_log="$tmpdir/tui.log"
  write_fake_player "$tmpdir/control-player" "$control_log" 0
  write_fake_player "$tmpdir/tui-player" "$tui_log" 0

  SPOTIFY_CONTROL_PLAYER="$tmpdir/control-player" \
    SPOTIFY_TUI_PLAYER="$tmpdir/tui-player" \
    SPOTIFY_CONFIG_FOLDER="$tmpdir/control-config" \
    SPOTIFY_TUI_CONFIG_FOLDER="$tmpdir/tui-config" \
    SPOTIFY_CACHE_FOLDER="$tmpdir/cache" \
    ./src/omarchy-spotify-tui

  assert_file_contains "$control_log" "--config-folder $tmpdir/control-config --cache-folder $tmpdir/cache connect --name spotify-player"
  assert_file_contains "$tui_log" "--config-folder $tmpdir/tui-config --cache-folder $tmpdir/cache"
}

test_tui_still_opens_when_device_transfer_fails() {
  local tmpdir tui_log
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' RETURN
  write_fake_player "$tmpdir/control-player" "$tmpdir/control.log" 1
  write_fake_player "$tmpdir/tui-player" "$tmpdir/tui.log" 0

  SPOTIFY_CONTROL_PLAYER="$tmpdir/control-player" \
    SPOTIFY_TUI_PLAYER="$tmpdir/tui-player" \
    SPOTIFY_CONFIG_FOLDER="$tmpdir/control-config" \
    SPOTIFY_TUI_CONFIG_FOLDER="$tmpdir/tui-config" \
    SPOTIFY_CACHE_FOLDER="$tmpdir/cache" \
    ./src/omarchy-spotify-tui

  tui_log="$tmpdir/tui.log"
  assert_file_contains "$tui_log" "--config-folder $tmpdir/tui-config --cache-folder $tmpdir/cache"
}

test_tui_connects_daemon_before_opening_control_only_binary
test_tui_still_opens_when_device_transfer_fails
printf 'ok - Spotify TUI control-only routing\n'
