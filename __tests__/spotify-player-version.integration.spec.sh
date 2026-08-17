#!/usr/bin/env bash
set -euo pipefail

SPOTIFY_PLAYER_RELEASE="0.24.1"
SPOTIFY_FULL_PATH=".local/opt/spotify-player-$SPOTIFY_PLAYER_RELEASE/usr/bin/spotify_player"
SPOTIFY_TUI_PATH=".local/opt/spotify-player-tui-$SPOTIFY_PLAYER_RELEASE/usr/bin/spotify_player"

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local expected="$2"

  grep -Fq -- "$expected" "$file" || fail "expected <$expected> in $file"
}

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"

  ! grep -Fq -- "$unexpected" "$file" || fail "unexpected <$unexpected> in $file"
}

test_spotify_control_commands_share_full_release_binary() {
  local file
  local command_files=(
    src/omarchy-spotify
    src/omarchy-spotify-debug-state
    src/omarchy-spotify-media-key
    src/omarchy-spotify-validate-controls
  )

  for file in "${command_files[@]}"; do
    assert_file_contains "$file" "\$HOME/$SPOTIFY_FULL_PATH"
    assert_file_not_contains "$file" "spotify-player-0.24.0"
  done
}

test_tui_uses_control_only_release_binary() {
  assert_file_contains src/omarchy-spotify-tui "\$HOME/$SPOTIFY_FULL_PATH"
  assert_file_contains src/omarchy-spotify-tui "\$HOME/$SPOTIFY_TUI_PATH"
  assert_file_not_contains src/omarchy-spotify-tui 'SPOTIFY_PLAYER='
}

test_service_and_authentication_share_release_binary() {
  assert_file_contains systemd/user/spotify-player.service "%h/$SPOTIFY_FULL_PATH --daemon"
  assert_file_contains README.md "~/$SPOTIFY_FULL_PATH"
  assert_file_contains README.md "~/$SPOTIFY_TUI_PATH"
  assert_file_not_contains systemd/user/spotify-player.service "spotify-player-0.24.0"
  assert_file_not_contains README.md "spotify-player-0.24.0"
}

test_removed_default_device_option_stays_removed() {
  assert_file_not_contains config/spotify-player/app.toml "default_device"
  assert_file_not_contains config/spotify-player-tui/app.toml "default_device"
}

test_service_waits_for_spotify_network_after_boot() {
  assert_file_contains systemd/user/spotify-player.service "ExecStartPre=/usr/bin/curl"
  assert_file_contains systemd/user/spotify-player.service "https://accounts.spotify.com/"
  assert_file_contains systemd/user/spotify-player.service "--retry-all-errors"
}

test_spotify_control_commands_share_full_release_binary
test_tui_uses_control_only_release_binary
test_service_and_authentication_share_release_binary
test_removed_default_device_option_stays_removed
test_service_waits_for_spotify_network_after_boot
printf 'ok - Spotify player release paths\n'
